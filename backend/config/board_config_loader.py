"""
Board configuration loader — reads board_config.json once and exposes
all board-related constants to the rest of the backend.

Usage:
    from config.board_config_loader import BOARD_CFG
    print(BOARD_CFG.RECOVERY_WIDE)        # 608.6
    print(BOARD_CFG.COMMON_RECOVERY_WIDTHS)  # [303.8, 608.6, ...]
"""

import json
import os

_CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "board_config.json")

with open(_CONFIG_PATH, "r", encoding="utf-8") as f:
    _raw = json.load(f)


class _BoardConfig:
    """Typed accessor for board_config.json values."""

    # T0 sheet
    T0_WIDTH: float = _raw["t0_sheet"]["width"]
    T0_HEIGHT: float = _raw["t0_sheet"]["height"]
    T0_TRIM: float = _raw["t0_sheet"]["trim"]
    SAW_KERF: float = _raw["t0_sheet"]["saw_kerf"]

    # Edge banding
    EDGE_BAND_THICKNESS: float = _raw["edge_band_thickness"]

    # Recovery thresholds
    RECOVERY_WIDE: float = _raw["recovery_thresholds"]["wide"]
    RECOVERY_NARROW: float = _raw["recovery_thresholds"]["narrow"]
    RECOVERY_RAIL: float = _raw["recovery_thresholds"]["rail_min"]

    # Board names
    BOARD_T0_RAW: str = _raw["board_names"]["t0_raw"]
    BOARD_T1_NARROW: str = _raw["board_names"]["t1_narrow"]
    BOARD_T1_WIDE: str = _raw["board_names"]["t1_wide"]
    BOARD_STRIP_RECOV: str = _raw["board_names"]["strip_recovered"]

    # Common recovery widths (flat list)
    COMMON_RECOVERY_WIDTHS: list[float] = [
        entry["width"] for entry in _raw["common_recovery_widths"]
    ]

    # Strip width thresholds
    STRIP_WIDTH_NARROW: float = _raw["strip_width_narrow"]
    STRIP_WIDTH_WIDE: float = _raw["strip_width_wide"]
    BOARD_HEIGHT: float = _raw["board_height"]
    MIN_RECOVERABLE_WIDTH: float = _raw["min_recoverable_width"]


BOARD_CFG = _BoardConfig()
