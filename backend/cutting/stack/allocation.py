"""
Source allocation for the stack-efficiency engine.

Decides which T0 / T1 source feeds each strip (or stretcher), including
width-rip from a wider stock and stretcher-from-T0-residual heuristics.
"""

from __future__ import annotations

from .constants import (
    BOARD_HEIGHT,
    FALLBACK_T1_BY_WIDTH,
    SAW_KERF,
    STACK_PREFERENCE,
    STANDARD_NARROW,
    STANDARD_WIDE,
    STANDARD_WIDTHS,
    STRETCHER_WIDTH,
    T0_WIDTH,
)
from .primitives import (
    _cut_length,
    _inventory_stock_for_width,
    _is_stretcher_width,
    _r1,
    _standard_board_type,
    _t0_board_type,
)
from .strips import _append_part_to_strip, _can_append_part
from .t0_packer import _append_strip_to_t0_sheet
from .recovery import _recovery_cost
from cutting.efficient.primitives import common_recovery_board_type


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


def _recovery_board_type(width: float, preferred: str | None = None) -> str:
    width = _r1(width)
    if preferred:
        return preferred
    return FALLBACK_T1_BY_WIDTH.get(width, common_recovery_board_type(width))


def _rip_recovery_entry(
    leftover: float,
    color: str,
    source_board_type: str | None = None,
    source_id: str | None = None,
) -> dict | None:
    """Return a full-length recovery candidate for a width-rip leftover."""
    width = _r1(leftover)
    if _stretcher_yield_for_width(width) <= 0:
        return None
    board_type = _recovery_board_type(width)
    return {
        "id": source_id or f"RC-T1-{color}-{board_type}",
        "source": "T1",
        "origin": "width_residual",
        "source_board_id": source_id,
        "source_board_type": source_board_type,
        "width": width,
        "length": BOARD_HEIGHT,
        "board_type": board_type,
        "type": board_type,
        "label": f"Recovered {width}×{BOARD_HEIGHT}mm (width-rip)",
        "color": color,
    }


def _stamp_rip_meta(strip: dict, src_width: float, target_width: float, color: str,
                    rip_recovered_out: list[dict], source_board_type: str | None = None) -> None:
    leftover = max(0.0, src_width - target_width - SAW_KERF)
    source_id = f"RC-T1-{color}-{source_board_type or _r1(src_width)}-{len(rip_recovered_out) + 1:03d}"
    recovery = _rip_recovery_entry(leftover, color, source_board_type=source_board_type, source_id=source_id)
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
) -> tuple[list[tuple[dict, str]], list[dict], list[dict]]:
    """Allocate strips to inventory or T0; mutates used_inventory/inventory_remaining.

    Order:
      a) exact-width T1 stock
      b) wider T1 stock with width-rip
      c) remainder → T0 candidates
    """
    if force_t0_start:
        return [], list(strips)

    inventory_strips: list[tuple[dict, str]] = []
    remaining = list(strips)

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
                _stamp_rip_meta(s, src_width, width, color, rip_recovered_out, source_board_type=src_bt)
                inventory_strips.append((s, src_bt))
            used_inventory[src_bt] = used_inventory.get(src_bt, 0) + take
            inventory_remaining[src_bt] = avail - take
            remaining = remaining[take:]

    return inventory_strips, remaining


def _source_board_waste(source_width: float, yield_count: int) -> float:
    kerfs = max(0, yield_count - 1) * SAW_KERF
    return round(max(0.0, source_width - yield_count * STRETCHER_WIDTH - kerfs), 1)


def _stretcher_yield_for_width(width: float) -> int:
    width = _r1(width)
    for lane_count in range(max(STACK_PREFERENCE), 0, -1):
        needed = lane_count * STRETCHER_WIDTH + max(0, lane_count - 1) * SAW_KERF
        if needed <= width + 1e-6:
            return lane_count
    return 0


def _available_stretcher_inventory_sources(inventory: dict, inventory_remaining: dict) -> list[tuple[float, str, int, int]]:
    sources: list[tuple[float, str, int, int]] = []
    for board_type, info in inventory.items():
        if str(board_type).upper().startswith("T0"):
            continue
        qty = inventory_remaining.get(board_type, int(info.get("qty", 0)))
        if qty <= 0:
            continue
        width = _r1(info.get("Width", 0))
        yield_count = _stretcher_yield_for_width(width)
        if yield_count <= 0:
            continue
        sources.append((width, board_type, qty, yield_count))
    sources.sort(key=lambda row: (row[0], row[1]))
    return sources


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


def _same_length_prefix_count(queue: list[dict]) -> int:
    if not queue:
        return 0
    cut_length = _r1(_cut_length(queue[0]["parts"][0]))
    count = 0
    for strip in queue:
        if _r1(_cut_length(strip["parts"][0])) != cut_length:
            break
        count += 1
    return count


def _max_parts_per_stretcher_lane(strip: dict, pending_same_length: list[dict], trim_loss: float) -> int:
    probe = {**strip, "parts": list(strip.get("parts", []))}
    count = len(probe["parts"])
    for pending in pending_same_length:
        if not _append_part_to_strip(probe, pending["parts"][0], trim_loss):
            break
        count += 1
    return count


def _choose_stretcher_stack_shape(queue: list[dict], max_lanes: int, trim_loss: float) -> tuple[int, int]:
    """Return (lane_count, parts_per_lane), preferring x4 same-pattern stacks."""
    same_count = _same_length_prefix_count(queue)
    if same_count <= 0 or max_lanes <= 0:
        return 0, 0

    capacity = _max_parts_per_stretcher_lane(queue[0], queue[1:same_count], trim_loss)
    for stack_size in STACK_PREFERENCE:
        lane_count = min(stack_size, max_lanes)
        if lane_count == stack_size and same_count >= lane_count:
            parts_per_lane = min(capacity, max(1, same_count // lane_count))
            return lane_count, parts_per_lane

    return 1, min(capacity, same_count)


def _pop_stretcher_stack_lanes(queue: list[dict], lane_count: int, parts_per_lane: int, trim_loss: float) -> list[dict]:
    lanes = [queue.pop(0) for _ in range(min(lane_count, len(queue)))]
    if not lanes:
        return []

    target_length = _r1(_cut_length(lanes[0]["parts"][0]))
    for lane in lanes:
        while (
            len(lane.get("parts", [])) < parts_per_lane
            and queue
            and _r1(_cut_length(queue[0]["parts"][0])) == target_length
            and _append_part_to_strip(lane, queue[0]["parts"][0], trim_loss)
        ):
            queue.pop(0)
    _append_stretcher_stack_batches(lanes, queue, trim_loss)
    _append_stretcher_partial_batches(lanes, queue, trim_loss)
    return lanes


def _append_stretcher_stack_batches(lanes: list[dict], queue: list[dict], trim_loss: float) -> None:
    """Append later length batches to the same stretcher stack pattern."""
    lane_count = len(lanes)
    if lane_count <= 0:
        return

    while len(queue) >= lane_count:
        cut_length = _r1(_cut_length(queue[0]["parts"][0]))
        batch = queue[:lane_count]
        if any(_r1(_cut_length(strip["parts"][0])) != cut_length for strip in batch):
            break
        if any(not _append_part_to_strip({**lane, "parts": list(lane.get("parts", []))}, strip["parts"][0], trim_loss)
               for lane, strip in zip(lanes, batch)):
            break
        for lane in lanes:
            _append_part_to_strip(lane, queue.pop(0)["parts"][0], trim_loss)


def _append_stretcher_partial_batches(lanes: list[dict], queue: list[dict], trim_loss: float) -> None:
    """Use stacked stretcher lanes for leftover paired length batches."""
    if not lanes:
        return

    while queue:
        cut_length = _r1(_cut_length(queue[0]["parts"][0]))
        same_count = _same_length_prefix_count(queue)
        if same_count < 2:
            break

        candidate_lanes = [
            lane for lane in lanes
            if _append_part_to_strip({**lane, "parts": list(lane.get("parts", []))}, queue[0]["parts"][0], trim_loss)
        ]
        take = min(same_count, len(candidate_lanes))
        if take % 2 == 1:
            take -= 1
        if take < 2:
            break

        for lane in candidate_lanes[:take]:
            if _r1(_cut_length(queue[0]["parts"][0])) != cut_length:
                break
            _append_part_to_strip(lane, queue.pop(0)["parts"][0], trim_loss)


def _sheet_order_cut_items(sheet: dict) -> int:
    return sum(0 if strip.get("t0_source_strip_secondary") else 1 for strip in sheet.get("strips", []))


def _sheet_recovery_disabled(sheet: dict, trim_loss: float) -> bool:
    usable_width = T0_WIDTH - 2 * trim_loss
    direct_no_recovery_threshold = usable_width - STANDARD_NARROW - SAW_KERF
    return any(
        strip["strip_width"] > direct_no_recovery_threshold + 1e-6
        for strip in sheet.get("strips", [])
    )


def _recovery_value_for_sheet(sheet: dict, trim_loss: float) -> tuple[float, float]:
    order_cut_items = _sheet_order_cut_items(sheet)
    recovered_widths = []
    if not _sheet_recovery_disabled(sheet, trim_loss):
        combos = [[STANDARD_NARROW, STANDARD_NARROW], [STANDARD_NARROW]]
        feasible = [
            combo for combo in combos
            if _recovery_cost(combo, order_cut_items) <= sheet["remaining"] + 1e-6
        ]
        if feasible:
            recovered_widths = max(feasible, key=lambda combo: (sum(combo), len(combo)))
    recovery_cost = _recovery_cost(recovered_widths, order_cut_items)
    return sum(recovered_widths), max(0.0, sheet["remaining"] - recovery_cost)


def _score_direct_stretcher_sheet(sheet: dict, trim_loss: float) -> tuple[float, float, float] | None:
    # Stretchers take priority over recovery: use raw remaining (not post-recovery)
    # to decide if a stretcher fits. Recovery runs in _finalize_t0_sheets *after*
    # all stretchers have been placed, so we must not pre-deduct recovery space here.
    needed = STRETCHER_WIDTH + (SAW_KERF if sheet.get("strips") else 0)
    if sheet["remaining"] < needed - 1e-6:
        return None

    # Compute how much recovery we lose by adding this stretcher (for ranking only).
    recovered_width, _ = _recovery_value_for_sheet(sheet, trim_loss)
    simulated = {
        **sheet,
        "remaining": sheet["remaining"] - needed,
        "strips": [*sheet.get("strips", []), {"strip_width": STRETCHER_WIDTH}],
    }
    after_recovered, after_waste = _recovery_value_for_sheet(simulated, trim_loss)
    recovery_loss = recovered_width - after_recovered
    return (recovery_loss, -after_recovered, after_waste)


def _best_direct_stretcher_sheet(sheets: list[dict], trim_loss: float) -> dict | None:
    candidates: list[tuple[tuple[float, float, float], int, dict]] = []
    for index, sheet in enumerate(sheets):
        score = _score_direct_stretcher_sheet(sheet, trim_loss)
        if score is not None:
            candidates.append((score, index, sheet))
    if not candidates:
        return None
    return min(candidates, key=lambda row: (row[0], row[1]))[2]


def _score_source_width_after_recovery(sheet: dict, source_width: float, trim_loss: float) -> tuple[float, float, float] | None:
    # Stretchers take priority over recovery: feasibility uses raw remaining.
    needed = source_width + (SAW_KERF if sheet.get("strips") else 0)
    if sheet["remaining"] < needed - 1e-6:
        return None

    recovered_width, _ = _recovery_value_for_sheet(sheet, trim_loss)
    simulated = {
        **sheet,
        "remaining": sheet["remaining"] - needed,
        "strips": [*sheet.get("strips", []), {"strip_width": source_width}],
    }
    after_recovered, after_waste = _recovery_value_for_sheet(simulated, trim_loss)
    recovery_loss = recovered_width - after_recovered
    return (recovery_loss, -after_recovered, after_waste)


def _sheet_stack_signature(sheet: dict) -> tuple[tuple[float, str], ...]:
    signature: list[tuple[float, str]] = []
    for strip in sheet.get("strips", []):
        if strip.get("t0_source_strip_secondary"):
            continue
        if _is_stretcher_width(strip.get("strip_width", 0)):
            continue
        signature.append((_r1(strip.get("strip_width", 0)), strip.get("pattern_key", "")))
    return tuple(signature)


def _sheet_stack_peer_count(sheet: dict, sheets: list[dict]) -> int:
    signature = _sheet_stack_signature(sheet)
    if not signature:
        return 0
    return sum(1 for candidate in sheets if _sheet_stack_signature(candidate) == signature)


def _best_direct_stretcher_sheet_group(
    sheets: list[dict],
    trim_loss: float,
    required_stack_size: int,
) -> list[dict]:
    if required_stack_size <= 1:
        sheet = _best_direct_stretcher_sheet(sheets, trim_loss)
        return [sheet] if sheet else []

    by_signature: dict[tuple[tuple[float, str], ...], list[tuple[tuple[float, float, float], int, dict]]] = {}
    for index, sheet in enumerate(sheets):
        signature = _sheet_stack_signature(sheet)
        if not signature:
            continue
        score = _score_direct_stretcher_sheet(sheet, trim_loss)
        if score is None:
            continue
        by_signature.setdefault(signature, []).append((score, index, sheet))

    candidates: list[tuple[tuple[float, float, float], int, list[dict]]] = []
    for group in by_signature.values():
        if len(group) < required_stack_size:
            continue
        ranked = sorted(group, key=lambda row: (row[0], row[1]))[:required_stack_size]
        aggregate = (
            sum(row[0][0] for row in ranked),
            sum(row[0][1] for row in ranked),
            sum(row[0][2] for row in ranked),
        )
        candidates.append((aggregate, ranked[0][1], [row[2] for row in ranked]))

    if not candidates:
        return []
    return min(candidates, key=lambda row: (row[0], row[1]))[2]


def _best_source_width_sheet(
    sheets: list[dict],
    source_width: float,
    trim_loss: float,
    required_stack_size: int = 1,
) -> dict | None:
    candidates: list[tuple[tuple[float, float, float], int, int, dict]] = []
    for index, sheet in enumerate(sheets):
        score = _score_source_width_after_recovery(sheet, source_width, trim_loss)
        if score is not None:
            peer_count = _sheet_stack_peer_count(sheet, sheets)
            if required_stack_size > 1 and peer_count < required_stack_size:
                continue
            candidates.append((score, -peer_count, index, sheet))
    if not candidates:
        return None
    return min(candidates, key=lambda row: (row[0], row[1], row[2]))[3]


def _place_stretcher_source_group_after_recovery(
    source_strips: list[dict],
    sheets: list[dict],
    trim_loss: float,
) -> None:
    if not source_strips:
        return

    primary = source_strips[0]
    for secondary in source_strips[1:]:
        secondary["t0_source_strip_secondary"] = True

    source_width = _r1(primary.get("t0_source_strip_width") or primary["strip_width"])
    sheet = _best_source_width_sheet(sheets, source_width, trim_loss, required_stack_size=len(source_strips))
    if sheet and _append_strip_to_t0_sheet(sheet, primary):
        x_position = primary.get("x_position", sheet["strips"][-1].get("x_position", 0.0))
        for secondary in source_strips[1:]:
            sheet["strips"].append({**secondary, "x_position": round(float(x_position), 1)})
        return

    usable_width = T0_WIDTH - 2 * trim_loss
    sheets.append({
        "remaining": usable_width - source_width,
        "next_x": source_width + SAW_KERF,
        "strips": [
            {**primary, "x_position": 0.0},
            *({**secondary, "x_position": 0.0} for secondary in source_strips[1:]),
        ],
    })


def _simulated_direct_stretcher_slots(sheets: list[dict], trim_loss: float, limit: int) -> int:
    simulated = [
        {
            "remaining": sheet["remaining"],
            "strips": [dict(strip) for strip in sheet.get("strips", [])],
        }
        for sheet in sheets
    ]
    slots = 0
    while slots < limit:
        sheet = _best_direct_stretcher_sheet(simulated, trim_loss)
        if sheet is None:
            break
        needed = STRETCHER_WIDTH + (SAW_KERF if sheet.get("strips") else 0)
        sheet["remaining"] -= needed
        sheet.setdefault("strips", []).append({"strip_width": STRETCHER_WIDTH})
        slots += 1
    return slots


def _can_host_nested_stretcher(lane: dict, part: dict, trim_loss: float) -> bool:
    """Allow stretchers to nest below other stretchers in 101.6mm lanes."""
    if not _is_stretcher_width(lane.get("strip_width", 0)):
        return False
    return _can_append_part(lane, part, trim_loss)


def _can_host_wider_nested_stretcher(lane: dict, part: dict, trim_loss: float) -> bool:
    """Fallback: allow stretchers to nest below wider parts like Back Panels."""
    lane_width = _r1(lane.get("strip_width", 0))
    if lane_width < STRETCHER_WIDTH + SAW_KERF:
        return False
    # Do not nest inside existing stretcher lanes (already handled by priority 1)
    if _is_stretcher_width(lane_width):
        return False
    return _can_append_part(lane, part, trim_loss)


def _same_length_run_count(queue: list[dict], start: int = 0) -> int:
    if start >= len(queue):
        return 0
    cut_length = _r1(_cut_length(queue[start]["parts"][0]))
    count = 0
    for strip in queue[start:]:
        if _r1(_cut_length(strip["parts"][0])) != cut_length:
            break
        count += 1
    return count


def _nested_receiver_groups(sheets: list[dict], part: dict, trim_loss: float, wider_fallback: bool = False) -> list[list[dict]]:
    groups: dict[str, list[dict]] = {}
    for sheet in sheets:
        for lane in sheet.get("strips", []):
            can_host = _can_host_wider_nested_stretcher(lane, part, trim_loss) if wider_fallback else _can_host_nested_stretcher(lane, part, trim_loss)
            if not can_host:
                continue
            key = lane.get("pattern_key", "")
            groups.setdefault(key, []).append(lane)
    return sorted(
        groups.values(),
        key=lambda lanes: (-len(lanes), _r1(lanes[0].get("strip_width", 0)), lanes[0].get("pattern_key", "")),
    )


def _append_nested_stretcher_round(lanes: list[dict], queue: list[dict], trim_loss: float, wider_fallback: bool = False) -> bool:
    if len(queue) < len(lanes):
        return False
    cut_length = _r1(_cut_length(queue[0]["parts"][0]))
    candidates = queue[:len(lanes)]
    if any(_r1(_cut_length(strip["parts"][0])) != cut_length for strip in candidates):
        return False
    
    for lane, strip in zip(lanes, candidates):
        can_host = _can_host_wider_nested_stretcher(lane, strip["parts"][0], trim_loss) if wider_fallback else _can_host_nested_stretcher(lane, strip["parts"][0], trim_loss)
        if not can_host:
            return False

    for lane in lanes:
        _append_part_to_strip(lane, queue.pop(0)["parts"][0], trim_loss)
        lane["nested_stretcher_phase"] = True
    return True


def _allocate_stretcher_from_length_residual(
    queue: list[dict],
    sheets: list[dict],
    trim_loss: float,
) -> None:
    """Put stretchers into length waste below existing T0 parts before using width waste."""
    while queue:
        placed = False
        same_count = _same_length_run_count(queue)

        for stack_size in STACK_PREFERENCE:
            if same_count < stack_size:
                continue
            for group in _nested_receiver_groups(sheets, queue[0]["parts"][0], trim_loss):
                if len(group) < stack_size:
                    continue
                lanes = group[:stack_size]
                if not _append_nested_stretcher_round(lanes, queue, trim_loss):
                    continue
                placed = True
                while _same_length_run_count(queue) >= stack_size:
                    if not _append_nested_stretcher_round(lanes, queue, trim_loss):
                        break
                break
            if placed:
                break

        if placed:
            continue

        for group in _nested_receiver_groups(sheets, queue[0]["parts"][0], trim_loss):
            lane = group[0]
            if _append_part_to_strip(lane, queue.pop(0)["parts"][0], trim_loss):
                lane["nested_stretcher_phase"] = True
                placed = True
                while queue and _can_host_nested_stretcher(lane, queue[0]["parts"][0], trim_loss):
                    _append_part_to_strip(lane, queue.pop(0)["parts"][0], trim_loss)
                break
        if not placed:
            break


def _allocate_stretcher_from_t0_residual(
    queue: list[dict],
    sheets: list[dict],
    color: str,
    trim_loss: float,
    source_counter: dict[str, int],
) -> list[dict]:
    allocated: list[dict] = []
    pending = list(queue)

    while pending:
        # First, pack as many pending stretchers as possible into EXISTING stretcher lanes
        placed_any = True
        while placed_any and pending:
            placed_any = False
            same_count = _same_length_prefix_count(pending)
            
            for stack_size in STACK_PREFERENCE:
                if same_count < stack_size:
                    continue
                for group in _nested_receiver_groups(sheets, pending[0]["parts"][0], trim_loss):
                    if len(group) < stack_size:
                        continue
                    lanes = group[:stack_size]
                    if not _append_nested_stretcher_round(lanes, pending, trim_loss):
                        continue
                    placed_any = True
                    while _same_length_prefix_count(pending) >= stack_size:
                        if not _append_nested_stretcher_round(lanes, pending, trim_loss):
                            break
                    break
                if placed_any:
                    break

            if placed_any:
                continue

            if same_count >= 1:
                for group in _nested_receiver_groups(sheets, pending[0]["parts"][0], trim_loss):
                    lane = group[0]
                    if _append_part_to_strip(lane, pending.pop(0)["parts"][0], trim_loss):
                        lane["stretcher_phase"] = True
                        placed_any = True
                        while pending and _can_host_nested_stretcher(lane, pending[0]["parts"][0], trim_loss):
                            _append_part_to_strip(lane, pending.pop(0)["parts"][0], trim_loss)
                        break

        if not pending:
            break

        # If we couldn't place the current front of the queue into existing lanes, create new lanes.
        same_count = _same_length_prefix_count(pending)
        target_sheets: list[dict] = []
        target_stack_sizes = (4, 2, 1) if same_count >= 2 else (1,)
        for target_stack_size in target_stack_sizes:
            if same_count < target_stack_size:
                continue
            target_sheets = _best_direct_stretcher_sheet_group(sheets, trim_loss, target_stack_size)
            if target_sheets:
                break

        if not target_sheets:
            # Fallback priority 3: Try placing into length waste of wider lanes (e.g. Back Panels)
            placed_any_wider = True
            while placed_any_wider and pending:
                placed_any_wider = False
                same_count = _same_length_prefix_count(pending)
                
                for stack_size in STACK_PREFERENCE:
                    if same_count < stack_size:
                        continue
                    for group in _nested_receiver_groups(sheets, pending[0]["parts"][0], trim_loss, wider_fallback=True):
                        if len(group) < stack_size:
                            continue
                        lanes = group[:stack_size]
                        if not _append_nested_stretcher_round(lanes, pending, trim_loss, wider_fallback=True):
                            continue
                        placed_any_wider = True
                        while _same_length_prefix_count(pending) >= stack_size:
                            if not _append_nested_stretcher_round(lanes, pending, trim_loss, wider_fallback=True):
                                break
                        break
                    if placed_any_wider:
                        break

                if placed_any_wider:
                    continue

                if same_count >= 1:
                    for group in _nested_receiver_groups(sheets, pending[0]["parts"][0], trim_loss, wider_fallback=True):
                        lane = group[0]
                        if _append_part_to_strip(lane, pending.pop(0)["parts"][0], trim_loss):
                            lane["nested_stretcher_phase"] = True
                            placed_any_wider = True
                            while pending and _can_host_wider_nested_stretcher(lane, pending[0]["parts"][0], trim_loss):
                                _append_part_to_strip(lane, pending.pop(0)["parts"][0], trim_loss)
                            break

            if not pending:
                break
            # If even wider fallback fails, we truly cannot place it on T0.
            break

        lane_count, parts_per_lane = _choose_stretcher_stack_shape(pending, len(target_sheets), trim_loss)
        source_strips = _pop_stretcher_stack_lanes(pending, lane_count, parts_per_lane, trim_loss)

        placed_count = 0
        for strip, sheet in zip(source_strips, target_sheets):
            source_counter["t0_direct"] += 1
            group_id = f"T0-DIRECT-{color}-{source_counter['t0_direct']:03d}"
            _stamp_stretcher_source(strip, STRETCHER_WIDTH, group_id, 1, t0_source=True)
            if _append_strip_to_t0_sheet(sheet, strip):
                allocated.append(strip)
                placed_count += 1
            else:
                for unplaced in reversed(source_strips[placed_count:]):
                    pending.insert(0, unplaced)
                break
        else:
            continue

        if placed_count < len(source_strips):
            break

    queue[:] = pending
    return allocated


def _allocate_stretcher_from_t0_width_residual(
    queue: list[dict],
    sheets: list[dict],
    color: str,
    trim_loss: float,
    source_counter: dict[str, int],
) -> list[dict]:
    """Place stretchers in the WIDTH residual of existing T0 sheets.

    After the length-residual pass nests stretchers below existing parts,
    some sheets still have unused width on the right (e.g. a 1036.8mm back
    panel leaves ~170mm — too narrow for 303.8 recovery, wide enough for
    a 101.6 stretcher rip). This phase opens new stretcher rip lanes there
    and length-nests as many same-length stretchers into each new lane as
    fit. No new T0 sheets are opened.
    """
    allocated: list[dict] = []
    if not queue:
        return allocated

    for sheet in sheets:
        while queue:
            kerf = SAW_KERF if sheet.get("strips") else 0.0
            if sheet["remaining"] < STRETCHER_WIDTH + kerf - 1e-6:
                break

            strip = queue[0]
            source_counter["t0_direct"] += 1
            group_id = f"T0-WIDTH-{color}-{source_counter['t0_direct']:03d}"
            _stamp_stretcher_source(strip, STRETCHER_WIDTH, group_id, 1, t0_source=True)

            if not _append_strip_to_t0_sheet(sheet, strip):
                break
            queue.pop(0)
            allocated.append(strip)

            lane = sheet["strips"][-1]
            base_length = _r1(_cut_length(lane["parts"][0]))
            while queue:
                next_part = queue[0]["parts"][0]
                if _r1(_cut_length(next_part)) != base_length:
                    break
                if not _can_host_nested_stretcher(lane, next_part, trim_loss):
                    break
                _append_part_to_strip(lane, next_part, trim_loss)
                queue.pop(0)

    return allocated


def _allocate_stretcher_from_inventory_width(
    queue: list[dict],
    width: float,
    yield_count: int,
    color: str,
    inventory: dict,
    trim_loss: float,
    used_inventory: dict,
    inventory_remaining: dict,
    source_counter: dict[str, int],
    board_type: str | None = None,
) -> list[tuple[dict, str]]:
    board_type = board_type or _standard_board_type(width, inventory)
    available = inventory_remaining.get(board_type, 0)
    allocated: list[tuple[dict, str]] = []
    while queue and available > 0:
        lane_count, parts_per_lane = _choose_stretcher_stack_shape(queue, yield_count, trim_loss)
        source_strips = _pop_stretcher_stack_lanes(queue, lane_count, parts_per_lane, trim_loss)
        if not source_strips:
            break
        source_counter["inventory"] += 1
        group_id = f"INV-STRETCHER-{color}-{board_type}-{source_counter['inventory']:03d}"
        for strip in source_strips:
            _stamp_stretcher_source(strip, width, group_id, yield_count, board_type=board_type)
            allocated.append((strip, board_type))
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
        same_count = _same_length_prefix_count(queue)
        yield_count = 4 if same_count >= 4 else 2
        source_width = STANDARD_WIDE if yield_count == 4 else STANDARD_NARROW
        lane_count, parts_per_lane = _choose_stretcher_stack_shape(queue, yield_count, trim_loss)
        source_counter["t0_standard"] += 1
        group_id = f"T0-STANDARD-{color}-{source_counter['t0_standard']:03d}"
        source_strips = _pop_stretcher_stack_lanes(queue, lane_count, parts_per_lane, trim_loss)

        for strip in source_strips:
            _stamp_stretcher_source(
                strip,
                source_width,
                group_id,
                yield_count,
                board_type=t0_board_type,
                t0_source=True,
            )
            allocated.append(strip)

        _place_stretcher_source_group_after_recovery(source_strips, sheets, trim_loss)
    return allocated


def _strip_length_signature(strip: dict) -> tuple[float, ...]:
    return tuple(_r1(_cut_length(part)) for part in strip.get("parts", []))


def _is_final_recovery_width(width: float) -> bool:
    width = _r1(width)
    return any(abs(width - standard) < 0.5 for standard in STANDARD_WIDTHS)


def _candidate_recovered_inventory_entry(candidate: dict) -> dict:
    width = _r1(candidate.get("width", 0))
    length = _r1(candidate.get("length", BOARD_HEIGHT))
    board_type = candidate.get("board_type") or _recovery_board_type(width)
    return {
        "id": candidate.get("id"),
        "width": width,
        "length": length,
        "board_type": board_type,
        "type": board_type,
        "label": candidate.get("label") or f"Recovered {width}×{length}mm",
        "color": candidate.get("color"),
        "source": candidate.get("source"),
        "source_board_id": candidate.get("source_board_id"),
        "origin": candidate.get("origin", "width_residual"),
    }


def _recovery_cut_board_signature(board: dict) -> tuple:
    lane_sig = tuple(
        tuple(_r1(_cut_length(part)) for part in lane.get("parts", []))
        for lane in board.get("lanes", [])
    )
    return (
        _r1(board.get("width", 0)),
        _r1(board.get("length", 0)),
        lane_sig,
        _r1(board.get("inline_waste_width", 0)),
    )


def _stamp_recovery_cut_stacks(recovery_boards: list[dict]) -> None:
    by_sig: dict[tuple, list[dict]] = {}
    for board in recovery_boards:
        if board.get("status") != "used":
            continue
        by_sig.setdefault(_recovery_cut_board_signature(board), []).append(board)

    for sig_idx, boards in enumerate(by_sig.values(), start=1):
        cursor = 0
        while cursor < len(boards):
            take = min(max(STACK_PREFERENCE), len(boards) - cursor)
            stack_id = f"REC-STACK-{sig_idx:03d}-{cursor // max(STACK_PREFERENCE) + 1:02d}"
            for layer, board in enumerate(boards[cursor:cursor + take]):
                board["stack_group_id"] = stack_id
                board["stack_size"] = take
                board["stack_layer"] = layer
                for lane in board.get("lane_strips", []):
                    lane["stack_group_id"] = stack_id
                    lane["stack_size"] = take
                    lane["stack_layer"] = layer
                    lane["stack_context_key"] = stack_id
            cursor += take


def _allocate_stretcher_from_recovery_candidates(
    queue: list[dict],
    candidates: list[dict],
    color: str,
    trim_loss: float,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    """Cut remaining stretchers from full-length recovery candidates.

    Returns (lane_strips, recovery_cutting_boards, final_recovered_inventory,
    still_unplaced). Used candidates show yellow stretcher lanes and inline
    waste; unused candidates stay green and become final recovered inventory.
    """
    recovery_boards: list[dict] = []
    lane_strips: list[dict] = []
    final_recovered: list[dict] = []
    sorted_candidates = sorted(
        candidates,
        key=lambda c: (
            _r1(c.get("width", 0)),
            str(c.get("source", "")),
            str(c.get("id", "")),
        ),
    )

    for idx, candidate in enumerate(sorted_candidates, start=1):
        width = _r1(candidate.get("width", 0))
        length = _r1(candidate.get("length", BOARD_HEIGHT))
        yield_count = _stretcher_yield_for_width(width)
        board_id = candidate.get("id") or f"RC-{color}-{idx:03d}"
        board_type = candidate.get("board_type") or _recovery_board_type(width)
        base_entry = {
            "id": board_id,
            "source": candidate.get("source", "recovery"),
            "origin": candidate.get("origin", "width_residual"),
            "source_board_id": candidate.get("source_board_id"),
            "source_board_type": candidate.get("source_board_type"),
            "board_type": board_type,
            "color": candidate.get("color", color),
            "width": width,
            "length": length,
            "label": candidate.get("label") or f"Recovered {width}×{length}mm",
            "yield_count": yield_count,
        }

        if not queue or yield_count <= 0:
            final_recovered.append(_candidate_recovered_inventory_entry({**candidate, "id": board_id, "board_type": board_type}))
            recovery_boards.append({
                **base_entry,
                "status": "unused",
                "lanes": [],
                "lane_strips": [],
                "inline_waste_width": 0,
                "recovered_inventory": [_candidate_recovered_inventory_entry({**candidate, "id": board_id, "board_type": board_type})],
            })
            continue

        lane_count, parts_per_lane = _choose_stretcher_stack_shape(queue, yield_count, trim_loss)
        source_strips = _pop_stretcher_stack_lanes(queue, lane_count, parts_per_lane, trim_loss)
        if not source_strips:
            final_recovered.append(_candidate_recovered_inventory_entry({**candidate, "id": board_id, "board_type": board_type}))
            recovery_boards.append({
                **base_entry,
                "status": "unused",
                "lanes": [],
                "lane_strips": [],
                "inline_waste_width": 0,
                "recovered_inventory": [_candidate_recovered_inventory_entry({**candidate, "id": board_id, "board_type": board_type})],
            })
            continue

        group_id = f"REC-STRETCHER-{color}-{idx:03d}"
        lanes = []
        for lane_idx, strip in enumerate(source_strips):
            _stamp_stretcher_source(strip, width, group_id, yield_count, board_type=board_type)
            strip["source"] = "recovery"
            strip["recovery_cutting_board_id"] = board_id
            strip["recovery_source_board_id"] = candidate.get("source_board_id")
            strip["recovery_origin"] = candidate.get("origin", "width_residual")
            strip["recovery_lane_index"] = lane_idx
            strip["color"] = candidate.get("color", color)
            lane_strips.append(strip)
            lanes.append({
                "lane_index": lane_idx,
                "x_position": _r1(lane_idx * (STRETCHER_WIDTH + SAW_KERF)),
                "width": STRETCHER_WIDTH,
                "parts": strip.get("parts", []),
                "used_length": _r1(sum(_cut_length(part) for part in strip.get("parts", [])) + max(0, len(strip.get("parts", [])) - 1) * SAW_KERF),
                "length_signature": list(_strip_length_signature(strip)),
            })

        used_width = len(source_strips) * STRETCHER_WIDTH + max(0, len(source_strips) - 1) * SAW_KERF
        recovery_boards.append({
            **base_entry,
            "status": "used",
            "lanes": lanes,
            "lane_strips": source_strips,
            "inline_waste_width": _r1(max(0.0, width - used_width)),
            "recovered_inventory": [],
        })

    _stamp_recovery_cut_stacks(recovery_boards)
    for board in recovery_boards:
        board.pop("lane_strips", None)
    return lane_strips, recovery_boards, final_recovered, list(queue)


def _waste_category_order(width: float) -> tuple[int, float]:
    width = _r1(width)
    if width < 90:
        return (99, width)
    if width < 8 * 25.4:
        return (0, width)
    if width < 12 * 25.4:
        return (1, width)
    if width < 18 * 25.4:
        return (2, width)
    if width <= 24 * 25.4:
        return (3, width)
    return (99, width)


def _waste_lane_width(width: float) -> float:
    width = _r1(width)
    return width if width < STRETCHER_WIDTH else STRETCHER_WIDTH


def _waste_lane_count(width: float) -> int:
    width = _r1(width)
    if width < 90 or width > 24 * 25.4:
        return 0
    if width < STRETCHER_WIDTH:
        return 1
    lane_count = 0
    used = 0.0
    while True:
        next_used = used + (SAW_KERF if lane_count > 0 else 0.0) + STRETCHER_WIDTH
        if next_used > width + 1e-6:
            break
        lane_count += 1
        used = next_used
    return lane_count


def _pop_fitting_stretcher(queue: list[dict], max_length: float, current_used: float = 0.0) -> dict | None:
    for idx, strip in enumerate(queue):
        part_len = _cut_length(strip["parts"][0])
        needed = part_len if current_used <= 0 else current_used + SAW_KERF + part_len
        if needed <= max_length + 1e-6:
            return queue.pop(idx)
    return None


def _append_fitting_stretchers_from_queue(strip: dict, queue: list[dict], max_length: float) -> None:
    while queue:
        current_used = sum(_cut_length(part) for part in strip.get("parts", [])) + max(0, len(strip.get("parts", [])) - 1) * SAW_KERF
        found_idx = None
        for idx, candidate in enumerate(queue):
            part = candidate["parts"][0]
            if current_used + SAW_KERF + _cut_length(part) <= max_length + 1e-6:
                found_idx = idx
                break
        if found_idx is None:
            return
        strip["parts"].append(queue.pop(found_idx)["parts"][0])
        lengths = sorted((_r1(_cut_length(part)) for part in strip.get("parts", [])), reverse=True)
        strip["pattern_key"] = f"WASTE-STRETCHER|{_r1(strip['strip_width'])}|{'+'.join(str(length) for length in lengths)}|{len(lengths)}"


def _allocate_stretcher_from_waste_candidates(
    queue: list[dict],
    candidates: list[dict],
    color: str,
) -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    waste_boards: list[dict] = []
    lane_strips: list[dict] = []
    remaining_waste: list[dict] = []

    sorted_candidates = sorted(
        candidates,
        key=lambda c: (
            _waste_category_order(c.get("width", 0)),
            _r1(c.get("length", BOARD_HEIGHT)),
            str(c.get("id", "")),
        ),
    )

    for idx, candidate in enumerate(sorted_candidates, start=1):
        width = _r1(candidate.get("width", 0))
        length = _r1(candidate.get("length", BOARD_HEIGHT))
        lane_width = _waste_lane_width(width)
        lane_capacity = _waste_lane_count(width)
        board_id = candidate.get("id") or f"WASTE-{color}-{idx:03d}"
        base_entry = {
            "id": board_id,
            "source": "waste",
            "origin": candidate.get("origin", "waste"),
            "source_board_id": candidate.get("source_board_id"),
            "source_board_type": candidate.get("source_board_type"),
            "board_type": candidate.get("board_type") or f"WASTE-{width}x{length}",
            "color": candidate.get("color", color),
            "width": width,
            "length": length,
            "label": candidate.get("label") or f"Waste {width}×{length}mm",
            "yield_count": lane_capacity,
        }

        source_strips: list[dict] = []
        lanes = []
        if queue and lane_capacity > 0:
            for lane_idx in range(lane_capacity):
                strip = _pop_fitting_stretcher(queue, length)
                if not strip:
                    break
                strip["strip_width"] = lane_width
                strip["parts"] = [
                    {**part, "cut_width": lane_width}
                    for part in strip.get("parts", [])
                ]
                strip["source"] = "recovery"
                strip["stretcher_phase"] = True
                strip["source_stock_group_id"] = f"WASTE-STRETCHER-{color}-{idx:03d}"
                strip["source_stock_width"] = width
                strip["source_stock_board_type"] = base_entry["board_type"]
                strip["source_stock_yield_count"] = lane_capacity
                strip["source_stock_waste_width"] = _r1(max(0.0, width - (lane_capacity * lane_width + max(0, lane_capacity - 1) * SAW_KERF)))
                strip["recovery_cutting_board_id"] = board_id
                strip["recovery_source_board_id"] = candidate.get("source_board_id")
                strip["recovery_origin"] = candidate.get("origin", "waste")
                strip["recovery_lane_index"] = lane_idx
                strip["color"] = candidate.get("color", color)
                _append_fitting_stretchers_from_queue(strip, queue, length)
                strip["parts"] = [
                    {**part, "cut_width": lane_width}
                    for part in strip.get("parts", [])
                ]
                source_strips.append(strip)
                lane_strips.append(strip)
                used_length = sum(_cut_length(part) for part in strip.get("parts", [])) + max(0, len(strip.get("parts", [])) - 1) * SAW_KERF
                lanes.append({
                    "lane_index": lane_idx,
                    "x_position": _r1(lane_idx * (lane_width + SAW_KERF)),
                    "width": lane_width,
                    "parts": strip.get("parts", []),
                    "used_length": _r1(used_length),
                    "length_signature": list(_strip_length_signature(strip)),
                })

        if lanes:
            used_width = len(lanes) * lane_width + max(0, len(lanes) - 1) * SAW_KERF
            waste_boards.append({
                **base_entry,
                "status": "used",
                "lanes": lanes,
                "inline_waste_width": _r1(max(0.0, width - used_width)),
                "recovered_inventory": [],
            })
        else:
            remaining_waste.append({**base_entry, "kind": candidate.get("kind", candidate.get("origin", "waste"))})

    return lane_strips, waste_boards, remaining_waste, list(queue)


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

    queue = sorted(
        list(stretcher_strips),
        key=lambda strip: (_cut_length(strip["parts"][0]), strip["parts"][0].get("part_id", "")),
        reverse=True,
    )

    # New production rule: T1/T0 main-layout regions are cut first and their
    # full-length leftovers become recovery candidates. Stretchers are never
    # nested into main-strip length waste, including Back Panel leftovers.
    return inventory_allocated, t0_allocated, list(queue)
