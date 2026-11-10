# ASSESSX — PHASE 3C ARCHITECTURE SPECIFICATION
## Secure Examination Submission, Exit Authorization & Examination Closure

**Version:** 1.0.0  
**Phase:** 3C  
**Platform:** Windows 10 / Windows 11 Desktop (Tauri + React + Rust) + FastAPI Backend  

---

## 1. Lifecycle Overview

The complete lifecycle for Phase 3C connects the candidate desktop application, the authoritative backend, and the Windows-native Security Agent:

```
[Candidate clicks 'Submit Exam']
             │
             ▼
[1. Submission Preparation & Review]
   - Evaluates answered vs unanswered questions
   - Displays Confirmation Modal (`SubmissionReviewModal.tsx`)
             │
             ▼
[2. Final Synchronization Flush]
   - `SessionSyncManager.drainQueue()` flushes all pending local answers
   - Blocking barrier guarantees 0 pending items before proceeding
             │
             ▼
[3. Authoritative Backend Submission]
   - `POST /api/v1/candidates/me/attempts/{attempt_id}/submission/confirm`
   - Atomically transitions attempt to `SUBMITTED`
   - Freezes answer modifications (ordinary sync rejected)
   - Computes canonical answer snapshot & SHA-256 `snapshot_hash`
   - Generates authoritative `receipt_id` and persists record
             │
             ▼
[4. Submission Receipt Display]
   - Displays `SubmissionReceiptCard.tsx` with verified timestamp & receipt ID
             │
             ▼
[5. Exit Authorization]
   - Desktop requests `POST /api/v1/candidates/me/attempts/{attempt_id}/closure/authorize`
   - Backend validates terminal attempt state (`SUBMITTED` or `TIME_EXPIRED`)
   - Backend generates signed HMAC-SHA256 `ExitAuthorizationToken`
             │
             ▼
[6. Native Windows Security Policy Restoration]
   - Desktop invokes Tauri command `authorize_secure_examination_exit`
   - Verifies HMAC token signature
   - Reverts low-level keyboard hooks & lockdown guard
   - Restores AppLocker / process allowlists
   - Restores system utility policies (CMD, PowerShell, Task Manager) from Change Journal
   - Rolls back USB / peripheral restrictions
   - Marks clean exit in `CrashRecoveryController`
             │
             ▼
[7. Closure Acknowledgement & Post-Exam Cleanup]
   - Desktop calls `POST /api/v1/candidates/me/attempts/{attempt_id}/closure/complete`
   - Backend sets `closure_status = 'CLOSED'` and `closure_completed_at = now`
   - Desktop safely clears local encrypted answer buffer
   - Renders `ExaminationCompletedPage.tsx`
```

