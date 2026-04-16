#!/usr/bin/env python3
"""
Cabinet Panel Calculator v2 — Batch Order Processing

Reads an order Excel with columns:
  Cabinet No., ABC Item, W", H", D", Qty, Type,
  Adjustable Shelf Qty, Fixed Shelf Qty

Outputs a parts list (parts.xlsx) with every individual board piece
needed for all cabinets, ready for the cutting engine.

Units: Input is inches, all internal calculations and output are in mm.
Precision: 1 decimal place (× 25.4 conversion).

Cabinet Types:
  wall  — Wall cabinet  (吊柜): top+bottom, no stretchers
  base  — Base cabinet  (地柜): bottom only, 2 stretchers, no top
  tall  — Tall cabinet  (高柜): top+bottom, no stretchers

Construction:
  - Side panels wrap everything (outermost)
  - Back panel wraps top/bottom (sits behind them)
  - Back panel slides into 3mm grooves on each side panel → back panel width = W - 36 + 6 = W - 30
  - Top/bottom sit between side panels → width = W - 36
  - Top/bottom depth = D - 18 (back panel thickness)
"""

import os
import pandas as pd

# ─── Constants (mm) ─────────────────────────────────────
BOARD_THICKNESS = 18.0       # 板材厚度
GROOVE_DEPTH = 3.0           # 通槽深度 (each side)
SHELF_INSET = 20.0           # 活动层板前方内缩
STRETCHER_DEPTH = 101.6      # 拉条深度 (4")
INCHES_TO_MM = 25.4

# ─── Default dimensions (mm) ────────────────────────────
WALL_DEFAULT_DEPTH = 304.8      # 12"
BASE_DEFAULT_DEPTH = 609.6      # 24"
BASE_DEFAULT_HEIGHT = 876.3     # 34.5"
TALL_DEFAULT_DEPTH = 609.6      # 24"
TALL_DEFAULT_HEIGHT = 2387.6    # 94"


def r1(val: float) -> float:
    """Round to 1 decimal place."""
    return round(val, 1)


def detect_cabinet_type(abc_item: str) -> str:
    """
    Auto-detect cabinet type from ABC Item code prefix.
    W... = wall, B/SB/DB... = base, T/UT... = tall, default = wall.
    Only used as fallback when Type column is missing.
    """
    s = str(abc_item).strip().upper()
    if s.startswith(("B", "SB", "DB", "?")):
        return "base"
    if s.startswith(("T", "UT")):
        return "tall"
    # W, WAC, RFW, etc. → default to wall
    return "wall"


def calculate_panels(
    width_mm: float,
    depth_mm: float,
    height_mm: float,
    cab_type: str,
    adj_shelf: int,
    fixed_shelf: int,
    cab_id: str = "",
) -> list[dict]:
    """
    Calculate all board pieces for a single cabinet.

    Returns a list of dicts, each representing one piece type:
      {part_id, component, length, width, qty, cab_type, cab_id}
    """
    W = width_mm
    D = depth_mm
    H = height_mm
    t = BOARD_THICKNESS
    g = GROOVE_DEPTH

    parts = []

    # ── Side Panels (左右侧板) ── always 2
    parts.append({
        "component": "Side Panel",
        "length": r1(H),
        "width": r1(D),
        "qty": 2,
    })

    # ── Top Panel (顶板) ── wall & tall only
    if cab_type in ("wall", "tall"):
        parts.append({
            "component": "Top Panel",
            "length": r1(W - t * 2),           # W - 36
            "width": r1(D - t),                 # D - 18
            "qty": 1,
        })

    # ── Bottom Panel (底板) ── all types
    parts.append({
        "component": "Bottom Panel",
        "length": r1(W - t * 2),               # W - 36
        "width": r1(D - t),                     # D - 18
        "qty": 1,
    })

    # ── Back Panel (背板) ── all types, +6mm for grooves
    parts.append({
        "component": "Back Panel",
        "length": r1(W - t * 2 + g * 2),       # W - 30
        "width": r1(H),
        "qty": 1,
    })

    # ── Stretcher Rails (拉条) ── base only, × 2
    if cab_type == "base":
        parts.append({
            "component": "Stretcher",
            "length": r1(W - t * 2),           # W - 36
            "width": STRETCHER_DEPTH,            # 101.6
            "qty": 2,
        })

    # ── Adjustable Shelves (活动层板) ── with 20mm inset
    if adj_shelf > 0:
        parts.append({
            "component": "Adjustable Shelf",
            "length": r1(W - t * 2),           # W - 36
            "width": r1(D - t - SHELF_INSET),   # D - 38
            "qty": adj_shelf,
        })

    # ── Fixed Shelves (固定层板) ── no inset
    if fixed_shelf > 0:
        parts.append({
            "component": "Fixed Shelf",
            "length": r1(W - t * 2),           # W - 36
            "width": r1(D - t),                 # D - 18
            "qty": fixed_shelf,
        })

    # Tag each part with cabinet info
    for p in parts:
        p["cab_type"] = cab_type
        p["cab_id"] = cab_id

    return parts


def process_order(order_path: str, output_path: str = None) -> pd.DataFrame:
    """
    Read an order Excel, calculate all panels for every cabinet,
    and output a flat parts list.

    Args:
        order_path: Path to the order .xlsx file.
        output_path: Where to save parts.xlsx. If None, saves next to order file.

    Returns:
        DataFrame with all parts.
    """
    df = pd.read_excel(order_path)

    # Normalize column names (strip whitespace and newlines)
    df.columns = [c.replace("\n", " ").strip() for c in df.columns]

    # Detect column names (flexible matching)
    col_map = {}
    for c in df.columns:
        cl = c.lower().replace('"', '').replace("'", "").strip()
        if cl in ("w", "w\""):
            col_map["W"] = c
        elif cl in ("h", "h\""):
            col_map["H"] = c
        elif cl in ("d", "d\""):
            col_map["D"] = c
        elif cl in ("qty",):
            col_map["Qty"] = c
        elif "adjustable" in cl and "shelf" in cl:
            col_map["AdjShelf"] = c
        elif "fixed" in cl and "shelf" in cl:
            col_map["FixedShelf"] = c
        elif cl == "type":
            col_map["Type"] = c
        elif cl in ("cabinet no.", "cabinet no", "no.", "no"):
            col_map["CabNo"] = c
        elif cl in ("abc item", "item"):
            col_map["Item"] = c

    has_type_col = "Type" in col_map

    all_parts = []

    for idx, row in df.iterrows():
        # ── Cabinet ID ──
        cab_no = row.get(col_map.get("CabNo", ""), idx + 1)
        item = str(row.get(col_map.get("Item", ""), "")).strip()
        cab_id = item if item else f"C{cab_no}"

        # ── Cabinet Type ──
        if has_type_col:
            cab_type = str(row[col_map["Type"]]).strip().lower()
        else:
            cab_type = detect_cabinet_type(item)

        if cab_type not in ("wall", "base", "tall"):
            cab_type = "wall"  # safe fallback

        # ── Dimensions (inches → mm) ──
        W_in = float(row.get(col_map.get("W", ""), 0))
        H_in = float(row.get(col_map.get("H", ""), 0))
        D_in = float(row.get(col_map.get("D", ""), 0))

        W_mm = r1(W_in * INCHES_TO_MM)
        H_mm = r1(H_in * INCHES_TO_MM)
        D_mm = r1(D_in * INCHES_TO_MM)

        # Apply defaults if depth/height match known defaults
        # (user can override via order data, these are just the standard sizes)

        # ── Shelf counts ──
        qty = int(row.get(col_map.get("Qty", ""), 1))
        adj_shelf = int(row.get(col_map.get("AdjShelf", ""), 0))
        fixed_shelf = int(row.get(col_map.get("FixedShelf", ""), 0))

        # ── Calculate panels for this cabinet ──
        panels = calculate_panels(
            width_mm=W_mm,
            depth_mm=D_mm,
            height_mm=H_mm,
            cab_type=cab_type,
            adj_shelf=adj_shelf,
            fixed_shelf=fixed_shelf,
            cab_id=cab_id,
        )

        # Expand by cabinet Qty (e.g. if Qty=2, duplicate all panels)
        for _ in range(qty):
            all_parts.extend(panels)

    # ── Build output DataFrame ──
    records = []
    part_counter = 1
    for p in all_parts:
        for _ in range(p["qty"]):
            records.append({
                "part_id": f"P{part_counter:04d}",
                "cab_id": p["cab_id"],
                "cab_type": p["cab_type"],
                "component": p["component"],
                "Height": p["length"],    # Length direction (along board)
                "Depth": p["width"],      # Width direction
                "qty": 1,
            })
            part_counter += 1

    result_df = pd.DataFrame(records)

    # ── Save output ──
    if output_path is None:
        base = os.path.splitext(order_path)[0]
        output_path = f"{base}_parts.xlsx"

    result_df.to_excel(output_path, index=False)

    # ── Summary ──
    print(f"\n{'═' * 60}")
    print(f"  🏭 Cabinet Calculator v2 — Order Processed")
    print(f"{'═' * 60}")
    print(f"  Input:  {order_path}")
    print(f"  Output: {output_path}")
    print(f"{'─' * 60}")
    print(f"  Cabinets: {len(df)} types")
    print(f"  Total parts generated: {len(result_df)}")
    print(f"{'─' * 60}")

    # Per-type summary
    for ctype in ("wall", "base", "tall"):
        count = len(df[df[col_map.get("Type", "___")].astype(str).str.lower() == ctype]) if has_type_col else 0
        if count > 0 or not has_type_col:
            type_parts = result_df[result_df["cab_type"] == ctype]
            if len(type_parts) > 0:
                print(f"  {ctype.upper():5s}: {len(type_parts)} pieces")

    # Component breakdown
    print(f"{'─' * 60}")
    for comp, group in result_df.groupby("component"):
        print(f"  {comp:20s}: {len(group):4d} pcs")

    print(f"{'═' * 60}\n")

    return result_df


# ─── CLI Entry Point ────────────────────────────────────
if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        order_file = sys.argv[1]
    else:
        order_file = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "test_order.xlsx"
        )

    if len(sys.argv) > 2:
        out_file = sys.argv[2]
    else:
        out_file = None

    process_order(order_file, out_file)
