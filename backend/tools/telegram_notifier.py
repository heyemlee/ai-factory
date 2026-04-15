"""
Telegram 通知工具

支持发送文本消息和文件。使用 config/settings.py 中的凭据配置。
"""

import requests

from config.settings import TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
from config.logger import get_logger

log = get_logger("telegram_notifier")


def send_message(text: str, chat_id: str = None) -> bool:
    """发送文本消息到 Telegram"""
    token = TELEGRAM_BOT_TOKEN
    cid = chat_id or TELEGRAM_CHAT_ID

    if not token or not cid:
        log.warning("Telegram 未配置 (缺少 BOT_TOKEN 或 CHAT_ID)，跳过通知")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = {"chat_id": cid, "text": text, "parse_mode": "Markdown"}

    try:
        resp = requests.post(url, data=data, timeout=10)
        if resp.ok:
            log.info(f"Telegram 消息已发送: {text[:50]}...")
            return True
        else:
            log.error(f"Telegram 发送失败: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        log.error(f"Telegram 发送异常: {e}")
        return False


def send_file(filepath: str, caption: str = "", chat_id: str = None) -> bool:
    """发送文件到 Telegram（如 Excel 工单）"""
    token = TELEGRAM_BOT_TOKEN
    cid = chat_id or TELEGRAM_CHAT_ID

    if not token or not cid:
        log.warning("Telegram 未配置，跳过文件发送")
        return False

    url = f"https://api.telegram.org/bot{token}/sendDocument"

    try:
        with open(filepath, "rb") as f:
            resp = requests.post(
                url,
                data={"chat_id": cid, "caption": caption},
                files={"document": f},
                timeout=30,
            )
        if resp.ok:
            log.info(f"Telegram 文件已发送: {filepath}")
            return True
        else:
            log.error(f"Telegram 文件发送失败: {resp.status_code}")
            return False
    except Exception as e:
        log.error(f"Telegram 文件发送异常: {e}")
        return False