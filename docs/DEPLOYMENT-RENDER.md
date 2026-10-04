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
| `STUN_URLS` | default `stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302` | optional |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | a Cloudflare Realtime TURN key id and its API token — the token is *secret*. Enables the TURN relay for live video (see §7) | recommended for video across networks |
| `TURN_CREDENTIAL_TTL_SECONDS` | default `14400` (4 h): lifetime of the TURN credentials issued to each app | optional |
| `RUNNER_TOKEN` | the coding runner's shared secret — *secret*, ≥ 32 characters in production. Unset: the runner routes are off (404). Set the same value on the runner host (see `runner/README.md`) | with coding assessments |
| `CODING_EXECUTION_ENABLED` | `true` lets assessments with coding questions be published. Set it only when a runner is running. A production API refuses to start with this set and no `RUNNER_TOKEN`, or with a `RUNNER_TOKEN` equal to `SECRET_KEY`. Operations: `docs/RUNNER-RUNBOOK.md` | with coding assessments |
| `LLM_PROVIDER` | `none` (default — interview answers are recorded as not evaluated) or `anthropic`. Phase 7B AI answer evaluation. **`stub` is refused in production** | optional |
| `LLM_API_KEY` | the provider's API key — *secret*. Server-side only: never in the desktop app, never logged or returned. Required when `LLM_PROVIDER=anthropic` (startup refuses otherwise). Calls cost money per answer evaluated — check the provider's current pricing | with `anthropic` |
| `LLM_MODEL` | default `claude-haiku-4-5-20251001` | optional |
| `LLM_TIMEOUT_SECONDS`, `LLM_MAX_RETRIES`, `EVALUATION_WAIT_SECONDS` | defaults 20 / 2 / 25: per-call timeout, extra attempts for transient failures, and how long a candidate waits for an evaluation before the interview moves on without it | optional |

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
2. The desktop Content-Security-Policy (`src-tauri/tauri.conf.json`, `connect-src`) must allow the API
   **twice** — `https://<service>.onrender.com` for REST **and** `wss://<service>.onrender.com` for the
   live-monitoring WebSockets. In WebView2 an `https://` source does not cover `wss://`; with only the
   first, REST works but the admin wall stays "Reconnecting…", candidates show as offline and live
   video never connects. The committed CSP lists the deployed API (`assessx-backend-0nw6`) both ways.
   **The build now enforces this:** `npm run build` / `npm run tauri:build` stop with an error naming
   the missing source if `VITE_API_BASE_URL`'s `https`/`wss` (or `http`/`ws`) origin is not allowed.
3. **Live video between laptops (Phase 4C WebRTC).** The app asks the API for its ICE servers
   (`GET /api/v1/realtime/ice-servers`, signed-in users only):
   * **STUN** is always included, so two laptops on different ordinary networks (home Wi-Fi) can
     connect directly.
   * **TURN** relays the video when a network forbids a direct connection — common on mobile hotspots,
     campus/office Wi-Fi and carrier-grade NAT. It is enabled by setting `CLOUDFLARE_TURN_KEY_ID` and
     `CLOUDFLARE_TURN_API_TOKEN` on Render (Cloudflare dashboard → Realtime → TURN Server → create a
     key; Cloudflare's pricing page, checked 2026-10-02: the first 1,000 GB of SFU+TURN egress each month
     is free, then $0.05/GB, and only relayed calls use it). The API token stays on the server;
     each app receives short-lived TURN credentials (`TURN_CREDENTIAL_TTL_SECONDS`), so nothing secret
     is built into the installer and no rebuild is needed to switch TURN on. **TURN has not been tested
     against Cloudflare from this repository** (only with a simulated Cloudflare reply).
   * `VITE_ICE_SERVERS` (desktop build) still overrides the server's list, for development only.

   Events, the monitoring wall, candidate presence and the AI state do not depend on video.

   **Live video interviews (Phase 7D)** use the same ICE servers, so the same TURN setting covers them.
   Their media is peer-to-peer and never recorded; the API relays only signaling and stores the chat,
   the interviewer's notes and the call times.

**Live-monitoring reliability** (what the admin sees when something drops):
* **Candidate app online/offline** is pushed to admins the moment the candidate's app connects or
  disconnects (app closed, laptop asleep, network lost) — tile headline "Candidate offline", and
  "Candidate app: Offline for …" in the detail view, where stale video is hidden.
* **Admin connection down:** the wall and the detail view's events refresh over REST every 5 s until
  the live connection returns; video is re-requested automatically when it does.
* **Video:** a failed or stalled connection is renegotiated automatically (up to 3 times); every
  negotiation carries an id so an answer is never applied to the wrong one; a candidate app that
  reconnects while an admin is watching is asked for fresh video.

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
