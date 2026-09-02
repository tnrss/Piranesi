#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/piranesi"

cd "$PROJECT_DIR"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to update a dirty worktree." >&2
  exit 1
fi

git pull --ff-only
"$PROJECT_DIR/venv/bin/python" -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
if [[ -f "$DATA_DIR/piranesi.db" ]]; then
  cp --preserve=mode,timestamps "$DATA_DIR/piranesi.db" "$DATA_DIR/piranesi.db.bak"
fi
sudo systemctl restart piranesi.service

for _ in $(seq 1 30); do
  curl --silent --fail http://127.0.0.1:8000/api/health >/dev/null && exit 0
  sleep 1
done
echo "Piranesi did not become healthy after the update." >&2
exit 1