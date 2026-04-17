# 系统架构

## 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    用户/浏览器                        │
│                  Vercel Dashboard                    │
│            (Next.js Frontend @ /frontend)            │
└──────────────────────┬──────────────────────────────┘
                       │ REST API
                       ▼
              ┌─────────────────┐
              │    Supabase     │
              │  ┌───────────┐  │
              │  │  orders   │  │  ← 订单队列 (pending/processing/completed)
              │  │ inventory │  │  ← 库存数据
              │  │bom_history│  │  ← BOM 消耗历史
              │  │  Storage  │  │  ← 订单 Excel 文件
              │  └───────────┘  │
              └────────┬────────┘
                       │ Polling (30s)
                       ▼
┌─────────────────────────────────────────────────────┐
│              本地工厂 PC (OpenClaw)                   │
│                                                      │
│  cloud_controller.py ──→ 拉取 Pending 订单            │
│         │                                            │
│         ▼                                            │
│  ┌────────────────────────────────────────────┐      │
│  │           Pipeline (workflow_controller)    │      │
│  │                                            │      │
│  │  1. cabinet_calculator  (拆单)             │      │
│  │  2. engine_agent        (裁切优化)         │      │
│  │  3. t0_optimizer        (T0混排优化)       │      │
│  │  4. audit_agent         (质量审核)         │      │
│  │  5. inventory_agent     (库存扣减)         │      │
│  │  6. production_agent    (工单生成)         │      │
│  │  7. notifier_agent      (Telegram通知)     │      │
│  │  8. bom_history         (历史记录)         │      │
│  └────────────────────────────────────────────┘      │
│         │                                            │
│         ▼                                            │
│  output/{job_id}/  →  worker_order.xlsx 工人工单      │
└─────────────────────────────────────────────────────┘
```

## 两种运行模式

### 本地测试模式
```
Excel 文件 → main.py → workflow_controller.run_pipeline() → output/
```
- 入口：`main.py`
- 数据源：本地 `data/order.xlsx` 或指定文件
- 库存源：本地 `data/t1_inventory.xlsx` + Supabase
- 适合：调试、开发、手动跑订单

### 生产 Cloud 模式
```
Dashboard 上传 → Supabase → cloud_controller.py 轮询 → Pipeline → 结果回写 Supabase
```
- 入口：`scripts/start_cloud.sh` 或 `scripts/dev.sh`
- 数据源：Supabase Storage
- 库存源：Supabase `inventory` 表
- 适合：日常生产使用

## Agent 职责

| Agent | 文件 | 职责 |
|-------|------|------|
| Brain | `brain_agent.py` | 解析订单 Excel，提取橱柜参数 |
| Engine | `engine_agent.py` | 一维裁切优化，匹配板型 |
| T0 Optimizer | `t0_optimizer.py` | T0 大板混合排列优化 |
| Audit | `audit_agent.py` | 校验裁切方案质量 |
| Inventory | `inventory_agent.py` | 库存检查与扣减 |
| Production | `production_agent.py` | 生成工人操作工单 Excel |
| Notifier | `notifier_agent.py` | Telegram 消息推送 |
| Orchestrator | `orchestrator_agent.py` | Agent 调度编排 |

## 配置管理

所有配置集中在 `backend/config/settings.py`，通过 `.env` 文件加载：
- 邮件配置（Gmail IMAP）
- Telegram Bot
- 工厂参数（板厚、锯缝等）
- Supabase 连接
