"""
excel_writer.py
将 cut_result.json 导出为 cut_result.xlsx，包含两个 Sheet：
  1. Cut List — 按 T1 板型分组，每组内列出所有板 × 零件明细
  2. Summary  — 合并汇总（全局总览 + 板型汇总 + 异常报告），方便打印

术语统一（橱柜行业）:
  - Height: 板件高度/长度方向尺寸 (mm)
  - Depth:  板件深度方向尺寸 (mm)
"""

import json
from collections import defaultdict

import pandas as pd


# ─────────────────────────────────────────────
# Sheet 1: 零件明细 — 按 T1 板型分组
# ─────────────────────────────────────────────

def build_cut_list(data):
    """
    按 board_type (T1板型) 分组输出。
    每组以板型标题行开头，然后列出该板型下每张板的零件。
    """
    groups = defaultdict(list)
    for board in data["boards"]:
        groups[board["board"]].append(board)

    rows = []
    for board_type in sorted(groups.keys()):
        boards = groups[board_type]
        board_size = boards[0].get("board_size", "")
        total_boards_in_type = len(boards)

        # ── 板型标题行 ──
        rows.append({
            "board_type":   board_type,
            "board_size":   board_size,
            "board_id":     f"共 {total_boards_in_type} 张",
            "序号":          "",
            "part_id":      "",
            "Height(mm)":   "",
            "Depth(mm)":    "",
            "cut_length":   "",
            "board_utilization": "",
            "board_waste":  "",
        })

        # ── 每张板的零件 ──
        for board in boards:
            for idx, part in enumerate(board["parts"]):
                rows.append({
                    "board_type":   "",
                    "board_size":   "",
                    "board_id":     board["board_id"] if idx == 0 else "",
                    "序号":          idx + 1,
                    "part_id":      part["part_id"],
                    "Height(mm)":   part["Height"],
                    "Depth(mm)":    part["Depth"],
                    "cut_length":   part["cut_length"],
                    "board_utilization": f"{board['utilization']*100:.1f}%" if idx == 0 else "",
                    "board_waste":  f"{board['waste']}mm²" if idx == 0 else "",
                })

    return pd.DataFrame(rows)


# ─────────────────────────────────────────────
# Sheet 2: Summary — 合并汇总表
#   区块A: 全局总览 (Utilization)
#   区块B: 板型汇总 (Board Summary)
#   区块C: 异常报告
# ─────────────────────────────────────────────

def build_combined_summary(data):
    """
    将全局汇总、板型汇总、异常报告合并为一张表。
    用空行和标题行区分三个区块，方便打印。
    """
    summary = data["summary"]
    issues = data.get("issues", {})

    # ── 最大列数（决定合并表的宽度）──
    max_cols = 9
    col_names = [f"col_{i}" for i in range(max_cols)]

    rows = []

    def add_row(values):
        """添加一行，不足 max_cols 的用空字符串补齐"""
        padded = list(values) + [""] * (max_cols - len(values))
        rows.append(dict(zip(col_names, padded[:max_cols])))

    def add_empty():
        add_row([""] * max_cols)

    # ══════════════════════════════════════════
    # 区块 A: 全局总览
    # ══════════════════════════════════════════
    add_row(["═══ 全局总览 ═══", "", "", "", "", "", "", "", ""])

    add_row(["零件需求(个)", summary.get("total_parts_required", ""),
             "成功切出(个)", summary.get("total_parts_placed", ""),
             "未切出(个)", summary.get("total_parts_unmatched", ""),
             "全部完成", "✅ 是" if summary.get("all_parts_cut", False) else "❌ 否", ""])

    add_row(["用板数", summary.get("boards_used", ""),
             "整体利用率", summary.get("overall_utilization", ""),
             "总零件长度(mm)", summary.get("total_parts_length", ""),
             "总废料(mm²)", summary.get("total_waste", ""), ""])

    add_row(["总扫边损耗(mm)", summary.get("total_trim_loss", ""),
             "总锯缝损耗(mm)", summary.get("total_kerf_loss", ""),
             "扫边设置(mm)", summary.get("config_trim_loss_mm", ""),
             "锯缝设置(mm)", summary.get("config_saw_kerf_mm", ""), ""])

    if summary.get("warning"):
        add_row(["⚠️ 警告", summary["warning"], "", "", "", "", "", "", ""])

    add_empty()

    # ══════════════════════════════════════════
    # 区块 B: 板型汇总
    # ══════════════════════════════════════════
    add_row(["═══ 板型汇总 ═══", "", "", "", "", "", "", "", ""])

    # 表头
    add_row(["board_type", "board_size(Depth×Height)", "用板数", "总零件数",
             "总切割刀数", "总零件长度(mm)", "总锯缝损耗(mm)", "总废料(mm²)", "平均利用率"])

    # 数据
    groups = defaultdict(list)
    for board in data["boards"]:
        groups[board["board"]].append(board)

    for board_type in sorted(groups.keys()):
        boards = groups[board_type]
        board_size = boards[0].get("board_size", "")
        n_boards = len(boards)
        total_parts = sum(len(b["parts"]) for b in boards)
        total_parts_len = sum(b["parts_total_length"] for b in boards)
        total_cuts = sum(b["cuts"] for b in boards)
        total_kerf = sum(b["kerf_total"] for b in boards)
        total_waste = sum(b["waste"] for b in boards)
        total_parts_area = sum(b.get("parts_total_area", 0) for b in boards)
        total_board_area = sum(b.get("board_area", 0) for b in boards)
        avg_util = total_parts_area / total_board_area if total_board_area > 0 else 0

        add_row([board_type, board_size, n_boards, total_parts,
                 total_cuts, round(total_parts_len, 2), round(total_kerf, 2),
                 round(total_waste, 2), f"{avg_util*100:.1f}%"])

    add_empty()

    # ══════════════════════════════════════════
    # 区块 C: 异常报告
    # ══════════════════════════════════════════
    add_row(["═══ 异常报告 ═══", "", "", "", "", "", "", "", ""])

    has_issues = False

    # 跳过行
    for item in issues.get("skipped_rows", []):
        if not has_issues:
            add_row(["问题类型", "来源文件", "part_id", "Height_mm", "Depth_mm", "qty", "原因", "建议", ""])
            has_issues = True
        add_row(["数据缺失（行被跳过）", item.get("file", "parts.xlsx"), "", "", "", "",
                 item.get("source", ""), "请补全 Height/Depth/qty", ""])

    # 无匹配板型
    for item in issues.get("unmatched_parts", []):
        if not has_issues:
            add_row(["问题类型", "来源文件", "part_id", "Height_mm", "Depth_mm", "qty", "原因", "建议", ""])
            has_issues = True
        reasons_str = "；".join(item.get("reasons", []))
        add_row(["无匹配板型", "parts.xlsx", item.get("part_id", ""),
                 item.get("Height_mm", ""), item.get("Depth_mm", ""),
                 item.get("qty", ""), reasons_str, item.get("suggestion", ""), ""])

    if not has_issues:
        add_row(["✅ 无异常", "", "", "", "", "", "所有零件数据完整且均可匹配到 T1 库存板型", "", ""])

    return pd.DataFrame(rows, columns=col_names)


# ─────────────────────────────────────────────
# 主导出函数
# ─────────────────────────────────────────────

def export_excel(json_file, output_file):
    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    cut_list = build_cut_list(data)
    summary  = build_combined_summary(data)

    with pd.ExcelWriter(output_file, engine="openpyxl") as writer:
        cut_list.to_excel(writer, sheet_name="Cut List", index=False)
        summary.to_excel(writer,  sheet_name="Summary",  index=False, header=False)

    print(f"✅ {output_file} 生成完成（2 个 Sheet: Cut List + Summary）")


if __name__ == "__main__":
    export_excel(
        "output/cut_result.json",
        "output/cut_result.xlsx"
    )