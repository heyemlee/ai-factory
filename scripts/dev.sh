#!/bin/zsh

# ── AI Factory 本地开发启动脚本 ──
# 用法: bash scripts/dev.sh（从项目根目录运行）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── 1. 清理残留进程 ──
# 杀掉所有残留的 cloud_controller 进程（防止旧代码进程抢订单）
EXISTING_CC=$(pgrep -f "backend.core.cloud_controller" 2>/dev/null)
if [ ! -z "$EXISTING_CC" ]; then
  echo "🧹 Killing existing cloud_controller processes: $EXISTING_CC"
  echo "$EXISTING_CC" | xargs kill 2>/dev/null
  sleep 1
fi

# 清理端口 3000 占用
PORT=3000
PID=$(lsof -ti :$PORT 2>/dev/null)
if [ ! -z "$PID" ]; then
  echo "🧹 Killing process $PID using port $PORT"
  kill -9 $PID 2>/dev/null
fi

echo "🚀 Starting AI Factory Ecosystem..."

# ── 2. 启动后端 Cloud Controller (后台运行) ──
mkdir -p logs
echo "📡 Starting Backend Cloud Controller (Polling Supabase)..."
python3 -m backend.core.cloud_controller --poll > logs/cloud_controller.log 2>&1 &
BACKEND_PID=$!
echo "   Backend PID: $BACKEND_PID"

# ── 3. 注册退出清理（必须在 npm run dev 之前！）──
cleanup() {
  echo ""
  echo "🛑 Shutting down..."
  # 杀掉本次启动的后端进程
  kill $BACKEND_PID 2>/dev/null
  # 也杀掉任何可能的残留（保险）
  pgrep -f "backend.core.cloud_controller" 2>/dev/null | xargs kill 2>/dev/null
  echo "✅ All processes stopped."
}
trap cleanup EXIT INT TERM

# ── 4. 启动前端（前台阻塞）──
echo "🌐 Starting Frontend Dashboard on http://localhost:3000..."
cd frontend && npm run dev
