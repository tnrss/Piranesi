# Piranesi

Piranesi is a local-first personal operations dashboard for work, academics,
finances, schedules, notes, and todos. It combines a FastAPI/SQLite backend
with a React terminal-style interface and optional Canvas LMS and Plaid sync.

This README is both a user guide and an implementation review: it explains
what each feature does, how it is programmed, where data is stored, and which
parts of the current build remain intentionally limited.

## Architecture

```text
Browser: React 19 + TypeScript
  frontend/src/App.tsx
       | fetch('/api/...')
       v
Vite proxy: /api/* -> http://127.0.0.1:8000/*
       |
       v
FastAPI: backend/main.py
       |
       +-- SQLAlchemy -> backend/piranesi.db (SQLite)
       +-- Canvas REST API (optional)
       +-- Plaid Python SDK (optional)
```

| File | Responsibility |
| --- | --- |
| `backend/main.py` | Routes, calculations, sync logic, provider clients, webhook verification |
| `backend/models.py` | SQLAlchemy tables |
| `backend/schemas.py` | Pydantic request/response contracts |
| `backend/database.py` | SQLite engine and sessions |
| `backend/alembic/` | Versioned schema migrations and initial class-meeting seed |
| `backend/requirements.txt` | Exact Python environment versions |
| `frontend/src/App.tsx` | Shared state, API loading, command dispatch, themes, mutations |
| `frontend/src/terminal/TerminalUI.tsx` | Views, prompt, history, suggestions, keyboard navigation |
| `frontend/src/terminal/CommandParser.ts` | Tokenizer, aliases, flags, command registry |
| `frontend/src/terminal/WeekSchedule.tsx` | Monday-Sunday calendar composition |
| `frontend/src/terminal/DayDetail.tsx` | Single-day schedule, notes, log, and todos |
| `frontend/src/terminal/TodoList.tsx` | Inline todo CRUD |
| `frontend/src/terminal/classSchedule.ts` | Calendar date/time helpers and class filtering |
| `start-piranesi.sh` | Migration, full-stack launch, and health checks |

On mount, `App.tsx` loads shifts, work summary, clock, tasks, exams, class
meetings, Canvas courses/grades, accounts, finance summary, Plaid
liabilities/status, notes, and todos in parallel. Core failures mark the backend unavailable and trigger
up to three one-second retries. A liabilities failure is tolerated so an
unconfigured Plaid account does not prevent the rest of the app from loading.
Most mutations reload this shared dataset, keeping derived summaries and all
views consistent.

## Features and Implementation

### Terminal Overview

The default screen combines todos, Canvas course/grade data, current-week work
totals, and net worth. Detailed records live in Work, Grades, Schedule, Money,
and Sync views. A status line reports startup, command, API, and sync outcomes.
The bottom navigation is clickable and also accepts typed commands.

### Work Shifts and Clock

A manual shift stores date, hours, hourly rate, and optional notes. Commands
create shifts through `POST /shifts/`; the API also supports patch, delete, and
week reset operations. Destructive terminal actions require browser
confirmation.

The persisted clock uses `WorkClockSession`. Clock-in stores UTC time and the
configured default rate. A second clock-in returns the existing session rather
than creating another active timer. Clock-out closes the latest active session
and creates a normal `WorkShift`, dated from clock-in, with note
`Clocked shift`. Elapsed hours are:

```text
round(max(clock_out - clock_in, 0) / 3600, 2)
```

Weeks run Monday-Sunday. The summary accepts optional `week_start`,
`hourly_rate`, and `hours_cap` values and calculates:

```text
total_hours = sum(shift.hours_worked)
capped_hours = min(total_hours, hours_cap)
estimated_pay = capped_hours * hourly_rate
deduction_amount = estimated_pay * PAYROLL_DEDUCTION_RATE
estimated_net_pay = estimated_pay - deduction_amount
cap_warning = total_hours > hours_cap
```

Values are rounded to two decimals. This is an estimate, not payroll or tax
software; it applies one summary rate rather than each shift's stored rate.

### Academic Tasks, Exams, and Grades

Tasks store course, title, due date/time, type, and completion state. They can
be manual or Canvas-backed, are listed by due date, and support partial edits.
Deleting an imported task also deletes its `CanvasAssignment` mapping. A later
Canvas sync may re-import it because the remote assignment still exists.

Exams are intentionally manual and store course, title, date/time, and notes;
the app does not infer exams from assignment names. Tasks and exams appear on
matching calendar days.

Canvas grades are cached separately from tasks. Each course grade can contain
a numeric score, letter grade, and local text override. Full sync refreshes the
remote score/letter but preserves `local_override`.

### Calendar, Notes, and Day Log

Schedule computes the displayed Monday-Sunday week from the browser date and a
week offset. Each day combines:

- class meetings loaded from SQLite through `GET /class-meetings/`;
- incomplete tasks and manual exams due that day;
- dated todos;
- work shifts and an estimated per-shift net amount;
- a persisted free-form note.

Clicking a day or entering `08/24`, `08/24/2026`, or `2026-08-24` opens the
day detail. Its short note (`content`) and longer `day_log` save on blur through
`PUT /calendar/notes/{date}`. The backend upserts one row per date and updates
only fields supplied in the request.

Class meetings are not imported from Canvas. `ClassMeeting` stores a name,
JavaScript weekday numbers (`0` Sunday through `6` Saturday), `HH:MM` start/end
times, and an optional room. The API validates time and weekday formats,
deduplicates repeated weekdays, and supports create/list/patch/delete without a
frontend rebuild. Week and day views filter the fetched meetings by
`Date.getDay()`, sort by start time, and display the room when supplied. The
initial Alembic migration seeds the four schedule entries that were previously
hardcoded, but only when the table is empty.

### Todos

Todos are separate from academic tasks. Each has a description, optional due
date, completion flag, recurrence (`none`, `daily`, or `weekly`), and creation
time. Creation and row-level selectors set recurrence inline; description,
date, and recurrence remain editable. Completing a recurring item keeps it
active and advances its due date by one interval, repeatedly catching up until
the next occurrence is in the future. A recurring item without a date starts
from completion time. Nonrecurring items retain normal checked completion.
Incomplete items sort before completed ones. Dated todos also appear on the
calendar; undated ones remain in the todo list.

### Accounts, Net Worth, and Liabilities

Accounts can be manual or Plaid-backed. Manual rows receive an external key
such as `manual-<timestamp>`; Plaid rows use `<item_id>:<account_id>`. Every row
stores name, balance, type, and sync timestamp.

Types containing `credit` are liabilities and use the absolute balance. All
other accounts are assets:

```text
assets_total = sum(non-credit balances)
liabilities_total = sum(abs(credit balances))
net_worth = assets_total - liabilities_total
```

Plaid's liabilities product supplies credit-card next-payment dates and minimum
payments. If Plaid has returned the account but is still preparing liability
details, the Money view shows a pending state instead of hiding the account.

### Themes

`App.tsx` defines `default`, `matrix`, `amber`, `ice`, and `piranesi`. A theme
command writes CSS variables `--bg`, `--text`, and `--accent`, then stores the
name as `piranesi-theme` in browser local storage. Operational data is stored
in SQLite; theme choice is the only browser-persisted setting.

## Terminal Commands

`CommandParser.ts` preserves quoted strings, recognizes action/entity aliases,
and separates positional arguments from `--key=value` flags. Suggestions come
from the same registry, are prefix-filtered to eight results, and add live IDs
for deletable tasks, exams, class meetings, accounts, and Plaid items.

| Command | Result |
| --- | --- |
| `work`, `grades`, `schedule`, `money`, `sync` | Open the matching view |
| `clear` | Return to overview |
| `help` | Put command help in the status line |
| a supported date | Open day detail |
| `clock in`, `clock out` | Start/finish the work clock |
| `add shift ...` | Create a shift |
| `add assignment ...` | Create a manual task |
| `add exam ...` | Create a manual exam |
| `add class ...` | Create a recurring class meeting |
| `add account ...` | Create a manual account |
| `add account plaid` | Open Plaid Link |
| `delete shift\|assignment\|exam\|class\|account <id>` | Confirm and delete |
| `delete account plaid <id>` | Confirm, revoke a Plaid item, and delete its accounts |
| `assignment done <id>`, `assignment reopen <id>` | Toggle task completion |
| `work reset` | Confirm and delete this week's shifts |
| `sync canvas`, `sync plaid`, `sync all` | Run provider sync |
| `theme <name>` | Apply and persist a theme |

```text
add shift --hours=8 --date=2026-08-23 --rate=18 --note="campus shift"
add shift 8 08/23
add assignment --course="CS 4023" --title="Lab 1" --due=2026-08-25T23:59
add exam --course="CS 4023" --title="Midterm" --date=2026-09-15T10:00
add class --name="AI Ethics" --days=mon,wed,fri --start=12:00 --end=12:50 --room="Hall 201"
delete class 5
add account --name="Checking" --type=checking --balance=500
delete account plaid 2
delete assignment 12
assignment done 12
sync all
theme piranesi
```

Month/day input uses the browser's current year and is converted to ISO. The
frontend performs lightweight required-field checks; Pydantic performs final
type validation. Keyboard controls are `Enter` to submit, `Tab` to insert a
suggestion, arrows to navigate suggestions/history, `Escape` to dismiss
suggestions, and `Ctrl+L`/`Cmd+L` to return home.

## External Integrations

### Canvas LMS

Canvas requests use `Authorization: Bearer <CANVAS_API_TOKEN>`. Assignment sync
requests up to 100 active courses and 100 assignments per course. Assignments
without ID, title, or due date are skipped. A new remote assignment creates an
`AcademicTask` and `CanvasAssignment` mapping keyed by Canvas assignment ID;
later syncs update that task rather than duplicate it. Canvas's
`has_submitted_submissions` controls completion.

Full sync first upserts course metadata, first-teacher display name, and the
current user's first enrollment grade, then runs assignment sync. Courses named
literally `NULL` are skipped and cleaned from local Canvas mappings. Responses
report courses checked, assignments found, tasks created/updated, and sync time.
Pagination links are not followed, making `per_page=100` the effective limit.

### Plaid

Plaid Link is implemented end to end:

1. Frontend requests a link token.
2. Backend creates it with configured countries/products and optional redirect
   and webhook URLs.
3. `react-plaid-link` opens Plaid Link.
4. Frontend sends the public token to the exchange endpoint.
5. Backend stores the access token and immediately syncs accounts.

`liabilities` is always added to configured Plaid products. Balance sync prefers
`available` over `current` for depository accounts, matching balances after
pending holds; credit/loan/other accounts prefer `current`. Rows first match on
`<item_id>:<account_id>`, then fall back to account name when relinking issues
a new item ID. Sync without `item_id` refreshes every stored item.

Access tokens are stored unencrypted in SQLite. Treat `backend/.env` and
`backend/piranesi.db` as secrets.

`GET /integrations/plaid/items` returns token-free item metadata for terminal
suggestions. `DELETE /integrations/plaid/items/{id}` accepts either Plaid's
external item ID or the local numeric row ID. It calls Plaid `item/remove` before changing local
state, so a provider failure preserves the token for a retry. After successful
revocation it deletes the `PlaidItem`, every financial account keyed with that
item's `<item_id>:` prefix, and marks the connection disconnected when no items
remain. This releases the item from Plaid's item allowance. The terminal command
`delete account plaid <id>` confirms the operation before calling this route.

The webhook route requires `Plaid-Verification`. It obtains the indicated
Plaid key, requires ES256, verifies the ECDSA signature, rejects `iat` values
more than 300 seconds from server time, and compares `request_body_sha256` with
the raw body. Verified `LIABILITIES` events timestamp the matching Plaid item;
other verified types are acknowledged without domain changes.

## API Reference

Interactive OpenAPI documentation is at `http://127.0.0.1:8000/docs`.

### Work, Academics, and Calendar

| Method and path | Behavior |
| --- | --- |
| `GET /` | Health response |
| `POST /shifts/`, `GET /shifts/` | Create/list shifts |
| `PATCH /shifts/{id}`, `DELETE /shifts/{id}` | Update/delete a shift |
| `DELETE /shifts/reset-week?week_start=YYYY-MM-DD` | Delete a Monday-Sunday range |
| `GET /shifts/summary` | Calculate capped weekly pay |
| `GET /work/clock`, `POST /work/clock-in`, `POST /work/clock-out` | Persisted clock operations |
| `POST /tasks/`, `GET /tasks/?include_completed=true` | Create/list tasks |
| `PATCH /tasks/{id}`, `DELETE /tasks/{id}` | Update/delete a task |
| `POST /exams/`, `GET /exams/`, `DELETE /exams/{id}` | Exam CRUD (no patch route) |
| `POST /class-meetings/`, `GET /class-meetings/` | Create/list class meetings |
| `PATCH /class-meetings/{id}`, `DELETE /class-meetings/{id}` | Update/delete a meeting |
| `GET /calendar/notes/` | List date notes |
| `PUT /calendar/notes/{date}`, `DELETE /calendar/notes/{date}` | Upsert/delete a note |
| `POST /todos/`, `GET /todos/` | Create/list todos |
| `PATCH /todos/{id}`, `DELETE /todos/{id}` | Update/delete a todo |

### Finance and Integrations

| Method and path | Behavior |
| --- | --- |
| `POST /finance/accounts/`, `GET /finance/accounts/` | Create/list accounts |
| `PATCH /finance/accounts/{id}`, `DELETE /finance/accounts/{id}` | Update/delete account |
| `GET /finance/summary` | Assets, liabilities, net worth |
| `GET /finance/liabilities` | Plaid credit payment data |
| `GET /integrations/canvas/status` | Configuration state |
| `GET /integrations/canvas/courses`, `GET /integrations/canvas/grades` | Cached data |
| `PUT /integrations/canvas/grades/{course_id}` | Set/clear local override |
| `POST /integrations/canvas/sync` | Assignments only |
| `POST /integrations/canvas/sync-full` | Courses, grades, assignments |
| `GET /integrations/plaid/status` | Configuration, connection, item count |
| `GET /integrations/plaid/items` | List token-free item metadata for management |
| `DELETE /integrations/plaid/items/{id}` | Revoke a Plaid item and delete its local records |
| `POST /integrations/plaid/link-token` | Create Link token |
| `POST /integrations/plaid/exchange` | Exchange public token and sync |
| `POST /integrations/plaid/sync?item_id=...` | Sync one or all items |
| `POST /integrations/plaid/webhook` | Verify and acknowledge webhook |

FastAPI returns 422 for schema/type errors and record mutations return 404 for
missing rows. Integrations generally return 400 for missing configuration or
provider errors and 502 for invalid upstream responses.

## Database Design

| Model | Role |
| --- | --- |
| `WorkShift`, `WorkClockSession` | Reportable work and active/completed timer |
| `AcademicTask`, `ManualExam` | Due work and explicit exams |
| `TodoItem`, `CalendarNote` | Checklist and unique per-date note/log |
| `FinancialAccount` | Unique manual/Plaid key, balance, type, sync time |
| `PlaidItem`, `PlaidConnectionState` | Access tokens and UI connection state |
| `CanvasCourse`, `CanvasCourseGrade` | Cached metadata and grade/override |
| `CanvasAssignment` | Remote assignment ID to local task bridge |
| `ClassMeeting` | Recurring weekday/time/room schedule block |

Alembic owns schema changes. Revision `20260829_0001` is an idempotent baseline:
on an existing Piranesi database it records the current schema, adds the legacy
`liabilities_updated_at` column if absent, creates `class_meetings`, and seeds
the previous schedule. On a fresh database it creates every table and index.
The launcher runs `alembic upgrade head` before Uvicorn; application import no
longer calls `Base.metadata.create_all()` or executes manual `ALTER TABLE` DDL.

Create future migrations from `backend/` after changing the ORM, inspect the
generated operations, then apply them:

```bash
alembic revision --autogenerate -m "describe schema change"
alembic upgrade head
alembic check
```

The baseline downgrade intentionally removes only `class_meetings`; it does not
drop preexisting user-history tables.

Revision `20260829_0002` adds the non-null `TodoItem.recurrence` field with a
`none` default, preserving all existing todo rows.

The SQLite URL is relative, so start the backend from `backend/` (the launcher
does this) to use `backend/piranesi.db`. There is no user/tenant key: the schema
is single-user.

## Configuration

```bash
cp backend/.env.example backend/.env
```

Existing process variables take precedence over `backend/.env`.

| Variable | Default / purpose |
| --- | --- |
| `DEFAULT_HOURLY_RATE` | `18`; clock and summary rate |
| `DEFAULT_HOURS_CAP` | `28`; weekly cap |
| `PAYROLL_DEDUCTION_RATE` | `0.0765`; estimated deduction fraction |
| `CANVAS_API_URL`, `CANVAS_API_TOKEN` | Empty; Canvas base URL/token |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | Empty; Plaid credentials |
| `PLAID_USER_ID`, `PLAID_KEY` | Supported credential aliases |
| `PLAID_ENV` | `sandbox`; also development/production |
| `PLAID_COUNTRY_CODES` | `US`; comma-separated |
| `PLAID_PRODUCTS` | `transactions`; liabilities added automatically |
| `PLAID_WEBHOOK_URL`, `PLAID_REDIRECT_URI` | Optional public webhook/OAuth URLs |
| `VITE_API_URL` | `/api`; frontend API base |

Google and Notion variables in the example are placeholders; those integrations
are not implemented.

## Local Setup and Operation

Prerequisites are Python 3 with `venv`, Node.js/npm, and `curl`. The frozen
backend environment is installed from `backend/requirements.txt`:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
cd frontend && npm install && cd ..
```

Launch both services:

```bash
chmod +x start-piranesi.sh
./start-piranesi.sh
```

The launcher verifies the virtual environment, installs frontend packages when
needed, reuses or starts backend port 8000, waits for health, selects the first
free frontend port from 5173, starts Vite, and opens the app/docs when a Linux
opener is available. `Ctrl+C` stops processes it started.

To run separately, preserve the backend working directory:

```bash
# terminal 1, from repository root
source venv/bin/activate
cd backend
alembic upgrade head
uvicorn main:app --reload

# terminal 2
cd frontend
npm run dev
```

## Validation and Review

```bash
cd frontend
npm run lint
npm run build

cd ../backend
alembic check
```

The build runs TypeScript before Vite. There is no automated test suite. A
manual review should exercise CRUD in every domain, clock in/out, note reload
persistence, calendar date projection, two consecutive Canvas syncs (no
duplicates), Plaid link/relink (no duplicate accounts), all-item Plaid sync,
and persistence after restarting both services.

## Current Limitations

- No authentication, authorization, or multi-user separation; routes are local
  trusted-environment APIs.
- CORS permits localhost/127.0.0.1 on any port for the dynamic launcher.
- Plaid tokens are plaintext at rest; there is no token encryption or webhook
  rate limit.
- Class meetings are terminal/API-managed; Canvas events and Google/Outlook sync
  are absent.
- Canvas pagination beyond 100 records is not followed.
- Todo recurrence supports daily/weekly intervals only; there are no custom
  recurrence rules, reminders, recurring work, budgets, transactions, charts,
  or offline mode.
- Validation has no business constraints such as nonnegative hours or lengths.
- No automated test suite or CI.

The current build is therefore best reviewed and operated as a trusted,
single-user local application rather than a production multi-user service.