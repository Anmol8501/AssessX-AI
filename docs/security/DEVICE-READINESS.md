# Device Readiness — closing prohibited applications (Phase 4B.5, Standard mode)

**Status:** implemented 2026-09-25. Part of Mode A (Standard / personal device). This is
application-level security only — it is **not** an OS lockdown. For the Windows-managed lockdown,
see [`WINDOWS-SECURE-KIOSK.md`](WINDOWS-SECURE-KIOSK.md).

## What it does

Before a proctored exam begins, AssessX checks the candidate's machine for **prohibited
applications that have a visible window** and offers to close them:

```
Start Exam ─► Device readiness ─► scan ─► prohibited apps open? ─► Close All ─► re-scan
                                                │ clean                              │
                                                ▼                                    ▼
                                    camera / microphone check (4A) ◄─────────── clean
                                                │
                                                ▼
                                    start attempt · activate session · exam (timer starts)
```

The exam attempt is not created — and the clock does not start — until the check is clean and the
camera/microphone check passes. Unproctored exams have no readiness step and are unchanged.

## Detection policy

Detection is native (`apps/desktop/src-tauri/src/readiness/`), never browser JavaScript, and is
**allow-list based**:

- Only applications listed in `readiness/policy.rs::PROHIBITED` are ever reported (browsers,
  communication, remote-control, screen-recording, AI assistants, developer tools, terminals,
  virtualization, and a few note-taking apps). The list is expandable.
- Only processes with a **visible, un-owned top-level window** are considered, so background
  helpers of an allowed program are ignored.
- A hard **protected set** (`is_protected`) is consulted first and always wins: AssessX itself and
  its web view, the Windows shell and session-critical processes (`explorer`, `dwm`, `winlogon`,
  `csrss`, `lsass`, `svchost`, …), and common security software (matched by prefix:
  `MsMpEng`, `avastsvc`, `ekrn`, `sentinel`, …). These are never reported and never closed, even if
  a future edit mistakenly added one to the prohibited list.
- Only a process's **executable name** is used to classify it. No path, command line or window
  title is read, and the backend event log stores only a policy id (e.g. `chrome`) and category.

There is **no "terminate everything unknown" path anywhere.**

## "Close All Detected Apps"

Closing is **graceful only**: each detected app's top-level window is sent `WM_CLOSE` — exactly
what clicking its ✕ does. The application may show a "save your work?" prompt and may refuse.
**No process is ever force-terminated** in this module. After a short wait AssessX re-scans and, if
anything is still open, shows "… could not be closed automatically. Please close it manually and
select Recheck." The candidate cannot continue until the re-scan is clean.

## Events

The check reports factual events through the existing Phase 4B pipeline (server-authoritative
timestamps, per-type metadata allow-list, no severity/verdict). Because the check runs before the
session exists, its observations are buffered and written once the session activates:

`DEVICE_CHECK_STARTED` · `PROHIBITED_APP_DETECTED` (`app`, `app_category`) ·
`APP_CLOSE_REQUESTED` (`app`) · `APP_CLOSED` (`app`) · `APP_CLOSE_FAILED` (`app`) ·
`DEVICE_CHECK_PASSED` / `DEVICE_CHECK_FAILED` (`app_count`).

`app` is a policy id matching `^[a-z0-9][a-z0-9._-]{0,39}$`; the backend refuses a path, a window
title or any other field (`backend/app/services/proctoring_events.py`).

## Security boundaries

- The candidate can close their own applications and recheck; they cannot mark readiness as passed
  on the server (the server only records the events), change timestamps, or edit history.
- The detection layer returns structured data (id, display name, category) to the UI — never a full
  process list or system telemetry.

## Limitations

- Only applications on the policy list are detected; an unlisted program is not reported. The list
  is a starting policy, not exhaustive, and is meant to grow.
- Detection is by **visible window** and executable name (the stem, or the stem plus a dotted
  suffix — packaged Store apps such as WhatsApp run as `WhatsApp.Root.exe`, matched via `whatsapp`).
  A prohibited program with no visible window is not listed. This is deliberate: browsers keep
  background processes running, so matching every process by name would flag Chrome/Edge even with
  no window open.
- **Apps that minimise to the system tray** (WhatsApp, Discord, Telegram) respond to the graceful
  close by hiding their window rather than exiting. Their window closes — so the desktop is clear
  and the re-scan is clean — but the process keeps running in the tray. AssessX does **not**
  force-kill it; the candidate should fully quit such apps from the tray if required by policy.
- Graceful close cannot close an app that refuses or that has unsaved-work prompts; those are
  reported for the candidate to handle.
- This does not stop the candidate re-opening an application after the check, or switching to one
  during the exam. Switching away is recorded as `FOCUS_LOST` (Phase 4B) and the exam is covered
  until they return, but only Secure Kiosk Mode prevents launching or switching at the OS level.

## Manual test (Standard mode)

1. Start AssessX (installed build) with the backend running.
2. Open **Notepad** (and optionally **Chrome**).
3. As a candidate, start a proctored exam.
4. On **Prepare your device**, verify Notepad/Chrome are listed with the right category.
5. Click **Close All Detected Apps**; confirm Notepad closes (accept any save prompt).
6. If something stays open, confirm the "could not be closed" message and that **Continue** is not
   offered; close it by hand and click **Recheck**.
7. When clean, confirm **Your device is ready**, then **Continue** → camera/microphone check.
8. Confirm the events above were recorded (`GET /api/v1/dev/attempts/{id}/proctoring-events` as an
   admin on a development build, or query `proctoring_events`).
9. Confirm an **unproctored** exam shows no readiness step.
