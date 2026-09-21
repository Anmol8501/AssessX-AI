# AssessX Development Roadmap

**Status:** Working development plan agreed on 2026-09-21. This is the sequence the team is building in.
**Current stage:** Phase 1A — not started. Each stage begins only when explicitly requested; do not start the next stage on your own.

The public website (`apps/web/`) is only the public download/marketing page. The actual AssessX product is the **Windows application**. From this point forward, "build AssessX" means the app; the website is the download/marketing surface only.

---

## Application flow

```
                ASSESSX WINDOWS APP
                       │
                       ▼
              ┌─────────────────┐
              │   App Start      │
              │  AssessX Intro   │
              └────────┬────────┘
                       ▼
              ┌─────────────────┐
              │      Login      │
              └────────┬────────┘
                       ▼
                 Authentication
                       │
              ┌────────┴────────┐
              ▼                 ▼
           ADMIN             CANDIDATE
              │                 │
              ▼                 ▼
        Admin Dashboard    Candidate Dashboard
              │                 │
              ▼                 ▼
         Create Exams       My Exams
              │                 │
              └────────┬────────┘
                       ▼
                  Exam System
                       │
                       ▼
                Proctoring Layer
                       │
                       ▼
                AI Proctoring
                       │
                       ▼
             Monitoring + Risk
                       │
                       ▼
                 AI Interview
```

---

## Complete roadmap

| Phase | Name | Flow |
|-------|------|------|
| 1 | App Foundation | Startup → Login → Authentication → Admin/Candidate dashboards |
| 2 | Assessment Creation | Admin → Create exam → Add questions → Configure exam → Assign candidates |
| 3 | Exam Attempt | Candidate → Assigned exam → Instructions → Exam → Questions → Submit → Results |
| 4 | Basic Proctoring | Camera + microphone + fullscreen + session monitoring + permissions + basic events |
| 5 | Live Admin Monitoring | Admin → 4×4 candidate video wall → click candidate → detailed live view |
| 6 | AI Proctoring | Face presence → multiple people → phone/object detection → gaze/head movement → suspicious events |
| 7 | Risk & Evidence | Events → correlation → risk → evidence → timeline → admin review |
| 8 | AI Interviews | Interview creation → AI interviewer → conversation → evaluation → report |
| 9 | Production | Security → scalability → performance → reliability → deployment → observability → hardening |

### Guiding principle

Phase 1 is not "let's make some screens." It is **the operating foundation on which every future AssessX feature will run.** When Phase 6 arrives, the AI must plug into the authenticated assessment/session infrastructure created in Phase 1, not be bolted onto a prototype.

---

## Phase 1 — AssessX App Foundation

```
                 PHASE 1
        ASSESSX APP FOUNDATION
                    │
       ┌────────────┼────────────┐
       │            │            │
       ▼            ▼            ▼
    Phase 1A      Phase 1B      Phase 1C
    App Shell     Auth + RBAC   Production
                                Foundation
       │            │            │
       ▼            ▼            ▼
   Startup        Login        PostgreSQL
   Welcome        Users        Migrations
   Login UI       Roles        API structure
   Navigation     Sessions     Validation
   Design System  Admin UI     Error handling
                  Candidate UI  Logging
                  Protection    Testing
```

### 🟦 Phase 1A — App Shell & Entry Experience

**Goal:** when someone launches the Windows AssessX application, it should already feel like a real professional assessment product, not a college-project prototype.

**1. AssessX startup screen** (inside the Windows app, not the website). May have subtle professional animation/loading.

```
┌──────────────────────────────────────────────┐
│                                              │
│                  ASSESSX                     │
│                                              │
│       Secure Assessment & Interview          │
│                  Platform                    │
│                                              │
│              [ Get Started ]                 │
│                                              │
│          Secure • Intelligent • Fair         │
│                                              │
└──────────────────────────────────────────────┘
```

**2. App initialization**

```
Launch → Initialize application → Check configuration → Check authentication/session → Determine state
```

- First time: `Welcome → Login`
- Returning user with an existing valid session: `Launch → Dashboard`

**3. Login screen**

```
              Welcome back

        Sign in to AssessX

        Email
        [________________]

        Password
        [________________]

        [      Sign In      ]

        Forgot password?

        Don't have an account?
             Contact Admin
```

Do not create unnecessary registration if the PRD doesn't require candidates to self-register. AssessX can later support organization-controlled accounts.

**4. Application navigation foundation** (after authentication)

```
AssessX
├── Dashboard
├── Assessments
├── Monitoring
├── Results
├── Interviews
└── Settings
```

Features that aren't implemented yet are **disabled/empty, not fake functionality.**

**5. App-wide design system** — established before building dozens of screens, because every later phase uses the same components: typography, colors, spacing, buttons, cards, inputs, dialogs, notifications, loading states, error states, empty states, sidebar, top navigation.

**Phase 1A DONE means:** you can launch AssessX and experience `START APP → WELCOME → LOGIN → APPLICATION SHELL`. No exam functionality yet.

### 🟩 Phase 1B — Authentication + Role-Based Application

The application actually understands who is using it.

```
LOGIN → Authenticate → Identify User → ADMIN     → Admin Dashboard
                                     └ CANDIDATE → Candidate Dashboard
```

**1. Real backend authentication** — `Windows App → FastAPI → PostgreSQL`. The app never decides "this person selected Admin"; **the backend determines the user's actual role.**

**2. User accounts**

```
User
├── ID
├── Name
├── Email
├── Password hash
├── Role
├── Status
├── Created at
└── Updated at
```

Roles initially: `ADMIN`, `CANDIDATE`. The authorization model can be extended later if the PRD requires additional organization/reviewer roles.

**Admin Dashboard** (after admin login)

```
┌─────────────────────────────────────────────┐
│ AssessX                         Admin ▾      │
├────────────┬────────────────────────────────┤
│ Dashboard  │       Welcome back             │
│ Assessments│       ┌─────┐ ┌─────┐          │
│ Candidates │       │  0  │ │  0  │          │
│ Monitoring │       │Exams│ │Users│          │
│ Results    │       └─────┘ └─────┘          │
│ Settings   │       Recent activity          │
│            │       No activity yet          │
└────────────┴────────────────────────────────┘
```

At this point Assessments, Candidates and Results are empty and Monitoring shows no active sessions. That is expected — the app is being prepared for Phase 2.

**Candidate Dashboard** (after candidate login)

```
┌─────────────────────────────────────────────┐
│ AssessX                     Candidate ▾      │
├────────────┬────────────────────────────────┤
│ Dashboard  │       Welcome, Candidate      │
│ My Exams   │       Upcoming Assessments    │
│ Results    │       ┌─────────────────┐     │
│ Profile    │       │ No exams yet    │     │
│            │       └─────────────────┘     │
│            │       Completed               │
└────────────┴────────────────────────────────┘
```

No actual exam yet — that comes in Phases 2/3.

**3. Role protection (critical)** — Admin: `/admin/*`, Candidate: `/candidate/*`. **The backend enforces this, not merely frontend routing.** A candidate calling an admin API gets `403 Forbidden`.

**4. Session management** — login, logout, session/token handling, session expiration, protected API requests, unauthorized handling. This is the authentication foundation for everything later.

### 🟨 Phase 1C — Production Foundation

Make the foundation robust enough to build the actual assessment system on top of it.

- **Database:** PostgreSQL with `Users`, `Roles`, authentication data, and proper migrations.
- **Backend architecture:** clean separation `API (Authentication / Users / Authorization) → Services → Database`. Not one giant `main.py`.
- **API versioning:** start with `/api/v1/auth`, `/api/v1/users`. Later: `/api/v1/assessments`, `/api/v1/questions`, `/api/v1/attempts`, `/api/v1/proctoring`, `/api/v1/monitoring`, `/api/v1/interviews`.
- **Validation:** every API request gets proper validation.
- **Error handling:** consistent `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `422 Validation Error`, `500 Internal Server Error`.
- **Logging:** structured application logging from the start — later used for login, exam sessions, proctoring, AI events, risk events, admin actions.
- **Testing:** Phase 1 already has tests for login, wrong password, logout, admin authentication, candidate authentication, role authorization, protected endpoints, invalid requests, database operations.

---

## Relationship to the source documents

This roadmap is the team's working sequence. The PRD/TRD remain the source of truth for *what* is built and *how*; this file only fixes the *order*. Divergences from the TRD phase plan (TRD §50–57, summarised in `PROJECT-CONTEXT.md` §17) are recorded here so they are decisions, not accidents:

| Topic | TRD §50–57 | This roadmap | Note |
|-------|-----------|--------------|------|
| Phase count / grouping | 8 phases | 9 phases | Proctoring is split into basic (4), live monitoring (5), AI (6) and risk/evidence (7); production hardening is its own phase (9). Same overall trajectory. |
| Live admin monitoring | Part of phase 4 ("admin monitoring") | Own phase 5, before AI proctoring | Monitoring wall is built on basic proctoring streams first; AI events are layered on afterwards. |
| Coding assessments, collusion detection, advanced analytics | Phase 5 | Not listed as a phase | **Not dropped** — PRD scope still applies; scheduling is undecided. Extends **OQ-10**. |
| Live (human) interviews via WebRTC | Phase 6 | Not listed separately; phase 8 is "AI Interviews" | Whether human live interviews ship alongside AI interviews in phase 8 or later is undecided. Extends **OQ-10**. |
| Multi-tenancy, AWS, GPU cluster | Phase 8 | Folded into phase 9 "Production" | Tenant isolation is still designed in from day one (CLAUDE.md invariant). |
| Role handling at login | "role selection" in phase 1 | Backend determines role; no client-side role picker | Consistent with TRD §27 server-side authorization. |
| Admin UI location | — | Admin dashboard lives inside the Windows app | This is a working answer to **OQ-01**; the PRD's "Web Admin Portal" wording remains unreconciled. |

The older `docs/Roadmap.md` ("ExamGuard Roadmap") predates this plan and is superseded by this file.
