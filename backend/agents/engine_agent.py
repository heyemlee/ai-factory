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

DEFAULT_BOX_COLOR = "WhiteBirch"


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
        for col in ("cab_id", "cab_type", "component", "color"):
            if col in row and pd.notna(row[col]):
                extra[col] = str(row[col])
        if "color" not in extra:
            extra["color"] = DEFAULT_BOX_COLOR

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
    """Load inventory from Supabase cloud database (main materials only).

    Returns a per-color inventory: {color_key: {board_type: {board_type, Height, Width, qty, color}}}.
    """
    try:
        from config.supabase_client import supabase
        result = supabase.table("inventory").select("*").eq("category", "main").execute()

        if not result.data:
            print("⚠️  Supabase inventory is empty")
            return None

        per_color: dict = {}
        for row in result.data:
            bt = row["board_type"]
            color = row.get("color") or DEFAULT_BOX_COLOR
            entry = {
                "board_type": bt,
                "Height": float(row["height"]),
                "Width": float(row["width"]),
                "qty": int(row["stock"]),
                "color": color,
            }
            per_color.setdefault(color, {})[bt] = entry

        total = sum(len(v) for v in per_color.values())
        print(f"☁️  Inventory from Supabase: {total} board rows across {len(per_color)} color(s)")
        for color, boards in per_color.items():
            print(f"  🎨 {color}: {len(boards)} board types")
            for bt, info in sorted(boards.items(), key=lambda x: x[1]["Width"]):
                print(f"      {bt}: {info['Width']} × {info['Height']} mm, qty={info['qty']}")
        return per_color

    except Exception as e:
        print(f"⚠️  Supabase unavailable ({e}), falling back to local Excel")
        return None


def load_inventory(path: str = None):
    """
    Load inventory: try Supabase first, fall back to local Excel.
    Returns per-color dict: {color: {board_type: info}}.
    """
    # Try Supabase first
    per_color = load_inventory_from_supabase()
    if per_color:
        return per_color

    # Fallback to local Excel (legacy single-color)
    if path is None:
        raise RuntimeError("No inventory source available (Supabase down, no local file)")

    df = pd.read_excel(path)

    required = {"board_type", "Height", "Width", "qty"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[inventory] Missing columns: {missing}")

    per_color: dict = {}
    for _, row in df.iterrows():
        bt = str(row["board_type"]).strip()
        color = str(row["color"]).strip() if "color" in row and pd.notna(row.get("color")) else DEFAULT_BOX_COLOR
        per_color.setdefault(color, {})[bt] = {
            "board_type": bt,
            "Height": float(row["Height"]),
            "Width": float(row["Width"]) if "Width" in row else float(row.get("Depth", 0)),
            "qty": int(row["qty"]),
            "color": color,
        }

    total = sum(len(v) for v in per_color.values())
    print(f"📋 Inventory (local): {total} board rows across {len(per_color)} color(s)")
    for color, boards in per_color.items():
        print(f"  🎨 {color}: {len(boards)} board types")
        for bt, info in sorted(boards.items(), key=lambda x: x[1]["Width"]):
            print(f"      {bt}: {info['Width']} × {info['Height']} mm, qty={info['qty']}")
    return per_color


def deduct_inventory_supabase(board_results: list):
    """After cutting, deduct used board quantities from Supabase inventory."""
    try:
        from config.supabase_client import supabase

        # Count how many of each (board_type, color) were used
        usage = {}
        for br in board_results:
            bt = br["board"]
            color = br.get("color") or DEFAULT_BOX_COLOR
            usage[(bt, color)] = usage.get((bt, color), 0) + 1

        for (bt, color), used in usage.items():
            # Get current stock
            result = (
                supabase.table("inventory")
                .select("stock")
                .eq("board_type", bt)
                .eq("color", color)
                .execute()
            )
            if result.data:
                current = result.data[0]["stock"]
                new_stock = max(0, current - used)
                (
                    supabase.table("inventory")
                    .update({"stock": new_stock})
                    .eq("board_type", bt)
                    .eq("color", color)
                    .execute()
                )
                print(f"  📉 {bt} [{color}]: {current} → {new_stock} ({used} used)")

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
      2. 旋转匹配: 零件 Height 精确匹配库存 Width (±0.5mm)
         且旋转后原 Width 作为新 Height ≤ 可用长度 (2433.4mm)
         e.g.: Height=304.8, Width=600 → 旋转后 Width=304.8 匹配 T1-304.8
      3. 没有精确匹配 → T0 裁切

    Returns:
      list of strip demand dicts
    """
    usable_length = BOARD_HEIGHT - TRIM_LOSS  # 2433.4mm

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
        
        # Hard fallback for standard widths!
        # Even if the database is missing these widths, they must NEVER go to T0.
        if abs(STRIP_WIDTH_NARROW - part_width) < 0.5:
            return float(STRIP_WIDTH_NARROW), DEFAULT_BOARD_T1_NARROW
        if abs(STRIP_WIDTH_WIDE - part_width) < 0.5:
            return float(STRIP_WIDTH_WIDE), DEFAULT_BOARD_T1_WIDE

        return None, None


    # Group parts by their required strip width
    strip_groups = defaultdict(list)
    rotated_count = 0

    for p in parts:
        part_width = p["Width"]
        part_height = p["Height"]

        # Strategy 1: exact match Width → inventory
        exact_w, exact_bt = find_exact_inv(part_width)
        if exact_w is not None:
            strip_groups[(exact_w, exact_bt, False)].append(p)
            continue

        # Strategy 2: rotation match — part Height matches inventory Width
        # After rotation: new Width = original Height, new Height = original Width
        # Condition: original Width (new Height after rotation) must fit in usable length
        rot_w, rot_bt = find_exact_inv(part_height)
        if rot_w is not None and part_width <= usable_length:
            # Rotate: swap Height ↔ Width
            rotated_part = {**p, "Height": part_width, "Width": part_height, "rotated": True}
            strip_groups[(rot_w, rot_bt, False)].append(rotated_part)
            rotated_count += 1
            continue

        # Strategy 3: No match → T0 custom-width cutting
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
    if rotated_count > 0:
        print(f"  🔄 Rotated {rotated_count} parts (Height matched inventory Width)")
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
        if bt is None:
            # Hard fallback for standard widths in case database is missing them
            if abs(sw - STRIP_WIDTH_NARROW) < 0.5:
                bt = DEFAULT_BOARD_T1_NARROW
            elif abs(sw - STRIP_WIDTH_WIDE) < 0.5:
                bt = DEFAULT_BOARD_T1_WIDE
            else:
                # Truly non-standard width → all go to T0
                t0_pool.append({
                    "strip_width": sw,
                    "parts": parts_for_strip,
                })
                continue

        # Ignore inventory quantity limits! If it's a standard T1 width, we ALWAYS cut it from T1 stock.
        # This matches the factory workflow: T1 parts are always cut from T1 stock, and T0 is only for custom widths.
        needed_strips = _count_strips_needed(parts_for_strip, sw)
        used_inventory[bt] = used_inventory.get(bt, 0) + needed_strips

        # All parts served from inventory (unlimited stock assumption)
        inventory_strips.append({
            "strip_width": sw,
            "board_type": sd["board_type"],
            "parts": parts_for_strip,
            "source": "inventory",
            "strips_used": needed_strips,
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
                   board_height: float = BOARD_HEIGHT,
                   color: str = DEFAULT_BOX_COLOR,
                   id_prefix: str | None = None) -> list:
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
    prefix = id_prefix if id_prefix is not None else f"{board_type}-{color}"
    for idx, strip in enumerate(open_strips, 1):
        parts_total_len = sum(p["Height"] for p in strip["parts"])
        parts_total_area = sum(p["Height"] * p["Width"] for p in strip["parts"])
        k = len(strip["parts"])
        kerf_total = (k - 1) * SAW_KERF if k > 1 else 0
        waste_area = (usable * strip_width) - parts_total_area - (kerf_total * strip_width)

        utilization = parts_total_area / strip_area if strip_area > 0 else 0

        results.append({
            "board_id": f"{prefix}-{idx:03d}",
            "board": board_type,
            "board_type": board_type,
            "board_size": f"{strip_width} × {board_height}",
            "strip_width": strip_width,
            "color": color,
            "parts": [
                {
                    "part_id": p["part_id"],
                    "Height": p["Height"],
                    "Width": p["Width"],
                    "cut_length": p["Height"],
                    "component": p.get("component", ""),
                    "cab_id": p.get("cab_id", ""),
                    "cab_type": p.get("cab_type", ""),
                    "color": p.get("color", color),
                    "rotated": p.get("rotated", False),
                    "auto_swapped": p.get("auto_swapped", False),
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
            "waste": round(waste_area, 1),
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
        waste_area = (usable * board_width) - parts_total_area - (kerf_total * board_width)
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
                    "auto_swapped": p.get("auto_swapped", False),
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
            "waste": round(waste_area, 1),
            "utilization": round(utilization, 4),
        })

    return results


# ─────────────────────────────────────────────
# Main Pipeline (v5 — Unified Naming + T0 Mixed Packing)
# ─────────────────────────────────────────────

def _validate_cut_result(output: dict, cabinet_breakdown: dict, total_parts_required: int, oversized_parts: list):
    """
    Append integrity issues to output["issues"]["integrity"]. Never raises.

    Checks:
      - PART_COUNT_MISMATCH     placed + oversized + unmatched != required
      - DUPLICATE_PART_ID       same part_id on multiple boards
      - INVALID_PART_DIM        Height <= 0 or Width <= 0
      - INVALID_BOARD_SIZE      board_size unparsable
      - T0_STRIP_OVERFLOW       t0_strip_position + strip_width > 1219.2
      - STRIP_LENGTH_OVERFLOW   trim + parts + kerf > usable_height
      - CABINET_PART_MISSING    expected part_id not rendered on any board
      - CABINET_PART_EXTRA      rendered part_id not in cabinet_breakdown
      - CABINET_DIM_MISMATCH    dims differ from breakdown (allow H↔W swap if auto_swapped)
      - CABINET_COUNT_MISMATCH  cab_id rendered count != breakdown count
    """
    import re
    issues = output.setdefault("issues", {})
    integrity: list = []

    boards = output.get("boards", [])

    # ── Part-level checks ──
    seen_ids: dict = {}
    rendered_by_cab: dict = {}
    rendered_by_id: dict = {}
    for b in boards:
        bid = b.get("board_id", "?")
        # board_size parsability
        bs = b.get("board_size", "")
        if not re.search(r"(\d+(?:\.\d+)?)\s*[×x*]\s*(\d+(?:\.\d+)?)", str(bs), re.IGNORECASE):
            integrity.append({
                "code": "INVALID_BOARD_SIZE",
                "severity": "warn",
                "msg": f"board_size unparsable on {bid}: {bs!r}",
                "ref": {"board_id": bid},
            })

        # T0 strip overflow
        tsp = b.get("t0_strip_position")
        sw = b.get("strip_width", 0) or 0
        if tsp is not None and (tsp + sw) > (1219.2 + 0.5):
            integrity.append({
                "code": "T0_STRIP_OVERFLOW",
                "severity": "error",
                "msg": f"{bid}: strip_position {tsp} + width {sw} exceeds T0 1219.2mm",
                "ref": {"board_id": bid, "t0_strip_position": tsp, "strip_width": sw},
            })

        # Strip length overflow
        tl = b.get("trim_loss", 0) or 0
        sk = b.get("saw_kerf", 0) or 0
        parts_sum = 0.0
        for p in b.get("parts", []):
            parts_sum += (p.get("cut_length") or p.get("Height") or 0)
        kerf_sum = max(0, (len(b.get("parts", [])) - 1)) * sk
        usable_len = (b.get("usable_length") or 0) or (BOARD_HEIGHT - tl)
        used_len = parts_sum + kerf_sum
        if used_len > usable_len + 0.5:
            integrity.append({
                "code": "STRIP_LENGTH_OVERFLOW",
                "severity": "error",
                "msg": f"{bid}: parts+kerf = {used_len:.1f} exceeds usable {usable_len:.1f} (trim {tl:.1f}mm already excluded)",
                "ref": {"board_id": bid},
            })

        for p in b.get("parts", []):
            pid = p.get("part_id", "?")
            h = p.get("Height", 0) or 0
            w = p.get("Width", 0) or 0
            if h <= 0 or w <= 0:
                integrity.append({
                    "code": "INVALID_PART_DIM",
                    "severity": "error",
                    "msg": f"part {pid} on {bid}: Height={h}, Width={w}",
                    "ref": {"board_id": bid, "part_id": pid},
                })
            if pid in seen_ids:
                integrity.append({
                    "code": "DUPLICATE_PART_ID",
                    "severity": "error",
                    "msg": f"part_id {pid} appears on both {seen_ids[pid]} and {bid}",
                    "ref": {"part_id": pid, "boards": [seen_ids[pid], bid]},
                })
            else:
                seen_ids[pid] = bid
            rendered_by_id[pid] = {
                "Height": h, "Width": w,
                "auto_swapped": bool(p.get("auto_swapped") or p.get("rotated")),
                "cab_id": p.get("cab_id"),
            }
            cab = p.get("cab_id")
            if cab:
                rendered_by_cab.setdefault(cab, []).append(pid)

    # ── Part count conservation ──
    placed = sum(len(b.get("parts", [])) for b in boards)
    oversized_n = len(oversized_parts or [])
    unmatched_n = len(output.get("issues", {}).get("unmatched_parts", []))
    expected = total_parts_required + oversized_n
    actual = placed + oversized_n + unmatched_n
    if actual != expected:
        integrity.append({
            "code": "PART_COUNT_MISMATCH",
            "severity": "error",
            "msg": f"expected {expected} parts (required {total_parts_required} + oversized {oversized_n}), got placed {placed} + unmatched {unmatched_n} + oversized {oversized_n} = {actual}",
            "ref": {"placed": placed, "unmatched": unmatched_n, "oversized": oversized_n, "required": total_parts_required},
        })

    # ── Cabinet-level reconciliation ──
    if cabinet_breakdown:
        for cab_id, cb in cabinet_breakdown.items():
            expected_parts = {pp["part_id"]: pp for pp in cb.get("parts", [])}
            rendered_ids = set(rendered_by_cab.get(cab_id, []))
            missing = set(expected_parts.keys()) - rendered_ids
            extra = rendered_ids - set(expected_parts.keys())

            for pid in sorted(missing):
                # Skip if this part is in oversized_parts (legitimately not placed)
                if any(o.get("part_id") == pid for o in (oversized_parts or [])):
                    continue
                integrity.append({
                    "code": "CABINET_PART_MISSING",
                    "severity": "error",
                    "msg": f"cab {cab_id}: part {pid} expected but not rendered",
                    "ref": {"cab_id": cab_id, "part_id": pid},
                })
            for pid in sorted(extra):
                integrity.append({
                    "code": "CABINET_PART_EXTRA",
                    "severity": "warn",
                    "msg": f"cab {cab_id}: part {pid} rendered but not in cabinet_breakdown",
                    "ref": {"cab_id": cab_id, "part_id": pid},
                })

            # Count check
            if cb.get("count", 0) != len(rendered_ids) and not missing and not extra:
                integrity.append({
                    "code": "CABINET_COUNT_MISMATCH",
                    "severity": "warn",
                    "msg": f"cab {cab_id}: breakdown count {cb.get('count')} != rendered {len(rendered_ids)}",
                    "ref": {"cab_id": cab_id},
                })

            # Dim check:
            # cabinet reconciliation cares about the final panel size, not the
            # cutting orientation. If Height/Width are an exact swap, treat it
            # as the same physical part and do not flag an integrity error.
            for pid in rendered_ids & set(expected_parts.keys()):
                exp = expected_parts[pid]
                got = rendered_by_id.get(pid, {})
                if not got:
                    continue
                eh, ew = exp.get("Height", 0), exp.get("Width", 0)
                gh, gw = got.get("Height", 0), got.get("Width", 0)
                match_direct = abs(eh - gh) < 0.5 and abs(ew - gw) < 0.5
                match_swapped = abs(eh - gw) < 0.5 and abs(ew - gh) < 0.5
                if match_direct:
                    continue
                if match_swapped:
                    continue
                integrity.append({
                    "code": "CABINET_DIM_MISMATCH",
                    "severity": "error",
                    "msg": f"cab {cab_id} part {pid}: expected {eh}×{ew}, got {gh}×{gw}",
                    "ref": {"cab_id": cab_id, "part_id": pid,
                            "expected": {"Height": eh, "Width": ew},
                            "actual": {"Height": gh, "Width": gw,
                                       "auto_swapped": got.get("auto_swapped", False)}},
                })

    if integrity:
        issues["integrity"] = integrity
        print(f"\n⚠️  Integrity validator: {len(integrity)} issue(s) detected")
        # Print a short digest
        codes = {}
        for it in integrity:
            codes[it["code"]] = codes.get(it["code"], 0) + 1
        for c, n in codes.items():
            print(f"   • {c}: {n}")


def _run_pipeline_for_color(parts: list, inventory: dict, color: str,
                            t0_id_offset: int = 0) -> dict:
    """Run STEP 1-5 of the cutting pipeline for a single color partition.

    inventory is the single-color view {board_type: info}.
    Returns a partial result dict with keys: boards, t0_plan, used_inventory,
    recovered_inventory, t0_sheets_used, t0_recovered_strips.
    """
    from agents.t0_optimizer import optimize_t0_from_strips, recover_leftover

    print(f"\n{'─' * 60}")
    print(f"  🎨 Color partition: {color}  ({len(parts)} parts)")
    print(f"{'─' * 60}")

    # 确定 T0 板的名字 (从库存获取)
    t0_name = DEFAULT_BOARD_T0
    if inventory:
        for bt_inv in inventory.keys():
            if bt_inv.startswith("T0"):
                t0_name = bt_inv
                break

    # ─── STEP 1: Build strip demand ───
    strip_demand = build_strip_demand(parts, inventory)

    # ─── STEP 2: Apply inventory ───
    inv_result = apply_inventory(strip_demand, inventory)
    used_inventory = inv_result["used_inventory"]
    t0_pool = inv_result["t0_pool"]
    inventory_strips = inv_result["inventory_strips"]

    # ─── STEP 3: T0 unified mixed-strip optimization ───
    t0_strip_items = []
    t0_parts_by_width = {}

    for pool_entry in t0_pool:
        sw = pool_entry["strip_width"]
        pool_parts = pool_entry["parts"]
        if sw not in t0_parts_by_width:
            t0_parts_by_width[sw] = []
        t0_parts_by_width[sw].extend(pool_parts)
        count = _count_strips_needed(pool_parts, sw)
        for _ in range(count):
            t0_strip_items.append({
                "strip_width": sw,
                "strip_label": t0_name,
                "strip_type": "T0",
            })

    t0_plan = None
    if t0_strip_items:
        t0_plan = optimize_t0_from_strips(t0_strip_items)

        # Re-key sheet_id with color + offset to ensure global uniqueness
        for s_idx, sheet in enumerate(t0_plan["t0_sheets"]):
            sheet["sheet_id"] = f"{t0_name}-{color}-{t0_id_offset + s_idx + 1:03d}"
            sheet["color"] = color

        # ─── STEP 4: Recover leftover from T0 sheets ───
        recovery_candidates = []
        for bt, info in inventory.items():
            if bt.startswith("T0"):
                continue
            if info.get("Height", 0) + 1e-3 < BOARD_HEIGHT:
                continue
            w = float(info.get("Width", 0))
            if w <= 0:
                continue
            recovery_candidates.append({"board_type": bt, "width": w})
        recovery_candidates.sort(key=lambda c: -c["width"])
        if recovery_candidates:
            cand_desc = ", ".join(f"{c['board_type']}={c['width']}mm" for c in recovery_candidates)
            print(f"  ♻️  Recovery candidates ({color}): {cand_desc}")

        for sheet in t0_plan["t0_sheets"]:
            recover_leftover(sheet, recovery_candidates)
            for r in sheet.get("recovered_strips", []):
                r["color"] = color

    # ─── STEP 4b: Build T0 sheet → strip mapping for frontend ───
    t0_width_assignments = defaultdict(list)
    if t0_plan:
        for sheet in t0_plan["t0_sheets"]:
            all_strips_info = [
                {"strip_width": s["strip_width"], "strip_index": si}
                for si, s in enumerate(sheet["strips"])
            ]
            x_pos = 0.0
            for s_idx, strip in enumerate(sheet["strips"]):
                sw = strip["strip_width"]
                t0_width_assignments[sw].append({
                    "sheet_id": sheet["sheet_id"],
                    "strip_index": s_idx,
                    "x_position": round(x_pos, 1),
                    "total_strips": len(sheet["strips"]),
                    "sheet_utilization": sheet["utilization"],
                    "all_strips": all_strips_info,
                    "remaining_width": round(sheet.get("remaining_width", 0), 1),
                })
                x_pos += sw + SAW_KERF

    # ─── STEP 5: Pack parts into strips ───
    all_board_results = []

    for inv_strip in inventory_strips:
        results = ffd_strip_pack(
            inv_strip["parts"],
            inv_strip["strip_width"],
            inv_strip["board_type"],
            color=color,
        )
        for r in results:
            r["source"] = "inventory"
        all_board_results.extend(results)

    for sw, t0_parts in t0_parts_by_width.items():
        results = ffd_strip_pack(
            t0_parts,
            sw,
            t0_name,
            color=color,
            id_prefix=f"{t0_name}-{color}-{sw}",
        )
        assignments = t0_width_assignments.get(sw, [])
        for i, r in enumerate(results):
            r["source"] = "T0"
            r["actual_strip_width"] = sw
            if i < len(assignments):
                a = assignments[i]
                r["t0_sheet_id"] = a["sheet_id"]
                r["t0_sheet_index"] = a["strip_index"]
                r["t0_strip_position"] = a["x_position"]
                r["t0_total_strips_on_sheet"] = a["total_strips"]
                r["t0_sheet_utilization"] = a["sheet_utilization"]
                r["t0_all_strips"] = a["all_strips"]
                r["t0_remaining_width"] = a["remaining_width"]
        all_board_results.extend(results)

    t0_sheets_used = t0_plan["t0_sheets_needed"] if t0_plan else 0
    t0_total_recovery = 0
    recovered_inventory = []
    if t0_plan:
        for sheet in t0_plan["t0_sheets"]:
            for r in sheet.get("recovered_strips", []):
                t0_total_recovery += 1
                recovered_inventory.append(r)

    # Fix t0_sheet_utilization for each strip based on parts area + recovered area
    sheet_to_parts_area = defaultdict(float)
    sheet_to_recovered_area = defaultdict(float)
    if t0_plan:
        for sheet in t0_plan["t0_sheets"]:
            sheet_to_recovered_area[sheet["sheet_id"]] = sum(
                r["width"] * 2438.4 for r in sheet.get("recovered_strips", [])
            )
    for b in all_board_results:
        if "t0_sheet_id" in b:
            sheet_to_parts_area[b["t0_sheet_id"]] += b["parts_total_area"]
    for b in all_board_results:
        if "t0_sheet_id" in b:
            t0_area = 1219.2 * 2438.4
            b["t0_sheet_utilization"] = round(
                (sheet_to_parts_area[b["t0_sheet_id"]] + sheet_to_recovered_area[b["t0_sheet_id"]]) / t0_area, 4
            )

    return {
        "boards": all_board_results,
        "t0_plan": t0_plan,
        "used_inventory": used_inventory,
        "recovered_inventory": recovered_inventory,
        "t0_sheets_used": t0_sheets_used,
        "t0_recovered_strips": t0_total_recovery,
        "color": color,
    }


def run_engine(parts_path: str, inventory_path: str = None, output_path: str = "output/cut_result.json", cabinet_breakdown: dict = None):
    """
    Full engine run — v5 unified naming + real factory flow + per-color partition:

      parts → split by color → (per color: strip_demand → apply_inventory →
        T0 mixed optimize → recover leftover → strip-level part packing)
        → merge results

    Cutting is strictly partitioned by box color. T0 sheets and inventory
    are never shared across colors.
    """
    print("=" * 60)
    print("  Guillotine Cutting Engine v5 — Per-Color Pipeline")
    print("=" * 60)

    # ─── Load data ───
    parts, skipped_rows = load_parts(parts_path)
    inventory_per_color = load_inventory(inventory_path)
    if not inventory_per_color:
        raise RuntimeError("Inventory is empty")

    # ─── 检测超板零件 (跨颜色,T0 dim 假设各色一致) ───
    usable_height = BOARD_HEIGHT - TRIM_LOSS  # 2433.4mm
    max_board_width = 1219.2
    for color, boards in inventory_per_color.items():
        for bt, info in boards.items():
            if bt.startswith("T0"):
                max_board_width = info["Width"]
                break

    valid_parts = []
    oversized_parts = []
    for p in parts:
        h, w = p["Height"], p["Width"]
        fits_normal = (w <= max_board_width and h <= usable_height)
        fits_rotated = (h <= max_board_width and w <= usable_height)
        if fits_normal:
            valid_parts.append(p)
        elif fits_rotated:
            p["Height"] = w
            p["Width"] = h
            p["auto_swapped"] = True
            valid_parts.append(p)
        else:
            oversized_parts.append(p)

    if oversized_parts:
        print(f"\n❌ 发现 {len(oversized_parts)} 个超板零件 (板材极限: {max_board_width}×{BOARD_HEIGHT}mm):")
        for op in oversized_parts:
            cab = op.get('cab_id', '?')
            comp = op.get('component', '?')
            color = op.get('color', '?')
            print(f"   ⛔ {cab}-{comp} [{color}]: {op['Height']} × {op['Width']}mm — 无法裁切!")

    parts = valid_parts

    # ─── Per-color pipeline ───
    parts_by_color: dict = defaultdict(list)
    for p in parts:
        parts_by_color[p.get("color", DEFAULT_BOX_COLOR)].append(p)

    template_inventory = (
        inventory_per_color.get(DEFAULT_BOX_COLOR)
        or next(iter(inventory_per_color.values()), {})
    )

    all_board_results = []
    aggregated_t0_sheets = []
    aggregated_recovered = []
    unmatched_parts = []
    used_inventory: dict = {}
    inventory_used_by_color: dict = {}
    by_color: dict = {}
    t0_id_offset = 0

    for color, color_parts in parts_by_color.items():
        actual_color_inventory = inventory_per_color.get(color, {})
        if not actual_color_inventory:
            print(f"\n⚠️  No inventory rows configured for color '{color}'. Generating cut plan with stock=0 and reporting shortage.")

        color_inventory = {
            bt: {
                **info,
                "qty": int(actual_color_inventory.get(bt, {}).get("qty", 0)),
                "color": color,
            }
            for bt, info in template_inventory.items()
        }
        for bt, info in actual_color_inventory.items():
            color_inventory[bt] = {**info, "color": color}
        inventory_per_color[color] = color_inventory

        partial = _run_pipeline_for_color(
            color_parts,
            color_inventory,
            color,
            t0_id_offset=t0_id_offset,
        )
        all_board_results.extend(partial["boards"])
        if partial["t0_plan"]:
            aggregated_t0_sheets.extend(partial["t0_plan"]["t0_sheets"])
            t0_id_offset += partial["t0_plan"]["t0_sheets_needed"]
        aggregated_recovered.extend(partial["recovered_inventory"])

        # Used inventory: namespace by color to avoid collisions when same
        # board_type exists for multiple colors.
        for bt, cnt in partial["used_inventory"].items():
            key = f"{bt}|{color}"
            used_inventory[key] = used_inventory.get(key, 0) + cnt
            inventory_used_by_color.setdefault(color, {})[bt] = (
                inventory_used_by_color.setdefault(color, {}).get(bt, 0) + cnt
            )

        # Per-color summary
        c_boards = partial["boards"]
        c_parts_placed = sum(len(b["parts"]) for b in c_boards)
        c_parts_area = sum(b["parts_total_area"] for b in c_boards)
        c_t0_used = partial["t0_sheets_used"]
        c_t1_area = sum(b["board_area"] for b in c_boards if b.get("source") == "inventory")
        c_total_area = c_t0_used * (1219.2 * 2438.4) + c_t1_area
        c_util = c_parts_area / c_total_area if c_total_area > 0 else 0
        by_color[color] = {
            "parts_total": len(color_parts),
            "total_parts_placed": c_parts_placed,
            "parts_placed": c_parts_placed,
            "boards_used": len(c_boards),
            "t0_sheets_used": c_t0_used,
            "t0_recovered_strips": partial["t0_recovered_strips"],
            "overall_utilization": round(c_util, 4),
        }

    # ─── Aggregate summary across all colors ───
    total_boards = len(all_board_results)
    total_parts_required = len(parts)
    total_parts_placed = sum(len(b["parts"]) for b in all_board_results)
    total_parts_unmatched = len(unmatched_parts) + max(0, total_parts_required - total_parts_placed - len(unmatched_parts))
    total_oversized = len(oversized_parts)
    all_parts_cut = (total_parts_placed == total_parts_required) and total_oversized == 0

    t0_sheets_used = len(aggregated_t0_sheets)
    t0_total_area = t0_sheets_used * (1219.2 * 2438.4)
    t1_inv_area = sum(b["board_area"] for b in all_board_results if b.get("source") == "inventory")
    total_board_area = t0_total_area + t1_inv_area
    total_parts_area = sum(b["parts_total_area"] for b in all_board_results)

    total_recovered_area = sum(r["width"] * 2438.4 for r in aggregated_recovered)
    t0_total_recovery = len(aggregated_recovered)

    overall_useful_area = total_parts_area + total_recovered_area
    overall_util = overall_useful_area / total_board_area if total_board_area > 0 else 0
    total_kerf_area = sum(
        (b["cuts"] * SAW_KERF) * b.get("actual_strip_width", b.get("strip_width", 1219.2))
        for b in all_board_results
    )
    total_waste_area = total_board_area - overall_useful_area - total_kerf_area

    # Board type breakdown (by board_type only, not color)
    board_type_counts = defaultdict(int)
    for b in all_board_results:
        board_type_counts[b["board"]] += 1

    # Inventory shortage per (board_type, color)
    inventory_shortage = []
    for color, color_used in inventory_used_by_color.items():
        color_inv = inventory_per_color.get(color, {})
        for bt, used_cnt in color_used.items():
            stock = color_inv.get(bt, {}).get("qty", 0)
            if used_cnt > stock:
                inventory_shortage.append({
                    "board_type": bt,
                    "color": color,
                    "needed": used_cnt,
                    "stock": stock,
                    "shortage": used_cnt - stock,
                })
    if inventory_shortage:
        print(f"\n⚠️  库存不足:")
        for s in inventory_shortage:
            print(f"   {s['board_type']} [{s['color']}]: 需要 {s['needed']}张, 库存 {s['stock']}张, 缺少 {s['shortage']}张")

    summary = {
        "total_parts_required": total_parts_required,
        "total_parts_placed": total_parts_placed,
        "total_parts_unmatched": total_parts_unmatched,
        "all_parts_cut": all_parts_cut,
        "strips_used": total_boards,
        "boards_used": total_boards,
        "t0_sheets_used": t0_sheets_used,
        "t0_recovered_strips": t0_total_recovery,
        "inventory_used": used_inventory,
        "inventory_shortage": inventory_shortage,
        "board_type_breakdown": dict(board_type_counts),
        "by_color": by_color,
        "total_parts_length": round(sum(b["parts_total_length"] for b in all_board_results), 1),
        "total_trim_loss": round(sum(b["trim_loss"] for b in all_board_results), 1),
        "total_kerf_loss": round(sum(b["kerf_total"] for b in all_board_results), 1),
        "total_waste": round(total_waste_area, 1),
        "overall_utilization": round(overall_util, 4),
        "config_trim_loss_mm": TRIM_LOSS,
        "config_saw_kerf_mm": SAW_KERF,
    }
    recovered_inventory = aggregated_recovered

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
            "color": p.get("color", DEFAULT_BOX_COLOR),
            "reason": f"尺寸 {p['Height']}×{p['Width']}mm 超过板材最大尺寸 {BOARD_HEIGHT}mm",
        }
        for p in oversized_parts
    ]
    issues = {
        "skipped_rows": [
            {"file": "parts.xlsx", "source": f"Row {s['row']}: {s['reason']}"}
            for s in skipped_rows
        ],
        "unmatched_parts": [
            {
                "part_id": p.get("part_id", "?"),
                "cab_id": p.get("cab_id", "?"),
                "component": p.get("component", "?"),
                "Height": p.get("Height"),
                "Width": p.get("Width"),
                "color": p.get("color", DEFAULT_BOX_COLOR),
                "reason": p.get("_unmatched_reason", "part could not be placed"),
            }
            for p in unmatched_parts
        ],
        "oversized_parts": oversized_issues,
    }

    # ─── Output JSON ───
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    output = {
        "summary": summary,
        "issues": issues,
        "boards": all_board_results,
    }

    # Add aggregated T0 plan details if present
    if aggregated_t0_sheets:
        output["t0_plan"] = {
            "t0_sheets_needed": len(aggregated_t0_sheets),
            "t0_sheets": aggregated_t0_sheets,
            "total_utilization": round(
                sum(float(s.get("utilization", 0)) for s in aggregated_t0_sheets) / len(aggregated_t0_sheets),
                4,
            ),
            "by_color": {
                color: {
                    "t0_sheets_needed": data.get("t0_sheets_used", 0),
                    "t0_recovered_strips": data.get("t0_recovered_strips", 0),
                }
                for color, data in by_color.items()
                if data.get("t0_sheets_used", 0) > 0
            },
        }

    # Add recovered inventory
    if recovered_inventory:
        output["recovered_inventory"] = recovered_inventory

    # Attach cabinet breakdown for downstream reconciliation
    if cabinet_breakdown:
        output["cabinet_breakdown"] = cabinet_breakdown

    # Integrity validation — appends to issues, never raises
    _validate_cut_result(output, cabinet_breakdown, total_parts_required, oversized_parts)

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
    if aggregated_t0_sheets:
        t0_util = output["t0_plan"].get("total_utilization", 0)
        print(f"  T0 utilization:  {t0_util*100:.1f}%")
    print(f"  T0 recovered:    {t0_total_recovery} strips")
    if recovered_inventory:
        for r in recovered_inventory:
            print(f"    ♻️ {r['label']} ({r['width']}mm) → {r['board_type']}")
    print(f"  Inventory used:  {used_inventory}")
    print(f"  Total strips:    {total_boards}")
    print(f"  Utilization:     {overall_util*100:.1f}%")
    print(f"  Total waste:     {total_waste_area:.1f}mm²")
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
