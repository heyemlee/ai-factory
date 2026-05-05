"""
Shared primitives for the efficient cutting engine.

Cut dimension accessors, trim policy helpers, and board-type/recovery
naming conventions.
"""

from .constants import (
    BOARD_HEIGHT,
    EDGE_BANDED_RECOVERY_WIDTHS,
    HEIGHT_TRIM_THRESHOLD,
    TRIM_LOSS,
)


def _cut_length(part: dict) -> float:
    return float(part.get("cut_length") or part.get("Height") or 0)


def _cut_width(part: dict) -> float:
    return float(part.get("cut_width") or part.get("Width") or 0)


def strip_usable_height(parts) -> float:
    """Usable Height for a strip given its parts.

    Default: both short edges trimmed (BOARD_HEIGHT - 2 * TRIM_LOSS).
    If any part needs Height > HEIGHT_TRIM_THRESHOLD, skip short-edge
    trimming so the part fits — operator trims long edges only.
    """
    if any(_cut_length(p) > HEIGHT_TRIM_THRESHOLD for p in parts):
        return float(BOARD_HEIGHT)
    return float(BOARD_HEIGHT - 2 * TRIM_LOSS)


def strip_height_trim(parts) -> float:
    """Total short-edge trim mm applied to this strip (0 or 2 * TRIM_LOSS)."""
    if any(_cut_length(p) > HEIGHT_TRIM_THRESHOLD for p in parts):
        return 0.0
    return float(2 * TRIM_LOSS)


def _format_width_for_code(width: float) -> str:
    text = f"{float(width):.1f}"
    return text[:-2] if text.endswith(".0") else text


def common_recovery_board_type(width: float) -> str:
    return f"T1-{_format_width_for_code(width)}x2438.4"


def _width_from_board_type(board_type: str) -> float | None:
    try:
        return float(str(board_type).split("T1-", 1)[1].split("x", 1)[0])
    except (IndexError, ValueError):
        return None


def normalize_recovery_spec(board_type: str, width: float) -> dict:
    """Return the canonical recoverable spec after edge-banding allowance."""
    width = round(float(width), 1)
    code_width = _width_from_board_type(board_type)
    mapped_width = EDGE_BANDED_RECOVERY_WIDTHS.get(round(code_width, 1)) if code_width is not None else None
    if mapped_width is None:
        mapped_width = EDGE_BANDED_RECOVERY_WIDTHS.get(width, width)
    if mapped_width != width or (code_width is not None and round(code_width, 1) != mapped_width):
        return {"board_type": common_recovery_board_type(mapped_width), "width": mapped_width}
    return {"board_type": board_type, "width": width}
