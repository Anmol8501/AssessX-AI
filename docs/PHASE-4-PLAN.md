# Phase 4 — Basic Proctoring & Live Monitoring (4A, 4B, 4B.5 and 4C implemented)

**Status:** **4A is implemented** (2026-09-24): proctored assessments, the proctoring session
lifecycle, the camera/microphone readiness check and device-state reporting. **4B is implemented**
(2026-09-25): exam environment enforcement and the proctoring event log — see
[4B — implementation record](#4b--implementation-record), including what is *not* enforced.
**4B.5 is implemented** (2026-09-25): Device Readiness (Standard mode) and the Secure Kiosk foundation (Mode B) — see [4B.5](#4b5--device-readiness--secure-kiosk-foundation-implemented-2026-09-25). **4C is implemented** (2026-09-25): admin live monitoring — active-session wall, candidate detail view, live state over WebSocket, and a WebRTC signaling/media foundation (real media unverified). See [4C](#4c--live-admin-monitoring-foundation--implemented). **Phase 4 is complete.** Phases 1–3 are
complete. Decisions taken during 4A are recorded under [Open items](#open-items).

This is the product owner's plan, recorded as given. It sits alongside `DEVELOPMENT-ROADMAP.md` (the
agreed phase order), `PHASE-2-PLAN.md` and `PHASE-3-PLAN.md`, and does not replace the
PRD/TRD/Knowledge Base, which remain the source of truth for *what* is built and *how*. Conflicts
with those documents are listed under [Open items](#open-items); they are flagged, not resolved.

## Goal

By the end of Phase 4, AssessX should be able to:

```
Start a proctored exam → access camera/microphone → monitor the exam environment
→ detect basic suspicious environment events → maintain a live proctoring session
→ allow an Admin to monitor candidates live.
```

**No AI yet.** Phase 4 builds the infrastructure and foundation that the later AI proctoring phase
will consume.

| Part | Name | Main purpose |
|------|------|--------------|
| 4A | Proctoring Session Foundation | Camera, microphone, permissions and session lifecycle |
| 4B | Exam Environment Enforcement | Fullscreen, focus/tab/window events and the proctoring event pipeline |
| 4C | Live Admin Monitoring Foundation | Admin sees active candidates and their live proctoring state |

---

## 4A — Proctoring Session Foundation ✅ implemented

Implemented as: `proctoring_sessions` + `assessments.proctoring_required` (migration `0010`),
`backend/app/services/proctoring.py`, `backend/app/api/v1/proctoring.py`, and
`apps/desktop/src/features/proctoring/`. Endpoints and behaviour: `backend/README.md` →
*Proctoring sessions (Phase 4A)*. Nothing is recorded or uploaded; there is no lockdown and no AI.

**Goal:** connect the candidate's exam attempt with a proper proctoring session.

Today:

```
Candidate → Start Exam → Answer Questions → Submit → Evaluate → Result
```

After 4A:

```
Candidate → Start Exam → Initialize Proctoring Session → Camera/Mic → Exam
```

### 4A.1 Proctoring session

Every exam attempt that requires proctoring has a corresponding session.

```
Exam Attempt
     ↓
Proctoring Session
     ↓
Camera · Microphone · Device State · Session State
```

The session holds: session ID, attempt ID, candidate ID, started time, current state, camera state,
microphone state, connection/session health, ended time. This is the foundation for everything
later.

### 4A.2 Camera access

The candidate is asked for camera permission when starting the exam. The app handles: permission
granted, permission denied, camera unavailable, camera disconnected, camera stopped, camera
recovered.

There is a clear candidate-facing camera preview:

```
Camera
┌─────────────────────┐
│                     │
│    LIVE PREVIEW     │
│                     │
└─────────────────────┘
● Camera Connected
```

This is **not** face detection. It only establishes "do we have a working camera stream?"

### 4A.3 Microphone access

AssessX knows whether the microphone is available, permission granted, permission denied,
disconnected, active/inactive. **No** speech recognition, voice analysis or emotion detection.

### 4A.4 Device/session state

AssessX maintains basic state and knows when it changes:

```
Camera       CONNECTED
Microphone   CONNECTED
Session      ACTIVE
Exam         IN_PROGRESS
```

e.g. `Camera DISCONNECTED` — the system records that this happened.

### 4A.5 Candidate experience — proctoring readiness screen

Before entering the exam:

```
        Proctoring Check

Camera          ✓ Ready
Microphone      ✓ Ready
Exam Session    ✓ Ready

        [ Continue ]
```

If something isn't working:

```
Camera          ✕ Not detected

Please connect a camera before
starting your examination.

        [ Retry ]
```

### 4A.6 Integration with Phase 3 (critical)

Phase 4A must connect with the existing exam lifecycle. Instead of `Start Attempt → Exam`:

```
Start Attempt
     ↓
Create Proctoring Session
     ↓
Perform Device Checks
     ↓
Start Proctoring
     ↓
Enter Exam
```

When the exam ends:

```
Submit / Timeout
       ↓
End Proctoring Session
       ↓
Finalize Attempt
       ↓
Evaluate
       ↓
Result
```

### 4A.7 Not in 4A

Face detection · face recognition · multiple-person detection · phone detection · object detection
· gaze tracking · head-pose analysis · AI cheating detection · risk scoring · WebRTC live admin
streaming.

### 4A completion condition

A candidate can start a proctored exam and AssessX reliably knows **who** is taking the exam,
**which attempt** they are taking, **whether their camera/mic are available**, and **whether their
proctoring session is active**.

---

## 4B — Exam Environment Enforcement ✅ implemented (with documented limits)

Implemented as: `proctoring_events` (migration `0011`), `backend/app/services/proctoring_events.py`,
`POST /candidates/me/attempts/{id}/proctoring/events`, the native lockdown in
`apps/desktop/src-tauri/src/lockdown/`, and `apps/desktop/src/features/proctoring/environment/`.
What is blocked, detected, best-effort or not enforceable is in the
[implementation record](#4b--implementation-record) below.

4A answers *"Is the candidate's proctoring session running?"* 4B answers *"What is happening to the
exam environment?"*

### 4B.1 Fullscreen enforcement

```
ENTER FULLSCREEN → EXAM → candidate exits fullscreen → EVENT GENERATED (FULLSCREEN_EXIT)
```

An event is **not** automatically "cheating". It is an observable event; the later risk engine can
correlate it with other signals.

### 4B.2 Focus / visibility monitoring

Detect when the exam loses focus (`WINDOW_FOCUS_LOST`) and when the candidate returns
(`WINDOW_FOCUS_REGAINED`).

### 4B.3 Tab/window/application events

Depending on what Tauri/Windows can reliably observe, establish the foundation for: application
focus changes, exam window losing focus, returning to the exam, minimize/maximize, fullscreen
changes, relevant desktop/window state.

**Do not pretend the desktop app can know everything happening on Windows. Record only events that
can actually be observed reliably.**

### 4B.4 Proctoring event pipeline (one of the most important pieces of Phase 4)

Instead of every feature calling its own API, one common concept:

```
Camera ─┐
Microphone ─┤
Fullscreen ─┼──→ PROCTORING EVENTS ──→ Backend / Event Store
Focus ─┤
Window ─┘
```

Examples: `CAMERA_CONNECTED`, `CAMERA_DISCONNECTED`, `MIC_CONNECTED`, `MIC_DISCONNECTED`,
`FULLSCREEN_ENTERED`, `FULLSCREEN_EXITED`, `FOCUS_LOST`, `FOCUS_REGAINED`.

Later phases add AI events (`FACE_NOT_DETECTED`, `MULTIPLE_FACES`, `PHONE_DETECTED`,
`LOOKING_AWAY`) to the same pipeline, and the risk phase consumes all of them.

### 4B.5 Event metadata

```
Event
 ├── ID
 ├── Session
 ├── Candidate
 ├── Attempt
 ├── Type
 ├── Timestamp
 ├── Source
 └── Metadata
```

e.g. `FULLSCREEN_EXITED · 12:43:18 · Source: Desktop Environment`. This becomes the raw material for
the evidence timeline.

### 4B.6 Candidate-facing warnings

Some events immediately inform the candidate — "⚠ Please return to fullscreen mode.", "⚠ Camera
connection lost. Please reconnect your camera." — but not every event becomes a scary warning. The
system distinguishes **technical state** from **suspicious behaviour**.

### 4B.7 Session recovery

```
Camera disconnect → Retry → Camera reconnect → Session continues
```

Short network interruptions must not unnecessarily destroy an exam attempt.

### 4B.8 Not in 4B

AI · YOLO · OpenCV detection · face detection · phone detection · gaze estimation · risk scores ·
cheating classification · human-review evidence dashboard. 4B is basic, deterministic monitoring.

### 4B completion condition

AssessX can reliably record **what happened to the candidate's exam environment and when it
happened**.

---

## 4C — Live Admin Monitoring Foundation ✅ implemented

Implemented as: `app/realtime/` (in-process hub + typed messages + notify bridge),
`app/services/monitoring.py` + `app/repositories/monitoring.py` + `app/schemas/monitoring.py`,
`app/api/v1/admin_monitoring.py` (REST) and `app/api/v1/ws.py` (WebSockets), and
`apps/desktop/src/features/admin/monitoring/` + the candidate publisher in
`apps/desktop/src/features/proctoring/environment/useMediaPublisher.ts`. No database migration —
it reuses `assessment_attempts`, `proctoring_sessions` and `proctoring_events`.

### Architecture

```
candidate exam (ProctoredExam/EnforcedExam)         admin wall (LiveMonitoringPage)
  │  REST actions (activate, report devices, event)   │  GET /admin/monitoring/sessions  (initial)
  ▼                                                    ▼
ProctoringService ── notify ──► MonitoringHub (in-process) ──► WS /ws/admin/monitoring ──► grid + detail
  │  (best-effort deltas; DB authoritative)            ▲
  ▼ DB (attempts, proctoring_sessions, events)         │  reconnect → REST refetch → reconcile
                                                        │
candidate media ── WebRTC ──(signaling relayed by hub over the two WebSockets)──► admin viewer
```

* **What is "live".** An active attempt (`IN_PROGRESS`) whose proctoring session is `ACTIVE`.
  Unproctored, not-yet-activated and finished attempts never appear. This reuses the existing
  Phase 4A/4B lifecycle; no new state was invented.
* **State sync.** REST gives the initial wall and the detail view; one admin WebSocket then delivers
  `SESSION_ADDED/UPDATED/REMOVED` and `PROCTORING_EVENT` deltas. The database stays authoritative —
  the client reconnects with bounded backoff and re-fetches to reconcile, so a missed message never
  leaves stale state. Events are the existing Phase 4B/4B.5 events; no second event table or service.
* **Media stays off the REST/WS/DB path.** Live video/audio travel peer-to-peer over **WebRTC**; the
  WebSocket carries only signaling (offer/answer/ICE) and state, and the database stores no media.
  The candidate publisher reuses the camera/microphone streams the proctoring check already opened
  (no second `getUserMedia`). Live video is established from the **detail view** (one candidate at a
  time), so the wall does not hold up to sixteen simultaneous connections; grid tiles show state and
  a "open to view video" placeholder.
* **Authorization is server-side.** The REST endpoints are admin-only (`AdminUser`); the admin
  WebSocket rejects a candidate/anonymous token; the candidate WebSocket is bound to *its own*
  active attempt (resolved from the token), so signaling is only ever relayed along a validated
  admin ↔ candidate pairing — a candidate cannot address another candidate, and an admin can only
  watch a currently active monitorable session.
* **Factual only.** Statuses and event labels are technical ("Fullscreen exited", "Camera issue",
  "Copy blocked"), conveyed with icon + text (never colour alone). There is no risk, suspicion,
  confidence or verdict anywhere — Phase 4C has no AI. Audio is muted by default and only plays when
  the admin turns it on in the detail view; nothing is recorded.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/admin/monitoring/sessions` | Active proctored sessions + a factual summary (admin only) |
| `GET` | `/api/v1/admin/monitoring/sessions/{attempt_id}` | One session's state + recent events (admin only) |
| WS | `/api/v1/ws/admin/monitoring?token=` | Admin: session/event deltas and WebRTC answer/ICE relay |
| WS | `/api/v1/ws/candidates/me/proctoring?token=&attempt_id=` | Candidate: WebRTC offer/ICE relay for its own attempt |

### Limitations (documented, not hidden)

1. **Realtime is process-local.** There is no Redis or external broker in this build, so the
   WebSocket hub is in-memory and live monitoring works within one backend process only; multi-
   instance horizontal realtime is **not** supported. The database (via REST) remains authoritative,
   so correctness does not depend on realtime delivery.
2. **Real WebRTC media is NOT verified.** The signaling relay, the candidate publisher and the admin
   viewer are implemented and the offer/answer/ICE path is exercised by tests, but live camera media
   between two machines was not tested here (single dev machine, headless WebView2, no STUN/TURN
   deployed). ICE servers are configurable via `VITE_ICE_SERVERS`; the default is host candidates
   only. Production needs STUN, and NAT traversal needs **TURN, which has not been tested**. The UI
   shows honest "Connecting… / unavailable / connection failed" states and never fakes video.
3. **One viewer per candidate.** Live video is negotiated for a single watching admin (the detail
   view). A second concurrent viewer of the same candidate is out of scope.
4. **Connection status is best-effort.** A tile's "Live/Offline" reflects the admin's own WebSocket,
   not a per-candidate heartbeat; a candidate that drops its network is reflected when its session
   state changes or on the next reconcile.

### Not implemented (later phases)

No AI proctoring, face/object/gaze detection, risk/evidence/scoring, recording or screenshots, no
intervention tools (force-logout, terminate, message, remote control), no organization system, and
no changes to the kiosk or keyboard work. Phase 4C is a read-only monitoring foundation.


Connect the candidate-side proctoring system to the Admin side.

### 4C.1 Admin live monitoring

```
Admin Dashboard
 ├── Assessments
 ├── Candidates
 ├── Results
 └── Live Monitoring
```

Live Monitoring shows currently active exam sessions.

### 4C.2 Candidate monitoring grid (4 × 4)

```
┌──────┬──────┬──────┬──────┐
│ C01  │ C02  │ C03  │ C04  │
├──────┼──────┼──────┼──────┤
│ C05  │ C06  │ C07  │ C08  │
├──────┼──────┼──────┼──────┤
│ C09  │ C10  │ C11  │ C12  │
├──────┼──────┼──────┼──────┤
│ C13  │ C14  │ C15  │ C16  │
└──────┴──────┴──────┴──────┘
```

Initially, do not worry about high-quality live video — build the monitoring architecture and UI
first.

### 4C.3 Candidate status

Each tile shows a basic status: Active · Camera Issue · Microphone Issue · Fullscreen Exit ·
Disconnected · Finished. These are **states/events, not AI cheating judgments**.

### 4C.4 Candidate detail view

Clicking a candidate opens:

```
┌──────────────────────────────┐
│       Candidate View         │
└──────────────────────────────┘
Candidate: C07
Exam: Java Assessment

Camera:       Connected
Microphone:   Connected
Session:      Active
Fullscreen:   Active

Recent Events
─────────────────────────────
12:42:10  Fullscreen entered
12:43:18  Focus lost
12:43:21  Focus regained
```

Later phases add face/people/phone/gaze/risk — not yet.

### 4C.5 Live state synchronization

The admin should not have to refresh constantly; the foundation supports near-real-time updates:

```
Candidate App → Backend → Live Session State → Admin Monitoring
```

This is where WebSockets/realtime communication eventually becomes important.

### 4C.6 Live video architecture (important architectural decision)

**Do not send raw camera video through normal FastAPI REST endpoints.** Media and metadata travel
separately:

```
Candidate Camera → WebRTC / Media Layer → Admin Monitoring      (media)
Proctoring Events → FastAPI → Event Store                        (events/metadata)
```

This separation matters once there are 16+ simultaneous candidates.

### 4C.7 Admin controls

At this stage the admin can: view active candidates, open candidate details, see session state, see
technical/environment events, see when candidates disconnect, see when exams finish. **No
complicated intervention tools yet.**

### 4C.8 Not in 4C

AI proctoring · face recognition · phone detection · gaze tracking · automatic cheating verdicts ·
risk score · evidence scoring · AI explanations.

---

## The complete Phase 4 flow

```
                 CANDIDATE
                     │
                 Start Exam
                     │
             Proctoring Check
                     │
               Camera + Mic
                     │
             Proctoring Session
                     │
                Exam Starts
                     │
       ┌─────────────┼─────────────┐
    Camera         Focus       Fullscreen
       └─────────────┼─────────────┘
                     ▼
             Proctoring Events
                     │
                  Backend
               ┌─────┴─────┐
         Session State    Events
               └─────┬─────┘
                     ▼
               ADMIN MONITOR
            ┌────────┴────────┐
         4×4 Grid      Candidate Detail
```

## What comes after Phase 4

```
CAMERA → face presence · multiple people · phone detection · object detection · head pose · gaze
       → AI PROCTORING → suspicious events → correlation engine → risk assessment
       → evidence timeline → HUMAN REVIEW
```

This is why AI is not rushed into Phase 4.

## Final Phase 4 structure

- **4A — Proctoring Session Foundation:** camera + microphone + permissions + session lifecycle +
  device state.
- **4B — Exam Environment Enforcement:** fullscreen + focus/window events + environment monitoring +
  unified proctoring event pipeline.
- **4C — Live Admin Monitoring Foundation:** candidate session states + 4×4 monitoring dashboard +
  candidate detail view + real-time state synchronization + foundation for WebRTC.

---

## 4B — implementation record

### Architecture

```
exam page (ProctoredExam → EnforcedExam)
  ├─ in-page guards ── keydown / copy / cut / paste / contextmenu / beforeprint / blur / focus
  ├─ native bridge ─── Tauri commands: lockdown_engage · lockdown_release ·
  │                    lockdown_restore_fullscreen · environment_snapshot
  │                    events: lockdown://shortcut · lockdown://window
  └─ event reporter ── throttle → queue (localStorage) → POST …/proctoring/events (retry, idempotent)
                                                              │
backend: validate type + per-type metadata allow-list → record with server time → proctoring_events
         (+ server-recorded SESSION_STARTED/RESUMED/ENDED and CAMERA_/MIC_ DISCONNECTED/RECONNECTED)
```

Enforcement starts when the proctoring session is active and the paper is shown, and is released
when that screen unmounts — submission, timeout, or leaving. Any page load also releases the native
lockdown (`on_page_load`), so a reload or crash cannot leave Windows locked. In a plain browser (dev
server, Playwright) the native half does not exist and is reported `UNAVAILABLE`.

### Enforcement matrix

Statuses: **BLOCKED** (prevented, verified) · **DETECTED** (recorded, not prevented) ·
**BEST-EFFORT** (attempted, not verified or not complete) · **NOT ENFORCEABLE**.

| Capability | Status | Mechanism | Verified by |
|---|---|---|---|
| Fullscreen | **BLOCKED** leaving it (exam covered until return); exit **DETECTED** | Tauri `set_fullscreen` (desktop) / HTML Fullscreen API (browser); restore prompt; one automatic restore per return | Native: engaged and read back in the real app. Browser: E2E |
| Always-on-top | Applied (**BEST-EFFORT**: the call succeeded; the window style was not read back while engaged) | `set_always_on_top` | Native: call succeeded in the real app; released afterwards (read back as not topmost) |
| Focus loss (Alt+Tab, click away, minimize) | **DETECTED** — `FOCUS_LOST` / `FOCUS_REGAINED` with duration | window `blur`/`focus`, native focus/minimize events | E2E (synthetic blur/focus) |
| Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+Shift+V / Ctrl+Insert / Shift+Insert / Shift+Delete | **BLOCKED** + recorded | keydown `preventDefault`, `copy`/`cut`/`paste` events cancelled, `user-select: none` | E2E |
| Clipboard contents | Never read, never stored | — | Backend allow-list refuses any content field |
| Right-click / context menu | **BLOCKED** + recorded | `contextmenu` cancelled | E2E |
| Ctrl+P / print | Shortcut **BLOCKED**; other print routes **BEST-EFFORT** (a dialog could open, but the print stylesheet blanks the exam) | keydown `preventDefault`, `beforeprint` recorded, `@media print` hides content | E2E (shortcut) |
| DevTools (F12, Ctrl+Shift+I/J/C, Ctrl+U) | **BLOCKED** in release builds (DevTools are not compiled into release Tauri); shortcuts cancelled + recorded in all builds | Tauri build config; keydown `preventDefault` | E2E (shortcuts); crate source for the release gating |
| Browser navigation / tabs / find / reload (Ctrl+L/R/T/N/W/F/S/O, Ctrl+Tab, Ctrl+1–0, Alt+←/→, F1–F11, Backspace) | **BLOCKED** + recorded | keydown `preventDefault` | E2E (Ctrl+F, F5, Ctrl+R) |
| Alt+Tab, Alt+Esc, Ctrl+Esc, Alt+Space, Windows key, Win+Tab, Win+D (+ all Win+… shortcuts) | **NOT ENFORCEABLE from a normal app** — Windows overlay appears and another app can take keyboard focus; leaving the window is **DETECTED** (`FOCUS_LOST`) and the exam is covered until return | — (Windows reserves these; the low-level hook did not receive them while AssessX was foreground) | **Physical keyboard, real app** (2026-09-25): each opened its Windows UI; typing reached a hidden Notepad/Chrome. Only Secure Kiosk Mode prevents this |
| Alt+F4 | **BLOCKED** (exam page cancels it) | in-page keydown `preventDefault` | Physical keyboard: AssessX did not close, recorded `KEYBOARD_RESTRICTION_ATTEMPT` |
| Print Screen / Win+Shift+S | Capture of the exam window **BLOCKED** (excluded from capture); the key itself BEST-EFFORT as above | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, read back to confirm | Real app: affinity read back as excluded |
| Other screen capture / screen sharing (OBS, Teams, Snipping Tool) | **BLOCKED** for tools using the standard Windows capture APIs (window appears black/absent); others **NOT ENFORCEABLE** | Same display affinity (Windows 10 2004+) | Affinity read back; not tested against each tool |
| Multiple monitors | **DETECTED** — `MULTIPLE_MONITORS_DETECTED` at start, `DISPLAY_CONFIGURATION_CHANGED` (polled every 5 s). Recorded only; no policy applied | Tauri `available_monitors` | Real app: display count read (1 display — a second display was not available to test) |
| Remote Desktop (RDP) | **DETECTED** — `REMOTE_SESSION_DETECTED` | `GetSystemMetrics(SM_REMOTESESSION)` | Real app: reported `false` locally; not tested inside RDP |
| AnyDesk / TeamViewer / VNC / Chrome Remote Desktop | **NOT ENFORCEABLE / not detected** | — (they share the local console session; no reliable signal without process scanning, which was deliberately not built) | — |
| Virtual machines | **NOT detected** | — (heuristics are unreliable; not built) | — |
| Unauthorised applications | **NOT scanned**; AssessX losing the foreground is **DETECTED** | focus events only — no process list is read or uploaded | — |
| Ctrl+Alt+Delete, Win+L, Task Manager via Ctrl+Alt+Delete | **NOT ENFORCEABLE** (secure attention sequence handled by Winlogon) | — | — |
| External cameras / phones photographing the screen | **NOT ENFORCEABLE** here (out of scope for 4B) | — | — |

### Event taxonomy (`proctoring_events.event_type`)

- **Server-recorded only:** `SESSION_STARTED`, `SESSION_RESUMED`, `SESSION_ENDED`
  (`attempt_status`), `CAMERA_DISCONNECTED` / `CAMERA_RECONNECTED`, `MIC_DISCONNECTED` /
  `MIC_RECONNECTED` (`state`) — the device events come from the existing 4A device report, not a
  second client path.
- **Reported by the desktop app:** `FULLSCREEN_ENTER` / `FULLSCREEN_EXIT` / `FULLSCREEN_RESTORED`,
  `FOCUS_LOST` / `FOCUS_REGAINED` (`duration_ms`), `COPY_ATTEMPT`, `CUT_ATTEMPT`, `PASTE_ATTEMPT`,
  `CLIPBOARD_ACCESS_ATTEMPT`, `CONTEXT_MENU_ATTEMPT`, `PRINT_ATTEMPT`, `DEVTOOLS_ATTEMPT`,
  `KEYBOARD_RESTRICTION_ATTEMPT`, `SCREEN_CAPTURE_ATTEMPT` (`shortcut`, `blocked`, `channel`),
  `MULTIPLE_MONITORS_DETECTED`, `DISPLAY_CONFIGURATION_CHANGED` (`display_count`,
  `previous_display_count`), `REMOTE_SESSION_DETECTED`, `ENFORCEMENT_STATUS` (which protections
  are `ACTIVE` / `BEST_EFFORT` / `UNAVAILABLE`, and `desktop` vs `browser`).
- The server derives `category` (SESSION · DEVICE · WINDOW · INPUT · DISPLAY · SYSTEM) and `source`
  (SERVER · CLIENT). There is **no severity, score or verdict** — risk is a later phase (open item 9).

### Decisions taken during 4B

- **Items 8/9 (event names and fields):** the names above are the canonical enum for now (OQ-05 is
  otherwise still open). Events carry type, server-derived category and source, a per-type metadata
  allow-list, the server's `recorded_at`, and an optional, clearly-labelled `client_reported_at`
  kept only when plausible. FR-014's `severity`, `confidence` and `evidence reference` are **not**
  stored yet — they belong to the risk/evidence phases.
- **Item 10 (timestamps):** the server's `recorded_at` is authoritative; the client's time is kept
  separately and discarded if implausible (±5 min window).
- **Item 11 (offline):** events queue in order in `localStorage`, retry with back-off, and carry a
  `client_event_id` so a retry cannot create a duplicate. Events for an attempt that has ended are
  dropped. No new offline architecture.
- **Item 12 (what Tauri/Windows can observe):** checked in the real app — see the matrix.
- **Item 13 (audit):** the event log is append-only at the API level (no read-back, update or
  delete route for candidates); database-level immutability remains OQ-12.
- **Multiple monitors:** recorded only, with a neutral notice; no punitive policy (PRD FR-009 lists
  "additional monitor" as something to detect, and nothing defines what to do about it).
- **Duplicates:** the client folds identical events within 1.5 s; the server folds identical events
  within 1 s and caps a session at 5 000 events (`429 event_limit_reached`).
- **Test observability:** a development-only, admin-only `GET /api/v1/dev/attempts/{id}/proctoring-events`
  (absent in production, like the rest of the dev router). This is not the 4C monitoring view.

### Known limitations (4B)

1. **Windows shortcuts cannot be blocked from a normal desktop application — confirmed.** The
   low-level keyboard guard installs and is called for keys typed while another application is in
   front, but it is **not** called while AssessX is the foreground window; injected-key testing and
   then a **physical-keyboard test on the real app (2026-09-25)** both showed Alt+Tab, the Windows
   key, Alt+Esc, Ctrl+Esc, Win+Tab and Win+D all open their Windows UI, and a candidate can give
   keyboard focus to a hidden application (Notepad, a browser) and type into it. AssessX records the
   focus loss (`FOCUS_LOST`) and covers the exam until the candidate returns, but **cannot prevent
   this at the OS level.** The keyboard guard was therefore reduced from `BEST_EFFORT` to reporting
   `system_shortcut_guard: UNAVAILABLE`, and the matrix rows say NOT ENFORCEABLE. The supported fix
   is **Secure Kiosk Mode** (Phase 4B.5, Mode B): Windows Assigned Access, provisioned by an
   administrator — see [`security/WINDOWS-SECURE-KIOSK.md`](security/WINDOWS-SECURE-KIOSK.md).
   Alt+F4 is the exception: the exam page cancels it, verified with the physical keyboard.
2. Print protection is best-effort: the shortcut is blocked and the exam is blanked for printing,
   but not every route to a print dialog can be cancelled from the page.
3. Capture exclusion needs Windows 10 2004 or later and only affects tools that use the standard
   capture APIs; it is verified by reading the window's display affinity back, not by testing every
   capture tool.
4. Remote-control tools other than RDP, virtual machines and unauthorised applications are not
   detected. No process scanning was built (privacy, and unreliable).
5. Ctrl+Alt+Delete / Win+L / Task Manager cannot be intercepted by any application.
6. A second display, a real RDP session and a physical-keyboard run could not be tested here.
7. Events for an attempt that ends while the app is offline are lost (the server refuses events
   after the attempt ends).
8. `rustfmt` and `clippy` are not installed in this development toolchain, so Rust formatting and
   lint checks were not run.

### Manual smoke test (packaged Windows build)

Run on a real machine with `npm run tauri:build`'s installer (release build — DevTools are only
absent in release). Expected result in brackets: **B** blocked · **D** detected/recorded ·
**BE** best-effort · **NE** not enforceable.

1. Admin: create an assessment, tick *Require camera and microphone*, publish, assign a candidate.
2. Candidate: open the exam → **Start Exam** → proctoring check shows Camera/Microphone *Ready* (4A).
3. **Start Exam** → the window goes fullscreen and stays on top [B].
4. Ctrl+C, Ctrl+X, Ctrl+V, Shift+Insert → notice "…disabled during this assessment" [B + D].
5. Right-click on a question → no menu, notice [B + D].
6. Ctrl+P → no print dialog, notice [B + D].
7. F12, Ctrl+Shift+I → nothing opens [B in release + D].
8. Ctrl+R, F5, Ctrl+F → nothing happens [B + D].
9. **Alt+Tab, Windows key, Alt+Esc, Ctrl+Esc** → record whether they switch away. Expected today:
   they may switch away [BE — see limitation 1]; coming back shows "AssessX must remain the active
   application" and fullscreen is restored [D].
10. Print Screen / Win+Shift+S → the key may work, but the exam window is black/absent in the
    capture [B for the exam content].
11. Minimise/restore (if reachable) → "Please return to fullscreen" until restored [B + D].
12. With a second display connected (or connect one mid-exam) → neutral notice [D].
13. Ctrl+Alt+Delete → Windows security screen appears [NE].
14. Check the recorded events (development build):
    `GET /api/v1/dev/attempts/{attempt_id}/proctoring-events` as an admin, or
    `SELECT event_type, details, recorded_at FROM proctoring_events ORDER BY recorded_at;`
15. Submit → fullscreen and always-on-top end, the window behaves normally, Alt+Tab / right-click /
    Ctrl+C work again, `SESSION_ENDED` is the last event.
16. Repeat with a 1-minute exam and let it time out → same release, `SESSION_ENDED` with
    `TIME_EXPIRED`.

### 4B.5 — Device Readiness & Secure Kiosk foundation (implemented 2026-09-25)

Two capabilities, added after the physical-keyboard test showed Windows shortcuts cannot be blocked
from a normal application:

**Mode A — Device Readiness (Standard).** A pre-exam "Prepare your device" screen that detects
prohibited applications with a visible window and closes them gracefully before the exam starts.
Native, allow-list based, with a hard protected set; no force-termination; policy-id-only events.
Full detail and manual test: [`security/DEVICE-READINESS.md`](security/DEVICE-READINESS.md). New
events: `DEVICE_CHECK_STARTED`, `PROHIBITED_APP_DETECTED`, `APP_CLOSE_REQUESTED`, `APP_CLOSED`,
`APP_CLOSE_FAILED`, `DEVICE_CHECK_PASSED`, `DEVICE_CHECK_FAILED` (migration `0012`).

**Mode B — Secure Kiosk foundation.** Read-only Windows-edition/Assigned-Access compatibility
detection, and generation of an **administrator** provisioning package (Assigned Access XML +
apply/remove scripts). The app never enables kiosk mode or changes the machine; an administrator
provisions a dedicated exam machine. Full guide:
[`security/WINDOWS-SECURE-KIOSK.md`](security/WINDOWS-SECURE-KIOSK.md). The admin **Settings** page
shows the current mode (Standard vs Secure Kiosk), read from the OS.

Both preserve all existing Phase 4A/4B behaviour. Not started: 4C, AI proctoring, risk/evidence,
live monitoring.

## Open items

Recorded so they are decided deliberately rather than during implementation, per the project rule
that conflicts with the PRD/TRD are surfaced, not silently resolved. **None of them change the plan
above.** Items marked *before 4A/4B/4C* must be settled before that stage is written.

> **Decisions taken during 4A (2026-09-24):**
>
> - **Item 2 — which assessments are proctored:** one per-assessment switch,
>   `assessments.proctoring_required` (default `false`, so every existing assessment is
>   unaffected), set by an admin in the builder's Settings step. It is read once, when an attempt
>   starts: the attempt's own `proctoring_sessions` row is what makes *that* attempt proctored, so
>   changing the setting never affects a running exam. The detailed secure-exam configuration is
>   left for 4B.
> - **Item 5 — the clock:** the readiness check runs *before* the attempt is started, and the
>   attempt (with its server-fixed deadline) is created only when the candidate continues. The
>   Phase 3 timer is unchanged. A resumed attempt's clock is already running, and the check says so.
> - **Item 7 — ending on timeout:** the session is ended inside `AttemptService.settle()` and
>   `submit()`, in the same transaction that finalizes the attempt, with `ended_at` = the attempt's
>   `finalized_at` (the deadline, for a timeout). There is no client "end session" call. Like the
>   attempt itself, an abandoned session is only settled when something reads it (no worker).
> - **Lifecycle:** `NOT_STARTED` (created with the attempt) → `ACTIVE` (both devices reported
>   `READY`) → `ENDED` (attempt finalized); `NOT_STARTED → ENDED` when an attempt ends before
>   activation. Answering a proctored attempt waits for `ACTIVE` (`409 proctoring_not_active`);
>   submitting never does.
> - **Device state** is availability only — `NOT_READY` · `READY` · `DENIED` · `UNAVAILABLE` —
>   reported by the client on activation and on change. It is not verifiable server-side.
> - **Item 17 — privacy:** confirmed for 4A — no video, audio or images are stored or uploaded;
>   the readiness screen tells the candidate so.
>
> **Still open after 4A:** item 6 (what a device lost mid-exam should do — 4A only records it and
> lets the exam continue), items 1, 3, 4, 8–16 and 18. Two further points surfaced while building
> 4A:
>
> - **PRD FR-007 is broader than 4A.** FR-007's system check also lists screen capture, internet,
>   display and application-version checks; 4A covers camera and microphone only.
> - **Order of screens.** The PRD candidate flow puts *System Check* before *Exam Instructions*;
>   this plan (and 4A) runs the check after the instructions, from the Start button.

### Roadmap and scope

1. **4C overlaps roadmap Phase 5.** `DEVELOPMENT-ROADMAP.md` makes Phase 5 "Live Admin Monitoring
   (4×4 candidate video wall → click candidate → detailed live view)" and Phase 6 "AI Proctoring".
   This plan puts the 4×4 grid and candidate detail view in 4C, and refers to AI proctoring as
   "Phase 5/6" and to later additions as "Phase 6/7". Decide whether Phase 5 now means the *live
   video* layer on top of 4C (WebRTC wall), or whether the roadmap is renumbered. The roadmap table
   is **not** changed until this is decided.
2. **Which assessments are proctored (before 4A).** 4A says "every exam attempt that *requires*
   proctoring". Assessments have no proctoring setting today (Phase 2 settings cover duration,
   navigation, randomisation, window). PRD lists "configure exam + proctoring policy" as an ADMIN
   capability. Decide: a per-assessment flag (and its default for existing assessments), a policy
   object, or "all attempts are proctored".
3. **Admin vs `PROCTOR` role.** PRD/KB define a `PROCTOR` role (V1) whose job is monitoring and
   receiving alerts; this plan gives live monitoring to ADMIN only, and the backend has only ADMIN
   and CANDIDATE. Admin-only is consistent with MVP scope; confirm, and keep the permission check
   role-based so PROCTOR can be added later (OQ-03).
4. **Admin UI location (OQ-01).** Admin screens so far live in the desktop app; TRD §19 draws
   WebSocket → *Admin Dashboard*, implying a browser surface. Live monitoring is the most
   realtime-heavy admin surface, so OQ-01 remains open and relevant here.

### Phase 3 integration (before 4A)

5. **The timer starts at attempt creation.** In 3B the server fixes `expires_at` when the attempt is
   started. The 4A flow is `Start Attempt → Create Proctoring Session → Device Checks → Enter Exam`,
   so device checks and retries would consume exam time. Decide whether the readiness check runs
   *before* the attempt is started, or whether the attempt gets a pre-exam state whose clock begins
   on "Enter Exam". Either way the server must stay authoritative for the clock (FR-006).
6. **What a device failure does mid-exam.** 4A.5 blocks entry without a camera. Undecided: whether
   answering is blocked, the timer keeps running, or the attempt is flagged when the camera/mic drops
   *during* the exam, and for how long before anything escalates.
7. **Ending the session on timeout.** 3B's timeout is applied lazily by `settle()` when a request
   arrives. "Submit / Timeout → End Proctoring Session" needs the session closed in the same place,
   including when the candidate's app never contacts the server again (a session that is `ACTIVE`
   forever would show as live on the admin grid).

### Events and data (before 4B)

8. **Canonical event names (OQ-05).** This plan uses `FULLSCREEN_EXIT` and `FULLSCREEN_EXITED`,
   `WINDOW_FOCUS_LOST` and `FOCUS_LOST`, `MIC_*`; TRD §12 names client screen events
   `WINDOW_CHANGED`, `DISPLAY_CHANGED`, `APPLICATION_CHANGED`, `COPY_ATTEMPT`, `PASTE_ATTEMPT`,
   `SCREEN_CAPTURE_STOPPED`. One authoritative enum is needed before the event store's first
   migration.
9. **Event fields vs FR-014.** FR-014 specifies event ID, session ID, type, timestamp, **confidence,
   severity**, detection source and **evidence reference**. 4B.5 lists ID, session, candidate,
   attempt, type, timestamp, source, metadata. Decide whether severity/confidence/evidence-ref
   columns are created now (nullable for deterministic events) or added later. 4B.6's split between
   "technical state" and "suspicious behaviour" also suggests a category field — decide how it is
   represented.
10. **Client vs server timestamps.** Events are generated on the candidate's machine. Decide which
    clock is stored (server receipt time, client time, or both) and how buffered events are ordered
    and trusted after a reconnect (OQ-07).
11. **Offline tolerance (OQ-07, 4B.7).** "Short network interruptions shouldn't destroy an attempt"
    — the grace window, local buffering, and whether the exam auto-terminates past a threshold are
    undefined in every source document.
12. **What Tauri/Windows can actually observe (4B.3).** Before 4B, verify in the real app which of
    focus/blur, minimize, fullscreen enter/exit, display change and application switch are reliably
    reported by Tauri/WebView2, and how camera/mic permission prompts behave in WebView2. FR-013 and
    the security honesty rules forbid advertising capabilities that are not validated.
13. **Audit logging.** TRD §30 lists proctoring events among audited actions and requires
    append-oriented, tamper-protected logs (OQ-12, mechanism undecided). Decide whether the event
    store itself is append-only.

### Live monitoring and media (before 4C)

14. **Realtime transport and Redis.** TRD specifies WebSockets and Redis pub/sub for realtime state;
    the current stack has PostgreSQL only (Redis is noted as a later addition in
    `infrastructure/docker-compose.yml`). Decide whether 4C introduces Redis and a WebSocket
    endpoint, or starts with polling and adds them later. PostgreSQL stays authoritative (TRD §7).
15. **Does the 4C grid show video at all? (OQ-08, OQ-11, OQ-14).** 4A excludes "WebRTC live admin
    streaming", 4C says "initially don't worry about actual high-quality live video" and "foundation
    for WebRTC". Decide whether 4C tiles are status-only, show low-rate snapshots, or show live
    video. Any media path also depends on the undecided WebRTC platform/TURN (OQ-08), where camera
    inference will run (OQ-11 — flagged in the context doc as "decide before phase 4") and the
    proctoring media transport (OQ-14).
16. **Session health / heartbeat.** 4A.1 lists "connection/session health" and 4C shows
    "Disconnected". Decide the heartbeat interval and the silence threshold after which a session is
    shown as disconnected.
17. **Privacy and consent (NFR-005, OQ-13).** The readiness screen is the natural place to tell the
    candidate what is collected. Decide the consent wording, and confirm that Phase 4 **stores no
    video, audio or images** (events only) — if anything is recorded, retention and access control
    are required first.
18. **Scale claims.** The plan mentions "16+ simultaneous candidates". No concurrency figure may be
    claimed in the product or docs before load testing (PRD/TRD rule).
