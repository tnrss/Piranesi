#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"
VENV_DIR="$PROJECT_DIR/venv"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Piranesi virtual environment not found at $VENV_DIR"
  exit 1
fi

(cd "$BACKEND_DIR" && "$VENV_DIR/bin/alembic" upgrade head)

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Installing frontend dependencies..."
  (cd "$FRONTEND_DIR" && npm install)
fi

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${BACKEND_PID:-}" && "${BACKEND_STARTED:-0}" == "1" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if curl --silent --fail http://127.0.0.1:8000/ >/dev/null 2>&1; then
  echo "Using existing backend at http://127.0.0.1:8000"
else
  (
    cd "$BACKEND_DIR"
    "$VENV_DIR/bin/uvicorn" main:app --reload
  ) &
  BACKEND_PID=$!
  BACKEND_STARTED=1
fi

for _ in {1..30}; do
  if curl --silent --fail http://127.0.0.1:8000/ >/dev/null 2>&1; then
    break
  fi
  if [[ "${BACKEND_STARTED:-0}" == "1" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Backend failed to start. Check the service output above."
    exit 1
  fi
  sleep 1
done

FRONTEND_PORT=5173
while curl --silent --fail "http://127.0.0.1:$FRONTEND_PORT/" >/dev/null 2>&1; do
  FRONTEND_PORT=$((FRONTEND_PORT + 1))
done

(
  cd "$FRONTEND_DIR"
  npm run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort
) &
FRONTEND_PID=$!

for _ in {1..30}; do
  if curl --silent --fail "http://127.0.0.1:$FRONTEND_PORT/" >/dev/null 2>&1 && \
    curl --silent --fail http://127.0.0.1:8000/ >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "Piranesi failed to start. Check the service output above."
    exit 1
  fi
  if [[ "${BACKEND_STARTED:-0}" == "1" ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "Piranesi failed to start. Check the service output above."
    exit 1
  fi
  sleep 1
done

APP_URL="http://127.0.0.1:$FRONTEND_PORT"
API_URL="http://127.0.0.1:8000/docs"
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$APP_URL" >/dev/null 2>&1 &
  xdg-open "$API_URL" >/dev/null 2>&1 &
elif command -v gio >/dev/null 2>&1; then
  gio open "$APP_URL" >/dev/null 2>&1 &
  gio open "$API_URL" >/dev/null 2>&1 &
fi

echo "Piranesi app: $APP_URL"
echo "Piranesi API docs: $API_URL"
echo "Press Ctrl+C here to stop both services."
wait
