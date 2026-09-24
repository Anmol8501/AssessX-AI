# AssessX — Backend API

FastAPI modular monolith (TRD §4, §49): Python 3.12+ · FastAPI · Pydantic · SQLAlchemy 2 ·
Alembic · PostgreSQL. Business logic lives in `app/services`, never in route handlers.

## Current stage — Phase 2C: publishing & candidate assignment

Endpoints (all under `/api/v1`, TRD §26):

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/auth/challenge` | anyone | Issue the sign-in security check (SVG image; answer stays server-side) |
| POST | `/auth/login/candidate` | anyone | Roll number + email + password + security check → bearer token + public user |
| POST | `/auth/login/admin` | anyone | Username + email + password + security check → bearer token + public user |
| GET | `/auth/me` | signed in | The authenticated user |
| POST | `/auth/logout` | signed in | Revoke the current session (204) |
| GET | `/users?role=` | ADMIN | List accounts |
| GET POST | `/assessments` | ADMIN | List / create assessments (created as `DRAFT`) |
| GET PATCH DELETE | `/assessments/{id}` | ADMIN | Read (questions, settings, readiness) / update basic info **and settings** / delete |
| POST | `/assessments/{id}/ready` | ADMIN | DRAFT → READY; refused with the outstanding issues when incomplete |
| POST | `/assessments/{id}/draft` | ADMIN | READY → DRAFT so editing can continue |
| POST | `/assessments/{id}/publish` | ADMIN | READY → PUBLISHED; re-runs the readiness check first, then locks the assessment |
| POST | `/assessments/{id}/unpublish` | ADMIN | PUBLISHED → READY; refused with 409 while any candidate holds it |
| GET POST | `/assessments/{id}/questions` | ADMIN | List / add questions (position assigned automatically) |
| GET PATCH DELETE | `/assessments/{id}/questions/{qid}` | ADMIN | Read / update / delete, scoped to that assessment |
| POST | `/assessments/{id}/questions/reorder` | ADMIN | Explicit order; the body lists every question exactly once |
| POST | `/assessments/{id}/questions/{qid}/duplicate` | ADMIN | Copies the question (answer key included) after the original |
| GET POST | `/assessments/{id}/assignments` | ADMIN | Who holds the assessment / assign candidates (already-assigned ones are reported, not rejected) |
| DELETE | `/assessments/{id}/assignments/{candidate_id}` | ADMIN | Unassign one candidate |
| GET POST | `/candidates` | ADMIN | List demo candidates (with assignment counts) / create one with an initial password |
| GET | `/candidates/{id}` | ADMIN | One candidate |
| GET | `/candidates/me` | CANDIDATE | The signed-in candidate's own profile |
| GET | `/candidates/me/assessments` | CANDIDATE | The candidate's own assigned exams — never questions or answer keys |
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

### Assessment authoring (Phase 2A)

- `Assessment` — title, description, instructions, duration, total/passing marks, `status` (only
  `DRAFT` so far; the rest of the lifecycle is Phase 2B/2C), `created_by`. Named "assessment" per the
  Phase 2 plan; TRD §5 calls this entity `Exam` (divergence recorded in `docs/PHASE-2-PLAN.md`).
- `Question` — belongs to one assessment, `MCQ` / `MULTIPLE_SELECT` / `TRUE_FALSE`, marks, position,
  optional explanation. `QuestionOption` rows hold the text and `is_correct`; keeping them in a table
  rather than JSON means a candidate-facing shape can omit the answer key at query level (OQ-17).
- Type rules are enforced server-side in `app/schemas/question.py` and re-checked on update: MCQ and
  true/false need exactly one correct option, multiple-select at least one, options must be distinct
  and at least two, and true/false must be exactly `True` / `False`.
- No organization association (product owner's decision: standalone showcase deployment).
### Builder and lifecycle (Phase 2B)

- **Settings** on `assessments`: `max_attempts`, `randomize_questions`, `randomize_options`,
  `show_results`, `question_navigation` (`FREE` / `SEQUENTIAL` — no source document defines the modes,
  so these are the minimum the exam engine needs), `availability_start` / `availability_end`. They are
  stored and validated only; nothing opens or closes an exam automatically.
- **Lifecycle:** `DRAFT` ⇄ `READY`. `app/services/readiness.py` is the single check behind both the
  review screen's issue list and the transition itself, so the UI can never show "ready" for something
  the backend would refuse. It covers title, duration, marks (including questions summing to the
  configured total), settings, at least one question, every question's text/marks/options/answer key,
  and gap-free ordering.
- **Ordering** is explicit and persisted: `position` is renumbered 0..n-1 after every add, delete,
  duplicate or reorder.
- Deliberately absent from 2B: attempts, answers, proctoring.

### Publishing and assignment (Phase 2C)

- **Lifecycle:** `DRAFT` ⇄ `READY` → `PUBLISHED`. Publishing re-runs `readiness.py` at the moment
  of the transition, so an assessment cannot be published on the strength of a stale check, and a
  `DRAFT` is refused outright (422).
- **Published means locked.** `AssessmentService` refuses every write to a published assessment —
  basic information, settings, questions, options and ordering alike — so the candidates holding it
  always see the same exam. The desktop UI mirrors the rule, but the backend is what enforces it.
- **Unpublishing** returns it to `READY` and is refused with 409 while any candidate holds it;
  unassign everybody first. This keeps an assignment from silently pointing at an editable exam.
- **Assignment** is a row in `assessment_assignments`, unique per `(assessment_id, candidate_id)`.
  Assigning a candidate twice is not an error: the response separates what was created from who was
  already assigned. Only `PUBLISHED` assessments can be assigned, and only active candidates.
- **Candidate accounts** are created by an administrator with an initial password (`POST
  /candidates`) — there is no self-registration and no email delivery in this build, so no
  invitation or reset flow exists yet. The role is always `CANDIDATE`; it is never taken from the
  client.
- **Scoping:** `/candidates/me/assessments` reads the candidate id from the session, never from the
  request, and returns the exam's shape (title, instructions, duration, marks, question *count*,
  availability) without questions, options or answer keys (OQ-17).
- Deliberately absent: attempts, answers, scoring, results, notifications, bulk import, scheduling
  that opens or closes an exam automatically.

### Data model (migrations `0001`–`0005`)

`users` (id UUID, name, email unique, password_hash, role ∈ {ADMIN, CANDIDATE} with CHECK, is_active,
timestamps; migration `0002` adds `roll_number` for candidates and `username` for administrators — each unique,
each required for exactly its role via a CHECK constraint) · `auth_sessions` · `login_challenges` ·
`assessments` (status CHECK ∈ {DRAFT, READY, PUBLISHED}, settings columns, `published_at`) ·
`questions` · `question_options` · `assessment_assignments` (unique `(assessment_id, candidate_id)`;
cascades from both the assessment and the candidate, but `assigned_by` is RESTRICT so an
administrator who assigned work cannot be deleted out from under it). No proctoring tables yet.

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
single-use challenge, that the dev router is absent in production, and the Phase 2A authoring rules
(CRUD, per-type answer-key validation, cross-assessment scoping, cascade delete, admin-only access) and
the Phase 2B builder (settings persistence and validation, readiness, DRAFT ⇄ READY, reorder,
duplicate), and the Phase 2C publishing rules (publish/unpublish transitions, the published lock on
every write path, assignment de-duplication, active-candidate and role checks, candidate creation
conflicts, per-candidate scoping of `/candidates/me/assessments`, and that no answer key reaches a
candidate).

## Layout

```
app/
  main.py            create_app(): CORS, error handlers, routers
  core/              config (pydantic-settings), database session, security (argon2/HMAC), errors, logging
  models/            SQLAlchemy models (Base, User, AuthSession, LoginChallenge, Assessment,
                     Question, QuestionOption, AssessmentAssignment)
  schemas/           Pydantic request/response models (UserPublic never carries secrets)
  repositories/      query layer
  services/          AuthService, UserService, LoginChallengeService, AssessmentService,
                     QuestionService, CandidateService, AssignmentService — the business rules
  api/deps.py        DbSession, CurrentUser, require_roles, AdminUser, CandidateUser
  api/v1/            auth, users, candidates, assessments routers; router.py mounts them at /api/v1
  api/dev.py         development-only helpers (never mounted in production)
  cli.py             `python -m app.cli serve` · `python -m app.cli seed-dev-users`
alembic/             migrations (0001 users/sessions/challenges · 0002 roll_number + username ·
                     0003 assessments/questions/question_options ·
                     0004 assessment settings + READY status ·
                     0005 assessment_assignments + PUBLISHED status)
tests/               pytest suite
Dockerfile           development/CI image (migrate, then serve)
```

### Taking an exam (Phase 3A)

All candidate-only, all scoped to the signed-in user. No route accepts a candidate id — the
session is the identity — and none of them returns an answer key.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/candidates/me/assessments/{assessment_id}` | Exam details, plus `can_start` / `start_blocked_reason` / `active_attempt_id` |
| `POST` | `/api/v1/candidates/me/assessments/{assessment_id}/attempts` | Start the exam, or resume the attempt already under way |
| `GET` | `/api/v1/candidates/me/attempts/{attempt_id}` | The attempt, its questions and every saved answer |
| `PUT` | `/api/v1/candidates/me/attempts/{attempt_id}/answers/{question_id}` | Replace the selection for one question; an empty list clears it |

- **`AssessmentAttempt`** — `assessment_id`, `candidate_id`, `assignment_id`, `attempt_number`,
  `status` (`IN_PROGRESS` only), `started_at`. `uq_attempt_one_active_per_candidate` is a partial
  unique index, so two concurrent "Start Exam" clicks cannot produce two attempts; the service
  catches the loser's `IntegrityError` and resumes the winner.
- **`AttemptAnswer`** — one row per attempt/question, unique on the pair. The row survives
  clearing a selection, so "answered then cleared" stays distinguishable from "never opened".
  Mark-for-review was removed in migration 0009 at the product owner's request.
- **`AttemptAnswerOption`** — one row per selected option, with a real foreign key to
  `question_options`. An option belonging to a different question cannot be stored at all.
- **Answer-key boundary (OQ-17):** `CandidateQuestion` / `CandidateQuestionOption` in
  `app/schemas/attempt.py` omit `is_correct` *and* `explanation`. Tests assert the serialised keys
  exactly, so widening those shapes fails the suite.
- **Starting** requires an assignment (404 otherwise — never 403, so exams cannot be enumerated),
  a `PUBLISHED` assessment, an open availability window, and an unused attempt allowance.
- Not here, by design: any timer or deadline, submission, scoring, results, and any admin view of
  attempts. Those are Phase 3B and 3C.

### The exam session (Phase 3B)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/candidates/me/attempts/{attempt_id}/session` | The authoritative clock, without the paper — what the countdown resynchronises against |
| `POST` | `/api/v1/candidates/me/attempts/{attempt_id}/submit` | Finalizes the attempt |

- **The clock is the server's.** `expires_at` is written once when the attempt is created, from
  `started_at + duration_minutes`, and is never recomputed and never read from a request. No
  endpoint accepts `started_at`, `expires_at` or a remaining time, so refreshing, reopening the
  application or winding the system clock cannot extend an exam (FR-006).
- **`server_time` is returned with every attempt and session response.** The client measures its
  offset from it once and counts down locally; the countdown is presentation, and reaching zero
  prompts a resync rather than deciding anything.
- **Expiry needs no worker.** `AttemptService.settle()` runs on every candidate interaction —
  reading the attempt, polling the session, saving an answer, opening My Exams, submitting — and
  moves a lapsed attempt to `TIME_EXPIRED`. A client that sits open with a frozen timer, or never
  runs at all, changes nothing. `finalized_at` is set to `expires_at`, the moment the exam actually
  ended, rather than the later moment the server noticed.
- **Submit versus expiry is decided under a row lock.** `submit()` takes the attempt
  `FOR UPDATE` (with `of=`, because the model's eager-loaded relationships are outer joins that
  PostgreSQL refuses to lock), settles it, and only then finalizes. A submit that arrives after the
  deadline loses and the attempt stays `TIME_EXPIRED`; a second submit of an already-submitted
  attempt returns it unchanged instead of failing.
- **A finished attempt is immutable.** Answer saves are refused with
  `409 attempt_locked`, a dedicated code so the desktop client shows the finished screen rather
  than reporting a save failure.
- Not here, by design: score, percentage, pass/fail, result records and any admin results view.
  Those are Phase 3C.

### Evaluation and results (Phase 3C)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/candidates/me/attempts/{attempt_id}/result` | The candidate's own result for one finished attempt |
| `GET` | `/api/v1/candidates/me/results` | The candidate's released results |
| `GET` | `/api/v1/assessments/{assessment_id}/results` | Admin-only: every candidate's score for one assessment |

- **Scoring is exact-set matching**, identically for MCQ, multiple-select and true/false: the
  selected options must equal the correct options. No partial credit, no negative marking. An
  empty selection is *unanswered* rather than wrong — and that check runs first, so a malformed
  question with no correct option cannot award marks for answering nothing.
- **Marks come from the questions**, never from their count: the fixtures' 2 + 3 + 1 paper has a
  maximum of 6, not 3.
- **Pass/fail is decided on raw marks** against `assessments.passing_marks`, never on the rounded
  percentage. The percentage is an exact `Numeric(5,2)`, computed once at the end rather than
  rounded through intermediates, and a paper worth zero marks scores 0% instead of dividing by
  zero.
- **A result is a snapshot, not a view.** `attempt_results` holds one row per attempt
  (`uq_attempt_result_attempt`), written inside the same transaction that finalizes the attempt,
  and it is never recomputed. `passing_marks` is copied onto it, so the result records the rule it
  was judged by. This matters because a published assessment is **not** currently immutable — see
  *Known limitations*.
- **Evaluation is idempotent.** `EvaluationService.ensure_result` returns an existing result
  untouched; a concurrent second evaluation loses to the unique constraint and re-reads the
  winner. Reading a finished-but-unscored attempt evaluates it lazily, which is how attempts that
  finished before Phase 3C get results.
- **`show_results` is honoured.** When an assessment withholds results, the attempt is still
  evaluated and the administrator sees the score, but every candidate-facing number is `null`
  rather than zero — a withheld result must never look like a failed one.
- Candidates never receive an answer key. The breakdown reports each question's position, marks,
  marks awarded and outcome; it never names the correct option.

## Known limitations (tracked, not hidden)

- No `Organization` entity / `organization_id` on `users` yet. TRD §6 asks for tenant association from
  day one; the Phase 1B brief asked for the minimal user, so it is deferred to the production
  foundation. It is one additive migration.
- No rate limiting, account lockout, password reset, MFA or audit log yet (TRD §28/§30, OQ-16).
- Roles are ADMIN/CANDIDATE everywhere (product owner's decision 2026-09-22); the PRD's STUDENT/PROCTOR/INTERVIEWER/SUPER_ADMIN naming remains OQ-03 for the wider enum.
- HTTPS is a deployment concern (Phase 9); tokens must only travel over TLS in production.
- `randomize_questions` / `randomize_options` are stored but not applied: a randomised order has
  to be fixed per attempt and persisted, or resuming reshuffles the paper (OQ-19, open).
- One-way navigation (`question_navigation = SEQUENTIAL`) is a UI constraint, not a server one:
  the API still accepts an answer for any question in the attempt. Not a security hole — a
  candidate may answer their own questions — but enforcing the order server-side would need a
  per-attempt cursor.
- A candidate cannot leave a running exam through the UI, but nothing stops them closing the
  application. The clock keeps running either way, so the exam still ends on time.
- There is no background sweep, so an abandoned attempt stays `IN_PROGRESS` in the database
  until someone touches it. Every candidate-facing read settles it first, so nothing incorrect
  is ever served; only a direct database query sees the stale row.
- **A published assessment is not immutable.** The UI hides editing, but the API still allows an
  administrator to rename a published assessment, change a question's marks, flip its answer key
  or delete it outright — including while candidates are sitting it. Phase 3C protects results by
  storing them as a snapshot rather than recomputing, so an edit cannot rewrite a score a
  candidate has already been shown, but the underlying gap is real and unresolved.
- `show_results` is a boolean with no release mechanism: an assessment set to withhold results
  withholds them forever, since nothing can later release them (OQ, recorded in
  `docs/PHASE-3-PLAN.md`).
- Any administrator can read any assessment's results. There is no per-assessment ownership in
  this build — `created_by` is recorded but never checked — so "an admin cannot see another
  admin's results" is not a property the current authorization model has.
