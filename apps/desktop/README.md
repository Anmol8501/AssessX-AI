# AssessX — Windows Desktop Application

The AssessX product. The public website (`apps/web`) only markets and
distributes this application; the examination environment, proctoring and
dashboards live here (see `docs/PROJECT-CONTEXT.md` §11 and
`docs/DEVELOPMENT-ROADMAP.md`).

Stack: Tauri 2 (Rust shell, WebView2) · React 19 · TypeScript · Vite 8 ·
Tailwind CSS 4 · React Router 7. Design tokens mirror the public site so the
two surfaces read as one product.

## Current stage — Phase 4C: live admin monitoring (Phase 4 complete)

```
Launch → startup session check → Welcome → Login (backend) → Admin shell | Candidate shell
```

- The login screen has a **Candidate / Administrator** switch that only picks the *form*:
  candidates sign in with university roll number + email + password (`POST /api/v1/auth/login/candidate`);
  administrators with username + email + password (`POST /api/v1/auth/login/admin`). Both forms
  include the server-issued security check. The backend verifies everything and returns a bearer token plus
  the user. **The role comes from the backend user** — picking a form cannot change it.
- The token is kept in `sessionStorage`, or `localStorage` when "Keep me signed in" is ticked
  (`src/features/session/tokenStorage.ts`). On launch the app calls `GET /api/v1/auth/me` to restore
  the session; a rejected token is discarded.
- Route guards (`RequireRole`, `RequireAnonymous`) read the single `SessionProvider` state. A
  candidate opening `#/admin` is bounced to `#/candidate` and vice versa; unauthenticated users go to
  `#/login`. Guards are navigation only — the backend enforces authorization on every API call.
- `useApi()` sends the token with every request and, on a 401 (expired / revoked session), clears
  it and returns the user to the login screen with "Your session has expired".
- Login error states: empty/invalid fields, details that do not match an account (generic — no
  account oracle; covers wrong password, roll number, username or form), inactive account, wrong
  security code (new code issued), backend unreachable.
- Admin dashboard lists accounts from the admin-only `GET /api/v1/users`; the candidate profile
  loads from the candidate-only `GET /api/v1/candidates/me`.

Assessment builder (Phase 2A/2B/2C): the admin **Assessments** area lists assessments and creates them;
opening one shows a five-step builder — **Basic information · Questions · Settings · Review · Assign**. Each
step saves explicitly, so moving between them never loses saved work, and the stepper marks any step
with outstanding readiness issues. Questions can be added, edited, previewed, duplicated, reordered
(move up/down, persisted server-side) and deleted. Settings cover attempts, navigation, randomisation,
results and an optional availability window — stored configuration only. Review summarises everything
and lists every reason the assessment cannot be marked **Ready**; the DRAFT ⇄ READY transition is
decided by the backend. Validation mirrors the backend for fast feedback; the server is authoritative.

Publishing and assignment (Phase 2C): Review offers **Publish assessment** once every readiness check
passes, behind a confirmation that spells out what publishing locks. A published assessment is
read-only — the basic information and settings forms show a locked notice and disable saving, and the
question list drops its add/edit/duplicate/delete/reorder controls — because the backend refuses those
writes; the UI only avoids offering what would fail. **Unpublish** returns it to Ready and is refused
while any candidate holds it. The **Assign** step lists who already holds the assessment and lets the
admin search and tick active candidates to assign, or unassign one behind a confirmation; before
publishing it explains that publishing comes first. Candidates themselves are created on the admin
**Candidates** page (name, roll number, email, initial password) — there is no self-registration and no
invitation email in this build. The candidate's dashboard shows the same assignments as an **Upcoming assessments** list (soonest scheduled first), and the **My Exams** page lists their own assigned exams with
duration, marks, attempts, availability and instructions. The API never sends a candidate the answer key.

Taking an exam (Phase 3): exam details → **Start Exam** → the exam window outside the shell (questions,
navigator, answers saved as they are made, a server-synchronised countdown) → submit or time-out → the
result screen. See `docs/PHASE-3-PLAN.md`.

Proctoring (Phase 4A, `src/features/proctoring/`): an assessment with **Require camera and microphone**
set in the builder's Settings step is proctored. Its **Start Exam** opens a **Proctoring check** before
any attempt exists — so the clock does not run while the candidate deals with a permission prompt — which
opens the camera (with a self-view) and the microphone (with an input-level bar), explains blocked,
missing, busy and disconnected devices, and offers **Retry**. Continuing starts the attempt and activates
its proctoring session; the exam then shows a small self-view and device status in its header, reports
availability changes to the server, and offers **Reconnect** if a device drops (the exam carries on).
Resuming a proctored exam goes through the check again. Devices are opened with the standard
`getUserMedia` inside WebView2 and released when the exam ends or the screen is left. **Nothing is
recorded or uploaded** — only whether each device is available. No lockdown, no AI: those are Phase 4B
and later.

Exam environment enforcement (Phase 4B, `src/features/proctoring/environment/` and
`src-tauri/src/lockdown/`): once a proctored exam's paper is on screen the app goes fullscreen and
on top, excludes the window from screen capture, cancels clipboard, context-menu, print,
developer-tool and browser shortcuts, tracks focus and display changes, shows short
non-accusatory notices, and reports each observation to the server (queued and retried if
offline). Everything is released when the exam ends or the screen is left, and on any page load.
The Windows keyboard guard for Alt+Tab / the Windows key is **best-effort and not proven** — see
`docs/PHASE-4-PLAN.md` → *4B — implementation record* for the full enforcement matrix and the
manual test checklist.

Live admin monitoring (Phase 4C, `src/features/admin/monitoring/`): the admin **Monitoring** page is
a live wall of candidates currently in an active proctored exam — a 4×4 grid of tiles showing
factual device/session state, with a summary and paginated beyond sixteen. Opening a tile shows a
candidate detail view with the live video (WebRTC), current status and recent proctoring events,
updating live. Initial state comes over REST; deltas arrive over one WebSocket with automatic
reconnect and reconcile. The candidate side publishes its existing camera/microphone over WebRTC
(`proctoring/environment/useMediaPublisher.ts`), reusing the streams the proctoring check already
opened. Nothing is interpreted, scored or recorded; audio is muted until the admin enables it. Real
WebRTC media is unverified (single dev machine, no STUN/TURN) and the UI shows honest connecting/
unavailable states — see `docs/PHASE-4-PLAN.md` → 4C.

Still deliberately absent: AI proctoring, risk/evidence, intervention tools, organisation settings. Those screens render "coming soon" states naming
their phase — never fake data.

API location: `VITE_API_BASE_URL`. Development reads the committed `.env.development`
(localhost, no secrets); production builds read `.env.production` (copy `.env.production.example`,
never committed). The Tauri CSP (`src-tauri/tauri.conf.json`) must allow the API origin — add the
production origin there alongside the localhost entries. Nothing in the client holds a backend
secret: every Vite env value is embedded in the bundle.

## Commands

```bash
npm install
npm run dev          # frontend only, http://localhost:1420 (works in any browser)
npm run tauri:dev    # native window (needs Rust + MSVC Build Tools, see below)
npm run build        # type-check + production build into dist/
npm run tauri:build  # Windows installer (NSIS + MSI) into src-tauri/target/release/bundle/
npm run lint         # oxlint
npx tsc -b           # type-check (app + e2e)
npm run test:e2e     # Playwright, in system Edge — needs the backend on :8000 with dev users seeded
```

### Native prerequisites (Windows)

- Rust via `rustup` (`winget install Rustlang.Rustup`)
- Visual Studio 2022 Build Tools with the "Desktop development with C++" workload
  (`winget install Microsoft.VisualStudio.2022.BuildTools`)
- WebView2 runtime (preinstalled on Windows 11; the installer bundles a bootstrapper otherwise)

## Layout

```
src/
  app/          router, route constants, error boundary, App root
  components/   icons, Logo, ui/ (design system), shell/ (sidebar + top bar frame)
  config/       app name, tagline, version
  features/
    session/    AuthClient contract, HttpAuthClient, token storage, SessionProvider, guards, useApi
    startup/    loading screen, welcome page (blue geometry + MonitorDemo animation), startup gate
    auth/       login page, security-check widget, security showcase
    admin/      admin shell, nav, pages
    assessments/ authoring: list, create, builder/ (steps, basic info, questions, settings,
                 review, assignments, locked notice, preview) and the question form
    candidate/  candidate shell, nav, pages (My Exams reads /candidates/me/assessments)
    exam/       exam details, the exam window (ExamRunner), timer, navigator, finished/result screens
    proctoring/ device checks (useMediaDevice), readiness screen, in-exam status, ProctoredExam flow;
                environment/ (4B enforcement + 4B.5 device readiness + 4C media publisher)
    admin/monitoring/ (4C: live wall, grid, tile, detail view, WebSocket + WebRTC viewer)
  pages/        not-found
src-tauri/      Rust shell (src/lockdown: 4B native lockdown), tauri.conf.json, capabilities, icons
e2e/            Playwright end-to-end tests (Phase 1B sign-in cases, 2A authoring, 2B builder,
                2C publish → assign → candidate sees it, 3A–3C exam/session/results, 4A proctoring,
                4B environment enforcement; shared set-up in proctoring-helpers.ts)
```

Routing uses hash history so it behaves identically in the Vite dev server and
inside the Tauri webview.

### Entry screen

The welcome screen uses the light theme with layered blue geometry. Its laptop mockup runs
`MonitorDemo`, a CSS/SVG animation on a
14-second cycle (flag → correlated signals → evidence → human review). It is illustrative and
labelled as such: no video file, no data, only opacity/transform animations (GPU-composited,
~60 fps, disabled under `prefers-reduced-motion`). It deliberately never says "caught" — the
product's claim is evidence plus human review, not an AI verdict.

### End-to-end tests

`e2e/*.spec.ts` drive the real UI against the real backend. To make the sign-in security
check solvable, the tests call the backend's development-only `POST /api/v1/dev/login-challenges`
(which returns a challenge together with its answer — never mounted in production) and serve that
challenge to the UI; the backend still verifies the typed answer for real.

`proctoring.spec.ts` replaces `getUserMedia` with synthetic streams (a canvas camera, an oscillator
microphone) that a test can refuse, hide or end. Edge's own fake devices are not used: once the fake
microphone opens, Edge intermittently ends the fake camera and reports no camera for the rest of the
session. Opening a real camera and microphone in the packaged app is a manual check.

The app icon is generated from `app-icon.svg` with `npx tauri icon app-icon.svg`.
