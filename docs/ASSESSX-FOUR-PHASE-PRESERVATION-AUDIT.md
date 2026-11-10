# ASSESSX — COMPLETE REGRESSION, BACKWARD-COMPATIBILITY & EXISTING-FUNCTIONALITY PRESERVATION AUDIT

**Date:** November 10, 2026  
**Scope:** Phases 1, 2, 3, and 4 (1A–1C, 2A–2D, 3A–3C, 4A–4C)  
**Audit Type:** Read-Only Preservation, Regression, Security & Data-Integrity Audit  
**Baseline:** `origin/main` at commit `b7f89c3` (`fix(backend): ruff format attempts.py for secondary camera orientation`)  
**Workspace Status:** Strictly unstaged/uncommitted local working tree; zero commits or pushes performed.

---

## 1. Executive Summary

This audit evaluates the AssessX codebase after implementing **Phase 1 (Workstation Provisioning, Secure Shell, Native Security Agent)**, **Phase 2 (Application Control, Utility Restrictions, Navigation/Shortcut Control, Peripheral & Remote Access Control)**, **Phase 3 (Start Authorization, Continuity/Sync, Submission & Closure Restoration)**, and **Phase 4 (Proctoring Session Foundation, Environment Enforcement, Live Admin Monitoring & WebRTC Audit)**.

### Overall Preservation Verdict: **PARTIAL PASS — CRITICAL & HIGH ISSUES IDENTIFIED (REQUIRES REMEDIATION BEFORE PRODUCTION)**

- **Existing Core Features & Routes Preserved:** Original Phase 1–8A routes, authentication (`auth.py`, `AuthService`), assessment authoring/scheduling (`assessments.py`), coding sandbox (`candidate_coding.py`), live interviews, AI proctoring detectors, and risk/review engines remain intact in the codebase. None of the prior endpoints, tables, or UI pages were deleted.
- **Zero File Deletions:** `git status` confirms **0 deleted files** and **0 renamed files** across the entire repository.
- **Critical & High Findings Uncovered During Audit:**
  1. **CRITICAL — Runtime Crash in Phase 3B/3C HMAC Signing (`submission_closure.py`, `answer_sync.py`):** Both services call `get_settings().secret_key.get_secret_value()`, whereas `Settings.secret_key` in `backend/app/core/config.py` is typed as `str` (not `SecretStr`). Calling `POST /closure/authorize` or `POST /recover` will raise `AttributeError` at runtime.
  2. **CRITICAL — Unconditional Exam Gating Regression (`ExamDetailsPage.tsx`, `authorization.py`):** Every fresh exam attempt now routes through `PreFlightReadinessModal` -> `POST /examinations/{exam_id}/authorize`, which strictly rejects any workstation whose `device_identifier` is not pre-registered as `ACTIVE` in the `devices` table (breaking browser mode and unregistered candidate laptops, AND starting the exam clock prior to Phase 4A camera/mic readiness checks on proctored exams).
  3. **CRITICAL — Pre-Existing Windows Registry Policies Deleted on Exit (`registry_policy.rs`, `native_enforcement.rs`, `storage.rs`):** Rollback unconditionally calls `RegDeleteValueW` or sets `Deny_All = 0` instead of restoring pre-existing institutional Registry policy values from a persistent disk snapshot.
  4. **HIGH — Candidate Can End Proctoring Mid-Exam (`proctoring.py` / `ProctoringService.stop_session`):** `POST /candidates/me/attempts/{attempt_id}/proctoring/stop` ends the proctoring session without verifying `attempt.is_finalized`, violating the original invariant that proctoring cannot be stopped before submission/timeout.
  5. **HIGH — DB-Backed Backend Integration Suite Blocked in Sandbox:** All PostgreSQL integration tests errored on fixture connection (`127.0.0.1:5433 Permission denied`), so end-to-end DB transactions and existing REST API regression tests remain **unverified against live PostgreSQL** in this environment.

---

## 2. Existing Feature Inventory & Regression Status

| Existing Feature | Existed Before? | Modified? | Current Status & Verification | Regression Risk |
| :--- | :---: | :---: | :--- | :--- |
| Student & Admin Authentication (`auth.py`, `AuthService`) | Yes | No | Intact; 0 diffs in `auth.py`/`auth.py` models/services. DB integration tests not executed in sandbox. | **Low** |
| Role-Based Authorization (`AdminUser`, `CandidateUser`) | Yes | No | Preserved; all new admin/candidate endpoints reuse `AdminUser`/`CandidateUser`. | **Low** |
| Institution Management (Multi-tenancy) | **No** | N/A | AssessX is single-tenant (`admin_attempts.py` docstring explicitly notes single-tenant build; no `Institution` model exists). | **High** (if multi-institution isolation is assumed) |
| Device Management (`devices.py`) | Partial (Kiosk) | Yes (Phase 1A) | Extended additively with `devices` table (`0031`). Tested via Rust & schema tests. | **Low** |
| Assessment Creation / Editing / Scheduling (`assessments.py`) | Yes | No | Intact; untouched in `git diff`. | **Low** |
| Question Management & AI Assistant (`ai_assistant.py`) | Yes | Minor | `ai_assistant.py` modified (`+27 lines` in working tree prior/alongside); existing features preserved. | **Low** |
| Candidate Assignment (`AssignmentRepository`) | Yes | No | Preserved and reused by Phase 3A eligibility checks. | **Low** |
| Candidate Examination Start Flow (`ExamDetailsPage.tsx`) | Yes | **Yes** | **Changed behavior:** Now intercepts every fresh exam attempt with `PreFlightReadinessModal`, requiring registered device & starting attempt before `ProctoringCheck`. | **CRITICAL** |
| Existing Examination Navigation (`FREE` / `SEQUENTIAL`) | Yes | No | Preserved in `ExamRunner.tsx` (`canJump = attempt.question_navigation === 'FREE'`). | **Low** |
| Existing Timer (`useExamClock`) & Deadline Settlement | Yes | Minor | Preserved in `ExamRunner.tsx`; automatic submission on `clock.finished` now invokes `handlePhase3CSubmit(true)`. | **Medium** |
| Answer Selection & Legacy Autosave (`useAnswers`, `PUT /answers/...`) | Yes | **Yes** | Legacy `PUT /attempts/{id}/answers/{qid}` endpoint preserved on backend; `useAnswers` in `useExam.ts` swapped to `SessionSyncManager` (`POST /answers/sync`). | **Medium** |
| Examination Submission (`POST /submit` vs Phase 3C `/submission/confirm`) | Yes | **Yes** | Legacy `POST /submit` endpoint preserved on backend; `ExamRunner.tsx` now calls Phase 3C `confirmExaminationSubmission` + `authorize_secure_examination_exit` (blocked by `secret_key` bug). | **CRITICAL** |
| Results & Reports (`results.py`, `ExaminationPage`) | Yes | No | Intact on backend (`EvaluationService.ensure_result` still invoked on submission). | **Low** |
| Administrator Dashboard & Settings (`SettingsPage.tsx`) | Yes | Yes (Additive) | Existing cards preserved; Phase 1–3 cards stacked above existing cards. | **Low** |
| Coding Assessments & Drafts (`candidate_coding.py`, `CodingWorkspace`) | Yes | No | Intact; `ExamRunner.tsx` preserves coding workspace & `CODING_OPENED_EVENT`. | **Low** |
| AI Proctoring Detectors & Risk/Evidence Engines (Phases 5–6) | Yes | No | Preserved inside `ProctoredExam.tsx` & `CandidateDetailView.tsx`; all 148 AI Vitest unit tests pass. | **Low** |
| Backup & Restore Workflows (`.github/workflows/backup.yml`, `restore.py`) | Yes | Yes | Repaired API fallback URL & restore drill `--clean-after` guard; 8/8 unit tests pass. | **Low** |

---

## 3. Git & File Preservation Audit

- **Current Branch:** `main` tracking `origin/main` (`b7f89c3`).
- **Commit History Integrity:** Latest commit is `b7f89c3 fix(backend): ruff format attempts.py for secondary camera orientation`. Zero commits or pushes were made during Phases 1–4.
- **Working Tree Summary (`git status --short` & `git diff --stat`):**
  - **45 modified tracked files:** `2,286 insertions(+)`, `335 deletions(-)`
  - **0 deleted files**, **0 renamed files**
  - **Note on Historical Baseline:** Because Phases 1–4 plus the GitHub Backup fix and AI Assistant (`Robot3DCanvas.tsx`) changes all reside together as unstaged changes against `b7f89c3`, isolating unrelated pre-existing uncommitted work (e.g., `Robot3DCanvas.tsx`, `MobileCameraPage.tsx`, `backup.yml`, `restore.py`) from Phase 1–4 changes relies on `git diff HEAD` inspection rather than separate phase commits.

### 4. Added Files Inventory (Untracked vs `b7f89c3`)
- **Backend Migrations:** `0031_device_registration.py`, `0032_session_continuity.py`, `0033_examination_submission_closure.py`, `0034_proctoring_session_foundation.py`, `0035_proctoring_environment_enforcement.py`, `0036_monitoring_audit_foundation.py`
- **Backend Models/Schemas/Services/Routes:**
  - `backend/app/models/device.py`, `backend/app/models/monitoring_audit.py`
  - `backend/app/schemas/device.py`, `authorization.py`, `session_continuity.py`, `submission_closure.py`
  - `backend/app/services/device.py`, `authorization.py`, `answer_sync.py`, `submission_closure.py`
  - `backend/app/api/v1/devices.py`, `authorizations.py`
- **Backend Tests (Added):** `test_authorization_lifecycle.py`, `test_backup_restore.py`, `test_device_navigation.py`, `test_device_peripherals.py`, `test_monitoring_foundation.py`, `test_proctoring_events_foundation.py`, `test_proctoring_foundation.py`, `test_session_continuity.py`, `test_submission_closure.py`
- **Desktop Rust (`apps/desktop/src-tauri/src/`):** `provisioning/`, `secure_shell/`, `security_agent/`, `application_control/`, `system_utility/`, `navigation_control/`, `peripheral_control/`, `session_activation/`, `session_continuity/`, `submission_closure/`
- **Desktop React/TS (`apps/desktop/src/features/`):**
  - Admin cards: `admin/provisioning/`, `admin/secure-shell/`, `admin/security-agent/`, `admin/application-control/`, `admin/system-utility/`, `admin/navigation-control/`, `admin/peripheral-control/`, `admin/authorization/`, `admin/monitoring/AdminSessionContinuityCard.tsx`, `AdminSubmissionClosureCard.tsx`, `SessionContinuityCard.tsx`, `filters.ts`, `monitoring/__tests__/`
  - Exam/Proctoring: `exam/PreFlightReadinessModal.tsx`, `sessionActivation.ts`, `sessionContinuity.ts`, `submissionClosure.ts`, `OfflineAlertBanner.tsx`, `SyncStatusBadge.tsx`, `RecoveryWatcher.tsx`, `RecoveryPromptModal.tsx`, `SubmissionReviewModal.tsx`, `SubmissionReceiptCard.tsx`, `ExaminationCompletedPage.tsx`, `exam/__tests__/`, `proctoring/useProctoringReadiness.ts`, `proctoring/__tests__/`
- **Unrelated Uncommitted Assets:** `apps/desktop/public/parrot_bot.glb` (AI assistant asset).
- **Documentation (`docs/`):** Knowledge-Base docs and Phase 3C, 4A, 4B, 4C architectural/API/test/completion specs.

### 5. Modified Existing Files Inventory (45 Tracked Files)
- **Desktop Rust:** `Cargo.toml`, `Cargo.lock`, `src-tauri/src/lib.rs` (additive command registrations)
- **Desktop React/TS:** `App.tsx`, `vite.config.ts`, `lib/api.ts`, `SettingsPage.tsx`, `ExamDetailsPage.tsx`, `ExamRunner.tsx`, `useExam.ts`, `exam/types.ts`, `useAssessments.ts`, `ProctoredExam.tsx`, `ProctoringCheck.tsx`, `devices.ts`, `useMediaDevice.ts`, `useProctoringApi.ts`, `useEnvironmentEnforcement.ts`, `LiveMonitoringPage.tsx`, `CandidateMonitoringTile.tsx`, `CandidateDetailView.tsx`, `monitoring/types.ts`, `useMonitoring.ts`, plus unrelated `Robot3DCanvas.tsx` & `MobileCameraPage.tsx`.
- **Backend Python:** `router.py`, `errors.py`, `models/__init__.py`, `models/attempt.py`, `models/proctoring.py`, `models/proctoring_event.py`, `schemas/proctoring.py`, `schemas/monitoring.py`, `repositories/monitoring.py`, `services/proctoring.py`, `services/proctoring_events.py`, `services/monitoring.py`, `api/v1/attempts.py`, `api/v1/proctoring.py`, `api/v1/admin_attempts.py`, `api/v1/admin_monitoring.py`, plus `ai_assistant.py`.
- **CI / Infra (Unrelated to Phases 1–4):** `.github/workflows/backup.yml`, `.github/workflows/maintenance.yml`, `infrastructure/backup/restore.py`.

### 6. Deleted Files
- **None (0 files deleted).**

---

## 7. Existing Functionality Regression Results

- **API Preservation:** All legacy REST routes (`/assessments`, `/attempts`, `/attempts/{id}/answers/{qid}`, `/attempts/{id}/submit`, `/proctoring/activate`, `/proctoring/events`, `/admin/monitoring/sessions`) remain mounted with existing signatures.
- **UI Workflow Regression (CRITICAL):**
  - `ExamDetailsPage.tsx` (`beginExam`) unconditionally opens `PreFlightReadinessModal` for **all** fresh exam attempts. This breaks:
    1. Browser-mode / development testing and un-enrolled workstations (because `authorization.py` requires an `ACTIVE` row in `devices`).
    2. Proctored exam clock fairness (Phase 3A `activateAuthorizedSession` starts the exam clock *before* `ProctoringCheck` verifies camera/mic).
  - `ExamRunner.tsx` replaces `useSubmitExam()` (`POST /submit`) with `handlePhase3CSubmit()` (`POST /submission/confirm` -> `GET /receipt` -> `POST /closure/authorize` -> `POST /closure/complete`), which currently hits the `secret_key.get_secret_value()` bug on `/closure/authorize` and hardcodes `'DESKTOP-WIN-STATION'` as `device_id`.

---

## 8. Windows Security & Enforcement Audit (Phases 1 & 2)

| Control Area | Implementation Reality on Windows | Verdict / Gap |
| :--- | :--- | :--- |
| **1A Device Provisioning & Identity** | Reads Windows OS version/build, hardware UUID/hostname, generates persistent `device_identity.json` & `provisioning_journal.json`. | **Verified (Code & Rust tests)**; real Windows target testing on clean VM pending. |
| **1B Secure Shell (`kiosk.rs` / `secure_shell/`)** | Previews/validates Assigned Access & Shell Launcher configs; Tauri window fullscreen/always-on-top/close-guard use real Win32 / Tauri window APIs (`lockdown/mod.rs`). | **Real Window Guard + Staged Kiosk Config** |
| **1C Security Agent (`security_agent/`)** | Runs Named Pipe IPC (`\\.\pipe\AssessXSecurityAgent`), SHA-256 manifest checks, tamper ring buffer, bounded restarts (`<= 3 / 600s`), offline queue. | **Verified in unit tests**; Named Pipe DACL & Windows SCM service installation not verified on a live elevated Windows VM in this audit. |
| **2A Application Control (`application_control/`)** | `inventory.rs` inspects running Windows processes; **HOWEVER**, `PolicyEngine::apply_policy()` in `policy.rs` only mutates in-memory `POLICY_ENGINE` state and writes to journal — it does **not** apply kernel-level Windows AppLocker / WDAC rules. | **Gap (HIGH):** Detection/state-tracking only; no OS execution block enforced. |
| **2B System Utilities (`system_utility/`)** | `TaskManagerPolicy` (`DisableTaskMgr`) and CMD (`DisableCMD`) and `DisableRegistryTools` invoke real Win32 `RegCreateKeyExW` / `RegSetValueExW` APIs when `#[cfg(windows)]`. **HOWEVER**, `PowerShellManager::apply_policy()` only sets `std::env::set_var("__PSLockdownPolicy", "4")` in AssessX's own process env rather than writing `RegistryPolicyTarget::PowerShellLockdown` to Registry! | **Mixed:** TaskMgr/CMD/RegEdit use Win32 Registry; PowerShell restriction is process-local only (**HIGH**). |
| **2C Shortcuts & Navigation (`navigation_control/`)** | `lockdown/keyboard_hook.rs` installs a Windows low-level keyboard hook (`SetWindowsHookExW`) for Alt+Tab/WinKey/PrtScn when engaged; `NativeEnforcementManager` writes real Explorer Registry DWORDs (`NoWinKeys`, `NoRun`, `NoFind`, `NoTrayContextMenu`, `NoSetTaskbar`, `NoDesktop`). Accessibility settings inspection implemented. | **Real Win32 Hook & Registry Enforcement** |
| **2D USB Storage, Display & Remote Access (`peripheral_control/`)** | `StorageManager` inspects `DRIVE_REMOVABLE` via `GetDriveTypeW` and writes HKCU/HKU `RemovableStorageDevices\Deny_All = 1`. `display.rs` & `remote_access.rs` inspect `SM_REMOTESESSION`, terminal services keys, and remote desktop apps. HID keyboards/mice are not disabled. | **Real Win32 Inspection & HKCU Policy** (HKCU/HKU policy write requires admin privileges if HKLM/GPO scope needed; silently falls back to Audit Mode on win32 error 5 `ACCESS_DENIED`). |

---

## 9. Critical Windows Policy Restoration Audit

**Finding: HIGH / CRITICAL Preservation Gap Across Policy Rollback Modules**

1. **System Utilities (`apps/desktop/src-tauri/src/system_utility/registry_policy.rs`):**
   - `apply_and_verify()` stores the prior `RegistryPolicyState` only in an **in-memory static mutex** (`BACKUP_REGISTRY_STATE`), which is lost on app crash/restart.
   - `remove_policy()` ignores `BACKUP_REGISTRY_STATE` completely and unconditionally executes `RegDeleteValueW`! If an institution already enforced `DisableTaskMgr = 1` or `DisableCMD = 2` before AssessX launched, exiting AssessX **deletes the institution's pre-existing restriction**.
2. **Navigation Control (`apps/desktop/src-tauri/src/navigation_control/native_enforcement.rs`):**
   - `write_explorer_dword()` records `"None"` in the change journal instead of reading existing `NoWinKeys`/`NoRun`/`NoFind` values first.
   - `remove_all_explorer_policies()` unconditionally deletes all 6 Explorer policy registry values rather than restoring pre-existing baseline values.
3. **USB Storage (`apps/desktop/src-tauri/src/peripheral_control/storage.rs`):**
   - `apply_storage_policy()` writes `Deny_All = 1` (block) or `Deny_All = 0` (allow) without backing up whether `Deny_All` previously existed or was already `1`. Rolling back sets `Deny_All = 0` instead of deleting a newly created value or restoring a pre-existing `1`.
4. **Partial Failure Recovery:** `submission_closure/mod.rs` attempts fallback local restoration across all 4 subsystems if the Security Agent pipe is unavailable, but reports `closure_status: "RESTORED"` unconditionally in `Ok(ClosureRestorationReport { ... })` even if `nav_res`, `util_res`, or `periph_res` returned `Err(...)`!

---

## 10. Database Migration Audit (Migrations `0031`–`0036`)

- **Chain Verification (`alembic heads` & `alembic history`):** Linear single head (`0030 -> 0031 -> 0032 -> 0033 -> 0034 -> 0035 -> 0036 (head)`), no branching conflicts.
- **Offline SQL Generation (`alembic upgrade 0030:head --sql`):** Succeeded cleanly with exit code 0.
- **Additive Preservation:**
  - `0031`: New `devices` table (FK `registered_by_id -> users.id ON DELETE SET NULL`). Non-destructive.
  - `0032`: Additive columns on `attempt_answers` and `assessment_attempts` with safe `server_default`s (`'1'`, `'0'`). Legacy rows preserved cleanly.
  - `0033`: Additive nullable columns + `closure_status DEFAULT 'ACTIVE'` on `assessment_attempts` + unique indexes on `submission_id` and `receipt_id`.
  - `0034`: Additive columns on `proctoring_sessions` (`readiness_state DEFAULT 'NOT_CHECKED'`, `interruption_count DEFAULT '0'`).
  - `0035`: Drops and recreates `ck_proctoring_events_category` to include `'RECOVERY'`. **Minor schema drift:** ORM model `ProctoringEvent.event_type` was bumped to `length=50`, while DB migration `0035` left column as `VARCHAR(40)` (currently safe since longest event string is 31 chars). **Downgrade caution:** Downgrading `0035` will fail if any `'RECOVERY'` event rows exist.
  - `0036`: New `monitoring_audit_events` table with FKs and indexes (`ix_monitoring_audit_action`, `ix_monitoring_audit_admin_time`, `ix_monitoring_audit_attempt_time`).
- **Live PostgreSQL Execution:** **Not executed** inside sandbox due to PostgreSQL connection restriction (`127.0.0.1:5433` blocked).

---

## 11. API Backward Compatibility Audit

- **Preserved Contracts:** All existing endpoints (`/assessments`, `/attempts`, `/attempts/{id}/answers/{qid}`, `/attempts/{id}/submit`, `/proctoring/activate`, `/proctoring/devices`, `/proctoring/events`, `/admin/monitoring/sessions`) preserve their HTTP methods, paths, status codes, and required fields.
- **Schema Extensions:**
  - `ProctoringSessionOut`, `MonitoringSession`, `MonitoringSummary`, `ProctoringEventOut`, `DeviceReport` added only **optional fields with safe defaults**, maintaining compatibility with older clients.
- **Identified Backend API Issues:**
  1. **CRITICAL:** `POST /candidates/me/attempts/{id}/closure/authorize` (`submission_closure.py:231`) and `POST /candidates/me/attempts/{id}/recover` (`answer_sync.py:52`) crash with `AttributeError` (`secret_key` has no `.get_secret_value()`).
  2. **HIGH:** `POST /candidates/me/attempts/{id}/proctoring/stop` (`proctoring.py:106` -> `ProctoringService.stop_session`) allows a candidate to end their proctoring session while `attempt.status == IN_PROGRESS`!
  3. **MEDIUM:** `GET /admin/attempts/{id}/proctoring/events` (`admin_attempts.py:314`) filters `severity` in Python *after* SQL `.offset().limit()`, causing inaccurate `total` counts and under-filled pages when `severity` query param is used.

---

## 12. Answer Data Integrity Audit (Phase 3)

- **HMAC Signing Secret Placement:** Server-side `SECRET_KEY` (`Settings.secret_key`) stays strictly on the FastAPI backend. No HMAC signing secret is embedded in React or Rust code. (**PASS**)
- **Token Expiry & Replay Protection:**
  - Activation token TTL = 120s; Exit token TTL = 15m (note: docs mention 5 min while code uses `timedelta(minutes=15)`).
  - **Gap (MEDIUM):** Activation token `jti` (`authorization.py:298`) is not persisted/blacklisted upon consumption, allowing replay within 120s TTL (mitigated partially because `start_or_resume` is idempotent).
- **Monotonic Revision & Stale Protection (`answer_sync.py:129`):** Backend strictly ignores stale updates where `item.client_revision < answer.client_revision` (`ignored_older_revision`), and deduplicates retries via `idempotency_key`. (**PASS**)
- **Duplicate Submission Protection (`submission_closure.py:130`):** Uses `get_for_candidate_locked` (`FOR UPDATE`) and returns existing receipt idempotently if already `SUBMITTED`/`TIME_EXPIRED`. (**PASS**)
- **Local Cache Purge Safety (`ExamRunner.tsx:106-130`):** `clearLocalAnswers(attempt.id)` executes strictly **after** `confirmExaminationSubmission` and `getSubmissionReceipt` succeed. If submission fails, local answers remain preserved. (**PASS**)
- **Local Encryption Weakness (`session_continuity/mod.rs:58-96`):** Uses SHA-256 XOR stream + unkeyed/prefix `SHA256(key || ciphertext)` derived solely from readable `device_id` (`device_identity.json`) + `attempt_id` instead of Windows DPAPI (`CryptProtectData`) + AES-GCM. Any local process reading `%APPDATA%\AssessX` can derive the key. (**MEDIUM**)
- **Pre-Submit Queue Drain & Heartbeat Count (`ExamRunner.tsx:70, 100`):** `startHeartbeatMonitor` hardcodes `getPendingCount: () => 0`, and `handlePhase3CSubmit` does not explicitly await `SessionSyncManager` flush before submitting answers. (**MEDIUM**)

---

## 13. Proctoring & WebRTC Audit (Phase 4)

- **Media Selection, Labels & Teardown:** `devices.ts`, `useMediaDevice.ts`, and `ProctoredExam.tsx` correctly enumerate devices, persist selection, handle `devicechange`/`track.onended`, and release tracks cleanly on unmount/teardown. (**PASS**)
- **WebRTC Signaling & Credential Security (`ws.py`, `realtime.py`, `webrtc.ts`):**
  - Uses one-time WebSocket tickets (`/api/v1/realtime/ws-ticket`) rather than URL JWTs.
  - Short-lived STUN/TURN credentials fetched dynamically from `/api/v1/realtime/ice-servers`, restricted to admins and actively proctored/in-call candidates (`_may_relay`). Zero TURN secrets in frontend/Rust bundles.
  - Peer connections in `useMediaViewer.ts` require actual `ontrack` frames + `session.candidateConnected` before displaying live video; audio is muted by default (`audioOn = false`).
  - No default persistent recording occurs (`useMediaPublisher` streams WebRTC tracks directly; evidence clips remain separately gated by server `RecordingPolicy`).
- **Stream Grant Enforcement Gap (`ws.py` vs `admin_monitoring.py`):** `POST /admin/monitoring/sessions/{attempt_id}/stream/request` audits `STREAM_GRANTED` and returns a 15-minute `StreamAuthorizationGrant`, **but** `ws.py` (`WATCH` handler) does not validate `stream_grant_id` or automatically disconnect an active WebRTC stream upon grant expiry. (**MEDIUM**)
- **Native Enforcement Wiring Gap (`useEnvironmentEnforcement.ts`):** Notice strings exist for `SECURITY_AGENT_DISCONNECTED` and `RESTRICTED_APPLICATION_DETECTED`, and `fullscreenPolicy` (`REQUIRED` / `OPTIONAL` / `DISABLED`) was added, **but** `desktopBridge()` does not subscribe to live Security Agent disconnect IPC events yet, and `ProctoredExam.tsx` does not wire an assessment-level `fullscreenPolicy` setting. (**LOW**)

---

## 14. Complete Test Execution Matrix

| Suite | Command Run | Outcome | Details |
| :--- | :--- | :--- | :--- |
| **Desktop Unit Suite** | `npm run test:unit` (Vitest) | **PASSED** | **33 test files / 342 tests passed; 0 failed** |
| **Desktop TypeScript Build** | `npx tsc -b` | **PASSED** | **0 errors** across full workspace |
| **Desktop Linter** | `npm run lint` (`oxlint`) | **PASSED** | **0 errors** (21 React Compiler / hook warnings across 363 files) |
| **Rust Workspace Tests** | `cargo test --no-fail-fast` | **114 PASSED / 1 FAILED** | 114 tests passed across Phases 1–4; `credentials::tests::a_token_round_trips_through_the_credential_manager` failed in sandbox (`"credential store unavailable"`). |
| **Backend Linter** | `.venv\Scripts\python -m ruff check app tests` | **FAILED (3 errors)** | `app/models/attempt.py:1` (I001), `app/models/attempt.py:200` (E501), `app/services/proctoring.py:269` (E501). |
| **Backend Standalone Unit Tests** | `pytest ... --noconftest` (9 files) | **PASSED** | **52 passed; 0 failed** (`test_backup_restore`, `test_authorization_lifecycle`, `test_session_continuity`, `test_submission_closure`, `test_device_navigation`, `test_device_peripherals`, `test_proctoring_foundation`, `test_proctoring_events_foundation`, `test_monitoring_foundation`). |
| **Full Backend DB Test Suite** | `.venv\Scripts\python -m pytest` | **BLOCKED (Setup Error)** | Terminal sandbox blocks TCP connection to `127.0.0.1:5433` (`assessx_test` PostgreSQL: `Permission denied 0x0000271D/10013`). Existing API & DB integration suites (`test_attempts.py`, `test_monitoring.py`, `test_proctoring.py`, `test_auth.py`, etc.) could not execute against PostgreSQL. |
| **Alembic Offline SQL** | `alembic upgrade 0030:head --sql` | **PASSED** | Valid SQL DDL generated cleanly from `0030` to `0036 (head)`. |
| **End-to-End Live Flow & Windows VM** | Full live server + elevated Windows VM | **NOT EXECUTED** | Not runnable inside sandboxed/non-admin single environment; **not independently verified on a clean Windows VM**. |

---

## 15. Known Issues & Prioritized Findings Register

| ID | Severity | File / Component | Evidence & Impact | Recommended Correction | Breaks Existing? |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **AUD-01** | **CRITICAL** | `backend/app/services/submission_closure.py:231` (`_sign_exit_token`) & `answer_sync.py:52` (`_generate_recovery_token`) | Calls `.secret_key.get_secret_value()`, but `Settings.secret_key` (`config.py:40`) is `str`. Causes `AttributeError` at runtime on exit authorization & crash recovery. | Replace with `get_settings().secret_key.encode("utf-8")` and add service-level unit tests calling both methods. | Yes (breaks `ExamRunner` submit closure flow) |
| **AUD-02** | **CRITICAL** | `apps/desktop/src/features/exam/pages/ExamDetailsPage.tsx:33-45`, `PreFlightReadinessModal.tsx`, `authorization.py:281` | Forces every fresh exam attempt through `PreFlightReadinessModal` -> `/authorize`, rejecting unregistered devices (`dev-browser-workstation-uuid` / un-enrolled laptops) with HTTP 403 and starting the exam timer before Phase 4A `ProctoringCheck`. | Gate `PreFlightReadinessModal` by assessment policy (e.g. `require_device_registration` / desktop-only), or move proctoring camera/mic check ahead of `activateAuthorizedSession` so exam clock does not start prematurely. | **Yes** |
| **AUD-03** | **CRITICAL** | `apps/desktop/src-tauri/src/system_utility/registry_policy.rs:284`, `native_enforcement.rs:91`, `storage.rs:202` | Rollback deletes registry keys (`RegDeleteValueW`) or writes `Deny_All = 0` blindly instead of restoring pre-existing values from a persisted disk snapshot. Can erase an institution's existing GPO/local policies. | Snapshot existing Registry values (and presence bit) to `%APPDATA%\AssessX\policy_backup.json` before applying; on restore, reset pre-existing DWORDs or delete only values AssessX newly created. | Yes (host OS policy preservation) |
| **AUD-04** | **HIGH** | `backend/app/api/v1/proctoring.py:106` & `services/proctoring.py:302` (`stop_session`) | `POST /attempts/{id}/proctoring/stop` ends the proctoring session even while `attempt` is `IN_PROGRESS`, allowing a candidate API caller to disable proctoring before submitting. | Require `attempt.is_finalized` in `ProctoringService.stop_session()` (raise `Conflict` if attempt is still open). | No |
| **AUD-05** | **HIGH** | `apps/desktop/src-tauri/src/application_control/policy.rs:208` & `system_utility/powershell.rs:116` | `ApplicationControl` only updates an in-memory mutex (no AppLocker/WDAC kernel enforcement); `PowerShellManager::apply_policy` only sets `__PSLockdownPolicy` in AssessX's own process env instead of calling `RegistryPolicyEngine::apply_and_verify(PowerShellLockdown)`. | Wire `PowerShellManager` to `RegistryPolicyEngine` HKCU/HKU registry policy, and explicitly document/implement WDAC/AppLocker policy deployment scripts in Security Agent. | No |
| **AUD-06** | **HIGH** | Sandbox / Live DB Integration Suite (`backend/tests/conftest.py`) | Full `pytest` suite (`test_attempts.py`, `test_monitoring.py`, `test_proctoring.py`, etc.) blocked from connecting to PostgreSQL on port 5433 in sandbox. | Execute full `pytest` suite in CI or local host environment with running PostgreSQL `assessx_test` DB prior to release. | Verification gap |
| **AUD-07** | **MEDIUM** | `apps/desktop/src-tauri/src/session_continuity/mod.rs:58-96` | Local answer cache key derived solely from plaintext `device_id` + `attempt_id` with custom XOR cipher instead of Windows DPAPI (`CryptProtectData`) + `aes-gcm`. | Use Windows DPAPI (`CryptProtectData` / `CryptUnprotectData`) or DPAPI-wrapped 256-bit random AES-GCM key. | No |
| **AUD-08** | **MEDIUM** | `apps/desktop/src/features/exam/ExamRunner.tsx:70, 100-124` | `startHeartbeatMonitor` passes `getPendingCount: () => 0`; `handlePhase3CSubmit` does not flush `SessionSyncManager` before `confirmExaminationSubmission`; `device_id` hardcoded to `'DESKTOP-WIN-STATION'`. | Expose `getPendingCount()` & `flushAll()` from `useAnswers` -> `SessionSyncManager`, and read real `device_identifier` from `provisioning_get_device_identity`. | Minor |
| **AUD-09** | **MEDIUM** | `apps/desktop/src-tauri/src/submission_closure/mod.rs:114` | `authorize_secure_examination_exit` reports `closure_status: "RESTORED"` even if individual rollback subsystems fail (`Err`). | Track failures per subsystem and return `"PARTIAL_FAILURE"` or `"FAILED"` when any mandatory rollback fails. | No |
| **AUD-10** | **MEDIUM** | `backend/app/api/v1/admin_attempts.py:314` (`list_attempt_proctoring_events`) | Filtering `severity` in Python after SQL `.limit()/.offset()` returns inaccurate pagination `total` and sparse pages. | Compute/filter severity consistently before applying `limit`/`offset`. | No |
| **AUD-11** | **MEDIUM** | `backend/app/services/authorization.py:298` & `backend/app/api/v1/ws.py` | Activation token `jti` is not marked consumed; `ws.py` `WATCH` does not check `StreamAuthorizationGrant` expiry from `/stream/request`. | Persist consumed `jti` on `activate_session` and validate/expire `StreamAuthorizationGrant` in `ws.py`. | No |
| **AUD-12** | **LOW** | `backend/app/models/attempt.py:1,200` & `backend/app/services/proctoring.py:269` | `ruff check app tests` failed with 3 lint errors (import sorting + 2 line lengths > 110 chars). Also `proctoring_event.event_type` ORM `length=50` vs migration `VARCHAR(40)`. | Run `ruff check --fix` / format lines and align column length in migration `0037` if >40 char event types are added later. | No |

---

## 16. Direct Answers to the 10 Mandatory Audit Questions

1. **What new functionality has been added?**
   - Phase 1: Windows workstation provisioning/identity/change journal, kiosk shell lifecycle manager, Security Agent daemon + Named Pipe IPC + tamper/integrity/compliance/offline event client.
   - Phase 2: Process inventory & allowlist engine, TaskMgr/CMD/RegEdit Registry policy enforcement, Explorer shortcut/navigation restrictions & focus supervisor, removable USB storage blocking & display/remote-access inspection.
   - Phase 3: Candidate eligibility/start authorization tokens, encrypted local answer buffer + monotonic batch sync + heartbeat/crash recovery, atomic canonical-hash submission receipts + signed exit restoration orchestration.
   - Phase 4: Camera/mic selection & persistence, unified readiness engine, fullscreen policy & offline environment event pipeline with severity classification, 4×4 paginated admin monitoring wall with exam selector, search/status filters, filtered timeline, and audited WebRTC access.
2. **What existing functionality was modified?**
   - `ExamDetailsPage.tsx` (added `PreFlightReadinessModal` gating), `ExamRunner.tsx` (wired heartbeat, `SyncStatusBadge`, `OfflineAlertBanner`, and Phase 3C submission/receipt/closure flow), `useExam.ts` (`useAnswers` backed by `SessionSyncManager`), `SettingsPage.tsx` (added Phase 1–3 admin cards), `ProctoringCheck.tsx`/`ProctoredExam.tsx` (device selector & stop integration), `LiveMonitoringPage.tsx`/`CandidateDetailView.tsx` (exam selector, filters, audit calls), and additive extensions to `attempts.py`, `proctoring.py`, `admin_attempts.py`, `admin_monitoring.py`, and their models/schemas.
3. **Was any existing functionality removed?**
   - **No.** Zero files were deleted (`git status` confirms 0 deletions), and all existing backend endpoints, assessment/coding/interview workflows, and admin settings cards remain present.
4. **Are the old APIs backward-compatible?**
   - **Yes, at the HTTP contract level:** Legacy endpoints (`/submit`, `/answers/{qid}`, `/proctoring/activate`, `/admin/monitoring/sessions`) preserve their paths, methods, and required fields; all schema additions are optional with defaults.
5. **Are all previous database records preserved?**
   - **Yes.** Migrations `0031`–`0036` add new tables (`devices`, `monitoring_audit_events`) and nullable/defaulted columns cleanly without dropping or mutating existing rows.
6. **Are existing Windows security policies preserved after examination?**
   - **NO (AUD-03):** Currently, rollback unconditionally deletes Registry keys (`DisableTaskMgr`, `DisableCMD`, `DisableRegistryTools`, Explorer keys) or sets `Deny_All = 0` rather than restoring pre-existing institutional values from a persisted snapshot. **Must be fixed before production.**
7. **Does the full old workflow still work?**
   - **Partially broken in UI integration (AUD-01, AUD-02):** While legacy backend APIs remain intact, the UI now blocks fresh attempts on unregistered devices/browsers (`PreFlightReadinessModal` -> HTTP 403), starts the timer before proctoring checks, and crashes on `POST /closure/authorize` due to `secret_key.get_secret_value()`.
8. **Are all four new phases integrated?**
   - **Mostly integrated, with 4 key wiring gaps:** `ExamRunner` hardcodes `'DESKTOP-WIN-STATION'` and `getPendingCount: () => 0` (`AUD-08`), `PowerShellManager` does not write Registry policies (`AUD-05`), `ApplicationControl` does not enforce OS-level blocking (`AUD-05`), and `ws.py` does not enforce `StreamAuthorizationGrant` expiry (`AUD-11`).
9. **Which security features have been verified on real Windows?**
   - Verified via Rust unit tests & Windows compilation: Win32 Registry read/write calls (`RegOpenKeyExW`, `RegSetValueExW`, `RegDeleteValueW`), `GetDriveTypeW`/`GetLogicalDrives`, `SetWindowsHookExW` low-level keyboard hook compilation, Tauri lockdown window guards, and process scanning. **Not independently verified on a clean, elevated Windows VM end-to-end** (including Windows Credential Manager, Named Pipe DACL permissions, Assigned Access kiosk switching, and elevated `USBSTOR`/HKLM writes).
10. **What must be fixed before production?**
    - **Must Fix (Blockers):**
      1. Fix `secret_key.get_secret_value()` crash in `submission_closure.py:231` and `answer_sync.py:52` (`AUD-01`).
      2. Fix `ExamDetailsPage.tsx` / `authorization.py` so un-enrolled devices/browser exams and proctored pre-flight checks aren't broken or timed prematurely (`AUD-02`).
      3. Implement persistent disk policy snapshot & true baseline restoration in `registry_policy.rs`, `native_enforcement.rs`, and `storage.rs` (`AUD-03`).
      4. Prevent `POST /proctoring/stop` from ending proctoring before `attempt.is_finalized` (`AUD-04`).
      5. Execute the full PostgreSQL-backed `pytest` suite and live end-to-end test on an actual Windows VM (`AUD-06`).

