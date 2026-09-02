# Piranesi

Piranesi is a modular life log for tracking:
- finances (Plaid-ready, including Bank of America account/savings + credit card tracking),
- academics (exams, assignments, due dates),
- weekly work hours and expected pay.

This first build includes backend APIs, a neobrutalist frontend, and a tracked roadmap.

## Product Direction

### Core Outcomes
- One dashboard for life logistics with quick capture + clear summaries.
- Automatic weekly pay estimate with hourly rate and cap.
- Plaid integration path for live financial balances.
- Highly customizable theme and modular feature surfaces.

### Design System Requirements
- Piranesi accent: `#d3c48a` (antique gold)
- Piranesi background: black-to-indigo gradient ending at `#394b9f`
- Piranesi body text: `#fffbee` (warm ivory)
- Headings: accent-forward
- Style: neobrutalism, responsive, modular

## Build Tracker

### Phase 1: Foundation
- [x] FastAPI backend with SQLite and domain models
- [x] React + Vite frontend scaffold
- [x] Initial app-level dashboard architecture

### Phase 2: Core Features
- [x] Work shift logging endpoint (`POST /shifts/`)
- [x] Weekly work summary endpoint (`GET /shifts/summary`) with cap + expected pay
- [x] Academic task create/list/update endpoints
- [x] Financial account create/list + finance summary endpoints
- [x] Live Plaid Link, token exchange, and all-account balance sync

### Phase 3: UI Implementation
- [x] Initial neobrutalist dashboard prototype
- [x] Work, academics, finance, and Plaid data modules
- [x] Canvas assignment sync with duplicate-safe updates
- [x] Terminal-style combined overview and two-column layout
- [x] Typed/clickable Work, Grades, Schedule, Money, Sync, Help, and Clear commands

### Phase 4: Next Steps (Planned)
- [x] Real Plaid SDK integration (`link_token/create`, `item/public_token/exchange`, `accounts/balance/get`)
- [x] Local secret management and environment-based config loading (`backend/.env`)
- [ ] Calendar sync (Google/Outlook export/import)
- [ ] Recurring assignments and reminders
- [ ] Authentication + user profiles
- [ ] Charts for spending trend, workload trend, and schedule pressure

## API Overview

### Health
- `GET /api/health`

### Work
- `POST /shifts/`
- `GET /shifts/`
- `DELETE /shifts/{shift_id}`
- `DELETE /shifts/reset-week`
- `GET /shifts/summary?hourly_rate=18&hours_cap=28`

### Academics
- `POST /tasks/`
- `GET /tasks/?include_completed=true`
- `PATCH /tasks/{task_id}`
- `GET /exams/`
- `POST /exams/`
- `DELETE /exams/{exam_id}`

### Finance
- `POST /finance/accounts/`
- `GET /finance/accounts/`
- `DELETE /finance/accounts/{account_id}`
- `GET /finance/summary`

### Plaid (Ready Path)
- `GET /integrations/plaid/status`
- `POST /integrations/plaid/link-token`
- `POST /integrations/plaid/exchange`
- `POST /integrations/plaid/sync`

### Canvas
- `GET /integrations/canvas/status`
- `POST /integrations/canvas/sync`
- `GET /integrations/canvas/courses`
- `GET /integrations/canvas/grades`
- `PUT /integrations/canvas/grades/{canvas_course_id}`
- `POST /integrations/canvas/sync-full`

## Run Locally

## Raspberry Pi Appliance

Piranesi can run as a single loopback-only FastAPI process that serves both the
API and the built React frontend. The Raspberry Pi setup targets 64-bit
Raspberry Pi OS Bookworm with Chromium on a 7-inch landscape display.

From a fresh clone:

```bash
./scripts/setup-pi.sh --check
./scripts/setup-pi.sh --install-system
```

The setup creates an isolated Python environment, installs locked frontend
dependencies, builds `frontend/dist`, initializes and migrates SQLite, installs
the backend systemd service, and adds Chromium kiosk startup to the current
desktop user's session. Piranesi remains available only at
`http://127.0.0.1:8000`.

Configuration and data are kept outside the checkout:

- Configuration: `~/.config/piranesi/piranesi.env`
- Database: `~/.local/share/piranesi/piranesi.db`
- Service logs: `journalctl -u piranesi.service`

See `docs/raspberry-pi.md` for deployment, updates, backups, troubleshooting,
display settings, and kiosk controls.

## One-Click Launcher

The root-level `start-piranesi.sh` starts both the FastAPI backend and Vite frontend, waits for both services, and opens the dashboard plus API documentation in your browser.

First-time setup:

```bash
chmod +x start-piranesi.sh
```

After that, launch everything with:

```bash
./start-piranesi.sh
```

Keep the launcher terminal open while using Piranesi. Press `Ctrl+C` there to stop both services.

The launcher opens:
- App: `http://127.0.0.1:<available-port>` (usually `5173`)
- API docs: `http://127.0.0.1:8000/docs`

During local development, the frontend calls `/api/...` and Vite proxies those requests to FastAPI. This keeps API requests same-origin even when the launcher selects a dynamic frontend port. Set `VITE_API_URL` only when using a separately hosted backend.

## Secrets Setup (Do This First)
1. Open `backend/.env`.
2. Fill your Plaid values:
   - `PLAID_CLIENT_ID` and `PLAID_SECRET`
   - or your preferred aliases `PLAID_USER_ID` and `PLAID_KEY`
3. Optionally adjust:
   - `DEFAULT_HOURLY_RATE`
   - `DEFAULT_HOURS_CAP`
   - `PAYROLL_DEDUCTION_RATE`
4. Restart backend after any `.env` change.

Template file: `backend/.env.example`

## Backend
From `backend/`:

```bash
source ../venv/bin/activate
uvicorn main:app --reload
```

Backend URL: `http://127.0.0.1:8000`

## Frontend
From `frontend/`:

```bash
npm install
npm run dev
```

Frontend URL: `http://127.0.0.1:5173`

## Plaid Configuration Plan

Plaid real flow is now implemented:
1. Add credentials in `backend/.env`:
   - `PLAID_CLIENT_ID` and `PLAID_SECRET` (or aliases `PLAID_USER_ID` and `PLAID_KEY`)
   - `PLAID_ENV` (`sandbox`, `development`, `production`)
2. Ensure backend dependency is installed:
   - `pip install plaid-python`
3. In the UI:
   - Open `Money` and click `[connect account]`, or type `add account plaid`.
   - Complete Plaid Link
4. Backend exchanges `public_token` and syncs balances automatically.
5. Use "Sync Plaid Balances" any time to refresh account balances.

## Canvas Configuration

Canvas uses a personal access token:
1. In Canvas, open Account / Settings and create a new access token.
2. Put your school Canvas base URL in `backend/.env` as `CANVAS_API_URL`, for example `https://school.instructure.com`.
3. Put the token in `CANVAS_API_TOKEN`.
4. Restart the backend.
5. Open Piranesi and click `Sync Canvas Assignments` in the Academics module.

Only active courses are checked. Assignments with a due date are imported, and repeat syncs update the existing local task instead of duplicating it.
Canvas UTC deadlines are converted to `PIRANESI_TIMEZONE` when set, or the host's local timezone otherwise, before they are placed on the weekly calendar.

## Terminal Commands

The main screen is a combined terminal overview. Use the clickable commands at the bottom or type them at the prompt:

- `Work` - hours, cap, gross pay, deduction, net pay, and shifts
- `Grades` - active Canvas courses and current/local grades
- `Schedule` - assignments, manual exams, and work shifts
- `Money` - account balances, liabilities, net worth, and Plaid status
- `Sync` - full Canvas academic sync plus all connected Plaid balances
- `Help` - show command reference in the status line
- `Clear` - return to combined overview

Theme presets can be changed from the prompt:

- `theme piranesi` - indigo gradient, warm ivory, and antique gold (default)
- `theme default` - Piranesi charcoal and reddish pink
- `theme matrix` - black background and terminal green text
- `theme amber` - black background and warm amber text
- `theme ice` - navy background and electric cyan text

The selected theme is stored in browser local storage and restored on the next visit.

Work tracking also supports `clock in` and `clock out`. `clock in` starts a persisted timer; `clock out` ends it and automatically saves the elapsed time as a shift.

Course meeting times are reserved for a later Canvas calendar/events integration. Exam dates are intentionally manual rather than inferred from assignment names.

## Command Console

The prompt supports typed commands and clickable suggestions. Suggestions appear above the prompt and can be selected with the mouse, `Tab`, or arrow keys.

When an add command needs fields, the suggestion explains the expected shape before execution:

```text
add exam [name] [month/day]
add shift [hours] [month/day]
add assignment [course] [title] [month/day]
add account [name] [balance]
```

Examples:

```text
add shift --hours=8 --date=2026-08-23 --note="campus shift"
add assignment --course="CS 4023" --title="Lab 1" --due=2026-08-25T23:59
add exam --course="CS 4023" --title="Midterm" --date=2026-09-15T10:00
add account --name="Checking" --type=checking --balance=500
clock in
clock out
delete assignment 12
assignment done 12
sync canvas
sync plaid
sync all
work reset
```

Delete and reset commands require explicit browser confirmation. Incomplete add commands show usage guidance; command suggestions are generated from the same registry used by the parser.

## Notes
- Current finance flow supports manual account capture plus Plaid-readiness checks.
- Credit accounts are treated as liabilities in net-worth summary.
- Weekly pay estimate uses:
  - hourly rate default: `$18`
  - hour cap default: `28`
