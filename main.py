#!/usr/bin/env python3
import os
import sys

# 自动将 backend 目录加入 Python 路径，解决导入问题
project_root = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(project_root, "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

if __name__ == "__main__":
    from core.workflow_controller import run_pipeline
    import json

    # 获取命令行参数（订单文件路径）
    if len(sys.argv) > 1:
        order_path = sys.argv[1]
    else:
        # 默认使用 data/order.xlsx
        order_path = os.path.join(project_root, "data", "order.xlsx")

    # 运行 Pipeline
    print(f"🚀 Starting Pipeline for: {order_path}")
    result = run_pipeline(order_path=order_path)
    
    # 打印最终结果（格式化 JSON）
    print("\n" + "="*60)
    print("🏁 Pipeline Result Summary")
    print("="*60)
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
