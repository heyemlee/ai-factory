# 🏭 AI Factory — 橱柜智能生产系统

一体化橱柜生产 Pipeline：从订单 Excel → 自动拆单 → 裁切优化 → 工单生成 → 库存管理。

## 目录结构

```
ai-factory/
├── main.py                 # 本地 Pipeline 入口
├── backend/                # 后端核心引擎
│   ├── cabinet_calculator.py   # 橱柜尺寸计算器
│   ├── agents/                 # 各功能 Agent
│   ├── core/                   # Pipeline 控制器
│   ├── config/                 # 配置中心
│   └── tools/                  # 工具模块
├── frontend/               # Next.js Dashboard（Vercel 部署）
├── scripts/                # 运维启动脚本
├── tests/                  # 测试数据
├── docs/                   # 项目文档
├── data/                   # 运行时数据（gitignore）
├── output/                 # 裁切输出（gitignore）
├── archive/                # 已处理订单归档
├── logs/                   # 日志
└── .env                    # 环境变量（gitignore）
```

## 快速开始

### 环境准备

```bash
cd ~/Desktop/ai-factory
source venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env   # 编辑填入实际密钥
```

### 🔧 本地测试模式（手动跑单个订单）

```bash
source venv/bin/activate
python3 main.py data/order.xlsx
# 或使用测试数据
python3 main.py tests/fixtures/test_order.xlsx
```

Pipeline 自动执行：拆单 → 裁切优化 → Excel报告 → 审核 → 库存检查 → 工单生成 → Telegram通知 → 归档

输出在 `output/{日期_序号}/` 目录下。

### 🚀 生产环境模式（Cloud + Dashboard）

```bash
# 方式1: 一键启动（后端 + 前端）
bash scripts/dev.sh

# 方式2: 仅启动后端轮询
bash scripts/start_cloud.sh
```

生产模式下，系统自动从 Supabase 拉取 Dashboard 上传的订单并处理。

## 文档

- [开发者技术文档](docs/developer_guide.md) — 系统设计、Pipeline 详解、开发指南
- [操作指南](docs/operation_guide.md) — 日常操作详细说明
- [架构说明](docs/architecture.md) — 系统架构与数据流
