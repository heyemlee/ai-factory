"""
T0 sheet packing for the stack-efficiency engine.

Packs strips onto T0 sheets, finalizes the per-sheet plan with recovered
strips, builds color-scoped inventory views, and bundles strips into stacks.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .constants import (
    BOARD_HEIGHT,
    SAW_KERF,
    STACK_PREFERENCE,
    STANDARD_NARROW,
    T0_WIDTH,
)
from .primitives import _r1, _t0_board_type
from .recovery import (
    _choose_recovery_combo,
    _recovery_cost,
    _recovery_options_for_inventory,
    _t0_strip_consumed_width,
    _t0_strip_source_width,
)

from cutting.efficient import DEFAULT_BOX_COLOR


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
        context = strip.get("stack_context_key", "")
        by_pattern[f"{context}||{strip.get('pattern_key', '')}"].append(strip)

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
                    strip["stack_pattern_key"] = strip.get("pattern_key", pattern)
                    bundled.append(strip)
                stack_idx += 1
                cursor += size
    return bundled
