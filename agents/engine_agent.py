"""
橱柜工厂直切优化引擎 v2

逻辑：
  1. 读取 parts.xlsx（part_id, width, height, qty）
  2. 读取 t1_inventory.xlsx（board_type, width, height, qty）
  3. 按 width 将零件分组 → 每组对应一种库存板型
  4. 每组内用 FFD（First Fit Decreasing）装箱算法，
     把零件沿板长方向排列，尽量塞满每张板
  5. 输出 cut_result.json

直切规则：
  - 板的 width（宽度）= 零件的 width，精确匹配，不切
  - 板的 height（长度方向 = 3000mm）用来排列零件
  - 每张板先扣一次修边损耗 TRIM_LOSS
  - 每个零件切一刀产生一道锯缝 SAW_KERF
  - usable = board_height - TRIM_LOSS
  - 放 k 个零件：sum(part_heights) + k × SAW_KERF ≤ usable
  - waste = usable - sum(part_heights) - k × SAW_KERF
  - utilization = sum(part_heights) / board_height
"""

import json
import math
from collections import defaultdict

import pandas as pd


# ── 工厂参数 ─────────────────────────────────────────
TRIM_LOSS = 5   # mm，每张板修边损耗
SAW_KERF  = 5   # mm，每刀锯缝


# ─────────────────────────────────────────────
# 数据读取
# ─────────────────────────────────────────────

def load_parts(path: str):
    """读取 parts.xlsx，展开 qty 为独立零件行。"""
    df = pd.read_excel(path)

    required = {"part_id", "width", "height", "qty"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[parts.xlsx] 缺少列: {missing}")

    df = df.dropna(subset=list(required))

    parts = []
    skipped = []

    for i, row in df.iterrows():
        pid = str(row["part_id"]).strip()
        try:
            w = float(row["width"])
            h = float(row["height"])
            q = int(row["qty"])
        except (ValueError, TypeError) as e:
            skipped.append({"row": i + 2, "reason": str(e)})
            continue

        if w <= 0 or h <= 0 or q <= 0:
            skipped.append({"row": i + 2, "reason": f"无效值 w={w}, h={h}, q={q}"})
            continue

        # 展开 qty：每个零件独立一条
        for _ in range(q):
            parts.append({"part_id": pid, "width": w, "height": h})

    if skipped:
        print(f"⚠️  跳过 {len(skipped)} 行:")
        for s in skipped:
            print(f"  第 {s['row']} 行: {s['reason']}")

    if not parts:
        raise RuntimeError("[parts.xlsx] 没有有效零件")

    print(f"📦 读取零件: {len(parts)} 个（{len(df)} 行 × qty 展开）")
    return parts, skipped


def load_inventory(path: str):
    """读取 t1_inventory.xlsx。"""
    df = pd.read_excel(path)

    required = {"board_type", "width", "height", "qty"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"[t1_inventory.xlsx] 缺少列: {missing}")

    boards = {}
    for _, row in df.iterrows():
        bt = str(row["board_type"]).strip()
        boards[bt] = {
            "board_type": bt,
            "width": float(row["width"]),
            "height": float(row["height"]),
            "qty": int(row["qty"]),
        }

    print(f"📋 库存板型: {len(boards)} 种")
    return boards


# ─────────────────────────────────────────────
# 匹配：零件 → 库存板型
# ─────────────────────────────────────────────

def match_parts_to_boards(parts: list, boards: dict):
    """
    按 width 匹配零件到库存板型。
    返回:
      matched:   dict[board_type] → list of {part_id, cut_length}
      unmatched: list of parts that have no matching board
    """
    # 建立 width → board_type 索引
    width_to_board = {}
    for bt, info in boards.items():
        width_to_board[info["width"]] = bt

    matched = defaultdict(list)   # board_type → [parts]
    unmatched = []

    for p in parts:
        pw, ph = p["width"], p["height"]

        if pw in width_to_board:
            # 直接匹配：part.width == board.width，切割长度 = part.height
            bt = width_to_board[pw]
            matched[bt].append({
                "part_id": p["part_id"],
                "width": pw,
                "height": ph,
                "cut_length": ph,   # 沿板长方向占用的尺寸
            })
        elif ph in width_to_board:
            # 旋转匹配：part.height == board.width，切割长度 = part.width
            bt = width_to_board[ph]
            matched[bt].append({
                "part_id": p["part_id"],
                "width": pw,
                "height": ph,
                "cut_length": pw,   # 旋转后沿板长方向占用
                "rotated": True,
            })
        else:
            unmatched.append(p)

    if unmatched:
        print(f"\n🚫 {len(unmatched)} 个零件无匹配板型:")
        seen = set()
        for u in unmatched:
            key = f"{u['part_id']}({u['width']}×{u['height']})"
            if key not in seen:
                seen.add(key)
                print(f"  {key}")

    return matched, unmatched


# ─────────────────────────────────────────────
# FFD 装箱算法（1D Bin Packing）
# ─────────────────────────────────────────────

def ffd_bin_pack(parts_list: list, board_info: dict):
    """
    First Fit Decreasing：
    - 把零件按 cut_length 从大到小排序
    - 依次尝试放入已有的板，放得下就放
    - 放不下就开一张新板

    返回: list of boards, 每张板包含 parts 列表和利用率信息
    """
    board_height = board_info["height"]
    board_width  = board_info["width"]
    board_type   = board_info["board_type"]
    max_qty      = board_info["qty"]
    usable       = board_height - TRIM_LOSS

    # 按 cut_length 降序排列（大件优先）
    sorted_parts = sorted(parts_list, key=lambda p: p["cut_length"], reverse=True)

    # 每张板: {"remaining": float, "parts": [...]}
    open_boards = []

    for part in sorted_parts:
        cl = part["cut_length"]
        needed = cl + SAW_KERF  # 放一个零件需要的空间 = 零件长 + 一道锯缝

        if needed > usable:
            # 单个零件都放不下（超出板长），标记异常
            print(f"  ⚠️  零件 {part['part_id']} 切割长度 {cl}mm + 锯缝 {SAW_KERF}mm > 可用 {usable}mm，跳过")
            continue

        # 尝试放入已有的板（First Fit）
        placed = False
        for board in open_boards:
            if board["remaining"] >= needed:
                board["parts"].append(part)
                board["remaining"] -= needed
                placed = True
                break

        # 放不下就开新板
        if not placed:
            if len(open_boards) >= max_qty:
                print(f"  ⚠️  板型 {board_type} 库存不足 ({max_qty} 张已用完)")
                break
            open_boards.append({
                "remaining": usable - needed,
                "parts": [part],
            })

    # 计算每张板的利用率
    results = []
    for idx, board in enumerate(open_boards, 1):
        board_id = f"{board_type}-{idx:03d}"
        parts_total = sum(p["cut_length"] for p in board["parts"])
        k = len(board["parts"])
        kerf_total = k * SAW_KERF
        waste = usable - parts_total - kerf_total
        utilization = parts_total / board_height if board_height > 0 else 0

        results.append({
            "board_id": board_id,
            "board": board_type,
            "board_size": f"{board_width} × {board_height}",
            "parts": [
                {
                    "part_id": p["part_id"],
                    "width": p["width"],
                    "height": p["height"],
                    "cut_length": p["cut_length"],
                }
                for p in board["parts"]
            ],
            "trim_loss": TRIM_LOSS,
            "saw_kerf": SAW_KERF,
            "cuts": k,
            "parts_total_length": round(parts_total, 2),
            "kerf_total": round(kerf_total, 2),
            "usable_length": round(usable, 2),
            "waste": round(waste, 2),
            "utilization": round(utilization, 4),
        })

    return results


# ─────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────

def main():
    parts_file = "data/parts.xlsx"
    inv_file   = "data/t1_inventory.xlsx"

    print("=" * 55)
    print("  直切优化引擎 v2 — FFD 装箱算法")
    print("=" * 55)

    # 1. 读取数据
    parts, skipped_rows = load_parts(parts_file)
    boards = load_inventory(inv_file)

    # 2. 按 width 匹配零件 → 库存板型
    matched, unmatched = match_parts_to_boards(parts, boards)

    total_matched = sum(len(v) for v in matched.values())
    print(f"\n✅ 已匹配: {total_matched} 个零件 → {len(matched)} 种板型")

    # 3. 每种板型做 FFD 装箱
    all_board_results = []

    for board_type in sorted(matched.keys()):
        parts_list = matched[board_type]
        board_info = boards[board_type]
        print(f"\n── {board_type} ({board_info['width']}mm 宽) ── {len(parts_list)} 个零件")

        board_results = ffd_bin_pack(parts_list, board_info)
        all_board_results.extend(board_results)

        for br in board_results:
            parts_str = ", ".join(
                f"{p['part_id']}({p['cut_length']})"
                for p in br["parts"]
            )
            print(f"  {br['board_id']}: 利用率 {br['utilization']*100:.1f}% | 废料 {br['waste']}mm | {parts_str}")

    # 4. 汇总
    total_boards = len(all_board_results)
    total_parts_len = sum(b["parts_total_length"] for b in all_board_results)
    total_trim = sum(b["trim_loss"] for b in all_board_results)
    total_kerf = sum(b["kerf_total"] for b in all_board_results)
    total_waste = sum(b["waste"] for b in all_board_results)
    total_board_len = sum(
        b["usable_length"] + b["trim_loss"] for b in all_board_results
    )
    overall_util = total_parts_len / total_board_len if total_board_len > 0 else 0

    summary = {
        "boards_used": total_boards,
        "total_parts_placed": total_matched,
        "total_parts_length": round(total_parts_len, 2),
        "total_trim_loss": round(total_trim, 2),
        "total_kerf_loss": round(total_kerf, 2),
        "total_waste": round(total_waste, 2),
        "overall_utilization": round(overall_util, 4),
        "config_trim_loss_mm": TRIM_LOSS,
        "config_saw_kerf_mm": SAW_KERF,
    }

    if unmatched:
        summary["warning"] = f"{len(unmatched)} 个零件无匹配板型，详见 issues"

    # 5. 构建 issues
    issues = {
        "skipped_rows": [
            {"file": "parts.xlsx", "source": f"第 {s['row']} 行: {s['reason']}"}
            for s in skipped_rows
        ],
        "unmatched_parts": [],
    }
    seen_unmatched = {}
    for u in unmatched:
        key = f"{u['part_id']}|{u['width']}x{u['height']}"
        if key not in seen_unmatched:
            seen_unmatched[key] = {"count": 0, **u}
        seen_unmatched[key]["count"] += 1

    for key, u in seen_unmatched.items():
        issues["unmatched_parts"].append({
            "part_id": u["part_id"],
            "width_mm": u["width"],
            "height_mm": u["height"],
            "qty": u["count"],
            "reasons": [f"没有 width={u['width']}mm 或 height={u['height']}mm 的库存板型"],
            "suggestion": "请在 t1_inventory.xlsx 中添加对应宽度的板型",
        })

    # 6. 输出 JSON
    output = {
        "summary": summary,
        "issues": issues,
        "boards": all_board_results,
    }

    with open("cut_result.json", "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"\n{'=' * 55}")
    print(f"  ✅ 优化完成！")
    print(f"  用板: {total_boards} 张 | 利用率: {overall_util*100:.1f}%")
    print(f"  零件总长: {total_parts_len:.1f}mm")
    print(f"  总废料: {total_waste:.1f}mm")
    if unmatched:
        print(f"  ⚠️  {len(unmatched)} 个零件无法裁切")
    print(f"  结果已写入 cut_result.json")
    print(f"{'=' * 55}")


if __name__ == "__main__":
    main()