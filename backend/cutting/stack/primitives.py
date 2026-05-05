"""
Shared primitives for the stack-efficiency cutting engine.

Cut-dimension accessors, width classifiers, board-type lookups, and part
normalization.
"""

from __future__ import annotations

from .constants import (
    FALLBACK_T0,
    FALLBACK_T1_BY_WIDTH,
    STANDARD_WIDTHS,
    STRETCHER_WIDTH,
    T0_WIDTH,
)


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
