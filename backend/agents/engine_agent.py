"""
橱柜工厂直切优化引擎 v3

术语统一（橱柜行业）:
  - Height: 板件的长度方向 (mm)，沿板长方向排列 (2438.4mm axis)
  - Depth:  板件的深度/宽度方向 (mm)

Board Hierarchy:
  T0: 1219.2 × 2438.4 mm (full raw sheet)
  T1: 304.8 × 2438.4 mm  (wall cabinet stock)
  T1: 609.6 × 2438.4 mm  (base/tall cabinet stock)
  T2: Final cabinet parts (side panels, top/bottom, back, shelves, stretchers)

Matching Logic (v3 — Best-Fit):
  - Parts are assigned to the SMALLEST board whose Depth >= part Depth
  - If no board fits normally, try rotating the part (swap Height/Depth)
  - Parts that don't fit any board are reported as unmatched

Cutting Logic (1D FFD Bin Packing):
  - Board Height (2438.4mm) is the cutting axis
  - Each board: usable = board_Height - TRIM_LOSS
  - Placing k parts: sum(cut_lengths) + k × SAW_KERF ≤ usable
  - utilization = sum(cut_lengths) / board_Height
"""

import json
import os
from collections import defaultdict

import pandas as pd


# ── Factory Parameters (mm) ─────────────────────────────
TRIM_LOSS = 5.0   # trim per board edge
SAW_KERF  = 5.0   # kerf per cut


# ─────────────────────────────────────────────
# Data Loading
# ─────────────────────────────────────────────

def load_parts(path: str):
    """Read parts.xlsx (output from cabinet_calculator v2)."""
    df = pd.read_excel(path)

    # Support both old format (part_id, Height, Depth, qty)
    # and new format (part_id, cab_id, cab_type, component, Height, Depth, qty)
    required = {"Height", "Depth"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[parts.xlsx] Missing columns: {missing}")

    df = df.dropna(subset=["Height", "Depth"])

    parts = []
    skipped = []

    for i, row in df.iterrows():
        pid = str(row.get("part_id", f"P{i+1}")).strip()
        try:
            h = float(row["Height"])
            d = float(row["Depth"])
            q = int(row.get("qty", 1))
        except (ValueError, TypeError) as e:
            skipped.append({"row": i + 2, "reason": str(e)})
            continue

        if h <= 0 or d <= 0 or q <= 0:
            skipped.append({"row": i + 2, "reason": f"Invalid: Height={h}, Depth={d}, qty={q}"})
            continue

        # Carry over extra metadata if present
        extra = {}
        for col in ("cab_id", "cab_type", "component"):
            if col in row:
                extra[col] = str(row[col])

        for _ in range(q):
            parts.append({
                "part_id": pid,
                "Height": h,
                "Depth": d,
                **extra,
            })

    if skipped:
        print(f"⚠️  Skipped {len(skipped)} rows:")
        for s in skipped:
            print(f"  Row {s['row']}: {s['reason']}")

    if not parts:
        raise RuntimeError("[parts.xlsx] No valid parts found")

    print(f"📦 Loaded parts: {len(parts)} pieces ({len(df)} rows × qty)")
    return parts, skipped


def load_inventory(path: str):
    """Read t1_inventory.xlsx."""
    df = pd.read_excel(path)

    required = {"board_type", "Height", "Depth", "qty"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[inventory] Missing columns: {missing}")

    boards = {}
    for _, row in df.iterrows():
        bt = str(row["board_type"]).strip()
        boards[bt] = {
            "board_type": bt,
            "Height": float(row["Height"]),
            "Depth": float(row["Depth"]),
            "qty": int(row["qty"]),
        }

    print(f"📋 Inventory: {len(boards)} board types")
    for bt, info in sorted(boards.items(), key=lambda x: x[1]["Depth"]):
        print(f"    {bt}: {info['Depth']} × {info['Height']} mm, qty={info['qty']}")
    return boards


# ─────────────────────────────────────────────
# Matching: Parts → Board Types (Best-Fit)
# ─────────────────────────────────────────────

def match_parts_to_boards(parts: list, boards: dict):
    """
    Best-fit matching: assign each part to the SMALLEST board
    whose Depth >= part's Depth.

    If normal orientation doesn't fit, try rotating (swap Height/Depth).
    Rotated parts must also have rotated Height <= board Height.

    Returns:
      matched:   dict[board_type] → list of {part_id, cut_length, ...}
      unmatched: list of parts that can't fit any board
    """
    # Sort board types by Depth ascending (smallest first for best-fit)
    sorted_boards = sorted(boards.values(), key=lambda b: b["Depth"])

    matched = defaultdict(list)
    unmatched = []

    for p in parts:
        p_height, p_depth = p["Height"], p["Depth"]
        placed = False

        # Try normal orientation: part Depth ≤ board Depth, part Height is cut_length
        for board in sorted_boards:
            if p_depth <= board["Depth"] and p_height <= board["Height"]:
                matched[board["board_type"]].append({
                    **p,
                    "cut_length": p_height,
                })
                placed = True
                break

        if placed:
            continue

        # Try rotated: swap Height/Depth
        for board in sorted_boards:
            if p_height <= board["Depth"] and p_depth <= board["Height"]:
                matched[board["board_type"]].append({
                    **p,
                    "cut_length": p_depth,
                    "rotated": True,
                })
                placed = True
                break

        if not placed:
            unmatched.append(p)

    if unmatched:
        print(f"\n🚫 {len(unmatched)} parts have no matching board:")
        seen = set()
        for u in unmatched:
            key = f"{u['part_id']}({u['Height']}×{u['Depth']})"
            if key not in seen:
                seen.add(key)
                comp = u.get('component', '?')
                print(f"  {key} [{comp}]")

    return matched, unmatched


# ─────────────────────────────────────────────
# FFD Bin Packing (1D along board Height axis)
# ─────────────────────────────────────────────

def ffd_bin_pack(parts_list: list, board_info: dict):
    """
    First Fit Decreasing:
    - Sort parts by cut_length descending
    - Try to place each part on an existing board
    - If it doesn't fit, open a new board

    Returns: list of board results with parts and utilization info
    """
    board_height = board_info["Height"]
    board_depth  = board_info["Depth"]
    board_type   = board_info["board_type"]
    max_qty      = board_info["qty"]
    usable       = board_height - TRIM_LOSS

    sorted_parts = sorted(parts_list, key=lambda p: p["cut_length"], reverse=True)

    open_boards = []

    for part in sorted_parts:
        cl = part["cut_length"]
        needed = cl + SAW_KERF

        if needed > usable:
            print(f"  ⚠️  Part {part['part_id']} cut_length {cl}mm + kerf {SAW_KERF}mm > usable {usable}mm, skipped")
            continue

        # First Fit
        placed = False
        for board in open_boards:
            if board["remaining"] >= needed:
                board["parts"].append(part)
                board["remaining"] -= needed
                placed = True
                break

        if not placed:
            if len(open_boards) >= max_qty:
                print(f"  ⚠️  Board type {board_type} stock depleted ({max_qty} used)")
                break
            open_boards.append({
                "remaining": usable - needed,
                "parts": [part],
            })

    # Calculate utilization for each board
    results = []
    for idx, board in enumerate(open_boards, 1):
        board_id = f"{board_type}-{idx:03d}"
        parts_total = sum(p["cut_length"] for p in board["parts"])
        k = len(board["parts"])
        kerf_total = k * SAW_KERF
        waste = usable - parts_total - kerf_total
        utilization = parts_total / board_height if board_height > 0 else 0

        results.append({
            "board_id": board_id,
            "board": board_type,
            "board_size": f"{board_depth} × {board_height}",
            "parts": [
                {
                    "part_id": p["part_id"],
                    "Height": p["Height"],
                    "Depth": p["Depth"],
                    "cut_length": p["cut_length"],
                    "component": p.get("component", ""),
                    "cab_id": p.get("cab_id", ""),
                    "cab_type": p.get("cab_type", ""),
                    "rotated": p.get("rotated", False),
                }
                for p in board["parts"]
            ],
            "trim_loss": TRIM_LOSS,
            "saw_kerf": SAW_KERF,
            "cuts": k,
            "parts_total_length": round(parts_total, 1),
            "kerf_total": round(kerf_total, 1),
            "usable_length": round(usable, 1),
            "waste": round(waste, 1),
            "utilization": round(utilization, 4),
        })

    return results


# ─────────────────────────────────────────────
# Main Pipeline
# ─────────────────────────────────────────────

def run_engine(parts_path: str, inventory_path: str, output_path: str = "output/cut_result.json"):
    """Full engine run: load → match → pack → output JSON."""

    print("=" * 55)
    print("  Guillotine Cutting Engine v3 — FFD Bin Packing")
    print("=" * 55)

    # 1. Load data
    parts, skipped_rows = load_parts(parts_path)
    boards = load_inventory(inventory_path)

    # 2. Match parts to boards (best-fit by Depth)
    matched, unmatched = match_parts_to_boards(parts, boards)

    total_matched = sum(len(v) for v in matched.values())
    print(f"\n✅ Matched: {total_matched} parts → {len(matched)} board types")

    # 3. FFD bin packing per board type
    all_board_results = []

    for board_type in sorted(matched.keys()):
        parts_list = matched[board_type]
        board_info = boards[board_type]
        print(f"\n── {board_type} (Depth {board_info['Depth']}mm) ── {len(parts_list)} parts")

        board_results = ffd_bin_pack(parts_list, board_info)
        all_board_results.extend(board_results)

        for br in board_results:
            parts_str = ", ".join(
                f"{p['part_id']}({p['cut_length']})"
                for p in br["parts"]
            )
            print(f"  {br['board_id']}: util {br['utilization']*100:.1f}% | waste {br['waste']}mm | {parts_str}")

    # 4. Summary
    total_boards = len(all_board_results)
    total_parts_required = len(parts)
    total_parts_placed = sum(len(b["parts"]) for b in all_board_results)
    total_parts_unmatched = len(unmatched)
    all_parts_cut = (total_parts_placed == total_parts_required) and (total_parts_unmatched == 0)

    total_parts_len = sum(b["parts_total_length"] for b in all_board_results)
    total_trim = sum(b["trim_loss"] for b in all_board_results)
    total_kerf = sum(b["kerf_total"] for b in all_board_results)
    total_waste = sum(b["waste"] for b in all_board_results)
    total_board_len = sum(b["usable_length"] + b["trim_loss"] for b in all_board_results)
    overall_util = total_parts_len / total_board_len if total_board_len > 0 else 0

    summary = {
        "total_parts_required": total_parts_required,
        "total_parts_placed": total_parts_placed,
        "total_parts_unmatched": total_parts_unmatched,
        "all_parts_cut": all_parts_cut,
        "boards_used": total_boards,
        "total_parts_length": round(total_parts_len, 1),
        "total_trim_loss": round(total_trim, 1),
        "total_kerf_loss": round(total_kerf, 1),
        "total_waste": round(total_waste, 1),
        "overall_utilization": round(overall_util, 4),
        "config_trim_loss_mm": TRIM_LOSS,
        "config_saw_kerf_mm": SAW_KERF,
    }

    if unmatched:
        summary["warning"] = f"{len(unmatched)} parts unmatched, see issues"

    # 5. Issues report
    issues = {
        "skipped_rows": [
            {"file": "parts.xlsx", "source": f"Row {s['row']}: {s['reason']}"}
            for s in skipped_rows
        ],
        "unmatched_parts": [],
    }
    seen_unmatched = {}
    for u in unmatched:
        key = f"{u['part_id']}|{u['Height']}x{u['Depth']}"
        if key not in seen_unmatched:
            seen_unmatched[key] = {"count": 0, **u}
        seen_unmatched[key]["count"] += 1

    for key, u in seen_unmatched.items():
        issues["unmatched_parts"].append({
            "part_id": u["part_id"],
            "Height_mm": u["Height"],
            "Depth_mm": u["Depth"],
            "component": u.get("component", ""),
            "qty": u["count"],
            "reasons": [f"No board with Depth >= {u['Depth']}mm (or rotated Height >= {u['Height']}mm)"],
            "suggestion": "Add a larger board type to inventory, or check part dimensions",
        })

    # 6. Output JSON
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    output = {
        "summary": summary,
        "issues": issues,
        "boards": all_board_results,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n{'=' * 55}")
    print(f"  ✅ Optimization Complete!")
    print(f"  {'=' * 53}")
    print(f"  Parts required: {total_parts_required}")
    print(f"  Parts placed:   {total_parts_placed}")
    if total_parts_unmatched > 0:
        print(f"  ⚠️  Unmatched:   {total_parts_unmatched} (no fitting board)")
    print(f"  All placed:     {'✅ Yes' if all_parts_cut else '❌ No'}")
    print(f"  {'─' * 53}")
    print(f"  Boards used: {total_boards} | Utilization: {overall_util*100:.1f}%")
    print(f"  Parts total length: {total_parts_len:.1f}mm")
    print(f"  Total waste: {total_waste:.1f}mm")
    print(f"  Output: {output_path}")
    print(f"{'=' * 55}")

    return output


# Keep backward-compatible function names for workflow_controller
def main():
    run_engine(
        parts_path="data/parts.xlsx",
        inventory_path="data/t1_inventory.xlsx",
        output_path="output/cut_result.json",
    )


if __name__ == "__main__":
    main()