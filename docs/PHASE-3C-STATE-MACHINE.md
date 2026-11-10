# ASSESSX — PHASE 3C STATE MACHINE SPECIFICATION
## Examination Submission & Closure Lifecycle State Machine

**Version:** 1.0.0  
**Phase:** 3C  

---

## 1. Formal States

The lifecycle transitions through the following discrete states:

```
+---------------------------------------------------------------------------------------------------------+
| Attempt Status (attempt.status) | Closure Status (attempt.closure_status) | Description                 |
+---------------------------------+-----------------------------------------+-----------------------------+
| IN_PROGRESS                     | ACTIVE                                  | Active candidate exam.      |
| IN_PROGRESS                     | SUBMISSION_REQUESTED                    | Candidate opened review.    |
| IN_PROGRESS                     | FINAL_SYNC_IN_PROGRESS                  | Draining pending answers.   |
| SUBMITTED                       | SUBMITTED                               | Committed to database.      |
| TIME_EXPIRED                    | SUBMITTED                               | Auto-timeout committed.     |
| SUBMITTED / TIME_EXPIRED        | CLOSURE_AUTHORIZED                     | Signed exit token issued.   |
| SUBMITTED / TIME_EXPIRED        | RESTORING                               | Native OS restoration run.  |
| SUBMITTED / TIME_EXPIRED        | CLOSED                                  | OS restored & receipt saved.|
| SUBMITTED / TIME_EXPIRED        | RESTORATION_FAILED                      | Partial policy restore.     |
+---------------------------------------------------------------------------------------------------------+
```

---

## 2. Invariant Rules

1. **Terminal Immobility:** Once `attempt.status` reaches `SUBMITTED` or `TIME_EXPIRED`, it can NEVER revert to `IN_PROGRESS`.
2. **Answer Freeze:** In terminal status, all answer sync mutations are rejected with HTTP 409 Conflict (`AttemptLocked`).
3. **Exit Token Gating:** `closure/authorize` is strictly refused unless attempt status is in `TERMINAL_ATTEMPT_STATUSES`.
4. **Idempotent Submission:** Double-clicking or retrying `submission/confirm` returns the exact same snapshot and receipt without duplicating database records.
5. **Restoration Verification:** `closure/complete` requires native restoration result verification before marking `CLOSED`.

