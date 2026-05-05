"""
Per-color pipeline orchestrator and main `run_engine` entry point
for the efficient (FFD + T0 mixed-pack) cutting strategy.

Pipeline:
  STEP 1: parts → strip_demand
  STEP 2: apply_inventory
  STEP 3: optimize_t0 (mixed-pack)
  STEP 4: recover_leftover
  STEP 5: ffd_strip_pack (parts inside each strip)
"""

import json
import os
from collections import defaultdict

from cutting.t0 import optimize_t0_from_strips, recover_leftover

from .constants import (
    BOARD_HEIGHT,
    DEFAULT_BOARD_T0,
    DEFAULT_BOX_COLOR,
    HEIGHT_TRIM_THRESHOLD,
    MIN_RECOVERABLE_WIDTH,
    SAW_KERF,
    TRIM_LOSS,
)
from .demand import _count_strips_needed, apply_inventory, build_strip_demand
from .loaders import (
    load_inventory,
    load_non_recoverable_board_types,
    load_parts,
    load_recovery_specs_from_supabase,
)
from .packing import ffd_strip_pack
from .primitives import normalize_recovery_spec
from .validator import _validate_cut_result


def _run_pipeline_for_color(parts: list, inventory: dict, color: str,
                            t0_id_offset: int = 0,
                            force_t0_start: bool = False) -> dict:
    """Run STEP 1-5 of the cutting pipeline for a single color partition.

    inventory is the single-color view {board_type: info}.
    Returns a partial result dict with keys: boards, t0_plan, used_inventory,
    recovered_inventory, t0_sheets_used, t0_recovered_strips.
    """
    print(f"\n{'─' * 60}")
    print(f"  🎨 Color partition: {color}  ({len(parts)} parts)")
    print(f"{'─' * 60}")

    # 确定 T0 板的名字 (从库存获取)
    t0_name = DEFAULT_BOARD_T0
    if inventory:
        for bt_inv in inventory.keys():
            if bt_inv.startswith("T0"):
                t0_name = bt_inv
                break

    # ─── STEP 1: Build strip demand ───
    strip_demand = build_strip_demand(parts, inventory, force_t0_start=force_t0_start)

    # ─── STEP 2: Apply inventory ───
    inv_result = apply_inventory(strip_demand, inventory, force_t0_start=force_t0_start)
    used_inventory = inv_result["used_inventory"]
    t0_pool = inv_result["t0_pool"]
    inventory_strips = inv_result["inventory_strips"]

    # ─── STEP 3: T0 unified mixed-strip optimization ───
    t0_strip_items = []
    t0_parts_by_width = {}

    for pool_entry in t0_pool:
        sw = pool_entry["strip_width"]
        pool_parts = pool_entry["parts"]
        if sw not in t0_parts_by_width:
            t0_parts_by_width[sw] = []
        t0_parts_by_width[sw].extend(pool_parts)
        count = _count_strips_needed(pool_parts, sw)
        for _ in range(count):
            t0_strip_items.append({
                "strip_width": sw,
                "strip_label": t0_name,
                "strip_type": "T0",
            })

    t0_plan = None
    if t0_strip_items:
        t0_plan = optimize_t0_from_strips(t0_strip_items)

        # Re-key sheet_id with color + offset to ensure global uniqueness
        for s_idx, sheet in enumerate(t0_plan["t0_sheets"]):
            sheet["sheet_id"] = f"{t0_name}-{color}-{t0_id_offset + s_idx + 1:03d}"
            sheet["color"] = color

        # ─── STEP 4: Recover leftover from T0 sheets ───
        recovery_by_width: dict[float, dict] = {}
        for spec in load_recovery_specs_from_supabase():
            recovery_by_width[round(float(spec["width"]), 1)] = {
                "board_type": spec["board_type"],
                "width": float(spec["width"]),
            }
        # Also consider inventory rows, but exclude board types explicitly
        # marked as non-recoverable in board_specs (e.g. T1-101.6x2438.4).
        non_recoverable_bts = load_non_recoverable_board_types()
        for bt, info in inventory.items():
            if bt.startswith("T0"):
                continue
            if bt in non_recoverable_bts:
                continue
            if info.get("Height", 0) + 1e-3 < BOARD_HEIGHT:
                continue
            w = float(info.get("Width", 0))
            if w < MIN_RECOVERABLE_WIDTH:
                continue
            spec = normalize_recovery_spec(bt, w)
            recovery_by_width.setdefault(round(spec["width"], 1), spec)
        recovery_candidates = sorted(recovery_by_width.values(), key=lambda c: -c["width"])
        if recovery_candidates:
            cand_desc = ", ".join(f"{c['board_type']}={c['width']}mm" for c in recovery_candidates)
            print(f"  ♻️  Recovery candidates ({color}): {cand_desc}")

        for sheet in t0_plan["t0_sheets"]:
            recover_leftover(sheet, recovery_candidates)
            for r in sheet.get("recovered_strips", []):
                r["color"] = color

    # ─── STEP 4b: Build T0 sheet → strip mapping for frontend ───
    t0_width_assignments = defaultdict(list)
    if t0_plan:
        for sheet in t0_plan["t0_sheets"]:
            all_strips_info = [
                {"strip_width": s["strip_width"], "strip_index": si}
                for si, s in enumerate(sheet["strips"])
            ]
            x_pos = 0.0
            for s_idx, strip in enumerate(sheet["strips"]):
                sw = strip["strip_width"]
                t0_width_assignments[sw].append({
                    "sheet_id": sheet["sheet_id"],
                    "strip_index": s_idx,
                    "x_position": round(x_pos, 1),
                    "total_strips": len(sheet["strips"]),
                    "sheet_utilization": sheet["utilization"],
                    "all_strips": all_strips_info,
                    "remaining_width": round(sheet.get("remaining_width", 0), 1),
                })
                x_pos += sw + SAW_KERF

    # ─── STEP 5: Pack parts into strips ───
    all_board_results = []

    for inv_strip in inventory_strips:
        results = ffd_strip_pack(
            inv_strip["parts"],
            inv_strip["strip_width"],
            inv_strip["board_type"],
            color=color,
        )
        for r in results:
            r["source"] = "inventory"
        all_board_results.extend(results)

    for sw, t0_parts in t0_parts_by_width.items():
        results = ffd_strip_pack(
            t0_parts,
            sw,
            t0_name,
            color=color,
            id_prefix=f"{t0_name}-{color}-{sw}",
        )
        assignments = t0_width_assignments.get(sw, [])
        for i, r in enumerate(results):
            r["source"] = "T0"
            r["actual_strip_width"] = sw
            if i < len(assignments):
                a = assignments[i]
                r["t0_sheet_id"] = a["sheet_id"]
                r["t0_sheet_index"] = a["strip_index"]
                r["t0_strip_position"] = a["x_position"]
                r["t0_total_strips_on_sheet"] = a["total_strips"]
                r["t0_sheet_utilization"] = a["sheet_utilization"]
                r["t0_all_strips"] = a["all_strips"]
                r["t0_remaining_width"] = a["remaining_width"]
        all_board_results.extend(results)

    t0_sheets_used = t0_plan["t0_sheets_needed"] if t0_plan else 0
    t0_total_recovery = 0
    recovered_inventory = []
    if t0_plan:
        for sheet in t0_plan["t0_sheets"]:
            for r in sheet.get("recovered_strips", []):
                t0_total_recovery += 1
                recovered_inventory.append(r)

    # Fix t0_sheet_utilization for each strip based on parts area + recovered area
    sheet_to_parts_area = defaultdict(float)
    sheet_to_recovered_area = defaultdict(float)
    if t0_plan:
        for sheet in t0_plan["t0_sheets"]:
            sheet_to_recovered_area[sheet["sheet_id"]] = sum(
                r["width"] * 2438.4 for r in sheet.get("recovered_strips", [])
            )
    for b in all_board_results:
        if "t0_sheet_id" in b:
            sheet_to_parts_area[b["t0_sheet_id"]] += b["parts_total_area"]
    for b in all_board_results:
        if "t0_sheet_id" in b:
            t0_area = 1219.2 * 2438.4
            b["t0_sheet_utilization"] = round(
                (sheet_to_parts_area[b["t0_sheet_id"]] + sheet_to_recovered_area[b["t0_sheet_id"]]) / t0_area, 4
            )

    return {
        "boards": all_board_results,
        "t0_plan": t0_plan,
        "used_inventory": used_inventory,
        "recovered_inventory": recovered_inventory,
        "t0_sheets_used": t0_sheets_used,
        "t0_recovered_strips": t0_total_recovery,
        "color": color,
    }


def run_engine(parts_path: str, inventory_path: str = None, output_path: str = "output/cut_result.json",
               cabinet_breakdown: dict = None, force_t0_start: bool = False):
    """
    Full engine run — v5 unified naming + real factory flow + per-color partition:

      parts → split by color → (per color: strip_demand → apply_inventory →
        T0 mixed optimize → recover leftover → strip-level part packing)
        → merge results

    Cutting is strictly partitioned by box color. T0 sheets and inventory
    are never shared across colors. When force_t0_start is true, all strip
    demand starts from T0 raw sheets and existing T1 stock is ignored.
    """
    print("=" * 60)
    print("  Guillotine Cutting Engine v5 — Per-Color Pipeline")
    print("=" * 60)
    if force_t0_start:
        print("  Mode: T0 Start (all strips from raw sheets)")

    # ─── Load data ───
    parts, skipped_rows = load_parts(parts_path)
    inventory_per_color = load_inventory(inventory_path)
    if not inventory_per_color:
        raise RuntimeError("Inventory is empty")

    # ─── 检测超板零件 (跨颜色,T0 dim 假设各色一致) ───
    # 物理上限 = BOARD_HEIGHT (2438.4); 超过 HEIGHT_TRIM_THRESHOLD (2428.4) 但
    # 在物理上限内的件,会跑在不扫短边的独占 strip 上 → 标记 skip_trim.
    max_board_height = float(BOARD_HEIGHT)
    max_board_width = 1219.2
    for color, boards in inventory_per_color.items():
        for bt, info in boards.items():
            if bt.startswith("T0"):
                max_board_width = info["Width"]
                break

    valid_parts = []
    oversized_parts = []
    for p in parts:
        h, w = p["Height"], p["Width"]
        needs_full_h = h > HEIGHT_TRIM_THRESHOLD
        needs_full_w = w > HEIGHT_TRIM_THRESHOLD
        fits_normal = (w <= max_board_width and h <= max_board_height + 0.5)
        fits_rotated = (h <= max_board_width and w <= max_board_height + 0.5)
        if fits_normal:
            if needs_full_h:
                p["skip_trim"] = True
            valid_parts.append(p)
        elif fits_rotated:
            cl_orig = p.get("cut_length", h)
            cw_orig = p.get("cut_width", w)
            p["Height"] = w
            p["Width"] = h
            p["cut_length"] = cw_orig
            p["cut_width"] = cl_orig
            p["auto_swapped"] = True
            if needs_full_w:
                p["skip_trim"] = True
            valid_parts.append(p)
        else:
            oversized_parts.append(p)

    if oversized_parts:
        print(f"\n❌ 发现 {len(oversized_parts)} 个超板零件 (板材极限: {max_board_width}×{BOARD_HEIGHT}mm):")
        for op in oversized_parts:
            cab = op.get('cab_id', '?')
            comp = op.get('component', '?')
            color = op.get('color', '?')
            print(f"   ⛔ {cab}-{comp} [{color}]: {op['Height']} × {op['Width']}mm — 无法裁切!")

    parts = valid_parts

    # ─── Per-color pipeline ───
    parts_by_color: dict = defaultdict(list)
    for p in parts:
        parts_by_color[p.get("color", DEFAULT_BOX_COLOR)].append(p)

    template_inventory = (
        inventory_per_color.get(DEFAULT_BOX_COLOR)
        or next(iter(inventory_per_color.values()), {})
    )

    all_board_results = []
    aggregated_t0_sheets = []
    aggregated_recovered = []
    unmatched_parts = []
    used_inventory: dict = {}
    inventory_used_by_color: dict = {}
    by_color: dict = {}
    t0_id_offset = 0

    for color, color_parts in parts_by_color.items():
        actual_color_inventory = inventory_per_color.get(color, {})
        if not actual_color_inventory:
            print(f"\n⚠️  No inventory rows configured for color '{color}'. Generating cut plan with stock=0 and reporting shortage.")

        color_inventory = {
            bt: {
                **info,
                "qty": int(actual_color_inventory.get(bt, {}).get("qty", 0)),
                "color": color,
            }
            for bt, info in template_inventory.items()
        }
        for bt, info in actual_color_inventory.items():
            color_inventory[bt] = {**info, "color": color}
        inventory_per_color[color] = color_inventory

        partial = _run_pipeline_for_color(
            color_parts,
            color_inventory,
            color,
            t0_id_offset=t0_id_offset,
            force_t0_start=force_t0_start,
        )
        all_board_results.extend(partial["boards"])
        if partial["t0_plan"]:
            aggregated_t0_sheets.extend(partial["t0_plan"]["t0_sheets"])
            t0_id_offset += partial["t0_plan"]["t0_sheets_needed"]
        aggregated_recovered.extend(partial["recovered_inventory"])

        # Used inventory: namespace by color to avoid collisions when same
        # board_type exists for multiple colors.
        for bt, cnt in partial["used_inventory"].items():
            key = f"{bt}|{color}"
            used_inventory[key] = used_inventory.get(key, 0) + cnt
            inventory_used_by_color.setdefault(color, {})[bt] = (
                inventory_used_by_color.setdefault(color, {}).get(bt, 0) + cnt
            )

        # Per-color summary
        c_boards = partial["boards"]
        c_parts_placed = sum(len(b["parts"]) for b in c_boards)
        c_parts_area = sum(b["parts_total_area"] for b in c_boards)
        c_t0_used = partial["t0_sheets_used"]
        c_t1_area = sum(b["board_area"] for b in c_boards if b.get("source") == "inventory")
        c_total_area = c_t0_used * (1219.2 * 2438.4) + c_t1_area
        c_util = c_parts_area / c_total_area if c_total_area > 0 else 0
        by_color[color] = {
            "parts_total": len(color_parts),
            "total_parts_placed": c_parts_placed,
            "parts_placed": c_parts_placed,
            "boards_used": len(c_boards),
            "t0_sheets_used": c_t0_used,
            "t0_recovered_strips": partial["t0_recovered_strips"],
            "overall_utilization": round(c_util, 4),
        }

    # ─── Aggregate summary across all colors ───
    total_boards = len(all_board_results)
    total_parts_required = len(parts)
    total_parts_placed = sum(len(b["parts"]) for b in all_board_results)
    total_parts_unmatched = len(unmatched_parts) + max(0, total_parts_required - total_parts_placed - len(unmatched_parts))
    total_oversized = len(oversized_parts)
    all_parts_cut = (total_parts_placed == total_parts_required) and total_oversized == 0

    t0_sheets_used = len(aggregated_t0_sheets)
    t0_total_area = t0_sheets_used * (1219.2 * 2438.4)
    t1_inv_area = sum(b["board_area"] for b in all_board_results if b.get("source") == "inventory")
    total_board_area = t0_total_area + t1_inv_area
    total_parts_area = sum(b["parts_total_area"] for b in all_board_results)

    total_recovered_area = sum(r["width"] * 2438.4 for r in aggregated_recovered)
    t0_total_recovery = len(aggregated_recovered)

    overall_useful_area = total_parts_area + total_recovered_area
    overall_util = overall_useful_area / total_board_area if total_board_area > 0 else 0
    total_kerf_area = sum(
        (b["cuts"] * SAW_KERF) * b.get("actual_strip_width", b.get("strip_width", 1219.2))
        for b in all_board_results
    )
    total_waste_area = total_board_area - overall_useful_area - total_kerf_area

    # Board type breakdown (by board_type only, not color)
    board_type_counts = defaultdict(int)
    for b in all_board_results:
        board_type_counts[b["board"]] += 1

    # Inventory shortage per (board_type, color)
    inventory_shortage = []
    for color, color_used in inventory_used_by_color.items():
        color_inv = inventory_per_color.get(color, {})
        for bt, used_cnt in color_used.items():
            stock = color_inv.get(bt, {}).get("qty", 0)
            if used_cnt > stock:
                inventory_shortage.append({
                    "board_type": bt,
                    "color": color,
                    "needed": used_cnt,
                    "stock": stock,
                    "shortage": used_cnt - stock,
                })
    if inventory_shortage:
        print(f"\n⚠️  库存不足:")
        for s in inventory_shortage:
            print(f"   {s['board_type']} [{s['color']}]: 需要 {s['needed']}张, 库存 {s['stock']}张, 缺少 {s['shortage']}张")

    summary = {
        "total_parts_required": total_parts_required,
        "total_parts_placed": total_parts_placed,
        "total_parts_unmatched": total_parts_unmatched,
        "all_parts_cut": all_parts_cut,
        "strips_used": total_boards,
        "boards_used": total_boards,
        "t0_sheets_used": t0_sheets_used,
        "t0_recovered_strips": t0_total_recovery,
        "inventory_used": used_inventory,
        "inventory_shortage": inventory_shortage,
        "board_type_breakdown": dict(board_type_counts),
        "by_color": by_color,
        "total_parts_length": round(sum(b["parts_total_length"] for b in all_board_results), 1),
        "total_trim_loss": round(sum(b["trim_loss"] for b in all_board_results), 1),
        "total_kerf_loss": round(sum(b["kerf_total"] for b in all_board_results), 1),
        "total_waste": round(total_waste_area, 1),
        "overall_utilization": round(overall_util, 4),
        "config_trim_loss_mm": TRIM_LOSS,
        "config_saw_kerf_mm": SAW_KERF,
        "cut_mode": "t0_start" if force_t0_start else "inventory_first",
    }
    recovered_inventory = aggregated_recovered

    if total_parts_unmatched > 0:
        summary["warning"] = f"{total_parts_unmatched} parts could not be placed"

    if total_oversized > 0:
        summary["oversized_count"] = total_oversized
        summary["oversized_warning"] = (
            f"{total_oversized} 个零件尺寸超过板材最大尺寸 {BOARD_HEIGHT}mm，无法裁切！"
        )

    # Issues report
    oversized_issues = [
        {
            "part_id": p.get("part_id", "?"),
            "cab_id": p.get("cab_id", "?"),
            "component": p.get("component", "?"),
            "Height": p["Height"],
            "Width": p["Width"],
            "color": p.get("color", DEFAULT_BOX_COLOR),
            "reason": f"尺寸 {p['Height']}×{p['Width']}mm 超过板材最大尺寸 {BOARD_HEIGHT}mm",
        }
        for p in oversized_parts
    ]
    issues = {
        "skipped_rows": [
            {"file": "parts.xlsx", "source": f"Row {s['row']}: {s['reason']}"}
            for s in skipped_rows
        ],
        "unmatched_parts": [
            {
                "part_id": p.get("part_id", "?"),
                "cab_id": p.get("cab_id", "?"),
                "component": p.get("component", "?"),
                "Height": p.get("Height"),
                "Width": p.get("Width"),
                "color": p.get("color", DEFAULT_BOX_COLOR),
                "reason": p.get("_unmatched_reason", "part could not be placed"),
            }
            for p in unmatched_parts
        ],
        "oversized_parts": oversized_issues,
    }

    # ─── Output JSON ───
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    output = {
        "summary": summary,
        "issues": issues,
        "boards": all_board_results,
        "cut_mode": "t0_start" if force_t0_start else "inventory_first",
    }

    # Add aggregated T0 plan details if present
    if aggregated_t0_sheets:
        output["t0_plan"] = {
            "t0_sheets_needed": len(aggregated_t0_sheets),
            "t0_sheets": aggregated_t0_sheets,
            "total_utilization": round(
                sum(float(s.get("utilization", 0)) for s in aggregated_t0_sheets) / len(aggregated_t0_sheets),
                4,
            ),
            "by_color": {
                color: {
                    "t0_sheets_needed": data.get("t0_sheets_used", 0),
                    "t0_recovered_strips": data.get("t0_recovered_strips", 0),
                }
                for color, data in by_color.items()
                if data.get("t0_sheets_used", 0) > 0
            },
        }

    # Add recovered inventory
    if recovered_inventory:
        output["recovered_inventory"] = recovered_inventory

    # Attach cabinet breakdown for downstream reconciliation
    if cabinet_breakdown:
        output["cabinet_breakdown"] = cabinet_breakdown

    # Integrity validation — appends to issues, never raises
    _validate_cut_result(output, cabinet_breakdown, total_parts_required, oversized_parts)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # ─── Print Summary ───
    print(f"\n{'=' * 60}")
    print(f"  ✅ Optimization Complete! (v5 Unified Naming)")
    print(f"  {'=' * 58}")
    print(f"  Parts required:  {total_parts_required}")
    print(f"  Parts placed:    {total_parts_placed}")
    if total_parts_unmatched > 0:
        print(f"  ⚠️  Unplaced:    {total_parts_unmatched}")
    if total_oversized > 0:
        print(f"  ⛔ Oversized:    {total_oversized} (超板，无法裁切)")
    print(f"  All placed:      {'✅ Yes' if all_parts_cut else '❌ No'}")
    print(f"  {'─' * 58}")
    print(f"  Board breakdown:")
    for bt, cnt in sorted(board_type_counts.items()):
        print(f"    {bt}: {cnt} strips")
    print(f"  {'─' * 58}")
    print(f"  T0 sheets used:  {t0_sheets_used}")
    if aggregated_t0_sheets:
        t0_util = output["t0_plan"].get("total_utilization", 0)
        print(f"  T0 utilization:  {t0_util*100:.1f}%")
    print(f"  T0 recovered:    {t0_total_recovery} strips")
    if recovered_inventory:
        for r in recovered_inventory:
            print(f"    ♻️ {r['label']} ({r['width']}mm) → {r['board_type']}")
    print(f"  Inventory used:  {used_inventory}")
    print(f"  Total strips:    {total_boards}")
    print(f"  Utilization:     {overall_util*100:.1f}%")
    print(f"  Total waste:     {total_waste_area:.1f}mm²")
    print(f"  Output:          {output_path}")
    print(f"{'=' * 60}")

    return output


def main():
    run_engine(
        parts_path="data/parts.xlsx",
        inventory_path="data/t1_inventory.xlsx",
        output_path="output/cut_result.json",
    )


if __name__ == "__main__":
    main()
