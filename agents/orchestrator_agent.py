"""
Orchestrator Agent — 定时调度 + Pipeline 入口

功能：
  1. 定时轮询（默认 5 分钟）检查邮件中的新订单
  2. 调用 Workflow Controller 处理订单
  3. 防止重复执行（锁机制）
  4. 也支持手动执行单个订单
"""

import os
import sys
import time
import json
import signal

from config.settings import POLL_INTERVAL_MINUTES, OUTPUT_DIR, ensure_directories
from config.logger import get_logger
from core.workflow_controller import run_pipeline

log = get_logger("orchestrator")

# ── 简单文件锁，防止重复执行 ──
LOCK_FILE = str(OUTPUT_DIR / ".orchestrator.lock")
_running = True


def _signal_handler(signum, frame):
    """优雅退出"""
    global _running
    log.info("收到退出信号，正在停止...")
    _running = False


def _acquire_lock() -> bool:
    """获取锁"""
    if os.path.exists(LOCK_FILE):
        # 检查锁是否过期（超过 30 分钟认为是残留锁）
        try:
            mtime = os.path.getmtime(LOCK_FILE)
            if time.time() - mtime > 1800:
                os.remove(LOCK_FILE)
                log.warning("清除过期锁文件")
            else:
                return False
        except Exception:
            return False

    with open(LOCK_FILE, "w") as f:
        f.write(str(os.getpid()))
    return True


def _release_lock():
    """释放锁"""
    try:
        if os.path.exists(LOCK_FILE):
            os.remove(LOCK_FILE)
    except Exception:
        pass


def run_once(order_path: str = None):
    """单次执行 Pipeline"""
    if not _acquire_lock():
        log.warning("另一个 Pipeline 正在运行，跳过")
        return None

    try:
        result = run_pipeline(order_path=order_path)
        return result
    finally:
        _release_lock()


def run_scheduler():
    """定时轮询调度器"""
    global _running

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    ensure_directories()
    interval = POLL_INTERVAL_MINUTES * 60

    log.info(f"{'=' * 50}")
    log.info(f"🏭 橱柜工厂 AI 调度器启动")
    log.info(f"   轮询间隔: {POLL_INTERVAL_MINUTES} 分钟")
    log.info(f"{'=' * 50}")

    while _running:
        log.info(f"🔄 轮询检查新订单...")

        try:
            result = run_once()
            if result:
                status = result.get("status", "unknown")
                if status == "no_orders":
                    log.info("📭 没有新订单")
                else:
                    log.info(f"✅ 轮询完成: {status}")
        except Exception as e:
            log.error(f"❌ 轮询异常: {e}")

        if _running:
            log.info(f"⏳ 等待 {POLL_INTERVAL_MINUTES} 分钟后再次检查...")
            # 分段 sleep 以便响应退出信号
            for _ in range(interval):
                if not _running:
                    break
                time.sleep(1)

    log.info("🛑 调度器已停止")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        # 手动执行: python orchestrator_agent.py <order_file>
        result = run_once(order_path=sys.argv[1])
        if result:
            print(json.dumps(result, indent=2, ensure_ascii=False, default=str))
    else:
        # 调度模式
        run_scheduler()