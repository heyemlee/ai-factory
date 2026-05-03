"""
Cloud Workflow Controller — Supabase-powered Order Pipeline

Polls Supabase for pending orders, downloads the Excel,
runs cabinet_calculator + cutting_engine, then pushes results back.

Usage:
  python3 -m core.cloud_controller          # Run once
  python3 -m core.cloud_controller --poll   # Poll continuously
"""

import os
import sys
import json
import time
import inspect
import traceback
import tempfile
from datetime import datetime

# Add backend to path (both backend/ and backend/core/ callers)
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from config.supabase_client import supabase


POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))


def _shape_check_cut_result(result: dict) -> list:
    """
    Lightweight schema/invariant check before writing to Supabase.
    Returns a list of error message strings. Empty list = OK.
    """
    errs = []
    if not isinstance(result, dict):
        return ["result is not a dict"]

    boards = result.get("boards")
    if not isinstance(boards, list):
        errs.append("boards is missing or not a list")
        boards = []

    summary = result.get("summary")
    if not isinstance(summary, dict):
        errs.append("summary is missing or not a dict")
        summary = {}

    for key in ("boards_used", "overall_utilization", "total_parts_placed"):
        v = summary.get(key)
        if not isinstance(v, (int, float)):
            errs.append(f"summary.{key} missing or not numeric (got {type(v).__name__})")

    ou = summary.get("overall_utilization")
    if isinstance(ou, (int, float)) and not (0 <= ou <= 1.0001):
        errs.append(f"summary.overall_utilization out of [0,1]: {ou}")

    if isinstance(summary.get("boards_used"), int) and summary["boards_used"] != len(boards):
        errs.append(f"summary.boards_used ({summary['boards_used']}) != len(boards) ({len(boards)})")

    for i, b in enumerate(boards):
        if not isinstance(b, dict):
            errs.append(f"boards[{i}] not a dict")
            continue
        for k in ("board_id", "board", "board_size"):
            if not isinstance(b.get(k), str):
                errs.append(f"boards[{i}].{k} missing or not a string")
        if not isinstance(b.get("parts"), list):
            errs.append(f"boards[{i}].parts missing or not a list")
        for k in ("strip_width", "trim_loss", "saw_kerf"):
            if not isinstance(b.get(k), (int, float)):
                errs.append(f"boards[{i}].{k} missing or not numeric")
        util = b.get("utilization")
        if not isinstance(util, (int, float)) or not (0 <= util <= 1.0001):
            errs.append(f"boards[{i}].utilization out of [0,1] or missing")

        for j, p in enumerate(b.get("parts") or []):
            if not isinstance(p, dict):
                errs.append(f"boards[{i}].parts[{j}] not a dict")
                continue
            if not isinstance(p.get("part_id"), str):
                errs.append(f"boards[{i}].parts[{j}].part_id missing/not str")
            h, w = p.get("Height"), p.get("Width")
            if not isinstance(h, (int, float)) or h <= 0:
                errs.append(f"boards[{i}].parts[{j}].Height invalid: {h}")
            if not isinstance(w, (int, float)) or w <= 0:
                errs.append(f"boards[{i}].parts[{j}].Width invalid: {w}")

    return errs


def _summarize_box_colors(cabinet_breakdown: dict | None) -> str:
    """Build a compact cabinet color distribution from cabinet_breakdown."""
    if not cabinet_breakdown:
        return ""
    counts: dict[str, int] = {}
    for cb in cabinet_breakdown.values():
        color = cb.get("color") or "WhiteBirch"
        counts[color] = counts.get(color, 0) + 1
    if not counts:
        return ""
    return " + ".join(f"{count}×{color}" for color, count in sorted(counts.items()))


def fetch_pending_orders():
    """Get all pending orders from Supabase."""
    result = supabase.table("orders").select("*").eq("status", "pending").order("created_at").execute()
    return result.data or []


def claim_order(order: dict) -> bool:
    """Atomically claim a pending order so duplicate pollers do not process it."""
    result = (
        supabase.table("orders")
        .update({
            "status": "processing",
            "cut_result_json": {"progress": 5, "message": "开始处理订单..."},
        })
        .eq("id", order["id"])
        .eq("status", "pending")
        .execute()
    )
    if result.data:
        return True
    print(f"  ↪️  Order {order['job_id']} was already claimed by another worker; skipping")
    return False


def download_order_file(order: dict) -> str | None:
    """Download the order Excel from Supabase Storage to a temp file."""
    file_url = order.get("file_url")
    if not file_url:
        print(f"  ⚠️  No file_url for order {order['job_id']}")
        return None

    try:
        # Extract storage path from the public URL
        # URL format: https://xxx.supabase.co/storage/v1/object/public/order-files/orders/...
        storage_path = file_url.split("/order-files/")[-1]

        response = supabase.storage.from_("order-files").download(storage_path)

        tmp_path = os.path.join(tempfile.gettempdir(), f"{order['job_id']}_order.xlsx")
        with open(tmp_path, "wb") as f:
            f.write(response)

        print(f"  📥 Downloaded: {tmp_path}")
        return tmp_path

    except Exception as e:
        print(f"  ❌ Download failed: {e}")
        return None


def process_order(order: dict):
    """Run the full pipeline for a single order."""
    job_id = order["job_id"]
    print(f"\n{'═' * 55}")
    print(f"  🔄 Processing Order: {job_id}")
    print(f"{'═' * 55}")

    def update_progress(pct: int, msg: str):
        supabase.table("orders").update({
            "status": "processing",
            "cut_result_json": {"progress": pct, "message": msg}
        }).eq("id", order["id"]).execute()

    if order.get("status") == "pending" and not claim_order(order):
        return

    try:
        update_progress(10, "正在下载订单文件...")
        # 1. Download the order file
        order_path = download_order_file(order)
        if not order_path:
            # If no file to download, check if there's a local file
            # Try common locations
            for candidate in [
                f"test_order.xlsx",
                os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "test_order.xlsx"),
            ]:
                if os.path.exists(candidate):
                    order_path = candidate
                    print(f"  📂 Using local file: {order_path}")
                    break

            if not order_path:
                raise FileNotFoundError("No order file available (no file_url and no local file)")

        # 2. Run Cabinet Calculator
        update_progress(30, "正在拆解柜体零件...")
        print(f"\n  Step 1: Cabinet Calculator")
        # Ensure backend root is importable
        import importlib.util
        calc_path = os.path.join(backend_dir, "cabinet_calculator.py")
        spec = importlib.util.spec_from_file_location("cabinet_calculator", calc_path)
        cab_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cab_mod)
        calc_order = cab_mod.process_order

        parts_path = os.path.join(tempfile.gettempdir(), f"{job_id}_parts.xlsx")
        calc_kwargs = {}
        if "include_skipped_items" in inspect.signature(calc_order).parameters:
            calc_kwargs["include_skipped_items"] = True

        calc_result = calc_order(order_path, parts_path, **calc_kwargs)
        if len(calc_result) == 3:
            parts_df, cabinet_breakdown, skipped_items = calc_result
        elif len(calc_result) == 2:
            parts_df, cabinet_breakdown = calc_result
            skipped_items = []
        else:
            raise ValueError(
                f"Unexpected cabinet_calculator.process_order return shape: {len(calc_result)} values"
            )

        unknown_color_rows = [
            s for s in skipped_items
            if "unknown Box Color" in str(s.get("reason", ""))
        ]
        if unknown_color_rows:
            details = "; ".join(
                f"row {s.get('row')} {s.get('cab_id')}: {s.get('reason')}"
                for s in unknown_color_rows
            )
            raise ValueError(f"Unknown Box Color in order: {details}")

        # Count cabinet types for summary
        import pandas as pd
        order_df = pd.read_excel(order_path)
        order_df.columns = [c.replace("\n", " ").strip() for c in order_df.columns]
        type_col = None
        for c in order_df.columns:
            if c.lower().strip() == "type":
                type_col = c
                break

        cab_summary = f"{len(order_df)} cabinets"
        if type_col:
            counts = order_df[type_col].str.lower().value_counts()
            parts_list = []
            for t in ["wall", "base", "tall"]:
                if t in counts.index:
                    parts_list.append(f"{counts[t]}{t[0].upper()}")
            if parts_list:
                cab_summary = f"{len(order_df)} ({'/'.join(parts_list)})"
        if skipped_items:
            cab_summary = f"{cab_summary} + {len(skipped_items)} skipped"
        color_summary = _summarize_box_colors(cabinet_breakdown)
        if color_summary:
            cab_summary = f"{cab_summary} | {color_summary}"

        # 3. Run Cutting Engine
        update_progress(60, "正在进行 AI 智能排版裁切计算...")
        print(f"\n  Step 2: Cutting Engine")
        from cutting.cutting_engine import run_engine, deduct_inventory_supabase

        cut_result_path = os.path.join(tempfile.gettempdir(), f"{job_id}_cut_result.json")
        force_t0_start = order.get("cut_mode") == "t0_start" or bool(order.get("force_t0_start"))
        if force_t0_start:
            print("  🟧 Production mode: T0 Start (ignore T1 inventory)")
        result = run_engine(
            parts_path=parts_path,
            output_path=cut_result_path,
            cabinet_breakdown=cabinet_breakdown,
            force_t0_start=force_t0_start,
        )

        update_progress(95, "生成最终排版报告...")

        # NOTE: Inventory deduction is now handled when user confirms cutting
        # is complete via the frontend (status → cut_done). This prevents
        # premature deduction before actual cutting occurs.
        # Old code: deduct_inventory_supabase(result["boards"])

        if skipped_items:
            issues = result.setdefault("issues", {})
            integrity_list = issues.setdefault("integrity", [])
            for s in skipped_items:
                code = "SKIPPED_ORDER_ROW"
                msg = f"Row {s['row']} ({s['cab_id']}): skipped"
                if s.get("reason"):
                    msg = f"{msg} — {s['reason']}"
                elif s.get("type"):
                    code = "SKIPPED_UNKNOWN_TYPE"
                    msg = f"Row {s['row']} ({s['cab_id']}): type '{s['type']}' not in wall/base/tall — skipped"
                integrity_list.append({
                    "code": code,
                    "severity": "warning",
                    "msg": msg,
                    "ref": s,
                })

        # 5. Update order in Supabase
        summary = result["summary"]

        # Schema / invariant guard: surface bad data, but still write so user can see.
        shape_errs = _shape_check_cut_result(result)
        if shape_errs:
            print(f"\n⚠️  Schema contract violated ({len(shape_errs)} issue(s)) for job {job_id}:")
            for e in shape_errs[:10]:
                print(f"   • {e}")
            issues = result.setdefault("issues", {})
            schema_list = issues.setdefault("schema", [])
            for e in shape_errs:
                schema_list.append({"code": "SCHEMA_VIOLATION", "severity": "error", "msg": e})

        # Keep warnings inside cut_result_json/issues while using the stable
        # completed status already supported by the DB constraint and frontend.
        status_value = "completed"

        supabase.table("orders").update({
            "status": status_value,
            "utilization": summary["overall_utilization"],
            "boards_used": summary["boards_used"],
            "total_parts": summary["total_parts_placed"],
            "cabinets_summary": cab_summary,
            "cut_result_json": result,
            "cut_mode": "t0_start" if force_t0_start else "inventory_first",
            "completed_at": datetime.now().isoformat(),
        }).eq("id", order["id"]).execute()

        # 6. Insert BOM history
        supabase.table("bom_history").delete().eq("job_id", job_id).execute()
        supabase.table("bom_history").insert({
            "job_id": job_id,
            "boards_used": summary["boards_used"],
            "total_parts": summary["total_parts_placed"],
            "overall_utilization": summary["overall_utilization"],
            "total_waste_mm": summary["total_waste"],
            "total_cost": 0,  # TODO: cost calculation
        }).execute()

        print(f"\n  ✅ Order {job_id} completed!")
        print(f"     Utilization: {summary['overall_utilization']*100:.1f}%")
        print(f"     Boards used: {summary['boards_used']}")
        print(f"     Parts placed: {summary['total_parts_placed']}")

    except Exception as e:
        err_detail = traceback.format_exc()
        print(f"\n  ❌ Order {job_id} FAILED!")
        print(err_detail)

        supabase.table("orders").update({
            "status": "failed",
            "cut_result_json": {"error": str(e), "traceback": err_detail},
            "completed_at": datetime.now().isoformat(),
        }).eq("id", order["id"]).execute()

        print(f"\n  ❌ Order {job_id} failed: {e}")


def run_once():
    """Check for pending orders and process them."""
    print(f"\n🔍 Checking for pending orders...")
    orders = fetch_pending_orders()

    if not orders:
        print("  No pending orders found.")
        return 0

    print(f"  Found {len(orders)} pending order(s)")

    for order in orders:
        process_order(order)

    return len(orders)


def run_poll():
    """Continuously poll for new orders."""
    print(f"🏭 Cloud Workflow Controller — Polling mode")
    print(f"   Interval: {POLL_INTERVAL}s")
    print(f"   Press Ctrl+C to stop\n")

    while True:
        try:
            processed = run_once()
            if processed == 0:
                print(f"  💤 Sleeping {POLL_INTERVAL}s...")
            time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            print("\n\n🛑 Polling stopped.")
            break
        except Exception as e:
            print(f"\n⚠️  Poll error: {e}")
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    if "--poll" in sys.argv:
        run_poll()
    else:
        run_once()
