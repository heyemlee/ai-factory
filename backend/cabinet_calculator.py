#!/usr/bin/env python3
"""
Cabinet Panel Dimension Calculator

根据输入的柜体宽(W)、深(D)、高(H)，计算各板件的尺寸。

规则：
- 板材厚度：18mm
- 左右侧板包着顶底背板（最外层）
- 背板包着顶底板（背板在顶底板后方，直接钉上）
- 左右侧板靠后方各有一个3mm深的上下通槽，用于顶底板插入
- 层板深度方向内缩20mm
"""

# ─── 常量 ───────────────────────────────────────────────
BOARD_THICKNESS = 18       # 板材厚度 (mm)
GROOVE_DEPTH = 3           # 通槽深度 (mm)，每侧3mm，两侧共6mm
SHELF_INSET = 20           # 层板前方内缩 (mm)


def calculate_panels(width: int, depth: int, height: int, shelf_count: int) -> dict:
    """
    计算柜体各板件的尺寸。

    Args:
        width:  柜体宽度 W (mm)
        depth:  柜体深度 D (mm)
        height: 柜体高度 H (mm)
        shelf_count: 层板数量

    Returns:
        包含各板件尺寸的字典
    """
    t = BOARD_THICKNESS
    g = GROOVE_DEPTH

    # ── 左/右侧板（2片，尺寸相同）──
    # 最外层，完整高度 × 完整深度
    side_panel = {
        "name": "左/右侧板",
        "length": height,       # H
        "width": depth,         # D
        "qty": 2,
        "note": f"H({height}) × D({depth})"
    }

    # ── 顶/底板（2片，尺寸相同）──
    # 长度：W - 18×2 + 6（被侧板包住，但插入两侧通槽各3mm）
    # 深度：D - 18（背板在后方包着顶底板）
    top_bottom_length = width - t * 2 + g * 2   # W - 30
    top_bottom_depth = depth - t                  # D - 18
    top_bottom_panel = {
        "name": "顶/底板",
        "length": top_bottom_length,
        "width": top_bottom_depth,
        "qty": 2,
        "note": f"W({width}) - 18×2 + 6 = {top_bottom_length}  ×  D({depth}) - 18 = {top_bottom_depth}"
    }

    # ── 背板（1片）──
    # 宽度：W - 18×2（被侧板包住，不走通槽）
    # 高度：H（背板包着顶底板，完整高度）
    back_panel_width = width - t * 2              # W - 36
    back_panel_height = height                     # H
    back_panel = {
        "name": "背板",
        "length": back_panel_width,
        "width": back_panel_height,
        "qty": 1,
        "note": f"W({width}) - 18×2 = {back_panel_width}  ×  H({height})"
    }

    # ── 层板（N片）──
    # 长度：W - 18×2（在侧板之间，不插通槽）
    # 深度：D - 18 - 20（减背板厚度，再从前方内缩20mm）
    shelf_length = width - t * 2                  # W - 36
    shelf_depth = depth - t - SHELF_INSET          # D - 38
    shelf_panel = {
        "name": "层板",
        "length": shelf_length,
        "width": shelf_depth,
        "qty": shelf_count,
        "note": f"W({width}) - 36 = {shelf_length}  ×  D({depth}) - 18 - 20 = {shelf_depth}"
    }

    return {
        "side": side_panel,
        "top_bottom": top_bottom_panel,
        "back": back_panel,
        "shelf": shelf_panel,
    }


def print_results(width: int, depth: int, height: int, panels: dict):
    """格式化输出计算结果"""
    separator = "═" * 60
    thin_sep = "─" * 60

    print(f"\n{separator}")
    print(f"  柜体板件尺寸计算结果")
    print(f"  柜体尺寸：宽(W)={width}mm  深(D)={depth}mm  高(H)={height}mm")
    print(f"  板材厚度：{BOARD_THICKNESS}mm  |  通槽深度：{GROOVE_DEPTH}mm  |  层板内缩：{SHELF_INSET}mm")
    print(separator)

    for key, panel in panels.items():
        print(f"\n  【{panel['name']}】 × {panel['qty']} 片")
        print(f"    尺寸：{panel['length']} mm  ×  {panel['width']} mm")
        print(f"    算法：{panel['note']}")
        print(thin_sep)

    print()


def get_positive_int(prompt: str) -> int:
    """获取正整数输入"""
    while True:
        try:
            value = int(input(prompt))
            if value <= 0:
                print("  ⚠ 请输入大于0的数值！")
                continue
            return value
        except ValueError:
            print("  ⚠ 请输入有效的整数！")


def get_non_negative_int(prompt: str) -> int:
    """获取非负整数输入"""
    while True:
        try:
            value = int(input(prompt))
            if value < 0:
                print("  ⚠ 请输入大于等于0的数值！")
                continue
            return value
        except ValueError:
            print("  ⚠ 请输入有效的整数！")


def main():
    print("\n" + "═" * 60)
    print("  🏭 柜体板件尺寸计算器")
    print("  所有数据单位均为 mm")
    print("═" * 60)

    width = get_positive_int("\n  请输入柜体宽度 W (mm): ")
    depth = get_positive_int("  请输入柜体深度 D (mm): ")
    height = get_positive_int("  请输入柜体高度 H (mm): ")
    shelf_count = get_non_negative_int("  请输入层板数量: ")

    panels = calculate_panels(width, depth, height, shelf_count)
    print_results(width, depth, height, panels)

    # 询问是否继续计算
    while True:
        again = input("  是否继续计算下一个柜体？(y/n): ").strip().lower()
        if again in ("y", "yes", "是"):
            width = get_positive_int("\n  请输入柜体宽度 W (mm): ")
            depth = get_positive_int("  请输入柜体深度 D (mm): ")
            height = get_positive_int("  请输入柜体高度 H (mm): ")
            shelf_count = get_non_negative_int("  请输入层板数量: ")

            panels = calculate_panels(width, depth, height, shelf_count)
            print_results(width, depth, height, panels)
        elif again in ("n", "no", "否"):
            print("\n  bye\n")
            break
        else:
            print("  ⚠ 请输入 y 或 n")


if __name__ == "__main__":
    main()
