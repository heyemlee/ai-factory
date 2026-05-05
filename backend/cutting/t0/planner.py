"""
Legacy backward-compatible T0 plan wrappers.
"""

from config.board_config_loader import BOARD_CFG
from .packer import optimize_t0_from_strips
from .recovery import recover_leftover

BOARD_T0_RAW = BOARD_CFG.BOARD_T0_RAW


def compute_t0_plan(board_results: list, inventory: dict) -> dict:
    """
    Legacy function: backward compatible wrapper.
    """
    from collections import Counter

    usage = Counter()
    for br in board_results:
        usage[br["board"]] += 1

    strip_items = []
    shortfall_info = {}

    for board_type, used_count in usage.items():
        stock = inventory.get(board_type, {}).get("qty", 0)
        shortfall = used_count - stock
        if shortfall > 0:
            board_info = inventory.get(board_type, {})
            width = board_info.get("Width", 0)
            shortfall_info[board_type] = shortfall

            for _ in range(shortfall):
                strip_items.append({
                    "strip_width": width,
                    "strip_label": BOARD_T0_RAW,
                    "strip_type": "T0",
                })

    if not strip_items:
        return {
            "t0_sheets_needed": 0,
            "t0_sheets": [],
            "total_waste_mm": 0,
            "shortfall": {},
        }

    result = optimize_t0_from_strips(strip_items)
    for sheet in result["t0_sheets"]:
        recover_leftover(sheet)
    result["shortfall"] = shortfall_info
    return result


def optimize_t0_cutting(required_strips: list) -> dict:
    """Legacy wrapper."""
    items = []
    for s in required_strips:
        for _ in range(s["qty"]):
            items.append({
                "strip_width": s["width"],
                "strip_label": BOARD_T0_RAW,
                "strip_type": "T0",
            })
    return optimize_t0_from_strips(items)
