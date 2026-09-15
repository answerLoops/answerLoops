#!/usr/bin/env bash
# Polls the app service's /api/health endpoint until it responds 200 (app up,
# migrations applied) or a timeout elapses. Used after `docker compose up -d`
# so the calling skill can tell the difference between "still starting" and
# "actually failed to start" instead of guessing from a fixed sleep.
set -euo pipefail

URL="${1:-http://localhost:3000/api/health}"
TIMEOUT_SECONDS="${2:-120}"
INTERVAL_SECONDS=3
elapsed=0

echo "Waiting for $URL to become healthy (timeout ${TIMEOUT_SECONDS}s)..."

while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do
  if curl -fsS -o /dev/null "$URL" 2>/dev/null; then
    echo "✓ healthy after ${elapsed}s"
    exit 0
  fi
  sleep "$INTERVAL_SECONDS"
  elapsed=$((elapsed + INTERVAL_SECONDS))
done

echo "✗ still unhealthy after ${TIMEOUT_SECONDS}s"
echo "Check logs: docker compose -f docker-compose.ghcr.yml logs app -f"
exit 1
