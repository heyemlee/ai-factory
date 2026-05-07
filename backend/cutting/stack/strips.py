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


def _remaining_parts_count(queues: dict[float, list[dict]]) -> int:
    return sum(len(queue) for queue in queues.values())


def _append_symmetric_batches(
    lanes: list[dict],
    queues: dict[float, list[dict]],
    sorted_lengths: list[float],
    trim_loss: float,
) -> None:
    """Top up every lane in lockstep so they end with identical content.

    Pops are always batches of exactly ``len(lanes)``. A length whose remaining
    count is below ``lane_count`` (or whose next part will not fit on every
    lane) is skipped — it stays queued for a later, smaller-lane group.
    """
    lane_count = len(lanes)
    if lane_count <= 0:
        return

    changed = True
    while changed:
        changed = False
        for length in sorted_lengths:
            queue = queues[length]
            while len(queue) >= lane_count:
                if not all(_can_append_part(lane, queue[0], trim_loss) for lane in lanes):
                    break
                for lane in lanes:
                    _append_part_to_strip(lane, queue.pop(0), trim_loss)
                changed = True


def _build_stack_aligned_lanes(width: float, parts: list[dict], color: str, trim_loss: float) -> list[dict]:
    """Build stack-aligned lanes with **pair-symmetric** content.

    Strategy (叠切优先 + 同图案配对):
    Each iteration produces a group of identical lanes (4, 2, or 1) so the
    downstream bundler can stack them as ×4 or ×2 by ``pattern_key`` match.

    1.  Pick the longest length whose remaining queue has ≥ 2 parts. If only
        singletons remain, fall back to length-by-length emission.
    2.  Choose ``lane_count`` (4 / 2 / 1) from the remaining count of that
        length: 4 when the queue can fully feed four strips at this length's
        capacity, 2 when ≥ 2 parts remain, else 1 (singleton).
    3.  Seed every lane with one part of the base length, then top up across
        ALL lanes in lockstep — every pop is a batch of exactly ``lane_count``
        parts. A length whose remaining count is below ``lane_count`` is
        deferred to a later, smaller-lane iteration.

    Consequence: every lane in a group ends with the same length multiset →
    same ``pattern_key``. ``_bundle_into_stacks`` then forms an x4 or x2 stack
    automatically. Odd leftovers fall through to a singleton iteration.
    """
    queues: dict[float, list[dict]] = defaultdict(list)
    for part in parts:
        queues[_r1(_cut_length(part))].append(part)
    for queue in queues.values():
        queue.sort(key=lambda part: part.get("part_id", ""))

    sorted_lengths = sorted(queues.keys(), reverse=True)
    packed: list[dict] = []

    while _remaining_parts_count(queues) > 0:
        base_length = next((length for length in sorted_lengths if len(queues[length]) >= 2), None)
        if base_length is None:
            base_length = next((length for length in sorted_lengths if queues[length]), None)
        if base_length is None:
            break

        base_queue = queues[base_length]
        capacity, _no_trim, _usable_length = _strip_capacity(base_length, trim_loss)
        base_count = len(base_queue)

        # Pair-symmetric lane count. Use x4 only when the base length has
        # enough parts to fully feed four lanes at its per-lane capacity;
        # otherwise prefer x2, falling back to a singleton when only one
        # part of this length remains.
        if base_count >= 4 * capacity:
            lane_count = 4
        elif base_count >= 2:
            lane_count = 2
        else:
            lane_count = 1

        lanes = [_new_lane_strip(width, base_queue.pop(0), color, trim_loss) for _ in range(lane_count)]

        # Fill the base length symmetrically: pop in batches of lane_count.
        while len(base_queue) >= lane_count and \
                all(_can_append_part(lane, base_queue[0], trim_loss) for lane in lanes):
            for lane in lanes:
                _append_part_to_strip(lane, base_queue.pop(0), trim_loss)

        # Top-up with other lengths, also strictly in batches of lane_count.
        _append_symmetric_batches(lanes, queues, sorted_lengths, trim_loss)
        packed.extend(lanes)

    return packed


def _repack_t0_strips_by_width(strips: list[dict], color: str, trim_loss: float) -> list[dict]:
    """Repack strips by width for stack-aligned cutting.

    Build same-width lanes as 4/2/1 stackable length sequences first, then
    append later lengths in full or paired batches where they fit.
    """
    by_width: dict[float, list[dict]] = defaultdict(list)
    for strip in strips:
        by_width[_r1(strip["strip_width"])].extend(strip.get("parts", []))

    packed: list[dict] = []
    for width in sorted(by_width.keys(), reverse=True):
        packed.extend(_build_stack_aligned_lanes(width, by_width[width], color, trim_loss))
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
        "nested_stretcher_phase",
        "stack_context_key",
        "source_stock_group_id",
        "source_stock_width",
        "source_stock_board_type",
        "source_stock_yield_count",
        "source_stock_waste_width",
        "recovery_cutting_board_id",
        "recovery_source_board_id",
        "recovery_origin",
        "recovery_lane_index",
    ):
        if key in strip:
            board[key] = strip[key]

    return board
