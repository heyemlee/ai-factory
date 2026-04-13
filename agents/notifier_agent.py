"""
Notifier Agent — Pipeline 状态通知

功能：
  1. 汇总 Pipeline 各阶段结果
  2. 发送 Telegram 通知
  3. 有缺料或审核失败时发送告警
  4. 工单完成后发送文件
"""

import json
import os
import glob

from tools.telegram_notifier import send_message, send_file
from config.settings import OUTPUT_DIR
from config.logger import get_logger

log = get_logger("notifier_agent")


def _find_latest_file(directory: str, pattern: str) -> str:
    """在目录中查找匹配 pattern 的最新文件（支持日期前缀的文件名）"""
    matches = glob.glob(os.path.join(directory, pattern))
    if matches:
        # 返回最新修改的文件
        return max(matches, key=os.path.getmtime)
    return ""


def notify_pipeline_result(job_id: str = "", output_dir: str = None):
    """
    汇总所有阶段结果并发送通知。
    """
    output_dir = output_dir or str(OUTPUT_DIR)

    log.info("📱 汇总 Pipeline 结果并发送通知")

    messages = []
    messages.append(f"🏭 *橱柜工厂 AI 生产报告*")
    if job_id:
        messages.append(f"📋 工单号: `{job_id}`")

    # ── 1. 裁切结果 ──────────────────────
    cut_path = os.path.join(output_dir, "cut_result.json")
    if os.path.exists(cut_path):
        with open(cut_path, "r", encoding="utf-8") as f:
            cut = json.load(f)
        s = cut.get("summary", {})
        messages.append("")
        messages.append("✂️ *裁切结果:*")
        messages.append(f"  零件: {s.get('total_parts_placed', 0)}/{s.get('total_parts_required', 0)}")
        messages.append(f"  用板: {s.get('boards_used', 0)} 张")
        messages.append(f"  利用率: {s.get('overall_utilization', 0)*100:.1f}%")

    # ── 2. 审核结果 ──────────────────────
    audit_path = os.path.join(output_dir, "audit.json")
    if os.path.exists(audit_path):
        with open(audit_path, "r", encoding="utf-8") as f:
            audit = json.load(f)
        status = audit.get("status", "unknown")
        icon = {"pass": "✅", "warning": "⚠️", "fail": "❌"}.get(status, "❓")
        messages.append("")
        messages.append(f"📊 *审核: {icon} {status.upper()}*")
        for rec in audit.get("recommendations", []):
            messages.append(f"  💡 {rec}")

    # ── 3. 库存结果 ──────────────────────
    inv_path = os.path.join(output_dir, "inventory_check.json")
    if os.path.exists(inv_path):
        with open(inv_path, "r", encoding="utf-8") as f:
            inv = json.load(f)

        if inv.get("has_shortage"):
            messages.append("")
            messages.append("🚨 *缺料告警:*")
            for item in inv.get("shortage_items", []):
                messages.append(f"  ❌ {item['board_type']}: {item['detail']}")

        if inv.get("low_stock_warnings"):
            messages.append("")
            messages.append("⚠️ *低库存预警:*")
            for w in inv.get("low_stock_warnings", []):
                messages.append(f"  ⚠️ {w['board_type']}: {w['detail']}")

        if inv.get("reorder_suggestions"):
            messages.append("")
            messages.append("🛒 *采购建议:*")
            for r in inv.get("reorder_suggestions", []):
                urgent = "⚡" if r.get("urgent") else "📦"
                messages.append(f"  {urgent} {r['board_type']}: {r['detail']}")

    # ── 4. 发送消息 ──────────────────────
    full_msg = "\n".join(messages)
    log.info(f"发送通知 ({len(full_msg)} 字符)")
    send_message(full_msg)

    # ── 5. 发送工单文件（支持日期前缀文件名）──
    # 优先查找带日期前缀的文件，兼容旧的无前缀文件
    worker_order = _find_latest_file(output_dir, "*_worker_order.xlsx")
    if not worker_order:
        worker_order = os.path.join(output_dir, "worker_order.xlsx")
    if os.path.exists(worker_order):
        send_file(worker_order, caption=f"📋 工人操作工单 ({os.path.basename(worker_order)})")
        log.info(f"📎 工单文件已发送: {os.path.basename(worker_order)}")

    cut_excel = _find_latest_file(output_dir, "*_cut_result.xlsx")
    if not cut_excel:
        cut_excel = os.path.join(output_dir, "cut_result.xlsx")
    if os.path.exists(cut_excel):
        send_file(cut_excel, caption=f"✂️ 裁切报告 ({os.path.basename(cut_excel)})")
        log.info(f"📎 裁切报告已发送: {os.path.basename(cut_excel)}")

    log.info("✅ 通知发送完成")


def notify_error(stage: str, error: str, job_id: str = ""):
    """发送错误告警"""
    msg = f"🚨 *橱柜工厂 AI 错误*\n\n"
    if job_id:
        msg += f"工单号: `{job_id}`\n"
    msg += f"阶段: {stage}\n"
    msg += f"错误: {error}"
    send_message(msg)
    log.error(f"错误通知已发送: [{stage}] {error}")


def notify_stage(stage: str, message: str):
    """发送阶段状态通知"""
    send_message(f"🏭 {stage}: {message}")
    log.info(f"阶段通知: [{stage}] {message}")


if __name__ == "__main__":
    notify_pipeline_result()
