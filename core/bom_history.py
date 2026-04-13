"""
BOM 历史数据管理 — 记录每次订单的板材消耗，支持统计分析

存储格式: data/bom_history.json (JSON Lines, 每行一条记录)

功能:
  1. 每次 Pipeline 完成后记录消耗数据
  2. 查询月均 / 日均消耗
  3. 为 Inventory Agent 提供采购预测数据
"""

import json
import os
from datetime import datetime, timedelta
from collections import defaultdict

from config.settings import DATA_DIR
from config.logger import get_logger

log = get_logger("bom_history")

HISTORY_FILE = str(DATA_DIR / "bom_history.jsonl")


def record(job_id: str, cut_result_path: str):
    """
    记录一次订单的板材消耗。

    Args:
        job_id: 工单 ID
        cut_result_path: cut_result.json 路径
    """
    with open(cut_result_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    summary = data.get("summary", {})
    boards = data.get("boards", [])

    # 统计每种板型用量
    usage = defaultdict(int)
    for board in boards:
        usage[board["board"]] += 1

    record_data = {
        "timestamp": datetime.now().isoformat(),
        "job_id": job_id,
        "total_parts": summary.get("total_parts_required", 0),
        "boards_used": summary.get("boards_used", 0),
        "utilization": summary.get("overall_utilization", 0),
        "board_usage": dict(usage),
    }

    # 追加写入 (JSON Lines 格式)
    os.makedirs(os.path.dirname(HISTORY_FILE), exist_ok=True)
    with open(HISTORY_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record_data, ensure_ascii=False) + "\n")

    log.info(f"📊 BOM 历史已记录: {job_id} ({summary.get('boards_used', 0)} 张板)")


def load_history(days: int = None) -> list:
    """
    加载历史记录。

    Args:
        days: 只加载最近 N 天的记录，None 表示全部
    """
    if not os.path.exists(HISTORY_FILE):
        return []

    records = []
    cutoff = None
    if days:
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()

    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                if cutoff and rec.get("timestamp", "") < cutoff:
                    continue
                records.append(rec)
            except json.JSONDecodeError:
                continue

    return records


def get_monthly_stats(months: int = 3) -> dict:
    """
    计算月均消耗统计。

    Returns:
        {
            "period_days": N,
            "total_orders": N,
            "total_boards": N,
            "avg_boards_per_order": float,
            "avg_utilization": float,
            "board_type_monthly_avg": { "T1-610*2440": float, ... },
            "board_type_total": { "T1-610*2440": int, ... },
        }
    """
    days = months * 30
    records = load_history(days=days)

    if not records:
        return {"period_days": days, "total_orders": 0, "message": "暂无历史数据"}

    total_boards = sum(r.get("boards_used", 0) for r in records)
    total_util = sum(r.get("utilization", 0) for r in records)

    # 按板型统计
    board_totals = defaultdict(int)
    for r in records:
        for bt, qty in r.get("board_usage", {}).items():
            board_totals[bt] += qty

    n = len(records)
    actual_days = max(days, 1)

    # 计算实际跨度天数
    if n >= 2:
        first = datetime.fromisoformat(records[0]["timestamp"])
        last = datetime.fromisoformat(records[-1]["timestamp"])
        actual_days = max((last - first).days, 1)

    monthly_factor = 30 / actual_days

    return {
        "period_days": actual_days,
        "total_orders": n,
        "total_boards": total_boards,
        "avg_boards_per_order": round(total_boards / n, 1),
        "avg_utilization": round(total_util / n, 4),
        "board_type_total": dict(board_totals),
        "board_type_monthly_avg": {
            bt: round(qty * monthly_factor, 1)
            for bt, qty in board_totals.items()
        },
    }


def predict_reorder(board_type: str, current_stock: int, lead_days: int = 10) -> dict:
    """
    基于历史消耗预测是否需要补货。

    Args:
        board_type: 板型名称
        current_stock: 当前库存
        lead_days: 采购+物流总天数

    Returns:
        { "should_reorder": bool, "daily_avg": float, "days_remaining": float, ... }
    """
    records = load_history(days=90)

    if not records:
        return {"should_reorder": False, "message": "历史数据不足，无法预测"}

    # 统计该板型消耗
    total_used = 0
    for r in records:
        total_used += r.get("board_usage", {}).get(board_type, 0)

    if total_used == 0:
        return {"should_reorder": False, "daily_avg": 0, "message": f"{board_type} 无历史消耗"}

    # 计算日均
    first = datetime.fromisoformat(records[0]["timestamp"])
    last = datetime.fromisoformat(records[-1]["timestamp"])
    span_days = max((last - first).days, 1)
    daily_avg = total_used / span_days

    # 预估剩余天数
    days_remaining = current_stock / daily_avg if daily_avg > 0 else float("inf")

    should_reorder = days_remaining <= lead_days

    return {
        "board_type": board_type,
        "current_stock": current_stock,
        "daily_avg": round(daily_avg, 2),
        "days_remaining": round(days_remaining, 1),
        "lead_days": lead_days,
        "should_reorder": should_reorder,
        "suggest_qty": max(int(daily_avg * lead_days * 1.5) - current_stock, 0) if should_reorder else 0,
    }


if __name__ == "__main__":
    stats = get_monthly_stats()
    print(json.dumps(stats, indent=2, ensure_ascii=False))
