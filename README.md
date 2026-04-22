# AI Factory — ABC Cabinet 橱柜智能生产系统

从客户 Excel 订单自动生成裁切优化方案：Dashboard 上传 → AI 排版计算 → 结果实时展示。

## 架构

```
Dashboard (Vercel)
      │  上传订单 Excel
      ▼
   Supabase                         本地工厂 Mac
  ┌─────────┐   status=pending   ┌─────────────────────────┐
  │ orders  │ ◄────────────────► │   cloud_controller.py   │
  │inventory│                   │                         │
  │cut_stats│   结果写回          │  cabinet_calculator.py  │
  │bom_hist │ ◄────────────────  │  engine_agent.py        │
  └─────────┘                   │  t0_optimizer.py        │
                                └─────────────────────────┘
```

**前端**（Next.js / Vercel）负责订单上传、结果展示、库存管理。  
**后端**（本地 Mac）轮询 Supabase，处理订单，结果写回 Supabase。

## 快速开始

```bash
# 1. 创建并激活虚拟环境
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 Supabase / Telegram 密钥

# 3. 一键启动（后端轮询 + 前端 Dashboard）
bash scripts/dev.sh

# 或仅启动后端
bash scripts/start_cloud.sh
```

## 目录结构

```
ai-factory/
├── backend/
│   ├── cabinet_calculator.py   # 订单拆单（英制 → mm → 零件列表）
│   ├── agents/
│   │   ├── engine_agent.py     # FFD 裁切优化引擎
│   │   ├── t0_optimizer.py     # T0 大板混排优化
│   │   └── notifier_agent.py   # Telegram 通知（备用）
│   ├── core/
│   │   └── cloud_controller.py # Supabase 轮询 + Pipeline 入口
│   ├── config/                 # 配置、日志、Supabase 客户端
│   └── tools/                  # email_reader、telegram_notifier
├── frontend/                   # Next.js Dashboard（Vercel 部署）
├── data/
│   └── t1_inventory.xlsx       # T1 条料本地库存参照
├── scripts/
│   ├── dev.sh                  # 一键启动（后端 + 前端）
│   └── start_cloud.sh          # 仅启动后端轮询
└── logs/                       # 运行日志
```

## 板材体系

```
T0  原板   1219.2 × 2438.4 mm (48″ × 96″)
 ↓ 沿宽度裁切
T1  条料   304.8 mm (12″) 或 609.6 mm (24″) 宽
 ↓ 沿长度裁切
T2  零件   最终板件（侧板、顶板、底板…）
```

尺寸术语：**Height**（沿 2438.4mm 轴）、**Width**（沿 1219.2mm 轴）。

## 环境变量

复制 `.env.example` 为 `.env`，填入以下内容：

| 变量 | 说明 |
|------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_KEY` | Supabase service role key（后端用） |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（可选） |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID（可选） |
| `EMAIL_USER` | Gmail 地址（可选） |
| `EMAIL_PASS` | Gmail 应用密码（可选） |

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Next.js 16 / React 19 / TailwindCSS / TypeScript |
| 数据库 | Supabase（PostgreSQL + Storage + Realtime） |
| 后端 | Python 3.14 / pandas / openpyxl |
| 部署 | Vercel（前端）/ 本地 Mac（后端轮询） |
| 通知 | Telegram Bot（备用） |
