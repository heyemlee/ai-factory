"""
橱柜工厂 AI 系统 — 日志配置

统一日志格式，同时输出到 console 和 logs/ 目录文件。
"""

import logging
import sys
from datetime import datetime
from config.settings import LOGS_DIR


def setup_logger(name: str = "ai-factory", level=logging.INFO) -> logging.Logger:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger(name)

    # 避免重复添加 handler
    if logger.handlers:
        return logger

    logger.setLevel(level)

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # ── Console Handler ──
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # ── File Handler（按天轮转）──
    today = datetime.now().strftime("%Y-%m-%d")
    log_file = LOGS_DIR / f"{name}_{today}.log"

    file_handler = logging.FileHandler(log_file, encoding="utf-8")
    file_handler.setLevel(level)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger


def get_logger(name: str) -> logging.Logger:
    """获取已存在的 logger，如果不存在则创建"""
    logger = logging.getLogger(name)
    if not logger.handlers:
        return setup_logger(name)
    return logger
