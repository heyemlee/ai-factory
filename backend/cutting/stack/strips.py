"""
Strip building & manipulation for the stack-efficiency cutting engine.

Builds stack-first strips, stretcher lanes, length-packs into capacity, and
converts strips into the unified board-result format.
"""

from __future__ import annotations

from collections import defaultdict

from cutting.efficient import DEFAULT_BOX_COLOR

from .constants import (
    BOARD_HEIGHT,
    SAW_KERF,
    STACK_PREFERENCE,
    STRETCHER_WIDTH,
    T0_WIDTH,
)
from .primitives import _cut_length, _cut_width, _normalize_part, _r1


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
