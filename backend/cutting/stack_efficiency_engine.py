"""
Stack-efficiency cutting engine.

This engine is intentionally separate from cutting_engine.py. It optimizes for
repeatable stack cuts before material utilization:

1. T1 is used only when cut_width exactly matches 303.8 or 608.6.
2. Production is staged: rip T0 standard-width strips first, then length-cut
   standard strips together with matching T1 inventory as one stack pool.
3. T0 Sheet mode ignores existing T1; standard-width strips cut from T0 serve
   the current order first. Extra standard strips are recovered to inventory.
4. T0 recovery uses only 303.8 and 608.6 widths.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from typing import Any

from config.board_config_loader import BOARD_CFG
from cutting.cutting_engine import DEFAULT_BOX_COLOR, _validate_cut_result, load_inventory, load_parts


T0_WIDTH = 1219.2
BOARD_HEIGHT = 2438.4
SAW_KERF = float(BOARD_CFG.SAW_KERF)
STANDARD_NARROW = 303.8
STANDARD_WIDE = 608.6
STANDARD_WIDTHS = (STANDARD_NARROW, STANDARD_WIDE)
MAX_STACK = 4

FALLBACK_T0 = "T0-1219.2x2438.4"
FALLBACK_T1_BY_WIDTH = {
    STANDARD_NARROW: "T1-303.8x2438.4",
    STANDARD_WIDE: "T1-608.6x2438.4",
}


def _r1(value: float) -> float:
    return round(float(value), 1)


def _cut_length(part: dict) -> float:
    return float(part.get("cut_length") or part.get("Height") or 0)


def _cut_width(part: dict) -> float:
    return float(part.get("cut_width") or part.get("Width") or 0)


def _is_standard_width(width: float) -> bool:
    return _r1(width) in STANDARD_WIDTHS


def _standard_board_type(width: float, inventory: dict) -> str:
    target = _r1(width)
    for board_type, info in inventory.items():
        if str(board_type).upper().startswith("T0"):
            continue
        if _r1(info.get("Width", 0)) == target:
            return board_type
    return FALLBACK_T1_BY_WIDTH[target]


def _t0_board_type(inventory: dict) -> str:
    for board_type, info in inventory.items():
        if str(board_type).upper().startswith("T0") or _r1(info.get("Width", 0)) == _r1(T0_WIDTH):
            return board_type
    return FALLBACK_T0


def _inventory_stock_for_width(width: float, inventory: dict) -> tuple[str, int]:
    target = _r1(width)
    board_type = _standard_board_type(target, inventory)
    for candidate, info in inventory.items():
        if str(candidate).upper().startswith("T0"):
            continue
        if _r1(info.get("Width", 0)) == target:
            return candidate, int(info.get("qty", 0))
    return board_type, 0


def _t0_stock(inventory: dict) -> tuple[str, int]:
    board_type = _t0_board_type(inventory)
    for candidate, info in inventory.items():
        if candidate == board_type:
            return candidate, int(info.get("qty", 0))
    return board_type, 0


def _normalize_part(part: dict, color: str) -> dict:
    return {
        "part_id": part["part_id"],
        "Height": part["Height"],
        "Width": part["Width"],
        "cut_length": part.get("cut_length", part["Height"]),
        "cut_width": part.get("cut_width", part["Width"]),
        "component": part.get("component", ""),
        "cab_id": part.get("cab_id", ""),
        "cab_type": part.get("cab_type", ""),
        "color": part.get("color", color),
        "rotated": part.get("rotated", False),
        "auto_swapped": part.get("auto_swapped", False),
    }


def _parts_fit_or_rotate(parts: list[dict], trim_loss: float) -> tuple[list[dict], list[dict]]:
    usable_width = T0_WIDTH - 2 * trim_loss
    valid: list[dict] = []
    oversized: list[dict] = []

    for part in parts:
        width = _cut_width(part)
        length = _cut_length(part)
        if width <= usable_width + 1e-6 and length <= BOARD_HEIGHT + 1e-6:
            valid.append(part)
            continue

        # Rotation is only a physical rescue path. Width matching for T1 still
        # uses the final cut_width after this step.
        if length <= usable_width + 1e-6 and width <= BOARD_HEIGHT + 1e-6:
            rotated = {
                **part,
                "Height": part["Width"],
                "Width": part["Height"],
                "cut_length": width,
                "cut_width": length,
                "rotated": True,
                "auto_swapped": True,
            }
            valid.append(rotated)
            continue

        oversized.append(part)

    return valid, oversized


def _strip_capacity(cut_length: float, trim_loss: float) -> tuple[int, bool, float]:
    usable = BOARD_HEIGHT - 2 * trim_loss
    if cut_length > usable + 1e-6:
        if cut_length <= BOARD_HEIGHT + 1e-6:
            return 1, True, BOARD_HEIGHT
        return 0, False, usable
    capacity = int((usable + SAW_KERF) // (cut_length + SAW_KERF))
    return max(1, capacity), False, usable


def _build_stack_first_strips(parts: list[dict], strip_width: float, color: str, trim_loss: float) -> list[dict]:
    """Pack same-width parts into strips, grouping same cut lengths first."""
    by_length: dict[float, list[dict]] = defaultdict(list)
    for part in parts:
        by_length[_r1(_cut_length(part))].append(part)

    strips: list[dict] = []
    for cut_length in sorted(by_length.keys(), reverse=True):
        queue = list(by_length[cut_length])
        capacity, no_trim, usable_length = _strip_capacity(cut_length, trim_loss)
        if capacity <= 0:
            continue
        while queue:
            take = min(capacity, len(queue))
            strip_parts = queue[:take]
            queue = queue[take:]
            strips.append({
                "strip_width": _r1(strip_width),
                "parts": strip_parts,
                "color": color,
                "no_trim": no_trim,
                "usable_length": usable_length,
                "pattern_key": f"{_r1(strip_width)}|{cut_length}|{take}",
            })
    return strips


def _board_from_strip(strip: dict, board_type: str, source: str, index: int, trim_loss: float) -> dict:
    strip_width = _r1(strip["strip_width"])
    no_trim = bool(strip.get("no_trim"))
    effective_trim = 0 if no_trim else trim_loss
    effective_usable = BOARD_HEIGHT if no_trim else BOARD_HEIGHT - 2 * trim_loss
    parts = strip["parts"]
    parts_total_len = sum(_cut_length(part) for part in parts)
    parts_total_area = sum(_cut_length(part) * _cut_width(part) for part in parts)
    kerf_total = max(0, len(parts) - 1) * SAW_KERF
    strip_area = strip_width * BOARD_HEIGHT
    waste_area = effective_usable * strip_width - parts_total_area - kerf_total * strip_width
    color = strip.get("color", DEFAULT_BOX_COLOR)
    prefix = f"{board_type}-{color}-{strip_width}"

    board = {
        "board_id": f"{prefix}-{index:03d}",
        "board": board_type,
        "board_type": board_type,
        "board_size": f"{strip_width} × {BOARD_HEIGHT}",
        "strip_width": strip_width,
        "rip_width": strip_width,
        "color": color,
        "parts": [_normalize_part(part, color) for part in parts],
        "trim_loss": effective_trim,
        "saw_kerf": SAW_KERF,
        "cuts": len(parts),
        "parts_total_length": round(parts_total_len, 1),
        "parts_total_area": round(parts_total_area, 1),
        "board_area": round(strip_area, 1),
        "kerf_total": round(kerf_total, 1),
        "usable_length": round(effective_usable, 1),
        "waste": round(waste_area, 1),
        "utilization": round(parts_total_area / strip_area if strip_area > 0 else 0, 4),
        "source": source,
    }

    if source == "T0":
        board["actual_strip_width"] = strip_width
        for key in (
            "t0_sheet_id",
            "t0_sheet_index",
            "t0_strip_position",
            "t0_total_strips_on_sheet",
            "t0_sheet_utilization",
            "t0_all_strips",
            "t0_remaining_width",
        ):
            if key in strip:
                board[key] = strip[key]

    return board


def _recovery_options_for_inventory(inventory: dict) -> dict[float, str]:
    options: dict[float, str] = {}
    for width in STANDARD_WIDTHS:
        options[width] = FALLBACK_T1_BY_WIDTH[width]
    for board_type, info in inventory.items():
        if str(board_type).upper().startswith("T0"):
            continue
        width = _r1(info.get("Width", 0))
        if width in STANDARD_WIDTHS:
            options[width] = board_type
    return options


def _recovery_cost(widths: list[float], existing_strip_count: int) -> float:
    if not widths:
        return 0
    kerfs = len(widths) - 1
    if existing_strip_count > 0:
        kerfs += 1
    return sum(widths) + kerfs * SAW_KERF


def _choose_recovery_combo(remaining: float, existing_strip_count: int, disabled: bool) -> list[float]:
    if disabled:
        return []
    combos = [
        [STANDARD_WIDE, STANDARD_NARROW],
        [STANDARD_WIDE],
        [STANDARD_NARROW, STANDARD_NARROW],
        [STANDARD_NARROW],
    ]
    feasible = [
        combo for combo in combos
        if _recovery_cost(combo, existing_strip_count) <= remaining + 1e-6
    ]
    if not feasible:
        return []
    return max(feasible, key=lambda combo: (sum(combo), len(combo)))


def _pack_t0_sheets(strips: list[dict], color: str, inventory: dict, trim_loss: float, t0_id_offset: int) -> dict:
    t0_board_type = _t0_board_type(inventory)
    usable_width = T0_WIDTH - 2 * trim_loss
    direct_no_recovery_threshold = usable_width - STANDARD_NARROW - SAW_KERF

    sorted_strips = sorted(
        strips,
        key=lambda strip: (-strip["strip_width"], strip.get("pattern_key", "")),
    )

    sheets: list[dict] = []
    for strip in sorted_strips:
        strip_width = strip["strip_width"]
        placed = False
        for sheet in sheets:
            needed = strip_width + (SAW_KERF if sheet["strips"] else 0)
            if sheet["remaining"] >= needed - 1e-6:
                x_position = sheet["next_x"] if sheet["strips"] else 0.0
                sheet["strips"].append({**strip, "x_position": round(x_position, 1)})
                sheet["remaining"] -= needed
                sheet["next_x"] = x_position + strip_width + SAW_KERF
                placed = True
                break
        if placed:
            continue

        sheets.append({
            "remaining": usable_width - strip_width,
            "next_x": strip_width + SAW_KERF,
            "strips": [{**strip, "x_position": 0.0}],
        })

    recovery_types = _recovery_options_for_inventory(inventory)
    t0_sheets = []
    recovered_inventory = []

    for sheet_index, sheet in enumerate(sheets, 1):
        sheet_id = f"{t0_board_type}-{color}-{t0_id_offset + sheet_index:03d}"
        order_strips = sheet["strips"]
        disable_recovery = any(
            strip["strip_width"] > direct_no_recovery_threshold + 1e-6
            for strip in order_strips
        )
        recovered_widths = _choose_recovery_combo(
            sheet["remaining"],
            len(order_strips),
            disabled=disable_recovery,
        )
        recovery_cost = _recovery_cost(recovered_widths, len(order_strips))
        sheet["remaining"] -= recovery_cost

        recovered_strips = []
        for width in recovered_widths:
            board_type = recovery_types[width]
            recovered = {
                "width": width,
                "board_type": board_type,
                "type": board_type,
                "label": f"Recovered {width}mm",
                "color": color,
            }
            recovered_strips.append(recovered)
            recovered_inventory.append(recovered)

        all_strips_info = [
            {"strip_width": strip["strip_width"], "strip_index": idx}
            for idx, strip in enumerate(order_strips)
        ]
        for idx, strip in enumerate(order_strips):
            strip["t0_sheet_id"] = sheet_id
            strip["t0_sheet_index"] = idx
            strip["t0_strip_position"] = strip["x_position"]
            strip["t0_total_strips_on_sheet"] = len(order_strips)
            strip["t0_all_strips"] = all_strips_info
            strip["t0_remaining_width"] = round(max(sheet["remaining"], 0), 1)

        order_width = sum(strip["strip_width"] for strip in order_strips)
        recovered_width = sum(recovered_widths)
        total_cut_items = len(order_strips) + len(recovered_widths)
        kerf_loss = max(0, total_cut_items - 1) * SAW_KERF
        useful_width = order_width + recovered_width
        utilization = useful_width * BOARD_HEIGHT / (T0_WIDTH * BOARD_HEIGHT)

        t0_sheets.append({
            "sheet_id": sheet_id,
            "color": color,
            "t0_size": f"{T0_WIDTH} × {BOARD_HEIGHT}",
            "strips": [
                {
                    "strip_width": strip["strip_width"],
                    "width": strip["strip_width"],
                    "strip_label": t0_board_type,
                    "board_type": t0_board_type,
                    "strip_type": "T0",
                    "height": BOARD_HEIGHT,
                    "parts_count": len(strip["parts"]),
                }
                for strip in order_strips
            ],
            "strip_widths": [strip["strip_width"] for strip in order_strips],
            "strip_count": len(order_strips),
            "strips_total_width": round(order_width, 1),
            "kerf_loss": round(kerf_loss, 1),
            "trim_loss": trim_loss,
            "waste_width": round(max(sheet["remaining"], 0), 1),
            "remaining_width": round(max(sheet["remaining"], 0), 1),
            "utilization": round(utilization, 4),
            "recovered_strips": recovered_strips,
        })

    return {
        "t0_board_type": t0_board_type,
        "t0_sheets": t0_sheets,
        "t0_strips": [strip for sheet in sheets for strip in sheet["strips"]],
        "recovered_inventory": recovered_inventory,
    }


def _build_color_inventory(color: str, inventory_per_color: dict) -> dict:
    actual = inventory_per_color.get(color, {})
    template = inventory_per_color.get(DEFAULT_BOX_COLOR) or next(iter(inventory_per_color.values()), {})
    color_inventory = {
        board_type: {
            **info,
            "qty": int(actual.get(board_type, {}).get("qty", 0)),
            "color": color,
        }
        for board_type, info in template.items()
    }
    for board_type, info in actual.items():
        color_inventory[board_type] = {**info, "color": color}
    return color_inventory


def _run_color(parts: list[dict], inventory: dict, color: str, force_t0_start: bool, trim_loss: float, t0_id_offset: int) -> dict:
    parts_by_width: dict[float, list[dict]] = defaultdict(list)
    for part in parts:
        parts_by_width[_r1(_cut_width(part))].append(part)

    inventory_strips: list[tuple[dict, str]] = []
    t0_candidate_strips: list[dict] = []
    used_inventory: dict[str, int] = {}

    for width in sorted(parts_by_width.keys(), reverse=True):
        strips = _build_stack_first_strips(parts_by_width[width], width, color, trim_loss)
        if _is_standard_width(width) and not force_t0_start:
            board_type, stock = _inventory_stock_for_width(width, inventory)
            inventory_count = min(stock, len(strips))
            for strip in strips[:inventory_count]:
                inventory_strips.append((strip, board_type))
            if inventory_count:
                used_inventory[board_type] = used_inventory.get(board_type, 0) + inventory_count
            t0_candidate_strips.extend(strips[inventory_count:])
        else:
            t0_candidate_strips.extend(strips)

    t0_pack = _pack_t0_sheets(t0_candidate_strips, color, inventory, trim_loss, t0_id_offset)
    t0_board_type = t0_pack["t0_board_type"]
    board_results = []
    board_index = 1

    for strip, board_type in inventory_strips:
        board_results.append(_board_from_strip(strip, board_type, "inventory", board_index, trim_loss))
        board_index += 1

    for strip in t0_pack["t0_strips"]:
        board_results.append(_board_from_strip(strip, t0_board_type, "T0", board_index, trim_loss))
        board_index += 1

    sheet_to_parts_area: dict[str, float] = defaultdict(float)
    sheet_to_recovered_area: dict[str, float] = defaultdict(float)
    for sheet in t0_pack["t0_sheets"]:
        sheet_to_recovered_area[sheet["sheet_id"]] = sum(
            recovered["width"] * BOARD_HEIGHT for recovered in sheet.get("recovered_strips", [])
        )
    for board in board_results:
        sheet_id = board.get("t0_sheet_id")
        if sheet_id:
            sheet_to_parts_area[sheet_id] += board["parts_total_area"]
    for board in board_results:
        sheet_id = board.get("t0_sheet_id")
        if sheet_id:
            board["t0_sheet_utilization"] = round(
                (sheet_to_parts_area[sheet_id] + sheet_to_recovered_area[sheet_id]) / (T0_WIDTH * BOARD_HEIGHT),
                4,
            )

    return {
        "boards": board_results,
        "t0_sheets": t0_pack["t0_sheets"],
        "recovered_inventory": t0_pack["recovered_inventory"],
        "used_inventory": used_inventory,
        "color": color,
    }


def run_engine(
    parts_path: str,
    inventory_path: str | None = None,
    output_path: str = "output/cut_result.json",
    cabinet_breakdown: dict | None = None,
    force_t0_start: bool = False,
    trim_loss_mm: float = 2,
):
    print("=" * 60)
    print("  Stack Efficiency Cutting Engine")
    print("=" * 60)
    print(f"  Mode: {'T0 Sheet' if force_t0_start else 'T1 Stock'}")
    print(f"  Trim: {trim_loss_mm:g}mm | Saw kerf: {SAW_KERF:g}mm | Max stack: {MAX_STACK}")

    trim_loss = max(0.0, float(trim_loss_mm))
    parts, skipped_rows = load_parts(parts_path)
    inventory_per_color = load_inventory(inventory_path)
    if not inventory_per_color:
        raise RuntimeError("Inventory is empty")

    valid_parts, oversized_parts = _parts_fit_or_rotate(parts, trim_loss)
    parts_by_color: dict[str, list[dict]] = defaultdict(list)
    for part in valid_parts:
        parts_by_color[part.get("color", DEFAULT_BOX_COLOR)].append(part)

    all_boards: list[dict] = []
    all_t0_sheets: list[dict] = []
    recovered_inventory: list[dict] = []
    used_inventory: dict[str, int] = {}
    inventory_used_by_color: dict[str, dict[str, int]] = {}
    by_color: dict[str, dict[str, Any]] = {}
    t0_id_offset = 0
    inventory_by_color: dict[str, dict] = {}

    for color, color_parts in parts_by_color.items():
        color_inventory = _build_color_inventory(color, inventory_per_color)
        inventory_by_color[color] = color_inventory
        partial = _run_color(
            color_parts,
            color_inventory,
            color,
            force_t0_start=force_t0_start,
            trim_loss=trim_loss,
            t0_id_offset=t0_id_offset,
        )
        all_boards.extend(partial["boards"])
        all_t0_sheets.extend(partial["t0_sheets"])
        recovered_inventory.extend(partial["recovered_inventory"])
        t0_id_offset += len(partial["t0_sheets"])

        for board_type, count in partial["used_inventory"].items():
            key = f"{board_type}|{color}"
            used_inventory[key] = used_inventory.get(key, 0) + count
            inventory_used_by_color.setdefault(color, {})[board_type] = (
                inventory_used_by_color.setdefault(color, {}).get(board_type, 0) + count
            )

        parts_area = sum(board["parts_total_area"] for board in partial["boards"])
        recovered_area = sum(
            recovered["width"] * BOARD_HEIGHT
            for recovered in partial["recovered_inventory"]
        )
        t0_area = len(partial["t0_sheets"]) * T0_WIDTH * BOARD_HEIGHT
        t1_area = sum(board["board_area"] for board in partial["boards"] if board.get("source") == "inventory")
        total_area = t0_area + t1_area
        by_color[color] = {
            "parts_total": len(color_parts),
            "parts_placed": sum(len(board["parts"]) for board in partial["boards"]),
            "total_parts_placed": sum(len(board["parts"]) for board in partial["boards"]),
            "boards_used": len(partial["boards"]),
            "t0_sheets_used": len(partial["t0_sheets"]),
            "t0_recovered_strips": len(partial["recovered_inventory"]),
            "overall_utilization": round((parts_area + recovered_area) / total_area if total_area > 0 else 0, 4),
        }

    board_type_counts: dict[str, int] = defaultdict(int)
    for board in all_boards:
        board_type_counts[board["board"]] += 1

    t0_shortages = []
    for color in parts_by_color.keys():
        color_t0_sheets = [sheet for sheet in all_t0_sheets if sheet.get("color") == color]
        if not color_t0_sheets:
            continue
        t0_board_type, stock = _t0_stock(inventory_by_color[color])
        needed = len(color_t0_sheets)
        if needed > stock:
            t0_shortages.append({
                "board_type": t0_board_type,
                "color": color,
                "needed": needed,
                "stock": stock,
                "shortage": needed - stock,
            })

    total_parts_required = len(valid_parts)
    total_parts_placed = sum(len(board["parts"]) for board in all_boards)
    total_oversized = len(oversized_parts)
    total_board_area = (
        len(all_t0_sheets) * T0_WIDTH * BOARD_HEIGHT
        + sum(board["board_area"] for board in all_boards if board.get("source") == "inventory")
    )
    total_parts_area = sum(board["parts_total_area"] for board in all_boards)
    total_recovered_area = sum(recovered["width"] * BOARD_HEIGHT for recovered in recovered_inventory)
    total_length_kerf_area = sum(board["kerf_total"] * board["strip_width"] for board in all_boards)
    total_t0_rip_kerf_area = sum(float(sheet.get("kerf_loss", 0)) * BOARD_HEIGHT for sheet in all_t0_sheets)
    total_waste_area = total_board_area - total_parts_area - total_recovered_area - total_length_kerf_area - total_t0_rip_kerf_area
    overall_utilization = (total_parts_area + total_recovered_area) / total_board_area if total_board_area > 0 else 0

    issues = {
        "skipped_rows": [
            {"file": "parts.xlsx", "source": f"Row {row['row']}: {row['reason']}"}
            for row in skipped_rows
        ],
        "unmatched_parts": [],
        "oversized_parts": [
            {
                "part_id": part.get("part_id", "?"),
                "cab_id": part.get("cab_id", "?"),
                "component": part.get("component", "?"),
                "Height": part.get("Height"),
                "Width": part.get("Width"),
                "color": part.get("color", DEFAULT_BOX_COLOR),
                "reason": f"尺寸 {part.get('Height')}×{part.get('Width')}mm 超过板材最大尺寸",
            }
            for part in oversized_parts
        ],
    }

    summary = {
        "total_parts_required": total_parts_required,
        "total_parts_placed": total_parts_placed,
        "total_parts_unmatched": max(0, total_parts_required - total_parts_placed),
        "all_parts_cut": total_parts_placed == total_parts_required and total_oversized == 0,
        "strips_used": len(all_boards),
        "boards_used": len(all_boards),
        "t0_sheets_used": len(all_t0_sheets),
        "t0_recovered_strips": len(recovered_inventory),
        "inventory_used": used_inventory,
        "inventory_shortage": t0_shortages,
        "board_type_breakdown": dict(board_type_counts),
        "by_color": by_color,
        "total_parts_length": round(sum(board["parts_total_length"] for board in all_boards), 1),
        "total_trim_loss": round(sum(board["trim_loss"] for board in all_boards), 1),
        "total_kerf_loss": round(sum(board["kerf_total"] for board in all_boards), 1),
        "total_waste": round(total_waste_area, 1),
        "overall_utilization": round(overall_utilization, 4),
        "config_trim_loss_mm": trim_loss,
        "config_saw_kerf_mm": SAW_KERF,
        "cut_mode": "t0_start" if force_t0_start else "inventory_first",
        "cut_algorithm": "stack_efficiency",
        "max_stack": MAX_STACK,
        "production_flow": [
            "rip_t0_standard_strips",
            "stack_length_cut_standard_pool",
            "cut_nonstandard_t0_strips",
        ],
    }
    if total_oversized:
        summary["oversized_count"] = total_oversized

    output: dict[str, Any] = {
        "summary": summary,
        "issues": issues,
        "boards": all_boards,
        "cut_mode": "t0_start" if force_t0_start else "inventory_first",
        "cut_algorithm": "stack_efficiency",
    }
    if all_t0_sheets:
        output["t0_plan"] = {
            "t0_sheets_needed": len(all_t0_sheets),
            "t0_sheets": all_t0_sheets,
            "total_utilization": round(
                sum(float(sheet.get("utilization", 0)) for sheet in all_t0_sheets) / len(all_t0_sheets),
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
    if recovered_inventory:
        output["recovered_inventory"] = recovered_inventory
    if cabinet_breakdown:
        output["cabinet_breakdown"] = cabinet_breakdown

    _validate_cut_result(output, cabinet_breakdown, total_parts_required, oversized_parts)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2, ensure_ascii=False)

    print(f"\nStack efficiency complete: {total_parts_placed}/{total_parts_required} parts, "
          f"{len(all_boards)} strips, {len(all_t0_sheets)} T0 sheets")
    return output
