#!/bin/zsh

# ── AI Factory 本地开发启动脚本 ──
# 用法: bash scripts/dev.sh（从项目根目录运行）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# 1. 清理可能残留的端口占用 (3000端口)
PORT=3000
PID=$(lsof -ti :$PORT)
if [ ! -z "$PID" ]; then
  echo "Found process $PID using port $PORT. Killing it..."
  kill -9 $PID
fi

echo "🚀 Starting AI Factory Ecosystem..."

# 2. 启动后端 Cloud Controller (后台运行)
echo "📡 Starting Backend Cloud Controller (Polling Supabase)..."
python3 -m backend.core.cloud_controller --poll > logs/cloud_controller.log 2>&1 &
BACKEND_PID=$!

# 3. 启动前端
echo "🌐 Starting Frontend Dashboard on http://localhost:3000..."
cd frontend && npm run dev

# 退出时同时杀掉后端进程
trap "kill $BACKEND_PID" EXIT
