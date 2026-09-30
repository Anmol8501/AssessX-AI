# Deploying the AssessX API — Render Free + Supabase Free (zero-cost multi-laptop test)

**Status:** prepared, **not deployed**. This is a zero-cost setup for testing across several laptops,
not a production deployment. Nothing here changes the application architecture.

| Piece | Where | Notes |
|---|---|---|
| Marketing website (`apps/web`) | Cloudflare Workers | Unchanged by this document |
| FastAPI backend (`backend/`) | **Render**, Free web service | One instance; REST + WebSockets |
| PostgreSQL | **Supabase**, Free project | Persistent; reached through Supabase's **Session pooler** |
| Candidate AI proctoring | On each candidate's laptop | Unchanged — no frames or AI traffic reach the server |

There is no Redis, no background worker and no extra service. The realtime hub (Phase 4C monitoring)
lives in the API process, which is correct for **exactly one instance** — do not scale the service
beyond one instance with this design.

## 1. Supabase (database)

1. Create a Free project and note the database password you set.
2. **Connect → Session pooler** → copy the URI. It looks like
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
3. Append `?sslmode=require`. If the password has characters such as `@ : / ? # %`, URL-encode them.

Use the **Session pooler**, not the other two strings:

* The *direct connection* (`db.<project-ref>.supabase.co`) is IPv6-only on the Free plan, and Render
  services connect over IPv4.
* The *Transaction pooler* (port 6543) does not support prepared statements, which the app's driver
  (psycopg 3) uses automatically for repeated queries.

The app accepts the URL exactly as Supabase gives it (`postgres://` or `postgresql://`); it pins the
installed driver itself (`app/core/config.py::normalize_database_url`). Keep the connection pool
small (see `DB_POOL_SIZE` below): the pooler's client limit on the Free plan is small.

Free projects are **paused after a period of inactivity**; resume the project in the Supabase
dashboard before a test session.

## 2. Render (API)

**New → Web Service**, connect the GitHub repository, then:

| Setting | Value |
|---|---|
| Language / Runtime | Python 3 |
| Branch | the branch you want to test |
| **Root Directory** | `backend` |
| **Build Command** | `pip install -r requirements.txt` |
| **Start Command** | `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-access-log` |
| **Health Check Path** | `/health` |
| Instance type | Free |

* **Python version:** `backend/.python-version` pins `3.13.7` (the version the suite is tested with);
  Render reads it from the root directory. Setting `PYTHON_VERSION` in the environment also works.
* **Port:** Render sets `PORT`; the start command binds `0.0.0.0:$PORT`. Do not set `PORT` yourself.
* **Migrations run on every start** (`alembic upgrade head`, a no-op when already current). This is
  deliberate: Render's separate pre-deploy command is not available on the Free instance type, and
  with one instance there is no concurrent-migration risk.
* `--no-access-log`: the app writes its own request log (without query strings) and disables
  uvicorn's access log; the flag makes that explicit.

### Environment variables

Set these in Render → **Environment**. Values marked *secret* must never be committed or pasted
into tickets/chat.

| Variable | Value | Required |
|---|---|---|
| `APP_ENV` | `production` | yes |
| `DATABASE_URL` | the Supabase **Session pooler** URI with `?sslmode=require` — *secret* | yes |
| `SECRET_KEY` | a random value ≥ 32 characters — *secret*. Generate: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Rotating it signs everyone out | yes |
| `CORS_ORIGINS` | `http://tauri.localhost,https://tauri.localhost` | yes |
| `FORWARDED_ALLOW_IPS` | `*` — trust Render's proxy for `X-Forwarded-*` (client IP / scheme); read natively by uvicorn | yes |
| `DB_POOL_SIZE` | `3` | recommended |
| `DB_MAX_OVERFLOW` | `2` | recommended |
| `LOG_LEVEL` | `INFO` | optional |
| `SESSION_TTL_HOURS`, `SESSION_REMEMBER_TTL_DAYS`, `LOGIN_CHALLENGE_TTL_SECONDS` | defaults 12 / 30 / 300 | optional |

Do **not** set `TEST_DATABASE_URL`, `DEV_*_PASSWORD`, `API_HOST` or `API_PORT` on Render.

What `APP_ENV=production` changes (already in the code): JSON logs; `/docs` and the development-only
routes (`/api/v1/dev/*`) are not mounted; and the process **refuses to start** if `CORS_ORIGINS`
contains `*` or `SECRET_KEY` is shorter than 32 characters or the development placeholder.

## 3. Endpoints to check

| URL | Meaning |
|---|---|
| `GET https://<service>.onrender.com/health` | Liveness: `{"status":"ok"}`, HTTP 200. No database or AI work — this is Render's health check |
| `GET https://<service>.onrender.com/api/v1/health` | Readiness: `{"status":"ok","database":"ok"}`, or HTTP 503 when the database is unreachable |
| `wss://<service>.onrender.com/api/v1/ws/admin/monitoring?token=…` | Phase 4C admin monitoring WebSocket (admins only) |
| `wss://<service>.onrender.com/api/v1/ws/candidates/me/proctoring?token=…&attempt_id=…` | Phase 4C candidate WebSocket (the candidate's own active attempt only) |

## 4. First administrator

`seed-dev-users` refuses to run in production, so a deployment gets its first administrator from
`create-admin`, run once **from your laptop** against the Supabase database (Render's Free tier has
no shell). The password is prompted for (or read from `ASSESSX_ADMIN_PASSWORD`), never passed on
the command line; an existing account is never modified. That administrator then creates
candidates and exams in the desktop app.

```powershell
cd backend
$env:APP_ENV = "production"
$env:DATABASE_URL = "<Supabase Session pooler URI>"
$env:SECRET_KEY = "<the same SECRET_KEY as on Render>"
.venv\Scripts\python -m app.cli create-admin --email you@example.org --name "Your Name" --username yourname
```

## 5. Migrations

* **Automatic:** the start command runs `alembic upgrade head` on every deploy/start.
* **Manually from a laptop** (e.g. to prepare the database before the first deploy), from `backend/`:

  ```powershell
  $env:ALEMBIC_DATABASE_URL = "<Supabase Session pooler URI>"
  .venv\Scripts\alembic upgrade head
  .venv\Scripts\alembic current      # expect: 0013 (head)
  ```

  `ALEMBIC_DATABASE_URL` is used as-is (no other settings needed) and is normalised like `DATABASE_URL`.
  The migrations need no PostgreSQL extensions or superuser rights.

## 6. Local production-style test

The exact Render start command, in production mode, against a local empty database (the dev
PostgreSQL container from `infrastructure/docker-compose.yml`):

```bash
docker exec assessx-postgres psql -U assessx -d assessx -c "CREATE DATABASE assessx_prodcheck OWNER assessx;"
cd backend
export APP_ENV=production PORT=10000 FORWARDED_ALLOW_IPS='*' \
       DATABASE_URL="postgresql://assessx:assessx@localhost:5433/assessx_prodcheck" \
       SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')" \
       CORS_ORIGINS="http://tauri.localhost,https://tauri.localhost" DB_POOL_SIZE=3 DB_MAX_OVERFLOW=2
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-access-log
# then: curl http://127.0.0.1:10000/health   and   curl http://127.0.0.1:10000/api/v1/health
```

(With the virtualenv active, or prefix the commands with `.venv/Scripts/`. Drop the database
afterwards: `DROP DATABASE assessx_prodcheck WITH (FORCE);`.)

## 7. CORS, WebSockets and the desktop client

**CORS** (`app/main.py`, `CORS_ORIGINS`): explicit origins only, `allow_credentials=False` (the API
uses bearer tokens, not cookies), methods GET/POST/PUT/PATCH/DELETE/OPTIONS, headers
`Authorization`, `Content-Type`, `X-Request-ID`. The packaged Windows app (Tauri 2 / WebView2) calls
from `http://tauri.localhost`; `https://tauri.localhost` is kept for builds that switch to the https
scheme. A browser at any other origin is refused. Add `http://localhost:1420` only if you point a
development build (`npm run dev`) at the deployed API.

**WebSockets:** Render supports WebSockets on web services with no extra configuration. CORS does not
apply to WebSockets; they authenticate with the session token in the query string (a WebSocket from a
webview cannot send an `Authorization` header). That token is **redacted from every log line**
(`app/core/logging.py::SecretQueryRedactionFilter`), including uvicorn's own "WebSocket … [accepted]"
lines — without this, session tokens would be stored in Render's logs.

**Pointing the desktop app at the API** (a build-time setting of the desktop app; no code change):

1. `apps/desktop/.env.production` (git-ignored): `VITE_API_BASE_URL=https://<service>.onrender.com`.
   The WebSocket URL is derived from it (`https` → `wss`).
2. The desktop Content-Security-Policy must allow the API origin. Its `connect-src` currently lists
   only the local API, so build with a config override rather than editing `tauri.conf.json` — save
   as e.g. `apps/desktop/src-tauri/tauri.render.conf.json` (no secrets; it only names the API host),
   keeping every other directive of `tauri.conf.json` as it is:

   ```json
   { "app": { "security": { "csp": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost https://<service>.onrender.com wss://<service>.onrender.com" } } }
   ```

   and build: `npm run tauri:build -- --config src-tauri/tauri.render.conf.json`.
3. **Live video between laptops (Phase 4C WebRTC)** only works across different networks with a STUN
   server, and behind strict NAT only with TURN. Set `VITE_ICE_SERVERS` in the same `.env.production`,
   e.g. `[{"urls":"stun:stun.l.google.com:19302"}]`. TURN has not been tested, and a free TURN service
   is not part of this setup. Events, the monitoring wall and the AI state do not depend on video.

## 8. Free-tier behaviour to expect

* Render Free web services **spin down after ~15 minutes without traffic**; the next request waits for
  a cold start (typically under a minute, including `alembic upgrade head`). Open WebSockets are closed
  when the service spins down or redeploys — open the API (`/health`) a minute before a test session.
* Render Free has a monthly allowance of instance hours; Supabase Free pauses inactive projects.
* Single instance only (in-process realtime hub). No load or concurrency figures have been measured;
  none are claimed.

## 9. Secrets

`.gitignore` ignores `.env` and `.env.*` (except the documented, secret-free examples:
`.env.example`, `.env.production.example`, and `apps/desktop/.env.development`, which only contains the
local API URL). `backend/.env` is local and untracked. Keep `DATABASE_URL`, `SECRET_KEY` and the
administrator password only in Render's environment settings and your password manager.
