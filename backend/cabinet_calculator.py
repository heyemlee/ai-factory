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
import re
import pandas as pd

# ─── Constants (mm) ─────────────────────────────────────
BOARD_THICKNESS = 18.0       # 板材厚度
GROOVE_DEPTH = 3.0           # 通槽深度 (each side)
SHELF_INSET = 20.0           # 活动层板前方内缩
STRETCHER_DEPTH = 101.6      # 拉条深度 (4")
INCHES_TO_MM = 25.4

# ─── Box Color (driven by Supabase box_colors table) ────
DEFAULT_BOX_COLOR = "WhiteBirch"


def load_box_colors() -> dict:
    """
    Load valid box colors from Supabase. Returns a dict mapping multiple
    aliases (key, name_en, name_zh, name_es — all lowercased) → key.
    Falls back to a minimal default registry if Supabase is unreachable.
    """
    fallback = {
        "whitebirch": "WhiteBirch",
        "white birch plywood": "WhiteBirch",
        "白桦木胶合板": "WhiteBirch",
        "contrachapado de abedul blanco": "WhiteBirch",
        "whitemelamine": "WhiteMelamine",
        "white melamine plywood": "WhiteMelamine",
        "白色三聚氰胺板": "WhiteMelamine",
        "melamina blanca": "WhiteMelamine",
    }
    try:
        # Local import so this module can still be imported in tooling without supabase deps
        from config.supabase_client import supabase
        result = supabase.table("box_colors").select("*").eq("is_active", True).execute()
        if not result.data:
            return fallback
        alias_map: dict = {}
        for row in result.data:
            key = row["key"]
            for alias in (row.get("key"), row.get("name_en"), row.get("name_zh"), row.get("name_es")):
                if alias:
                    alias_map[str(alias).strip().lower()] = key
        return alias_map or fallback
    except Exception:
        return fallback


def normalize_box_color(value, alias_map: dict) -> tuple[str, bool]:
    """Normalize an Excel cell into a canonical box_color key.

    Returns (key, is_default). is_default=True means the cell was empty
    and we fell back to the default color.
    """
    s = "" if value is None else str(value).strip()
    if not s or s.lower() == "nan":
        return DEFAULT_BOX_COLOR, True
    key = alias_map.get(s.lower())
    if key:
        return key, False
    return s, False  # caller validates against alias_map for unknowns

# ─── Default dimensions (mm) ────────────────────────────
WALL_DEFAULT_DEPTH = 304.8      # 12"
BASE_DEFAULT_DEPTH = 609.6      # 24"
BASE_DEFAULT_HEIGHT = 876.3     # 34.5"
TALL_DEFAULT_DEPTH = 609.6      # 24"
TALL_DEFAULT_HEIGHT = 2387.6    # 94"


def parse_imperial(val) -> float:
    """
    Parse an imperial dimension value that may be:
      - A plain number: 24, 12.5
      - A fractional string: '26 3/16', '34 1/2', '3/4'
      - NaN, None, 0, or empty string → 0.0
    Returns the value as a float (in inches).
    """
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        import math
        return 0.0 if math.isnan(val) else float(val)

    s = str(val).strip()
    if not s or s.lower() == 'nan':
        return 0.0

    # Try direct float first (handles "24", "12.5", etc.)
    try:
        return float(s)
    except ValueError:
        pass

    # Handle fractional: "26 3/16" or "3/4"
    parts = s.split()
    total = 0.0
    for part in parts:
        if '/' in part:
            # fraction like "3/16"
            num, den = part.split('/', 1)
            total += float(num) / float(den)
        else:
            total += float(part)
    return total


def r1(val: float) -> float:
    """Round to 1 decimal place."""
    return round(val, 1)


VALID_CABINET_TYPES = ("wall", "base", "tall")


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
    color: str = DEFAULT_BOX_COLOR,
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
        "length": r1(H),
        "width": r1(W - t * 2 + g * 2),        # W - 30
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
        p["color"] = color

    return parts


def process_order(order_path: str, output_path: str = None, include_skipped_items: bool = False):
    """
    Read an order Excel, calculate all panels for every cabinet,
    and output a flat parts list.

    Args:
        order_path: Path to the order .xlsx file.
        output_path: Where to save parts.xlsx. If None, saves next to order file.
        include_skipped_items: When True, also return skipped rows with unsupported cabinet types.

    Returns:
        Tuple of (DataFrame with all parts, cabinet_breakdown dict).
        When include_skipped_items=True, returns
        (DataFrame, cabinet_breakdown dict, skipped_items list).
        cabinet_breakdown maps cab_id -> {cab_type, count, parts:[{part_id,component,Height,Width}]}
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
        elif ("box" in cl and "color" in cl) or cl in ("color", "颜色", "颜 色"):
            col_map["BoxColor"] = c

    has_type_col = "Type" in col_map
    color_alias_map = load_box_colors()
    has_color_col = "BoxColor" in col_map

    all_parts = []
    skipped_items: list[dict] = []

    # Pre-scan: count how many times each ABC Item code appears
    # so we only add a disambiguating suffix when there are duplicates.
    item_counts: dict[str, int] = {}
    for _, row in df.iterrows():
        item_val = str(row.get(col_map.get("Item", ""), "")).strip()
        if item_val:
            item_counts[item_val] = item_counts.get(item_val, 0) + 1
    # Running counters for duplicate items
    item_seen: dict[str, int] = {}

    for idx, row in df.iterrows():
        # ── Cabinet ID ──
        cab_no = row.get(col_map.get("CabNo", ""), idx + 1)
        item = str(row.get(col_map.get("Item", ""), "")).strip()
        # Use ABC Item code directly (e.g. "W2745T").
        # When the same item appears multiple times, append a counter
        # suffix to ensure uniqueness (e.g. "W3045T", "W3045T(2)").
        if item:
            item_seen[item] = item_seen.get(item, 0) + 1
            if item_counts.get(item, 1) > 1:
                cab_id = f"{item}({item_seen[item]})" if item_seen[item] > 1 else item
            else:
                cab_id = item
        else:
            cab_id = f"C{cab_no}"

        # ── Cabinet Type ──
        if has_type_col:
            cab_type = str(row[col_map["Type"]]).strip().lower()
        else:
            cab_type = detect_cabinet_type(item)

        if cab_type not in VALID_CABINET_TYPES:
            skipped_items.append({
                "cab_id": cab_id,
                "item": item,
                "type": cab_type or "(blank)",
                "row": int(idx) + 2,
            })
            continue

        # ── Box Color ──
        raw_color = row.get(col_map.get("BoxColor", ""), "") if has_color_col else ""
        color_key, is_default = normalize_box_color(raw_color, color_alias_map)
        if color_key not in set(color_alias_map.values()):
            skipped_items.append({
                "cab_id": cab_id,
                "item": item,
                "type": cab_type,
                "row": int(idx) + 2,
                "reason": f"unknown Box Color '{raw_color}'",
            })
            continue
        if is_default and has_color_col:
            print(f"  ℹ️  {cab_id}: Box Color 空 → 使用默认 {DEFAULT_BOX_COLOR}")

        # ── Dimensions (inches → mm) ──
        W_in = parse_imperial(row.get(col_map.get("W", ""), 0))
        H_in = parse_imperial(row.get(col_map.get("H", ""), 0))
        D_in = parse_imperial(row.get(col_map.get("D", ""), 0))

        W_mm = r1(W_in * INCHES_TO_MM)
        H_mm = r1(H_in * INCHES_TO_MM)
        D_mm = r1(D_in * INCHES_TO_MM)

        # Apply defaults when D or H is 0 (常见于订单未填的情况)
        if D_mm <= 0:
            if cab_type == "wall":
                D_mm = WALL_DEFAULT_DEPTH      # 304.8mm (12")
            elif cab_type == "base":
                D_mm = BASE_DEFAULT_DEPTH      # 609.6mm (24")
            elif cab_type == "tall":
                D_mm = TALL_DEFAULT_DEPTH      # 609.6mm (24")
            print(f"  ℹ️  {cab_id}: D=0 → 使用默认深度 {D_mm}mm ({cab_type})")

        if H_mm <= 0:
            if cab_type == "base":
                H_mm = BASE_DEFAULT_HEIGHT     # 876.3mm (34.5")
            elif cab_type == "tall":
                H_mm = TALL_DEFAULT_HEIGHT     # 2387.6mm (94")
            if H_mm > 0:
                print(f"  ℹ️  {cab_id}: H=0 → 使用默认高度 {H_mm}mm ({cab_type})")

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
            color=color_key,
        )

        # Expand by cabinet Qty (e.g. if Qty=2, duplicate all panels)
        for _ in range(qty):
            all_parts.extend(panels)

    # ── Build output DataFrame ──
    records = []
    cabinet_breakdown: dict = {}
    part_counter = 1
    for p in all_parts:
        for _ in range(p["qty"]):
            pid = f"P{part_counter:04d}"
            rec = {
                "part_id": pid,
                "cab_id": p["cab_id"],
                "cab_type": p["cab_type"],
                "component": p["component"],
                "Height": p["length"],    # Length direction (along board)
                "Width": p["width"],      # Width direction
                "qty": 1,
                "color": p.get("color", DEFAULT_BOX_COLOR),
            }
            records.append(rec)
            cb = cabinet_breakdown.setdefault(p["cab_id"], {
                "cab_type": p["cab_type"],
                "color": p.get("color", DEFAULT_BOX_COLOR),
                "count": 0,
                "parts": [],
            })
            cb["count"] += 1
            cb["parts"].append({
                "part_id": pid,
                "component": p["component"],
                "Height": p["length"],
                "Width": p["width"],
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

    # Skipped-type summary
    if skipped_items:
        print(f"  SKIPPED: {len(skipped_items)} cabinet(s) with unknown type")
        for s in skipped_items:
            print(f"    • row {s['row']} {s['cab_id']} (type='{s['type']}')")

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

    if include_skipped_items:
        return result_df, cabinet_breakdown, skipped_items

    return result_df, cabinet_breakdown


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
