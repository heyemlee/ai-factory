"""
T0 leftover recovery.

After T0 sheets are packed, reclaim usable strips (T1 widths or rails)
from the remaining width budget on each sheet.
"""

from config.board_config_loader import BOARD_CFG

T0_WIDTH  = BOARD_CFG.T0_WIDTH
T0_HEIGHT = BOARD_CFG.T0_HEIGHT
SAW_KERF  = BOARD_CFG.SAW_KERF

RECOVERY_WIDE   = BOARD_CFG.RECOVERY_WIDE
RECOVERY_NARROW = BOARD_CFG.RECOVERY_NARROW
RECOVERY_RAIL   = BOARD_CFG.RECOVERY_RAIL

BOARD_T1_NARROW    = BOARD_CFG.BOARD_T1_NARROW
BOARD_T1_WIDE      = BOARD_CFG.BOARD_T1_WIDE
BOARD_STRIP_RECOV  = BOARD_CFG.BOARD_STRIP_RECOV


def _best_recovery_combo(width: float, candidates: list, kerf: float = SAW_KERF) -> list:
    """
    Find combination of candidate widths (repetition allowed) that maximizes
    total recovered width within `width` budget, accounting for kerf between cuts.

    Constraint: Σwᵢ + (n − 1) × kerf ≤ width

    Args:
        width:      leftover budget (mm)
        candidates: list of dicts with at least {"board_type": str, "width": float}
        kerf:       saw kerf (mm) between adjacent cuts

    Returns:
        Ordered list of chosen candidate dicts (widest first).
    """
    if width <= 0 or not candidates:
        return []

    # Sort by width descending so DP explores bigger pieces first (prunes faster).
    opts = sorted(
        ({"board_type": c["board_type"], "width": float(c["width"])} for c in candidates),
        key=lambda x: -x["width"],
    )

    # Memoize on (rounded budget, is_first_cut).
    cache: dict = {}

    def solve(budget: float, is_first: bool):
        # Round key to 0.1mm to keep the cache finite.
        key = (round(budget, 1), is_first)
        if key in cache:
            return cache[key]

        best_sum = 0.0
        best_combo: list = []
        for opt in opts:
            cost = opt["width"] + (0.0 if is_first else kerf)
            if cost - 1e-6 > budget:
                continue
            sub_sum, sub_combo = solve(budget - cost, False)
            total = opt["width"] + sub_sum
            if total > best_sum + 1e-6:
                best_sum = total
                best_combo = [opt] + sub_combo

        cache[key] = (best_sum, best_combo)
        return cache[key]

    _, combo = solve(width, True)
    return combo


def _legacy_recover(remaining: float) -> tuple:
    """
    Original hardcoded recovery rules — used as fallback when no inventory
    widths are provided (offline tests, older callers).

    Returns: (recovered_list, final_remaining)
    """
    recovered = []
    while remaining >= RECOVERY_RAIL:
        if remaining >= RECOVERY_WIDE + SAW_KERF:
            recovered.append({"width": RECOVERY_WIDE, "board_type": BOARD_T1_WIDE,
                              "type": BOARD_T1_WIDE, "label": f"回收{BOARD_T1_WIDE}"})
            remaining -= (RECOVERY_WIDE + SAW_KERF)
        elif remaining >= RECOVERY_WIDE:
            recovered.append({"width": RECOVERY_WIDE, "board_type": BOARD_T1_WIDE,
                              "type": BOARD_T1_WIDE, "label": f"回收{BOARD_T1_WIDE}"})
            remaining -= RECOVERY_WIDE
        elif remaining >= RECOVERY_NARROW + SAW_KERF:
            recovered.append({"width": RECOVERY_NARROW, "board_type": BOARD_T1_NARROW,
                              "type": BOARD_T1_NARROW, "label": f"回收{BOARD_T1_NARROW}"})
            remaining -= (RECOVERY_NARROW + SAW_KERF)
        elif remaining >= RECOVERY_NARROW:
            recovered.append({"width": RECOVERY_NARROW, "board_type": BOARD_T1_NARROW,
                              "type": BOARD_T1_NARROW, "label": f"回收{BOARD_T1_NARROW}"})
            remaining -= RECOVERY_NARROW
        elif remaining >= RECOVERY_RAIL:
            recovered.append({"width": round(remaining, 1), "board_type": BOARD_STRIP_RECOV,
                              "type": BOARD_STRIP_RECOV, "label": f"拉条({round(remaining, 1)}mm)"})
            remaining = 0
        else:
            break
    return recovered, remaining


def recover_leftover(sheet: dict, inventory_widths: list | None = None) -> list:
    """
    Recover usable strips from a T0 sheet's leftover width by matching it
    against actual inventory widths via a multi-cut DP that maximizes the
    total recovered width.

    Args:
        sheet:            sheet dict; reads `remaining_width` / `waste_width`
        inventory_widths: candidate list [{"board_type": str, "width": float}, ...]
                          (e.g. T1 rows from Supabase `inventory`).
                          If None or empty → fall back to legacy hardcoded rules.

    Modifies `sheet` in-place: sets `recovered_strips`, `remaining_width`,
    `waste_final`. Returns the list of recovered strips.
    """
    remaining = float(sheet.get("remaining_width", sheet.get("waste_width", 0)))

    if inventory_widths:
        combo = _best_recovery_combo(remaining, inventory_widths, kerf=SAW_KERF)
        recovered = []
        used = 0.0
        for i, opt in enumerate(combo):
            kerf_cost = 0.0 if i == 0 else SAW_KERF
            used += opt["width"] + kerf_cost
            recovered.append({
                "width": round(opt["width"], 1),
                "board_type": opt["board_type"],
                "type": opt["board_type"],
                "label": f"回收{opt['board_type']}",
            })
        final_remaining = max(0.0, remaining - used)
    else:
        recovered, final_remaining = _legacy_recover(remaining)

    sheet["recovered_strips"] = recovered
    sheet["remaining_width"] = round(final_remaining, 1)
    sheet["waste_final"] = round(final_remaining, 1)

    # Update sheet utilization to include recovered strips
    if recovered:
        recovered_area = sum(r["width"] * T0_HEIGHT for r in recovered)
        parts_area = sum(s["strip_width"] * T0_HEIGHT for s in sheet.get("strips", []))
        t0_area = T0_WIDTH * T0_HEIGHT
        sheet["utilization"] = round((parts_area + recovered_area) / t0_area, 4)

    if recovered:
        desc = ", ".join(f"{r['label']}({r['width']}mm)" for r in recovered)
        print(f"  ♻️  {sheet['sheet_id']}: recovered [{desc}], "
              f"final waste: {final_remaining:.1f}mm")

    return recovered
