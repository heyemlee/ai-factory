# AI Factory — ABC Cabinet 橱柜智能生产系统

从客户 Excel 订单自动生成工厂裁切方案：Dashboard 上传 → 本地后端轮询处理 → 结果写回 Supabase → 前端实时查看排版、机器裁切计划和库存变化。

## 架构

```
Frontend Dashboard
      │ 上传订单 Excel
      ▼
Supabase
  orders / storage / inventory / bom_history
      │ status=pending
      ▼
backend.core.cloud_controller
      ├── cabinet_calculator.py
      ├── cutting.efficient
      ├── cutting.stack
      └── cutting.t0
      │
      ▼
cut_result_json 写回 Supabase
```

前端负责订单上传、状态展示、库存配置和裁切结果查看。后端运行在工厂本地机器上，轮询 Supabase 并执行订单拆单和裁切优化。

## 快速开始

```bash
# 1. 安装后端依赖
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 Supabase key

# 3. 启动后端 + 前端
bash scripts/dev.sh

# 或只启动后端轮询
bash scripts/start_cloud.sh

# 或单次处理 pending 订单
python3 -m backend.core.cloud_controller
```

前端单独启动：

```bash
cd frontend
npm install
npm run dev
```

## 目录结构

```
ai-factory/
├── backend/
│   ├── cabinet_calculator.py          # Excel 订单解析，展开柜体零件
│   ├── core/
│   │   └── cloud_controller.py        # 后端主入口：轮询、处理、写回
│   ├── cutting/
│   │   ├── cutting_engine.py          # 兼容旧 import，转发到 cutting.efficient
│   │   ├── stack_efficiency_engine.py # 兼容旧 import，转发到 cutting.stack
│   │   ├── t0_optimizer.py            # 兼容旧 import，转发到 cutting.t0
│   │   ├── efficient/                 # 默认高利用率裁切策略
│   │   ├── stack/                     # 叠切优先策略
│   │   └── t0/                        # T0 原板混排、余料回收、计划汇总
│   ├── config/                        # Supabase、板材配置、日志、运行设置
│   └── tools/                         # email / telegram 备用工具
├── frontend/
│   └── src/
│       ├── app/                       # Next.js 路由
│       ├── features/orders/detail/    # 订单详情和工厂裁切 UI
│       ├── components/                # 通用组件
│       └── lib/                       # Supabase、i18n、订单动作
├── scripts/
│   ├── dev.sh                         # 后端轮询 + 前端 dev server
│   ├── start_cloud.sh                 # 仅启动后端轮询
│   └── setup_schema.py                # Supabase schema 一次性初始化工具
└── logs/
```

## 后端裁切模块

`cloud_controller.py` 会根据订单设置选择算法：

| 算法 | 入口 | 说明 |
|------|------|------|
| `efficient` | `cutting.efficient.run_engine()` | 默认策略，优先库存和材料利用率 |
| `stack_efficiency` | `cutting.stack.run_engine()` | 叠切优先，生成更适合机器批量输入的方案 |

旧路径仍可用：

```python
from cutting.cutting_engine import run_engine
from cutting.stack_efficiency_engine import run_engine
from cutting.t0_optimizer import optimize_t0_from_strips
```

这些旧文件现在只是小型兼容入口，核心实现已经拆到子包中。

## 板材体系

```
T0  原板   1219.2 × 2438.4 mm
 ↓ 沿宽度裁条
T1  条料   常用 303.8 mm / 608.6 mm
 ↓ 沿长度裁切
T2  零件   最终柜体板件
```

术语约定：

- `Height`：沿 2438.4 mm 长度方向
- `Width`：沿 1219.2 mm 宽度方向
- `TRIM_LOSS`：修边损耗
- `SAW_KERF`：锯缝

## 环境变量

复制 `.env.example` 为 `.env`，至少配置：

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | 前端 Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 前端 anon key |
| `SUPABASE_SERVICE_KEY` | 后端 service role key |
| `POLL_INTERVAL_SECONDS` | 后端轮询间隔，默认 30 秒 |
| `DEFAULT_BOX_COLOR` | 默认箱体颜色，默认 `WhiteBirch` |

可选：

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID |
| `EMAIL_USER` | Gmail 地址 |
| `EMAIL_PASS` | Gmail 应用密码 |
| `IMAP_SERVER` | IMAP server，默认 `imap.gmail.com` |

## 验证命令

```bash
python3 -m compileall backend scripts/setup_schema.py
python3 - <<'PY'
import sys
sys.path.insert(0, "backend")
from cutting.efficient import run_engine as efficient
from cutting.stack import run_engine as stack
from cutting.t0 import optimize_t0_from_strips
print(efficient.__name__, stack.__name__, optimize_t0_from_strips.__name__)
PY
cd frontend && npm run build
```
