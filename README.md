# AssessX

AssessX is a secure assessment and candidate-evaluation platform. It combines a
Windows desktop exam client, a FastAPI/PostgreSQL backend, on-device proctoring
signals, coding assessments, AI-assisted interviews, explainable risk and
evidence workflows, and human review.

The **Windows desktop application is the product**. The React website is the
public landing, documentation, and download surface; it is not the examination
runtime.

> **Important product principle**
>
> AssessX follows **Detect → Correlate → Explain → Provide Evidence → Human
> Review**. A single signal never becomes an automatic cheating or hiring
> verdict. AI observations and risk outputs are evidence for an authorised
> human reviewer.

## Project status

The implementation is substantially beyond the original prototype:

- Phases 1–3: authentication, role-based application shells, assessment
  authoring, publishing, candidate assignment, exam attempts, server-authoritative
  timing, submission, objective evaluation, and results.
- Phase 4: camera/microphone readiness, proctoring sessions, exam-environment
  enforcement, device readiness, Secure Kiosk compatibility artifacts, live
  admin monitoring, WebSocket updates, and a WebRTC monitoring foundation.
- AI proctoring foundation: on-device MediaPipe detectors, factual observation
  events, debouncing, evidence clips, and YOLOX object detection for supported
  classes. Object warnings are provisional, factual, and never an automatic
  exam lock or verdict.
- Risk and evidence (6A–6C): explainable on-demand risk, derived evidence
  timelines, review queues, evidence marks, human-authored outcomes, revisions,
  and append-only audit records. Administrative outcomes remain separate from
  computed risk.
- Interviews (7A–7D): configured text interviews, deterministic question
  selection, bounded adaptive follow-ups, server-side AI evaluation, reports,
  human review, and one-to-one live WebRTC interviews with chat, screen sharing,
  private notes, and no recording.
- Coding assessments: versioned problem library, CodeMirror candidate workspace,
  server-side drafts, isolated runner jobs, server-side judging, idempotent
  Run/Submit flows, best-submission scoring, admin analytics, and the C5 runner
  policy, production checks, attack tests, and mixed-assessment coverage.

**Phase 8 — production security and hardening — is the remaining planned
programme.** It includes the application/API security audit, infrastructure and
desktop hardening, security testing, monitoring, incident response, deployment,
and operational readiness. See [`docs/PHASE-8-PLAN.md`](docs/PHASE-8-PLAN.md).

This status is a development snapshot, not a production-readiness or security
certification claim. Some integrations, deployment controls, and real-world
WebRTC/media validation remain environment-dependent.

## Product surfaces

```text
Public website (apps/web)
    └── download and product information

Windows desktop app (apps/desktop)
    ├── startup, authentication, admin and candidate shells
    ├── assessment authoring, assignment, exam runner and results
    ├── proctoring readiness and exam-environment controls
    ├── AI observations, evidence, risk and human review
    ├── coding-assessment workspace
    └── text and live interviews

FastAPI backend (backend)
    ├── authentication, sessions and authorization
    ├── assessment, attempt and result APIs
    ├── proctoring, monitoring, evidence and risk services
    ├── coding, interview and review services
    └── PostgreSQL-backed migrations, audit and operational endpoints

Runner (runner)
    └── separate self-hosted sandbox for candidate-code execution
```

The backend is a **modular monolith**. PostgreSQL is authoritative for
assessment state, attempts, results, events, evidence metadata, reviews, and
audit records. Candidate code is never executed inside the FastAPI process.

## Main capabilities

### Assessment and exam workflow

- Admin creates assessments and questions, configures marks, duration,
  navigation, randomisation, attempts, availability, and proctoring policy.
- Readiness checks are shared by the builder and backend lifecycle transitions.
- Publishing locks the assessment; candidate assignment is server-authorised.
- Candidates see only their assigned assessments and never receive answer keys.
- Attempts, answers, navigation, timers, submission, timeout, locking, and
  results are server-controlled.
- Objective questions are evaluated automatically. Coding scores are calculated
  from the best eligible submission using the configured policy.

### Proctoring and exam environment

- Camera and microphone readiness checks happen before a proctored attempt
  starts.
- The desktop client reports factual device, focus, display, clipboard,
  shortcut, and environment observations.
- Native and in-page controls are best-effort. Windows shortcuts such as
  `Alt+Tab` and the Windows key can be detected but cannot be guaranteed to be
  blocked by a normal desktop application.
- AI runs on structured observations rather than sending every raw video frame
  to the backend or an LLM.
- Current detectors include face presence, framing/quality, gaze/head pose,
  audio/device state, and supported object classes. Object detection is
  provisional and must be validated against representative environments before
  production use.
- Evidence is derived from stored events and configured policies. Risk is
  explainable and is not a verdict.

### Monitoring, evidence, and human review

- Admins can monitor active proctored sessions through a live wall and
  candidate detail view.
- REST provides initial state; WebSockets provide process-local live updates.
- WebRTC is used as a media foundation for monitoring and live interviews; the
  application does not claim that real-world media connectivity is validated
  for every network topology.
- Reviewers can inspect timelines and evidence, add notes and marks, record
  administrative outcomes, revise them, and retain the audit history.

### Interviews

- Admins configure interview templates, questions, rubrics, and follow-ups.
- Text interviews use server-authoritative sessions and bounded adaptive
  selection.
- AI evaluation uses versioned rubrics and validated output. The provider is
  optional and `LLM_PROVIDER=none` is the safe default.
- Reports label AI-derived sections separately from human review.
- Live interviews are one-to-one WebRTC calls with chat, screen sharing,
  private immutable notes, and call records; calls are not recorded by this
  implementation.

## Architecture and repository layout

```text
apps/
  desktop/                 Tauri 2 + React Windows application
  web/                     React public landing/download site
backend/
  app/api/                 FastAPI routes, including /api/v1
  app/services/            business workflows and policies
  app/repositories/        persistence access
  app/models/              SQLAlchemy models
  app/schemas/             Pydantic request/response schemas
  app/core/                configuration, security, logging, errors
  app/realtime/            WebSocket hubs and call signaling
  tests/                   backend integration and unit tests
runner/                    isolated coding runner service
infrastructure/            Docker Compose and PostgreSQL initialization
docs/                      plans, runbooks, security and release documentation
.github/workflows/         CI, backup and maintenance workflows
```

### Technology

| Surface | Technologies |
| --- | --- |
| Desktop | Tauri 2, Rust, WebView2, React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7 |
| Website | React 19, TypeScript, Vite 8, Tailwind CSS 4 |
| API | Python 3.12+ (3.13 development environment), FastAPI, Pydantic, SQLAlchemy 2, Alembic |
| Data | PostgreSQL 17; Redis and workers are reserved for phases that require them |
| Proctoring | MediaPipe Tasks, ONNX Runtime Web, YOLOX object detection, structured event pipeline |
| Realtime | WebSockets for events/signaling; WebRTC for peer media |
| Coding runner | Separate HTTPS job API and Docker sandbox per execution |
| Quality | pytest, Ruff, Vitest, Playwright, TypeScript, oxlint, Rust tests |

## Quick start on Windows

### Prerequisites

- Windows 10/11 with WebView2
- Docker Desktop
- Node.js 22+
- Python 3.12+
- Rust via `rustup`
- Visual Studio 2022 Build Tools with the **Desktop development with C++**
  workload for native Tauri builds

### 1. Start PostgreSQL

From the repository root:

```powershell
docker compose -f infrastructure/docker-compose.yml up -d
docker compose -f infrastructure/docker-compose.yml ps
```

The development database is exposed on `127.0.0.1:5433`. The compose file
also creates the test database. The default credentials are for local
development only.

### 2. Configure and start the API

```powershell
Set-Location backend
python -m venv .venv
.\.venv\Scripts\pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Set a long random `SECRET_KEY` in `backend/.env`, then run migrations, seed
development accounts, and start the API:

```powershell
.\.venv\Scripts\alembic upgrade head
.\.venv\Scripts\python -m app.cli seed-dev-users
.\.venv\Scripts\python -m app.cli serve --reload
```

The API is available at `http://127.0.0.1:8000`. Check it with:

```text
http://127.0.0.1:8000/api/v1/health
```

The interactive API documentation is at `/docs` in development.

Development accounts are documented in [`DEVELOPMENT.md`](DEVELOPMENT.md).
They must never be used in production.

### 3. Start the desktop application

For the browser-based Vite shell:

```powershell
Set-Location apps/desktop
npm install
npm run dev
```

For the native Windows application:

```powershell
npm run tauri:dev
```

The desktop app reads its development API URL from
[`apps/desktop/.env.development`](apps/desktop/.env.development). No backend
secret belongs in a Vite or Tauri environment variable.

### 4. Start the public website

```powershell
Set-Location apps/web
npm install
npm run dev
```

The website runs at `http://localhost:5173`. Installer links are controlled by
`VITE_ASSESSX_DOWNLOAD_URL` and `VITE_ASSESSX_DOWNLOAD_AVAILABLE`; see
[`apps/web/README.md`](apps/web/README.md).

### Optional: run the API in Docker

```powershell
docker compose -f infrastructure/docker-compose.yml --profile api up -d --build
```

The desktop app itself is not containerised.

## Configuration

Backend configuration is loaded from `backend/.env`; start with
[`backend/.env.example`](backend/.env.example). Important settings include:

- `DATABASE_URL` and `TEST_DATABASE_URL`
- `SECRET_KEY`
- `APP_ENV`
- `CORS_ORIGINS`
- session lifetime settings
- logging level and format
- optional interview LLM provider settings
- coding runner URL/token and production policy settings

Desktop configuration uses Vite variables such as `VITE_API_BASE_URL`. The
production API origin must also be allowed by the Tauri content-security policy.
Website download settings are build-time variables. Never commit `.env` files,
tokens, passwords, signing keys, or provider credentials.

## Testing, linting, and builds

### Backend

With PostgreSQL running and the backend virtual environment active:

```powershell
Set-Location backend
.\.venv\Scripts\python -m pytest
.\.venv\Scripts\ruff check app tests
.\.venv\Scripts\ruff format --check app tests
```

### Desktop

```powershell
Set-Location apps/desktop
npx tsc -b
npm run lint
npm run test:unit
npm run test:e2e
npm run build
npm run tauri:build
```

End-to-end tests need the API on port 8000 with development users seeded.
`tauri:build` produces Windows installers under
`apps/desktop/src-tauri/target/release/bundle/`.

Object-detection calibration is intentionally separate from the normal test
suite:

```powershell
npm run calibrate:objects
```

### Website

```powershell
Set-Location apps/web
npm run lint
npm run build
npm run preview
```

The CI workflow runs backend tests and linting, desktop TypeScript/lint/unit
checks and Rust tests, website checks, dependency audits, and a history secret
scan. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Security and honesty boundaries

- Authorization is enforced by the API; frontend route guards are navigation
  conveniences, not a security boundary.
- PostgreSQL is the source of truth. Redis, realtime hubs, queues, and local
  browser state must not be treated as authoritative exam or result storage.
- Candidate code runs outside the FastAPI process in an isolated runner.
- Raw video is not sent to an LLM. Proctoring produces structured observations
  and evidence according to policy.
- The product does not promise an unbreakable kiosk, perfect identity
  recognition, zero cheating, zero false positives, or automatic disciplinary
  decisions.
- AI evaluation is not a hiring decision. Human review and the configured
  administrative process remain separate.
- Production deployment, retention, incident response, backups, and security
  operations require the documented runbooks and the Phase 8 checklist.

Known limitations and validation boundaries are recorded in the relevant phase
documents rather than hidden behind marketing claims.

## Documentation map

### Start here

- [`DEVELOPMENT.md`](DEVELOPMENT.md) — complete local setup and common commands
- [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md) — requirements-derived
  architecture and open decisions
- [`docs/DEVELOPMENT-ROADMAP.md`](docs/DEVELOPMENT-ROADMAP.md) — implementation
  sequence and current phase record

### Component guides

- [`backend/README.md`](backend/README.md) — API endpoints, auth, services,
  migrations, and backend limitations
- [`apps/desktop/README.md`](apps/desktop/README.md) — desktop architecture,
  routing, session behavior, proctoring, and E2E setup
- [`apps/web/README.md`](apps/web/README.md) — public site structure and
  installer configuration
- [`docs/CODING-ASSESSMENT-PLAN.md`](docs/CODING-ASSESSMENT-PLAN.md) and
  [`docs/RUNNER-RUNBOOK.md`](docs/RUNNER-RUNBOOK.md) — coding assessments and
  runner operations
- [`runner/README.md`](runner/README.md) — separate runner setup, sandbox
  boundaries, language policy, and deployment options

### Phase and operations documentation

- [`docs/PHASE-4-PLAN.md`](docs/PHASE-4-PLAN.md) — proctoring and monitoring
- [`docs/PHASE-5-PLAN.md`](docs/PHASE-5-PLAN.md) — AI detector/event work
- [`docs/PHASE-6-PLAN.md`](docs/PHASE-6-PLAN.md) — risk, evidence, and review
- [`docs/PHASE-7-PLAN.md`](docs/PHASE-7-PLAN.md) — interviews and reports
- [`docs/PHASE-8-PLAN.md`](docs/PHASE-8-PLAN.md) — production hardening plan
- [`docs/SECURITY.md`](docs/SECURITY.md) — security boundaries and practices
- [`docs/SECURITY-OPERATIONS.md`](docs/SECURITY-OPERATIONS.md) — operational
  security procedures
- [`docs/DATA-RETENTION.md`](docs/DATA-RETENTION.md) — retention policy
- [`docs/DEPLOYMENT-RENDER.md`](docs/DEPLOYMENT-RENDER.md) — deployment notes
- [`docs/DISASTER-RECOVERY.md`](docs/DISASTER-RECOVERY.md) — recovery procedures
- [`docs/INCIDENT-RESPONSE.md`](docs/INCIDENT-RESPONSE.md) — incident response
- [`docs/RELEASING.md`](docs/RELEASING.md) — release process

## Source of truth

The product requirements and architecture are defined by these repository
documents:

1. [`docs/PRD/AssessX Product Requirements.pdf`](docs/PRD/AssessX%20Product%20Requirements.pdf)
2. [`docs/TRD/AssessX — Technical Requirements Document.pdf`](docs/TRD/AssessX%20%E2%80%94%20Technical%20Requirements%20Document.pdf)
3. [`docs/Knowledge-Base/AssessX Master Project Knowledge Base.pdf`](docs/Knowledge-Base/AssessX%20Master%20Project%20Knowledge%20Base.pdf)

When implementation and a source requirement disagree, record and resolve the
decision explicitly. Do not turn an unmeasured target into a product claim.

## License

No public license has been declared for this repository. Treat the source code,
models, assets, documentation, and bundled third-party notices according to
the repository's applicable ownership and dependency terms.
