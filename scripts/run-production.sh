#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
VENV_DIR="$PROJECT_DIR/venv"

if [[ ! -x "$VENV_DIR/bin/uvicorn" ]]; then
  echo "Piranesi virtual environment is missing. Run scripts/setup-pi.sh first." >&2
  exit 1
fi
if [[ ! -f "$PROJECT_DIR/frontend/dist/index.html" ]]; then
  echo "Production frontend is missing. Run npm --prefix frontend run build." >&2
  exit 1
fi

export PIRANESI_DATABASE_URL="${PIRANESI_DATABASE_URL:-sqlite:///$BACKEND_DIR/piranesi.db}"
export PIRANESI_FRONTEND_DIST="${PIRANESI_FRONTEND_DIST:-$PROJECT_DIR/frontend/dist}"
export PIRANESI_SERVE_FRONTEND=1
PIRANESI_PORT="${PIRANESI_PORT:-8000}"

cd "$BACKEND_DIR"
"$VENV_DIR/bin/alembic" upgrade head
exec "$VENV_DIR/bin/uvicorn" main:app --host 127.0.0.1 --port "$PIRANESI_PORT" --workers 1