# AssessX — Developer Setup

How to run the whole foundation locally on Windows. Component details live in
`backend/README.md` and `apps/desktop/README.md`; product/architecture rules in `CLAUDE.md`.

```
Docker Desktop
    └── PostgreSQL 17  (infrastructure/docker-compose.yml, host port 5433)
            └── AssessX API  (backend/, FastAPI, http://127.0.0.1:8000)
                    └── AssessX desktop app  (apps/desktop/, Tauri + React)
```

## Prerequisites

| Tool | Used for | Install |
|---|---|---|
| Docker Desktop | PostgreSQL (and optionally the API) | docker.com |
| Python 3.12+ | backend | python.org |
| Node.js 22+ | desktop app, public website | nodejs.org |
| Rust (rustup) + VS 2022 Build Tools (C++ workload) | native Windows shell | `winget install Rustlang.Rustup` · `winget install Microsoft.VisualStudio.2022.BuildTools` |
| WebView2 runtime | Tauri window | preinstalled on Windows 11 |

## 1. Database

```bash
docker compose -f infrastructure/docker-compose.yml up -d
docker compose -f infrastructure/docker-compose.yml ps        # assessx-postgres … (healthy)
```

Creates the `assessx` (development) and `assessx_test` (tests) databases with the development
role `assessx` / `assessx`. Credentials can be overridden with `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` in the shell environment. Data persists in
the `assessx-postgres-data` volume; `docker compose … down -v` wipes it.

## 2. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt
cp .env.example .env                       # set SECRET_KEY to a long random value
.venv/Scripts/alembic upgrade head         # apply migrations
.venv/Scripts/python -m app.cli seed-dev-users
.venv/Scripts/python -m app.cli serve --reload   # http://127.0.0.1:8000  (docs at /docs)
```

Check: `curl http://127.0.0.1:8000/api/v1/health` → `{"status":"ok","database":"ok"}`.

Alternative — run the API in Docker instead of a venv:

```bash
docker compose -f infrastructure/docker-compose.yml --profile api up -d --build
```

(The container runs `alembic upgrade head` on start. Seed dev users from the venv, or
`docker exec assessx-api python -m app.cli seed-dev-users`.)

### Environment variables (`backend/.env`)

| Variable | Purpose | Default |
|---|---|---|
| `APP_ENV` | `development` · `test` · `production` (production hides `/docs`, disables `/api/v1/dev/*`, JSON logs) | `development` |
| `API_HOST`, `API_PORT` | bind address for `app.cli serve` | `127.0.0.1`, `8000` |
| `DATABASE_URL` | SQLAlchemy URL | — (required) |
| `TEST_DATABASE_URL` | database the test suite migrates and truncates | — |
| `SECRET_KEY` | HMAC key for session tokens; rotating it signs everyone out | — (required, ≥16 chars) |
| `CORS_ORIGINS` | comma-separated allowed origins | dev server + Tauri origins |
| `SESSION_TTL_HOURS`, `SESSION_REMEMBER_TTL_DAYS` | session lifetimes | 12, 30 |
| `LOGIN_CHALLENGE_TTL_SECONDS` | security-check validity | 300 |
| `LOG_LEVEL`, `LOG_FORMAT` | `DEBUG`…`ERROR`; `console` or `json` | `INFO`, env-dependent |

Never commit `.env`. The root `.gitignore` excludes it, virtual environments, build output and
test artefacts.

### Development accounts (non-production only)

| Sign in as | Identifier | Email | Password |
|---|---|---|---|
| Administrator | username `admin` | `admin@assessx.local` | `AssessX-admin-dev1` |
| Candidate | roll number `DEV2026001` | `candidate@assessx.local` | `AssessX-candidate-dev1` |
| Candidate (inactive) | roll number `DEV2026002` | `inactive@assessx.local` | `AssessX-inactive-dev1` |

Override passwords with `DEV_ADMIN_PASSWORD`, `DEV_CANDIDATE_PASSWORD`, `DEV_INACTIVE_PASSWORD`
before seeding. The seed command refuses to run with `APP_ENV=production`.

## 3. Desktop application

```bash
cd apps/desktop
npm install
npm run tauri:dev        # native window against http://127.0.0.1:8000 (from .env.development)
npm run dev              # UI only, in a browser at http://localhost:1420
```

Production builds read `.env.production` (copy `.env.production.example`) and need the API
origin added to the CSP in `src-tauri/tauri.conf.json`. `npm run tauri:build` produces the
NSIS/MSI installers under `src-tauri/target/release/bundle/`.

## 4. Tests

```bash
# backend — needs the Postgres container (uses assessx_test; migrates, then rolls every test back)
cd backend && .venv/Scripts/python -m pytest
.venv/Scripts/ruff check app tests && .venv/Scripts/ruff format --check app tests

# desktop — needs the API on :8000 with dev users seeded; starts/reuses Vite on :1420
cd apps/desktop && npx tsc -b && npm run lint && npm run test:e2e
```

## 5. Public website (unchanged marketing/download surface)

```bash
cd apps/web && npm install && npm run dev      # http://localhost:5173
```
