#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://concierge:concierge@localhost:5432/concierge}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export CONCIERGE_TOKEN_KEY="${CONCIERGE_TOKEN_KEY:-0123456789abcdef0123456789abcdef}"
export CONCIERGE_API_KEY="${CONCIERGE_API_KEY:-local-demo-key}"
export CONCIERGE_API_URL="${CONCIERGE_API_URL:-http://localhost:3000}"
export CONCIERGE_PUBLIC_URL="${CONCIERGE_PUBLIC_URL:-http://localhost:3000}"
export CONCIERGE_AGENT_MODE="${CONCIERGE_AGENT_MODE:-demo}"
export RAILWAY_API_BASE_URL="${RAILWAY_API_BASE_URL:-http://localhost:4010}"
export PORT="${PORT:-3000}"

echo "[demo] starting Postgres and Redis"
docker compose up -d db redis
until docker compose exec -T db pg_isready -U concierge -q; do sleep 1; done

echo "[demo] building workspaces"
npm run build

echo "[demo] starting mock Railway API on ${RAILWAY_API_BASE_URL}"
PORT=4010 npm --workspace @concierge/mock-railway run start &
mock_pid=$!
trap 'kill "$mock_pid" 2>/dev/null || true' EXIT

echo "[demo] Concierge backend: ${CONCIERGE_API_URL}"
echo "[demo] Claude Desktop MCP command:"
echo "       node $(pwd)/packages/mcp-server/dist/index.js"
echo "[demo] Claude Desktop MCP env:"
echo "       CONCIERGE_API_URL=${CONCIERGE_API_URL}"
echo "       CONCIERGE_API_KEY=${CONCIERGE_API_KEY}"

npm --workspace @concierge/backend run start
