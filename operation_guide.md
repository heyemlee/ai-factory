# 🏭 橱柜工厂 AI 系统 — 操作指南

---

## 一、首次配置（只需做一次）

### 1. 配置环境变量

编辑项目根目录的 [.env](file:///Users/abcabinet/Desktop/ai-factory/.env) 文件：

```bash
cd ~/Desktop/ai-factory
nano .env
```

填入以下内容：

```env
# Gmail（已配置）
EMAIL_USER=orders@abcabinet.us
EMAIL_PASS=你的Gmail应用密码
IMAP_SERVER=imap.gmail.com

# Telegram（必填）
TELEGRAM_BOT_TOKEN=7984528587:AAEWURWr_a9IC2plXaol440QLpwaGrAKg-c
TELEGRAM_CHAT_ID=你的聊天ID
```

> **获取 Chat ID**: 给 Bot 发一条消息，然后访问 `https://api.telegram.org/bot<TOKEN>/getUpdates`，在返回的 JSON 中找 `chat.id`。

### 2. 验证安装

```bash
cd ~/Desktop/ai-factory
source venv/bin/activate
python3 -c "from config.settings import *; print('✅ 配置正常')"
```

---

## 二、日常使用

### 场景 A：手动处理一个订单 ⭐ 最常用

```bash
cd ~/Desktop/ai-factory && source venv/bin/activate

# 处理 data/ 下的订单
python3 main.py data/order.xlsx
```

系统会自动执行 **8 个步骤**：
```
📋 拆单 → ✂️ 裁切优化 → 📊 Excel报告 → 🔍 审核
→ 📦 库存检查 → 📋 工单生成 → 📱 Telegram通知 → 📁 归档
```

完成后查看输出：
```bash
# 输出文件在 output/{job_id}/ 目录下
ls output/
```

### 场景 B：处理邮件中的新订单

```bash
cd ~/Desktop/ai-factory && source venv/bin/activate

# 先下载邮件附件
python3 tools/email_reader.py

# 然后处理下载的订单
python3 main.py incoming_orders/xxx_order.xlsx
```

### 场景 C：自动模式（每 5 分钟检查邮件）

```bash
cd ~/Desktop/ai-factory && source venv/bin/activate

# 启动（Ctrl+C 停止）
python3 main.py
```

### 场景 D：只运行某个步骤

```bash
cd ~/Desktop/ai-factory && source venv/bin/activate

# 只拆单
python3 agents/brain_agent.py

# 只裁切优化
python3 agents/engine_agent.py

# 只审核
python3 agents/audit_agent.py

# 只检查库存
python3 agents/inventory_agent.py

# 只生成工单
python3 agents/production_agent.py

# 查看 BOM 历史统计
python3 -c "
from core.bom_history import get_monthly_stats
import json
print(json.dumps(get_monthly_stats(), indent=2, ensure_ascii=False))
"
```

---

## 三、通过 Telegram Bot 使用

给 `abc-assitant` Bot 发消息即可（中文交流）：

| 说什么 | Bot 会做什么 |
|--------|-------------|
| "处理新订单" | 运行完整 Pipeline |
| "检查库存" | 查看 T1 板库存 |
| "查看裁切结果" | 显示最近裁切统计 |
| "BOM 统计" | 显示月均消耗 |

---

## 四、输出文件说明

每次处理订单后，输出在 `output/{job_id}/` 目录：

| 文件 | 内容 | 给谁看 |
|------|------|--------|
| [parts.xlsx](file:///Users/abcabinet/Desktop/ai-factory/data/parts.xlsx) | 零件清单 | 检查拆单结果 |
| [cut_result.json](file:///Users/abcabinet/Desktop/ai-factory/output/cut_result.json) | 裁切方案（机器可读） | 程序内部 |
| [cut_result.xlsx](file:///Users/abcabinet/Desktop/ai-factory/output/cut_result.xlsx) | 裁切报告（2 Sheet） | 管理者/工人 |
| `audit.json` | 审核结果 | 管理者 |
| `inventory_check.json` | 库存检查 | 采购员 |
| `worker_order.xlsx` | **工人操作工单** ⭐ | **工人** |

### worker_order.xlsx 包含 3 个 Sheet：

1. **裁切工单** — 每张板怎么切（零件编号、尺寸、排列顺序）
2. **物料领用单** — 需要领多少板材（板型、数量、领用人签字栏）
3. **汇总信息** — 总零件数、用板数、利用率、生成时间

---

## 五、数据文件位置

```
ai-factory/
├── data/
│   ├── order.xlsx            ← 默认订单（测试用）
│   ├── t1_inventory.xlsx     ← T1 板库存（需要手动更新）
│   └── bom_history.jsonl     ← 自动累积的历史消耗数据
├── incoming_orders/          ← 邮件下载的订单
├── output/{job_id}/          ← 每个订单的输出
├── archive/                  ← 已处理的订单备份
├── failed_orders/            ← 处理失败的订单 + 错误原因
└── logs/                     ← 日志文件（按天存储）
```

### ⚠️ 需要手动维护的文件

**[data/t1_inventory.xlsx](file:///Users/abcabinet/Desktop/ai-factory/data/t1_inventory.xlsx)** — 当收到新的板材后，更新这个文件：

| board_type | Height | Depth | qty |
|------------|--------|-------|-----|
| T1-610*2440 | 2440 | 285.8 | 100 |
| T1-1220*2440 | 2440 | 590.6 | 100 |

---

## 六、常见问题

### Q: Pipeline 中途失败怎么办？
查看 `logs/` 目录下的日志文件，或 `failed_orders/` 下的错误报告：
```bash
cat failed_orders/*_error.txt
```

### Q: 审核不通过（status: fail）？
说明有零件无法匹配板型。检查 `audit.json` 中的 `recommendations`，通常需要在 [t1_inventory.xlsx](file:///Users/abcabinet/Desktop/ai-factory/data/t1_inventory.xlsx) 中添加对应 Depth 的板型。

### Q: 库存告警但实际有货？
更新 [data/t1_inventory.xlsx](file:///Users/abcabinet/Desktop/ai-factory/data/t1_inventory.xlsx) 中的 `qty` 列为实际库存数量。

### Q: Telegram 不发消息？
检查 [.env](file:///Users/abcabinet/Desktop/ai-factory/.env) 中的 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID` 是否正确。测试：
```bash
cd ~/Desktop/ai-factory && source venv/bin/activate
python3 -c "from tools.telegram_notifier import send_message; send_message('测试')"
```

### Q: 如何更换板材参数？
编辑 [.env](file:///Users/abcabinet/Desktop/ai-factory/.env) 文件中的工厂参数：
```env
PANEL_THICKNESS=18   # 板厚 (mm)
TRIM_LOSS=5          # 修边损耗 (mm)
SAW_KERF=5           # 锯缝 (mm)
```

---

## 七、命令速查表

```bash
# === 进入环境 ===
cd ~/Desktop/ai-factory && source venv/bin/activate

# === 核心命令 ===
python3 main.py order.xlsx     # 处理指定订单
python3 main.py                # 自动轮询模式

# === 单步命令 ===
python3 tools/email_reader.py  # 下载邮件订单
python3 agents/brain_agent.py  # 拆单
python3 agents/engine_agent.py # 裁切优化
python3 agents/audit_agent.py  # 审核
python3 agents/inventory_agent.py  # 库存检查
python3 agents/production_agent.py # 生成工单

# === 查看数据 ===
cat data/bom_history.jsonl     # BOM 历史
cat logs/*.log                 # 今日日志
ls output/                     # 所有输出
ls archive/                    # 已归档订单
```
