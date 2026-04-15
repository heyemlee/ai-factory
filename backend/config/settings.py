"""
橱柜工厂 AI 系统 — 集中配置中心

所有配置项统一从环境变量 (.env) 或默认值读取。
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# ── 加载 .env 文件 ──────────────────────────
# settings.py 位于 backend/config/，需要上溯 3 级到 ai-factory/
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

# ── 项目根目录 ──────────────────────────────
# backend/config/settings.py → parent(config) → parent(backend) → parent(ai-factory)
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# ── Gmail IMAP ──────────────────────────────
EMAIL_USER = os.getenv("EMAIL_USER", "")
EMAIL_PASS = os.getenv("EMAIL_PASS", "")
IMAP_SERVER = os.getenv("IMAP_SERVER", "imap.gmail.com")

# ── Telegram Bot ────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# ── 文件路径 ────────────────────────────────
INCOMING_ORDERS_DIR = PROJECT_ROOT / "incoming_orders"
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"
ARCHIVE_DIR = PROJECT_ROOT / "archive"
FAILED_ORDERS_DIR = PROJECT_ROOT / "failed_orders"
LOGS_DIR = PROJECT_ROOT / "logs"

# ── 工厂参数 ────────────────────────────────
PANEL_THICKNESS = int(os.getenv("PANEL_THICKNESS", "18"))   # mm, 板材厚度
TRIM_LOSS = int(os.getenv("TRIM_LOSS", "5"))                # mm, 修边损耗
SAW_KERF = int(os.getenv("SAW_KERF", "5"))                  # mm, 锯缝

# ── 库存参数 ────────────────────────────────
SAFETY_STOCK_THRESHOLD = int(os.getenv("SAFETY_STOCK_THRESHOLD", "10"))  # 安全库存阈值(张)
PROCUREMENT_LEAD_DAYS = int(os.getenv("PROCUREMENT_LEAD_DAYS", "7"))     # 采购周期(天)
LOGISTICS_DAYS = int(os.getenv("LOGISTICS_DAYS", "3"))                    # 物流时间(天)

# ── 调度参数 ────────────────────────────────
POLL_INTERVAL_MINUTES = int(os.getenv("POLL_INTERVAL_MINUTES", "5"))

# ── 数据文件路径 ────────────────────────────
INVENTORY_FILE = DATA_DIR / "t1_inventory.xlsx"
DEFAULT_ORDER_FILE = DATA_DIR / "order.xlsx"
DEFAULT_PARTS_FILE = DATA_DIR / "parts.xlsx"


def ensure_directories():
    """创建所有必要的目录"""
    for d in [INCOMING_ORDERS_DIR, DATA_DIR, OUTPUT_DIR,
              ARCHIVE_DIR, FAILED_ORDERS_DIR, LOGS_DIR]:
        d.mkdir(parents=True, exist_ok=True)


def generate_job_id(order_filename: str = "") -> str:
    """生成唯一 job_id: 日期序号_订单名"""
    import time
    import re
    from datetime import datetime
    
    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    
    if order_filename:
        name = Path(order_filename).stem
        # 去除所有已有的 Unix 时间戳或日期前缀，避免重复叠加
        import re
        while True:
            new_name = re.sub(r'^\d{4}-\d{2}-\d{2}(_\d{6})?_', '', name)
            new_name = re.sub(r'^\d{10}_', '', new_name)
            if new_name == name:
                break
            name = new_name
            
        base_id = f"{date_str}_{name}"
    else:
        base_id = f"{date_str}_manual"
    
    # 检查该日期是否已有同名 job_id，如果有则加序号
    job_dir = OUTPUT_DIR / base_id
    count = 1
    while job_dir.exists():
        suffix = f"_{count}"
        job_dir = OUTPUT_DIR / f"{date_str}{suffix}" / base_id if count > 1 else job_dir
        count += 1
    
    if count > 1:
        return f"{date_str}{count}_{name}"
    return base_id


def get_job_output_dir(job_id: str) -> Path:
    """获取某个 job 的输出目录"""
    job_dir = OUTPUT_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir
