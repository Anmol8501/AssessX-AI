# ASSESSX — PHASE 3B AUDIT & ARCHITECTURAL REVIEW
## Examination Session Continuity, Answer Persistence & Recovery

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 3B  
**Date:** 2026-11-09  
**Platform Priority:** Windows Desktop (Windows 10 / Windows 11)  
**Desktop Stack:** Tauri v2 + React 19 + TypeScript + Rust  
**Native Agent:** Rust AssessX Security Agent (`\\.\pipe\AssessXSecurityAgent`)  
**Backend:** FastAPI + SQLAlchemy + PostgreSQL (Supabase)  
**Document Status:** Stage 0 Complete — Audit & Design Baseline  

---

## 1. Executive Summary

Phase 3B delivers **deterministic answer persistence, encrypted local offline buffering, monotonic revision tracking, periodic session heartbeats, and authorized crash recovery** for AssessX examinations.

During Stage 0, we performed a full codebase and architectural audit across the desktop frontend, native Rust layer, Security Agent IPC, and FastAPI backend to assess existing session and answer capabilities against Phase 3B requirements.

The audit revealed that while AssessX has robust server-authoritative attempt timing (`expires_at`), strict single-attempt constraints (`uq_attempt_one_active_per_candidate`), and per-question REST updates, **it currently lacks local offline buffering, monotonic revision tracking, batch synchronization, and cryptographically verified crash recovery**. If the desktop app terminates or power drops while disconnected, unsaved in-memory state is at risk of loss.

Phase 3B will close these gaps while strictly preserving all existing functionality and adhering to the absolute rule of zero Git commits or pushes.

---

## 2. Existing Architecture & Modules to Reuse

| Subsystem | Existing Files / Modules | Capabilities to Reuse in Phase 3B |
|---|---|---|
| **Phase 3A Authorization** | `backend/app/services/authorization.py`, `backend/app/api/v1/authorizations.py`, `apps/desktop/src/features/exam/sessionActivation.ts` | Reuse HMAC-SHA256 token verification, candidate eligibility rules, and device status validation for crash recovery authorization. |
| **Attempt & Sitting Model** | `backend/app/models/attempt.py`, `backend/app/services/attempts.py`, `backend/app/repositories/attempts.py` | Reuse `AssessmentAttempt`, `AttemptService.start_or_resume`, and server-authoritative clock expiration (`settle`). |
| **Answer Model** | `backend/app/models/attempt.py` (`AttemptAnswer`, `AttemptAnswerOption`) | Reuse relational answer rows and option foreign keys; extend with monotonic revisions. |
| **Device Identification** | `backend/app/models/device.py`, `apps/desktop/src-tauri/src/provisioning/device_id.rs` | Reuse hardware thumbprint identity to bind recovery requests to authorized hardware. |
| **Crash Recovery Controller** | `apps/desktop/src-tauri/src/secure_shell/crash_recovery.rs` | Reuse `%APPDATA%\AssessX` directory structure and restart count limiting. |
| **Security Agent IPC** | `apps/desktop/src-tauri/src/security_agent/protocol.rs`, `ipc.rs` | Reuse Named Pipe IPC (`\\.\pipe\AssessXSecurityAgent`) to verify agent health during recovery and emit session heartbeats. |
| **Frontend Exam Runner** | `apps/desktop/src/features/exam/ExamRunner.tsx`, `useExam.ts`, `SaveIndicator.tsx` | Extend `useAnswers` with encrypted local persistence, sync queue worker, and offline indicators. |

---

## 3. Analysis of Existing Answer Persistence & Gaps

### Current Answer Flow
1. In `apps/desktop/src/features/exam/useExam.ts` (`useAnswers`), selecting an option triggers `PUT /api/v1/candidates/me/attempts/{attempt_id}/answers/{question_id}`.
2. In-flight requests lock per question and collapse rapid changes.
3. **Identified Gap 1 (Zero Offline Tolerance):** The code explicitly states:
   > *"There is no offline buffering: an attempt is server state, and a candidate must not be able to keep working past the deadline just because their connection dropped."*
   When a network failure occurs, the answer is flagged as `error` in React component state. If the app crashes, reloads, or loses power, uncommitted answers in volatile JavaScript memory disappear.
4. **Identified Gap 2 (No Monotonic Revision Ordering):** Answers lack `client_revision` and `server_revision`. On high-latency or intermittent networks, an out-of-order delivery could allow an earlier request to overwrite a later selection.
5. **Identified Gap 3 (No Batch Synchronization):** Only single-question PUT endpoints exist. When coming back online after a network drop, the client must blast multiple individual requests rather than a unified atomic batch.
6. **Identified Gap 4 (No Local Encryption Buffer):** Answers are not stored locally in an encrypted SQLite or DPAPI-protected store.
7. **Identified Gap 5 (No Telemetry Heartbeat / Dropout Detection):** While WebSockets exist for proctoring events, there is no discrete HTTP session heartbeat tracking process integrity, answered counts, and transitioning dropped candidates to `INTERRUPTED`.
8. **Identified Gap 6 (Crash Recovery Handshake):** Relaunching the app currently re-reads the server attempt via `get_attempt()`, but does not inspect local unsynced answers, does not reconcile revisions, and does not require explicit recovery authorization.

---

## 4. Current Database Schema vs. Phase 3B Requirements

### Existing Tables:
- `assessment_attempts`:
  - `id`: UUID (PK)
  - `assessment_id`, `candidate_id`, `assignment_id`
  - `attempt_number`, `status` (`IN_PROGRESS`, `SUBMITTED`, `TIME_EXPIRED`)
  - `started_at`, `expires_at`, `submitted_at`, `finalized_at`
  - `tab_switch_count`, `held_at`, `hold_reason`
  - Partial Unique Index: `uq_attempt_one_active_per_candidate` (`WHERE status = 'IN_PROGRESS'`)
- `attempt_answers`:
  - `id`: UUID (PK)
  - `attempt_id`: FK to `assessment_attempts`
  - `question_id`: FK to `questions`
  - `created_at`, `updated_at`
- `attempt_answer_options`:
  - `id`: UUID (PK)
  - `answer_id`: FK to `attempt_answers`
  - `option_id`: FK to `question_options`

### Phase 3B Schema Extensions:
1. **Extend `attempt_answers`:**
   - Add `client_revision: int` (default 1)
   - Add `server_revision: int` (default 1)
   - Add `idempotency_key: str` (nullable, max 64 chars, indexed)
   - Add `synced_at: datetime` (default `utcnow`)
2. **Add `session_heartbeats` Table (or migration `0032_session_continuity.py`):**
   - `id`: UUID (PK)
   - `attempt_id`: FK to `assessment_attempts`
   - `device_identifier`: VARCHAR(64)
   - `sequence_number`: INT
   - `answered_count`: INT
   - `agent_healthy`: BOOLEAN
   - `tamper_violations_count`: INT
   - `client_timestamp`: TIMESTAMPTZ
   - `created_at`: TIMESTAMPTZ
3. **Add `session_recovery_logs` Table:**
   - `id`: UUID (PK)
   - `attempt_id`: FK to `assessment_attempts`
   - `candidate_id`: FK to `users`
   - `device_identifier`: VARCHAR(64)
   - `recovery_reason`: VARCHAR(64)
   - `unsynced_items_count`: INT
   - `recovery_status`: VARCHAR(32) (`AUTHORIZED`, `REJECTED`, `COMPLETED`)
   - `created_at`: TIMESTAMPTZ

---

## 5. Security & Threat Analysis for Phase 3B

| Threat Scenario | Risk | Mitigation Architecture in Phase 3B |
|---|---|---|
| **Power cut / Crash during exam** | Loss of candidate answers | Answers are debounced (800ms) and flushed immediately to local encrypted store using Windows DPAPI / AES-256-GCM. On relaunch, local store is discovered and submitted during recovery. |
| **Network dropout during exam** | Loss of in-flight answers | Answers enter `LOCAL_PENDING` in the encrypted local queue; synchronization worker resumes with exponential backoff and drains queue on reconnection. |
| **Clock rollback while offline** | Cheating / artificial extra time | Local elapsed time uses monotonic ticks (`Instant::now()`). Backend independently validates server clock; client timestamps are never authoritative. |
| **Out-of-order answer packet** | Older selection overwrites newer | Monotonic revision check: if `req.client_revision <= current.client_revision`, backend rejects with `409 Conflict`. |
| **Duplicate sync requests** | Duplicate audit records / race conditions | Idempotency keys (`idempotency_key: UUID`) guarantee idempotent database transactions. |
| **Cross-device session recovery** | Device substitution / cheating | Recovery requires matching `device_identifier` verified against initial session registration; mismatched hardware is rejected with `403 Forbidden`. |
| **Expired exam recovery** | Resuming closed exam | Recovery endpoint runs `settle()`. If `utcnow() >= expires_at`, recovery is rejected with `403 Forbidden` (`attempt_locked`). |
| **Local answer file tampering** | Candidate editing local JSON | Answers encrypted via Windows DPAPI (`CryptProtectData`) and keyed to user session; tampering fails decryption or SHA-256 integrity check. |

---

## 6. Proposed Implementation Architecture

```mermaid
flowchart TD
    subgraph Candidate Desktop
        UI[React Exam UI / useAnswers] -->|Debounce 800ms| LocalStore[Rust Encrypted Local Buffer]
        UI -->|Every 20s| HeartbeatWorker[Desktop Heartbeat Worker]
        LocalStore -->|Windows DPAPI / AES-GCM| EncDisk[(%APPDATA%/AssessX/answers.enc)]
        LocalStore -->|Queue FIFO| SyncWorker[Background Sync Worker]
    end

    subgraph Native Security Agent
        Agent[Named Pipe: AssessXSecurityAgent] -->|Health & Violations| HeartbeatWorker
        Agent -->|Verify Security Hooks| RecoveryGate[Recovery Gate]
    end

    subgraph FastAPI Backend
        SyncWorker -->|PUT /answers/{qid} OR POST /answers/sync| SyncAPI[Answer Sync Service]
        HeartbeatWorker -->|POST /sessions/{id}/heartbeat| HeartbeatAPI[Heartbeat Service]
        SyncAPI --> DB[(Supabase PostgreSQL)]
        HeartbeatAPI --> DB
        
        CrashRestart[Desktop Restart] --> RecoveryGate
        RecoveryGate -->|POST /sessions/{id}/recover| RecoveryAPI[Recovery Service]
        RecoveryAPI --> DB
    end
```

---

## 7. Proposed API Specifications

1. **`PUT /api/v1/candidates/me/attempts/{attempt_id}/answers/{question_id}`** (Enhanced):
   - Accepts `selected_option_ids: list[UUID]`, `client_revision: int`, `idempotency_key: str`, `client_timestamp: datetime`.
   - Returns `AttemptAnswerOut` with `client_revision`, `server_revision`, `synced_at`.
2. **`POST /api/v1/candidates/me/attempts/{attempt_id}/answers/sync`** (New Batch Endpoint):
   - Request Body: `list[AnswerSyncItem]`
   - Atomically updates revisions inside a single transaction and returns per-question acknowledgements.
3. **`POST /api/v1/candidates/me/attempts/{attempt_id}/heartbeat`** (New Endpoint):
   - Ingests telemetry: `device_identifier`, `sequence_number`, `answered_count`, `agent_healthy`, `tamper_violations_count`.
   - Returns: `status` (`ACTIVE` / `INTERRUPTED`), `server_time`, `remaining_seconds`.
4. **`POST /api/v1/candidates/me/attempts/{attempt_id}/recover`** (New Endpoint):
   - Request Body: `device_identifier`, `interruption_reason`.
   - Verifies attempt validity, non-expired status, and device ownership; returns `recovery_authorized: bool`, `remaining_seconds`, and server answer checksums.

---

## 8. Test Baseline Verification

Prior to any Phase 3B changes, all test suites were executed to establish an unambiguous baseline:
- **Python Backend:** 15 passing tests (`test_device_navigation`, `test_device_peripherals`, `test_authorization_lifecycle`).
- **Desktop Vitest:** 28 test files, 298 passing tests, 0 failed.
- **Rust Workspace:** 111 passing tests. 1 pre-existing environmental limitation documented (`credentials::tests::a_token_round_trips_through_the_credential_manager` which fails in headless CI because `CredWriteW` requires an interactive Windows desktop user profile vault).
- **TypeScript & Linting:** `npx tsc -b` -> 0 errors; `npx oxlint` -> 0 errors; `ruff check` -> 0 errors.

---

## 9. Phase 3B Implementation Plan & File Touchpoints

Following user instructions, we **STOP at Stage 0** and present this plan for authorization. Implementation will proceed in the following structured stages:

1. **Stage 1 (Data Models & Schemas):**
   - Create `backend/app/schemas/session_continuity.py`.
   - Extend `AttemptAnswer` and schemas with revision tracking and idempotency.
   - Add Alembic migration `0032_session_continuity.py`.
2. **Stage 2 (Backend Synchronization & Recovery Services):**
   - Implement `AnswerSyncService`, `SessionHeartbeatService`, `SessionRecoveryService`.
   - Add endpoints to `backend/app/api/v1/attempts.py` and `authorizations.py`.
   - Add backend tests in `backend/tests/test_session_continuity.py`.
3. **Stage 3 (Desktop Rust Encrypted Local Storage):**
   - Create `apps/desktop/src-tauri/src/session_continuity/mod.rs` with DPAPI encryption and atomic file writes.
   - Register Tauri commands: `save_answer_local`, `get_all_local_answers`, `sync_pending_answers_local`, `clear_local_answers`.
4. **Stage 4 & 5 (Sync Engine, Heartbeat & Recovery Handshake):**
   - Create `apps/desktop/src/features/exam/sessionContinuity.ts`.
   - Integrate debounce, local-first write, and background sync worker into `useExam.ts`.
5. **Stage 6 & 7 (Candidate & Admin UI):**
   - Create `SyncStatusBadge.tsx`, `OfflineAlertBanner.tsx`, and `RecoveryPromptModal.tsx`.
   - Create `SessionContinuityMonitorCard.tsx` under admin view.
6. **Stage 8 & 9 (Full Testing & Verification):**
   - Execute backend pytest, Vitest unit tests, Rust cargo tests, TypeScript build, and linter checks.
   - Produce `docs/phases/PHASE-3B-COMPLETION-REPORT.md`.

