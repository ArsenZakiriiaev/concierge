#!/usr/bin/env bash
# One command to run the full Concierge demo stack.
# Usage: ./dev.sh
set -e

cd "$(dirname "$0")"

# 1. Start postgres + pgvector and Redis
echo "[dev] starting database and redis..."
docker compose up -d db redis
echo "[dev] waiting for postgres to be ready..."
until docker compose exec -T db pg_isready -U concierge -q; do sleep 1; done
echo "[dev] postgres ready."

# 2. Build all packages
echo "[dev] building packages..."
TURBO_TELEMETRY_DISABLED=1 npx turbo run build --filter=@concierge/backend --filter=@concierge/agent-runtime 2>/dev/null

# 3. Start the backend (runs migrations + seed on startup)
echo "[dev] starting backend..."
export DATABASE_URL="${DATABASE_URL:-postgresql://concierge:concierge@localhost:5432/concierge}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
node apps/backend/dist/index.js
