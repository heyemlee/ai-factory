"""
Recovery-combo selection helpers for the stack-efficiency engine.

Decides which standard-width strips can be reclaimed from a T0 sheet's
remaining budget without breaking stackability.
"""

from __future__ import annotations

from .constants import (
    FALLBACK_T1_BY_WIDTH,
    SAW_KERF,
    STANDARD_NARROW,
    STRETCHER_WIDTH,
)
from .primitives import _r1


def _recovery_options_for_inventory(inventory: dict) -> dict[float, str]:
    """Return mapping of recoverable width → board_type.

    Capacity-driven recovery: any width residual that fits 303.8mm or
    101.6mm produces a recovered offcut for inventory, regardless of
    current order demand. The order's stretcher demand is consumed by
    the allocation phase first; recovery here uses whatever width is
    left.
    """
    options: dict[float, str] = {
        STANDARD_NARROW: FALLBACK_T1_BY_WIDTH[STANDARD_NARROW],
        STRETCHER_WIDTH: f"T1-{STRETCHER_WIDTH}x2438.4",
    }
    for board_type, info in inventory.items():
        if str(board_type).upper().startswith("T0"):
            continue
        width = _r1(info.get("Width", 0))
        if width in (STANDARD_NARROW, STRETCHER_WIDTH):
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
    """Greedy capacity recovery: rip 303.8mm + 101.6mm from width residual.

    Iterates widths largest-first. While ``width + (kerf if any prior strip)``
    fits the remaining budget, append it and decrement. With only two candidate
    widths (303.8, 101.6), greedy-largest-first is optimal — a 303.8 strip is
    more valuable as inventory than the ~3 × 101.6 it could be replaced with.

    The ``disabled`` parameter is retained for signature stability; callers
    pass ``False`` now that 101.6 keeps recoveries useful even next to wide
    main strips.
    """
    if disabled:
        return []

    chosen: list[float] = []
    cnt = existing_strip_count
    budget = remaining
    for width in (STANDARD_NARROW, STRETCHER_WIDTH):
        while True:
            kerf = SAW_KERF if cnt > 0 else 0.0
            cost = width + kerf
            if cost > budget + 1e-6:
                break
            chosen.append(width)
            budget -= cost
            cnt += 1
    return chosen


def _t0_strip_source_width(strip: dict) -> float:
    return _r1(strip.get("t0_source_strip_width") or strip["strip_width"])


def _t0_strip_consumed_width(strip: dict) -> float:
    if strip.get("t0_source_strip_secondary"):
        return 0.0
    return _t0_strip_source_width(strip)
