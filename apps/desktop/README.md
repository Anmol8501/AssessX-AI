# AssessX — Windows Desktop Application

The AssessX product. The public website (`apps/web`) only markets and
distributes this application; the examination environment, proctoring and
dashboards live here (see `docs/PROJECT-CONTEXT.md` §11 and
`docs/DEVELOPMENT-ROADMAP.md`).

Stack: Tauri 2 (Rust shell, WebView2) · React 19 · TypeScript · Vite 8 ·
Tailwind CSS 4 · React Router 7. Design tokens mirror the public site so the
two surfaces read as one product.

## Current stage — Phase 2C: publishing & candidate assignment

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
duration, marks, attempts, availability and instructions; **Start Exam** is deliberately disabled and
says that taking an exam arrives in Phase 3, and the API never sends a candidate the questions or the
answer key. The dashboard's **Completed** card stays empty on purpose: nothing is submitted or skipped until exams can be taken in Phase 3.

Still deliberately absent: exam attempts, scoring, results, proctoring, organisation settings. Those screens render
"coming soon" states naming their phase — never fake data.

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
  pages/        not-found
src-tauri/      Rust shell, tauri.conf.json, capabilities, icons
e2e/            Playwright end-to-end tests (Phase 1B sign-in cases, 2A authoring, 2B builder,
                2C publish → assign → candidate sees it)
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

`e2e/auth.spec.ts`, `assessments.spec.ts`, `builder.spec.ts` and `publishing.spec.ts` drive the real UI
against the real backend. To make the sign-in security
check solvable, the tests call the backend's development-only `POST /api/v1/dev/login-challenges`
(which returns a challenge together with its answer — never mounted in production) and serve that
challenge to the UI; the backend still verifies the typed answer for real.

The app icon is generated from `app-icon.svg` with `npx tauri icon app-icon.svg`.
