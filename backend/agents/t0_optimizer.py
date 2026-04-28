"""
T0 统一混排裁切优化器 v3 — 统一命名

T0 raw sheet: 1219.2 × 2438.4 mm (48″ × 96″)
裁切方向：沿 1219.2mm (48″) 宽度方向切条料

⚠️ 命名规则 (v3):
  - T0 板统一叫 T0-RAW (不允许 CUSTOM-xxx-T0)
  - 回收的条料使用库存命名:
    - T1-609.6-INV  (回收的宽条料)
    - T1-304.8-INV  (回收的窄条料)
    - STRIP-RECOVERED (拉条回收)

核心逻辑:
  - 接收任意宽度条料列表 (不分组)
  - FFD 统一混排: 876 + 304 → 一张 T0
  - 目标: 最少 T0 板数, 最高利用率 (80%+)

参数:
  T0_WIDTH  = 1219.2 mm
  T0_TRIM   = 5 mm (边缘修边)
  SAW_KERF  = 5 mm (锯缝)
  usable_width = 1219.2 - 5 = 1214.2 mm

规则:
  - 第一个条料不需要 kerf
  - 后续条料需要 + 5mm kerf
  - 按宽度降序排列 (FFD)

回收规则 (STEP 4):
  - remaining ≥ 609.6  → 回收 T1-609.6-INV
  - remaining ≥ 304.8  → 回收 T1-304.8-INV
  - remaining ≥ 200    → 回收 STRIP-RECOVERED (拉条)
  - remaining < 200    → 废料
"""

# ── T0 Sheet Constants (mm) ─────────────────
T0_WIDTH  = 1219.2   # 48″ — the cutting axis
T0_HEIGHT = 2438.4   # 96″ — strip runs along this direction
T0_TRIM   = 5.0      # edge trim on T0 sheet
SAW_KERF  = 5.0      # kerf per cut

# Recovery thresholds
RECOVERY_WIDE   = 609.6   # can recover a T1-609.6-INV strip
RECOVERY_NARROW = 304.8   # can recover a T1-304.8-INV strip
RECOVERY_RAIL   = 200.0   # minimum for rail (拉条) recovery

# ⚠️ 统一命名
BOARD_T0_RAW       = "T0-RAW"
BOARD_T1_NARROW    = "T1-304.8-INV"
BOARD_T1_WIDE      = "T1-609.6-INV"
BOARD_STRIP_RECOV  = "STRIP-RECOVERED"


# ─────────────────────────────────────────────
# STEP 3: T0 Unified Mixed-Strip Optimization
# ─────────────────────────────────────────────

def optimize_t0_from_strips(strip_items: list) -> dict:
    """
    Unified T0 mixed-strip optimization using FFD bin packing.

    Accepts ANY width strips — all mixed together on T0 sheets.
    e.g.: 876.3 + 304.8 → one T0 sheet (util 96.9%)

    Args:
        strip_items: list of dicts, each with:
            - strip_width: float (e.g. 304.8, 609.6, 876.3, etc.)
            - strip_label: str (should be "T0-RAW" for all)
            - strip_type: str ("T0" for all)

    Returns:
        dict with:
            - t0_sheets_needed: int
            - t0_sheets: list of sheet dicts
            - total_waste_mm: float
            - total_utilization: float
    """
    if not strip_items:
        return {
            "t0_sheets_needed": 0,
            "t0_sheets": [],
            "total_waste_mm": 0,
            "total_utilization": 0,
        }

    # FFD: sort strips by width descending (biggest first)
    sorted_items = sorted(strip_items, key=lambda x: x["strip_width"], reverse=True)

    usable_width = T0_WIDTH - T0_TRIM

    # Validate: no single strip exceeds usable width
    for item in sorted_items:
        if item["strip_width"] > usable_width:
            print(f"  ⚠️ Strip width {item['strip_width']}mm "
                  f"> T0 usable {usable_width}mm, cannot fit!")

    # Filter out oversized
    valid_items = [x for x in sorted_items if x["strip_width"] <= usable_width]

    open_sheets = []  # each: {remaining, strips, cut_count}

    # True mixed-width FFD: all valid strips compete for the same open T0 sheets.
    for item in valid_items:
        sw = item["strip_width"]
        placed = False
        for sheet in open_sheets:
            needed = sw + SAW_KERF
            if sheet["remaining"] >= needed:
                sheet["strips"].append(item)
                sheet["remaining"] -= needed
                sheet["cut_count"] += 1
                placed = True
                break
        if not placed:
            open_sheets.append({
                "remaining": usable_width - sw,
                "strips": [item],
                "cut_count": 1,
            })

    # Build results
    t0_sheets = []
    total_waste = 0.0
    total_used_width = 0.0

    for idx, sheet in enumerate(open_sheets, 1):
        strips_total_width = sum(s["strip_width"] for s in sheet["strips"])
        kerf_count = len(sheet["strips"]) - 1
        kerf_loss = kerf_count * SAW_KERF if kerf_count > 0 else 0
        waste_width = sheet["remaining"]
        total_waste += waste_width
        total_used_width += strips_total_width

        # 2D area utilization
        t0_area = T0_WIDTH * T0_HEIGHT
        used_area = sum(s["strip_width"] * T0_HEIGHT for s in sheet["strips"])
        utilization = used_area / t0_area if t0_area > 0 else 0

        strip_details = []
        # 使用第一个条料的标签作为板的名字
        main_label = sheet["strips"][0].get("strip_label", BOARD_T0_RAW)
        
        for s in sheet["strips"]:
            label = s.get("strip_label", BOARD_T0_RAW)
            strip_details.append({
                "strip_width": s["strip_width"],
                "width": s["strip_width"],           # legacy compatibility
                "strip_label": label,
                "board_type": label,
                "strip_type": "T0",
                "height": T0_HEIGHT,
            })

        t0_sheets.append({
            "sheet_id": f"{main_label}-{idx:03d}",
            "t0_size": f"{T0_WIDTH} × {T0_HEIGHT}",
            "strips": strip_details,
            "strip_widths": [s["strip_width"] for s in sheet["strips"]],
            "strip_count": len(strip_details),
            "strips_total_width": round(strips_total_width, 1),
            "kerf_loss": round(kerf_loss, 1),
            "trim_loss": T0_TRIM,
            "waste_width": round(waste_width, 1),
            "remaining_width": round(waste_width, 1),
            "utilization": round(utilization, 4),
            "recovered_strips": [],  # filled by recover_leftover()
        })

    total_t0_area = len(t0_sheets) * T0_WIDTH * T0_HEIGHT
    total_strip_area = total_used_width * T0_HEIGHT
    overall_util = total_strip_area / total_t0_area if total_t0_area > 0 else 0

    result = {
        "t0_sheets_needed": len(t0_sheets),
        "t0_sheets": t0_sheets,
        "total_waste_mm": round(total_waste, 1),
        "total_utilization": round(overall_util, 4),
    }

    print(f"\n── STEP 3: T0 Mixed Optimization ──")
    print(f"  Total strips to pack: {len(valid_items)}")
    print(f"  T0 sheets needed:     {result['t0_sheets_needed']}")
    print(f"  T0 utilization:       {overall_util*100:.1f}%")
    for sheet in t0_sheets:
        widths_desc = " + ".join(f"{w}mm" for w in sheet["strip_widths"])
        print(f"  {sheet['sheet_id']}: [{widths_desc}] "
              f"| remain: {sheet['remaining_width']}mm "
              f"| util: {sheet['utilization']*100:.1f}%")

    return result


# ─────────────────────────────────────────────
# STEP 4: T0 Leftover Recovery
# ─────────────────────────────────────────────

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


# ─────────────────────────────────────────────
# Legacy: compute_t0_plan (backward compatible)
# ─────────────────────────────────────────────

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


# ─────────────────────────────────────────────
# Self-test
# ─────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  T0 Optimizer v3 — Self-Test (Unified Naming)")
    print("=" * 60)

    # Test 1: 876.3 + 304.8 → should pack on ONE T0 sheet
    print("\n── Test 1: 876.3 + 304.8 (mixed on one T0) ──")
    r1 = optimize_t0_from_strips([
        {"strip_width": 876.3, "strip_label": "T0-RAW", "strip_type": "T0"},
        {"strip_width": 304.8, "strip_label": "T0-RAW", "strip_type": "T0"},
    ])
    for s in r1["t0_sheets"]:
        recover_leftover(s)
    print(f"  Result: {r1['t0_sheets_needed']} T0 sheet (expected: 1)")
    for s in r1["t0_sheets"]:
        print(f"    {s['sheet_id']}: widths={s['strip_widths']}, "
              f"util={s['utilization']*100:.1f}%, "
              f"recovered={[r['board_type'] for r in s['recovered_strips']]}")
    assert r1["t0_sheets_needed"] == 1, "FAIL: should be 1 T0 sheet!"

    # Test 2: 762 + 304.8 → should pack on ONE T0 sheet
    print("\n── Test 2: 762 + 304.8 (mixed on one T0) ──")
    r2 = optimize_t0_from_strips([
        {"strip_width": 762.0, "strip_label": "T0-RAW", "strip_type": "T0"},
        {"strip_width": 304.8, "strip_label": "T0-RAW", "strip_type": "T0"},
    ])
    for s in r2["t0_sheets"]:
        recover_leftover(s)
    print(f"  Result: {r2['t0_sheets_needed']} T0 sheet (expected: 1)")
    for s in r2["t0_sheets"]:
        print(f"    {s['sheet_id']}: widths={s['strip_widths']}, "
              f"util={s['utilization']*100:.1f}%, "
              f"remaining={s['remaining_width']}mm")

    # Test 3: 876.3 + 304.8 + 609.6 → should be 2 T0 sheets
    print("\n── Test 3: 876.3 + 304.8 + 609.6 ──")
    r3 = optimize_t0_from_strips([
        {"strip_width": 876.3, "strip_label": "T0-RAW", "strip_type": "T0"},
        {"strip_width": 304.8, "strip_label": "T0-RAW", "strip_type": "T0"},
        {"strip_width": 609.6, "strip_label": "T0-RAW", "strip_type": "T0"},
    ])
    for s in r3["t0_sheets"]:
        recover_leftover(s)
    print(f"  Result: {r3['t0_sheets_needed']} T0 sheets (expected: 2)")
    for s in r3["t0_sheets"]:
        print(f"    {s['sheet_id']}: widths={s['strip_widths']}, "
              f"util={s['utilization']*100:.1f}%")

    # Test 4: Verify naming — no CUSTOM-xxx
    print("\n── Test 4: Verify NO CUSTOM naming ──")
    r4 = optimize_t0_from_strips([
        {"strip_width": 838.2, "strip_label": "T0-RAW", "strip_type": "T0"},
        {"strip_width": 617.0, "strip_label": "T0-RAW", "strip_type": "T0"},
        {"strip_width": 304.8, "strip_label": "T0-RAW", "strip_type": "T0"},
    ])
    for s in r4["t0_sheets"]:
        recover_leftover(s)
    # Check all names
    for s in r4["t0_sheets"]:
        assert "CUSTOM" not in s["sheet_id"], f"FAIL: {s['sheet_id']} has CUSTOM!"
        for strip in s["strips"]:
            assert "CUSTOM" not in strip["board_type"], \
                f"FAIL: strip has CUSTOM: {strip['board_type']}"
        for r in s["recovered_strips"]:
            assert "CUSTOM" not in r["board_type"], \
                f"FAIL: recovered has CUSTOM: {r['board_type']}"
    print("  ✅ All names use T0-RAW / T1-xxx-INV / STRIP-RECOVERED")

    # Test 5: Large batch with recovery
    print("\n── Test 5: 5×304.8 + 2×609.6 + 1×876.3 + 1×762 (full test) ──")
    items = (
        [{"strip_width": 304.8, "strip_label": "T0-RAW", "strip_type": "T0"}] * 5 +
        [{"strip_width": 609.6, "strip_label": "T0-RAW", "strip_type": "T0"}] * 2 +
        [{"strip_width": 876.3, "strip_label": "T0-RAW", "strip_type": "T0"}] +
        [{"strip_width": 762.0, "strip_label": "T0-RAW", "strip_type": "T0"}]
    )
    r5 = optimize_t0_from_strips(items)
    total_recovered = 0
    for s in r5["t0_sheets"]:
        recover_leftover(s)
        total_recovered += len(s.get("recovered_strips", []))
    print(f"  T0 sheets: {r5['t0_sheets_needed']}")
    print(f"  T0 utilization: {r5['total_utilization']*100:.1f}%")
    print(f"  Recovered: {total_recovered} strips")
    for s in r5["t0_sheets"]:
        print(f"    {s['sheet_id']}: widths={s['strip_widths']}, "
              f"util={s['utilization']*100:.1f}%, "
              f"recovered=[{', '.join(r['board_type'] for r in s['recovered_strips'])}], "
              f"waste={s.get('waste_final', s['waste_width'])}mm")

    print("\n" + "=" * 60)
    print("  ✅ All tests passed — unified naming verified")
    print("=" * 60)
