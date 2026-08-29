# Piranesi Frontend

Neobrutalist terminal-style dashboard frontend for:
- work shifts + expected pay,
- academics (assignments, exams, due dates, API-backed class schedule),
- a Mon-Sun block calendar with day-detail pages, per-day notes, and daily/weekly recurring todos,
- finances and Plaid connection readiness.

## Stack
- React 19
- TypeScript
- Vite

## Run

```bash
npm install
npm run dev
```

App URL: `http://127.0.0.1:5173`

## Theme Defaults
- Accent: `#bd064c`
- Background: `#23282b`
- Body text: white

Other built-in themes: `matrix`, `amber`, `ice`, and `piranesi` (deep blue gradient background, gold accent, offwhite text). Switch with `theme <name>` at the prompt; the choice persists in local storage.

## Terminal Views
- `overview` (homepage) - open courses/assignments, the TODO list, condensed work hours/net pay, and net worth only
- `work` - full clock status, gross/deduction/net pay breakdown, and the shift log
- `money` - full account balances and Plaid status
- `schedule` - Mon-Sun block calendar (classes, due items, shifts, per-day notes)
- a bare date like `08/24` or `2026-08-24` - single day detail page (also reachable by clicking a day header in `schedule`)

## Backend Requirements
The app expects the API at:

`http://127.0.0.1:8000`

Used endpoints:
- `GET /shifts/`
- `POST /shifts/`
- `GET /shifts/summary`
- `GET /work/clock`, `POST /work/clock-in`, `POST /work/clock-out`
- `GET /tasks/`
- `POST /tasks/`
- `PATCH /tasks/{id}`
- `GET /exams/`, `POST /exams/`, `DELETE /exams/{id}`
- `GET /class-meetings/`, `POST /class-meetings/`, `DELETE /class-meetings/{id}`
- `GET /calendar/notes/`, `PUT /calendar/notes/{note_date}`, `DELETE /calendar/notes/{note_date}`
- `GET /todos/`, `POST /todos/`, `PATCH /todos/{id}`, `DELETE /todos/{id}`
- `GET /finance/accounts/`
- `POST /finance/accounts/`
- `GET /finance/summary`
- `GET /integrations/canvas/courses`, `GET /integrations/canvas/grades`, `POST /integrations/canvas/sync-full`
- `GET /integrations/plaid/status`
- `GET /integrations/plaid/items`, `DELETE /integrations/plaid/items/{id}`
- `POST /integrations/plaid/link-token`
