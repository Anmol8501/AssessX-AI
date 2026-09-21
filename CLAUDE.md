# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

Phase 1 is in progress. Only the public website exists so far; there is no backend or desktop client yet.

| Path | What it is | Commands (run inside the directory) |
|---|---|---|
| `apps/web/` | Public landing/download site — React 19, TypeScript, Vite 8, Tailwind 4 | `npm install` · `npm run dev` (:5173) · `npm run build` (runs `tsc -b` then bundles) · `npm run preview` (:4173) · `npm run lint` (oxlint) |

`apps/web/README.md` documents the download-URL configuration (`src/config/download.ts`, `VITE_ASSESSX_DOWNLOAD_*` env vars). No test runner is configured yet; add one with the first feature that needs it.

Other contents: `README.md`, `Workflow.txt` (empty), `docs/` (three source PDFs, `Roadmap.md`, `PROJECT-CONTEXT.md`).

The project lives in a nested `AssessX-AI-main/` directory below the workspace folder; the git root is `AssessX-AI-main/`.

## Source of truth

Three PDFs in `docs/` are authoritative. Read the relevant one before writing code:

| Document | Authority |
|---|---|
| `docs/PRD/AssessX Product Requirements.pdf` | Product requirements and intended behaviour. Read before implementing product features. Defines FR-001…FR-025 and NFR-001…NFR-007. |
| `docs/TRD/AssessX — Technical Requirements Document.pdf` | Technical architecture and implementation requirements. Read before changing architecture. |
| `docs/Knowledge-Base/AssessX Master Project Knowledge Base.pdf` | Supporting product/technical knowledge, rationale and design philosophy. **Not** licence to invent requirements. |

`docs/PROJECT-CONTEXT.md` is a working summary of all three, with requirement IDs, the phase plan, the event/risk model and a tracked list of open decisions (§21). Start there for orientation; go to the PDFs for anything you are about to build.

**When an implementation decision conflicts with the PRD or TRD, flag the conflict and get it resolved. Never silently change the requirement** — not in code, not in `PROJECT-CONTEXT.md`.

Do not invent customers, statistics, certifications, security guarantees, integrations or features that are not documented.

## What AssessX is

A secure assessment and AI-proctoring platform. The **Windows desktop application is the real exam environment**; the public website is a landing/download/documentation portal, not the exam runtime. Deliberately not a generic online exam website.

The product principle that governs every proctoring decision (PRD §14):

```
Detect → Correlate → Explain → Provide Evidence → Human Review
```

Security is never reduced to *"AI says cheating."* No single signal produces a verdict — the system emits events with confidence and evidence, correlates them into an explainable risk score, and hands a human the decision.

## Architecture invariants

These are load-bearing. Violating one is an architecture change, not an implementation detail.

- **Modular monolith first** (TRD §49). `FastAPI + PostgreSQL + Redis + Worker + Desktop Client`. Do not start with microservices; extract proctoring/GPU/interview/sandbox services only when scale demands it.
- **PostgreSQL is authoritative.** Redis holds cache, short-lived session state, rate limits, pub/sub and queues — never the source of truth for exam results.
- **Server-side exam state and server-synchronized timer.** The client is never the sole authority for exam duration (FR-005, FR-006).
- **Do not send every video frame to the backend** (TRD §8), and never send raw video to an LLM (PRD §5). Camera → CV models → structured events → risk engine → optional LLM reasoning.
- **Never execute candidate code inside the FastAPI process** (TRD §25). Isolated sandbox workers only.
- **Authorization is server-side and organization-scoped.** Every protected request verifies identity → role → organization → resource access. Frontend filtering is never the control (TRD §6, §27).
- **Tenant isolation is designed in from day one** even though multi-tenancy features ship in phase 8. Tenant-sensitive tables carry an organization association.
- **Large media never goes in PostgreSQL.** Object storage holds video/audio/screenshots/evidence behind signed URLs; Postgres holds metadata, references, events, scores, reports.
- **WebSockets for alerts and signaling, WebRTC for media.** WebSockets are never the video transport. WebRTC is the communication layer, not the security layer — proctoring runs independently of it.
- **AI models sit behind replaceable interfaces** (`ObjectDetector`, `FaceDetector`, `GazeDetector`, `AudioDetector`, `ScreenMonitor`, `IdentityVerifier`). Do not couple the platform to one model.
- **Risk scoring starts rule-based and explainable.** Every risk output carries `reasons`. Weights are configuration, not constants in business logic.

## Honesty constraints

The documents are unusually explicit about these, and they apply to code, UI copy, docs and commit messages alike:

- Never advertise an unbreakable exam environment. Document the secure-mode limitations that actually exist.
- Never claim a browser or JavaScript layer provides OS-level security — that requires native Rust/Windows work in the desktop client.
- No concurrency, latency, accuracy or fraud-reduction numbers until they have been measured. Performance targets in the TRD are engineering targets, not guarantees.
- Build real functionality, not demo shells (KB §56): no fake analytics, fake AI scores, fake proctoring events, hardcoded candidate lists or placeholder "AI detected cheating" logic. Mock data is acceptable early **only when explicitly marked as mock and isolated** so it can be swapped out.
- A single weak signal is never cheating. False positives (a candidate thinking, a family member in the room, traffic noise, an accessibility accommodation) are a primary product risk.

> ⚠️ `README.md` currently conflicts with the PRD/TRD: it describes a *web* candidate exam app, omits the Tauri/Rust desktop client, and states quantified business claims ("95%+ reduction in remote assessment fraud", "70% faster recruitment"). Do not treat it as a specification. Reconciling it is a pending decision, not a free edit.

## Planned stack

Per TRD §3–4 and KB §55. Deviating requires an explicit decision, not a preference.

- **Web** (public site): React, TypeScript, Vite, Tailwind CSS
- **Desktop**: Tauri + React + TypeScript + Rust / native Windows APIs. Not a website in an executable wrapper.
- **Backend**: Python, FastAPI, Pydantic, SQLAlchemy, Alembic. Business logic lives in services, not route handlers. Version APIs as `/api/v1/...` from the first endpoint.
- **Data**: PostgreSQL (authoritative), Redis (cache/bus/queue), AWS S3 for evidence and media
- **AI**: OpenCV, MediaPipe, YOLO, PyTorch; LLM provider undecided (see OQ-09)
- **Realtime**: WebRTC, WebSockets; LiveKit/Jitsi may be evaluated
- **Infra**: Docker, Docker Compose (frontend, backend, PostgreSQL, Redis, worker), AWS later, GitHub Actions

Do not introduce Kafka, a vector database, or other heavy infrastructure just because the platform is intended to scale — introduce them when throughput or a concrete requirement justifies it.

## Planned repository layout

```
apps/web/        apps/desktop/      # + apps/admin/ — pending OQ-01
packages/ui/  packages/types/  packages/config/
backend/app/{api,core,models,schemas,services,repositories,workers,proctoring,risk,interview,evaluation}
backend/tests/
```

Proctoring subpackage: `camera/ audio/ screen/ identity/ detection/ events/ evidence/`.

Keep shared types in `packages/types` rather than duplicating interfaces between frontend and backend. Use strict TypeScript.

## Phase plan

TRD §50–57 is the authoritative sequence. Implement the current phase only.

1. Public website → download → desktop app → login → role selection → Student/Admin dashboards. Backend: FastAPI + PostgreSQL + Redis. **No complex AI.**
2. Exam creation, question bank, candidate assignment, exam session, timer, submission, results
3. System check, camera, microphone, screen, identity, secure exam mode
4. YOLO, MediaPipe, audio detection, screen events, event engine, risk engine, evidence, admin monitoring
5. Coding assessments, collusion detection, advanced analytics
6. WebRTC, live interviews, screen sharing, interview security, interview reports
7. AI interviewer, adaptive questions, interview copilot, AI evaluation, scorecards
8. Multi-tenancy, AWS scaling, GPU cluster, advanced observability, enterprise security

**Current milestone: `Download → Install → Login → Dashboard`** (phase 1).

**Working development sequence:** `docs/DEVELOPMENT-ROADMAP.md` (agreed 2026-09-21) is the order the team actually builds in — nine phases, with Phase 1 split into **1A App Shell → 1B Auth + RBAC → 1C Production Foundation**. It records where it diverges from the TRD ordering. Build only the stage the user names; do not start the next stage unprompted. **Current stage: Phase 1A, not started.**

Never respond to a large feature request by building the whole platform. Break work into architecture → backend → frontend → AI → testing → integration and implement incrementally.

## Blocking open decisions

Full list in `docs/PROJECT-CONTEXT.md` §21. Two gate real work:

- **OQ-01** — Where the Admin/Proctor UI lives. The PRD promises a "Web Admin Portal"; the TRD scopes the web app to marketing only; the Knowledge Base puts the admin dashboard inside the desktop app *and* suggests a separate `apps/admin`. Resolve before building any admin UI.
- **OQ-11** — Whether camera CV inference runs on-device or in server-side GPU workers. Undetermined in all three documents; drives bandwidth, GPU cost, tamper resistance and the media transport (OQ-14). Resolve before phase 4.

Others to check before touching the relevant area: risk level taxonomy (OQ-02), role enum (OQ-03), face-embedding/liveness technology (OQ-04), canonical event enum (OQ-05), risk decay/cap math (OQ-06), offline grace window (OQ-07), notifications (OQ-15), account lifecycle (OQ-16), answer-key exposure (OQ-17), subjective grading (OQ-18).

## Definition of Done

Code existing is not completion (TRD §59). A feature is done when: implementation exists · API works · UI works where applicable · tests exist · tests pass · error handling exists · security considerations are addressed · documentation is updated · existing functionality still works.

Tests ship with features, not after. Backend: unit, integration, API. Frontend: component, E2E. Desktop: installation, permission, camera, microphone, screen capture, secure-mode. AI models: precision, recall, F1, false-positive rate, false-negative rate, inference latency, measured across varied lighting, camera quality, backgrounds, noise and device types before production use.

## Commits

Conventional, meaningful commits — `feat: add student authentication`, `fix: resolve exam timer synchronization`, `docs: add system architecture`, `test: add exam submission tests`. Do not create filler commits to inflate the count.
