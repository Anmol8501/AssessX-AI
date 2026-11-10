# ASSESSX — PHASE 3C FAILURE RECOVERY SPECIFICATION
## Failure Modes, Edge Cases & Recovery Procedures

**Version:** 1.0.0  
**Phase:** 3C  

---

## 1. Disconnection During Submission
- **Problem:** Candidate is offline or network drops right as Submit is clicked.
- **Handling:**
  - `SessionSyncManager` retains pending items in the local encrypted buffer.
  - The UI notifies the candidate that answers are safely saved locally and retries synchronization.
  - The submission request is NOT marked complete until backend confirms HTTP 200 with receipt.

## 2. Power Outage or Crash After Submission Commit But Before OS Restoration
- **Problem:** Attempt is `SUBMITTED` on the backend, but desktop crashed before restoring Windows.
- **Handling:**
  - Upon restart, `RecoveryWatcher` detects un-finalized closure state.
  - Queries `GET /api/v1/candidates/me/attempts/{attempt_id}/submission/receipt`.
  - Sees attempt is already `SUBMITTED`.
  - Automatically fetches `POST .../closure/authorize` and triggers native restoration immediately without prompting for re-submission.

## 3. Simultaneous Manual and Automatic Timeout Submission
- **Problem:** Candidate clicks Submit at the exact instant `settle()` marks `TIME_EXPIRED`.
- **Handling:**
  - Pessimistic locking `SELECT FOR UPDATE` serializes the operations.
  - Whichever transaction completes first commits the snapshot and assigns `submission_type` (`MANUAL` or `AUTOMATIC_TIMEOUT`).
  - The second transaction reads the already finalized attempt and idempotently returns the same receipt without creating duplicate records.

