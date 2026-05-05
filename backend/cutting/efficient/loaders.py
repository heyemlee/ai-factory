"""
Data loaders for the efficient cutting engine.

Reads parts and inventory from Excel files or Supabase, fetches recoverable
board specs, and writes back inventory deductions after cutting.
"""

import pandas as pd

from .constants import (
    BOARD_HEIGHT,
    COMMON_RECOVERY_WIDTHS,
    DEFAULT_BOX_COLOR,
    MIN_RECOVERABLE_WIDTH,
)
from .primitives import common_recovery_board_type, normalize_recovery_spec


def load_recovery_specs_from_supabase() -> list:
    """Load recoverable T1 board specs from Supabase board_specs."""
    try:
        from config.supabase_client import supabase
        result = (
            supabase.table("board_specs")
            .select("board_type,width,height,is_recoverable,is_active,sort_order")
            .eq("is_active", True)
            .eq("is_recoverable", True)
            .order("sort_order", desc=False)
            .execute()
        )
        specs = []
        for row in result.data or []:
            height = float(row.get("height") or 0)
            width = float(row.get("width") or 0)
            if width >= MIN_RECOVERABLE_WIDTH and height + 1e-3 >= BOARD_HEIGHT:
                specs.append(normalize_recovery_spec(row["board_type"], width))
        if specs:
            return specs
    except Exception as e:
        print(f"⚠️  Could not load board_specs recovery sizes ({e}); using fallback sizes")
    return [{"board_type": common_recovery_board_type(w), "width": w} for w in COMMON_RECOVERY_WIDTHS]


def load_non_recoverable_board_types() -> set:
    """Load T1 board_types explicitly marked is_recoverable=false in board_specs.

    Used as a deny-list so that inventory rows for these spec entries are not
    treated as recovery candidates by the T0 optimizer (e.g. 101.6mm stretchers
    that the shop doesn't actually stock as a recoverable strip).
    """
    try:
        from config.supabase_client import supabase
        result = (
            supabase.table("board_specs")
            .select("board_type")
            .eq("is_active", True)
            .eq("is_recoverable", False)
            .execute()
        )
        return {row["board_type"] for row in (result.data or []) if row.get("board_type")}
    except Exception:
        return set()


def load_parts(path: str):
    """Read parts.xlsx (output from cabinet_calculator v2)."""
    df = pd.read_excel(path)

    # Support both old format (part_id, Height, Depth, qty)
    # and new format (part_id, cab_id, cab_type, component, Height, Width, qty)
    if "Depth" in df.columns and "Width" not in df.columns:
        df = df.rename(columns={"Depth": "Width"})
    required = {"Height", "Width"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[parts.xlsx] Missing columns: {missing}")

    df = df.dropna(subset=["Height", "Width"])

    parts = []
    skipped = []

    for i, row in df.iterrows():
        pid = str(row.get("part_id", f"P{i+1}")).strip()
        try:
            h = float(row["Height"])
            d = float(row["Width"])
            q = int(row.get("qty", 1))
        except (ValueError, TypeError) as e:
            skipped.append({"row": i + 2, "reason": str(e)})
            continue

        if h <= 0 or d <= 0 or q <= 0:
            skipped.append({"row": i + 2, "reason": f"Invalid: Height={h}, Width={d}, qty={q}"})
            continue

        # Carry over extra metadata if present
        extra = {}
        for col in ("cab_id", "cab_type", "component", "color"):
            if col in row and pd.notna(row[col]):
                extra[col] = str(row[col])
        if "color" not in extra:
            extra["color"] = DEFAULT_BOX_COLOR

        # Carry over banding cut dimensions if present (default to nominal Height/Width)
        cl_val: float = h
        cw_val: float = d
        if "cut_length" in row and pd.notna(row["cut_length"]):
            try:
                cl_val = float(row["cut_length"])
            except (ValueError, TypeError):
                pass
        if "cut_width" in row and pd.notna(row["cut_width"]):
            try:
                cw_val = float(row["cut_width"])
            except (ValueError, TypeError):
                pass

        for _ in range(q):
            parts.append({
                "part_id": pid,
                "Height": h,
                "Width": d,
                "cut_length": cl_val,
                "cut_width": cw_val,
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


def load_inventory_from_supabase():
    """Load inventory from Supabase cloud database (main materials only).

    Returns a per-color inventory: {color_key: {board_type: {board_type, Height, Width, qty, color}}}.
    """
    try:
        from config.supabase_client import supabase
        result = supabase.table("inventory").select("*").eq("category", "main").execute()

        if not result.data:
            print("⚠️  Supabase inventory is empty")
            return None

        per_color: dict = {}
        for row in result.data:
            bt = row["board_type"]
            color = row.get("color") or DEFAULT_BOX_COLOR
            entry = {
                "board_type": bt,
                "Height": float(row["height"]),
                "Width": float(row["width"]),
                "qty": int(row["stock"]),
                "color": color,
            }
            per_color.setdefault(color, {})[bt] = entry

        total = sum(len(v) for v in per_color.values())
        print(f"☁️  Inventory from Supabase: {total} board rows across {len(per_color)} color(s)")
        for color, boards in per_color.items():
            print(f"  🎨 {color}: {len(boards)} board types")
            for bt, info in sorted(boards.items(), key=lambda x: x[1]["Width"]):
                print(f"      {bt}: {info['Width']} × {info['Height']} mm, qty={info['qty']}")
        return per_color

    except Exception as e:
        print(f"⚠️  Supabase unavailable ({e}), falling back to local Excel")
        return None


def load_inventory(path: str = None):
    """
    Load inventory: try Supabase first, fall back to local Excel.
    Returns per-color dict: {color: {board_type: info}}.
    """
    # Try Supabase first
    per_color = load_inventory_from_supabase()
    if per_color:
        return per_color

    # Fallback to local Excel (legacy single-color)
    if path is None:
        raise RuntimeError("No inventory source available (Supabase down, no local file)")

    df = pd.read_excel(path)

    required = {"board_type", "Height", "Width", "qty"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[inventory] Missing columns: {missing}")

    per_color: dict = {}
    for _, row in df.iterrows():
        bt = str(row["board_type"]).strip()
        color = str(row["color"]).strip() if "color" in row and pd.notna(row.get("color")) else DEFAULT_BOX_COLOR
        per_color.setdefault(color, {})[bt] = {
            "board_type": bt,
            "Height": float(row["Height"]),
            "Width": float(row["Width"]) if "Width" in row else float(row.get("Depth", 0)),
            "qty": int(row["qty"]),
            "color": color,
        }

    total = sum(len(v) for v in per_color.values())
    print(f"📋 Inventory (local): {total} board rows across {len(per_color)} color(s)")
    for color, boards in per_color.items():
        print(f"  🎨 {color}: {len(boards)} board types")
        for bt, info in sorted(boards.items(), key=lambda x: x[1]["Width"]):
            print(f"      {bt}: {info['Width']} × {info['Height']} mm, qty={info['qty']}")
    return per_color


def deduct_inventory_supabase(board_results: list):
    """After cutting, deduct used board quantities from Supabase inventory."""
    try:
        from config.supabase_client import supabase

        # Count how many of each (board_type, color) were used
        usage = {}
        for br in board_results:
            bt = br["board"]
            color = br.get("color") or DEFAULT_BOX_COLOR
            usage[(bt, color)] = usage.get((bt, color), 0) + 1

        for (bt, color), used in usage.items():
            # Get current stock
            result = (
                supabase.table("inventory")
                .select("stock")
                .eq("board_type", bt)
                .eq("color", color)
                .execute()
            )
            if result.data:
                current = result.data[0]["stock"]
                new_stock = max(0, current - used)
                (
                    supabase.table("inventory")
                    .update({"stock": new_stock})
                    .eq("board_type", bt)
                    .eq("color", color)
                    .execute()
                )
                print(f"  📉 {bt} [{color}]: {current} → {new_stock} ({used} used)")

    except Exception as e:
        print(f"⚠️  Could not deduct inventory from Supabase: {e}")
