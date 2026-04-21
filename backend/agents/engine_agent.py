"""
橱柜工厂直切优化引擎 v5 — 统一命名 + T0 混排

术语统一（橱柜行业）:
  - Height: 板件的长度方向 (mm)，沿板长方向排列 (2438.4mm axis)
  - Width:  板件的宽度方向 (mm)

Board Hierarchy:
  T0-RAW:         1219.2 × 2438.4 mm (full raw sheet, 用于混排裁切)
  T1-304.8-INV:   304.8 × 2438.4 mm  (wall cabinet stock, 库存板)
  T1-609.6-INV:   609.6 × 2438.4 mm  (base/tall cabinet stock, 库存板)
  T2:             Final cabinet parts (side panels, top/bottom, back, shelves)

⚠️ 命名规则:
  - 不允许自定义板材名称 (禁止 CUSTOM-876.3-T0 等)
  - 所有板材统一使用: T0-RAW / T1-304.8-INV / T1-609.6-INV

重构流程 (v5):
  STEP 1: parts → strip_demand  (把零件转成条料需求，标记来源)
  STEP 2: apply_inventory       (库存抵扣 T1, 不足/超宽 → T0 pool)
  STEP 3: optimize_t0           (T0 统一混排 FFD, 不分组)
  STEP 4: recover_leftover      (T0 剩料回收)
  STEP 5: ffd_strip_pack        (条料内切零件)
"""

import json
import os
from collections import defaultdict

import pandas as pd


# ── Factory Parameters (mm) ─────────────────────────────
TRIM_LOSS = 5.0   # trim per board edge
SAW_KERF  = 5.0   # kerf per cut

# Strip width thresholds
STRIP_WIDTH_NARROW = 304.8    # T1 narrow (wall cabinet)
STRIP_WIDTH_WIDE   = 609.6    # T1 wide (base/tall cabinet)
BOARD_HEIGHT       = 2438.4   # Standard board height (96″)

# ⚠️ 动态命名 — 将从库存表中自动匹配名称
DEFAULT_BOARD_T0        = "T0-RAW"
DEFAULT_BOARD_T1_NARROW = "T1-304.8-INV"
DEFAULT_BOARD_T1_WIDE   = "T1-609.6-INV"


# ─────────────────────────────────────────────
# Data Loading
# ─────────────────────────────────────────────

def load_parts(path: str):
    """Read parts.xlsx (output from cabinet_calculator v2)."""
    df = pd.read_excel(path)

    # Support both old format (part_id, Height, Depth, qty)
    # and new format (part_id, cab_id, cab_type, component, Height, Width, qty)
    if "Depth" in df.columns and "Width" not in df.columns:
        df = df.rename(columns={"Depth": "Width"})
    required = {"Height", "Width"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[parts.xlsx] Missing columns: {missing}")

    df = df.dropna(subset=["Height", "Width"])

    parts = []
    skipped = []

    for i, row in df.iterrows():
        pid = str(row.get("part_id", f"P{i+1}")).strip()
        try:
            h = float(row["Height"])
            d = float(row["Width"])
            q = int(row.get("qty", 1))
        except (ValueError, TypeError) as e:
            skipped.append({"row": i + 2, "reason": str(e)})
            continue

        if h <= 0 or d <= 0 or q <= 0:
            skipped.append({"row": i + 2, "reason": f"Invalid: Height={h}, Width={d}, qty={q}"})
            continue

        # Carry over extra metadata if present
        extra = {}
        for col in ("cab_id", "cab_type", "component"):
            if col in row:
                extra[col] = str(row[col])

        for _ in range(q):
            parts.append({
                "part_id": pid,
                "Height": h,
                "Width": d,
                **extra,
            })

    if skipped:
        print(f"⚠️  Skipped {len(skipped)} rows:")
        for s in skipped:
            print(f"  Row {s['row']}: {s['reason']}")

    if not parts:
        raise RuntimeError("[parts.xlsx] No valid parts found")

    print(f"📦 Loaded parts: {len(parts)} pieces ({len(df)} rows × qty)")
    return parts, skipped

def load_inventory_from_supabase():
    """Load inventory from Supabase cloud database (main materials only)."""
    try:
        from config.supabase_client import supabase
        result = supabase.table("inventory").select("*").eq("category", "main").execute()

        if not result.data:
            print("⚠️  Supabase inventory is empty")
            return None

        boards = {}
        for row in result.data:
            bt = row["board_type"]
            boards[bt] = {
                "board_type": bt,
                "Height": float(row["height"]),
                "Width": float(row["width"]),
                "qty": int(row["stock"]),
            }

        print(f"☁️  Inventory from Supabase: {len(boards)} board types")
        for bt, info in sorted(boards.items(), key=lambda x: x[1]["Width"]):
            print(f"    {bt}: {info['Width']} × {info['Height']} mm, qty={info['qty']}")
        return boards

    except Exception as e:
        print(f"⚠️  Supabase unavailable ({e}), falling back to local Excel")
        return None


def load_inventory(path: str = None):
    """
    Load inventory: try Supabase first, fall back to local Excel.
    """
    # Try Supabase first
    boards = load_inventory_from_supabase()
    if boards:
        return boards

    # Fallback to local Excel
    if path is None:
        raise RuntimeError("No inventory source available (Supabase down, no local file)")

    df = pd.read_excel(path)

    required = {"board_type", "Height", "Width", "qty"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[inventory] Missing columns: {missing}")

    boards = {}
    for _, row in df.iterrows():
        bt = str(row["board_type"]).strip()
        boards[bt] = {
            "board_type": bt,
            "Height": float(row["Height"]),
            "Width": float(row["Width"]) if "Width" in row else float(row.get("Depth", 0)),
            "qty": int(row["qty"]),
        }

    print(f"📋 Inventory (local): {len(boards)} board types")
    for bt, info in sorted(boards.items(), key=lambda x: x[1]["Width"]):
        print(f"    {bt}: {info['Width']} × {info['Height']} mm, qty={info['qty']}")
    return boards


def deduct_inventory_supabase(board_results: list):
    """After cutting, deduct used board quantities from Supabase inventory."""
    try:
        from config.supabase_client import supabase

        # Count how many of each board_type were used
        usage = {}
        for br in board_results:
            bt = br["board"]
            usage[bt] = usage.get(bt, 0) + 1

        for bt, used in usage.items():
            # Get current stock
            result = supabase.table("inventory").select("stock").eq("board_type", bt).execute()
            if result.data:
                current = result.data[0]["stock"]
                new_stock = max(0, current - used)
                supabase.table("inventory").update({"stock": new_stock}).eq("board_type", bt).execute()
                print(f"  📉 {bt}: {current} → {new_stock} ({used} used)")

    except Exception as e:
        print(f"⚠️  Could not deduct inventory from Supabase: {e}")


# ─────────────────────────────────────────────
# STEP 1: Build Strip Demand
# ─────────────────────────────────────────────

def build_strip_demand(parts: list, inventory: dict = None) -> list:
    """
    Convert all parts into strip demands based on part Width.

    ⚠️ 扫边规则: 所有 Height=2438.4mm 的库存板材(t0,t1), 拿到手第一下
       扫边 5mm (Height方向, 单边, 只扫一次)
       - 2438.4mm → 可用长度 2433.4mm
       - Width 方向不扫边
       - 未来回收/剩余板材不需要再扫 (已经扫过)

    Strategy (优先精确匹配库存):
      1. 先查库存: 精确匹配 Width (±0.5mm 容差)
         e.g.: Width=101.6 → T1-101.6x2438.4 (库存有就用)
      2. 没有精确匹配 → 套用默认规则:
         - Width ≤ 304.8  → T1-304.8-INV
         - Width ≤ 609.6  → T1-609.6-INV
         - Width > 609.6  → T0-RAW

    Returns:
      list of strip demand dicts
    """
    # Build a sorted list of inventory widths for matching
    inv_widths = []  # [(width, board_type), ...]
    if inventory:
        for bt, info in inventory.items():
            if bt.startswith("T0"):
                continue  # skip T0 raw sheets
            inv_widths.append((float(info["Width"]), bt))
        inv_widths.sort(key=lambda x: x[0])  # smallest first

    def find_exact_inv(part_width):
        """Find inventory board that exactly matches this width (±0.5mm)."""
        for inv_w, inv_bt in inv_widths:
            if abs(inv_w - part_width) < 0.5:
                return inv_w, inv_bt
        return None, None

    def find_best_fit_inv(part_width):
        """Find smallest inventory board that fits this width."""
        for inv_w, inv_bt in inv_widths:
            if inv_w >= part_width - 0.5:
                return inv_w, inv_bt
        return None, None

    # Group parts by their required strip width
    strip_groups = defaultdict(list)

    # Strategy 3: default thresholds (找库存里的标准板名字)
    def find_inv_by_width(w):
        best_bt = None
        for inv_w, inv_bt in inv_widths:
            if abs(inv_w - w) < 2.0: # 寻找接近 304.8 或 609.6 的板
                best_bt = inv_bt
                break
        return best_bt

    for p in parts:
        part_width = p["Width"]

        # Strategy 1: exact match in inventory
        exact_w, exact_bt = find_exact_inv(part_width)
        if exact_w is not None:
            strip_groups[(exact_w, exact_bt, False)].append(p)
            continue

        # Strategy 2: best-fit from inventory (smallest board that fits)
        fit_w, fit_bt = find_best_fit_inv(part_width)
        if fit_w is not None and fit_w <= STRIP_WIDTH_WIDE:
            strip_groups[(fit_w, fit_bt, False)].append(p)
            continue

        # Strategy 3: default thresholds (Width不扫边, 直接比较)
        if part_width <= STRIP_WIDTH_NARROW:
            bt = find_inv_by_width(STRIP_WIDTH_NARROW) or DEFAULT_BOARD_T1_NARROW
            strip_groups[(STRIP_WIDTH_NARROW, bt, False)].append(p)
        elif part_width <= STRIP_WIDTH_WIDE:
            bt = find_inv_by_width(STRIP_WIDTH_WIDE) or DEFAULT_BOARD_T1_WIDE
            strip_groups[(STRIP_WIDTH_WIDE, bt, False)].append(p)
        else:
            # 超宽: 精确宽度, 必须从 T0 裁切. 找库存里的 T0 名字
            t0_name = DEFAULT_BOARD_T0
            if inventory:
                for bt_inv in inventory.keys():
                    if bt_inv.startswith("T0"):
                        t0_name = bt_inv
                        break
            strip_w = round(part_width, 1)
            strip_groups[(strip_w, t0_name, True)].append(p)

    strip_demand = []
    for (width, btype, needs_t0), parts_list in sorted(strip_groups.items()):
        strip_demand.append({
            "strip_width": width,
            "board_type": btype,
            "needs_t0": needs_t0,
            "parts": parts_list,
        })

    print(f"\n── STEP 1: Strip Demand ──")
    for sd in strip_demand:
        t0_mark = " → T0" if sd["needs_t0"] else " (库存)"
        print(f"  {sd['board_type']} @{sd['strip_width']}mm: "
              f"{len(sd['parts'])} parts{t0_mark}")

    return strip_demand


# ─────────────────────────────────────────────
# STEP 2: Apply Inventory (stock deduction)
# ─────────────────────────────────────────────

def apply_inventory(strip_demand: list, inventory: dict) -> dict:
    """
    Use existing T1 inventory to satisfy strip demand.
    Inventory ONLY covers standard T1 strips (304.8 / 609.6).
    Custom/oversize strips always go to T0 pool.

    Returns:
      {
        "used_inventory": {board_type: count_used},
        "t0_pool": [
          {"strip_width": float, "parts": [...]},
          ...
        ],
        "inventory_strips": [
          {"strip_width": float, "board_type": str, "parts": [...], "source": "inventory"},
          ...
        ],
      }
    """
    used_inventory = {}
    t0_pool = []        # all strips that need T0 cutting
    inventory_strips = []

    # Map standard strip widths to inventory board types
    def find_matching_board(target_width):
        """Find a board_type in inventory whose Width matches target_width."""
        for bt, info in inventory.items():
            if abs(info["Width"] - target_width) < 0.5:  # tolerance
                return bt, info
        return None, None

    for sd in strip_demand:
        sw = sd["strip_width"]
        parts_for_strip = sd["parts"]

        if sd["needs_t0"]:
            # 超宽零件 → 必须 T0 裁切, 直接进 t0_pool
            t0_pool.append({
                "strip_width": sw,
                "parts": parts_for_strip,
            })
            continue

        # T1 standard strips: check inventory
        bt, board_info = find_matching_board(sw)
        if bt is None or board_info["qty"] <= 0:
            # No inventory → all go to T0
            t0_pool.append({
                "strip_width": sw,
                "parts": parts_for_strip,
            })
            continue

        available_stock = board_info["qty"] - used_inventory.get(bt, 0)

        # How many strips do we need?
        needed_strips = _count_strips_needed(parts_for_strip, sw)

        if available_stock <= 0:
            t0_pool.append({
                "strip_width": sw,
                "parts": parts_for_strip,
            })
            continue

        # How many strips can we cover from inventory?
        covered = min(needed_strips, available_stock)
        used_inventory[bt] = used_inventory.get(bt, 0) + covered

        if covered >= needed_strips:
            # All parts served from inventory
            inventory_strips.append({
                "strip_width": sw,
                "board_type": sd["board_type"],
                "parts": parts_for_strip,
                "source": "inventory",
                "strips_used": covered,
            })
        else:
            # Partial inventory coverage — split parts
            inv_parts, t0_parts = _split_parts_for_strips(parts_for_strip, sw, covered)

            if inv_parts:
                inventory_strips.append({
                    "strip_width": sw,
                    "board_type": sd["board_type"],
                    "parts": inv_parts,
                    "source": "inventory",
                    "strips_used": covered,
                })
            if t0_parts:
                t0_pool.append({
                    "strip_width": sw,
                    "parts": t0_parts,
                })

    print(f"\n── STEP 2: Inventory Applied ──")
    for bt, cnt in used_inventory.items():
        print(f"  ✅ Used {cnt} × {bt} from inventory")
    if t0_pool:
        total_t0_parts = sum(len(p["parts"]) for p in t0_pool)
        widths = set(p["strip_width"] for p in t0_pool)
        print(f"  🔶 T0 pool: {total_t0_parts} parts across widths {sorted(widths)}")
    else:
        print(f"  ✅ All parts covered by inventory, no T0 needed")

    return {
        "used_inventory": used_inventory,
        "t0_pool": t0_pool,
        "inventory_strips": inventory_strips,
    }


def _count_strips_needed(parts: list, strip_width: float) -> int:
    """Quick FFD to count how many strips are needed for these parts."""
    usable = BOARD_HEIGHT - TRIM_LOSS
    sorted_parts = sorted(parts, key=lambda p: p["Height"], reverse=True)

    strips = []  # each is remaining length

    for p in sorted_parts:
        cl = p["Height"]
        placed = False
        for i, remaining in enumerate(strips):
            needed = cl + SAW_KERF
            if remaining >= needed:
                strips[i] -= needed
                placed = True
                break
        if not placed:
            # New strip: first part no kerf
            strips.append(usable - cl)

    return len(strips)


def _split_parts_for_strips(parts: list, strip_width: float, max_strips: int):
    """
    Pack parts into max_strips strips using FFD.
    Returns (parts_in_strips, parts_remaining).
    """
    usable = BOARD_HEIGHT - TRIM_LOSS
    sorted_parts = sorted(parts, key=lambda p: p["Height"], reverse=True)

    strips = []  # list of {remaining, parts}
    overflow = []

    for p in sorted_parts:
        cl = p["Height"]
        placed = False

        for strip in strips:
            needed = cl + SAW_KERF
            if strip["remaining"] >= needed:
                strip["parts"].append(p)
                strip["remaining"] -= needed
                placed = True
                break

        if not placed:
            if len(strips) < max_strips:
                strips.append({"remaining": usable - cl, "parts": [p]})
            else:
                overflow.append(p)

    inv_parts = []
    for s in strips:
        inv_parts.extend(s["parts"])

    return inv_parts, overflow


# ─────────────────────────────────────────────
# STEP 3: T0 Unified Mixed-Strip Optimization
# ─────────────────────────────────────────────
# (Delegated to t0_optimizer.optimize_t0_from_strips)


# ─────────────────────────────────────────────
# STEP 5: FFD within each strip (pack parts along Height axis)
# ─────────────────────────────────────────────

def ffd_strip_pack(parts: list, strip_width: float, board_type: str,
                   board_height: float = BOARD_HEIGHT) -> list:
    """
    FFD bin packing of parts within a strip along the Height (2438.4mm) axis.

    ⚠️ 扫边: Height方向扫边 5mm (2438.4 → 2433.4mm), Width方向不扫边.

    This is used for BOTH inventory strips AND T0-cut strips.

    Args:
      parts: list of part dicts with Height, Width
      strip_width: width of the strip (304.8 / 609.6 / custom)
      board_type: unified board label (T1-304.8-INV / T1-609.6-INV / T0-RAW)
      board_height: total length of the strip

    Returns:
      list of strip results, each with parts and utilization
    """
    usable = board_height - TRIM_LOSS  # Height方向扫边: 2438.4 - 5 = 2433.4mm
    sorted_parts = sorted(parts, key=lambda p: p["Height"], reverse=True)

    open_strips = []  # each: {remaining, parts}

    for part in sorted_parts:
        cl = part["Height"]
        needed = cl + SAW_KERF

        if needed > usable:
            print(f"  ⚠️  Part {part['part_id']} Height {cl}mm + kerf > usable {usable}mm, skip")
            continue

        placed = False
        for strip in open_strips:
            if strip["remaining"] >= needed:
                strip["parts"].append(part)
                strip["remaining"] -= needed
                placed = True
                break

        if not placed:
            # First part on new strip: no kerf
            open_strips.append({
                "remaining": usable - cl,
                "parts": [part],
            })

    strip_area = strip_width * board_height
    results = []
    for idx, strip in enumerate(open_strips, 1):
        parts_total_len = sum(p["Height"] for p in strip["parts"])
        parts_total_area = sum(p["Height"] * p["Width"] for p in strip["parts"])
        k = len(strip["parts"])
        kerf_total = (k - 1) * SAW_KERF if k > 1 else 0
        waste = usable - parts_total_len - kerf_total

        utilization = parts_total_area / strip_area if strip_area > 0 else 0

        results.append({
            "board_id": f"{board_type}-{idx:03d}",
            "board": board_type,
            "board_type": board_type,
            "board_size": f"{strip_width} × {board_height}",
            "strip_width": strip_width,
            "parts": [
                {
                    "part_id": p["part_id"],
                    "Height": p["Height"],
                    "Width": p["Width"],
                    "cut_length": p["Height"],
                    "component": p.get("component", ""),
                    "cab_id": p.get("cab_id", ""),
                    "cab_type": p.get("cab_type", ""),
                    "rotated": p.get("rotated", False),
                }
                for p in strip["parts"]
            ],
            "trim_loss": TRIM_LOSS,
            "saw_kerf": SAW_KERF,
            "cuts": k,
            "parts_total_length": round(parts_total_len, 1),
            "parts_total_area": round(parts_total_area, 1),
            "board_area": round(strip_area, 1),
            "kerf_total": round(kerf_total, 1),
            "usable_length": round(usable, 1),
            "waste": round(waste, 1),
            "utilization": round(utilization, 4),
        })

    return results


# ─────────────────────────────────────────────
# Legacy-compatible wrappers (for workflow_controller & cloud_controller)
# ─────────────────────────────────────────────

def match_parts_to_boards(parts: list, boards: dict):
    """
    DEPRECATED — kept for backward compatibility.
    """
    sorted_boards = sorted(boards.values(), key=lambda b: b["Width"])

    matched = defaultdict(list)
    unmatched = []

    for p in parts:
        p_height, p_width = p["Height"], p["Width"]
        placed = False

        for board in sorted_boards:
            if p_width <= board["Width"] and p_height <= board["Height"]:
                matched[board["board_type"]].append({
                    **p,
                    "cut_length": p_height,
                })
                placed = True
                break

        if not placed:
            unmatched.append(p)

    return matched, unmatched


def ffd_bin_pack(parts_list: list, board_info: dict):
    """DEPRECATED — kept for backward compatibility."""
    board_height = board_info["Height"]
    board_width  = board_info["Width"]
    board_type   = board_info["board_type"]
    max_qty      = board_info["qty"]
    usable       = board_height - TRIM_LOSS

    sorted_parts = sorted(parts_list, key=lambda p: p["cut_length"], reverse=True)
    open_boards = []

    for part in sorted_parts:
        cl = part["cut_length"]
        needed = cl + SAW_KERF

        if needed > usable:
            continue

        placed = False
        for board in open_boards:
            if board["remaining"] >= needed:
                board["parts"].append(part)
                board["remaining"] -= needed
                placed = True
                break

        if not placed:
            if len(open_boards) >= max_qty:
                break
            open_boards.append({
                "remaining": usable - needed,
                "parts": [part],
            })

    board_area = board_height * board_width
    results = []
    for idx, board in enumerate(open_boards, 1):
        board_id = f"{board_type}-{idx:03d}"
        parts_total = sum(p["cut_length"] for p in board["parts"])
        parts_total_area = sum(p["Height"] * p["Width"] for p in board["parts"])
        k = len(board["parts"])
        kerf_total = k * SAW_KERF
        waste = usable - parts_total - kerf_total
        utilization = parts_total_area / board_area if board_area > 0 else 0

        results.append({
            "board_id": board_id,
            "board": board_type,
            "board_type": board_type,
            "board_size": f"{board_width} × {board_height}",
            "parts": [
                {
                    "part_id": p["part_id"],
                    "Height": p["Height"],
                    "Width": p["Width"],
                    "cut_length": p["cut_length"],
                    "component": p.get("component", ""),
                    "cab_id": p.get("cab_id", ""),
                    "cab_type": p.get("cab_type", ""),
                    "rotated": p.get("rotated", False),
                }
                for p in board["parts"]
            ],
            "trim_loss": TRIM_LOSS,
            "saw_kerf": SAW_KERF,
            "cuts": k,
            "parts_total_length": round(parts_total, 1),
            "parts_total_area": round(parts_total_area, 1),
            "board_area": round(board_area, 1),
            "kerf_total": round(kerf_total, 1),
            "usable_length": round(usable, 1),
            "waste": round(waste, 1),
            "utilization": round(utilization, 4),
        })

    return results


# ─────────────────────────────────────────────
# Main Pipeline (v5 — Unified Naming + T0 Mixed Packing)
# ─────────────────────────────────────────────

def run_engine(parts_path: str, inventory_path: str, output_path: str = "output/cut_result.json"):
    """
    Full engine run — v5 unified naming + real factory flow:

      parts → strip_demand → apply_inventory → T0 mixed optimize
           → recover leftover → strip-level part packing

    Board names used:
      - T0-RAW          (T0 原板统一命名)
      - T1-304.8-INV    (库存窄板)
      - T1-609.6-INV    (库存宽板)
    """
    from agents.t0_optimizer import optimize_t0_from_strips, recover_leftover

    print("=" * 60)
    print("  Guillotine Cutting Engine v5 — Unified Naming")
    print("=" * 60)

    # ─── Load data ───
    parts, skipped_rows = load_parts(parts_path)
    inventory = load_inventory(inventory_path)
    
    # 确定 T0 板的名字 (从库存获取)
    t0_name = DEFAULT_BOARD_T0
    if inventory:
        for bt_inv in inventory.keys():
            if bt_inv.startswith("T0"):
                t0_name = bt_inv
                break

    # ─── 检测超板零件 ───
    # 板材最大尺寸: Height方向=2438.4mm, Width方向=1219.2mm (T0满板)
    usable_height = BOARD_HEIGHT - TRIM_LOSS  # 2433.4mm
    # 找到最大可用板宽 (T0 raw sheet width)
    max_board_width = 1219.2  # T0 default
    if inventory:
        for bt, info in inventory.items():
            if bt.startswith("T0"):
                max_board_width = info["Width"]
                break

    valid_parts = []
    oversized_parts = []
    for p in parts:
        h, w = p["Height"], p["Width"]
        # 超板: Width超过最大板宽 或 Height超过板材可用长度
        if w > max_board_width or h > usable_height:
            oversized_parts.append(p)
        else:
            valid_parts.append(p)

    if oversized_parts:
        print(f"\n❌ 发现 {len(oversized_parts)} 个超板零件 (板材极限: {max_board_width}×{BOARD_HEIGHT}mm):")
        for op in oversized_parts:
            cab = op.get('cab_id', '?')
            comp = op.get('component', '?')
            print(f"   ⛔ {cab}-{comp}: {op['Height']} × {op['Width']}mm — 无法裁切!")

    parts = valid_parts

    # ─── STEP 1: Build strip demand ───
    strip_demand = build_strip_demand(parts, inventory)

    # ─── STEP 2: Apply inventory ───
    inv_result = apply_inventory(strip_demand, inventory)
    used_inventory = inv_result["used_inventory"]
    t0_pool = inv_result["t0_pool"]
    inventory_strips = inv_result["inventory_strips"]

    # ─── STEP 3: T0 unified mixed-strip optimization ───
    # Build the T0 strip list from the pool
    # Key: ALL strips go into ONE mixed pool (different widths together)
    t0_strip_items = []
    t0_parts_by_width = {}  # track parts for each width for STEP 5

    for pool_entry in t0_pool:
        sw = pool_entry["strip_width"]
        pool_parts = pool_entry["parts"]

        # Store parts for later packing
        if sw not in t0_parts_by_width:
            t0_parts_by_width[sw] = []
        t0_parts_by_width[sw].extend(pool_parts)

        # Count how many strips we need for this width
        count = _count_strips_needed(pool_parts, sw)
        
        # 寻找库存里的 T0 名字 (动态匹配)
        t0_name = DEFAULT_BOARD_T0
        if inventory:
            for bt_inv in inventory.keys():
                if bt_inv.startswith("T0"):
                    t0_name = bt_inv
                    break
                    
        for _ in range(count):
            t0_strip_items.append({
                "strip_width": sw,
                "strip_label": t0_name,
                "strip_type": "T0",
            })

    # ─── STEP 3b: T0 Gap-Filling Optimization ───
    # 计算 T0 板上剩余空间, 从库存拉入窄条料填充缝隙
    # e.g.: 876.3mm 独占一张 T0 → 337.9mm 空隙 → 可填 304.8mm!
    if t0_strip_items:
        T0_USABLE = 1219.2 - 5.0  # = 1214.2mm
        # Simulate FFD to find gaps
        simulated_sheets = []
        for item in sorted(t0_strip_items, key=lambda x: x["strip_width"], reverse=True):
            sw = item["strip_width"]
            placed = False
            for sheet in simulated_sheets:
                needed = sw + SAW_KERF
                if sheet["remaining"] >= needed:
                    sheet["remaining"] -= needed
                    sheet["count"] += 1
                    placed = True
                    break
            if not placed:
                simulated_sheets.append({"remaining": T0_USABLE - sw, "count": 1})

        # Count how many narrow/wide fills we can add
        fill_narrow = 0  # 304.8mm fills
        fill_wide = 0    # 609.6mm fills

        for sheet in simulated_sheets:
            rem = sheet["remaining"]
            # Try to fill with as many strips as possible
            while rem >= STRIP_WIDTH_NARROW + SAW_KERF:
                if rem >= STRIP_WIDTH_WIDE + SAW_KERF:
                    fill_wide += 1
                    rem -= (STRIP_WIDTH_WIDE + SAW_KERF)
                elif rem >= STRIP_WIDTH_NARROW + SAW_KERF:
                    fill_narrow += 1
                    rem -= (STRIP_WIDTH_NARROW + SAW_KERF)
                else:
                    break
            # Last strip on sheet: no kerf needed after it
            if rem >= STRIP_WIDTH_WIDE:
                fill_wide += 1
                rem -= STRIP_WIDTH_WIDE
            elif rem >= STRIP_WIDTH_NARROW:
                fill_narrow += 1
                rem -= STRIP_WIDTH_NARROW

        # Pull strips from inventory into T0 pool
        if fill_narrow > 0 or fill_wide > 0:
            print(f"\n── STEP 3b: T0 Gap-Fill Optimization ──")
            print(f"  Gaps found: can fill {fill_narrow}×304.8 + {fill_wide}×609.6")

            # Pull narrow strips from inventory
            for inv_strip in inventory_strips[:]:
                if fill_narrow <= 0:
                    break
                if abs(inv_strip["strip_width"] - STRIP_WIDTH_NARROW) < 0.5:
                    can_pull = min(fill_narrow, inv_strip["strips_used"])
                    if can_pull > 0:
                        # Split: some strips stay in inventory, some go to T0
                        pull_parts, keep_parts = _split_parts_for_strips(
                            inv_strip["parts"], STRIP_WIDTH_NARROW, 
                            inv_strip["strips_used"] - can_pull
                        )
                        # keep_parts go to T0, pull_parts stay in inventory
                        # (reversed because _split returns in-strips first)
                        if keep_parts:
                            # Add pulled parts to T0 pool
                            if STRIP_WIDTH_NARROW not in t0_parts_by_width:
                                t0_parts_by_width[STRIP_WIDTH_NARROW] = []
                            t0_parts_by_width[STRIP_WIDTH_NARROW].extend(keep_parts)
                            for _ in range(can_pull):
                                t0_strip_items.append({
                                    "strip_width": STRIP_WIDTH_NARROW,
                                    "strip_label": t0_name,
                                    "strip_type": "T0",
                                })
                            # Update inventory strip
                            inv_strip["parts"] = pull_parts
                            inv_strip["strips_used"] -= can_pull
                            # Refund inventory usage
                            bt = inv_strip["board_type"]
                            used_inventory[bt] = max(0, used_inventory.get(bt, 0) - can_pull)
                            fill_narrow -= can_pull
                            print(f"  ✅ Pulled {can_pull}×304.8 from inventory → T0 gap-fill")
                            if not pull_parts:
                                inventory_strips.remove(inv_strip)

            # Pull wide strips from inventory  
            for inv_strip in inventory_strips[:]:
                if fill_wide <= 0:
                    break
                if abs(inv_strip["strip_width"] - STRIP_WIDTH_WIDE) < 0.5:
                    can_pull = min(fill_wide, inv_strip["strips_used"])
                    if can_pull > 0:
                        pull_parts, keep_parts = _split_parts_for_strips(
                            inv_strip["parts"], STRIP_WIDTH_WIDE,
                            inv_strip["strips_used"] - can_pull
                        )
                        if keep_parts:
                            if STRIP_WIDTH_WIDE not in t0_parts_by_width:
                                t0_parts_by_width[STRIP_WIDTH_WIDE] = []
                            t0_parts_by_width[STRIP_WIDTH_WIDE].extend(keep_parts)
                            for _ in range(can_pull):
                                t0_strip_items.append({
                                    "strip_width": STRIP_WIDTH_WIDE,
                                    "strip_label": t0_name,
                                    "strip_type": "T0",
                                })
                            inv_strip["parts"] = pull_parts
                            inv_strip["strips_used"] -= can_pull
                            bt = inv_strip["board_type"]
                            used_inventory[bt] = max(0, used_inventory.get(bt, 0) - can_pull)
                            fill_wide -= can_pull
                            print(f"  ✅ Pulled {can_pull}×609.6 from inventory → T0 gap-fill")
                            if not pull_parts:
                                inventory_strips.remove(inv_strip)

    t0_plan = None
    if t0_strip_items:
        t0_plan = optimize_t0_from_strips(t0_strip_items)

        # ─── STEP 4: Recover leftover from T0 sheets ───
        for sheet in t0_plan["t0_sheets"]:
            recover_leftover(sheet)

    # ─── STEP 5: Pack parts into strips ───
    all_board_results = []

    # 5a. Inventory strips — pack parts using T1-xxx-INV name
    #     扫边: Height方向 5mm (2438.4→2433.4), Width不扫
    for inv_strip in inventory_strips:
        results = ffd_strip_pack(
            inv_strip["parts"],
            inv_strip["strip_width"],
            inv_strip["board_type"],  # T1-304.8-INV or T1-609.6-INV
        )
        for r in results:
            r["source"] = "inventory"
        all_board_results.extend(results)

    # 5b. T0 strips — pack parts using T0 name
    for sw, t0_parts in t0_parts_by_width.items():
        # 寻找库存里的 T0 名字
        t0_name = DEFAULT_BOARD_T0
        if inventory:
            for bt_inv in inventory.keys():
                if bt_inv.startswith("T0"):
                    t0_name = bt_inv
                    break
                    
        results = ffd_strip_pack(
            t0_parts,
            sw,
            t0_name,
        )
        for r in results:
            r["source"] = "T0"
            r["actual_strip_width"] = sw  # 保存实际裁切宽度
        all_board_results.extend(results)

    # ─── Summary ───
    total_boards = len(all_board_results)
    total_parts_required = len(parts)
    total_parts_placed = sum(len(b["parts"]) for b in all_board_results)
    total_parts_unmatched = total_parts_required - total_parts_placed
    total_oversized = len(oversized_parts)
    all_parts_cut = (total_parts_placed == total_parts_required) and total_oversized == 0

    total_parts_area = sum(b["parts_total_area"] for b in all_board_results)
    total_board_area = sum(b["board_area"] for b in all_board_results)
    total_waste = sum(b["waste"] for b in all_board_results)
    overall_util = total_parts_area / total_board_area if total_board_area > 0 else 0

    t0_sheets_used = t0_plan["t0_sheets_needed"] if t0_plan else 0
    t0_total_recovery = 0
    recovered_inventory = []
    if t0_plan:
        for sheet in t0_plan["t0_sheets"]:
            for r in sheet.get("recovered_strips", []):
                t0_total_recovery += 1
                recovered_inventory.append(r)

    # Board type breakdown
    board_type_counts = defaultdict(int)
    for b in all_board_results:
        board_type_counts[b["board"]] += 1

    # ── Inventory shortage detection ──
    # Compare boards needed (board_type_counts) vs inventory stock
    inventory_shortage = []
    for bt, needed in board_type_counts.items():
        if bt in inventory:
            stock = inventory[bt]["qty"]
            if needed > stock:
                inventory_shortage.append({
                    "board_type": bt,
                    "needed": needed,
                    "stock": stock,
                    "shortage": needed - stock,
                })
        # Also check via used_inventory (which tracks T1 inventory usage)
    for bt, used_count in used_inventory.items():
        if bt in inventory:
            stock = inventory[bt]["qty"]
            if used_count > stock and not any(s["board_type"] == bt for s in inventory_shortage):
                inventory_shortage.append({
                    "board_type": bt,
                    "needed": used_count,
                    "stock": stock,
                    "shortage": used_count - stock,
                })
    if inventory_shortage:
        print(f"\n⚠️  库存不足:")
        for s in inventory_shortage:
            print(f"   {s['board_type']}: 需要 {s['needed']}张, 库存 {s['stock']}张, 缺少 {s['shortage']}张")

    summary = {
        "total_parts_required": total_parts_required,
        "total_parts_placed": total_parts_placed,
        "total_parts_unmatched": total_parts_unmatched,
        "all_parts_cut": all_parts_cut,
        "strips_used": total_boards,
        "boards_used": total_boards,  # legacy compat
        "t0_sheets_used": t0_sheets_used,
        "t0_recovered_strips": t0_total_recovery,
        "inventory_used": used_inventory,
        "inventory_shortage": inventory_shortage,
        "board_type_breakdown": dict(board_type_counts),
        "total_parts_length": round(sum(b["parts_total_length"] for b in all_board_results), 1),
        "total_trim_loss": round(sum(b["trim_loss"] for b in all_board_results), 1),
        "total_kerf_loss": round(sum(b["kerf_total"] for b in all_board_results), 1),
        "total_waste": round(total_waste, 1),
        "overall_utilization": round(overall_util, 4),
        "config_trim_loss_mm": TRIM_LOSS,
        "config_saw_kerf_mm": SAW_KERF,
    }

    if total_parts_unmatched > 0:
        summary["warning"] = f"{total_parts_unmatched} parts could not be placed"

    if total_oversized > 0:
        summary["oversized_count"] = total_oversized
        summary["oversized_warning"] = (
            f"{total_oversized} 个零件尺寸超过板材最大尺寸 {BOARD_HEIGHT}mm，无法裁切！"
        )

    # Issues report
    oversized_issues = [
        {
            "part_id": p.get("part_id", "?"),
            "cab_id": p.get("cab_id", "?"),
            "component": p.get("component", "?"),
            "Height": p["Height"],
            "Width": p["Width"],
            "reason": f"尺寸 {p['Height']}×{p['Width']}mm 超过板材最大尺寸 {BOARD_HEIGHT}mm",
        }
        for p in oversized_parts
    ]
    issues = {
        "skipped_rows": [
            {"file": "parts.xlsx", "source": f"Row {s['row']}: {s['reason']}"}
            for s in skipped_rows
        ],
        "unmatched_parts": [],
        "oversized_parts": oversized_issues,
    }

    # ─── Output JSON ───
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    output = {
        "summary": summary,
        "issues": issues,
        "boards": all_board_results,
    }

    # Add T0 plan details if present
    if t0_plan and t0_plan.get("t0_sheets_needed", 0) > 0:
        output["t0_plan"] = t0_plan

    # Add recovered inventory
    if recovered_inventory:
        output["recovered_inventory"] = recovered_inventory

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # ─── Print Summary ───
    print(f"\n{'=' * 60}")
    print(f"  ✅ Optimization Complete! (v5 Unified Naming)")
    print(f"  {'=' * 58}")
    print(f"  Parts required:  {total_parts_required}")
    print(f"  Parts placed:    {total_parts_placed}")
    if total_parts_unmatched > 0:
        print(f"  ⚠️  Unplaced:    {total_parts_unmatched}")
    if total_oversized > 0:
        print(f"  ⛔ Oversized:    {total_oversized} (超板，无法裁切)")
    print(f"  All placed:      {'✅ Yes' if all_parts_cut else '❌ No'}")
    print(f"  {'─' * 58}")
    print(f"  Board breakdown:")
    for bt, cnt in sorted(board_type_counts.items()):
        print(f"    {bt}: {cnt} strips")
    print(f"  {'─' * 58}")
    print(f"  T0 sheets used:  {t0_sheets_used}")
    if t0_plan:
        t0_util = t0_plan.get("total_utilization", 0)
        print(f"  T0 utilization:  {t0_util*100:.1f}%")
    print(f"  T0 recovered:    {t0_total_recovery} strips")
    if recovered_inventory:
        for r in recovered_inventory:
            print(f"    ♻️ {r['label']} ({r['width']}mm) → {r['board_type']}")
    print(f"  Inventory used:  {used_inventory}")
    print(f"  Total strips:    {total_boards}")
    print(f"  Utilization:     {overall_util*100:.1f}%")
    print(f"  Total waste:     {total_waste:.1f}mm")
    print(f"  Output:          {output_path}")
    print(f"{'=' * 60}")

    return output


# Keep backward-compatible function names for workflow_controller
def main():
    run_engine(
        parts_path="data/parts.xlsx",
        inventory_path="data/t1_inventory.xlsx",
        output_path="output/cut_result.json",
    )


if __name__ == "__main__":
    main()