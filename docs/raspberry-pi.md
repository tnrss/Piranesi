# Raspberry Pi Deployment

Piranesi's appliance mode uses one Uvicorn worker on `127.0.0.1:8000` for the
API and production frontend. Chromium is a separate display process started by
the desktop session. Vite is not used in production.

## Requirements

- 64-bit Raspberry Pi OS Bookworm with Desktop
- Python 3.11 or newer
- Node 20.19+ or Node 22.12+
- Chromium, curl, and SQLite
- A landscape display at 800x480 or 1024x600

Run the non-mutating prerequisite check:

```bash
./scripts/setup-pi.sh --check
```

Run setup and permit installation of missing system packages:

```bash
./scripts/setup-pi.sh --install-system
```

The script is idempotent. It does not overwrite an existing environment file,
and it backs up an existing database before migrations. It installs a system
service that runs as the current desktop user and a desktop autostart entry for
Chromium.

## Configuration

Edit `~/.config/piranesi/piranesi.env` and restart the service after changing
Canvas or Plaid credentials:

```bash
sudo systemctl restart piranesi.service
```

The generated file includes absolute database and frontend paths and is mode
`0600`. Keep Plaid and Canvas secrets out of the repository.

## Operations

```bash
systemctl status piranesi.service
journalctl -u piranesi.service -f
curl --fail http://127.0.0.1:8000/api/health
```

Disable or restore the kiosk login launch without affecting the backend:

```bash
mv ~/.config/autostart/piranesi-kiosk.desktop ~/.config/autostart/piranesi-kiosk.desktop.disabled
mv ~/.config/autostart/piranesi-kiosk.desktop.disabled ~/.config/autostart/piranesi-kiosk.desktop
```

Run an explicit update only from a clean checkout:

```bash
./scripts/update-pi.sh
```

Updates use `git pull --ff-only`, reinstall pinned Python dependencies, run
`npm ci`, rebuild the frontend, back up SQLite, and restart the backend. There
are no unattended updates.

## Backup And Restore

Stop writes briefly before making a manual backup:

```bash
sudo systemctl stop piranesi.service
cp ~/.local/share/piranesi/piranesi.db ~/piranesi-$(date +%F).db
sudo systemctl start piranesi.service
```

To restore, stop the service, replace the database file, retain ownership and
mode, and start the service. The production launcher applies pending Alembic
migrations before accepting requests.

## Display And Input

Setup asks `raspi-config` to disable screen blanking when that command is
available. On desktop images where it is not, disable blanking through
Raspberry Pi Configuration. Set display rotation and resolution through the OS
rather than Chromium CSS.

The UI uses a fixed viewport-height shell, internal scrolling, seven stable day
columns, and coarse-pointer targets of at least 44 CSS pixels. For text-heavy
editing, enable the Raspberry Pi OS on-screen keyboard or attach a keyboard.

The kiosk launcher supports both `chromium` and `chromium-browser` and works in
Bookworm's Wayland desktop session. It does not disable Chromium's sandbox.

## Troubleshooting

If port 8000 is occupied, find and stop the conflicting process before starting
the service. `PIRANESI_PORT` may be set temporarily when running
`scripts/run-production.sh` manually, but the kiosk expects port 8000.

If the frontend is missing, rebuild it with:

```bash
npm --prefix frontend ci
npm --prefix frontend run build
```

If migration startup fails, preserve the database and inspect service logs.
Do not delete the database to bypass a migration failure.