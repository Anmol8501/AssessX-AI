# Data retention and privacy

AssessX keeps personal data only as long as it is needed to run and review assessments. Retention is
automatic, configured on the server only (candidates can't change it), audited, and suspended for
attempts under active review.

Implementation: `backend/app/services/retention.py` (run hourly by `.github/workflows/maintenance.yml`
and the API itself) and `backend/app/services/evidence_clips/service.py`.

## What is stored, why, and for how long

| Data | Why | Kept | Then |
|---|---|---|---|
| Accounts (name, email, roll number, password hash; admin MFA secret, encrypted) | sign-in | while the account exists | deleted with the account |
| Sign-in sessions | staying signed in | until 30 days after expiry or revocation (`RETENTION_SESSION_DAYS`) | deleted |
| Password reset codes (HMAC only) | account recovery | 30 days after expiry | deleted |
| Sign-in challenges, throttling counters | abuse protection | about 1 hour / 1 day | deleted |
| Assessments, questions, answer keys | running exams | until an administrator deletes them | — |
| Attempts: answers, results, code submissions, drafts, messages | the exam record | **1,095 days (3 years)** after the attempt finished (`RETENTION_ATTEMPT_DAYS`) | deleted with everything under it |
| Proctoring events (including AI observations) | human review of the exam | **365 days** after the attempt finished (`RETENTION_PROCTORING_EVENT_DAYS`) | deleted |
| Evidence clip video | human review | **30 days** (`EVIDENCE_RETENTION_DAYS`) | video deleted; the record stays as EXPIRED |
| Interview sessions: answers, AI evaluations and flags, reviews, reports | the interview record | 1,095 days after completion | deleted with everything under it |
| Live interview chat and notes | the call record | with the interview | — |
| Security events and alerts | detecting and investigating attacks | **365 days** (`RETENTION_SECURITY_EVENT_DAYS`) | deleted |
| Audit log | accountability | **kept**: append-only and hash-chained | archive by hand (below) |
| Backups | recovery | 30 days (GitHub artifacts) | expire automatically |

A value of `0` keeps that category indefinitely. That's a deliberate institution decision; record it.

## Holds

Nothing belonging to an attempt whose review is **in progress** (`IN_REVIEW`) is removed: not its
attempt, events or clips. It is removed on the first run after the review completes and the period has
passed. For a legal hold, start a review and leave it open, or set the relevant period to `0` until the
hold ends.

## Deletion is auditable

* Each run that removes anything writes one `RETENTION_PURGED` audit row with the counts per category.
  It holds no content, and the actor is the system.
* Evidence expiry writes `EVIDENCE_CLIP_EXPIRED` per clip.
* An administrator deleting a clip writes `EVIDENCE_CLIP_DELETED`, with the reason.

## The audit log

The audit log is never deleted automatically, because it is the record of who did what (including
deletions), and it is hash-chained. It holds ids, actions, times, the request id and the client address,
never answers, notes or secrets. To archive old entries:
1. export them (Security → Audit trail, or SQL);
2. store the export encrypted;
3. record the chain head at the cut.

Deleting audit rows requires the database owner and breaks the chain from that point on, by design.

## Erasure requests and anonymisation

* **Exam data:** retention deletes a finished attempt and everything under it (answers, code, events,
  clips) after the period above. An earlier, targeted erasure is an operator task in SQL
  (`DELETE FROM assessment_attempts WHERE id = ...` cascades), run after a backup and recorded.
* **The account itself:** there is **no** account-deletion feature in this release. Deactivate the
  account: sign-in is blocked and its sessions end. The account row can't simply be deleted once it
  has audit history, because the audit log's actor reference is `ON DELETE RESTRICT` (the audit
  trail must keep resolving). Erasing the name, email and roll number while keeping the id
  (pseudonymisation) is the planned approach. Until then it is a manual, recorded operator step.
* **Security events** keep the user id only (`ON DELETE SET NULL`). They hold the client IP address and
  no content. For failed sign-ins, the typed email is stored only as an HMAC, never as text.
* Aggregate assessment statistics computed after a deletion don't include the deleted attempts.

## Who can access what

* **Administrators** (with MFA) can see all assessment, attempt, proctoring, evidence, interview and
  audit data. This is a single-organisation build, so there are no per-team scopes. Viewing evidence and
  the audit trail is itself audited.
* **Candidates** see only their own assignments, attempts, released results and interviews, never
  evidence, risk, reviews or audit data.

## Changing a period

1. Set the variable on Render and redeploy.
2. A shorter period takes effect at the next maintenance run and removes everything already past it, so
   check the impact first.
3. Record the change and its reason, for example in the institution's data-protection log.
