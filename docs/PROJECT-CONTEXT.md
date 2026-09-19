# AssessX Project Context

> **Status:** Working summary — derived from the PRD, TRD and Master Knowledge Base PDFs in this repository.
> **Authority:** This file is *not* a requirements document. The three source PDFs are authoritative. See [Source Documents](#source-documents).
> **Rule:** If an implementation decision conflicts with the PRD or TRD, the conflict must be flagged and resolved explicitly — never silently changed here or in code.
> **Generated:** 2026-09-19 · Source doc versions: PRD v1.0, TRD v1.0, Knowledge Base (undated).

---

## 1. Product Overview

AssessX is a secure assessment, AI-proctoring and candidate-evaluation platform. It is explicitly *not* positioned as a generic online exam website; the Knowledge Base opens by warning against reducing it to one.

The platform combines: secure online examinations, AI-powered multimodal proctoring, identity verification, suspicious-activity detection, evidence collection, explainable risk scoring, coding assessments, live human interviews, AI-powered adaptive interviews, and candidate evaluation/reporting.

**Primary delivery model:** a downloadable **Windows desktop application** is the real examination environment. The public website is a landing/download/documentation portal, not the exam runtime (KB §4, §5; TRD §3).

**Core product principle (PRD §14 — non-negotiable):**

```
Detect → Correlate → Explain → Provide Evidence → Human Review
```

Security must never be reduced to *"AI says cheating."* No single signal determines a cheating verdict; the system produces events, confidence, evidence, risk scores and explanations for a human reviewer.

### Explicit Non-Goals (PRD §5)

The initial product will **not**:
- Guarantee zero cheating
- Guarantee perfect face recognition
- Automatically punish candidates solely using AI
- Replace all human reviewers
- Execute untrusted code directly on the API server
- Process every video frame using an LLM
- Build a complete enterprise platform in the first release

---

## 2. Product Goals

| ID | Goal | Source |
|----|------|--------|
| G1 | **Secure Examinations** — a controlled environment for candidates to complete assessments | PRD §4 |
| G2 | **Multimodal Proctoring** — detect suspicious behaviour across video, audio and screen signals | PRD §4 |
| G3 | **Explainable Detection** — provide evidence and reasoning, not cheater labels | PRD §4 |
| G4 | **Scalable Monitoring** — few admins/proctors monitor many candidates | PRD §4 |
| G5 | **Automated Evaluation** — auto-evaluate objective and coding questions | PRD §4 |
| G6 | **Intelligent Interviews** — AI-driven adaptive interviews | PRD §4 |
| G7 | **Live Interviews** — interviewer/candidate live video+audio | PRD §4 |
| G8 | **Objective Reporting** — structured candidate reports and scorecards | PRD §4 |

**Key differentiator (KB §58):** *Multimodal Assessment Integrity* — correlation of video + audio + screen + identity + device/session signals + exam interaction behaviour + answer patterns, through an explainable risk engine, backed by evidence and human review.

**Success metrics (PRD §12):** exam completion rate, assessment failure rate, detection precision, false-positive rate, detection latency, candidate support incidents, interview completion rate, average screening time, admin workload reduction; technical: API latency, event-processing latency, WebRTC connection success, worker throughput, GPU utilisation, DB performance, concurrent sessions.

---

## 3. Users and Roles

**Customer segments (PRD §1):** universities, colleges, recruitment companies, corporate hiring teams, professional certification organisations, training institutions.

| Role | Phase | Capabilities |
|------|-------|--------------|
| `STUDENT` | MVP | Take exams, run system check, verify identity, complete environment check, enter secure exam mode, submit, view permitted results, complete interviews |
| `ADMIN` | MVP | Create/edit exams, question banks, add & assign candidates, configure exam + proctoring policy, schedule, monitor, review events & evidence, finalize results, generate reports, manage organizations |
| `PROCTOR` | V1 | Monitor candidates, receive alerts, review evidence, investigate sessions, escalate cases |
| `INTERVIEWER` | V2+ | Schedule/conduct live interviews, view candidate info, use AI copilot, record notes, evaluate |
| `SUPER_ADMIN` | Future | Named in role enum (PRD FR-001, KB §40); responsibilities not specified |
| Organization Administrator | Future | Org configuration, users, security policies, retention policies, billing, integrations (PRD §6.5) |

> ⚠️ **Inconsistency:** PRD §6.5 describes an "Organization Administrator" role, but the role enums in PRD FR-001 and KB §40 list only STUDENT / ADMIN / PROCTOR / INTERVIEWER / SUPER_ADMIN. KB §6 ("Initial user roles") omits PROCTOR entirely while KB §40 includes it. See **OQ-03**.

---

## 4. Core Features

### 4.1 Feature Inventory

1. **Authentication & RBAC** — login/logout, password security, sessions, role- and organization-level authorization
2. **Exam Engine** — exam creation, question bank, multiple question types, randomization, attempts, scheduling, server-authoritative timer, navigation, save/submit, auto-evaluation, results
3. **Candidate Management** — add, import, assign, schedule, status tracking
4. **Desktop Secure Exam Client** — system check, permissions, secure exam mode, local security checks, session control
5. **Identity Verification** — ID capture, face detection, embedding comparison, liveness, periodic re-verification
6. **Environment / Room Check** — pre-exam camera scan for prohibited objects/persons
7. **AI Proctoring Engine** — camera (object detection, face/pose/gaze), audio (VAD, speaker analysis), screen/application events
8. **Event Engine** — structured, timestamped proctoring events with confidence/severity/source
9. **Risk Engine** — explainable correlation + scoring with reasons (rule-based first)
10. **Evidence Engine** — event-triggered screenshots/clips/audio + metadata in object storage
11. **Investigation & Forensic Replay** — session timeline, click-through to evidence, confirm/dismiss/escalate
12. **Live Proctoring Dashboard** — real-time alerts over WebSocket, risk-prioritised candidate triage
13. **Reporting** — exam results, proctoring report, integrity score, evidence references, candidate performance
14. **Coding Assessment** — sandboxed execution, test cases, limits, multiple languages *(future)*
15. **Collusion & Code-Similarity Detection** *(future)*
16. **Live Human Interviews** — WebRTC video/audio, screen share, chat, timer, notes, optional recording, independent proctoring
17. **AI Interviewer & Interview Copilot** — adaptive questioning, answer evaluation, suggested follow-ups, summaries *(future)*
18. **Candidate Scorecard** — multi-dimensional, human-reviewable
19. **Public Website** — product/security explanation, docs, system requirements, versioned Windows download

### 4.2 Priority Classification

Derived from PRD §13 (Release Strategy), TRD §50–57 (Implementation Phases) and KB §7–8, §59.

#### MUST HAVE — MVP
- Authentication, session management, RBAC (STUDENT, ADMIN)
- Organization-scoped data model (tenant columns present from day one — KB §39, TRD §6)
- Exam creation + configuration; question bank; MCQ, multiple-select, true/false, short answer, long answer
- Candidate assignment & scheduling
- Exam session with **server-authoritative** state and timer; navigation; save; submit
- Automatic evaluation of objective questions; result storage
- Basic Windows desktop application (download → install → launch → login → role dashboard)
- Pre-exam system check (camera, mic, screen capture, internet, permissions, display, app version)
- Public website + download portal
- FastAPI + PostgreSQL + Redis backend, Alembic migrations, versioned `/api/v1` routes
- Docker Compose development environment, environment-based configuration
- Audit logging of security-relevant actions
- Student dashboard and Admin dashboard

#### SHOULD HAVE — V1 (security core; the product's differentiator)
- Identity verification (face detection, embedding comparison, liveness, periodic re-check)
- Camera / microphone / screen monitoring pipelines
- Secure exam mode in the desktop client
- Environment/room check
- AI proctoring detectors: object detection (YOLO), face/pose/gaze (MediaPipe), audio events
- Structured event engine + Redis/event bus
- Rule-based risk engine with explanations
- Evidence engine + object storage + retention configuration
- Admin/proctor investigation UI, event timeline, forensic replay
- Real-time alerting over WebSocket
- Proctoring report + integrity score
- `PROCTOR` role

#### FUTURE / OPTIONAL — V2 / V3
- Coding assessments with sandboxed execution; code similarity detection
- Collusion detection / candidate clustering
- Advanced proctoring & analytics; AI proctor copilot (review prioritisation)
- Live interviews (WebRTC, screen sharing, chat, recording, interview proctoring, interview scorecards)
- AI interviewer (adaptive questions) and AI interview copilot
- Question types: coding, aptitude, case studies
- Enterprise multi-tenancy runtime features, billing, integrations
- `SUPER_ADMIN` / Organization Administrator roles
- Large-scale infrastructure: GPU cluster, AWS scaling, advanced observability
- Optional stack: Qdrant (only if RAG/semantic retrieval is required), Kafka/RabbitMQ (only when throughput justifies)

#### UNKNOWN / NEEDS DECISION
Tracked in [§21 Open Questions](#21-open-questions--decisions-required). Highest-impact: admin portal surface (web vs desktop), CV inference location (client vs GPU worker), proctoring media transport, face-recognition/liveness technology, and phase ordering of coding vs live interviews.

---

## 5. Functional Requirements

Verbatim requirement IDs from PRD §10. Use these IDs in commits, issues and tests for traceability.

| ID | Requirement | Key constraints | Priority |
|----|-------------|-----------------|----------|
| FR-001 | Authentication | Login, logout, password security, session management, RBAC. Roles: STUDENT, ADMIN, PROCTOR, INTERVIEWER, SUPER_ADMIN (future) | MUST |
| FR-002 | Exam Creation | Title, description, duration, start/end, attempts, randomization, security policy | MUST |
| FR-003 | Question Management | MCQ, multiple-select, true/false, short answer, long answer. Future: coding, aptitude, case studies | MUST |
| FR-004 | Candidate Assignment | Add, import, assign, schedule, monitor status | MUST |
| FR-005 | Exam Session | Start, view, navigate, save, submit answers, final submission. **Server-side exam state is mandatory** | MUST |
| FR-006 | Exam Timer | Synchronized with server time. **Client shall NOT be the sole authority for duration** | MUST |
| FR-007 | System Check | Camera, microphone, screen capture, internet, permissions, display, application version | MUST |
| FR-008 | Identity Verification | Face detection, identity verification, liveness, continuous/periodic re-verification. Events: `FACE_VERIFIED`, `FACE_MISMATCH`, `FACE_MISSING`, `MULTIPLE_FACES`, `LIVENESS_FAILED` | SHOULD (V1) |
| FR-009 | Environment Detection | Phone, tablet, additional person, additional monitor, book, notes, other prohibited objects | SHOULD (V1) |
| FR-010 | Gaze Detection | Head orientation, gaze direction, deviation duration and frequency. **Isolated gaze movement must not auto-generate a cheating verdict** | SHOULD (V1) |
| FR-011 | Audio Monitoring | Voice activity, multiple speakers, suspicious speech, unknown speakers. Environmental noise must be considered | SHOULD (V1) |
| FR-012 | Screen Monitoring | *Where technically and legally permitted:* screen/display/application changes, suspicious browser activity, copy/paste attempts, unauthorized applications | SHOULD (V1) |
| FR-013 | Secure Exam Mode | Restricted navigation, exam-only environment, session integrity, app-switch & display-change detection, system restrictions. **Capabilities must be validated, not falsely advertised** | SHOULD (V1) |
| FR-014 | Proctoring Events | Structured event: event ID, session ID, type, timestamp, confidence, severity, detection source, evidence reference | SHOULD (V1) |
| FR-015 | Risk Score | Dynamic per-session score, suggested 0–100. Bands: 0–25 Normal, 26–50 Low, 51–75 Medium, 76–100 High. Thresholds eventually org-configurable | SHOULD (V1) |
| FR-016 | Event Correlation | Combine signals (e.g. `PHONE_DETECTED` + `GAZE_DEVIATION` + `UNKNOWN_VOICE` + `APPLICATION_SWITCH` → High Risk) | SHOULD (V1) |
| FR-017 | Evidence | Screenshot, video segment, audio segment, screen event, detection metadata. **Retention must be configurable** | SHOULD (V1) |
| FR-018 | Investigation | View candidate, risk score, event timeline, open evidence, review session, confirm/dismiss/escalate | SHOULD (V1) |
| FR-019 | Reports | Exam result, proctoring report, integrity score, suspicious events, evidence references, candidate performance | SHOULD (V1) |
| FR-020 | Coding Assessment | *Future.* Editor, compilation, test cases, hidden tests, runtime/memory limits, multiple languages. **Isolated execution infrastructure mandatory** | FUTURE |
| FR-021 | Live Interview | Candidate/interviewer video, audio, screen sharing, chat, timer. WebRTC as the realtime layer | FUTURE (V2) |
| FR-022 | Interview Proctoring | Same integrity engine: additional people, unauthorized assistance, suspicious screen activity, identity changes, audio anomalies | FUTURE (V2) |
| FR-023 | AI Interviewer | *Future.* Ask questions, understand answers, generate follow-ups, adjust difficulty, evaluate | FUTURE (V3) |
| FR-024 | AI Interview Copilot | Answer analysis, technical accuracy, missing concepts, suggested follow-ups, interview summary | FUTURE (V3) |
| FR-025 | Candidate Scorecard | Technical knowledge, problem solving, communication, answer relevance, coding, behavioral, integrity risk. **AI scores must be human-reviewable** | FUTURE (V2/V3) |

---

## 6. Non-Functional Requirements

| ID | Requirement | Stated target / constraint |
|----|-------------|----------------------------|
| NFR-001 | **Performance** | Low-latency real-time alerts; target sub-second event notification *where technically achievable*. Actual performance **must be benchmarked** |
| NFR-002 | **Scalability** | Horizontal scaling; long-term goal thousands of concurrent candidates. **No concurrency claim may be made until load-tested** |
| NFR-003 | **Availability** | HA design for production; critical services avoid single points of failure |
| NFR-004 | **Security** | All sensitive APIs require authentication, authorization, validation, rate limiting, logging |
| NFR-005 | **Privacy** | Data minimization, appropriate consent, configurable retention, secured evidence, deletion mechanisms where required |
| NFR-006 | **Explainability** | Every AI alert carries event, confidence, evidence, context, reason |
| NFR-007 | **Accessibility** | Keyboard accessibility, screen readers where applicable, clear instructions, accommodations. **Security policies must not unfairly penalize accessibility-related behaviour** |

**Engineering performance targets (TRD §44 — "targets, not guarantees"):**
- API: `< 300 ms` for normal lightweight requests where practical
- Realtime: sub-second alert propagation
- Exam UI: responsive interaction
- AI: model latency measured independently per model

**False-positive posture (KB §43):** looking away, background noise from family/hostel/traffic/fans, and a person briefly entering the room are all normal. A single weak event is never cheating. Prioritise repeated and correlated evidence.

---

## 7. System Architecture

### 7.1 Architectural Principle (TRD §49 — binding)

> Start as a **modular monolith** where practical. Do **NOT** begin with dozens of microservices.

Initial architecture: `FastAPI + PostgreSQL + Redis + Worker + Desktop Client`.

Extract into independently scalable services **only when scale requires it**: proctoring workers, GPU inference, interview service, code execution, media processing.

### 7.2 High-Level Topology (TRD §2)

```
              Users
       ┌────────┴────────┐
 Public Website    Windows Client
       └────────┬────────┘
            API Gateway
                │
          FastAPI Backend
        ┌───────┼────────┐
      Auth    Exams    Users
        └───────┼────────┘
        Event / Realtime Layer
        ┌───────┴────────┐
 Proctoring Engine   Interview Engine
        └───────┬────────┘
            Risk Engine
      ┌─────────┼──────────┐
 PostgreSQL   Redis   Object Storage
                          └─ Evidence / Media
```

### 7.3 Event-Driven Proctoring (TRD §8, KB §45)

```
Camera → CV Processing → Detection → Structured Event
       → Redis / Event Bus → Risk Engine → Alert → PostgreSQL
```

**Hard rules:**
- Do **not** send every video frame to the backend (TRD §8).
- Do **not** send every video frame to an LLM (PRD §5, KB §44).
- Do **not** route all candidates through one server (TRD §45).
- Redis must **not** become the source of truth for critical exam results — PostgreSQL is authoritative (TRD §7).

### 7.4 Repository Structure (TRD §31–33, KB §36–37)

```
apps/
  web/                  # public website (React + Vite + Tailwind)
  desktop/              # Tauri + React + TypeScript + Rust
  admin/                # (KB §37 only — see OQ-01)
packages/
  ui/  types/  config/  # shared components, shared types, shared config
backend/
  app/
    api/  core/  models/  schemas/  services/  repositories/
    workers/  proctoring/  risk/  interview/  evaluation/
  tests/
```

Proctoring subpackage (TRD §33): `camera/ audio/ screen/ identity/ detection/ events/ evidence/`

**Structural rules:** keep business logic out of route handlers; use strict TypeScript; avoid duplicate types between frontend and backend; each detector exposes a clear interface.

### 7.5 Scalability Strategy (TRD §45)

Scale independently: API servers · realtime servers · proctoring workers · GPU workers · database · object storage. Stateless APIs, background workers, queues, connection management, DB indexing, load balancing.

### 7.6 Failure Handling (TRD §46–47)

Must handle: camera disconnect, microphone disconnect, internet interruption, WebRTC failure, backend outage, Redis outage, worker failure, model failure. The candidate must receive a clear status and critical exam state must not be lost.

Short network interruptions must not immediately destroy an exam: the desktop app maintains appropriate local session state and re-synchronizes on reconnect, subject to exam security policy. **The server remains authoritative for final exam state.** (Exact grace window and resync/conflict rules are undefined — see **OQ-07**.)

---

## 8. Technology Stack

Baseline per KB §55 and TRD §3–4. Deviations require an explicit decision record.

| Layer | Technology | Notes |
|-------|-----------|-------|
| Public web | React, TypeScript, Vite, Tailwind CSS | Lightweight, professional |
| Desktop | **Tauri** + React + TypeScript + **Rust** / native Windows APIs | Preferred, not "suggested" |
| Backend | Python + FastAPI + Pydantic + SQLAlchemy + Alembic | Modular monolith first |
| Database | PostgreSQL | Authoritative store |
| Cache / bus | Redis | Cache, short-lived session state, rate limiting, pub/sub, realtime state, queues |
| Object storage | AWS S3 (preferred) | Signed URLs; buckets never public |
| Computer vision | OpenCV, MediaPipe, YOLO, PyTorch | Models must be benchmarked before production |
| LLM | "LLM API" — provider unspecified | See **OQ-09** |
| Realtime | WebRTC, WebSockets; Jitsi or LiveKit *may be evaluated* | Selection by scale/control/deployment needs |
| Infra | Docker, Docker Compose, AWS (eventually), GitHub, GitHub Actions | |
| Optional | Qdrant (only if RAG needed), Prometheus, Grafana, OpenTelemetry | |
| Future broker | Kafka / RabbitMQ / Redis Streams | **Do not introduce Kafka merely because the platform is meant to scale** (TRD §36) |

---

## 9. Security Architecture

### 9.1 Authorization (TRD §27)

RBAC **plus** organization-level authorization. Every protected request must verify, server-side:

1. Identity → 2. Role → 3. Organization → 4. Resource ownership/access

**Never rely on frontend authorization or frontend tenant filtering** (TRD §6, §27).

### 9.2 API Security (TRD §28, KB §41)

HTTPS · JWT/session security · input validation · rate limiting · secure headers · CORS policy · request size limits · file validation · audit logging · secret management. Least privilege; encryption in transit; encryption at rest where appropriate; dependency scanning; container security; secure file uploads; sandboxed untrusted code; session integrity; tamper detection.

**Never** store passwords in plaintext. **Never** hardcode secrets or commit API keys to Git — use environment variables / secrets management.

### 9.3 Session Security (TRD §29)

Exam sessions carry: unique session ID, candidate ID, exam ID, start timestamp, end timestamp, server-side state, session token, integrity status. Important exam events are audit logged.

### 9.4 Audit Logging (TRD §30)

Audit: login, logout, exam creation, exam modification, candidate assignment, exam start, exam submission, proctoring events, **evidence access**, result modification, admin actions. Logs must be **append-oriented and protected from unauthorized modification** (enforcement mechanism unspecified — **OQ-12**).

### 9.5 Privacy Architecture (TRD §42, KB §42)

Sensitive data requires access controls, encryption, retention policy, audit logging and controlled deletion. Obtain appropriate consent; clearly communicate what is collected; minimize collection; define and allow org-specific retention; protect stored evidence; avoid unnecessary biometric storage; separate identification data from analytics where practical.

> Compliance requirements must be reviewed for the deployment jurisdiction and use case. **No compliance certification is claimed by any source document** — none may be claimed in code, UI or marketing. See **OQ-13**.

### 9.6 Security Honesty Rules (PRD FR-013, TRD §13, KB §5, §17)

- Never advertise an "unbreakable" exam environment.
- Do not claim a browser/JavaScript app can provide OS-level security; high-security features require native desktop capabilities.
- Security functionality must be tested against realistic bypass attempts, and technical limitations must be documented.
- Balance security and candidate experience — do not create restrictions that generate large numbers of false positives or block legitimate candidates (TRD §48).

### 9.7 Security Testing (TRD §41)

Authentication, authorization, API penetration testing, desktop security testing, session hijacking, tampering, file upload, dependency scanning, container scanning, code-execution sandbox tests.

---

## 10. AI/ML Architecture

### 10.1 Proctoring Pipeline (TRD §9)

```
Camera → Frame Capture → Preprocessing
       → [ YOLO: object detection | MediaPipe: face/pose ]
       → Event Builder → Risk Engine → Evidence Engine → Alert/Storage
```

### 10.2 Model Responsibilities

- **OpenCV** — frame processing, image manipulation, camera utilities, preprocessing
- **YOLO** — object detection. Candidate classes: person, cellphone, laptop, tablet, monitor, book, headphones, calculator. *Do not invent unsupported classes without matching model/training support.*
- **MediaPipe** — face landmarks, pose, head orientation, gaze-related features
- **PyTorch** — custom models, training, inference, future anomaly detection
- **LLMs** — interview conversation, question generation, answer analysis, report generation, evidence summarization, contextual reasoning. LLMs receive **structured context, never raw video**.

### 10.3 Model Replaceability (TRD §34)

Models sit behind interfaces so they can be swapped: `ObjectDetector ← YOLODetector`, `FaceDetector ← MediaPipeFaceDetector`, `RiskModel ← RuleBasedRiskEngine`. Detector interfaces: `ObjectDetector`, `FaceDetector`, `GazeDetector`, `AudioDetector`, `ScreenMonitor`, `IdentityVerifier`. **Do not tightly couple the platform to one model.**

### 10.4 AI Quality Requirements (TRD §40)

Every production detection model must be evaluated on: precision, recall, F1, false-positive rate, false-negative rate, inference latency — across varied lighting, camera quality, backgrounds, noise levels, device types and candidate positions.

### 10.5 Audio Pipeline (TRD §11)

```
Microphone → Audio Capture → Voice Activity Detection → Speaker Analysis → Audio Event → Risk Engine
```
Events: `VOICE_DETECTED`, `MULTIPLE_SPEAKERS`, `UNKNOWN_SPEAKER`, `SUSPICIOUS_AUDIO`. Noise suppression and environment calibration should be considered.

### 10.6 Identity Pipeline (TRD §14)

```
Candidate → ID Capture → Face Detection → Face Embedding → Comparison → Liveness → Identity Result
```
Results: `VERIFIED` · `MISMATCH` · `FAILED` · `REVIEW_REQUIRED`. Biometric data handled per applicable privacy requirements; perfect recognition is never claimed. Embedding model and liveness technique are unspecified — **OQ-04**.

### 10.7 AI Interview Architecture (TRD §23–24)

```
Question → Candidate Answer → Speech-to-Text → LLM → Answer Evaluation
        → Follow-up Generation → Next Question
```
Copilot input: candidate answer, interview question, conversation history. Output: technical assessment, missing concepts, suggested follow-up, communication observations, summary. **AI assists; it must not independently make irreversible hiring decisions.**

Interview topics (KB §33): DSA, OOP, OS, DBMS, Computer Networks, System Design, ML, DL, NLP, CV, LLMs, behavioural.

### 10.8 AI Fairness Constraints (KB §34)

Do not infer candidate quality from protected or irrelevant characteristics. **Avoid simplistic facial-emotion-based hiring decisions.**

---

## 11. Desktop Application

**Stack:** Tauri + React + TypeScript + Rust / native Windows APIs where required.
**Platform:** Windows. No macOS or Linux client is specified in any source document (**Constraint C1**).

> The desktop application must **not** be treated as a normal website wrapped in an executable (KB §5).

**Responsibilities (TRD §3.2):** authentication, system verification, secure exam mode, camera, microphone, screen capture, exam UI, local security checks, session communication.

**Potential capabilities (KB §5, TRD §13):** full-screen exam environment, restricted navigation, exam-escape restriction, application-switch detection, display-change detection, clipboard/copy-paste restrictions, right-click restriction where appropriate, suspicious system-state detection, process/application state monitoring, exam client tamper detection, session integrity, permission enforcement, network status monitoring.

**Client-generated screen events (TRD §12):** `WINDOW_CHANGED`, `DISPLAY_CHANGED`, `APPLICATION_CHANGED`, `COPY_ATTEMPT`, `PASTE_ATTEMPT`, `SCREEN_CAPTURE_STOPPED`. The server receives and evaluates events; **do not upload the complete desktop continuously** unless the assessment policy explicitly requires it.

**Candidate flow (PRD §7):** Website → Download → Install → Launch → Login → System Check → Identity Verification → Environment Check → Exam Instructions → Secure Exam Mode → Examination → Submission → Processing → Result/Status.

---

## 12. Web Application

**Stack:** React + TypeScript + Vite + Tailwind CSS. Lightweight and professional.

**Responsibilities (TRD §3.1, KB §4):** landing page, product explanation, features, security explanation, documentation, system requirements, Windows download, version information, contact/about.

**Possible future pages:** pricing, organization signup, developer documentation, privacy policy, security documentation.

> ⚠️ The public website is **NOT** the primary examination environment (KB §4).

> ⚠️ **Unresolved:** the PRD header states the primary platform is "Windows Desktop + **Web Admin Portal**", but TRD §3.1 scopes the web app to marketing/documentation only and TRD §31 lists only `apps/web` and `apps/desktop`. KB §3 and §54 place admin role selection and the admin dashboard **inside the desktop application**, while KB §37 suggests a separate `apps/admin`. This must be resolved before any admin UI work — see **OQ-01**.

**UI/UX direction (KB §57):** modern, clean, professional, security-oriented, minimal decoration, strong information hierarchy, responsive dashboards. Avoid generic "AI glowing" aesthetics. Key surfaces: student dashboard, admin dashboard, live proctoring dashboard, candidate investigation page, interview room, interview copilot, analytics, evidence timeline.

**Product honesty rule (KB §56):** build a real product, not a demo of fake buttons. No fake analytics, fake AI scores, fake proctoring events, hardcoded candidate lists, pretend security, or placeholder "AI detected cheating" logic. Mock data is acceptable early **only when explicitly marked as mock and isolated** so it can be replaced.

---

## 13. Backend

**Python + FastAPI**, with Pydantic, SQLAlchemy and Alembic.

**Responsibilities (TRD §4):** authentication, user management, organization management, exam management, question management, candidate management, exam sessions, results, proctoring events, risk scores, interviews, reports.

**API surface (TRD §26) — version from the beginning:**

```
/api/v1/auth          /api/v1/users         /api/v1/organizations
/api/v1/exams         /api/v1/questions     /api/v1/candidates
/api/v1/sessions      /api/v1/proctoring    /api/v1/evidence
/api/v1/risk          /api/v1/interviews    /api/v1/evaluations
/api/v1/reports
```

**Asynchronous processing (TRD §35):** heavy work goes to workers — video processing, evidence generation, report generation, AI evaluation, code execution, large media processing. The API must remain responsive.

**Job infrastructure (TRD §36):** Redis-based queue initially; Kafka/RabbitMQ/Redis Streams only when throughput and operational requirements justify it.

**Coding execution (TRD §25, FR-020):**

```
Candidate → Code Submission → API → Job Queue → Sandbox Worker → Compiler/Runtime → Tests → Result
```
**Never execute arbitrary candidate code inside the primary FastAPI process.** Isolation options: containers, microVMs, dedicated sandbox workers. Security testing is mandatory. Candidate languages may include C, C++, Java, Python, JavaScript, Go.

---

## 14. Database

**PostgreSQL** is the authoritative store.

**Core entities (TRD §5, KB §38):**
`User` · `Organization` · `Role` · `Exam` · `Question` · `QuestionOption` · `ExamQuestion` · `CandidateExam` · `ExamAttempt` · `Answer` · `Submission` · `ProctoringSession` · `ProctoringEvent` · `Evidence` · `RiskScore` · `Interview` · `InterviewParticipant` · `InterviewEvent` · `InterviewEvaluation` · `Report` · `AuditLog`

**Potential future entities (KB §38):** `Device` · `Session` · `QuestionBank` · `CodeSubmission` · `CollusionCluster`

**Design principles (TRD §6):**
- Every tenant-sensitive table is associated with an organization where applicable
- Tenant isolation is designed in **from the beginning** (KB §39) — one organization must never reach another's data
- Authorization enforced server-side; never rely on frontend filtering
- Use foreign keys, unique constraints, check constraints, indexes, transactions
- UUIDs for externally exposed identifiers where appropriate
- Avoid excessive database queries

**Storage split (KB §47, TRD §17–18):** PostgreSQL holds metadata, references, events, scores and reports. Object storage holds video, audio, screenshots and evidence clips. **Large files are never stored directly in PostgreSQL.**

**Redis (TRD §7):** caching, short-lived session state, rate limiting, pub/sub, realtime state, event queues where appropriate. **Redis is never the permanent source of truth for critical exam results.**

---

## 15. Real-Time Communication

### 15.1 WebSockets (TRD §19–20)

Used for: live proctoring alerts, candidate status, risk-score updates, interview signaling where appropriate. Admin receives events without refreshing the page.

```
Proctoring Worker → Redis/Event Bus → Risk Engine → WebSocket → Admin Dashboard
```

> **Do not use WebSockets as the media transport for video** (TRD §20).

### 15.2 WebRTC (TRD §21)

Handles live video, live audio and screen sharing for interviews. Signaling may use WebSocket or HTTP. **STUN/TURN infrastructure is required** for reliable connectivity. Possible platforms: self-hosted WebRTC, LiveKit, Jitsi — selected by scale, control and deployment requirements (**OQ-08**).

> **WebRTC is the communication layer, not the security layer.** It does not weaken the security model by itself; proctoring runs independently (TRD §21, KB §30).

### 15.3 Live Interview Security (TRD §22)

```
WebRTC Media + Screen Monitoring + Camera Monitoring + Audio Monitoring + Identity
   → Proctoring Engine → Risk Engine → Interviewer Alert
```
The interviewer receives risk-level alerts (e.g. *"Medium Risk — Additional person detected"*) and **must not receive raw sensitive information unless permitted by policy**.

---

## 16. Proctoring and Evidence Pipeline

### 16.1 Proctoring Inputs (KB §12)

1. Camera/video · 2. Audio · 3. Screen · 4. Browser/application activity where technically possible · 5. Exam interaction behaviour · 6. Identity signals

### 16.2 Event Model (FR-014, KB §18)

```json
{
  "event_type": "PHONE_DETECTED",
  "timestamp": "...",
  "confidence": 0.94,
  "source": "yolo",
  "severity": "medium"
}
```
Required fields (FR-014): event ID, session ID, event type, timestamp, confidence, severity, detection source, evidence reference. **All events must be timestamped.**

**Event-type catalogue (KB §18, §10, §15, §16, TRD §12):**
`FACE_VERIFIED` · `FACE_MISSING` · `FACE_MISMATCH` · `MULTIPLE_FACES` · `LIVENESS_FAILED` · `PHONE_DETECTED` · `TABLET_DETECTED` · `EXTRA_PERSON` · `EXTRA_MONITOR` · `GAZE_DEVIATION` · `HEAD_POSE_DEVIATION` · `UNKNOWN_VOICE` · `VOICE_DETECTED` · `MULTIPLE_SPEAKERS` · `SUSPICIOUS_AUDIO` · `SCREEN_CHANGED` · `SCREEN_CAPTURE_STARTED` · `SCREEN_CAPTURE_STOPPED` · `APPLICATION_CHANGED` · `WINDOW_CHANGED` · `UNAUTHORIZED_APPLICATION` · `SUSPICIOUS_BROWSER_ACTIVITY` · `TAB_SWITCH` · `COPY_ATTEMPT` · `PASTE_ATTEMPT` · `NETWORK_CHANGE` · `DISPLAY_CHANGE` · `DISPLAY_CHANGED` · `EXAM_CLIENT_VIOLATION` · `ROOM_SCAN_COMPLETE` · `ADDITIONAL_PERSON_DETECTED` · `ADDITIONAL_MONITOR_DETECTED`

> ⚠️ The catalogue contains near-duplicates across documents (`DISPLAY_CHANGE`/`DISPLAY_CHANGED`, `SCREEN_CHANGED`/`WINDOW_CHANGED`, `EXTRA_PERSON`/`ADDITIONAL_PERSON_DETECTED`, `EXTRA_MONITOR`/`ADDITIONAL_MONITOR_DETECTED`). A single canonical enum must be defined — **OQ-05**.

### 16.3 Risk Engine (TRD §15–16, KB §19–21)

The risk engine is **independent of individual AI models**. Initial version is **rule-based and deterministic**; ML-based anomaly scoring is a future step. *Do not start with an unnecessarily complex ML model.*

Inputs considered: event severity, confidence, frequency, duration, recency, correlation, candidate context, exam policy.

Output shape:
```json
{
  "risk_score": 78,
  "risk_level": "HIGH",
  "reasons": ["Phone detected", "Repeated gaze deviation", "Unknown voice detected"]
}
```

Example starting weights — **configuration, not permanent truths** (TRD §16):
`Phone = +30` · `Extra Person = +40` · `Face Missing = +15` · `Application Switch = +20` · `Unknown Voice = +20` · `Gaze Deviation = +5`

Repeated events may increase the score; normal behaviour may decay risk over time where appropriate. Risk calculations must remain explainable. (Decay function, score cap and deduplication are unspecified — **OQ-06**.)

**Risk levels (KB §20):** `LOW` (normal or weak isolated anomaly) · `MEDIUM` (repeated suspicious behaviour) · `HIGH` (multiple correlated suspicious events) · `CRITICAL` (strong evidence requiring immediate review).

> ⚠️ The named levels (4) do not map cleanly onto the suggested bands (5: Normal/Low/Medium/High/Critical) in PRD FR-015 and KB §20 — see **OQ-02**.

### 16.4 Explainable Alerts (KB §21 — core design principle)

Never display only *"CHEATING DETECTED"*. Alerts must render as:

```
HIGH RISK EVENT
Time: 14:32:18
Evidence:
  • Phone detected
  • Candidate gaze directed toward phone
  • Unknown voice detected
  • Application change detected
Confidence: 87%
Recommended action: Review the session segment between 14:30 and 14:34.
```

### 16.5 Evidence Engine (TRD §17, KB §22)

```
Event → Evidence Capture → Object Storage → Evidence Metadata → PostgreSQL
```
PostgreSQL stores: evidence ID, event ID, storage location, timestamp, type, **hash**, metadata. Object storage (AWS S3 preferred) holds screenshots, video clips, audio evidence, interview recordings and generated reports, served through **signed URLs**; buckets are never public. Avoid unnecessary continuous storage when event-based evidence suffices. Retention is configurable.

### 16.6 Forensic Replay & Human Review (KB §23–24)

Reviewers see a session timeline (e.g. `10:02 Identity verified → 10:10 Exam started → 10:19 Gaze deviation → 10:27 Phone detected → 10:27 Unknown voice → 10:31 Application switch → 10:45 Normal`). Clicking an event opens the corresponding evidence directly. Workflow: *AI detects → creates evidence → calculates risk → human reviews → Confirm / Dismiss / Escalate.*

### 16.7 Collusion & Code Similarity (KB §26, §28 — future)

Collusion signals: answer similarity, submission timing, navigation patterns, device metadata where permitted, network metadata where permitted, identical unusual wrong answers, behavioural synchronization. Output is a *suspicious candidate cluster* with reasons. **IP address alone must never be used to accuse a candidate.** Code similarity uses AST, structural similarity, token similarity and embeddings where appropriate; **similarity does not prove cheating**.

---

## 17. Development Phases

TRD §50–57 is the authoritative phase plan. KB §7–8 and §59 and PRD §13 describe the same trajectory with different groupings.

| Phase | Scope (TRD) | PRD release | KB level |
|-------|-------------|-------------|----------|
| **1** | Public website → download → Windows desktop app → login → role selection → Student/Admin dashboards. Backend: FastAPI + PostgreSQL + Redis. **No complex AI.** | MVP | L1 |
| **2** | Exam creation → question bank → candidate assignment → exam session → timer → submission → results | MVP | L1 |
| **3** | System check, camera, microphone, screen, identity, secure exam mode | V1 | L2 |
| **4** | YOLO, MediaPipe, audio detection, screen events, event engine, risk engine, evidence, admin monitoring | V1 | L3–L4 |
| **5** | Coding assessments, collusion detection, advanced analytics | V2 | L5 |
| **6** | WebRTC, live interview, screen sharing, interview security, interview reports | V2 | L6 |
| **7** | AI interviewer, adaptive questions, interview copilot, AI evaluation, candidate scorecard | V3 | L7 |
| **8** | Multi-tenancy, AWS scaling, GPU cluster, advanced observability, enterprise security | V3 | L8 |

**Current milestone (KB §54):** `Download → Install → Login → Dashboard` — public website, Windows download, Windows installer, desktop application, login, Student/Admin role selection, and the corresponding dashboard. **No advanced AI required.**

> ⚠️ PRD §13 groups coding assessments **and** live interviews together in V2; TRD splits them into phases 5 and 6, and the repo's existing `Roadmap.md` puts live interviews *before* intelligence features — three different orderings. See **OQ-10**.

### Engineering Rules (TRD §58, KB §52–53)

1. Read `CLAUDE.md` before development · 2. Read the PRD before implementing product features · 3. Read the TRD before changing architecture · 4. Inspect existing code before editing · 5. Avoid unnecessary rewrites · 6. Implement incrementally · 7. Write tests with features · 8. Run tests after changes · 9. Update documentation · 10. Never hardcode secrets · 11. Never execute untrusted code directly · 12. Never claim unsupported security capabilities · 13. Keep AI models replaceable · 14. Keep security decisions explainable · 15. Preserve backwards compatibility where practical.

Additionally: do not rewrite working systems unnecessarily; do not introduce new frameworks without reason; do not install large dependencies without evaluating necessity; do not create duplicate services, models or interfaces; do not silently change architecture. **Never respond to a large feature request by implementing the entire platform** — break it into architecture / backend / frontend / AI / testing / integration and implement incrementally. **If a feature conflicts with the architecture, explain the conflict before changing the architecture.**

### Git Workflow (KB §51)

Meaningful conventional commits — `feat: add student authentication`, `fix: resolve exam timer synchronization`, `docs: add system architecture`, `test: add exam submission tests`. Do not create meaningless commits to inflate commit count.

---

## 18. Testing Requirements

**Definition of Done (TRD §59)** — a feature is *not* complete merely because code exists. It is complete when: implementation exists · API works · UI works where applicable · tests exist · tests pass · error handling exists · security considerations are addressed · documentation is updated · existing functionality still works.

| Area | Required tests |
|------|----------------|
| Backend | Unit, integration, API tests |
| Frontend | Component tests, E2E tests |
| Desktop | Installation, permission, camera, microphone, screen capture, secure-mode tests |
| AI | Precision, recall, F1, false-positive rate, false-negative rate, inference latency — across lighting, camera quality, backgrounds, noise, device types, candidate positions |
| Load | Concurrent candidates, event throughput, WebSocket connections, database load, GPU workers, evidence upload |
| Security | Authentication, authorization, API penetration, desktop security, session hijacking, tampering, file upload, dependency scanning, container scanning, code-execution sandbox |

---

## 19. Deployment Requirements

**Development:** Docker Compose — frontend, backend, PostgreSQL, Redis, worker.

**Production (potential, TRD §37, KB §48):**
```
Cloud Load Balancer → API Cluster → Redis → PostgreSQL → Worker Cluster → GPU Workers → Object Storage
```
AWS is the initial target cloud. Production deployment is introduced **after the local architecture is stable**.

**CI/CD (TRD §38):** GitHub Actions should eventually run lint, type checking, unit tests, integration tests, build, security scanning and Docker image build. **Deployment occurs only after required checks pass.**

**Observability (TRD §43, KB §49):** structured logging, metrics, distributed tracing, error monitoring; model inference latency, queue latency, GPU utilisation, proctoring event counts, WebRTC connection quality. Potential stack: Prometheus + Grafana + OpenTelemetry.

---

## 20. Future Features

- Coding assessments: editor, multiple languages (C, C++, Java, Python, JavaScript, Go), compilation, test cases, hidden tests, runtime/memory limits, submission history, sandboxed execution
- Code similarity detection (AST, structural, token, embeddings)
- Collusion detection and suspicious candidate clustering
- Question-leak monitoring (KB §59, Level 5)
- Live human interviews: WebRTC, screen sharing, chat, notes, timer, optional recording, interview proctoring, interview reports
- AI interviewer (adaptive questions, difficulty adjustment) and AI interview copilot
- AI proctor copilot — prioritises candidates for human review across a live cohort
- Candidate scorecards with integrity risk dimension
- Additional question types: coding, aptitude, case studies
- Enterprise multi-tenancy runtime, organization administration, retention policies, billing, integrations
- `SUPER_ADMIN` and Organization Administrator roles
- Advanced analytics and dashboards
- Website pages: pricing, organization signup, developer documentation, privacy policy, security documentation
- Infrastructure: GPU cluster, AWS horizontal scaling, advanced observability, message broker (Kafka/RabbitMQ/Redis Streams), Qdrant vector DB if RAG is required
- Future entities: `Device`, `Session`, `QuestionBank`, `CodeSubmission`, `CollusionCluster`
- ML-based risk scoring (statistical models, gradient boosting, anomaly detection)

---

## 21. Open Questions / Decisions Required

Each item blocks or materially shapes implementation. **None may be resolved silently in code** — resolve with the product owner and record the decision.

### Contradictions between documents

**OQ-01 — Where does the Admin/Proctor UI live? (BLOCKING before any admin UI work)**
PRD header: *"Primary Platform: Windows Desktop + Web Admin Portal."* TRD §3.1 scopes the web app to landing/docs/download only, and TRD §31 lists only `apps/web` and `apps/desktop`. KB §3 and §54 place role selection and the Admin dashboard **inside the desktop application**; KB §37 suggests a third `apps/admin`. Options: (a) admin as authenticated routes in `apps/web`, (b) separate `apps/admin`, (c) admin inside the desktop client. Impacts routing, auth/session storage, WebSocket alerting target, and the live proctoring dashboard (TRD §19 draws WebSocket → *Admin Dashboard*, implying a browser surface).

**OQ-02 — Risk level taxonomy and band mapping.**
PRD FR-015 defines four bands (0–25 Normal, 26–50 Low, 51–75 Medium, 76–100 High). KB §20 defines four *named levels* (LOW, MEDIUM, HIGH, CRITICAL) and then maps 76–100 to "High/Critical depending on policy". "Normal" is not a named level and `CRITICAL` has no band. A single canonical enum and band table is required before the risk engine is built.

**OQ-03 — Role enum.**
PRD §6.5 describes an Organization Administrator not present in any enum; KB §6 omits `PROCTOR` from initial roles while KB §40 includes it. Decide the canonical `Role` enum and whether Org Admin === `SUPER_ADMIN`.

**OQ-05 — Canonical proctoring event enum.**
Near-duplicate event names appear across PRD/TRD/KB (see §16.2). One authoritative enum, with severity and default risk weight per type, must be defined before the event engine ships.

**OQ-10 — Phase ordering: coding assessments vs live interviews.**
PRD V2 bundles both; TRD assigns coding to phase 5 and interviews to phase 6; the repo's `Roadmap.md` orders interviews before intelligence features. Confirm the authoritative sequence (TRD assumed unless overridden).

### Architectural decisions not made in any document

**OQ-04 — Face recognition and liveness technology.**
TRD §14 requires face embeddings, comparison and liveness, but no embedding model or liveness technique is named anywhere (MediaPipe provides landmarks, not recognition). Needs model selection, accuracy benchmarking, licensing review, and a biometric-storage decision (KB §42: *avoid unnecessary biometric storage*).

**OQ-06 — Risk engine mathematics.**
Weights are given as examples only. Undefined: decay function and half-life, score cap/clamping, event deduplication window, per-exam policy overrides, and how confidence modulates weight. Required before FR-015/FR-016.

**OQ-07 — Offline tolerance policy.**
TRD §47 allows short interruptions with local state and resync, while FR-006 requires a server-authoritative timer. Undefined: maximum offline grace window, buffered-event ordering/trust on resync, conflict resolution, and whether the exam auto-terminates past a threshold.

**OQ-11 — Where does camera CV inference run? (HIGH IMPACT)**
TRD §8 forbids sending every frame to the backend; TRD §9/§37 imply GPU worker inference; KB §45 sketches `Candidate → WebRTC/media pipeline → AI processing workers`. Neither document states definitively whether camera inference runs **on-device** (Tauri/Rust, local models) or **server-side** (GPU workers). This determines bandwidth cost, GPU spend, tamper resistance (on-device inference is attacker-controlled), privacy posture, and the media transport in **OQ-14**. Decide before phase 4.

**OQ-14 — Proctoring media transport.**
No ingest path is specified for candidate camera/audio → proctoring workers. WebRTC is only described for interviews (TRD §21). Options: WebRTC/SFU ingest, periodic chunked HTTPS upload of frames/clips, or on-device inference with events-only upload (see OQ-11).

**OQ-08 — WebRTC platform and TURN.**
Self-hosted vs LiveKit vs Jitsi is explicitly left open (TRD §21), as is STUN/TURN hosting. Affects cost, operational load and interview recording capability.

**OQ-09 — LLM provider and model.**
KB §55 lists only "LLM API". Provider, model, data-processing terms (candidate answers are personal data), cost model, latency budget and fallback behaviour are all undecided. Required before phase 7.

**OQ-12 — Audit log immutability mechanism.**
TRD §30 requires append-oriented, tamper-protected logs but names no mechanism (append-only table with revoked UPDATE/DELETE grants, hash chaining, WORM object storage, external log sink). Also required: evidence chain-of-custody beyond the single `hash` field in TRD §17, which matters if results are disputed.

**OQ-13 — Privacy/regulatory baseline.**
KB §42 defers compliance to the deployment jurisdiction. Undecided: target jurisdictions, biometric-consent flow and wording, default retention periods, data-subject deletion workflow, and whether audio recording is permitted per jurisdiction. **No compliance certification is claimed by any source document and none may be claimed in product surfaces.**

### Missing requirements (not covered by any document)

**OQ-15 — Notifications.** Exam scheduling, candidate assignment/invitation and result publication all imply email or in-app notification, but no notification service, template or provider is specified anywhere.

**OQ-16 — Account lifecycle.** FR-001 covers login/logout/password security but not registration, invitation, password reset, MFA, account lockout or session revocation. Candidate provisioning (self-signup vs admin-created vs bulk import) is undefined.

**OQ-17 — Answer-key exposure.** No document states that correct answers must not be delivered to the client. Given a Tauri/WebView client, question delivery must omit answer keys and evaluation must be server-side; confirm and specify.

**OQ-18 — Subjective answer evaluation.** G5 and KB §8 require automatic evaluation, but grading of short/long answers is unspecified (manual admin grading vs LLM-assisted vs rubric). Affects the `Answer`/`Submission` model and results finalization.

**OQ-19 — Randomization semantics.** FR-002 requires question randomization but does not state whether option order is shuffled, whether the seed is per-candidate and reproducible, or how randomized ordering is represented in `ExamQuestion`/`ExamAttempt` for later review.

**OQ-20 — Development object storage.** AWS S3 is preferred for production; the Docker Compose stack in TRD §37 lists no storage service. A local S3-compatible equivalent must be chosen for development.

### Technical risks

**R-01 — Secure exam mode effort.** Tauri ships a WebView2-based UI; meaningful OS-level lockdown (application/process monitoring, display detection, tamper detection, clipboard control) requires substantial native Rust/Win32 work. Both TRD §13 and KB §17 warn against claiming unbreakable environments. Scope conservatively, test against realistic bypass attempts, and document limitations publicly.

**R-02 — Accessibility vs secure exam mode.** NFR-007 forbids penalizing accessibility-related behaviour, yet a screen reader is another running application and assistive behaviour can resemble gaze deviation or application switching. An accommodations mechanism (policy exemptions, allow-listed assistive processes, flagged-not-scored events) is required but unspecified.

**R-03 — Model licensing.** The documents name "YOLO" without specifying an implementation or licence. Common YOLO distributions carry copyleft licences that are incompatible with closed commercial distribution. Verify licence terms for every model before production use — this is a legal gate, not a preference.

**R-04 — GPU cost and capacity.** If OQ-11 resolves to server-side inference, per-candidate GPU cost becomes the dominant scaling constraint at the "thousands of concurrent candidates" target (NFR-002). Requires a cost model and a frame-sampling strategy before phase 4.

**R-05 — False-positive budget.** KB §43 and TRD §48 make false positives a primary product risk, but no acceptable false-positive rate is defined. Detection precision and FPR are listed as success metrics (PRD §12) with no thresholds — set targets before enabling automated alerting.

**R-06 — Windows-only reach.** No macOS/Linux client is specified; candidates on other platforms cannot take exams. Confirm this is acceptable for the target customers, and state the constraint on the public website's system requirements page.

---

## Repository Conformance Notes

Observations about the repository as of this analysis. These are **not** requirement changes — they are discrepancies to reconcile.

1. **Document paths differ from the request.** Actual files are `docs/PRD/AssessX Product Requirements.pdf`, `docs/TRD/AssessX — Technical Requirements Document.pdf`, `docs/Knowledge-Base/AssessX Master Project Knowledge Base.pdf` — not `AssessX-PRD.pdf` / `AssessX-TRD.pdf` / `AssessX-Knowledge-Base.pdf`.
2. **Nested root.** The project lives under `AssessX-AI-main/`, not at the workspace root, and is not yet a git repository.
3. **`README.md` conflicts with the PRD/TRD.** It describes a **web** "Candidate App" as the exam interface, omits Tauri/Rust and the Windows desktop client entirely, and states quantified business claims ("95%+ reduction in remote assessment fraud", "70% faster recruitment/screening cycles"). The PRD and TRD explicitly forbid unvalidated claims (NFR-002, TRD §13, TRD §44). The README should be reconciled with the desktop-first architecture and the claims removed or clearly labelled as aspirational.
4. **`docs/Roadmap.md` is titled "ExamGuard Roadmap"** — a different product name — and its phase ordering differs from TRD §50–57 (see **OQ-10**).
5. **No `CLAUDE.md` exists,** although TRD §58 rule 1 requires reading it before development.
6. **No application code exists yet.** Phase 1 has not started.

---

## Source Documents

| # | Document | Path | Authority |
|---|----------|------|-----------|
| 1 | **PRD** — Product Requirements Document v1.0 | `docs/PRD/AssessX Product Requirements.pdf` | **Authoritative for product requirements and intended product behaviour.** Defines goals, non-goals, users, flows, FR-001…FR-025, NFR-001…NFR-007, success metrics and release strategy. Product-behaviour conflicts resolve in favour of the PRD. |
| 2 | **TRD** — Technical Requirements Document v1.0 | `docs/TRD/AssessX — Technical Requirements Document.pdf` | **Authoritative for technical architecture and implementation requirements.** Defines architecture, stack, database, event/risk/evidence design, API structure, security, phases, testing, deployment and engineering rules. Architecture conflicts resolve in favour of the TRD. |
| 3 | **Knowledge Base** — AssessX Master Project Knowledge Base | `docs/Knowledge-Base/AssessX Master Project Knowledge Base.pdf` | **Supporting product and technical knowledge.** Provides context, rationale, design philosophy, UI/UX direction, long-term roadmap and worked examples. It elaborates on the PRD and TRD — it is **not** licence to invent requirements. Where it conflicts with the PRD or TRD, the conflict is flagged rather than silently adopted. |

### Rules of use

- The PDFs are the source material. This file is a **working summary** and may be stale; verify against the PDFs before any significant decision.
- **Flag, never silently change.** If an implementation decision conflicts with the PRD or TRD, raise the conflict and get it resolved; do not alter the requirement in code or in this file.
- **Invent nothing.** Customers, statistics, certifications, security guarantees, integrations and features that are not documented must not be introduced — in code, UI, documentation or marketing copy.
- Do not claim performance, concurrency, accuracy or security properties that have not been measured (NFR-001, NFR-002, TRD §13, §40, §44).
- When this file is updated, cite the source document and section for every substantive statement.
