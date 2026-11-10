# ASSESSX — FOUR-PHASE REMEDIATION PLAN
## Controlled Remediation & Zero-Regression Implementation Blueprint

**Date:** November 10, 2026  
**Based On:** `docs/ASSESSX-FOUR-PHASE-PRESERVATION-AUDIT.md`  
**Objective:** Resolve all 12 audit findings (`AUD-01` through `AUD-12`) across Phases 1–4 without breaking existing features, APIs, database records, or workflows.  
**Git Rule:** All edits remain local and unstaged (`git commit` / `git push` prohibited).

---

## Stage-by-Stage Remediation Matrix

### Stage 1 — `AUD-01`: Secret Key Runtime Crash (`CRITICAL`)
- **Root Cause:** `Settings.secret_key` in `backend/app/core/config.py:40` is typed as `str`, not `SecretStr`. Both `SubmissionClosureService._sign_exit_token` (`backend/app/services/submission_closure.py:231`) and `SessionContinuityService._generate_recovery_token` (`backend/app/services/answer_sync.py:52`) call `.get_secret_value()`, raising `AttributeError` at runtime.
- **Affected Files:**
  - `backend/app/services/submission_closure.py`
  - `backend/app/services/answer_sync.py`
  - `backend/tests/test_submission_closure.py`
  - `backend/tests/test_session_continuity.py`
- **Existing Behaviour to Preserve:** Keep `Settings.secret_key: str`, keep existing token wire formats (`attempt_id.exp_ts.sig` and `attempt_id.ts.sig`), do not invalidate sessions, do not log secrets.
- **Proposed Minimal Correction:** Replace `get_settings().secret_key.get_secret_value().encode("utf-8")` with `get_settings().secret_key.encode("utf-8")` in both services (matching `auth.py`, `realtime/security.py`, `mfa.py`, `authorization.py`), with guard validation if key is empty. Add service-level unit tests exercising token signing, verification, expiry, wrong key, and missing config.
- **Regression Risks:** Low; fixes broken runtime path.

---

### Stage 2 — `AUD-02`: Preserve All Examination Start Modes (`CRITICAL`)
- **Root Cause:**
  1. `ExamDetailsPage.tsx` unconditionally routes every fresh attempt through `PreFlightReadinessModal` -> `POST /examinations/{examId}/authorize`, which requires an `ACTIVE` device record in `devices` (`authorization.py:281`), breaking browser exams and unregistered candidate laptops.
  2. `PreFlightReadinessModal` executes `activateAuthorizedSession` (starting the exam timer) *before* Phase 4A `ProctoringCheck` verifies camera/microphone readiness.
- **Affected Files:**
  - `backend/app/models/assessment.py` & `backend/app/schemas/assessment.py` & `backend/app/schemas/assignment.py`
  - `backend/alembic/versions/0037_remediation_policy_and_tokens.py`
  - `backend/app/services/authorization.py`
  - `apps/desktop/src/features/assessments/types.ts`
  - `apps/desktop/src/features/exam/types.ts`
  - `apps/desktop/src/features/exam/pages/ExamDetailsPage.tsx`
  - `apps/desktop/src/features/exam/PreFlightReadinessModal.tsx`
- **Existing Behaviour to Preserve:** Existing browser assessments (unproctored and proctored) must work without device registration; proctored assessments must check camera/mic readiness *before* the exam timer starts; assessments explicitly configured to require registered Windows workstations must enforce device registration.
- **Proposed Minimal Correction:**
  1. Add optional `require_registered_device: bool = False` (default `False` for full backward compatibility!) to `Assessment` (`0037` migration), `AssessmentOut`, `MyAssessment`, and `ExamDetail`.
  2. In `ExaminationAuthorizationService.check_candidate_eligibility` and `authorize_examination_start`: enforce `devices` registration check **only** when `assessment.require_registered_device` is `True` (or when an explicit registered device check is required), preserving browser and un-enrolled assessments by default.
  3. In `ExamDetailsPage.tsx` & `PreFlightReadinessModal.tsx`:
     - If `!exam.require_registered_device` and `!proctored` (classic browser exam): run direct `start(assessmentId)` as before.
     - If `proctored` and `!exam.require_registered_device`: route straight to `ProctoringCheck` so camera/mic check runs *before* the attempt clock starts (`ProctoredExam.tsx` already holds the clock until devices are ready!).
     - If `exam.require_registered_device` (secure Windows exam): run `PreFlightReadinessModal` (eligibility + native readiness + backend authorization + agent binding). For proctored secure exams, authorize/verify readiness without starting the clock prematurely, or pass authorization into `ProctoredExam` so camera/mic readiness still finishes before `activate()`.
- **Regression Risks:** Medium (exam launch flow); mitigated by comprehensive unit & integration tests for all 4 exam modes.

---

### Stage 3 — `AUD-03`: Safe Windows Policy Restoration (`CRITICAL`)
- **Root Cause:** `system_utility/registry_policy.rs`, `navigation_control/native_enforcement.rs`, and `peripheral_control/storage.rs` do not persist pre-existing Registry state to disk; rollback unconditionally calls `RegDeleteValueW` or sets `Deny_All = 0`, erasing institutional policies that existed before AssessX ran.
- **Affected Files:**
  - `apps/desktop/src-tauri/src/provisioning/journal.rs` (or shared `policy_snapshot.rs` module)
  - `apps/desktop/src-tauri/src/system_utility/registry_policy.rs`
  - `apps/desktop/src-tauri/src/navigation_control/native_enforcement.rs`
  - `apps/desktop/src-tauri/src/peripheral_control/storage.rs`
- **Existing Behaviour to Preserve:** All Tauri policy commands (`apply_system_utility_policy`, `revert_system_utility_policy`, `apply_navigation_policy`, `revert_navigation_policy`, `apply_peripheral_policy`, `rollback_peripheral_policy`) preserve their external contracts and UI state reporting.
- **Proposed Minimal Correction:**
  1. Implement a persistent disk-backed snapshot store (`%APPDATA%\AssessX\policy_snapshots_v1.json`) keyed by exact Registry `(root_scope, subkey, value_name)` recording: `existed_before: bool`, `original_dword: Option<u32>`, `applied_value: u32`, `transaction_id`, `owned_by_assessx: bool`, and `timestamp`.
  2. Never overwrite an existing snapshot entry while an active AssessX policy lock already exists (prevents clobbering original baseline during repeated `apply` calls or crash recovery).
  3. On restoration: read snapshot, inspect current Registry state, restore `original_dword` if `existed_before == true`, delete value **only** if `existed_before == false && owned_by_assessx == true`, verify restored state, and return explicit success/error per entry.
  4. Never blindly delete keys or zero out `Deny_All`.
- **Regression Risks:** Low-Medium; guarded by unit tests for snapshot creation, crash persistence, pre-existing institutional value preservation, and AssessX-created deletion.

---

### Stage 4 — `AUD-04`: Protect Active Proctoring (`HIGH`)
- **Root Cause:** `ProctoringService.stop_session()` (`backend/app/services/proctoring.py:302`) ends the session unconditionally, even when `attempt.status == IN_PROGRESS`, enabling a candidate to halt proctoring mid-exam.
- **Affected Files:**
  - `backend/app/services/proctoring.py`
  - `backend/app/api/v1/proctoring.py`
  - `backend/tests/test_proctoring_foundation.py`
- **Existing Behaviour to Preserve:** Legitimate `POST /proctoring/stop` calls during Phase 3C submission/closure (after `attempt` is `SUBMITTED` or `TIME_EXPIRED`) remain idempotent and succeed; `end_for` during server finalization continues unchanged.
- **Proposed Minimal Correction:** In `ProctoringService.stop_session(attempt)`, check `if not attempt.is_finalized: raise Conflict("Cannot stop proctoring while the examination attempt is still active.")`. Repeated calls after finalization remain idempotent (`if not session.is_ended: self.end_for(attempt)`).
- **Regression Risks:** Low; aligns behavior with existing security invariant in `proctoring.py`.

---

### Stage 5 — `AUD-05`: Real Enforcement or Honest Audit Mode (`HIGH`)
- **Root Cause:**
  1. `ApplicationControl::PolicyEngine::apply_policy()` only toggles an in-memory mutex; no Windows AppLocker/WDAC execution block is enforced.
  2. `PowerShellManager::apply_policy()` only sets `__PSLockdownPolicy` in AssessX's own process env rather than writing Registry `EnableScripts`.
- **Affected Files:**
  - `apps/desktop/src-tauri/src/application_control/policy.rs`
  - `apps/desktop/src-tauri/src/system_utility/powershell.rs`
  - `apps/desktop/src/features/admin/application-control/` (UI messaging if needed)
- **Existing Behaviour to Preserve:** Process scanning, allowlist previewing, approval gates, and UI cards remain functional.
- **Proposed Minimal Correction:**
  1. In `application_control/policy.rs`: detect Windows edition / AppLocker / WDAC status cleanly; when OS kernel execution enforcement (`AppIdSvc` / WDAC CI policy) is not provisioned by an elevated institution GPO/agent, enforce honest `AuditMode` reporting (`effective_mode: AuditMode`) rather than falsely claiming kernel blocking while keeping the approval workflow and process violation scanner operational.
  2. In `system_utility/powershell.rs`: integrate `RegistryPolicyEngine::apply_and_verify(RegistryPolicyTarget::PowerShellLockdown, ...)` and snapshot-backed restoration instead of relying on process-local `std::env::set_var("__PSLockdownPolicy")`, reporting accurate `VerificationFailed` / `AuditMode` if Registry write permissions are absent.
- **Regression Risks:** Low.

---

### Stage 6 — `AUD-07` & `AUD-08`: Answer Data Integrity & Sync Plumbing (`MEDIUM`)
- **Root Cause:**
  1. `session_continuity/mod.rs` encrypts local answers using XOR with a deterministic key derived from plaintext `device_id` + `attempt_id`.
  2. `ExamRunner.tsx` passes `getPendingCount: () => 0`, does not drain `SessionSyncManager` before `confirmExaminationSubmission`, and hardcodes `'DESKTOP-WIN-STATION'`.
- **Affected Files:**
  - `apps/desktop/src-tauri/src/session_continuity/mod.rs`
  - `apps/desktop/src/features/exam/sessionContinuity.ts`
  - `apps/desktop/src/features/exam/useExam.ts`
  - `apps/desktop/src/features/exam/ExamRunner.tsx`
- **Existing Behaviour to Preserve:** Seamless answer selection, immediate local save, offline recovery, backward compatibility with any pre-existing `v1` answer files during active recovery.
- **Proposed Minimal Correction:**
  1. In `session_continuity/mod.rs`: generate random 256-bit DEK via `ring::rand::SystemRandom`, wrap DEK with Windows DPAPI (`CryptProtectData` / `CryptUnprotectData` via Win32 `crypt32.dll`, storing wrapped DEK in `answers_v2.key`), encrypt payload with `ring::aead::AES_256_GCM` and random 96-bit nonce (`v2` format). Support reading/migrating existing legacy `v1` files automatically without discarding candidate answers!
  2. In `SessionSyncManager` (`sessionContinuity.ts`) & `useAnswers` (`useExam.ts`): expose `getPendingCount()`, `currentRevision()`, and `flushAll()` (awaiting queued batches to settle and confirming backend ack).
  3. In `ExamRunner.tsx`: wire real `getPendingCount` into heartbeat, call `await flushAnswers()` before `confirmExaminationSubmission()`, clear local cache only after receipt verification, and resolve real `device_identifier` via `provisioning_get_device_identity` (with honest browser fallback ID).
- **Regression Risks:** Medium; verified via Rust AES-GCM/DPAPI roundtrip + legacy v1 migration tests and Vitest sync/flush unit tests.

---

### Stage 7 — `AUD-09`: Honest Restoration Status (`MEDIUM`)
- **Root Cause:** `submission_closure/mod.rs` ignores `Err` returns from fallback restoration calls and unconditionally returns `closure_status: "RESTORED"`.
- **Affected Files:**
  - `apps/desktop/src-tauri/src/submission_closure/mod.rs`
- **Proposed Minimal Correction:** Track each subsystem (`NAVIGATION_SHORTCUTS`, `SYSTEM_UTILITIES`, `APPLICATION_ALLOWLISTING`, `PERIPHERALS_STORAGE`, `LOCKDOWN_WINDOW_GUARD`, `SECURITY_AGENT`) with explicit success/failure tracking. Return `"RESTORED"` only when all attempted restorations succeed, `"PARTIAL_FAILURE"` when some succeed and some fail, and `"FAILED"` when critical restoration fails. Preserve error details in message & journal.

---

### Stage 8 — `AUD-10` & `AUD-11`: Monitoring Filtering, Replay Protection & WebRTC Grants (`MEDIUM`)
- **Root Cause:**
  1. `admin_attempts.py:314` filters `severity` in Python after SQL pagination.
  2. `authorization.py:298` never records consumed `jti` values on activation token consumption.
  3. `ws.py` `WATCH` handler does not check active `StreamAuthorizationGrant` or expire active watches when the grant expires or is revoked.
- **Affected Files:**
  - `backend/app/api/v1/admin_attempts.py` & `backend/app/services/proctoring_events.py`
  - `backend/app/models/authorization_token.py` (or `consumed_tokens` table in `0037`) & `backend/app/services/authorization.py`
  - `backend/app/api/v1/admin_monitoring.py`, `backend/app/api/v1/ws.py`, `backend/app/realtime/hub.py`
- **Proposed Minimal Correction:**
  1. Map `severity` filter in `list_attempt_proctoring_events` to its exact SQL `ProctoringEventType.in_(matching_types)` predicate **before** computing `total` and `.offset()/.limit()`.
  2. Persist consumed activation token `jti` in `consumed_activation_tokens` (`0037` migration) inside an atomic check on `activate_session`, rejecting duplicate reuse of the same token while allowing fresh logins/resumes.
  3. Track issued `StreamAuthorizationGrant`s (ID, `admin_id`, `attempt_id`, `expires_at`, `revoked`) in `MonitoringService` / realtime grant registry; validate active unexpired grant inside `ws.py` `WATCH` / media relay and disconnect/unwatch when expired or revoked, without affecting live interview WebSockets (`ws_calls.py`).

---

### Stage 9 — `AUD-12`: Low-Severity Cleanup & Schema Alignment (`LOW`)
- **Affected Files:**
  - `backend/app/models/attempt.py` (fix `I001` import sorting and `E501` line length)
  - `backend/app/services/proctoring.py` (fix `E501` line length at line 269)
  - `backend/alembic/versions/0037_remediation_policy_and_tokens.py` (widen `proctoring_events.event_type` to `VARCHAR(50)` to match ORM `length=50`, plus `require_registered_device` column and `consumed_activation_tokens` / `stream_grants` tables cleanly without rewriting existing `0031`–`0036` history).

