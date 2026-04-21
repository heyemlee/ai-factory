"""
Cloud Workflow Controller — Supabase-powered Order Pipeline

Polls Supabase for pending orders, downloads the Excel,
runs cabinet_calculator + engine_agent, then pushes results back.

Usage:
  python3 -m core.cloud_controller          # Run once
  python3 -m core.cloud_controller --poll   # Poll continuously
"""

import os
import sys
import json
import time
import traceback
import tempfile
from datetime import datetime

# Add backend to path (both backend/ and backend/core/ callers)
backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from config.supabase_client import supabase


POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))


def fetch_pending_orders():
    """Get all pending orders from Supabase."""
    result = supabase.table("orders").select("*").eq("status", "pending").order("created_at").execute()
    return result.data or []


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

    # Mark as processing
    update_progress(5, "开始处理订单...")

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
        parts_df = calc_order(order_path, parts_path)

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

        # 3. Run Cutting Engine
        update_progress(60, "正在进行 AI 智能排版裁切计算...")
        print(f"\n  Step 2: Cutting Engine")
        from agents.engine_agent import run_engine, deduct_inventory_supabase

        cut_result_path = os.path.join(tempfile.gettempdir(), f"{job_id}_cut_result.json")
        result = run_engine(
            parts_path=parts_path,
            inventory_path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "t1_inventory.xlsx"),
            output_path=cut_result_path,
        )

        update_progress(95, "生成最终排版报告...")

        # NOTE: Inventory deduction is now handled when user confirms cutting
        # is complete via the frontend (status → cut_done). This prevents
        # premature deduction before actual cutting occurs.
        # Old code: deduct_inventory_supabase(result["boards"])

        # 5. Update order in Supabase
        summary = result["summary"]
        supabase.table("orders").update({
            "status": "completed",
            "utilization": summary["overall_utilization"],
            "boards_used": summary["boards_used"],
            "total_parts": summary["total_parts_placed"],
            "cabinets_summary": cab_summary,
            "cut_result_json": result,
            "completed_at": datetime.now().isoformat(),
        }).eq("id", order["id"]).execute()

        # 6. Insert BOM history
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
