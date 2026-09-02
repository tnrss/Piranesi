#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$PROJECT_DIR/venv"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/piranesi"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/piranesi"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
ENV_FILE="$CONFIG_DIR/piranesi.env"
SERVICE_FILE="/etc/systemd/system/piranesi.service"
INSTALL_SYSTEM=0
CHECK_ONLY=0

for argument in "$@"; do
  case "$argument" in
    --install-system) INSTALL_SYSTEM=1 ;;
    --check) CHECK_ONLY=1 ;;
    *) echo "Unknown option: $argument" >&2; exit 2 ;;
  esac
done

architecture="$(dpkg --print-architecture 2>/dev/null || uname -m)"
case "$architecture" in
  arm64|aarch64) ;;
  armhf|armv7l) echo "Warning: 32-bit Raspberry Pi OS is not a primary test target." >&2 ;;
  *) echo "Warning: this does not appear to be an ARM Raspberry Pi ($architecture)." >&2 ;;
esac
if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${VERSION_CODENAME:-}" != "bookworm" ]]; then
    echo "Warning: Raspberry Pi OS Bookworm is the primary deployment target." >&2
  fi
fi

missing=()
for command in python3 npm curl sqlite3; do
  command -v "$command" >/dev/null 2>&1 || missing+=("$command")
done
node_supported() {
  command -v node >/dev/null 2>&1 && node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (!((major === 20 && minor >= 19) || major >= 22)) process.exit(1)'
}
node_supported || missing+=("node-22")
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1; then
  missing+=("chromium")
fi

if [[ ${#missing[@]} -gt 0 && "$INSTALL_SYSTEM" == "1" ]]; then
  sudo apt-get update
  sudo apt-get install -y python3 python3-venv nodejs npm curl sqlite3 chromium shellcheck
  if ! node_supported; then
    nodesource_setup="$(mktemp)"
    curl --fail --location https://deb.nodesource.com/setup_22.x --output "$nodesource_setup"
    sudo -E bash "$nodesource_setup"
    rm -f "$nodesource_setup"
    sudo apt-get install -y nodejs
  fi
  missing=()
fi
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing commands: ${missing[*]}" >&2
  echo "Rerun with --install-system to install Raspberry Pi OS packages." >&2
  exit 1
fi

python3 -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ is required"'
node_supported

if [[ "$CHECK_ONLY" == "1" ]]; then
  echo "Piranesi prerequisites are available."
  exit 0
fi

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install -r "$PROJECT_DIR/backend/requirements.txt"
npm --prefix "$PROJECT_DIR/frontend" ci
npm --prefix "$PROJECT_DIR/frontend" run build

mkdir -p "$CONFIG_DIR" "$DATA_DIR" "$AUTOSTART_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
PIRANESI_DATABASE_URL=sqlite:///$DATA_DIR/piranesi.db
PIRANESI_FRONTEND_DIST=$PROJECT_DIR/frontend/dist
PIRANESI_SERVE_FRONTEND=1
EOF
  chmod 600 "$ENV_FILE"
fi

if [[ -f "$DATA_DIR/piranesi.db" ]]; then
  cp --preserve=mode,timestamps "$DATA_DIR/piranesi.db" "$DATA_DIR/piranesi.db.bak"
fi

sed \
  -e "s|@USER@|$USER|g" \
  -e "s|@PROJECT_DIR@|$PROJECT_DIR|g" \
  -e "s|@ENV_FILE@|$ENV_FILE|g" \
  "$PROJECT_DIR/deploy/systemd/piranesi.service.in" > /tmp/piranesi.service
sed -e "s|@PROJECT_DIR@|$PROJECT_DIR|g" \
  "$PROJECT_DIR/deploy/autostart/piranesi-kiosk.desktop.in" > "$AUTOSTART_DIR/piranesi-kiosk.desktop"
chmod +x "$PROJECT_DIR/scripts/run-production.sh" "$PROJECT_DIR/scripts/launch-kiosk.sh" "$PROJECT_DIR/scripts/update-pi.sh"

sudo systemd-analyze verify /tmp/piranesi.service
sudo install -m 0644 /tmp/piranesi.service "$SERVICE_FILE"
sudo systemctl daemon-reload
sudo systemctl enable --now piranesi.service
if command -v raspi-config >/dev/null 2>&1; then
  sudo raspi-config nonint do_blanking 1 || true
fi

for _ in $(seq 1 30); do
  curl --silent --fail http://127.0.0.1:8000/api/health >/dev/null && break
  sleep 1
done
curl --silent --fail http://127.0.0.1:8000/api/health >/dev/null
curl --silent --fail http://127.0.0.1:8000/ >/dev/null
echo "Piranesi is installed. Reboot or log in again to launch kiosk mode."