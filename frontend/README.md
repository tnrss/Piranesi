# Piranesi Frontend

Neobrutalist dashboard frontend for:
- work shifts + expected pay,
- academics (assignments, exams, due dates),
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

Theme and planner settings are customizable from the in-app settings panel.

## Backend Requirements
The app expects the API at:

`http://127.0.0.1:8000`

Used endpoints:
- `GET /shifts/`
- `POST /shifts/`
- `GET /shifts/summary`
- `GET /tasks/`
- `POST /tasks/`
- `PATCH /tasks/{id}`
- `GET /finance/accounts/`
- `POST /finance/accounts/`
- `GET /finance/summary`
- `GET /integrations/plaid/status`
- `POST /integrations/plaid/link-token`
