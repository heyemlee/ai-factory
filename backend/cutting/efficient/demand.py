"""
STEP 1 & 2 of the efficient cutting pipeline:

  STEP 1: build_strip_demand   — convert parts to strip demands
  STEP 2: apply_inventory      — deduct T1 stock; remainder → T0 pool

Includes the FFD strip-counting helpers used by apply_inventory.
"""

from collections import defaultdict

from .constants import (
    BOARD_HEIGHT,
    DEFAULT_BOARD_T0,
    DEFAULT_BOARD_T1_NARROW,
    DEFAULT_BOARD_T1_WIDE,
    SAW_KERF,
    STRIP_WIDTH_NARROW,
    STRIP_WIDTH_WIDE,
)
from .primitives import _cut_length, _cut_width, strip_usable_height


def build_strip_demand(parts: list, inventory: dict = None, force_t0_start: bool = False) -> list:
    """
    Convert all parts into strip demands based on actual saw-cut width.

    ⚠️ 扫边规则: 所有 Height=2438.4mm 的库存板材(t0,t1), 拿到手第一下
       扫边 5mm (Height方向, 单边, 只扫一次)
       - 2438.4mm → 可用长度 2433.4mm
       - Width 方向不扫边
       - 未来回收/剩余板材不需要再扫 (已经扫过)

    Strategy (优先精确匹配库存):
      1. 先查库存: 精确匹配 Width (±0.5mm 容差)
         e.g.: Width=101.6 → T1-101.6x2438.4 (库存有就用)
      2. 旋转匹配: 零件 Height 精确匹配库存 Width (±0.5mm)
         且旋转后原 Width 作为新 Height ≤ 物理板长 (2438.4mm)
         e.g.: Height=303.8, Width=600 → 旋转后 Width=303.8 匹配 T1-303.8
      3. 没有精确匹配 → T0 裁切

    Returns:
      list of strip demand dicts
    """
    # Rotation feasibility uses the physical board length: a 96″ part can still
    # fit by skipping the short-edge trim on its strip.
    usable_length = float(BOARD_HEIGHT)

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
        part_width = _cut_width(p)
        part_height = _cut_length(p)

        if force_t0_start:
            t0_name = DEFAULT_BOARD_T0
            if inventory:
                for bt_inv in inventory.keys():
                    if bt_inv.startswith("T0"):
                        t0_name = bt_inv
                        break
            strip_groups[(round(part_width, 1), t0_name, True)].append(p)
            continue

        # Strategy 1: exact match Width → inventory
        exact_w, exact_bt = find_exact_inv(part_width)
        if exact_w is not None:
            strip_groups[(exact_w, exact_bt, False)].append(p)
            continue

        # Strategy 2: rotation match — part Height matches inventory Width
        # After rotation: new Width = original Height, new Height = original Width
        # Condition: original cut Width (new cut Height after rotation) must fit in usable length
        rot_w, rot_bt = find_exact_inv(part_height)
        if rot_w is not None and part_width <= usable_length:
            # Rotate: swap Height ↔ Width (cut dims rotate with them)
            rotated_part = {
                **p,
                "Height": p["Width"],
                "Width": p["Height"],
                "cut_length": part_width,
                "cut_width": part_height,
                "rotated": True,
            }
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


def apply_inventory(strip_demand: list, inventory: dict, force_t0_start: bool = False) -> dict:
    """
    Use existing T1 inventory to satisfy strip demand.
    Inventory covers configured T1/common-width strips up to real stock quantity.
    Custom/oversize strips, shortages, and force-T0-start orders go to T0 pool.

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

        if force_t0_start or sd["needs_t0"]:
            # T0 Start / 超宽零件 → 必须 T0 裁切, 直接进 t0_pool
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

        needed_strips = _count_strips_needed(parts_for_strip, sw)
        available = int((board_info or {}).get("qty", 0))

        if available >= needed_strips:
            used_inventory[bt] = used_inventory.get(bt, 0) + needed_strips
            inventory_strips.append({
                "strip_width": sw,
                "board_type": bt,
                "parts": parts_for_strip,
                "source": "inventory",
                "strips_used": needed_strips,
            })
            continue

        if available > 0:
            inv_parts, overflow_parts = _split_parts_for_strips(parts_for_strip, sw, available)
            inv_used = _count_strips_needed(inv_parts, sw) if inv_parts else 0
            if inv_parts:
                used_inventory[bt] = used_inventory.get(bt, 0) + inv_used
                inventory_strips.append({
                    "strip_width": sw,
                    "board_type": bt,
                    "parts": inv_parts,
                    "source": "inventory",
                    "strips_used": inv_used,
                })
            if overflow_parts:
                t0_pool.append({
                    "strip_width": sw,
                    "parts": overflow_parts,
                })
            continue

        t0_pool.append({
            "strip_width": sw,
            "parts": parts_for_strip,
        })

    print(f"\n── STEP 2: Inventory Applied ──")
    if force_t0_start:
        print("  🔶 T0 Start: existing T1 inventory ignored for this run")
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
    sorted_parts = sorted(parts, key=_cut_length, reverse=True)

    strips = []  # each is remaining length

    for p in sorted_parts:
        cl = _cut_length(p)
        placed = False
        for i, remaining in enumerate(strips):
            needed = cl + SAW_KERF
            if remaining >= needed:
                strips[i] -= needed
                placed = True
                break
        if not placed:
            # New strip: first part no kerf; usable depends on whether this
            # part forces skipping short-edge trim.
            usable = strip_usable_height([p])
            strips.append(usable - cl)

    return len(strips)


def _split_parts_for_strips(parts: list, strip_width: float, max_strips: int):
    """
    Pack parts into max_strips strips using FFD.
    Returns (parts_in_strips, parts_remaining).
    """
    sorted_parts = sorted(parts, key=_cut_length, reverse=True)

    strips = []  # list of {remaining, parts}
    overflow = []

    for p in sorted_parts:
        cl = _cut_length(p)
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
                usable = strip_usable_height([p])
                strips.append({"remaining": usable - cl, "parts": [p]})
            else:
                overflow.append(p)

    inv_parts = []
    for s in strips:
        inv_parts.extend(s["parts"])

    return inv_parts, overflow
