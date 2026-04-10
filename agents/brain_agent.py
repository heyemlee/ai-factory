"""
橱柜订单拆单引擎 v2

功能：
  1. 读取新格式 order.xlsx（OrderID, Room, CabinetType, Width, Height, Depth, Qty, Material, Color, Notes）
     - 所有尺寸单位统一为 mm
     - Width  = 柜子宽度（开口方向）mm
     - Height = 柜子高度（垂直方向）mm
     - Depth  = 柜子深度（进墙方向）mm
  2. 根据柜型（Base / Wall / Pantry 等）拆解为板件（parts）
  3. 同时支持旧格式 order.xlsx（柜号, 型号, 名称, 长(mm), 宽(mm), 数量）

输出 parts.xlsx 列：part_id, Height(mm), Depth(mm), qty
  - Height = 板件的长边（沿板长方向裁切的尺寸）
  - Depth  = 板件的短边（与库存板 Depth 匹配的尺寸）

橱柜行业统一术语：
  - Height: 板件的高度 / 长度方向尺寸 (mm)
  - Depth:  板件的深度方向尺寸 (mm)
"""

import pandas as pd
import os

# 板材厚度 (mm)
PANEL_THICKNESS = 18  # mm


# ─────────────────────────────────────────────
# 柜型拆解规则
# ─────────────────────────────────────────────

def explode_cabinet(row):
    """
    根据柜型将一个柜子拆解为多个板件。

    参数 (全部 mm):
      W = 柜子宽度 (开口方向) mm
      H = 柜子高度 (垂直方向) mm
      D = 柜子深度 (进墙方向) mm

    返回：list of dict，每个 dict = 一个板件
      part_id:  零件编号
      Height:   板件长边 (mm)
      Depth:    板件短边 (mm)
      qty:      数量
    """
    order_id = row["OrderID"]
    room     = str(row.get("Room", "")).strip()
    cab_type = str(row["CabinetType"]).strip()
    W = float(row["Width"])
    H = float(row["Height"])
    D = float(row["Depth"])
    qty = int(row["Qty"])
    notes = str(row.get("Notes", "")).strip()

    # 生成零件ID前缀
    prefix = f"{order_id}-{room[:3].upper()}-{cab_type[:4].upper()}-{int(W)}W"

    parts = []

    # 内宽 = 柜宽 - 2×板厚（用于底板、顶板、隔板等）
    inner_w = W - 2 * PANEL_THICKNESS

    # ── 通用板件（所有柜型都有）─────────────────
    # 所有板件的 Depth = 柜深 D（匹配 T1 库存板 Depth）
    # 只有 Height 根据部位不同而变化

    # 左侧板：Height = 柜高 H
    parts.append({
        "part_id": f"{prefix}-SL",
        "Height": round(H, 2),
        "Depth": round(D, 2),
        "qty": qty,
    })

    # 右侧板：同左侧板
    parts.append({
        "part_id": f"{prefix}-SR",
        "Height": round(H, 2),
        "Depth": round(D, 2),
        "qty": qty,
    })

    # 底板：Height = 内宽 (W - 2×板厚)
    parts.append({
        "part_id": f"{prefix}-BT",
        "Height": round(inner_w, 2),
        "Depth": round(D, 2),
        "qty": qty,
    })

    # 顶板：同底板尺寸
    parts.append({
        "part_id": f"{prefix}-TP",
        "Height": round(inner_w, 2),
        "Depth": round(D, 2),
        "qty": qty,
    })

    # 背板：Height = 柜高 H, Depth = 柜深 D（同样使用 T1 板）
    parts.append({
        "part_id": f"{prefix}-BK",
        "Height": round(H, 2),
        "Depth": round(D, 2),
        "qty": qty,
    })

    # ── 柜型特殊板件 ─────────────────────────────

    if cab_type.lower() == "base":
        # Base cabinet: 踢脚板 Height = 内宽, Depth = 柜深 D
        parts.append({
            "part_id": f"{prefix}-KK",
            "Height": round(inner_w, 2),
            "Depth": round(D, 2),
            "qty": qty,
        })

        if "drawer" in notes.lower():
            # 抽屉柜：抽屉面板 Height = 内宽, Depth = 柜深 D
            parts.append({
                "part_id": f"{prefix}-DF",
                "Height": round(inner_w, 2),
                "Depth": round(D, 2),
                "qty": qty * 3,
            })

    elif cab_type.lower() == "wall":
        # Wall cabinet: 墙柜没有踢脚板，结构已包含在通用板件中
        pass

    elif cab_type.lower() == "pantry":
        # Pantry: 高柜，加中间隔板
        # 隔板尺寸同底板
        parts.append({
            "part_id": f"{prefix}-SH",
            "Height": round(inner_w, 2),
            "Depth": round(D, 2),
            "qty": qty * 2,  # 2块隔板
        })

    return parts


# ─────────────────────────────────────────────
# 新格式订单处理
# ─────────────────────────────────────────────

def process_new_format(order_path, output_path):
    """处理新格式订单：OrderID, Room, CabinetType, Width, Height, Depth, Qty ... (全部 mm)"""
    df = pd.read_excel(order_path)
    df = df.dropna(how="all")

    required = ["OrderID", "CabinetType", "Width", "Height", "Depth", "Qty"]
    missing = set(required) - set(df.columns)
    if missing:
        raise RuntimeError(f"新格式订单缺少列: {missing}")

    df = df.dropna(subset=required)

    # 拆解每一行柜子
    all_parts = []
    for _, row in df.iterrows():
        parts = explode_cabinet(row)
        all_parts.extend(parts)

    if not all_parts:
        raise RuntimeError("拆解后没有零件")

    result = pd.DataFrame(all_parts)
    result = result[["part_id", "Height", "Depth", "qty"]]
    result = result.sort_values("Depth").reset_index(drop=True)

    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else "data", exist_ok=True)
    result.to_excel(output_path, index=False)

    print(f"✅ 拆单完成，共 {len(result)} 个 parts → {output_path}")
    return output_path


# ─────────────────────────────────────────────
# 旧格式订单处理 (兼容)
# ─────────────────────────────────────────────

def process_old_format(order_path, output_path):
    """处理旧格式订单：柜号, 型号, 名称, 长(mm), 宽(mm), 数量"""
    df = pd.read_excel(order_path)
    df = df.dropna(how="all")

    required_cols = ["名称", "长(mm)", "宽(mm)", "数量"]
    df = df.dropna(subset=required_cols)

    # 旧格式中: 长(mm) → Height, 宽(mm) → Depth
    df = df.rename(columns={
        "名称": "part_id",
        "长(mm)": "Height",
        "宽(mm)": "Depth",
        "数量": "qty",
    })
    df = df[["part_id", "Height", "Depth", "qty"]]
    df = df.sort_values("Depth").reset_index(drop=True)

    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else "data", exist_ok=True)
    df.to_excel(output_path, index=False)

    print(f"✅ 拆单完成，共 {len(df)} 个 parts → {output_path}")
    return output_path


# ─────────────────────────────────────────────
# 自动检测格式
# ─────────────────────────────────────────────

def detect_format(path):
    """根据列名检测订单格式"""
    df = pd.read_excel(path, nrows=1)
    cols = set(df.columns)

    if "CabinetType" in cols:
        return "new"
    elif "名称" in cols or "柜号" in cols:
        return "old"
    else:
        raise RuntimeError(f"无法识别订单格式，列名: {list(cols)}")


def run(order_path="data/order.xlsx", output_path="data/parts.xlsx"):
    """主入口：自动检测格式并拆单"""
    print(f"📋 开始拆单: {order_path}")

    fmt = detect_format(order_path)
    print(f"   格式: {'新格式 (mm)' if fmt == 'new' else '旧格式 (mm)'}")

    if fmt == "new":
        return process_new_format(order_path, output_path)
    else:
        return process_old_format(order_path, output_path)


if __name__ == "__main__":
    order_path = "data/order.xlsx"
    output_path = "data/parts.xlsx"
    run(order_path, output_path)