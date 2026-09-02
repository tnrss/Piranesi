#!/usr/bin/env bash
set -euo pipefail

URL="${PIRANESI_URL:-http://127.0.0.1:8000}"
for _ in $(seq 1 60); do
  if curl --silent --fail "$URL/api/health" >/dev/null; then
    break
  fi
  sleep 1
done
curl --silent --fail "$URL/api/health" >/dev/null

if command -v chromium >/dev/null 2>&1; then
  BROWSER=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
  BROWSER=chromium-browser
else
  echo "Chromium is not installed." >&2
  exit 1
fi

PROFILE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/piranesi-kiosk"
mkdir -p "$PROFILE_DIR"
exec "$BROWSER" \
  --kiosk \
  --no-first-run \
  --no-default-browser-check \
  --disable-session-crashed-bubble \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --user-data-dir="$PROFILE_DIR" \
  "$URL"