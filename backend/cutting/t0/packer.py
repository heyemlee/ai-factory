"""
T0 unified mixed-strip optimization (FFD bin packing).

Receives any-width strip list and packs them onto T0 raw sheets,
mixing widths together to minimize sheet count.
"""

from config.board_config_loader import BOARD_CFG

T0_WIDTH  = BOARD_CFG.T0_WIDTH
T0_HEIGHT = BOARD_CFG.T0_HEIGHT
T0_TRIM   = BOARD_CFG.T0_TRIM
SAW_KERF  = BOARD_CFG.SAW_KERF

BOARD_T0_RAW = BOARD_CFG.BOARD_T0_RAW


def optimize_t0_from_strips(strip_items: list) -> dict:
    """
    Unified T0 mixed-strip optimization using FFD bin packing.

    Accepts ANY width strips — all mixed together on T0 sheets.
    e.g.: 876.3 + 304.8 → one T0 sheet (util 96.9%)

    Args:
        strip_items: list of dicts, each with:
            - strip_width: float (e.g. 304.8, 609.6, 876.3, etc.)
            - strip_label: str (should be "T0-RAW" for all)
            - strip_type: str ("T0" for all)

    Returns:
        dict with:
            - t0_sheets_needed: int
            - t0_sheets: list of sheet dicts
            - total_waste_mm: float
            - total_utilization: float
    """
    if not strip_items:
        return {
            "t0_sheets_needed": 0,
            "t0_sheets": [],
            "total_waste_mm": 0,
            "total_utilization": 0,
        }

    # FFD: sort strips by width descending (biggest first)
    sorted_items = sorted(strip_items, key=lambda x: x["strip_width"], reverse=True)

    # 长边两侧扫边: 沿 1219.2 方向各扣 T0_TRIM
    usable_width = T0_WIDTH - 2 * T0_TRIM

    # Validate: no single strip exceeds usable width
    for item in sorted_items:
        if item["strip_width"] > usable_width:
            print(f"  ⚠️ Strip width {item['strip_width']}mm "
                  f"> T0 usable {usable_width}mm, cannot fit!")

    # Filter out oversized
    valid_items = [x for x in sorted_items if x["strip_width"] <= usable_width]

    open_sheets = []  # each: {remaining, strips, cut_count}

    # True mixed-width FFD: all valid strips compete for the same open T0 sheets.
    for item in valid_items:
        sw = item["strip_width"]
        placed = False
        for sheet in open_sheets:
            needed = sw + SAW_KERF
            if sheet["remaining"] >= needed:
                sheet["strips"].append(item)
                sheet["remaining"] -= needed
                sheet["cut_count"] += 1
                placed = True
                break
        if not placed:
            open_sheets.append({
                "remaining": usable_width - sw,
                "strips": [item],
                "cut_count": 1,
            })

    # Build results
    t0_sheets = []
    total_waste = 0.0
    total_used_width = 0.0

    for idx, sheet in enumerate(open_sheets, 1):
        strips_total_width = sum(s["strip_width"] for s in sheet["strips"])
        kerf_count = len(sheet["strips"]) - 1
        kerf_loss = kerf_count * SAW_KERF if kerf_count > 0 else 0
        waste_width = sheet["remaining"]
        total_waste += waste_width
        total_used_width += strips_total_width

        # 2D area utilization
        t0_area = T0_WIDTH * T0_HEIGHT
        used_area = sum(s["strip_width"] * T0_HEIGHT for s in sheet["strips"])
        utilization = used_area / t0_area if t0_area > 0 else 0

        strip_details = []
        # 使用第一个条料的标签作为板的名字
        main_label = sheet["strips"][0].get("strip_label", BOARD_T0_RAW)

        for s in sheet["strips"]:
            label = s.get("strip_label", BOARD_T0_RAW)
            strip_details.append({
                "strip_width": s["strip_width"],
                "width": s["strip_width"],           # legacy compatibility
                "strip_label": label,
                "board_type": label,
                "strip_type": "T0",
                "height": T0_HEIGHT,
            })

        t0_sheets.append({
            "sheet_id": f"{main_label}-{idx:03d}",
            "t0_size": f"{T0_WIDTH} × {T0_HEIGHT}",
            "strips": strip_details,
            "strip_widths": [s["strip_width"] for s in sheet["strips"]],
            "strip_count": len(strip_details),
            "strips_total_width": round(strips_total_width, 1),
            "kerf_loss": round(kerf_loss, 1),
            "trim_loss": T0_TRIM,
            "waste_width": round(waste_width, 1),
            "remaining_width": round(waste_width, 1),
            "utilization": round(utilization, 4),
            "recovered_strips": [],  # filled by recover_leftover()
        })

    total_t0_area = len(t0_sheets) * T0_WIDTH * T0_HEIGHT
    total_strip_area = total_used_width * T0_HEIGHT
    overall_util = total_strip_area / total_t0_area if total_t0_area > 0 else 0

    result = {
        "t0_sheets_needed": len(t0_sheets),
        "t0_sheets": t0_sheets,
        "total_waste_mm": round(total_waste, 1),
        "total_utilization": round(overall_util, 4),
    }

    print(f"\n── STEP 3: T0 Mixed Optimization ──")
    print(f"  Total strips to pack: {len(valid_items)}")
    print(f"  T0 sheets needed:     {result['t0_sheets_needed']}")
    print(f"  T0 utilization:       {overall_util*100:.1f}%")
    for sheet in t0_sheets:
        widths_desc = " + ".join(f"{w}mm" for w in sheet["strip_widths"])
        print(f"  {sheet['sheet_id']}: [{widths_desc}] "
              f"| remain: {sheet['remaining_width']}mm "
              f"| util: {sheet['utilization']*100:.1f}%")

    return result
