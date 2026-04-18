"""
Audit Agent — 裁切方案审核

功能：
  1. 读取 cut_result.json
  2. 执行多项审核检查
  3. 输出 audit.json (status: pass / warning / fail)
"""

import json
import os
from config.settings import OUTPUT_DIR
from config.logger import get_logger

log = get_logger("audit_agent")

# ── 审核阈值 ──────────────────────────────
MIN_UTILIZATION = 0.60   # 利用率低于 60% 告警
MAX_WASTE_PER_BOARD = 800  # 单张板废料超过 800mm 告警


def run(cut_result_path: str = None, output_dir: str = None) -> dict:
    """
    审核裁切结果。

    Args:
        cut_result_path: cut_result.json 路径
        output_dir: 审核结果输出目录

    Returns:
        audit 结果字典
    """
    cut_result_path = cut_result_path or str(OUTPUT_DIR / "cut_result.json")
    output_dir = output_dir or str(OUTPUT_DIR)

    log.info(f"🔍 开始审核: {cut_result_path}")

    with open(cut_result_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    summary = data.get("summary", {})
    issues = data.get("issues", {})
    boards = data.get("boards", [])

    checks = []
    status = "pass"

    # ── 检查 1: 零件完整性（仅比较可裁切零件）──
    total_required = summary.get("total_parts_required", 0)
    total_placed = summary.get("total_parts_placed", 0)
    all_cut = summary.get("all_parts_cut", False)
    oversized_count = summary.get("oversized_count", 0)

    # 可裁切零件是否全部切好
    valid_all_placed = (total_placed == total_required)

    if valid_all_placed:
        checks.append({
            "name": "零件完整性",
            "status": "pass",
            "detail": f"全部 {total_required} 个可裁切零件已成功分配"
        })
    else:
        unmatched = summary.get("total_parts_unmatched", 0)
        checks.append({
            "name": "零件完整性",
            "status": "fail",
            "detail": f"需求 {total_required} 个，切出 {total_placed} 个，未切出 {unmatched} 个"
        })
        status = "fail"

    # ── 检查 1b: 超板零件（单独警告）──
    if oversized_count > 0:
        oversized_parts = issues.get("oversized_parts", [])
        detail_items = []
        for op in oversized_parts[:5]:
            detail_items.append(f"{op.get('cab_id','?')}-{op.get('component','?')} ({op['Height']}×{op['Width']}mm)")
        detail = f"{oversized_count} 个零件尺寸超板无法裁切: " + ", ".join(detail_items)
        if oversized_count > 5:
            detail += f" ...等共 {oversized_count} 个"
        checks.append({
            "name": "超板零件",
            "status": "warning",
            "detail": detail
        })
        if status == "pass":
            status = "warning"

    # ── 检查 2: 整体利用率 ──────────────────
    overall_util = summary.get("overall_utilization", 0)

    if overall_util >= MIN_UTILIZATION:
        checks.append({
            "name": "整体利用率",
            "status": "pass",
            "detail": f"利用率 {overall_util*100:.1f}% ≥ {MIN_UTILIZATION*100:.0f}%"
        })
    else:
        checks.append({
            "name": "整体利用率",
            "status": "warning",
            "detail": f"利用率 {overall_util*100:.1f}% < {MIN_UTILIZATION*100:.0f}%，建议优化订单组合"
        })
        if status == "pass":
            status = "warning"

    # ── 检查 3: 单板废料 ──────────────────
    high_waste_boards = [
        b for b in boards if b.get("waste", 0) > MAX_WASTE_PER_BOARD
    ]

    if not high_waste_boards:
        checks.append({
            "name": "单板废料",
            "status": "pass",
            "detail": f"所有板材废料均 ≤ {MAX_WASTE_PER_BOARD}mm"
        })
    else:
        details = ", ".join(
            f"{b['board_id']}({b['waste']}mm)" for b in high_waste_boards[:5]
        )
        checks.append({
            "name": "单板废料",
            "status": "warning",
            "detail": f"{len(high_waste_boards)} 张板废料超过 {MAX_WASTE_PER_BOARD}mm: {details}"
        })
        if status == "pass":
            status = "warning"

    # ── 检查 4: 数据质量 ──────────────────
    skipped = issues.get("skipped_rows", [])
    unmatched_parts = issues.get("unmatched_parts", [])

    if not skipped and not unmatched_parts:
        checks.append({
            "name": "数据质量",
            "status": "pass",
            "detail": "无数据异常，无未匹配零件"
        })
    else:
        detail_parts = []
        if skipped:
            detail_parts.append(f"{len(skipped)} 行数据被跳过")
        if unmatched_parts:
            detail_parts.append(f"{len(unmatched_parts)} 种零件无匹配板型")
        checks.append({
            "name": "数据质量",
            "status": "warning" if not unmatched_parts else "fail",
            "detail": "；".join(detail_parts)
        })
        if unmatched_parts:
            status = "fail"
        elif status == "pass":
            status = "warning"

    # ── 生成建议 ──────────────────────────
    recommendations = []
    if overall_util < MIN_UTILIZATION:
        recommendations.append("考虑合并多个订单一起裁切以提高利用率")
    if high_waste_boards:
        recommendations.append("高废料板可尝试搭配小零件填充")
    if unmatched_parts:
        recommendations.append("请在 t1_inventory.xlsx 中添加缺失的板型")
    if oversized_count > 0:
        recommendations.append(f"{oversized_count} 个零件尺寸超过板材极限，需要特殊处理（拼接或定制板材）")

    # ── 输出 ──────────────────────────────
    audit = {
        "status": status,
        "checks": checks,
        "recommendations": recommendations,
        "summary": {
            "total_parts": total_required,
            "placed_parts": total_placed,
            "oversized_parts": oversized_count,
            "boards_used": summary.get("boards_used", 0),
            "utilization": round(overall_util, 4),
            "total_waste": summary.get("total_waste", 0),
        }
    }
    # 把超板零件明细也写进审核报告
    if oversized_count > 0:
        audit["oversized_parts"] = issues.get("oversized_parts", [])

    os.makedirs(output_dir, exist_ok=True)
    audit_path = os.path.join(output_dir, "audit.json")
    with open(audit_path, "w", encoding="utf-8") as f:
        json.dump(audit, f, indent=2, ensure_ascii=False)

    icon = {"pass": "✅", "warning": "⚠️", "fail": "❌"}[status]
    log.info(f"{icon} 审核完成: {status.upper()}")
    for c in checks:
        c_icon = {"pass": "✅", "warning": "⚠️", "fail": "❌"}[c["status"]]
        log.info(f"  {c_icon} {c['name']}: {c['detail']}")
    log.info(f"📄 审核报告: {audit_path}")

    return audit


if __name__ == "__main__":
    result = run()
    print(json.dumps(result, indent=2, ensure_ascii=False))
