"""
Module constants for the efficient cutting engine.

All factory parameters loaded from config/board_config.json.
"""

from config.board_config_loader import BOARD_CFG

TRIM_LOSS = BOARD_CFG.T0_TRIM
SAW_KERF  = BOARD_CFG.SAW_KERF

STRIP_WIDTH_NARROW = BOARD_CFG.STRIP_WIDTH_NARROW
STRIP_WIDTH_WIDE   = BOARD_CFG.STRIP_WIDTH_WIDE
BOARD_HEIGHT       = BOARD_CFG.BOARD_HEIGHT

DEFAULT_BOARD_T0        = BOARD_CFG.BOARD_T0_RAW
DEFAULT_BOARD_T1_NARROW = BOARD_CFG.BOARD_T1_NARROW
DEFAULT_BOARD_T1_WIDE   = BOARD_CFG.BOARD_T1_WIDE

COMMON_RECOVERY_WIDTHS = BOARD_CFG.COMMON_RECOVERY_WIDTHS

MIN_RECOVERABLE_WIDTH = BOARD_CFG.MIN_RECOVERABLE_WIDTH

EDGE_BANDED_RECOVERY_WIDTHS = {
    304.8: 303.8,
    609.6: 608.6,
    286.8: 285.8,
    266.8: 264.8,
    591.6: 590.6,
    571.6: 569.6,
}

# Height-axis trim threshold: if a part's Height exceeds this, the strip
# cannot be trimmed on its short edges (would leave the part oversized).
# 96″ panels (Height ≈ 2438.4) trigger this and the strip runs un-trimmed.
HEIGHT_TRIM_THRESHOLD = BOARD_HEIGHT - 2 * TRIM_LOSS  # 2428.4mm

DEFAULT_BOX_COLOR = "WhiteBirch"
