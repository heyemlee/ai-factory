"""
T0 sheet packing for the stack-efficiency engine.

Packs strips onto T0 sheets, merges identical-pattern sheets into stacked
groups (叠切), finalizes the per-sheet plan with recovered strips, builds
color-scoped inventory views, and bundles strips into stacks.
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


def _t0_sheet_rip_signature(sheet: dict) -> tuple[tuple[float, str], ...]:
    """Compute a full identity signature for a T0 sheet.

    Two sheets share a signature only when both rip widths AND length-cut
    patterns match in the same order. This matches the physical machine
    constraint where stacked sheets go through both rip and cross-cut as
    a single bundled operation — so every layer must produce the same
    parts in the same positions, not just share rip widths.
    """
    sig: list[tuple[float, str]] = []
    for strip in sheet.get("strips", []):
        if strip.get("t0_source_strip_secondary"):
            continue
        sig.append((_r1(strip["strip_width"]), str(strip.get("pattern_key", ""))))
    return tuple(sig)


def _merge_stackable_t0_sheets(sheets: list[dict], max_stack: int = 2) -> list[dict]:
    """Merge T0 sheets with identical rip signatures into stacked groups.

    When two (or more) T0 sheets share the exact same strip layout —
    same widths, same pattern keys in the same order — they can be cut
    together by physically stacking the raw T0 sheets (叠切 ×N).

    The merged entry keeps the strips from the **first** sheet as the
    representative pattern and stores the additional layers' strips in
    ``t0_stacked_layers``.  ``t0_sheet_stack`` records the total layer
    count so downstream code knows how many physical raw sheets this
    entry consumes.
    """
    if max_stack < 2:
        return sheets

    from collections import defaultdict as _dd
    by_sig: dict[tuple[float, ...], list[int]] = _dd(list)
    for idx, sheet in enumerate(sheets):
        sig = _t0_sheet_rip_signature(sheet)
        by_sig[sig].append(idx)

    merged: list[dict] = []
    consumed: set[int] = set()

    for sig, indices in by_sig.items():
        remaining_indices = [i for i in indices if i not in consumed]
        cursor = 0
        while cursor < len(remaining_indices):
            # Prefer stack of max_stack; fall back to singles
            take = min(max_stack, len(remaining_indices) - cursor)
            group_indices = remaining_indices[cursor:cursor + take]
            cursor += take

            primary = sheets[group_indices[0]]
            consumed.add(group_indices[0])

            if take == 1:
                primary["t0_sheet_stack"] = 1
                merged.append(primary)
                continue

            # Merge: primary keeps its strips; stacked layers are stored
            stacked_layers: list[list[dict]] = []
            for layer_idx in group_indices[1:]:
                consumed.add(layer_idx)
                stacked_layers.append(sheets[layer_idx]["strips"])

            primary["t0_sheet_stack"] = take
            primary["t0_stacked_layers"] = stacked_layers
            merged.append(primary)

    return merged


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

    recovery_types = _recovery_options_for_inventory(inventory)
    t0_sheets = []
    recovered_inventory = []
    # Track how many physical T0 sheets each entry consumes for correct
    # sheet_id assignment (stacked entries consume >1 raw sheet).
    physical_sheet_counter = 0

    for sheet in sheets:
        stack_count = sheet.get("t0_sheet_stack", 1)
        physical_sheet_counter += 1
        sheet_id = f"{t0_board_type}-{color}-{t0_id_offset + physical_sheet_counter:03d}"

        # -- primary layer strips (representative pattern) --
        order_strips = sheet["strips"]
        order_cut_items = sum(0 if strip.get("t0_source_strip_secondary") else 1 for strip in order_strips)
        recovered_widths = _choose_recovery_combo(
            sheet["remaining"],
            order_cut_items,
            disabled=False,
        )
        recovery_cost = _recovery_cost(recovered_widths, order_cut_items)
        sheet["remaining"] -= recovery_cost

        # Recovery rips run the full effective board height. If any main strip
        # on this sheet needs no_trim (a part longer than usable), the saw is
        # already set up that way and the rip uses BOARD_HEIGHT.
        sheet_no_trim = any(strip.get("no_trim") for strip in order_strips)
        recovered_length = round(BOARD_HEIGHT if sheet_no_trim else BOARD_HEIGHT - 2 * trim_loss, 1)

        recovered_strips = []
        for width in recovered_widths:
            board_type = recovery_types[width]
            recovered = {
                "width": width,
                "length": recovered_length,
                "board_type": board_type,
                "type": board_type,
                "label": f"Recovered {width}×{recovered_length}mm",
                "color": color,
            }
            recovered_strips.append(recovered)
            # Each stacked layer also produces these recovered strips.
            for _ in range(stack_count):
                recovered_inventory.append(dict(recovered))

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

        # Stamp stacked-layer strips with the same sheet_id so the frontend
        # renders them as part of the same T0 sheet group.
        stacked_layers = sheet.get("t0_stacked_layers", [])
        for layer_strips in stacked_layers:
            for idx, strip in enumerate(layer_strips):
                strip["t0_sheet_id"] = sheet_id
                strip["t0_sheet_index"] = idx
                strip["t0_strip_position"] = strip.get("x_position", 0.0)
                strip["t0_total_strips_on_sheet"] = len(order_strips)
                strip["t0_all_strips"] = all_strips_info
                strip["t0_remaining_width"] = round(max(sheet["remaining"], 0), 1)

        order_width = sum(_t0_strip_consumed_width(strip) for strip in order_strips)
        recovered_width = sum(recovered_widths)
        total_cut_items = order_cut_items + len(recovered_widths)
        kerf_loss = max(0, total_cut_items - 1) * SAW_KERF
        useful_width = order_width + recovered_width
        utilization = useful_width * BOARD_HEIGHT / (T0_WIDTH * BOARD_HEIGHT)

        sheet_entry: dict[str, Any] = {
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
        }
        if stack_count > 1:
            sheet_entry["t0_sheet_stack"] = stack_count
        t0_sheets.append(sheet_entry)

    # Collect ALL strips: primary + stacked layers
    all_t0_strips = []
    for sheet in sheets:
        all_t0_strips.extend(sheet["strips"])
        for layer_strips in sheet.get("t0_stacked_layers", []):
            all_t0_strips.extend(layer_strips)

    return {
        "t0_board_type": t0_board_type,
        "t0_sheets": t0_sheets,
        "t0_strips": all_t0_strips,
        "recovered_inventory": recovered_inventory,
    }


def _pack_t0_sheets(strips: list[dict], color: str, inventory: dict, trim_loss: float, t0_id_offset: int) -> dict:
    sheets = _build_t0_sheet_pack(strips, trim_loss)
    sheets = _merge_stackable_t0_sheets(sheets)
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
