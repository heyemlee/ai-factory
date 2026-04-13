#!/usr/bin/env python3
"""
橱柜工厂 AI 系统 — 主入口

用法:
  # 调度模式（自动轮询邮件，每 5 分钟检查一次）
  python main.py

  # 手动处理指定订单
  python main.py data/order.xlsx

  # 手动处理 incoming_orders 中的订单
  python main.py incoming_orders/xxx_order.xlsx
"""

import sys
import json
from agents.orchestrator_agent import run_once, run_scheduler


def main():
    if len(sys.argv) > 1:
        order_path = sys.argv[1]
        print(f"🏭 手动处理订单: {order_path}")
        result = run_once(order_path=order_path)
        if result:
            print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    else:
        print("🏭 启动橱柜工厂 AI 调度器（Ctrl+C 退出）")
        run_scheduler()


if __name__ == "__main__":
    main()
