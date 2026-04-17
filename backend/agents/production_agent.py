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
            cab_map = {"wall": "吊柜", "base": "地柜", "tall": "高柜"}
            ctype = cab_map.get(part.get("cab_type", "").lower(), part.get("cab_type", ""))
            comp_map = {
                "Top Panel": "顶板", "Bottom Panel": "底板", 
                "Side Panel": "侧板", "Back Panel": "背板", 
                "Adjustable Shelf": "活动层板", "Fixed Shelf": "固定层板", 
                "Stretcher": "拉条"
            }
            comp = comp_map.get(part.get("component", ""), part.get("component", ""))
            cab_id = part.get("cab_id", "")
            part_desc = f"{cab_id}-{ctype}-{comp}"

            cut_rows.append({
                "板型": board_type if idx == 0 else "",
                "序号": idx + 1,
                "零件部位信息": part_desc,
                "机器下刀长度(mm)": part["cut_length"],
                "t2Height(mm)": part["Height"],
                "t2Width(mm)": part.get("Width", part.get("Depth", 0)),
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
    from tools.cutting_optimizer import build_combined_summary
    df_summary = build_combined_summary(data)
    
    # 增加一行审核状态显示
    audit_df = pd.DataFrame([{"col_0": "审核状态", "col_1": audit_status if 'audit_status' in dir() else "未审核"}])
    df_summary = pd.concat([audit_df, df_summary], ignore_index=True)

    # ── 6. Sheet 4 (optional): T0 裁切计划 ───
    t0_plan = data.get("t0_plan", {})
    df_t0 = None
    if t0_plan and t0_plan.get("t0_sheets_needed", 0) > 0:
        t0_rows = []
        for sheet in t0_plan.get("t0_sheets", []):
            sheet_id = sheet["sheet_id"]
            utilization = sheet.get("utilization", 0)
            for idx, strip in enumerate(sheet["strips"]):
                t0_rows.append({
                    "T0板号": sheet_id if idx == 0 else "",
                    "T0尺寸": sheet.get("t0_size", "1219.2 × 2438.4") if idx == 0 else "",
                    "序号": idx + 1,
                    "裁切板型": strip["board_type"],
                    "裁切宽度(mm)": strip["width"],
                    "裁切长度(mm)": strip["height"],
                    "利用率": f"{utilization*100:.1f}%" if idx == 0 else "",
                    "废料宽度(mm)": f"{sheet.get('waste_width', 0)}mm" if idx == 0 else "",
                })
        df_t0 = pd.DataFrame(t0_rows)

    # ── 7. 写入 Excel ──────────────────
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, "worker_order.xlsx")

    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        df_cut.to_excel(writer, sheet_name="裁切工单", index=False)
        df_material.to_excel(writer, sheet_name="物料领用单", index=False)
        df_summary.to_excel(writer, sheet_name="汇总信息", index=False)
        if df_t0 is not None:
            df_t0.to_excel(writer, sheet_name="T0裁切计划", index=False)

    log.info(f"✅ 工单生成完成: {out_path}")
    log.info(f"  裁切工单: {len(cut_rows)} 行")
    log.info(f"  物料领用: {len(material_rows)} 种板材")
    sheet_count = 4 if df_t0 is not None else 3
    log.info(f"  {sheet_count} 个 Sheet")

    return out_path


if __name__ == "__main__":
    path = run()
    if path:
        print(f"工单已生成: {path}")
    else:
        print("工单生成失败")
