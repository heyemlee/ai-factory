#!/bin/zsh
# OpenClaw — Cloud Order Poller (生产环境)
# 用法: bash scripts/start_cloud.sh（从项目根目录运行）

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

source venv/bin/activate

echo "═══════════════════════════════════════"
echo "  🏭 OpenClaw Cloud Controller"
echo "  📡 Polling Supabase every 30s..."
echo "  Press Ctrl+C to stop"
echo "═══════════════════════════════════════"

python3 -m backend.core.cloud_controller --poll
