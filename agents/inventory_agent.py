"""
Inventory Agent — 库存检查 + 低值预警

功能：
  1. 读取 t1_inventory.xlsx（当前库存）
  2. 读取 cut_result.json（本次用量）
  3. 计算剩余库存，检查是否缺料
  4. 低值预警（考虑采购周期 + 物流时间）
  5. 输出 inventory_check.json

参考了 ~/Desktop/inventory/check_inventory.py 的告警逻辑。
"""

import json
import os
from collections import defaultdict

import pandas as pd

from config.settings import (
    DATA_DIR, OUTPUT_DIR, INVENTORY_FILE,
    SAFETY_STOCK_THRESHOLD, PROCUREMENT_LEAD_DAYS, LOGISTICS_DAYS
)
from config.logger import get_logger

log = get_logger("inventory_agent")


def run(cut_result_path: str = None, inventory_path: str = None,
        output_dir: str = None) -> dict:
    """
    库存检查与预警。

    Returns:
        {
            "has_shortage": bool,
            "board_status": [...],
            "shortage_items": [...],
            "low_stock_warnings": [...],
            "reorder_suggestions": [...]
        }
    """
    cut_result_path = cut_result_path or str(OUTPUT_DIR / "cut_result.json")
    inventory_path = inventory_path or str(INVENTORY_FILE)
    output_dir = output_dir or str(OUTPUT_DIR)

    log.info(f"📦 库存检查开始")
    log.info(f"  库存文件: {inventory_path}")
    log.info(f"  裁切结果: {cut_result_path}")

    # ── 1. 读取库存 ──────────────────────
    inv_df = pd.read_excel(inventory_path)
    inventory = {}
    for _, row in inv_df.iterrows():
        bt = str(row["board_type"]).strip()
        inventory[bt] = {
            "board_type": bt,
            "height": float(row["Height"]),
            "depth": float(row["Depth"]),
            "current_qty": int(row["qty"]),
        }

    # ── 2. 读取裁切结果，统计用量 ─────────
    with open(cut_result_path, "r", encoding="utf-8") as f:
        cut_data = json.load(f)

    usage = defaultdict(int)
    for board in cut_data.get("boards", []):
        board_type = board.get("board", "")
        usage[board_type] += 1

    # ── 3. 计算剩余库存 & 检查缺料 ────────
    board_status = []
    shortage_items = []
    low_stock_warnings = []
    reorder_suggestions = []

    total_lead_days = PROCUREMENT_LEAD_DAYS + LOGISTICS_DAYS

    for bt, info in inventory.items():
        current = info["current_qty"]
        used = usage.get(bt, 0)
        remaining = current - used

        status_info = {
            "board_type": bt,
            "current_qty": current,
            "used_qty": used,
            "remaining_qty": remaining,
            "status": "ok",
        }

        # 缺料检查
        if remaining < 0:
            status_info["status"] = "shortage"
            shortage_items.append({
                "board_type": bt,
                "shortage_qty": abs(remaining),
                "detail": f"需要 {used} 张，库存仅 {current} 张，缺 {abs(remaining)} 张"
            })
            log.warning(f"❌ 缺料: {bt} — 需要 {used} 张，库存 {current} 张")

        # 低值预警（剩余量 ≤ 安全阈值）
        elif remaining <= SAFETY_STOCK_THRESHOLD:
            status_info["status"] = "low"
            low_stock_warnings.append({
                "board_type": bt,
                "remaining_qty": remaining,
                "safety_threshold": SAFETY_STOCK_THRESHOLD,
                "detail": f"剩余 {remaining} 张 ≤ 安全库存 {SAFETY_STOCK_THRESHOLD} 张"
            })
            log.warning(f"⚠️ 低库存: {bt} — 剩余 {remaining} 张")

            # 建议采购量: 至少补到安全阈值的 2 倍
            suggest_qty = max(SAFETY_STOCK_THRESHOLD * 2 - remaining, used)
            reorder_suggestions.append({
                "board_type": bt,
                "suggest_qty": suggest_qty,
                "lead_days": total_lead_days,
                "detail": f"建议采购 {suggest_qty} 张，预计 {total_lead_days} 天到货"
            })
        else:
            log.info(f"✅ {bt}: 库存充足 (剩余 {remaining} 张)")

        board_status.append(status_info)

    # 对缺料也生成采购建议
    for item in shortage_items:
        bt = item["board_type"]
        suggest_qty = item["shortage_qty"] + SAFETY_STOCK_THRESHOLD
        reorder_suggestions.append({
            "board_type": bt,
            "suggest_qty": suggest_qty,
            "lead_days": total_lead_days,
            "urgent": True,
            "detail": f"⚡ 紧急采购 {suggest_qty} 张，预计 {total_lead_days} 天到货"
        })

    has_shortage = len(shortage_items) > 0

    # ── 4. 输出 ──────────────────────────
    result = {
        "has_shortage": has_shortage,
        "board_status": board_status,
        "shortage_items": shortage_items,
        "low_stock_warnings": low_stock_warnings,
        "reorder_suggestions": reorder_suggestions,
    }

    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "inventory_check.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    icon = "❌" if has_shortage else ("⚠️" if low_stock_warnings else "✅")
    log.info(f"{icon} 库存检查完成: {'有缺料' if has_shortage else '无缺料'}")
    log.info(f"  低值预警: {len(low_stock_warnings)} 项")
    log.info(f"  采购建议: {len(reorder_suggestions)} 项")
    log.info(f"📄 报告: {out_path}")

    return result


if __name__ == "__main__":
    result = run()
    print(json.dumps(result, indent=2, ensure_ascii=False))
