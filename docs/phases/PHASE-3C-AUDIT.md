# ASSESSX — PHASE 3C AUDIT REPORT
## Secure Examination Submission, Exit Authorization & Examination Closure

**Document Version:** 1.0.0  
**Phase:** 3C (Final stage of Phase 3 Lifecycle)  
**Date:** November 9, 2026  
**Auditor:** Antigravity (Senior Windows Security Engineer, Full-Stack Architect, Tauri/Rust Engineer)  
**Status:** STAGE 0 COMPLETE — READY FOR ARCHITECTURE (STAGE 1)  

---

## 1. Executive Summary

AssessX is a Windows-first secure examination and AI-proctored assessment platform. This audit reviews the repository across Phase 1 (Windows security foundation, secure shell, Security Agent IPC), Phase 2 (Application, utility, navigation, and peripheral enforcement), Phase 3A (Start authorization & session activation), and Phase 3B (Answer persistence, batch sync, local encryption, heartbeat & crash recovery).

Phase 3C is the final phase of the examination lifecycle: transitioning an active examination attempt into an authoritative, immutable submitted state, issuing verified cryptographic submission receipts, securing exit authorization from the backend, orchestrating native Windows security policy restoration across all restricted subsystems, and recording an unbroken audit trail.

This audit establishes that Phase 3A and Phase 3B are fully implemented, verified, and operational. It outlines the specific capabilities, database schemas, APIs, native commands, and UI components required to complete Phase 3C without regression.

---

## 2. Git Status & Working Tree Baseline

- **Repository Root:** `D:\AssessX-AI\AssessX-AI-main`
- **Active Branch:** `main` (tracked against `origin/main`)
- **Preservation Status:** All modified and untracked files from Phase 1, Phase 2, Phase 3A, and Phase 3B remain strictly local, unstaged, and preserved.
- **Commit Rule Compliance:** No Git commits or pushes were performed.

---

## 3. Dependency Audit: Phase 3A and Phase 3B Readiness

### 3.1 Phase 3A Readiness: Examination Activation & Start Authorization
- **Backend Service & Routes:**
  - `backend/app/services/authorization.py`: `check_candidate_eligibility`, `authorize_examination_start`, `activate_session`, `_sign_activation_token` with constant-time HMAC-SHA256 signature verification.
  - `backend/app/api/v1/authorizations.py`: `GET /eligibility`, `POST /authorize`, `POST /activate-session`.
- **Desktop Layer:**
  - `apps/desktop/src-tauri/src/session_activation/mod.rs`: `run_examination_readiness`, `bind_session_policy` commands.
  - `apps/desktop/src/features/exam/sessionActivation.ts`: Client bridge.
  - `apps/desktop/src/features/exam/PreFlightReadinessModal.tsx`: Candidate readiness UI with pre-flight checks.
- **Readiness Conclusion:** Fully operational. Session policy binding and signed activation tokens provide the baseline for Phase 3C's exit authorization tokens.

### 3.2 Phase 3B Readiness: Session Continuity, Local Persistence & Heartbeat
- **Backend Engine:**
  - `backend/app/services/answer_sync.py`: Batch synchronization with monotonic revisions (`client_revision >= current_revision`), idempotency deduplication (`idempotency_key`), heartbeat monitoring with >60s dropout detection, and crash recovery handshake (`recover_session`).
  - `backend/app/models/attempt.py`: `AttemptAnswer` revisions (`client_revision`, `server_revision`, `idempotency_key`, `synced_at`) and `AssessmentAttempt` heartbeat tracking (`last_heartbeat_at`, `heartbeat_device_id`, `pending_sync_count`).
  - `backend/alembic/versions/0032_session_continuity.py`: Alembic revision 0032 successfully defined.
- **Desktop Native Storage:**
  - `apps/desktop/src-tauri/src/session_continuity/mod.rs`: Encrypted local persistence at `%APPDATA%\AssessX\sessions\<attempt_id>\answers_v1.enc` with SHA-256 block stream cipher and HMAC tag.
- **Desktop Client & UI:**
  - `apps/desktop/src/features/exam/sessionContinuity.ts`: `SessionSyncManager` queue, heartbeat loop, and offline recovery.
  - `apps/desktop/src/features/exam/useExam.ts`: Local-first answer persistence.
  - `SyncStatusBadge.tsx`, `OfflineAlertBanner.tsx`, `RecoveryPromptModal.tsx`, `RecoveryWatcher.tsx`.
- **Readiness Conclusion:** Fully operational. Phase 3C directly builds upon Phase 3B's `SessionSyncManager` to perform the mandatory final sync drain before submission.

---

## 4. Current Submission & Closure Flow Analysis

### 4.1 Existing Backend Submission Flow
In `backend/app/services/attempts.py` (`AttemptService.submit`):
1. Acquires a pessimistic database row lock (`FOR UPDATE`) on `AssessmentAttempt`.
2. Settles the attempt clock against server `utcnow()`.
3. Validates whether already `SUBMITTED` (returns idempotently) or `TIME_EXPIRED` (raises `AttemptLocked`).
4. Updates `attempt.status = AttemptStatus.SUBMITTED`, `submitted_at = now`, `finalized_at = now`.
5. Calls `ProctoringService(self.db).end_for(attempt)`.
6. Evaluates scoring via `EvaluationService(self.db).ensure_result(attempt)`.

### 4.2 Limitations of the Current Submission Flow
- **No Pre-Submission Review:** Candidate clicks submit without a summary of answered vs unanswered questions.
- **No Final Sync Barrier:** A candidate can click submit while background answers are still enqueued or offline.
- **No Answer Snapshot:** Answers exist only as individual rows in `attempt_answers`. No immutable snapshot is generated with a cryptographic digest (`snapshot_hash`).
- **No Submission Receipt:** No unique receipt identifier or receipt payload is issued or persisted for candidate verification.
- **No Exit Authorization Token:** The desktop application currently has no cryptographic token to present to the native Security Agent authorizing policy restoration.
- **No Coordinated Windows Restoration:** The desktop window simply closes or navigates without an atomic teardown of application allowlists, system utility restrictions, keyboard hooks, and peripheral policies.

---

## 5. Architectural Gap Analysis for Phase 3C

| Component | Current State | Required Phase 3C State | Gap Severity |
|:---|:---|:---|:---:|
| **Pre-Submission Summary** | Missing | `POST .../submission/prepare` returning question progress, answered/unanswered counts, and pending sync status | HIGH |
| **Final Sync Flush** | In flight in background | Blocking drain of `SessionSyncManager` prior to submission request | CRITICAL |
| **Submission Snapshot** | Unversioned relational rows | Canonical JSON snapshot of final answers with SHA-256 hash (`snapshot_hash`) | HIGH |
| **Submission Receipt** | Non-existent | Formatted, cryptographically bound receipt (`receipt_id`, timestamp, answer count, hash) | HIGH |
| **Exit Authorization** | None | Backend-signed HMAC-SHA256 exit token (`ExitAuthorizationToken`) binding attempt, candidate, device, and receipt | CRITICAL |
| **Native Policy Restoration** | Isolated per module | Coordinated restoration engine via Security Agent & Tauri native modules | CRITICAL |
| **Controlled Exit Lifecycle** | None (instant window close) | Gated transition: Submit -> Snapshot -> Receipt -> Authorize Exit -> Restore OS -> Verify -> Mark Clean Exit -> Close | CRITICAL |
| **Post-Exam Cleanup** | Immediate local answer purge | Verified cleanup of session caches only after backend confirmation and receipt retrieval | MEDIUM |
| **Admin Submission Records** | Basic attempt detail | Live submission review, receipt lookup, snapshot hash inspection, and restoration failure audits | MEDIUM |

---

## 6. Proposed Database Model Enhancements

To maintain immutability and complete auditability, `AssessmentAttempt` in `backend/app/models/attempt.py` will be extended (with Alembic migration `0033_examination_submission_closure.py`):

```python
# AssessmentAttempt additions for Phase 3C:
submission_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, unique=True, index=True)
submission_type: Mapped[str | None] = mapped_column(String(32), nullable=True) # "MANUAL" | "AUTOMATIC_TIMEOUT"
receipt_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
snapshot_hash: Mapped[str | None] = mapped_column(String(64), nullable=True) # SHA-256 hex
answer_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True) # Canonical JSON snapshot
exit_authorization_token_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
closure_status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE", server_default="ACTIVE") # "ACTIVE", "SUBMITTED", "CLOSURE_AUTHORIZED", "RESTORING", "CLOSED", "RESTORATION_FAILED"
closure_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

---

## 7. Native Security & Windows Restoration Architecture

During examination, AssessX armors the device across 5 distinct subsystems:
1. **Application Control:** AppLocker / Software Restriction / Process termination (`application_control`).
2. **System Utilities:** Registry keys blocking CMD, PowerShell, Task Manager (`system_utility`).
3. **Navigation & Shortcuts:** Low-level keyboard hook blocking WinKey, Alt+Tab, Task View, PrintScreen (`navigation_control`, `lockdown`).
4. **Peripherals:** Removable storage blocking, display topology enforcement (`peripheral_control`).
5. **Secure Shell:** Shell Launcher / Kiosk mode, automatic startup registry (`secure_shell`).

**Restoration Rule:**
Under Phase 3C, restoration must NEVER blindly re-enable policies. It must restore the exact pre-examination values recorded in the Change Journal (`journal.rs`), verify that Explorer is restored, unregister auto-startup, release the low-level keyboard hook, release the lockdown window guard, and mark `is_clean_exit = true` in `CrashRecoveryController`.

---

## 8. Test Baseline & Environmental Constraints

- **Python Unit Tests:** 13 passed, 0 failed.
- **Vitest Desktop Suite:** 302 passed across 29 test files, 0 failed.
- **Rust Workspace:** 112 passed, 0 failed, 2 filtered out.
  - *Documented Environmental Limitation:* `credentials::tests::a_token_round_trips_through_the_credential_manager` requires an interactive Windows desktop user profile vault for `CredWriteW` (fails in headless/sandbox execution with `write: "credential store unavailable"`).
- **TypeScript Compiler (`npx tsc -b`):** 0 errors.
- **Linters (`oxlint`, `ruff check`):** 0 errors.

---

## 9. Proposed Files to Create and Modify

### Backend
- Create `backend/app/schemas/submission_closure.py` (Preparation, confirmation, snapshot, receipt, exit authorization schemas)
- Create `backend/app/services/submission_closure.py` (Submission preparation, final flush, snapshot hashing, receipt generation, HMAC exit token generation, closure acknowledgement)
- Modify `backend/app/models/attempt.py` (Add submission and closure fields)
- Create `backend/alembic/versions/0033_examination_submission_closure.py`
- Modify `backend/app/api/v1/attempts.py` (Add `/submission/prepare`, `/submission/confirm`, `/submission/receipt`, `/closure/authorize`, `/closure/complete`)
- Modify `backend/app/api/v1/admin_attempts.py` (Add `/submission` admin endpoint)
- Create `backend/tests/test_submission_closure.py`

### Desktop Native (Rust/Tauri)
- Modify `apps/desktop/src-tauri/src/security_agent/protocol.rs` (Add `AuthorizeExitAndRestore` and response structures)
- Modify `apps/desktop/src-tauri/src/security_agent/ipc.rs` (Add IPC handler for restoration)
- Create `apps/desktop/src-tauri/src/submission_closure/mod.rs` (Orchestrates native restoration, verifies HMAC exit token, unregisters hooks, marks clean exit, cleans session cache)
- Modify `apps/desktop/src-tauri/src/lib.rs` (Register `submission_closure` module and commands)

### Frontend (React/TypeScript)
- Create `apps/desktop/src/features/exam/submissionClosure.ts` (API bridge, sync drain, receipt fetcher, native restoration trigger)
- Create `apps/desktop/src/features/exam/SubmissionReviewModal.tsx` (Pre-submission review summary with answered/unanswered counts)
- Create `apps/desktop/src/features/exam/SubmissionReceiptCard.tsx` (Displays authoritative receipt details)
- Create `apps/desktop/src/features/exam/ExaminationCompletedPage.tsx` (Completion screen with receipt and safe exit status)
- Modify `apps/desktop/src/features/exam/ExamRunner.tsx` (Integrate review modal, final sync drain, receipt generation, and native closure)
- Create `apps/desktop/src/features/admin/monitoring/AdminSubmissionDetailsCard.tsx` (Admin submission & closure inspector)
- Modify `apps/desktop/src/features/admin/pages/SettingsPage.tsx` (Mount admin card)
- Create `apps/desktop/src/features/exam/__tests__/submissionClosure.test.ts`

---

## 10. Audit Conclusion & Stop Confirmation

Phase 3A and Phase 3B are verified and ready. The architectural blueprint, database schema, native restoration sequence, and API designs for Phase 3C are fully mapped out. Per the instructions, Stage 0 is complete.

