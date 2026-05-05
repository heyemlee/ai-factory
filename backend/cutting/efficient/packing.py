"""
STEP 5: FFD packing of parts within a strip along the Height axis.
"""

from .constants import (
    BOARD_HEIGHT,
    DEFAULT_BOX_COLOR,
    SAW_KERF,
    TRIM_LOSS,
)
from .primitives import _cut_length, _cut_width


def ffd_strip_pack(parts: list, strip_width: float, board_type: str,
                   board_height: float = BOARD_HEIGHT,
                   color: str = DEFAULT_BOX_COLOR,
                   id_prefix: str | None = None) -> list:
    """
    FFD bin packing of parts within a strip along the Height (2438.4mm) axis.

    ⚠️ 扫边: 默认两端各扫 TRIM_LOSS (2438.4 → 2428.4mm).
       如果零件 Height > board_height − 2 × TRIM_LOSS,该条 strip 跳过短边扫边
       (整条独占, usable = board_height).

    This is used for BOTH inventory strips AND T0-cut strips.

    Args:
      parts: list of part dicts with Height/Width and optional cut_length/cut_width
      strip_width: width of the strip (303.8 / 608.6 / custom)
      board_type: unified board label (T1-303.8-INV / T1-608.6-INV / T0-RAW)
      board_height: total length of the strip

    Returns:
      list of strip results, each with parts and utilization
    """
    usable = board_height - 2 * TRIM_LOSS         # 2438.4 − 10 = 2428.4mm
    no_trim_threshold = board_height - 2 * TRIM_LOSS
    sorted_parts = sorted(parts, key=_cut_length, reverse=True)

    open_strips = []  # each: {remaining, parts, no_trim}

    for part in sorted_parts:
        cl = _cut_length(part)

        # Tall parts (> usable after 2-edge trim): solo strip, skip short-edge trim.
        is_full_height = part.get("skip_trim") or cl > no_trim_threshold
        if is_full_height:
            if cl > board_height + 0.5:
                print(f"  ⚠️  Part {part['part_id']} Height {cl}mm > board {board_height}mm, skip")
                continue
            open_strips.append({
                "remaining": 0,
                "parts": [part],
                "no_trim": True,
            })
            continue

        needed = cl + SAW_KERF

        if needed > usable:
            print(f"  ⚠️  Part {part['part_id']} Height {cl}mm + kerf > usable {usable}mm, skip")
            continue

        placed = False
        for strip in open_strips:
            if strip.get("no_trim"):
                continue  # full-height strip is sealed
            if strip["remaining"] >= needed:
                strip["parts"].append(part)
                strip["remaining"] -= needed
                placed = True
                break

        if not placed:
            # First part on new strip: no kerf
            open_strips.append({
                "remaining": usable - cl,
                "parts": [part],
            })

    strip_area = strip_width * board_height
    results = []
    prefix = id_prefix if id_prefix is not None else f"{board_type}-{color}"
    for idx, strip in enumerate(open_strips, 1):
        no_trim = strip.get("no_trim", False)
        # trim_loss reports the per-edge value (machine setting). Operator runs
        # it twice for both short edges, so usable_height already reflects 2×.
        effective_trim = 0 if no_trim else TRIM_LOSS
        effective_usable = board_height if no_trim else usable

        parts_total_len = sum(_cut_length(p) for p in strip["parts"])
        parts_total_area = sum(_cut_length(p) * _cut_width(p) for p in strip["parts"])
        k = len(strip["parts"])
        kerf_total = (k - 1) * SAW_KERF if k > 1 else 0
        waste_area = (effective_usable * strip_width) - parts_total_area - (kerf_total * strip_width)

        utilization = parts_total_area / strip_area if strip_area > 0 else 0

        # Effective rip width: the saw's actual rip setting. For unbanded parts
        # this equals strip_width; for banded parts it shrinks by the banding
        # allowance so the rip leaves no internal scrap inside the strip.
        rip_width = max(
            (_cut_width(p) or float(strip_width) for p in strip["parts"]),
            default=float(strip_width),
        )
        results.append({
            "board_id": f"{prefix}-{idx:03d}",
            "board": board_type,
            "board_type": board_type,
            "board_size": f"{strip_width} × {board_height}",
            "strip_width": strip_width,
            "rip_width": round(rip_width, 1),
            "color": color,
            "parts": [
                {
                    "part_id": p["part_id"],
                    "Height": p["Height"],
                    "Width": p["Width"],
                    "cut_length": p.get("cut_length", p["Height"]),
                    "cut_width": p.get("cut_width", p["Width"]),
                    "component": p.get("component", ""),
                    "cab_id": p.get("cab_id", ""),
                    "cab_type": p.get("cab_type", ""),
                    "color": p.get("color", color),
                    "rotated": p.get("rotated", False),
                    "auto_swapped": p.get("auto_swapped", False),
                }
                for p in strip["parts"]
            ],
            "trim_loss": effective_trim,
            "saw_kerf": SAW_KERF,
            "cuts": k,
            "parts_total_length": round(parts_total_len, 1),
            "parts_total_area": round(parts_total_area, 1),
            "board_area": round(strip_area, 1),
            "kerf_total": round(kerf_total, 1),
            "usable_length": round(effective_usable, 1),
            "waste": round(waste_area, 1),
            "utilization": round(utilization, 4),
        })

    return results
