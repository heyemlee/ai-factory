#!/bin/zsh

# ── AI Factory backend-only launcher ──
# Usage: bash scripts/start_cloud.sh (run from project root)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

mkdir -p logs

echo "📡 Starting Backend Cloud Controller (Polling Supabase)..."
python3 -m backend.core.cloud_controller --poll
