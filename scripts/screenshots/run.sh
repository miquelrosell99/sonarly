#!/usr/bin/env bash
# One-shot screenshot capture: seeds a synthetic library, boots the Sonarly
# image in a throwaway container on 127.0.0.1:4535, captures UI screenshots
# into docs/img/screenshots/. Never touches the live sonarly container/volumes.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/../.." && pwd)"
PORT="${PORT:-4535}"
IMAGE="${SONARLY_IMAGE:-ghcr.io/miquelrosell99/sonarly:2.1.1}"
RUNTIME="$DIR/.runtime"
LIB="$RUNTIME/library"
DB="$RUNTIME/db"
OUT="$REPO_ROOT/docs/img/screenshots"

if [ "${KEEP_RUNTIME:-0}" != "1" ]; then
  rm -rf "$RUNTIME"
fi
mkdir -p "$DB" "$OUT"

if [ ! -d "$LIB" ] || [ -z "$(ls -A "$LIB" 2>/dev/null)" ]; then
  echo ">> seeding synthetic library..."
  bash "$DIR/seed-library.sh" "$LIB"
fi

cd "$DIR"
if [ ! -d node_modules ]; then
  echo ">> installing playwright package (browser already in ~/.cache/ms-playwright)..."
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund
fi

SECRET="$(openssl rand -hex 32)"

cleanup() { docker rm -f sonarly-screenshots >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo ">> starting throwaway container on 127.0.0.1:$PORT ($IMAGE)"
docker run -d --name sonarly-screenshots --rm \
  -p "127.0.0.1:${PORT}:3000" \
  -v "$LIB:/media/music:ro" \
  -v "$DB:/data/db" \
  -e SONARLY_ADDR=:3000 \
  -e SESSION_SECRET="$SECRET" \
  -e SONARLY_DB_PATH=/data/db/sonarly.db \
  -e SONARLY_DATA_DIR=/data/db \
  -e SONARLY_LIBRARY_PATH=/media/music \
  -e SONARLY_WEB_DIST=/app/web-dist \
  "$IMAGE" >/dev/null

echo ">> waiting for /healthz..."
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:${PORT}/healthz" >/dev/null

BASE_URL="http://127.0.0.1:${PORT}" OUT_DIR="$OUT" node capture.mjs
echo ">> screenshots in $OUT"
