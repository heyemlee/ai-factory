"""
橱柜工厂 AI 系统 — 集中配置中心
"""

import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent

# ── Gmail IMAP ──────────────────────────────
EMAIL_USER = os.getenv("EMAIL_USER", "")
EMAIL_PASS = os.getenv("EMAIL_PASS", "")
IMAP_SERVER = os.getenv("IMAP_SERVER", "imap.gmail.com")

# ── Telegram Bot ────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# ── 文件路径 ────────────────────────────────
LOGS_DIR = PROJECT_ROOT / "logs"

# ── 工厂参数 ────────────────────────────────
PANEL_THICKNESS = int(os.getenv("PANEL_THICKNESS", "18"))   # mm
TRIM_LOSS = int(os.getenv("TRIM_LOSS", "5"))                # mm
SAW_KERF = int(os.getenv("SAW_KERF", "5"))                  # mm

# ── Box color defaults ─────────────────────
DEFAULT_BOX_COLOR = os.getenv("DEFAULT_BOX_COLOR", "WhiteBirch")
