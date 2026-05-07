"""
Per-color orchestrator and main `run_engine` entry point for the
stack-efficiency cutting strategy.

This engine prioritizes repeatable stack cuts over raw material utilization:

1. T1 is used first when cut_width exactly matches an available inventory width.
2. Production is staged: rip T0 standard-width strips first, then length-cut
   standard strips together with matching T1 inventory as one stack pool.
3. T0 Sheet mode ignores existing T1; standard-width strips cut from T0 serve
   the current order first.
4. Leftover stretchers are cut from full-length recovery candidates before
   any unused candidates become final recovered inventory.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict
from typing import Any

from cutting.efficient import (
    DEFAULT_BOX_COLOR,
    _validate_cut_result,
    load_inventory,
    load_parts,
)

from .allocation import (
    _allocate_stretcher_from_waste_candidates,
    _allocate_stretcher_from_recovery_candidates,
    _allocate_strip_sources,
    _allocate_stretcher_sources,
    _is_final_recovery_width,
)
from .constants import (
    BOARD_HEIGHT,
    MAX_STACK,
    SAW_KERF,
    T0_WIDTH,
)
from .primitives import _cut_width, _is_stretcher_width, _r1, _t0_stock
from .strips import (
    _board_from_strip,
    _build_stack_first_strips,
    _build_stretcher_strips,
    _parts_fit_or_rotate,
    _repack_t0_strips_by_width,
)
from .t0_packer import (
    _build_color_inventory,
    _build_t0_sheet_pack,
    _bundle_into_stacks,
    _finalize_t0_sheets,
    _merge_stackable_t0_sheets,
)


def _sheet_stack_context(sheet: dict) -> str:
    signature = []
    for strip in sheet.get("strips", []):
        if strip.get("t0_source_strip_secondary"):
            continue
        if _is_stretcher_width(strip.get("strip_width", 0)):
            continue
        signature.append(f"{_r1(strip.get('strip_width', 0))}:{strip.get('pattern_key', '')}")
    return "|".join(signature)


def _physical_t0_count(sheets: list[dict]) -> int:
    """Count physical raw T0 sheets, accounting for stacked entries."""
    return sum(int(sheet.get("t0_sheet_stack", 1)) for sheet in sheets)


def _strip_used_length_from_board(board: dict) -> float:
    parts = board.get("parts", [])
    return sum(float(part.get("cut_length") or part.get("Height") or 0) for part in parts) + max(0, len(parts) - 1) * SAW_KERF


def _waste_candidate_entry(
    *,
    waste_id: str,
    source_board_id: str,
    color: str,
    width: float,
    length: float,
    origin: str,
    kind: str,
    source_board_type: str | None = None,
) -> dict | None:
    width = _r1(width)
    length = _r1(length)
    if width < 90 or width > 24 * 25.4 or length <= 0.5:
        return None
    return {
        "id": waste_id,
        "source": "waste",
        "origin": origin,
        "kind": kind,
        "source_board_id": source_board_id,
        "source_board_type": source_board_type,
        "board_type": f"WASTE-{width}x{length}",
        "color": color,
        "width": width,
        "length": length,
        "label": f"Waste {width}×{length}mm",
    }


def _collect_board_waste_candidates(boards: list[dict], color: str) -> list[dict]:
    candidates: list[dict] = []
    for board in boards:
        if str(board.get("source", "")).lower() == "recovery":
            continue
        board_id = board.get("board_id", "?")
        board_type = board.get("board") or board.get("board_type")
        length_waste = float(board.get("usable_length", 0)) - _strip_used_length_from_board(board)
        entry = _waste_candidate_entry(
            waste_id=f"WASTE-{board_id}-L",
            source_board_id=board_id,
            source_board_type=board_type,
            color=board.get("color", color),
            width=float(board.get("strip_width", 0)),
            length=length_waste,
            origin="length_waste",
            kind="length",
        )
        if entry:
            candidates.append(entry)

        if board.get("t0_sheet_id") or board.get("rip_leftover_recovered"):
            continue
        width_waste = float(board.get("rip_leftover") or 0)
        entry = _waste_candidate_entry(
            waste_id=f"WASTE-{board_id}-W",
            source_board_id=board_id,
            source_board_type=board_type,
            color=board.get("color", color),
            width=width_waste,
            length=BOARD_HEIGHT,
            origin="width_waste",
            kind="width",
        )
        if entry:
            candidates.append(entry)
    return candidates


def _run_color(parts: list[dict], inventory: dict, color: str, force_t0_start: bool, trim_loss: float, t0_id_offset: int) -> dict:
    main_parts = [part for part in parts if not _is_stretcher_width(_cut_width(part))]
    stretcher_parts = [part for part in parts if _is_stretcher_width(_cut_width(part))]

    parts_by_width: dict[float, list[dict]] = defaultdict(list)
    for part in main_parts:
        parts_by_width[_r1(_cut_width(part))].append(part)

    inventory_strips: list[tuple[dict, str]] = []
    t0_candidate_strips: list[dict] = []
    used_inventory: dict[str, int] = {}
    inventory_remaining: dict[str, int] = {
        bt: int(info.get("qty", 0))
        for bt, info in inventory.items()
        if not str(bt).upper().startswith("T0")
    }
    recovery_candidates: list[dict] = []

    for width in sorted(parts_by_width.keys(), reverse=True):
        strips = _build_stack_first_strips(parts_by_width[width], width, color, trim_loss)
        # Length-pack before source allocation so T1 inventory and T0 fallback
        # both reuse the same strip length instead of opening one strip per length.
        strips = _repack_t0_strips_by_width(strips, color, trim_loss)
        allocated, t0_extra = _allocate_strip_sources(
            strips,
            width,
            color,
            inventory,
            force_t0_start,
            used_inventory,
            inventory_remaining,
            recovery_candidates,
        )
        inventory_strips.extend(allocated)
        t0_candidate_strips.extend(t0_extra)

    t0_candidate_strips = _repack_t0_strips_by_width(t0_candidate_strips, color, trim_loss)
    sheets = _build_t0_sheet_pack(t0_candidate_strips, trim_loss)

    if stretcher_parts:
        stretcher_strips = _build_stretcher_strips(stretcher_parts, color, trim_loss)
        stretcher_inventory, _, unplaced_stretchers = _allocate_stretcher_sources(
            stretcher_strips,
            sheets,
            color,
            inventory,
            force_t0_start=force_t0_start,
            trim_loss=trim_loss,
            used_inventory=used_inventory,
            inventory_remaining=inventory_remaining,
        )
        inventory_strips.extend(stretcher_inventory)
    else:
        unplaced_stretchers = []

    inventory_only_strips = [s for s, _ in inventory_strips]

    # ── T0 sheet stacking (叠切): merge sheets with identical rip patterns ──
    sheets = _merge_stackable_t0_sheets(sheets, max_stack=MAX_STACK)

    t0_all_strips = []
    for sheet in sheets:
        t0_all_strips.extend(sheet["strips"])
        for layer_strips in sheet.get("t0_stacked_layers", []):
            t0_all_strips.extend(layer_strips)
    for sheet_idx, sheet in enumerate(sheets):
        sheet_signature_context = _sheet_stack_context(sheet)
        sheet_instance_context = f"t0-{sheet_idx:04d}"
        for strip in sheet.get("strips", []):
            if strip.get("t0_source_strip_secondary"):
                continue
            if _is_stretcher_width(strip.get("strip_width", 0)):
                strip["stack_context_key"] = sheet_signature_context
            else:
                strip["stack_context_key"] = sheet_instance_context
        for layer_strips in sheet.get("t0_stacked_layers", []):
            for strip in layer_strips:
                if strip.get("t0_source_strip_secondary"):
                    continue
                if _is_stretcher_width(strip.get("strip_width", 0)):
                    strip["stack_context_key"] = sheet_signature_context
                else:
                    strip["stack_context_key"] = sheet_instance_context
    t0_pack = _finalize_t0_sheets(sheets, color, inventory, trim_loss, t0_id_offset)
    recovery_candidates.extend(t0_pack.get("recovery_candidates", []))
    standard_recovery_candidates = [
        candidate for candidate in recovery_candidates
        if _is_final_recovery_width(float(candidate.get("width", 0)))
    ]
    waste_candidates = [
        {**candidate, "kind": candidate.get("kind", candidate.get("origin", "width_waste"))}
        for candidate in recovery_candidates
        if not _is_final_recovery_width(float(candidate.get("width", 0)))
    ]
    recovery_lane_strips, recovery_cutting_boards, recovered_inventory, unplaced_stretchers = (
        _allocate_stretcher_from_recovery_candidates(
            unplaced_stretchers,
            standard_recovery_candidates,
            color,
            trim_loss,
        )
    )
    inventory_only_strips = [s for s, _ in inventory_strips]
    _bundle_into_stacks(inventory_only_strips, pattern_prefix=f"INV-{color}-")
    _bundle_into_stacks(t0_all_strips, pattern_prefix=f"T0-{color}-")
    _bundle_into_stacks(recovery_lane_strips, pattern_prefix=f"REC-{color}-")

    t0_board_type = t0_pack["t0_board_type"]
    board_results = []
    board_index = 1

    for strip, board_type in inventory_strips:
        board_results.append(_board_from_strip(strip, board_type, "inventory", board_index, trim_loss))
        board_index += 1

    for strip in t0_pack["t0_strips"]:
        board_results.append(_board_from_strip(strip, t0_board_type, "T0", board_index, trim_loss))
        board_index += 1

    waste_candidates.extend(_collect_board_waste_candidates(board_results, color))
    waste_lane_strips, waste_cutting_boards, waste_blocks, unplaced_stretchers = (
        _allocate_stretcher_from_waste_candidates(
            unplaced_stretchers,
            waste_candidates,
            color,
        )
    )

    for strip in recovery_lane_strips:
        board_type = strip.get("source_stock_board_type") or f"REC-{strip.get('source_stock_width', strip.get('strip_width'))}x{BOARD_HEIGHT}"
        board_results.append(_board_from_strip(strip, board_type, "recovery", board_index, trim_loss))
        board_index += 1
    for strip in waste_lane_strips:
        board_type = strip.get("source_stock_board_type") or f"WASTE-{strip.get('source_stock_width', strip.get('strip_width'))}x{BOARD_HEIGHT}"
        board_results.append(_board_from_strip(strip, board_type, "recovery", board_index, trim_loss))
        board_index += 1
    recovery_cutting_boards.extend(waste_cutting_boards)

    sheet_to_parts_area: dict[str, float] = defaultdict(float)
    sheet_to_recovered_area: dict[str, float] = defaultdict(float)
    for sheet in t0_pack["t0_sheets"]:
        sheet_to_recovered_area[sheet["sheet_id"]] = sum(
            recovered["width"] * BOARD_HEIGHT for recovered in sheet.get("recovered_strips", [])
        )
    for board in board_results:
        sheet_id = board.get("t0_sheet_id")
        if sheet_id:
            sheet_to_parts_area[sheet_id] += board["parts_total_area"]
    for board in board_results:
        sheet_id = board.get("t0_sheet_id")
        if sheet_id:
            board["t0_sheet_utilization"] = round(
                (sheet_to_parts_area[sheet_id] + sheet_to_recovered_area[sheet_id]) / (T0_WIDTH * BOARD_HEIGHT),
                4,
            )

    return {
        "boards": board_results,
        "t0_sheets": t0_pack["t0_sheets"],
        "recovery_cutting_boards": recovery_cutting_boards,
        "recovered_inventory": recovered_inventory,
        "waste_blocks": waste_blocks,
        "used_inventory": used_inventory,
        "unplaced_stretchers": unplaced_stretchers,
        "color": color,
    }


def run_engine(
    parts_path: str,
    inventory_path: str | None = None,
    output_path: str = "output/cut_result.json",
    cabinet_breakdown: dict | None = None,
    force_t0_start: bool = False,
    trim_loss_mm: float = 2,
):
    print("=" * 60)
    print("  Stack Efficiency Cutting Engine")
    print("=" * 60)
    print(f"  Mode: {'T0 Sheet' if force_t0_start else 'T1 Stock'}")
    print(f"  Trim: {trim_loss_mm:g}mm | Saw kerf: {SAW_KERF:g}mm | Max stack: {MAX_STACK}")

    trim_loss = max(0.0, float(trim_loss_mm))
    parts, skipped_rows = load_parts(parts_path)
    inventory_per_color = load_inventory(inventory_path)
    if not inventory_per_color:
        raise RuntimeError("Inventory is empty")

    valid_parts, oversized_parts = _parts_fit_or_rotate(parts, trim_loss)
    parts_by_color: dict[str, list[dict]] = defaultdict(list)
    for part in valid_parts:
        parts_by_color[part.get("color", DEFAULT_BOX_COLOR)].append(part)

    all_boards: list[dict] = []
    all_t0_sheets: list[dict] = []
    recovery_cutting_boards: list[dict] = []
    waste_blocks: list[dict] = []
    recovered_inventory: list[dict] = []
    used_inventory: dict[str, int] = {}
    inventory_used_by_color: dict[str, dict[str, int]] = {}
    by_color: dict[str, dict[str, Any]] = {}
    t0_id_offset = 0
    inventory_by_color: dict[str, dict] = {}
    unplaced_stretchers: list[dict] = []

    for color, color_parts in parts_by_color.items():
        color_inventory = _build_color_inventory(color, inventory_per_color)
        inventory_by_color[color] = color_inventory
        partial = _run_color(
            color_parts,
            color_inventory,
            color,
            force_t0_start=force_t0_start,
            trim_loss=trim_loss,
            t0_id_offset=t0_id_offset,
        )
        all_boards.extend(partial["boards"])
        all_t0_sheets.extend(partial["t0_sheets"])
        recovery_cutting_boards.extend(partial.get("recovery_cutting_boards", []))
        waste_blocks.extend(partial.get("waste_blocks", []))
        recovered_inventory.extend(partial["recovered_inventory"])
        unplaced_stretchers.extend(partial.get("unplaced_stretchers", []))
        t0_id_offset += len(partial["t0_sheets"])

        for board_type, count in partial["used_inventory"].items():
            key = f"{board_type}|{color}"
            used_inventory[key] = used_inventory.get(key, 0) + count
            inventory_used_by_color.setdefault(color, {})[board_type] = (
                inventory_used_by_color.setdefault(color, {}).get(board_type, 0) + count
            )

        parts_area = sum(board["parts_total_area"] for board in partial["boards"])
        recovered_area = sum(
            recovered["width"] * BOARD_HEIGHT
            for recovered in partial["recovered_inventory"]
        )
        physical_t0_count = _physical_t0_count(partial["t0_sheets"])
        t0_area = physical_t0_count * T0_WIDTH * BOARD_HEIGHT
        t1_area = sum(board["board_area"] for board in partial["boards"] if board.get("source") == "inventory")
        total_area = t0_area + t1_area
        by_color[color] = {
            "parts_total": len(color_parts),
            "parts_placed": sum(len(board["parts"]) for board in partial["boards"]),
            "total_parts_placed": sum(len(board["parts"]) for board in partial["boards"]),
            "boards_used": len(partial["boards"]),
            "t0_sheets_used": physical_t0_count,
            "t0_recovered_strips": len(partial["recovered_inventory"]),
            "overall_utilization": round((parts_area + recovered_area) / total_area if total_area > 0 else 0, 4),
        }

    board_type_counts: dict[str, int] = defaultdict(int)
    for board in all_boards:
        board_type_counts[board["board"]] += 1

    t0_shortages = []
    for color in parts_by_color.keys():
        color_t0_sheets = [sheet for sheet in all_t0_sheets if sheet.get("color") == color]
        if not color_t0_sheets:
            continue
        t0_board_type, stock = _t0_stock(inventory_by_color[color])
        needed = _physical_t0_count(color_t0_sheets)
        if needed > stock:
            t0_shortages.append({
                "board_type": t0_board_type,
                "color": color,
                "needed": needed,
                "stock": stock,
                "shortage": needed - stock,
            })

    total_parts_required = len(valid_parts)
    total_parts_placed = sum(len(board["parts"]) for board in all_boards)
    total_oversized = len(oversized_parts)
    total_physical_t0 = _physical_t0_count(all_t0_sheets)
    total_board_area = (
        total_physical_t0 * T0_WIDTH * BOARD_HEIGHT
        + sum(board["board_area"] for board in all_boards if board.get("source") == "inventory")
    )
    total_parts_area = sum(board["parts_total_area"] for board in all_boards)
    total_recovered_area = sum(recovered["width"] * BOARD_HEIGHT for recovered in recovered_inventory)
    total_length_kerf_area = sum(board["kerf_total"] * board["strip_width"] for board in all_boards)
    total_t0_rip_kerf_area = sum(
        float(sheet.get("kerf_loss", 0)) * BOARD_HEIGHT * int(sheet.get("t0_sheet_stack", 1))
        for sheet in all_t0_sheets
    )
    total_waste_area = total_board_area - total_parts_area - total_recovered_area - total_length_kerf_area - total_t0_rip_kerf_area
    overall_utilization = (total_parts_area + total_recovered_area) / total_board_area if total_board_area > 0 else 0

    issues = {
        "skipped_rows": [
            {"file": "parts.xlsx", "source": f"Row {row['row']}: {row['reason']}"}
            for row in skipped_rows
        ],
        "unmatched_parts": [],
        "oversized_parts": [
            {
                "part_id": part.get("part_id", "?"),
                "cab_id": part.get("cab_id", "?"),
                "component": part.get("component", "?"),
                "Height": part.get("Height"),
                "Width": part.get("Width"),
                "color": part.get("color", DEFAULT_BOX_COLOR),
                "reason": f"尺寸 {part.get('Height')}×{part.get('Width')}mm 超过板材最大尺寸",
            }
            for part in oversized_parts
        ],
    }
    if unplaced_stretchers:
        issues["unmatched_parts"].extend([
            {
                "part_id": strip["parts"][0].get("part_id", "?"),
                "cab_id": strip["parts"][0].get("cab_id", "?"),
                "component": strip["parts"][0].get("component", "Stretcher"),
                "Height": strip["parts"][0].get("Height"),
                "Width": strip["parts"][0].get("Width"),
                "color": strip["parts"][0].get("color", DEFAULT_BOX_COLOR),
                "reason": "现有 T0 余料和临时回收板材都不足，拉条无法排版",
            }
            for strip in unplaced_stretchers
        ])

    stack_size_breakdown: dict[int, int] = defaultdict(int)
    distinct_stack_groups: set[str] = set()
    width_rip_count = 0
    width_rip_recovered_count = 0
    for board in all_boards:
        gid = board.get("stack_group_id")
        if gid and gid not in distinct_stack_groups:
            distinct_stack_groups.add(gid)
            stack_size_breakdown[int(board.get("stack_size", 1))] += 1
        if board.get("rip_from") is not None:
            width_rip_count += 1
            if board.get("rip_leftover_recovered"):
                width_rip_recovered_count += 1

    summary = {
        "total_parts_required": total_parts_required,
        "total_parts_placed": total_parts_placed,
        "total_parts_unmatched": max(0, total_parts_required - total_parts_placed),
        "all_parts_cut": total_parts_placed == total_parts_required and total_oversized == 0,
        "strips_used": len(all_boards),
        "boards_used": len(all_boards),
        "t0_sheets_used": total_physical_t0,
        "t0_recovered_strips": len(recovered_inventory),
        "inventory_used": used_inventory,
        "inventory_shortage": t0_shortages,
        "board_type_breakdown": dict(board_type_counts),
        "by_color": by_color,
        "total_parts_length": round(sum(board["parts_total_length"] for board in all_boards), 1),
        "total_trim_loss": round(sum(board["trim_loss"] for board in all_boards), 1),
        "total_kerf_loss": round(sum(board["kerf_total"] for board in all_boards), 1),
        "total_waste": round(total_waste_area, 1),
        "overall_utilization": round(overall_utilization, 4),
        "config_trim_loss_mm": trim_loss,
        "config_saw_kerf_mm": SAW_KERF,
        "cut_mode": "t0_start" if force_t0_start else "inventory_first",
        "cut_algorithm": "stack_efficiency",
        "max_stack": MAX_STACK,
        "stack_groups": len(distinct_stack_groups),
        "stack_passes": len(distinct_stack_groups),
        "stack_size_breakdown": {str(k): v for k, v in sorted(stack_size_breakdown.items(), reverse=True)},
        "width_rip_count": width_rip_count,
        "width_rip_recovered_count": width_rip_recovered_count,
        "production_flow": [
            "rip_t0_standard_strips",
            "stack_length_cut_standard_pool",
            "cut_nonstandard_t0_strips",
            "collect_recovery_boards",
            "cut_stretchers_from_recovery_boards",
        ],
    }
    if total_oversized:
        summary["oversized_count"] = total_oversized

    output: dict[str, Any] = {
        "summary": summary,
        "issues": issues,
        "boards": all_boards,
        "cut_mode": "t0_start" if force_t0_start else "inventory_first",
        "cut_algorithm": "stack_efficiency",
    }
    if all_t0_sheets:
        output["t0_plan"] = {
            "t0_sheets_needed": total_physical_t0,
            "t0_sheets": all_t0_sheets,
            "total_utilization": round(
                sum(float(sheet.get("utilization", 0)) for sheet in all_t0_sheets) / len(all_t0_sheets),
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
    if recovered_inventory:
        output["recovered_inventory"] = recovered_inventory
    if recovery_cutting_boards:
        output["recovery_cutting_boards"] = recovery_cutting_boards
    if waste_blocks:
        output["waste_blocks"] = waste_blocks
    if cabinet_breakdown:
        output["cabinet_breakdown"] = cabinet_breakdown

    _validate_cut_result(output, cabinet_breakdown, total_parts_required, oversized_parts)

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2, ensure_ascii=False)

    print(f"\nStack efficiency complete: {total_parts_placed}/{total_parts_required} parts, "
          f"{len(all_boards)} strips, {total_physical_t0} T0 sheets "
          f"({len(all_t0_sheets)} patterns)")
    return output
