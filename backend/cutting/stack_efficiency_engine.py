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
STRETCHER_WIDTH = 101.6
MAX_STACK = 4
STACK_PREFERENCE = (4, 3, 2, 1)

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


def _is_stretcher_width(width: float) -> bool:
    return abs(_r1(width) - STRETCHER_WIDTH) < 0.05


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


def _build_stretcher_strips(parts: list[dict], color: str, trim_loss: float) -> list[dict]:
    """Build one-piece stretcher lanes so same lengths can be stacked 4/2."""
    strips: list[dict] = []
    for part in sorted(parts, key=lambda p: (_r1(_cut_length(p)), p.get("part_id", "")), reverse=True):
        cut_length = _r1(_cut_length(part))
        _, no_trim, usable_length = _strip_capacity(cut_length, trim_loss)
        strips.append({
            "strip_width": STRETCHER_WIDTH,
            "parts": [part],
            "color": color,
            "no_trim": no_trim,
            "usable_length": usable_length,
            "pattern_key": f"STRETCHER|{STRETCHER_WIDTH}|{cut_length}|1",
            "stretcher_phase": True,
        })
    return strips


def _strip_effective_usable(strip: dict, trim_loss: float) -> float:
    return BOARD_HEIGHT if strip.get("no_trim") else BOARD_HEIGHT - 2 * trim_loss


def _strip_used_length(strip: dict) -> float:
    parts = strip.get("parts", [])
    if not parts:
        return 0.0
    return sum(_cut_length(part) for part in parts) + max(0, len(parts) - 1) * SAW_KERF


def _part_needs_no_trim(part: dict, trim_loss: float) -> bool:
    usable = BOARD_HEIGHT - 2 * trim_loss
    length = _cut_length(part)
    return length > usable + 1e-6 and length <= BOARD_HEIGHT + 1e-6


def _can_append_part(strip: dict, part: dict, trim_loss: float) -> bool:
    next_len = _strip_used_length(strip) + (_cut_length(part) if not strip.get("parts") else SAW_KERF + _cut_length(part))
    return next_len <= _strip_effective_usable(strip, trim_loss) + 1e-6


def _refresh_strip_pattern(strip: dict) -> None:
    lengths = sorted((_r1(_cut_length(part)) for part in strip.get("parts", [])), reverse=True)
    signature = "+".join(str(length) for length in lengths)
    strip["pattern_key"] = f"{_r1(strip['strip_width'])}|{signature}|{len(lengths)}"
    strip["usable_length"] = BOARD_HEIGHT if strip.get("no_trim") else strip.get("usable_length", BOARD_HEIGHT)


def _append_part_to_strip(strip: dict, part: dict, trim_loss: float) -> bool:
    if not _can_append_part(strip, part, trim_loss):
        return False
    strip["parts"].append(part)
    _refresh_strip_pattern(strip)
    return True


def _new_lane_strip(width: float, part: dict, color: str, trim_loss: float, *, stretcher: bool = False) -> dict:
    no_trim = _part_needs_no_trim(part, trim_loss)
    strip = {
        "strip_width": _r1(width),
        "parts": [part],
        "color": color,
        "no_trim": no_trim,
        "usable_length": BOARD_HEIGHT if no_trim else BOARD_HEIGHT - 2 * trim_loss,
    }
    if stretcher:
        strip["stretcher_phase"] = True
    _refresh_strip_pattern(strip)
    return strip


def _repack_t0_strips_by_width(strips: list[dict], color: str, trim_loss: float) -> list[dict]:
    """Repack strips by width for stack-aligned cutting.

    Phase 1: Pack each cut-length group to strip capacity → uniform patterns.
    Phase 2: Absorb short strips into long strips' leftover space in
             stack-aligned batches (4/3/2/1) to boost utilization without
             breaking stackability.
    """
    by_width: dict[float, list[dict]] = defaultdict(list)
    for strip in strips:
        by_width[_r1(strip["strip_width"])].extend(strip.get("parts", []))

    packed: list[dict] = []
    for width in sorted(by_width.keys(), reverse=True):
        queues: dict[float, list[dict]] = defaultdict(list)
        for part in by_width[width]:
            queues[_r1(_cut_length(part))].append(part)
        for queue in queues.values():
            queue.sort(key=lambda part: part.get("part_id", ""))

        sorted_lengths = sorted(queues.keys(), reverse=True)

        # ── Phase 1: pack each length group to capacity ──
        lanes_by_length: dict[float, list[dict]] = {}
        for length in sorted_lengths:
            queue = queues[length]
            lanes: list[dict] = []
            while queue:
                lane = _new_lane_strip(width, queue.pop(0), color, trim_loss)
                while queue and _append_part_to_strip(lane, queue[0], trim_loss):
                    queue.pop(0)
                lanes.append(lane)
            lanes_by_length[length] = lanes

        # ── Phase 2: redistribute short parts into strips with leftover ──
        # Unpack donor strips into individual parts, distribute 1-per-receiver
        # in stack-aligned batches so patterns stay identical within each batch.

        # Build a flat list of all lanes and sort by utilization descending
        # so high-util strips are preferred receivers.
        all_lanes: list[dict] = []
        for length in sorted_lengths:
            all_lanes.extend(lanes_by_length[length])

        absorbed: set[int] = set()

        # Process donors from shortest length first
        for donor_length in reversed(sorted_lengths):
            donor_lanes = [l for l in lanes_by_length[donor_length] if id(l) not in absorbed]
            if not donor_lanes:
                continue

            # Collect all individual parts from donor lanes
            donor_parts: list[dict] = []
            for lane in donor_lanes:
                donor_parts.extend(lane["parts"])
            if not donor_parts:
                continue

            # Find receiver lanes (any length group) that can fit 1 donor part
            test_part = donor_parts[0]
            receivers = [
                l for l in all_lanes
                if id(l) not in absorbed
                and id(l) not in {id(dl) for dl in donor_lanes}
                and _can_append_part(l, test_part, trim_loss)
            ]
            if not receivers:
                continue

            # Distribute 1 part per receiver in stack-aligned batches
            r_cursor = 0
            for stack_size in STACK_PREFERENCE:
                while (donor_parts
                       and len(donor_parts) >= stack_size
                       and r_cursor + stack_size <= len(receivers)):
                    for j in range(stack_size):
                        _append_part_to_strip(receivers[r_cursor + j], donor_parts.pop(0), trim_loss)
                    r_cursor += stack_size

            # Mark emptied donor lanes as absorbed
            if not donor_parts:
                for lane in donor_lanes:
                    absorbed.add(id(lane))
            else:
                # Rebuild donor lanes with remaining parts
                for lane in donor_lanes:
                    absorbed.add(id(lane))
                while donor_parts:
                    lane = _new_lane_strip(width, donor_parts.pop(0), color, trim_loss)
                    while donor_parts and _append_part_to_strip(lane, donor_parts[0], trim_loss):
                        donor_parts.pop(0)
                    all_lanes.append(lane)

        # Collect non-absorbed lanes
        for lane in all_lanes:
            if id(lane) not in absorbed:
                packed.append(lane)

    return packed


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
            "t0_source_strip_width",
            "t0_source_strip_label",
            "t0_source_strip_secondary",
        ):
            if key in strip:
                board[key] = strip[key]

    for key in (
        "stack_group_id",
        "stack_size",
        "stack_layer",
        "stack_pattern_key",
        "rip_from",
        "rip_leftover",
        "rip_leftover_recovered",
        "stretcher_phase",
        "source_stock_group_id",
        "source_stock_width",
        "source_stock_board_type",
        "source_stock_yield_count",
        "source_stock_waste_width",
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


def _t0_strip_source_width(strip: dict) -> float:
    return _r1(strip.get("t0_source_strip_width") or strip["strip_width"])


def _t0_strip_consumed_width(strip: dict) -> float:
    if strip.get("t0_source_strip_secondary"):
        return 0.0
    return _t0_strip_source_width(strip)


def _append_strip_to_t0_sheet(sheet: dict, strip: dict) -> bool:
    source_width = _t0_strip_consumed_width(strip)
    needed = source_width + (SAW_KERF if sheet["strips"] else 0)
    if sheet["remaining"] < needed - 1e-6:
        return False
    x_position = sheet["next_x"] if sheet["strips"] else 0.0
    sheet["strips"].append({**strip, "x_position": round(x_position, 1)})
    sheet["remaining"] -= needed
    sheet["next_x"] = x_position + source_width + SAW_KERF
    return True


def _build_t0_sheet_pack(strips: list[dict], trim_loss: float) -> list[dict]:
    usable_width = T0_WIDTH - 2 * trim_loss

    sorted_strips = sorted(
        strips,
        key=lambda strip: (-_t0_strip_consumed_width(strip), strip.get("pattern_key", "")),
    )

    sheets: list[dict] = []
    for strip in sorted_strips:
        placed = False
        for sheet in sheets:
            if _append_strip_to_t0_sheet(sheet, strip):
                placed = True
                break
        if placed:
            continue

        source_width = _t0_strip_consumed_width(strip)
        sheets.append({
            "remaining": usable_width - source_width,
            "next_x": source_width + SAW_KERF,
            "strips": [{**strip, "x_position": 0.0}],
        })
    return sheets


def _place_stretcher_source_group_on_t0(
    source_strips: list[dict],
    sheets: list[dict],
    trim_loss: float,
) -> None:
    if not source_strips:
        return
    primary = source_strips[0]
    for secondary in source_strips[1:]:
        secondary["t0_source_strip_secondary"] = True

    for sheet in sheets:
        if _append_strip_to_t0_sheet(sheet, primary):
            x_position = primary.get("x_position", sheet["strips"][-1].get("x_position", 0.0))
            for secondary in source_strips[1:]:
                sheet["strips"].append({**secondary, "x_position": round(float(x_position), 1)})
            return

    usable_width = T0_WIDTH - 2 * trim_loss
    source_width = _t0_strip_consumed_width(primary)
    sheets.append({
        "remaining": usable_width - source_width,
        "next_x": source_width + SAW_KERF,
        "strips": [
            {**primary, "x_position": 0.0},
            *({**secondary, "x_position": 0.0} for secondary in source_strips[1:]),
        ],
    })


def _finalize_t0_sheets(sheets: list[dict], color: str, inventory: dict, trim_loss: float, t0_id_offset: int) -> dict:
    t0_board_type = _t0_board_type(inventory)
    usable_width = T0_WIDTH - 2 * trim_loss
    direct_no_recovery_threshold = usable_width - STANDARD_NARROW - SAW_KERF

    recovery_types = _recovery_options_for_inventory(inventory)
    t0_sheets = []
    recovered_inventory = []

    for sheet_index, sheet in enumerate(sheets, 1):
        sheet_id = f"{t0_board_type}-{color}-{t0_id_offset + sheet_index:03d}"
        order_strips = sheet["strips"]
        order_cut_items = sum(0 if strip.get("t0_source_strip_secondary") else 1 for strip in order_strips)
        disable_recovery = any(
            strip["strip_width"] > direct_no_recovery_threshold + 1e-6
            for strip in order_strips
        )
        recovered_widths = _choose_recovery_combo(
            sheet["remaining"],
            order_cut_items,
            disabled=disable_recovery,
        )
        recovery_cost = _recovery_cost(recovered_widths, order_cut_items)
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

        order_width = sum(_t0_strip_consumed_width(strip) for strip in order_strips)
        recovered_width = sum(recovered_widths)
        total_cut_items = order_cut_items + len(recovered_widths)
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
                    "width": _t0_strip_source_width(strip),
                    "target_width": strip["strip_width"],
                    "strip_label": strip.get("t0_source_strip_label") or t0_board_type,
                    "board_type": t0_board_type,
                    "strip_type": "T0",
                    "height": BOARD_HEIGHT,
                    "parts_count": len(strip["parts"]),
                }
                for strip in order_strips
                if not strip.get("t0_source_strip_secondary")
            ],
            "strip_widths": [
                _t0_strip_source_width(strip)
                for strip in order_strips
                if not strip.get("t0_source_strip_secondary")
            ],
            "strip_count": sum(0 if strip.get("t0_source_strip_secondary") else 1 for strip in order_strips),
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


def _pack_t0_sheets(strips: list[dict], color: str, inventory: dict, trim_loss: float, t0_id_offset: int) -> dict:
    sheets = _build_t0_sheet_pack(strips, trim_loss)
    return _finalize_t0_sheets(sheets, color, inventory, trim_loss, t0_id_offset)


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


def _bundle_into_stacks(strips: list[dict], pattern_prefix: str = "") -> list[dict]:
    """Bundle identical-pattern strips into stacks of size 4, 2, or 1 (even-bias).

    Strips with the same `pattern_key` are grouped; each group is decomposed
    largest-first using STACK_PREFERENCE. Each strip receives `stack_group_id`,
    `stack_size`, and `stack_layer` in place. Returns the strips in the order
    they were assigned (deterministic).
    """
    by_pattern: dict[str, list[dict]] = defaultdict(list)
    for strip in strips:
        by_pattern[strip.get("pattern_key", "")].append(strip)

    bundled: list[dict] = []
    for pattern in sorted(by_pattern.keys()):
        group = by_pattern[pattern]
        cursor = 0
        stack_idx = 0
        n = len(group)
        for size in STACK_PREFERENCE:
            while n - cursor >= size:
                tag = f"{pattern_prefix}{pattern}|{stack_idx:02d}"
                stack_id = f"S-{tag}"
                for layer in range(size):
                    strip = group[cursor + layer]
                    strip["stack_group_id"] = stack_id
                    strip["stack_size"] = size
                    strip["stack_layer"] = layer
                    strip["stack_pattern_key"] = pattern
                    bundled.append(strip)
                stack_idx += 1
                cursor += size
    return bundled


def _wider_inventory_widths(target: float, inventory: dict, remaining_qty: dict) -> list[tuple[float, str, int]]:
    """Inventory rows wider than target, with positive remaining qty.

    Sorted ascending by source width so the narrowest viable wider source is
    used first (less rip leftover). T0 board_types are excluded.
    """
    target_r = _r1(target)
    results: list[tuple[float, str, int]] = []
    for board_type, info in inventory.items():
        if str(board_type).upper().startswith("T0"):
            continue
        src_width = _r1(info.get("Width", 0))
        if src_width <= target_r + SAW_KERF:
            continue
        qty = remaining_qty.get(board_type, int(info.get("qty", 0)))
        if qty <= 0:
            continue
        results.append((src_width, board_type, qty))
    results.sort(key=lambda row: (row[0], row[1]))
    return results


def _rip_recovery_entry(leftover: float, color: str) -> dict | None:
    """Return a recovered_inventory entry if leftover hits a standard width."""
    width = _r1(leftover)
    if width not in STANDARD_WIDTHS:
        return None
    board_type = FALLBACK_T1_BY_WIDTH[width]
    return {
        "width": width,
        "board_type": board_type,
        "type": board_type,
        "label": f"Recovered {width}mm (width-rip)",
        "color": color,
        "source": "width_rip",
    }


def _stamp_rip_meta(strip: dict, src_width: float, target_width: float, color: str,
                    rip_recovered_out: list[dict]) -> None:
    leftover = max(0.0, src_width - target_width - SAW_KERF)
    recovery = _rip_recovery_entry(leftover, color)
    strip["rip_from"] = _r1(src_width)
    strip["rip_leftover"] = round(leftover, 1)
    strip["rip_leftover_recovered"] = bool(recovery)
    if recovery:
        rip_recovered_out.append(recovery)


def _allocate_strip_sources(
    strips: list[dict],
    width: float,
    color: str,
    inventory: dict,
    force_t0_start: bool,
    used_inventory: dict,
    inventory_remaining: dict,
    rip_recovered_out: list[dict],
) -> tuple[list[tuple[dict, str]], list[dict]]:
    """Allocate strips to inventory or T0; mutates used_inventory/inventory_remaining.

    Order:
      a) exact-width T1 stock (existing behavior, standard widths only)
      b) wider T1 stock with width-rip (NEW)
      c) remainder → T0 candidates
    """
    if force_t0_start:
        return [], list(strips)

    inventory_strips: list[tuple[dict, str]] = []
    remaining = list(strips)

    if _is_standard_width(width):
        board_type, _ = _inventory_stock_for_width(width, inventory)
        avail = inventory_remaining.get(board_type, 0)
        take = min(avail, len(remaining))
        if take > 0:
            for s in remaining[:take]:
                inventory_strips.append((s, board_type))
            used_inventory[board_type] = used_inventory.get(board_type, 0) + take
            inventory_remaining[board_type] = avail - take
            remaining = remaining[take:]

    if remaining:
        for src_width, src_bt, _ in _wider_inventory_widths(width, inventory, inventory_remaining):
            if not remaining:
                break
            avail = inventory_remaining.get(src_bt, 0)
            if avail <= 0:
                continue
            take = min(avail, len(remaining))
            for s in remaining[:take]:
                _stamp_rip_meta(s, src_width, width, color, rip_recovered_out)
                inventory_strips.append((s, src_bt))
            used_inventory[src_bt] = used_inventory.get(src_bt, 0) + take
            inventory_remaining[src_bt] = avail - take
            remaining = remaining[take:]

    return inventory_strips, remaining


def _source_board_waste(source_width: float, yield_count: int) -> float:
    return round(max(0.0, source_width - yield_count * STRETCHER_WIDTH - yield_count * SAW_KERF), 1)


def _stamp_stretcher_source(
    strip: dict,
    source_width: float,
    source_group_id: str,
    yield_count: int,
    board_type: str | None = None,
    t0_source: bool = False,
) -> None:
    strip["stretcher_phase"] = True
    strip["source_stock_group_id"] = source_group_id
    strip["source_stock_width"] = _r1(source_width)
    strip["source_stock_yield_count"] = yield_count
    strip["source_stock_waste_width"] = _source_board_waste(source_width, yield_count)
    strip["rip_from"] = _r1(source_width)
    strip["rip_leftover"] = strip["source_stock_waste_width"]
    strip["rip_leftover_recovered"] = False
    if board_type:
        strip["source_stock_board_type"] = board_type
    if t0_source:
        strip["t0_source_strip_width"] = _r1(source_width)
        strip["t0_source_strip_label"] = board_type or f"T0→{_r1(source_width)}"


def _allocate_stretcher_from_t0_residual(
    queue: list[dict],
    sheets: list[dict],
    color: str,
    trim_loss: float,
    source_counter: dict[str, int],
) -> list[dict]:
    allocated: list[dict] = []
    pending = list(queue)

    # First use length left in already-created 101.6 lanes. This is the key
    # material-saving path: stretcher parts can move from another sheet's right
    # side into an existing narrow lane instead of consuming a new full-height lane.
    still_pending: list[dict] = []
    for strip in pending:
        part = strip["parts"][0]
        placed = False
        for sheet in sheets:
            for lane in sheet["strips"]:
                if _is_stretcher_width(lane.get("strip_width", 0)) and _append_part_to_strip(lane, part, trim_loss):
                    lane["stretcher_phase"] = True
                    placed = True
                    break
            if placed:
                break
        if not placed:
            still_pending.append(strip)
    pending = still_pending

    while pending:
        placed = False
        for sheet in sheets:
            strip = pending[0]
            if sheet["remaining"] < STRETCHER_WIDTH + SAW_KERF - 1e-6:
                continue
            source_counter["t0_direct"] += 1
            group_id = f"T0-DIRECT-{color}-{source_counter['t0_direct']:03d}"
            _stamp_stretcher_source(strip, STRETCHER_WIDTH, group_id, 1, t0_source=True)
            if _append_strip_to_t0_sheet(sheet, strip):
                pending.pop(0)
                while pending and _append_part_to_strip(strip, pending[0]["parts"][0], trim_loss):
                    pending.pop(0)
                allocated.append(strip)
                placed = True
                break
        if not placed:
            break
    queue[:] = pending
    return allocated


def _allocate_stretcher_from_inventory_width(
    queue: list[dict],
    width: float,
    yield_count: int,
    color: str,
    inventory: dict,
    used_inventory: dict,
    inventory_remaining: dict,
    source_counter: dict[str, int],
) -> list[tuple[dict, str]]:
    board_type = _standard_board_type(width, inventory)
    available = inventory_remaining.get(board_type, 0)
    allocated: list[tuple[dict, str]] = []
    while queue and available > 0:
        take = min(yield_count, len(queue))
        source_counter["inventory"] += 1
        group_id = f"INV-STRETCHER-{color}-{board_type}-{source_counter['inventory']:03d}"
        for strip in queue[:take]:
            _stamp_stretcher_source(strip, width, group_id, yield_count, board_type=board_type)
            allocated.append((strip, board_type))
        queue[:] = queue[take:]
        available -= 1
        used_inventory[board_type] = used_inventory.get(board_type, 0) + 1
    inventory_remaining[board_type] = available
    return allocated


def _allocate_stretcher_from_t0_standard(
    queue: list[dict],
    sheets: list[dict],
    color: str,
    inventory: dict,
    trim_loss: float,
    source_counter: dict[str, int],
) -> list[dict]:
    allocated: list[dict] = []
    t0_board_type = _t0_board_type(inventory)
    while queue:
        source_width = STANDARD_WIDE if len(queue) >= 4 else STANDARD_NARROW
        yield_count = 4 if source_width == STANDARD_WIDE else 2
        source_counter["t0_standard"] += 1
        group_id = f"T0-STANDARD-{color}-{source_counter['t0_standard']:03d}"
        source_strips: list[dict] = []

        while queue:
            part = queue[0]["parts"][0]
            placed = False
            for lane in source_strips:
                if _append_part_to_strip(lane, part, trim_loss):
                    queue.pop(0)
                    placed = True
                    break
            if placed:
                continue

            if len(source_strips) >= yield_count:
                break

            strip = queue.pop(0)
            _stamp_stretcher_source(
                strip,
                source_width,
                group_id,
                yield_count,
                board_type=t0_board_type,
                t0_source=True,
            )
            source_strips.append(strip)
            allocated.append(strip)

        _place_stretcher_source_group_on_t0(source_strips, sheets, trim_loss)
    return allocated


def _allocate_stretcher_sources(
    stretcher_strips: list[dict],
    sheets: list[dict],
    color: str,
    inventory: dict,
    force_t0_start: bool,
    trim_loss: float,
    used_inventory: dict,
    inventory_remaining: dict,
) -> tuple[list[tuple[dict, str]], list[dict]]:
    inventory_allocated: list[tuple[dict, str]] = []
    t0_allocated: list[dict] = []
    source_counter = {"t0_direct": 0, "inventory": 0, "t0_standard": 0}

    queue = sorted(
        list(stretcher_strips),
        key=lambda strip: (_cut_length(strip["parts"][0]), strip["parts"][0].get("part_id", "")),
        reverse=True,
    )
    t0_allocated.extend(_allocate_stretcher_from_t0_residual(queue, sheets, color, trim_loss, source_counter))

    if not force_t0_start:
        inventory_allocated.extend(_allocate_stretcher_from_inventory_width(
            queue,
            STANDARD_NARROW,
            2,
            color,
            inventory,
            used_inventory,
            inventory_remaining,
            source_counter,
        ))
        inventory_allocated.extend(_allocate_stretcher_from_inventory_width(
            queue,
            STANDARD_WIDE,
            4,
            color,
            inventory,
            used_inventory,
            inventory_remaining,
            source_counter,
        ))

    t0_allocated.extend(_allocate_stretcher_from_t0_standard(
        queue,
        sheets,
        color,
        inventory,
        trim_loss,
        source_counter,
    ))

    return inventory_allocated, t0_allocated


def _run_color(parts: list[dict], inventory: dict, color: str, force_t0_start: bool, trim_loss: float, t0_id_offset: int) -> dict:
    main_parts = [part for part in parts if not _is_stretcher_width(_cut_width(part))]
    stretcher_parts = [part for part in parts if _is_stretcher_width(_cut_width(part))]

    parts_by_width: dict[float, list[dict]] = defaultdict(list)
    for part in main_parts:
        parts_by_width[_r1(_cut_width(part))].append(part)

    inventory_strips: list[tuple[dict, str]] = []
    t0_candidate_strips: list[dict] = []
    used_inventory: dict[str, int] = {}
    inventory_remaining: dict[str, int] = {
        bt: int(info.get("qty", 0))
        for bt, info in inventory.items()
        if not str(bt).upper().startswith("T0")
    }
    rip_recovered: list[dict] = []

    for width in sorted(parts_by_width.keys(), reverse=True):
        strips = _build_stack_first_strips(parts_by_width[width], width, color, trim_loss)
        # Length-pack before source allocation so T1 inventory and T0 fallback
        # both reuse the same strip length instead of opening one strip per length.
        strips = _repack_t0_strips_by_width(strips, color, trim_loss)
        allocated, t0_extra = _allocate_strip_sources(
            strips,
            width,
            color,
            inventory,
            force_t0_start,
            used_inventory,
            inventory_remaining,
            rip_recovered,
        )
        inventory_strips.extend(allocated)
        t0_candidate_strips.extend(t0_extra)

    t0_candidate_strips = _repack_t0_strips_by_width(t0_candidate_strips, color, trim_loss)
    sheets = _build_t0_sheet_pack(t0_candidate_strips, trim_loss)

    if stretcher_parts:
        stretcher_strips = _build_stretcher_strips(stretcher_parts, color, trim_loss)
        stretcher_inventory, _ = _allocate_stretcher_sources(
            stretcher_strips,
            sheets,
            color,
            inventory,
            force_t0_start=force_t0_start,
            trim_loss=trim_loss,
            used_inventory=used_inventory,
            inventory_remaining=inventory_remaining,
        )
        inventory_strips.extend(stretcher_inventory)

    inventory_only_strips = [s for s, _ in inventory_strips]
    t0_all_strips = [strip for sheet in sheets for strip in sheet["strips"]]
    _bundle_into_stacks(inventory_only_strips, pattern_prefix=f"INV-{color}-")
    _bundle_into_stacks(t0_all_strips, pattern_prefix=f"T0-{color}-")

    t0_pack = _finalize_t0_sheets(sheets, color, inventory, trim_loss, t0_id_offset)
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
        "recovered_inventory": t0_pack["recovered_inventory"] + rip_recovered,
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

    stack_size_breakdown: dict[int, int] = defaultdict(int)
    distinct_stack_groups: set[str] = set()
    width_rip_count = 0
    width_rip_recovered_count = 0
    for board in all_boards:
        gid = board.get("stack_group_id")
        if gid and gid not in distinct_stack_groups:
            distinct_stack_groups.add(gid)
            stack_size_breakdown[int(board.get("stack_size", 1))] += 1
        if board.get("rip_from") is not None:
            width_rip_count += 1
            if board.get("rip_leftover_recovered"):
                width_rip_recovered_count += 1

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
        "stack_groups": len(distinct_stack_groups),
        "stack_passes": len(distinct_stack_groups),
        "stack_size_breakdown": {str(k): v for k, v in sorted(stack_size_breakdown.items(), reverse=True)},
        "width_rip_count": width_rip_count,
        "width_rip_recovered_count": width_rip_recovered_count,
        "production_flow": [
            "rip_t0_standard_strips",
            "stack_length_cut_standard_pool",
            "cut_nonstandard_t0_strips",
            "cut_stretcher_phase",
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
