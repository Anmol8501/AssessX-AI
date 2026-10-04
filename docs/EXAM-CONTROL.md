# Exam rules, warnings and exam control (lock / unlock / end)

**Status:** implemented 2026-10-02 at the product owner's request. Applies to **proctored** exams.

The product owner's decisions:

| Question | Decision |
|---|---|
| What does "lock" mean? | **Freeze.** The candidate sees a lock screen and cannot answer or submit. The clock keeps running. An administrator can **unlock** (the candidate continues) or **end the exam** (the saved answers are submitted and graded). |
| What is a tab switch? | Leaving the exam window for **more than 2 seconds**: Alt+Tab, the Windows key, another app, clicking outside, or minimizing. Shorter blips (a Windows notification or popup) don't count. |
| How many? | **2 warnings; the 3rd switch locks the exam automatically.** |
| Can a lock be undone? | **Yes**, by any administrator. The count is kept, so the next switch after an unlock locks again. |
| AI observations | **Warnings only, never a lock.** Detections can be wrong (lighting, glasses, camera angle). |

## What the candidate sees

* **Before the exam** (the proctoring check), the **exam rules**:
  * stay in the exam window (2 warnings, then the 3rd locks the exam);
  * keep your face in view;
  * only you;
  * face the screen;
  * no shortcuts or copying (Ctrl, Alt, the Windows key, copy/paste, screenshots, right-click);
  * stay in fullscreen.

  The screen now says truthfully that a supervisor may watch the camera live and that events are
  recorded, never video or audio. The earlier sentence "the picture is shown only to you" had been
  inaccurate since live monitoring was added.
* **On returning from a tab switch:**
  * after the 1st: "Warning 1 of 2: you left the exam window", with how many warnings are left;
  * after the 2nd: "Warning 2 of 2", stating that the next time locks the exam;
  * the candidate confirms with "I understand".
* **When locked:** a full-screen "Your exam is locked" with the reason ("You left the exam window 3
  times", or "The exam supervisor has locked your exam"). It says the answers are saved and the clock
  keeps running. The administrator's note is never shown.
* **While the camera AI observes something**, a plain instruction for as long as it lasts:
  * "We can't see your face…";
  * "More than one person is visible…";
  * "Please face the screen…";
  * too dark, too far or too close.

  Each adds "The exam supervisor is notified." Looking away (GAZE_AWAY) stays off in the AI
  configuration, as before, so it appears only in the rules.
* Blocked keyboard shortcuts now say: "Keyboard shortcuts (Ctrl, Alt and the Windows key) are not
  allowed during this exam." In the installed app, the native keyboard hook also blocks Alt+Tab, the
  Windows key, Alt+F4 and Ctrl+Esc during a proctored exam. Anything that still takes focus away from
  the exam (another app's window, a click outside, minimizing) counts as a tab switch.

## What the administrator sees and does

In **Live monitoring**, each tile shows **"Exam locked"** while an attempt is on hold. The candidate's
detail view has an **Exam control** section:
* the tab-switch count and the warnings used;
* the lock state;
* **Lock exam** (with an optional note visible only to administrators);
* **Unlock exam**;
* **End exam** (confirmed; it submits and grades the saved answers).

## How it works

* **The server counts.** The app already reports `FOCUS_REGAINED` with how long it was away. The
  server counts a switch when that is over 2000 ms, in the same transaction that records the event,
  with the attempt row locked. The count lives on the attempt (`tab_switch_count`), so the client
  cannot reset it.
* **On hold** is an open attempt with `held_at` and `hold_reason` (`TAB_SWITCH_LIMIT` or `ADMIN`) set:
  * saving an answer or submitting is refused (409 `attempt_on_hold`);
  * proctoring events are still recorded, but no further switches are counted;
  * if time runs out while held, the attempt ends as `TIME_EXPIRED` as usual.
* **Ending by an administrator** sets `SUBMITTED` and `ended_by_id`, ends proctoring and grades the
  attempt, all in the same transaction.
* **Delivery to the candidate's app** has three paths, so a missed one never leaves the screen wrong:
  1. a live push on the proctoring socket (`ATTEMPT_CONTROL`);
  2. a re-read of the attempt's clock (`GET …/attempts/{id}/session`, which now carries `control`)
     2.5 s after a long absence, every 5 s while locked, and on any save refused with
     `attempt_on_hold`;
  3. the attempt itself (`control`) on reload.
* **Audit.** `ATTEMPT_HELD` records the reason, the trigger (`AUTOMATIC` or `ADMIN`), the tab-switch
  count and the note's length (never its text). `ATTEMPT_RELEASED` records the reason and how long it
  was held. `ATTEMPT_ENDED_BY_ADMIN` records whether it was on hold.

## API

Admin only (`AdminUser`: a candidate gets 403, anonymous gets 401):

| Method & path | |
|---|---|
| `GET /api/v1/admin/attempts/{id}/control` | the count, the hold, who held it and the note, who ended it |
| `POST /api/v1/admin/attempts/{id}/hold` | `{note?}` (strict, ≤ 500 characters); idempotent |
| `POST /api/v1/admin/attempts/{id}/release` | idempotent |
| `POST /api/v1/admin/attempts/{id}/end` | submits and grades the saved answers; idempotent |

Candidate: `control` is on `GET /candidates/me/attempts/{id}` and `…/session`. Each monitoring tile
carries `tab_switches`, `tab_switch_limit`, `on_hold`, `hold_reason` and `held_at`.

## Database (migration `0019_exam_control`)

* New columns on `assessment_attempts`:
  * `tab_switch_count` (default 0, CHECK ≥ 0);
  * `held_at`, `hold_reason` (CHECK, and consistent with `held_at`);
  * `held_by_id` (→ users, SET NULL), `hold_note` (≤ 500);
  * `ended_by_id` (→ users, SET NULL).
* The audit-action CHECK is widened by the three new actions. The downgrade removes those audit rows
  first.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_exam_control.py` | 8 | the 2 s grace; two warnings then an automatic hold; no save or submit while held, events still recorded, no further counting; the frozen attempt is still IN_PROGRESS; admin hold with a private note (not in the candidate's view or the audit), idempotent hold and release, the count kept; the next switch after a release holds again; admin end submits and grades, is idempotent, and nothing can be held or released after it; time running out while held; the wall's tile; access (candidate 403, anonymous 401, unknown 404, strict input 422) |
| existing suites | 410 | attempts, exam session, proctoring, events, monitoring, realtime, evaluation, migrations, risk, evidence, review, AI events and authorization still pass |
| `apps/desktop/src/features/proctoring/environment/__tests__/examControl.test.ts` | 5 | the rule wording (2 warnings, the 3rd locks, Windows key); no "everything is recorded"; a non-accusing instruction for every AI observation; the wall reads the control fields (with safe defaults); "Exam locked" comes first on the tile |
| `apps/desktop/e2e/exam-control.spec.ts` | 2 | rules before the exam; a 0.5 s blip is ignored; Warning 1 of 2, Warning 2 of 2 (last), then the lock screen; released, the candidate continues. An administrator locks from monitoring with a note (never shown to the candidate), unlocks, and ends the exam |

## Known limitations

* **A determined candidate can still cheat with a second device.** Rules and warnings deter; they
  don't make cheating impossible. The camera, AI warnings and live monitoring are the other layers.
* **Leaving and never coming back** isn't counted until the candidate returns, because the count comes
  from the return. The administrator still sees "focus lost" live, and can lock or end the exam.
* **Locking is for proctored exams**, where the app tracks the window. Unproctored exams have no window
  tracking.
