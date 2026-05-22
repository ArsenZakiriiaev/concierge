#!/usr/bin/env bash
# Start the Concierge backend for demo mode.
# Set ANTHROPIC_API_KEY before running.
set -e

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "ERROR: ANTHROPIC_API_KEY is not set."
  echo "  export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

cd "$(dirname "$0")"

echo "[concierge] building..."
TURBO_TELEMETRY_DISABLED=1 npx turbo run build --filter=@concierge/backend 2>/dev/null

echo "[concierge] starting backend on http://localhost:3000"
node apps/backend/dist/index.js
