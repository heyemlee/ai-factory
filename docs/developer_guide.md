# 🏭 AI Factory — 开发者技术文档

> **ABC Cabinet 橱柜智能工厂生产系统**
>
> 从客户 Excel 订单 → 自动拆单 → 板材裁切优化 → 工人工单生成 → 库存管理 → 通知推送
>
> 一条完全自动化的橱柜板材加工 Pipeline。

---

## 1. 项目定位与业务背景

### 1.1 业务场景

ABC Cabinet 是一家美国橱柜制造商。客户下单时提供一张 Excel 表，列出所需橱柜的型号、宽度(W)、高度(H)、深度(D)、数量等信息。工厂需要：

1. **拆单**：将每个橱柜拆解为侧板、顶板、底板、背板、层板、拉条等零件
2. **裁切优化**：将零件合理排列到标准板材上，最小化废料
3. **生成工单**：输出工人可直接操作的裁切工单 Excel
4. **库存管理**：检查板材库存是否充足，生成采购建议
5. **通知**：通过 Telegram 推送处理结果

### 1.2 板材体系 (T0 / T1 / T2)

```
T0 — 原板 (Raw Sheet)
     1219.2 × 2438.4 mm (48″ × 96″)
     从供应商购入的全尺寸 MDF 板

     ↓  沿宽度方向 (1219.2mm) 裁切

T1 — 条料 (Strip)
     如 304.8 × 2438.4 mm (12″ × 96″ 吊柜用)
        609.6 × 2438.4 mm (24″ × 96″ 地柜/高柜用)
     工厂预切好的标准宽度条料, 有库存

     ↓  沿长度方向 (2438.4mm) 裁切

T2 — 零件 (Part)
     如侧板 876.3 × 609.6 mm
     最终装配到橱柜上的板件
```

### 1.3 尺寸术语统一

| 术语     | 含义                               | 板材轴向      |
|----------|------------------------------------|---------------|
| **Height** | 板件的长度方向尺寸 (mm)             | 沿 2438.4mm 轴 |
| **Width**  | 板件的宽度方向尺寸 (mm)             | 沿 1219.2mm 轴 |
| Thickness  | 板材厚度, 固定 18mm                | —              |

> ⚠️ 不使用 "Depth" 这个词 (历史遗留已清理)。所有代码统一使用 Height / Width。

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────┐
│                    用户 / 浏览器                      │
│              Vercel Dashboard (Next.js)              │
│               frontend/  ← TailwindCSS              │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
                       ▼
              ┌─────────────────┐
              │    Supabase     │
              │  ┌───────────┐  │
              │  │  orders   │  │  ← 订单队列 (pending → processing → completed)
              │  │ inventory │  │  ← 板材库存
              │  │bom_history│  │  ← BOM 消耗记录
              │  │  Storage  │  │  ← 订单 Excel 文件存储
              │  └───────────┘  │
              └────────┬────────┘
                       │ Polling (30s)
                       ▼
┌─────────────────────────────────────────────────────┐
│           本地工厂 Mac Studio (Backend)               │
│                                                      │
│  cloud_controller.py  ──→ 拉取 Pending 订单           │
│         │                                            │
│         ▼                                            │
│  ┌─────────────────────────────────────────────┐     │
│  │       Pipeline (workflow_controller.py)      │     │
│  │                                             │     │
│  │  Stage 2: brain_agent        → 拆单          │     │
│  │  Stage 3: engine_agent       → 裁切优化      │     │
│  │           └ t0_optimizer     → T0混排        │     │
│  │  Stage 5: audit_agent        → 质量审核      │     │
│  │  Stage 6: inventory_agent    → 库存检查      │     │
│  │  Stage 7: production_agent   → 工单生成      │     │
│  │  Stage 8: output             → 文件重命名    │     │
│  │  Stage 9: notifier_agent     → Telegram     │     │
│  │           bom_history        → BOM记录       │     │
│  └─────────────────────────────────────────────┘     │
│         │                                            │
│         ▼                                            │
│  output/{job_id}/                                    │
│    ├── worker_order.xlsx   ← 工人裁切工单             │
│    ├── parts.xlsx          ← 拆单零件清单             │
│    └── inventory_check.xlsx← 库存检查报告             │
└─────────────────────────────────────────────────────┘
```

### 2.2 两种运行模式

| 模式 | 入口 | 数据源 | 适用场景 |
|------|------|--------|----------|
| **本地测试** | `python3 main.py data/order.xlsx` | 本地 Excel + 本地库存 | 开发、调试、手动跑单 |
| **生产 Cloud** | `bash scripts/start_cloud.sh` | Supabase 轮询 | 日常生产，Dashboard 上传订单 |

---

## 3. 目录结构

```
ai-factory/
├── main.py                        # 🚀 本地 Pipeline 入口
├── .env                           # 环境变量 (Supabase/Telegram/Gmail 密钥)
├── .env.example                   # 环境变量模板
│
├── backend/                       # ═══ 后端核心 ═══
│   ├── cabinet_calculator.py      # 📐 橱柜尺寸计算器 (inches → mm → 零件列表)
│   ├── requirements.txt           # Python 依赖
│   │
│   ├── agents/                    # ═══ 功能 Agent 模块 ═══
│   │   ├── brain_agent.py         # 🧠 订单解析 & 格式检测 & 拆单路由
│   │   ├── engine_agent.py        # ✂️  裁切优化引擎 v5 (FFD bin packing)
│   │   ├── t0_optimizer.py        # 📦 T0 大板混排优化 (FFD + 剩料回收)
│   │   ├── audit_agent.py         # 🔍 裁切方案质量审核
│   │   ├── inventory_agent.py     # 📦 库存检查 & 采购建议
│   │   ├── production_agent.py    # 📋 工人工单 Excel 生成
│   │   ├── notifier_agent.py      # 📱 Telegram 通知推送
│   │   └── orchestrator_agent.py  # 🎯 Agent 调度编排
│   │
│   ├── core/                      # ═══ 核心控制器 ═══
│   │   ├── workflow_controller.py # 🔄 Pipeline 编排引擎 (9个Stage)
│   │   ├── cloud_controller.py    # ☁️  Supabase 轮询 + 云端 Pipeline
│   │   └── bom_history.py         # 📊 BOM 消耗历史记录
│   │
│   ├── config/                    # ═══ 配置中心 ═══
│   │   ├── settings.py            # ⚙️  集中配置 (路径/参数/环境变量)
│   │   ├── logger.py              # 📝 日志配置
│   │   ├── supabase_client.py     # 🔗 Supabase 连接
│   │   ├── schema.sql             # 🗄️  数据库建表 SQL
│   │   └── setup_schema.py        # 🔧 自动建表脚本
│   │
│   └── tools/                     # ═══ 工具模块 ═══
│       ├── cutting_optimizer.py   # 汇总报告生成工具
│       ├── email_reader.py        # Gmail IMAP 附件下载
│       └── telegram_notifier.py   # Telegram Bot API
│
├── frontend/                      # ═══ Next.js Dashboard ═══
│   ├── src/                       # React 组件 & 页面
│   └── package.json               # 前端依赖
│
├── scripts/                       # ═══ 运维脚本 ═══
│   ├── dev.sh                     # 一键启动 (后端 + 前端)
│   └── start_cloud.sh             # 仅启动后端轮询
│
├── data/                          # 运行时数据
│   ├── order1.xlsx                # 当前订单文件
│   └── t1_inventory.xlsx          # 本地库存数据
│
├── output/                        # Pipeline 输出 (按 job_id 分目录)
│   └── 2026-04-17_1/
│       ├── 2026-04-17_17_worker_order.xlsx
│       ├── 2026-04-17_17_parts.xlsx
│       └── 2026-04-17_17_inventory_check.xlsx
│
├── archive/                       # 已处理订单归档
├── failed_orders/                 # 处理失败的订单
├── logs/                          # 日志文件
├── tests/                         # 测试数据
│   └── fixtures/
└── docs/                          # 项目文档
    ├── architecture.md
    ├── operation_guide.md
    └── developer_guide.md         # ← 本文件
```

---

## 4. Pipeline 详解 (9 个 Stage)

Pipeline 由 `workflow_controller.py` 编排，顺序执行以下阶段：

### Stage 1: 获取订单
- **本地模式**: 直接使用命令行指定的 Excel 文件
- **Cloud 模式**: `cloud_controller.py` 从 Supabase 拉取 `status=pending` 的订单

### Stage 2: 拆单 (Brain Agent)
- **文件**: `brain_agent.py` → `cabinet_calculator.py`
- **输入**: 客户订单 Excel (`order.xlsx`)
- **输出**: 零件清单 (`parts.xlsx`)
- **流程**:
  1. `detect_format()` 自动识别订单格式（新格式/旧格式/calculator格式）
  2. 对于 calculator 格式，调用 `cabinet_calculator.py`:
     - `parse_imperial()` 解析英制分数尺寸 (如 `26 3/16` → `26.1875`)
     - 乘以 25.4 转换为 mm
     - 当 D=0 时自动使用柜型默认深度
     - `calculate_panels()` 根据柜型拆解为侧板、顶板、底板、背板、层板、拉条
  3. 输出 `parts.xlsx`，每行一个零件: `part_id, cab_id, cab_type, component, Height, Width, qty`

**柜型拆解规则:**

| 柜型 | 侧板 | 顶板 | 底板 | 背板 | 拉条 | 层板 |
|------|------|------|------|------|------|------|
| Wall (吊柜) | H×D ×2 | (W-36)×(D-18) ×1 | (W-36)×(D-18) ×1 | (W-30)×H ×1 | — | 按需 |
| Base (地柜) | H×D ×2 | — | (W-36)×(D-18) ×1 | (W-30)×H ×1 | (W-36)×101.6 ×2 | 按需 |
| Tall (高柜) | H×D ×2 | (W-36)×(D-18) ×1 | (W-36)×(D-18) ×1 | (W-30)×H ×1 | — | 按需 |

> 注: W/H/D 单位为 mm, 板厚 t=18mm, 槽深 g=3mm

### Stage 3: 裁切优化 (Engine Agent v5)
- **文件**: `engine_agent.py` + `t0_optimizer.py`
- **输入**: `parts.xlsx` + `t1_inventory.xlsx`
- **输出**: `cut_result.json`
- **核心算法**: FFD (First Fit Decreasing) 一维装箱

**引擎 5 步流程:**

```
STEP 1: build_strip_demand()
        零件 → 按 Width 分组成条料需求
        优先精确匹配库存 (±0.5mm容差)

STEP 2: apply_inventory()
        库存 T1 条料抵扣需求
        不足的 → T0 pool

STEP 3: optimize_t0_from_strips()  [t0_optimizer.py]
        T0 pool 中所有条料 FFD 混排到 T0 大板上
        e.g.: 876.3mm + 304.8mm → 一张 T0 (利用率 96.9%)

STEP 3b: Gap-Fill Optimization
        计算 T0 板上剩余间隙, 从库存拉窄条料填充

STEP 4: recover_leftover()
        T0 剩料回收:
        ≥609.6 → 回收 T1-609.6
        ≥304.8 → 回收 T1-304.8
        ≥200   → 回收拉条

STEP 5: ffd_strip_pack()
        在每根条料内沿 Height 轴 FFD 排列零件
```

**超板零件检测:**
- Width > T0板宽 (1219.2mm) 或 Height > 板材可用长度 (2433.4mm) 的零件被标记为超板
- 超板零件不参与裁切，单独记录在 `issues.oversized_parts`
- 不做旋转，只沿 Width 方向裁切

### Stage 5: 审核 (Audit Agent)
- **文件**: `audit_agent.py`
- **检查项**:
  1. 零件完整性 — 所有可裁切零件是否全部分配
  2. 超板零件 — 列出超过板材极限的零件 (warning, 不阻塞)
  3. 整体利用率 — 低于 60% 警告
  4. 单板废料 — 超过 800mm 警告
  5. 数据质量 — 跳过的行和未匹配零件
- **输出**: `audit.json` (status: pass / warning / fail)
- **规则**: 只有 `fail` 才会阻止工单生成

### Stage 6: 库存检查 (Inventory Agent)
- **文件**: `inventory_agent.py`
- **功能**: 逐板型对比库存，生成缺料预警和采购建议
- **输出**: `inventory_check.json` + `inventory_check.xlsx`

### Stage 7: 工单生成 (Production Agent)
- **文件**: `production_agent.py`
- **输出**: `worker_order.xlsx` (多 Sheet)

| Sheet | 内容 |
|-------|------|
| 裁切工单 | 每个零件的板型、下刀长度、Height、Width |
| 物料领用单 | 各板型领用数量 |
| 汇总信息 | 审核状态、利用率、零件统计 |
| T0裁切计划 | T0 大板如何切成条料 |
| ⛔超板零件 | 尺寸超出板材极限无法裁切的零件 |

### Stage 8: 输出文件重命名
- 所有输出文件加日期前缀: `2026-04-17_17_worker_order.xlsx`

### Stage 9: 通知 (Notifier Agent)
- 通过 Telegram Bot 推送处理结果摘要 + 工单文件

---

## 5. 关键配置

### 5.1 环境变量 (`.env`)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJh...
SUPABASE_SERVICE_KEY=eyJh...

# Gmail IMAP
EMAIL_USER=orders@abcabinet.us
EMAIL_PASS=xxxx xxxx xxxx xxxx

# Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHAT_ID=-100xxxxxxxx
```

### 5.2 工厂参数 (`settings.py`)

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `PANEL_THICKNESS` | 18mm | 板材厚度 |
| `TRIM_LOSS` | 5mm | 板材修边损耗 |
| `SAW_KERF` | 5mm | 锯缝宽度 |
| `SAFETY_STOCK_THRESHOLD` | 10张 | 安全库存阈值 |

### 5.3 柜型默认尺寸 (`cabinet_calculator.py`)

| 柜型 | 默认深度 | 默认高度 |
|------|----------|----------|
| Wall (吊柜) | 304.8mm (12") | — |
| Base (地柜) | 609.6mm (24") | 876.3mm (34.5") |
| Tall (高柜) | 609.6mm (24") | 2387.6mm (94") |

> 当订单中 D=0 或 H=0 时，自动使用以上默认值。

---

## 6. 数据库 Schema (Supabase / PostgreSQL)

```sql
-- 库存表
inventory (board_type, height, width, stock, threshold, ...)

-- 订单队列
orders (job_id, filename, status, utilization, boards_used, file_url, ...)
  -- status: pending → processing → completed / failed

-- BOM 历史
bom_history (job_id, boards_used, total_parts, overall_utilization, ...)

-- 裁切统计
cutting_stats (job_id, board_type, t2_height, t2_width, component, ...)
```

完整建表 SQL 见 `backend/config/schema.sql`。

---

## 7. 数据流示例

以一张含 TP2596 高柜的订单为例：

```
输入 order1.xlsx:
  Cabinet No=25, ABC Item=TP2596, W=25", H=97", D=0, Qty=3, type=tall

→ parse_imperial(): W=25.0, H=97.0, D=0.0 (inches)
→ × 25.4: W=635.0, H=2463.8, D=0.0 (mm)
→ D=0 → 使用默认深度 609.6mm (tall)
→ calculate_panels():
    侧板: 2463.8 × 609.6mm ×2  → ⛔ 超板 (H=2463.8 > 2433.4)
    顶板: 599.0 × 591.6mm ×1   → ✅ 可裁切
    底板: 599.0 × 591.6mm ×1   → ✅ 可裁切
    背板: 605.0 × 2463.8mm ×1  → ⛔ 超板 (W=2463.8 > 1219.2)

→ Engine: 可裁切零件 → FFD packing → cut_result.json
→ 超板零件 → issues.oversized_parts

→ worker_order.xlsx:
    Sheet"裁切工单": 可裁切的零件
    Sheet"⛔超板零件": TP2596-侧板(2463.8×609.6), TP2596-背板(605×2463.8)
```

---

## 8. 技术栈

### 后端
| 技术 | 用途 |
|------|------|
| Python 3.14 | 主语言 |
| pandas + openpyxl | Excel 读写 |
| python-dotenv | 环境变量 |
| requests | HTTP (Telegram API) |
| supabase-py (可选) | Supabase SDK |

### 前端
| 技术 | 用途 |
|------|------|
| Next.js | React 框架 |
| TailwindCSS | 样式 |
| TypeScript | 类型安全 |
| Supabase JS SDK | 数据库 & 存储 |

### 基础设施
| 服务 | 用途 |
|------|------|
| Supabase | PostgreSQL + Storage + Realtime |
| Vercel | 前端部署 |
| Mac Studio (本地) | 后端 Pipeline 运行 |
| Telegram Bot | 生产通知 |
| Gmail IMAP | 邮件订单获取 |

---

## 9. 开发指南

### 9.1 本地开发环境

```bash
# 1. 克隆 & 进入项目
cd ~/Desktop/ai-factory

# 2. 激活虚拟环境
source venv/bin/activate

# 3. 安装依赖
pip install -r backend/requirements.txt

# 4. 配置环境变量
cp .env.example .env
# 编辑 .env 填入实际密钥

# 5. 运行 Pipeline (本地)
python3 main.py data/order1.xlsx
```

### 9.2 添加新 Agent

1. 在 `backend/agents/` 创建 `xxx_agent.py`
2. 实现 `run()` 函数作为入口
3. 在 `workflow_controller.py` 的 `_process_single_order()` 中添加对应 Stage
4. 处理错误和 `result["stages"]` 记录

### 9.3 修改裁切逻辑

裁切引擎的核心文件：
- `engine_agent.py` — 主流程 (`run_engine()`)
- `t0_optimizer.py` — T0 混排 (`optimize_t0_from_strips()`)

关键参数：
```python
TRIM_LOSS = 5.0    # 修边损耗
SAW_KERF  = 5.0    # 锯缝
BOARD_HEIGHT = 2438.4  # 板材长度 96″
STRIP_WIDTH_NARROW = 304.8  # 窄条料 12″
STRIP_WIDTH_WIDE   = 609.6  # 宽条料 24″
```

### 9.4 Job ID 命名规则

```
格式: {年-月-日}_{序号}
示例: 2026-04-17_1, 2026-04-17_2, ...
```

每天从 1 开始，自动递增，避免冲突。

### 9.5 常见问题排查

| 问题 | 原因 | 解决 |
|------|------|------|
| `ValueError: could not convert string to float` | 订单含英制分数(如 `26 3/16`) | `parse_imperial()` 已处理 |
| 零件 Width=0 或负值 | 订单中 D=0 | 自动使用柜型默认深度 |
| 零件超板被静默丢弃 | 旧版引擎没有检测超板 | 现已检测并报告到工单 |
| Telegram 404 | Bot Token 错误 | 检查 `.env` 中的 Token |
| `ModuleNotFoundError` | 未从项目根目录运行 | 必须 `cd ~/Desktop/ai-factory` 后再运行 |
| 审核 FAIL 导致无工单 | 超板零件触发 fail | 现改为 warning，不阻塞 |

---

## 10. 输出文件说明

Pipeline 成功后输出在 `output/{job_id}/` 目录：

| 文件 | 说明 |
|------|------|
| `*_worker_order.xlsx` | 工人裁切工单 (5个Sheet) |
| `*_parts.xlsx` | 拆单零件清单 |
| `*_inventory_check.xlsx` | 库存检查报告 |

`worker_order.xlsx` 的 Sheet 结构:

1. **裁切工单** — 板型 → 序号 → 零件部位信息 → 下刀长度 → Height → Width → 利用率
2. **物料领用单** — 板型 → 板材尺寸 → 领用数量 → 领用人 → 日期
3. **汇总信息** — 审核状态、总利用率、总零件数、总废料等
4. **T0裁切计划** — T0板号 → 裁切宽度 → 利用率 → 废料宽度
5. **⛔超板零件** — 柜号 → 零件 → 尺寸 → 超板原因 → 建议处理方式

---

## 11. 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v5 | 2026-04 | 统一命名 + T0 混排 + Gap-Fill + 超板检测 |
| v4 | 2026-04 | 真实工厂流程 (strip demand → inventory → T0) |
| v3 | 2026-04 | T0 优化器独立模块 + 剩料回收 |
| v2 | 2026-04 | cabinet_calculator 批量拆单 + 英制分数解析 |
| v1 | 2026-04 | 初版 Pipeline + Supabase 集成 |
