"""
Production Agent — 生成工人操作工单

功能：
  1. 读取 cut_result.json（裁切方案）
  2. 读取 audit.json（审核须为 pass 或 warning）
  3. 生成 worker_order.xlsx（3 个 Sheet）
     - Sheet 1: 裁切工单（按板型分组）
     - Sheet 2: 物料领用单
     - Sheet 3: 汇总信息
"""

import json
import os
from collections import defaultdict
from datetime import datetime

import pandas as pd

from config.settings import OUTPUT_DIR
from config.logger import get_logger

log = get_logger("production_agent")


def run(cut_result_path: str = None, audit_path: str = None,
        output_dir: str = None) -> str:
    """
    生成工单。

    Returns:
        worker_order.xlsx 路径
    """
    cut_result_path = cut_result_path or str(OUTPUT_DIR / "cut_result.json")
    audit_path = audit_path or str(OUTPUT_DIR / "audit.json")
    output_dir = output_dir or str(OUTPUT_DIR)

    log.info("📋 开始生成工单")

    # ── 1. 读取审核结果 ──────────────────
    if os.path.exists(audit_path):
        with open(audit_path, "r", encoding="utf-8") as f:
            audit = json.load(f)
        audit_status = audit.get("status", "unknown")
        if audit_status == "fail":
            log.error("❌ 审核未通过，无法生成工单")
            return ""
        log.info(f"  审核状态: {audit_status}")
    else:
        log.warning("⚠️ 未找到 audit.json，跳过审核检查")

    # ── 2. 读取裁切结果 ──────────────────
    with open(cut_result_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    summary = data.get("summary", {})
    boards = data.get("boards", [])

    # ── 3. Sheet 1: 裁切工单 ─────────────
    cut_rows = []
    for board in boards:
        board_id = board["board_id"]
        board_type = board["board"]
        board_size = board.get("board_size", "")
        utilization = board.get("utilization", 0)

        for idx, part in enumerate(board["parts"]):
            cut_rows.append({
                "板型": board_type if idx == 0 else "",
                "板材尺寸": board_size if idx == 0 else "",
                "板编号": board_id if idx == 0 else "",
                "序号": idx + 1,
                "零件编号": part["part_id"],
                "切割长度(mm)": part["cut_length"],
                "Height(mm)": part["Height"],
                "Depth(mm)": part["Depth"],
                "利用率": f"{utilization*100:.1f}%" if idx == 0 else "",
            })

    df_cut = pd.DataFrame(cut_rows)

    # ── 4. Sheet 2: 物料领用单 ───────────
    material_usage = defaultdict(int)
    for board in boards:
        material_usage[board["board"]] += 1

    material_rows = []
    for board_type in sorted(material_usage.keys()):
        qty = material_usage[board_type]
        # 获取板材尺寸
        sample = next(b for b in boards if b["board"] == board_type)
        material_rows.append({
            "板型": board_type,
            "板材尺寸": sample.get("board_size", ""),
            "领用数量(张)": qty,
            "领用人": "",
            "日期": datetime.now().strftime("%Y-%m-%d"),
            "备注": "",
        })

    df_material = pd.DataFrame(material_rows)

    # ── 5. Sheet 3: 汇总信息 ─────────────
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    summary_rows = [
        {"项目": "生成时间", "内容": now},
        {"项目": "零件总数", "内容": summary.get("total_parts_required", 0)},
        {"项目": "成功切出", "内容": summary.get("total_parts_placed", 0)},
        {"项目": "用板总数", "内容": summary.get("boards_used", 0)},
        {"项目": "整体利用率", "内容": f"{summary.get('overall_utilization', 0)*100:.1f}%"},
        {"项目": "总废料(mm)", "内容": summary.get("total_waste", 0)},
        {"项目": "修边设置(mm)", "内容": summary.get("config_trim_loss_mm", 5)},
        {"项目": "锯缝设置(mm)", "内容": summary.get("config_saw_kerf_mm", 5)},
        {"项目": "审核状态", "内容": audit_status if 'audit_status' in dir() else "未审核"},
    ]
    df_summary = pd.DataFrame(summary_rows)

    # ── 6. 写入 Excel ──────────────────
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "worker_order.xlsx")

    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        df_cut.to_excel(writer, sheet_name="裁切工单", index=False)
        df_material.to_excel(writer, sheet_name="物料领用单", index=False)
        df_summary.to_excel(writer, sheet_name="汇总信息", index=False)

    log.info(f"✅ 工单生成完成: {out_path}")
    log.info(f"  裁切工单: {len(cut_rows)} 行")
    log.info(f"  物料领用: {len(material_rows)} 种板材")
    log.info(f"  3 个 Sheet: 裁切工单 + 物料领用单 + 汇总信息")

    return out_path


if __name__ == "__main__":
    path = run()
    if path:
        print(f"工单已生成: {path}")
    else:
        print("工单生成失败")
