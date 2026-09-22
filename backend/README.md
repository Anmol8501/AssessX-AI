# AssessX — Backend API

FastAPI modular monolith (TRD §4, §49): Python 3.12+ · FastAPI · Pydantic · SQLAlchemy 2 ·
Alembic · PostgreSQL. Business logic lives in `app/services`, never in route handlers.

## Current stage — Phase 1C: production foundation (auth + authorization stable)

Endpoints (all under `/api/v1`, TRD §26):

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/auth/challenge` | anyone | Issue the sign-in security check (SVG image; answer stays server-side) |
| POST | `/auth/login/candidate` | anyone | Roll number + email + password + security check → bearer token + public user |
| POST | `/auth/login/admin` | anyone | Username + email + password + security check → bearer token + public user |
| GET | `/auth/me` | signed in | The authenticated user |
| POST | `/auth/logout` | signed in | Revoke the current session (204) |
| GET | `/users?role=` | ADMIN | List accounts (first admin-protected resource) |
| GET | `/candidates/me` | CANDIDATE | The signed-in candidate's own profile |
| POST | `/dev/login-challenges` | **non-production only** | Issue a challenge *with* its answer, for automated tests |
| GET | `/health` | anyone | Unversioned liveness (containers / load balancers), no dependency checks |
| GET | `/api/v1/health` | anyone | Liveness + database probe: `{"status":"ok","database":"ok"}`, 503 `degraded` when the DB is down |

Errors always have one shape: `{"error": {"code", "message", "details"?}}` — codes:
`validation_error` 422 · `invalid_credentials` 401 · `unauthorized` 401 (missing/expired token,
with `WWW-Authenticate: Bearer`) · `account_inactive` 403 · `forbidden` 403 · `challenge_invalid` 400 ·
`not_found` 404 · `conflict` 409 (constraint violation) · `database_unavailable` 503 · `internal_error` 500.
Every response carries `X-Request-ID` (echoed if the client sends one), and the same id appears in the log line.

### Authentication architecture

- **Passwords:** Argon2id (`argon2-cffi`, OWASP-recommended parameters). Only the hash is stored;
  it never leaves the server. Unknown users are verified against a dummy hash so timing does not
  reveal whether an email exists, and both cases return the same `invalid_credentials`.
- **Sessions:** opaque 256-bit bearer tokens. The server stores an HMAC (`SECRET_KEY`) of the token in
  `auth_sessions` with expiry (`SESSION_TTL_HOURS`, or `SESSION_REMEMBER_TTL_DAYS` for "keep me
  signed in"), `last_seen_at` and `revoked_at`. Logout revokes; deactivating a user invalidates all
  of their sessions on the next request. Server-side sessions were chosen over JWTs so revocation
  and expiry are real (TRD §29) without key-rotation machinery; JWT/refresh tokens can replace them
  behind the same `AuthService` if a later phase needs stateless verification.
- **Two sign-in forms (roadmap decision 2026-09-22):** candidates authenticate with roll number + email +
  password; administrators with username + email + password. Both pass the security check first. A wrong
  roll number / username, a candidate on the admin form or an admin on the candidate form all get the
  same generic `invalid_credentials`.
- **Sign-in security check:** single-use, five-minute challenge stored as a hash; the image is drawn
  server-side. It is spent on every attempt, right or wrong. (Rate limiting arrives with Phase 1C/9.)
- **Authorization:** `app/api/deps.py` — `CurrentUser` (any active signed-in user) and
  `require_roles(...)` (`AdminUser`, `CandidateUser`). Roles are read from the session's user, never
  from the request. Organization-level authorization (TRD §27) is deferred; see *Known limitations*.

### Logging

`app/core/logging.py`: one handler on the root logger, `console` (development/test) or `json`
(production) via `LOG_FORMAT`; level via `LOG_LEVEL`. `RequestContextMiddleware` assigns the request
id and logs one line per request (method, path, status, duration, user id). Startup/shutdown,
sign-in success/failure, sign-out and database errors are logged at INFO/WARNING/ERROR. Passwords,
hashes, tokens and challenge answers are never logged — `SENSITIVE_KEYS` strips them from
structured fields and a test asserts the log stream stays clean.

### Data model (migrations `0001`, `0002`)

`users` (id UUID, name, email unique, password_hash, role ∈ {ADMIN, CANDIDATE} with CHECK, is_active,
timestamps; migration `0002` adds `roll_number` for candidates and `username` for administrators — each unique,
each required for exactly its role via a CHECK constraint) · `auth_sessions` · `login_challenges`. No
exam/proctoring tables yet.

## Running locally

```bash
# 1. PostgreSQL 17 (Docker Desktop must be running); creates assessx + assessx_test
docker compose -f ../infrastructure/docker-compose.yml up -d

# 2. Python environment
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt        # Windows
cp .env.example .env                                     # then set SECRET_KEY

# 3. Schema + development accounts
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m app.cli seed-dev-users

# 4. API (host/port from API_HOST / API_PORT)
.venv/Scripts/python -m app.cli serve --reload      # docs at /docs
```

Or containerised: `docker compose -f ../infrastructure/docker-compose.yml --profile api up -d --build`
(the image runs `alembic upgrade head` then uvicorn; `Dockerfile` in this directory).

### Development accounts

Created by `seed-dev-users`, **only when `APP_ENV` is not `production`**. Passwords can be
overridden with the listed environment variables before seeding.

| Email | Role | Identifier | Default password | Override |
|---|---|---|---|---|
| `admin@assessx.local` | ADMIN | username `admin` | `AssessX-admin-dev1` | `DEV_ADMIN_PASSWORD` |
| `candidate@assessx.local` | CANDIDATE | roll number `DEV2026001` | `AssessX-candidate-dev1` | `DEV_CANDIDATE_PASSWORD` |
| `inactive@assessx.local` | CANDIDATE (inactive) | roll number `DEV2026002` | `AssessX-inactive-dev1` | `DEV_INACTIVE_PASSWORD` |

There is no self-registration: accounts are provisioned by the institution (PRD FR-001 / OQ-16).
Re-running `seed-dev-users` also sets the identifiers on already-seeded accounts and removes the
transitional `student@assessx.local` account if it exists.

## Tests

```bash
.venv/Scripts/python -m pytest        # needs TEST_DATABASE_URL (assessx_test); migrations run first
.venv/Scripts/ruff check app tests && .venv/Scripts/ruff format --check app tests
```

The suite talks HTTP to the real app through `httpx`, applies the Alembic migrations to the test
database, and rolls every test back. It covers: health (ok / degraded), database connectivity and
schema, migration head + model/migration drift (`compare_metadata`) + downgrade/upgrade round trip,
error shapes (404, 405, 422 for query/body, masked 500), request ids, log hygiene (no passwords,
hashes or tokens in the log stream), candidate/admin login in every failure mode, tokens
(missing/garbage/expired/revoked), logout, remember-me, role gates in both directions, the
single-use challenge, and that the dev router is absent in production.

## Layout

```
app/
  main.py            create_app(): CORS, error handlers, routers
  core/              config (pydantic-settings), database session, security (argon2/HMAC), errors, logging
  models/            SQLAlchemy models (Base, User, AuthSession, LoginChallenge)
  schemas/           Pydantic request/response models (UserPublic never carries secrets)
  repositories/      query layer
  services/          AuthService, UserService, LoginChallengeService — the business rules
  api/deps.py        DbSession, CurrentUser, require_roles, AdminUser, CandidateUser
  api/v1/            auth, users, candidates routers; router.py mounts them at /api/v1
  api/dev.py         development-only helpers (never mounted in production)
  cli.py             `python -m app.cli serve` · `python -m app.cli seed-dev-users`
alembic/             migrations (0001 users/sessions/challenges · 0002 roll_number + username)
tests/               pytest suite
Dockerfile           development/CI image (migrate, then serve)
```

## Known limitations (tracked, not hidden)

- No `Organization` entity / `organization_id` on `users` yet. TRD §6 asks for tenant association from
  day one; the Phase 1B brief asked for the minimal user, so it is deferred to the production
  foundation. It is one additive migration.
- No rate limiting, account lockout, password reset, MFA or audit log yet (TRD §28/§30, OQ-16).
- Roles are ADMIN/CANDIDATE everywhere (product owner's decision 2026-09-22); the PRD's STUDENT/PROCTOR/INTERVIEWER/SUPER_ADMIN naming remains OQ-03 for the wider enum.
- HTTPS is a deployment concern (Phase 9); tokens must only travel over TLS in production.
