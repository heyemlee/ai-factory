"""
excel_writer.py
将 cut_result.json 导出为 cut_result.xlsx，包含四个 Sheet：
  1. Cut List      — 每张板 × 每个零件的明细行
  2. Board Summary — 每张板汇总（含损耗审计字段）
  3. Utilization   — 全局汇总
  4. 异常报告      — 跳过行 + 无匹配板型零件（来自 issues 区块）
"""

import json
import pandas as pd


# ─────────────────────────────────────────────
# Sheet 1: 零件明细（每行 = 一个零件）
# ─────────────────────────────────────────────

def build_cut_list(data):
    rows = []

    for board in data["boards"]:
        for part in board["parts"]:
            rows.append({
                "board_id":           board["board_id"],
                "board_type":         board["board"],
                "board_size":         board.get("board_size", ""),
                "part_id":            part["part_id"],
                "part_width":         part["width"],
                "part_height":        part["height"],
                "trim_loss":          board.get("trim_loss", ""),
                "saw_kerf":           board.get("saw_kerf", ""),
                "cuts":               board.get("cuts", ""),
                "kerf_total":         board.get("kerf_total", ""),
                "usable_length":      board.get("usable_length", ""),
                "parts_total_length": board.get("parts_total_length", ""),
                "waste":              board["waste"],
                "utilization":        board["utilization"],
            })

    return pd.DataFrame(rows)


# ─────────────────────────────────────────────
# Sheet 2: 板汇总（每行 = 一张板）
# ─────────────────────────────────────────────

def build_board_summary(data):
    rows = []

    for board in data["boards"]:
        parts_str = ", ".join(
            f'{p["part_id"]}({p["width"]}×{p["height"]})'
            for p in board["parts"]
        )

        rows.append({
            "board_id":           board["board_id"],
            "board_type":         board["board"],
            "board_size":         board.get("board_size", ""),
            "parts":              parts_str,
            "trim_loss":          board.get("trim_loss", ""),
            "saw_kerf":           board.get("saw_kerf", ""),
            "cuts":               board.get("cuts", ""),
            "parts_total_length": board.get("parts_total_length", ""),
            "kerf_total":         board.get("kerf_total", ""),
            "usable_length":      board.get("usable_length", ""),
            "waste":              board["waste"],
            "utilization":        board["utilization"],
        })

    return pd.DataFrame(rows)


# ─────────────────────────────────────────────
# Sheet 3: 全局汇总
# ─────────────────────────────────────────────

def build_utilization(data):
    summary = data["summary"]

    row = {
        "boards_used":         summary["boards_used"],
        "total_parts_length":  summary.get("total_parts_length", ""),
        "total_trim_loss":     summary.get("total_trim_loss", ""),
        "total_kerf_loss":     summary.get("total_kerf_loss", ""),
        "total_waste":         summary.get("total_waste", ""),
        "overall_utilization": summary.get("overall_utilization", ""),
        "config_trim_loss_mm": summary.get("config_trim_loss_mm", ""),
        "config_saw_kerf_mm":  summary.get("config_saw_kerf_mm", ""),
        "warning":             summary.get("warning", ""),
    }

    return pd.DataFrame([row])


# ─────────────────────────────────────────────
# Sheet 4: 异常报告（来自 issues 区块）
# ─────────────────────────────────────────────

def build_issues_sheet(data):
    """
    读取 cut_result.json 中的 issues 区块，
    生成合并的异常报告，包含两类问题：
      A. 跳过行（数据缺失 / NaN）
      B. 无匹配板型（尺寸不兼容 / 超出可用长度）
    若无任何异常，输出一行"✅ 无异常"。
    """
    issues = data.get("issues", {})
    rows   = []

    # ── A. 跳过行 ──────────────────────────────────────
    for item in issues.get("skipped_rows", []):
        rows.append({
            "问题类型":  "数据缺失（行被跳过）",
            "来源文件":  item.get("file", "parts.xlsx"),
            "part_id":   "",
            "width_mm":  "",
            "height_mm": "",
            "qty":       "",
            "原因":      item.get("source", ""),
            "建议":      "请在 parts.xlsx 中补全该行的 width / height / qty 值",
        })

    # ── B. 无匹配板型 ──────────────────────────────────
    for item in issues.get("unmatched_parts", []):
        reasons_str = "；".join(item.get("reasons", []))
        rows.append({
            "问题类型":  "无匹配板型（零件无法裁切）",
            "来源文件":  "parts.xlsx",
            "part_id":   item.get("part_id", ""),
            "width_mm":  item.get("width_mm", ""),
            "height_mm": item.get("height_mm", ""),
            "qty":       item.get("qty", ""),
            "原因":      reasons_str,
            "建议":      item.get("suggestion", ""),
        })

    # ── 无异常占位行 ────────────────────────────────────
    if not rows:
        rows.append({
            "问题类型":  "✅ 无异常",
            "来源文件":  "",
            "part_id":   "",
            "width_mm":  "",
            "height_mm": "",
            "qty":       "",
            "原因":      "所有零件数据完整且均可匹配到 T1 库存板型",
            "建议":      "",
        })

    return pd.DataFrame(rows)


# ─────────────────────────────────────────────
# 主导出函数
# ─────────────────────────────────────────────

def export_excel(json_file, output_file):
    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    cut_list      = build_cut_list(data)
    board_summary = build_board_summary(data)
    utilization   = build_utilization(data)
    issues_df     = build_issues_sheet(data)

    with pd.ExcelWriter(output_file, engine="openpyxl") as writer:
        cut_list.to_excel(writer,      sheet_name="Cut List",      index=False)
        board_summary.to_excel(writer, sheet_name="Board Summary", index=False)
        utilization.to_excel(writer,   sheet_name="Utilization",   index=False)
        issues_df.to_excel(writer,     sheet_name="异常报告",       index=False)

    print(f"✅ {output_file} 生成完成")


if __name__ == "__main__":
    export_excel(
        "cut_result.json",
        "cut_result.xlsx"
    )