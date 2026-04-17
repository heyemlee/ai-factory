"""
Workflow Controller — 橱柜工厂 AI Pipeline 编排引擎

完整流程:
  Email Reader → Brain Agent → Engine Agent → Excel Report
      → Audit Agent → Inventory Agent → Production Agent
      → Output (日期前缀重命名) → Notifier Agent

功能:
  1. 顺序执行每个 Agent，传递 context
  2. 错误处理 & 分支逻辑
  3. 订单归档（成功 → archive/, 失败 → failed_orders/）
"""

import os
import json
import shutil
import traceback
from datetime import datetime

from config.settings import (
    INCOMING_ORDERS_DIR, OUTPUT_DIR, ARCHIVE_DIR, FAILED_ORDERS_DIR,
    generate_job_id, get_job_output_dir, ensure_directories,
)
from config.logger import get_logger

log = get_logger("workflow")


def run_pipeline(order_path: str = None) -> dict:
    """
    运行完整 Pipeline。

    Args:
        order_path: 订单文件路径。如果为 None，则从邮件读取。

    Returns:
        context dict，包含每个阶段的结果
    """
    ensure_directories()

    context = {
        "start_time": datetime.now().isoformat(),
        "status": "running",
        "stages": {},
        "errors": [],
    }

    # ══════════════════════════════════════
    # Stage 1: 获取订单
    # ══════════════════════════════════════
    if order_path:
        # 使用指定订单文件
        if not os.path.exists(order_path):
            context["status"] = "failed"
            context["errors"].append(f"订单文件不存在: {order_path}")
            log.error(f"❌ 订单文件不存在: {order_path}")
            return context
        order_files = [order_path]
        log.info(f"📋 使用指定订单: {order_path}")
    else:
        # 从邮件读取
        log.info("📧 Stage 1: 读取邮件订单...")
        try:
            from tools.email_reader import download_excel_attachments
            order_files = download_excel_attachments()
            context["stages"]["email_reader"] = {
                "status": "success",
                "files": order_files,
            }
        except Exception as e:
            log.error(f"❌ 邮件读取失败: {e}")
            context["status"] = "failed"
            context["errors"].append(f"邮件读取失败: {e}")
            _notify_error("邮件读取", str(e))
            return context

        if not order_files:
            log.info("📭 没有新订单，Pipeline 结束")
            context["status"] = "no_orders"
            return context

    # ══════════════════════════════════════
    # 逐个处理每个订单
    # ══════════════════════════════════════
    results = []
    for order_file in order_files:
        result = _process_single_order(order_file, context)
        results.append(result)

    context["results"] = results
    context["end_time"] = datetime.now().isoformat()

    success_count = sum(1 for r in results if r["status"] == "success")
    fail_count = sum(1 for r in results if r["status"] == "failed")

    if fail_count == 0:
        context["status"] = "success"
    elif success_count > 0:
        context["status"] = "partial"
    else:
        context["status"] = "failed"

    log.info(f"{'=' * 50}")
    log.info(f"🏭 Pipeline 完成: {success_count} 成功, {fail_count} 失败")
    log.info(f"{'=' * 50}")

    return context


def _process_single_order(order_file: str, parent_context: dict) -> dict:
    """处理单个订单的完整流程"""
    filename = os.path.basename(order_file)
    job_id = generate_job_id(filename)
    job_dir = get_job_output_dir(job_id)

    log.info(f"\n{'═' * 50}")
    log.info(f"🔄 开始处理订单: {filename}")
    log.info(f"   Job ID: {job_id}")
    log.info(f"   输出目录: {job_dir}")
    log.info(f"{'═' * 50}")

    result = {
        "job_id": job_id,
        "order_file": order_file,
        "status": "running",
        "stages": {},
    }

    parts_path = str(job_dir / "parts.xlsx")
    cut_result_path = str(job_dir / "cut_result.json")
    cut_excel_path = str(job_dir / "cut_result.xlsx")
    inventory_path = str(job_dir / "inventory_check.json")

    # ── Stage 2: Brain Agent (拆单) ──────
    log.info("📋 Stage 2: 拆单 (Brain Agent)...")
    try:
        from agents.brain_agent import run as brain_run
        brain_run(order_path=order_file, output_path=parts_path)
        result["stages"]["brain"] = {"status": "success", "output": parts_path}
        log.info(f"   ✅ 拆单完成: {parts_path}")
    except Exception as e:
        log.error(f"   ❌ 拆单失败: {e}")
        result["stages"]["brain"] = {"status": "failed", "error": str(e)}
        result["status"] = "failed"
        _archive_failed(order_file, job_id, f"拆单失败: {e}")
        _notify_error("拆单 (Brain Agent)", str(e), job_id)
        return result

    # ── Stage 3: Engine Agent (裁切优化 v4 — 真实工厂流程) ──
    log.info("✂️  Stage 3: 裁切优化 (Engine Agent v4)...")
    try:
        from agents.engine_agent import run_engine
        from config.settings import INVENTORY_FILE

        output_data = run_engine(
            parts_path=parts_path,
            inventory_path=str(INVENTORY_FILE),
            output_path=cut_result_path,
        )

        summary = output_data["summary"]
        overall_util = summary["overall_utilization"]
        all_board_results = output_data["boards"]

        result["stages"]["engine"] = {"status": "success", "output": cut_result_path}
        log.info(f"   ✅ 裁切优化完成: T0={summary.get('t0_sheets_used',0)}张, "
                 f"strips={summary.get('strips_used',0)}, 利用率 {overall_util*100:.1f}%")
    except Exception as e:
        log.error(f"   ❌ 裁切优化失败: {e}\n{traceback.format_exc()}")
        result["stages"]["engine"] = {"status": "failed", "error": str(e)}
        result["status"] = "failed"
        _archive_failed(order_file, job_id, f"裁切优化失败: {e}")
        _notify_error("裁切优化 (Engine Agent)", str(e), job_id)
        return result

    log.info("📊 Stage 4: 报告合并到了 worker_order, 不再单独生成 cut_result.xlsx...")
    result["stages"]["excel_report"] = {"status": "skipped"}

    # ── Stage 5: Audit Agent (审核) ──────
    log.info("🔍 Stage 5: 审核 (Audit Agent)...")
    try:
        from agents.audit_agent import run as audit_run
        audit_result = audit_run(cut_result_path=cut_result_path, output_dir=str(job_dir))
        result["stages"]["audit"] = {"status": "success", "audit_status": audit_result["status"]}

        if audit_result["status"] == "fail":
            log.warning("   ⛔ 审核未通过，中止生产工单生成")
            result["stages"]["audit"]["note"] = "审核未通过，跳过生产"
            _notify_error("审核 (Audit Agent)", "审核未通过，无法生成工单", job_id)
            # 审核失败仍然继续库存检查，但跳过生产
    except Exception as e:
        log.error(f"   ❌ 审核失败: {e}")
        result["stages"]["audit"] = {"status": "failed", "error": str(e)}

    # ── Stage 6: Inventory Agent (库存) ──
    log.info("📦 Stage 6: 库存检查 (Inventory Agent)...")
    try:
        from agents.inventory_agent import run as inv_run
        inv_result = inv_run(cut_result_path=cut_result_path, output_dir=str(job_dir))
        result["stages"]["inventory"] = {
            "status": "success",
            "has_shortage": inv_result["has_shortage"],
        }

        # ── 分支: 有缺料 → 生成预警，但继续生产 ──
        if inv_result["has_shortage"]:
            log.warning("   🚨 检测到缺料！已生成采购建议")
            result["stages"]["inventory"]["note"] = "有缺料，已生成采购建议"
    except Exception as e:
        log.error(f"   ❌ 库存检查失败: {e}")
        result["stages"]["inventory"] = {"status": "failed", "error": str(e)}

    # ── Stage 7: Production Agent (工单) ──
    audit_status = result["stages"].get("audit", {}).get("audit_status", "unknown")
    if audit_status == "fail":
        log.info("📋 Stage 7: 跳过工单生成（审核未通过）")
        result["stages"]["production"] = {"status": "skipped", "reason": "审核未通过"}
    else:
        log.info("📋 Stage 7: 生成工单 (Production Agent)...")
        try:
            from agents.production_agent import run as prod_run
            worker_path = prod_run(
                cut_result_path=cut_result_path,
                audit_path=str(job_dir / "audit.json"),
                output_dir=str(job_dir),
            )
            result["stages"]["production"] = {"status": "success", "output": worker_path}
        except Exception as e:
            log.error(f"   ❌ 工单生成失败: {e}")
            result["stages"]["production"] = {"status": "failed", "error": str(e)}

    # ── Stage 8: Output (输出最终文件) ─────
    log.info("📤 Stage 8: 输出最终结果文件...")
    final_files = []
    try:
        date_prefix = datetime.now().strftime("%Y-%m-%d_%H")

        # 重命名 cut_result.xlsx
        if os.path.exists(cut_excel_path):
            new_cut_name = f"{date_prefix}_cut_result.xlsx"
            new_cut_path = str(job_dir / new_cut_name)
            os.rename(cut_excel_path, new_cut_path)
            final_files.append(new_cut_path)
            log.info(f"   📄 裁切报告: {new_cut_name}")

        # 重命名 worker_order.xlsx
        worker_order_path = str(job_dir / "worker_order.xlsx")
        if os.path.exists(worker_order_path):
            new_worker_name = f"{date_prefix}_worker_order.xlsx"
            new_worker_path = str(job_dir / new_worker_name)
            os.rename(worker_order_path, new_worker_path)
            final_files.append(new_worker_path)
            log.info(f"   📄 工人工单: {new_worker_name}")

        # 重命名 inventory_check.xlsx
        inv_check_path = str(job_dir / "inventory_check.xlsx")
        if os.path.exists(inv_check_path):
            new_inv_name = f"{date_prefix}_inventory_check.xlsx"
            new_inv_path = str(job_dir / new_inv_name)
            os.rename(inv_check_path, new_inv_path)
            final_files.append(new_inv_path)
            log.info(f"   📄 库存报告: {new_inv_name}")
            
        # 重命名 parts.xlsx
        parts_path = str(job_dir / "parts.xlsx")
        if os.path.exists(parts_path):
            new_parts_name = f"{date_prefix}_parts.xlsx"
            new_parts_path = str(job_dir / new_parts_name)
            os.rename(parts_path, new_parts_path)
            final_files.append(new_parts_path)
            log.info(f"   📄 拆单结果: {new_parts_name}")
            
        result["stages"]["output"] = {"status": "success", "files": final_files}

        # ── 完成提示 ──
        log.info(f"")
        log.info(f"{'🎉' * 20}")
        log.info(f"✅ Pipeline 全部完成！最终输出文件:")
        for fp in final_files:
            log.info(f"   📁 {fp}")
        log.info(f"{'🎉' * 20}")
        log.info(f"")

        print(f"\n{'=' * 60}")
        print(f"🎉🎉🎉  Pipeline 完成！最终结果文件：")
        print(f"{'=' * 60}")
        for fp in final_files:
            print(f"  📄 {fp}")
        print(f"{'=' * 60}\n")

    except Exception as e:
        log.warning(f"   ⚠️ 输出文件重命名失败(非致命): {e}")
        result["stages"]["output"] = {"status": "warning", "error": str(e)}

    # ── Stage 9: Notifier Agent (通知) ────
    log.info("📱 Stage 9: 发送通知 (Notifier Agent)...")
    try:
        from agents.notifier_agent import notify_pipeline_result
        notify_pipeline_result(job_id=job_id, output_dir=str(job_dir))
        result["stages"]["notifier"] = {"status": "success"}
    except Exception as e:
        log.warning(f"   ⚠️ 通知发送失败(非致命): {e}")
        result["stages"]["notifier"] = {"status": "warning", "error": str(e)}

    # ── 归档订单 ──────────────────────────
    _archive_success(order_file, job_id)

    # ── 记录 BOM 历史 ────────────────────
    try:
        from core.bom_history import record as bom_record
        bom_record(job_id=job_id, cut_result_path=cut_result_path)
    except Exception as e:
        log.warning(f"   ⚠️ BOM 历史记录失败(非致命): {e}")

    # ── 记录裁切统计 ────────────────────
    try:
        from config.supabase_client import supabase
        with open(cut_result_path, "r", encoding="utf-8") as f:
            cut_data = json.load(f)
        stats_rows = []
        for board in cut_data.get("boards", []):
            board_type = board.get("board", "")
            for part in board.get("parts", []):
                stats_rows.append({
                    "job_id": job_id,
                    "board_type": board_type,
                    "t2_height": part.get("Height", 0),
                    "t2_width": part.get("Width", part.get("Depth", 0)),
                    "component": part.get("component", ""),
                    "cab_id": part.get("cab_id", ""),
                    "quantity": 1,
                })
        if stats_rows:
            supabase.table("cutting_stats").insert(stats_rows).execute()
            log.info(f"   📊 裁切统计已记录: {len(stats_rows)} 条")
    except Exception as e:
        log.warning(f"   ⚠️ 裁切统计记录失败(非致命): {e}")

    # ── 清理中间文件 ──────────────────────
    final_files_set = set(final_files) if 'final_files' in locals() else set()
    try:
        if os.path.exists(job_dir):
            for f in os.listdir(job_dir):
                clean_path = job_dir / f
                if clean_path.is_file() and str(clean_path) not in final_files_set:
                    os.remove(clean_path)
    except Exception as e:
        log.warning(f"   ⚠️ 中间文件清理失败: {e}")

    result["status"] = "success"
    result["end_time"] = datetime.now().isoformat()

    log.info(f"✅ 订单处理完成: {filename} → {job_id}")

    return result


def _archive_success(order_file: str, job_id: str):
    """成功订单归档到 archive/"""
    try:
        # 使用 job_id 加上原始扩展名，避免文件名无限叠加
        ext = os.path.splitext(order_file)[1]
        dest = ARCHIVE_DIR / f"{job_id}{ext}"
        shutil.copy2(order_file, dest)
        log.info(f"📁 订单已归档: {dest}")
    except Exception as e:
        log.warning(f"归档失败: {e}")


def _archive_failed(order_file: str, job_id: str, reason: str):
    """失败订单移到 failed_orders/"""
    try:
        dest = FAILED_ORDERS_DIR / f"{job_id}_{os.path.basename(order_file)}"
        shutil.copy2(order_file, dest)
        # 保存失败原因
        reason_file = FAILED_ORDERS_DIR / f"{job_id}_error.txt"
        with open(reason_file, "w") as f:
            f.write(f"订单: {order_file}\n时间: {datetime.now().isoformat()}\n原因: {reason}\n")
        log.info(f"📁 失败订单已记录: {dest}")
    except Exception as e:
        log.warning(f"失败归档异常: {e}")


def _notify_error(stage: str, error: str, job_id: str = ""):
    """尝试发送错误通知"""
    try:
        from agents.notifier_agent import notify_error
        notify_error(stage, error, job_id)
    except Exception:
        pass  # 通知失败不阻塞主流程


if __name__ == "__main__":
    # 手动运行测试: 使用 data/ 下已有的订单
    import sys
    if len(sys.argv) > 1:
        result = run_pipeline(order_path=sys.argv[1])
    else:
        result = run_pipeline(order_path="data/order.xlsx")
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
