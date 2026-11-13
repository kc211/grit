# GRIT Interview Hub

Full-stack prototype for the GRIT interview scheduling assignment. React + Vite + vanilla CSS frontend; FastAPI + psycopg 3 + PostgreSQL backend. All displayed dates are India Standard Time.

## Requirements
- Python 3.11+
- Node.js 20+
- PostgreSQL 14+ (the schema enables `btree_gist` and `pgcrypto`)

## Windows PowerShell — local setup

Open PowerShell in the project root.

```powershell
# 1. Create database (requires PostgreSQL tools and a local postgres role)
createdb grit
psql -d grit -f .\backend\db.sql

# 2. Backend terminal
cd .\backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/grit"
$env:CORS_ORIGINS="http://localhost:5173"
uvicorn main:app --host 0.0.0.0 --port 8000

# 3. Frontend — open a second PowerShell terminal from project root
cd .\frontend
npm install
$env:VITE_API_URL="http://localhost:8000"
npm run dev
```

Open http://localhost:5173. API docs: http://localhost:8000/docs.

If PowerShell blocks venv activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in that terminal. If your PostgreSQL password contains URL-reserved characters, URL-encode them.

## Demo users
No authentication by design. Use the top-bar role and “Viewing as” selectors.

**Students:** Aarav Sharma (1), Diya Reddy (2), Kabir Mehta (3), Ananya Rao (4), Ishaan Patel (5), Meera Nair (6).

**Interviewers:** Priya Menon (1), Rahul Verma (2), Sneha Iyer (3).

## Product walkthrough
- Student: Home, Book Interview, My Interviews, Badges, Leaderboard, Demo scenarios.
- Interviewer: daily timeline, inline outcome recording, weekly availability and withdrawals.
- Interview Team: status tabs/counts, search, eligible-not-booked reminders, malpractice flags, demo reset.
- Booking, cancellation, rescheduling, outcome recording, notifications, badges and Miles are persisted in PostgreSQL.

## Deployment on Render
1. Create a PostgreSQL instance. Copy its internal connection string to backend `DATABASE_URL`.
2. Connect the repository. Create the backend web service with root `backend`, build `pip install -r requirements.txt`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`. Add `DATABASE_URL` and set `CORS_ORIGINS` to the frontend origin.
3. Execute `backend/db.sql` against the Render database using `psql` or a database client.
4. Create a Static Site with root `frontend`, build `npm install && npm run build`, publish `dist`, and set `VITE_API_URL` to the backend service's public HTTPS URL (include `https://`).
5. Add rewrite `/*` → `/index.html`.

`render.yaml` is included as a starting point. For production, configure exact origins and use a managed migration process rather than re-running the destructive demo schema.

## Important behavior and assumptions
- A slot is one 30-minute interviewer availability interval. The server assigns the interviewer based on an open matching slot; clients cannot select an interviewer.
- Booking is at least one hour ahead. Cancellation/rescheduling close four hours before start.
- Reschedule is a single transaction: old booking is cancelled, new slot is locked with `FOR UPDATE SKIP LOCKED`, and any failure rolls back both changes.
- Journey state is derived from skills, bookings, badge and malpractice records.
- FAIL defaults to 14 days; NO_SHOW defaults to 7 days; RETAKE_LATER requires a selected date.
- Malpractice before a badge puts the journey on hold; after an active badge it revokes the badge and deducts 500 bonus Miles.
- Demo data is seeded with relative future availability, so re-run the schema to refresh the sample slots.
- No authentication is intentionally implemented per assignment. This is a demo prototype, not a production deployment. Add identity, authorization, audit logging, CSRF/rate controls, email/meeting integration and secure flag review before production use.
- Demo scenarios page previews outcome states interactively; actual database state changes are performed from interviewer/team actions.
