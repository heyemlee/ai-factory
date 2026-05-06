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
    stretcher_combos = [
        [STRETCHER_WIDTH, STRETCHER_WIDTH, STRETCHER_WIDTH, STRETCHER_WIDTH],
        [STRETCHER_WIDTH, STRETCHER_WIDTH, STRETCHER_WIDTH],
        [STRETCHER_WIDTH, STRETCHER_WIDTH],
        [STRETCHER_WIDTH],
    ]
    combos = stretcher_combos if disabled else [
        [STANDARD_NARROW, STANDARD_NARROW],
        [STANDARD_NARROW, STRETCHER_WIDTH, STRETCHER_WIDTH, STRETCHER_WIDTH],
        [STANDARD_NARROW, STRETCHER_WIDTH, STRETCHER_WIDTH],
        [STANDARD_NARROW, STRETCHER_WIDTH],
        [STANDARD_NARROW],
        *stretcher_combos,
    ]
    feasible = [
        combo for combo in combos
        if _recovery_cost(combo, existing_strip_count) <= remaining + 1e-6
    ]
    if not feasible:
        return []
    return max(feasible, key=lambda combo: (combo.count(STANDARD_NARROW), sum(combo), len(combo)))


def _t0_strip_source_width(strip: dict) -> float:
    return _r1(strip.get("t0_source_strip_width") or strip["strip_width"])


def _t0_strip_consumed_width(strip: dict) -> float:
    if strip.get("t0_source_strip_secondary"):
        return 0.0
    return _t0_strip_source_width(strip)
