#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

docker compose up -d db
until docker compose exec -T db pg_isready -U concierge -q; do sleep 1; done
docker compose exec -T db psql -U concierge -d concierge < scripts/reset-demo-db.sql
echo "[demo] database reset"
