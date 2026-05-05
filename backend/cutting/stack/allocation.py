"""
Source allocation for the stack-efficiency engine.

Decides which T0 / T1 source feeds each strip (or stretcher), including
width-rip from a wider stock and stretcher-from-T0-residual heuristics.
"""

from __future__ import annotations

from .constants import (
    FALLBACK_T1_BY_WIDTH,
    SAW_KERF,
    STANDARD_NARROW,
    STANDARD_WIDE,
    STANDARD_WIDTHS,
    STRETCHER_WIDTH,
)
from .primitives import (
    _cut_length,
    _inventory_stock_for_width,
    _is_standard_width,
    _is_stretcher_width,
    _r1,
    _standard_board_type,
    _t0_board_type,
)
from .strips import _append_part_to_strip
from .t0_packer import _append_strip_to_t0_sheet, _place_stretcher_source_group_on_t0


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
