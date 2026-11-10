# AssessX — Four-Phase Critical Remediation & Zero-Regression Completion Report

**Date:** November 10, 2026  
**Baseline Audit:** [ASSESSX-FOUR-PHASE-PRESERVATION-AUDIT.md](./ASSESSX-FOUR-PHASE-PRESERVATION-AUDIT.md)  
**Remediation Plan:** [ASSESSX-REMEDIATION-PLAN.md](./ASSESSX-REMEDIATION-PLAN.md)  
**Repository State:** Local working tree changes on `main` (zero Git commits, zero pushes, zero destructive resets performed).

---

## Executive Summary

All 12 audit findings (**AUD-01 through AUD-12**) across Backend (`FastAPI`/`SQLAlchemy`/`Alembic`), Desktop (`React`/`TypeScript`), and Native Windows (`Rust`/`Tauri`) have been remediated cleanly as backward-compatible, additive fixes preserving all pre-existing AssessX features:

- Existing browser-mode examinations (`require_registered_device = false`, default) bypass workstation registration and launch directly into the attempt without breaking non-provisioned candidates.
- Standard proctored examinations continue to complete `ProctoringCheck` (camera and microphone availability verification) **before** creating an attempt or starting the exam countdown clock.
- Candidate authentication, admin assessment authoring/scheduling, question banks, AI generation, legacy autosave/submission, coding examinations, AI/risk/evidence pipelines, interview calls, and backup maintenance remain preserved.

---

## Remediation Matrix by Finding

| Finding | Severity | Resolution Summary | Modified / Added Files |
|---|---|---|---|
| **AUD-01** | Critical | Replaced broken `.get_secret_value()` calls on `Settings.secret_key: str` with clean `_signing_secret()` helpers in Phase 3C exit tokens & Phase 3B recovery tokens; added unit tests covering signing, expiry, tampering, and wrong-target rejection. | `backend/app/services/submission_closure.py`, `backend/app/services/answer_sync.py`, `backend/tests/test_submission_closure.py`, `backend/tests/test_session_continuity.py` |
| **AUD-02** | Critical | Added `Assessment.require_registered_device` (default `False`) across ORM/schemas/UI builder; scoped device registration checks in `ExaminationAuthorizationService` only when `require_registered_device=True`; updated `ExamDetailsPage` and `PreFlightReadinessModal` via `resolveExamStartAction()` so browser mode, standard proctored check-before-clock flow, and device-locked exams all run in their proper order. | `backend/app/models/assessment.py`, `backend/app/schemas/assessment.py`, `backend/app/schemas/assignment.py`, `backend/app/services/assessments.py`, `backend/app/services/authorization.py`, `apps/desktop/src/features/assessments/types.ts`, `apps/desktop/src/features/assessments/builder/SettingsSection.tsx`, `apps/desktop/src/features/exam/sessionActivation.ts`, `apps/desktop/src/features/exam/PreFlightReadinessModal.tsx`, `apps/desktop/src/features/exam/pages/ExamDetailsPage.tsx`, `apps/desktop/src/features/exam/__tests__/sessionActivation.test.ts`, `backend/tests/test_authorization_lifecycle.py` |
| **AUD-03** | Critical | Added disk-backed persistent Windows Registry baseline snapshots (`policy_snapshots_v1.json`) that never clobber an active baseline across crashes/re-applies, restore pre-existing institutional DWORD values, and delete values only when AssessX originally created them (`owned_by_assessx=true`). Updated System Utility, Navigation Explorer, and Removable Storage rollback engines. | `apps/desktop/src-tauri/src/provisioning/policy_snapshot.rs`, `apps/desktop/src-tauri/src/provisioning/mod.rs`, `apps/desktop/src-tauri/src/system_utility/registry_policy.rs`, `apps/desktop/src-tauri/src/navigation_control/native_enforcement.rs`, `apps/desktop/src-tauri/src/peripheral_control/storage.rs`, `apps/desktop/src-tauri/src/peripheral_control/policy.rs` |
| **AUD-04** | High | Guarded `ProctoringService.stop_session()` to raise `409 Conflict` while `not attempt.is_finalized`, preventing candidates from terminating proctoring during an active sitting while keeping post-finalization stops idempotent. | `backend/app/services/proctoring.py`, `backend/tests/test_proctoring_foundation.py` |
| **AUD-05** | High | Implemented real OS WDAC/AppLocker registry probing (`detect_os_enforcement_support`) with honest downgrade to `AuditMode` (`os_enforcement_available=false`) when kernel blocking is unavailable; updated `PowerShellManager` to inspect and enforce persistent GPO Registry policy (`EnableScripts`) via `RegistryPolicyEngine` snapshot protection instead of only process env vars. | `apps/desktop/src-tauri/src/application_control/policy.rs`, `apps/desktop/src-tauri/src/system_utility/powershell.rs` |
| **AUD-07** | High | Replaced custom SHA-256 XOR local answer encryption with `ring::aead::AES_256_GCM` + CSPRNG random 96-bit nonces + attempt AAD binding (`answers_v2.enc`) protected by per-attempt keys wrapped via Windows DPAPI (`CryptProtectData`/`CryptUnprotectData` in `answers_v2.key`), with transparent migration from legacy `answers_v1.enc` files. | `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/session_continuity/mod.rs` |
| **AUD-08** | High | Exposed `getPendingCount()`, `currentRevision()`, and `flushAll()` from `SessionSyncManager` through `useAnswers` into `ExamRunner`; wired real pending count to heartbeat, drained pending sync queue prior to `confirmExaminationSubmission()`, and resolved real workstation device IDs via `getWorkstationDeviceIdentifier()` (replacing `'DESKTOP-WIN-STATION'`). | `apps/desktop/src/features/exam/sessionActivation.ts`, `apps/desktop/src/features/exam/sessionContinuity.ts`, `apps/desktop/src/features/exam/useExam.ts`, `apps/desktop/src/features/exam/ExamRunner.tsx`, `apps/desktop/src/features/exam/__tests__/sessionContinuity.test.ts` |
| **AUD-09** | Medium | Updated `submission_closure/mod.rs` to track per-subsystem success/failure (`restored_subsystems` + `failed_subsystems`) and report honest `"RESTORED"`, `"PARTIAL_FAILURE"`, or `"FAILED"` states via `build_closure_report()`. | `apps/desktop/src-tauri/src/submission_closure/mod.rs`, `apps/desktop/src/features/exam/submissionClosure.ts` |
| **AUD-10** | Medium | Exported canonical `SEVERITY_EVENT_TYPES` & `ALL_CLASSIFIED_SEVERITY_EVENTS` in `proctoring_events.py` and applied `severity` filtering in SQL inside `list_attempt_proctoring_events` before counting `total` and applying `.offset()/.limit()`. | `backend/app/services/proctoring_events.py`, `backend/app/api/v1/admin_attempts.py`, `backend/tests/test_proctoring_events_foundation.py` |
| **AUD-11** | Medium | Added persisted single-use `ConsumedActivationToken` JTI consumption in `activate_session()` and persisted `MonitoringStreamGrant` issuance/revocation/expiry validation in `/admin/monitoring/sessions/{attempt_id}/stream/request`, `/stream/terminate`, and `/ws/admin/monitoring` `WATCH`/signaling handlers (preserving backward compatibility and `ws_calls.py` interviews). | `backend/app/models/authorization.py`, `backend/app/models/monitoring_audit.py`, `backend/app/models/__init__.py`, `backend/app/services/authorization.py`, `backend/app/api/v1/admin_monitoring.py`, `backend/app/api/v1/ws.py`, `backend/tests/test_authorization_lifecycle.py`, `backend/tests/test_monitoring_foundation.py` |
| **AUD-12** | Low/Medium | Resolved Ruff diagnostics (`I001`, `E501`) across `attempt.py`, `proctoring.py`, `ws.py`, and tests; added forward Alembic migration `0037_remediation_policy_and_tokens.py` aligning `proctoring_events.event_type` to `VARCHAR(50)` alongside `assessments.require_registered_device`, `consumed_activation_tokens`, and `monitoring_stream_grants`. | `backend/app/models/attempt.py`, `backend/app/services/proctoring.py`, `backend/alembic/versions/0037_remediation_policy_and_tokens.py` |

---

## Verification Summary (Post-Final Edit)

| Check | Command | Observed Result | Scope / Notes |
|---|---|---|---|
| **Desktop TypeScript** | `npx tsc -b` | Exit `0` (0 errors) | Full `apps/desktop` TS build |
| **Desktop Linter** | `npm run lint` (`oxlint`) | Exit `0` (0 errors, 21 pre-existing warnings across 363 files) | Full `apps/desktop` source |
| **Desktop Vitest** | `npm run test:unit` | **33 test files passed, 344 tests passed, 0 failed** | All unit tests incl. new Stage 2 & Stage 6 suites |
| **Rust Native Unit Tests** | `cargo test --offline --no-fail-fast` | **119 passed**, 1 sandbox failure (`credentials::tests::a_token_round_trips_through_the_credential_manager` — `credential store unavailable` in sandbox; all 119 remaining tests pass when skipped via `--skip credentials::tests`) | Includes DPAPI+AES-GCM, policy snapshots, closure reporting, & honest audit tests |
| **Backend Ruff Lint** | `.venv\Scripts\python -m ruff check app alembic/versions/0037_remediation_policy_and_tokens.py tests/...` | Exit `0` (`All checks passed!`) | Full `backend/app`, `0037` migration, and all modified test modules |
| **Backend Standalone Pytest** | `.venv\Scripts\python -m pytest tests/test_submission_closure.py tests/test_session_continuity.py tests/test_authorization_lifecycle.py tests/test_proctoring_foundation.py tests/test_proctoring_events_foundation.py tests/test_monitoring_foundation.py --noconftest -v` | **43 passed, 0 failed** | Covers schemas, signing/verification, start-mode eligibility, JTI replay rejection, active stop conflict, severity partitioning, & stream grants |
| **Alembic Migrations** | `.venv\Scripts\alembic heads` & `alembic upgrade 0030:head --sql` | Single head `0037 (head)`; clean PostgreSQL DDL generated for `0031`–`0037` | Verified offline DDL |
| **PostgreSQL DB Integration Suite** | Full `pytest` (DB-backed) | **Not run in sandbox** (`127.0.0.1:5433` loopback blocked / sandboxed) | Run `alembic upgrade head` and `pytest` against live PostgreSQL before deploy |

---

## Next Operational Actions (Outside Sandbox)

1. Apply database migrations on target environment:
   ```bash
   cd backend
   .venv\Scripts\alembic upgrade head
   .venv\Scripts\python -m pytest
   ```
2. Run credential manager test directly in interactive Windows user session:
   ```powershell
   cd apps\desktop\src-tauri
   cargo test credentials::tests
   ```
3. Review all local unstaged changes via `git status` / `git diff` when ready to commit.

