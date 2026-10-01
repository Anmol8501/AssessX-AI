# Phase 6C — Human Review & Administrative Decision

**Status:** **Implemented (2026-10-01)**, on top of Phase 6A ([`PHASE-6A-RISK-ENGINE.md`](PHASE-6A-RISK-ENGINE.md))
and Phase 6B ([`PHASE-6B-EVIDENCE.md`](PHASE-6B-EVIDENCE.md)). This completes the Risk & Evidence plan
([`PHASE-6-PLAN.md`](PHASE-6-PLAN.md)). The product owner calls it "Phase 6"; the roadmap numbers it Phase 7.

**The system never decides that a candidate cheated.** Risk (6A) and evidence (6B) are signals. A person
reads them and records an administrative outcome. Nothing reads the risk to choose, suggest, require or
forbid an outcome: a HIGH-risk attempt may be CLEARED, and a NORMAL one may be FLAGGED. Tests prove both.

Detect → Correlate → Explain → Evidence → **Human Review → Administrative Decision**.

## Architecture

```
6A risk (read only) ──┐
6B evidence (read)  ──┼──► ReviewService ──► attempt_reviews · review_notes · review_decisions · review_marks
                      │          │              (human-authored; append-oriented)
                      │          └─────────► audit_logs  (append-only by trigger; survives deletion)
                      ▼
GET/POST /api/v1/admin/attempts/{attempt_id}/review…      GET /api/v1/admin/attempts (queue)
                      ▼
Desktop: Reviews (queue) → Attempt review (system signals | human review)
```

* **6A and 6B are reused, not repeated.**
  * The review screen shows the existing risk panel and evidence timeline unchanged.
  * An evidence id is validated through 6B's `evidence_item`.
  * A decision's recorded basis comes from one read of the events (`RiskService.basis`).
* **The additions to 6A/6B are additive only:**
  * `RiskService.basis()` and `assess_many()`;
  * `RiskRepository.events_for_sessions()` (one batched query for a queue page);
  * an optional `review` prop on `EvidenceTimeline`.

  The existing outputs are unchanged.
* **Every write runs in one transaction**, committed once by `DatabaseSessionMiddleware`, in this order:
  1. validate the attempt;
  2. lock the review row and check its state and version;
  3. write the change;
  4. write its audit record.

  Every check runs before any write, so a refused request (4xx) writes nothing — with one deliberate
  exception: applying the attempt's clock (`settle`) before completing is kept, exactly as for exam
  submissions, because `DatabaseSessionMiddleware` commits handled errors. A database error rolls the
  whole request back.

## Lifecycle and decisions

```
UNREVIEWED ──start──► IN_REVIEW ──complete(outcome, rationale)──► REVIEWED
(no row)                                                           │
                                         revise(outcome, reason) ──┘  (new revision; earlier kept)
```

**UNREVIEWED is not stored.** It means there is no review row, so no attempt ever needs a back-filled row.

**Starting is idempotent.** Two simultaneous starts race on the unique `attempt_id`; the loser reads the
winner's review.

**Completing requires:**
* a finished attempt: an outcome is recorded only once the attempt has been submitted or has expired, so
  its evidence is final;
* an outcome;
* a non-empty rationale (at most 4000 characters);
* the `expected_version` the administrator was looking at.

Completion first applies the attempt's clock, as a submit would, so an attempt whose time ran out can
be completed.

**Revising** a completed review creates decision revision *n + 1* with a required reason. The earlier
decision stays unchanged and visible; nothing is overwritten. Revising to the outcome already recorded
is refused (422); a further remark is a note instead.

**Notes** are immutable, with no edit or delete route. They are allowed while the review is in progress
and after it is completed.

**Marks** (confirm/dismiss) are allowed only while the review is in progress; they freeze with the
decision.

### Decisions taken (the product owner approved the recommendations on 2026-10-01)

| Question | Decision |
|---|---|
| Outcome vocabulary vs PRD FR-018 ("confirm event / dismiss event / escalate case") | **Both, at two levels:**<br>• per evidence item, `CONFIRMED` / `DISMISSED` marks (FR-018's event actions);<br>• per attempt, `NO_ACTION` · `CLEARED` · `FLAGGED` · `INVALIDATED`.<br>FLAGGED stands in for "escalate case", since there is one admin role. **This diverges from the PRD's wording** and is recorded here. |
| What INVALIDATED does | **Recorded only.** The attempt, its score and what the candidate sees are unchanged. A result change would be a separate, audited action (TRD §30 "result modification"). |
| Changes after completion | **Revision with a required reason**, keeping every earlier decision. |
| Per-evidence marks | Included. A mark is an annotation and never changes the evidence or the risk. |
| Audit | A generic `audit_logs` table (TRD §5 `AuditLog`). A trigger rejects UPDATE and DELETE. |
| RLS | Enabled with **no policies** on the five new tables only (see Security). |
| Scope | Any ADMIN may review any attempt. This is single-tenant, the same as results, monitoring, risk and evidence. |

## Database (migration `0014`, new tables only)

| Table | Holds | Integrity |
|---|---|---|
| `attempt_reviews` | One row per attempt: `status`, current `outcome`, `version`, `started_by/at`, `completed_by/at` (the latest decision) | `attempt_id` is unique and cascades with the attempt. CHECKs:<br>• status ∈ {IN_REVIEW, REVIEWED};<br>• outcome ∈ the four values;<br>• REVIEWED ⇔ outcome, completer and completion time are all set;<br>• `version ≥ 1`;<br>• completed ≥ started. |
| `review_notes` | Author, body and time | Body 1–4000 characters; no `updated_at` (immutable) |
| `review_decisions` | `revision`, `outcome`, `rationale`, `decided_by/at`, plus the **basis**: policy and evidence versions, risk score/level/peak and signal, evidence and episode counts at that moment | `(review_id, revision)` unique; scores 0–100; levels and outcome constrained |
| `review_marks` | `evidence_event_id` (FK to `proctoring_events`), mark, author, time | Append-only; the newest mark per item is current |
| `audit_logs` | `actor_id`, `action`, `attempt_id`, `assessment_id`, allow-listed `details`, `occurred_at` | A trigger rejects UPDATE and DELETE. **No FK to the attempt or assessment**, so the record survives their deletion. |

Every user foreign key is `RESTRICT`; no user-delete path exists. No candidate data is copied, and nothing
records frames, video, audio, embeddings or biometrics.

**Why the audit log has no attempt FK.** An administrator can delete an assessment or unassign a
candidate at any time. Either cascades away the attempt, its events and its review. The audit log keeps
the record that the review happened: who did it, when, and the outcome and revision.

## API (all `AdminUser`)

| Route | Purpose |
|---|---|
| `GET /api/v1/admin/attempts?review_status&assessment_id&finished_from&finished_to&limit&cursor` | The queue: proctored attempts, newest first, with `counts` per status (under the same filters, ignoring status), the current 6A risk level and score, the review status and the outcome. Default 20 per page, at most 50. |
| `GET /api/v1/admin/attempts/{id}/review` | Context (candidate name and roll number, assessment, attempt), status, version, notes, decisions (newest first, each with its basis), current marks, history (from `audit_logs`), outcome options and the interpretation |
| `POST /api/v1/admin/attempts/{id}/review` | Start: 201 if new, 200 if it already exists |
| `POST /api/v1/admin/attempts/{id}/review/notes` | `{body}` → 201 |
| `PUT /api/v1/admin/attempts/{id}/review/marks/{evidence_id}` | `{mark}`; 404 if the evidence isn't part of *this* attempt |
| `POST /api/v1/admin/attempts/{id}/review/complete` | `{outcome, rationale, expected_version}` |
| `POST /api/v1/admin/attempts/{id}/review/revise` | `{outcome, rationale, expected_version}` |

**No route takes a review id.** A review is reached only through its attempt, so one attempt's URL
can't touch another attempt's review (IDOR/BOLA).

**Requests are strict** (`extra="forbid"`). A body naming `reviewer_id`, `decided_by_id`,
`completed_at`, `status`, `risk_score` and so on is rejected with 422. The reviewer, the author and
every timestamp come from the authenticated administrator and the server clock.

**Responses label who wrote what.** Notes and decisions carry `authored_by: "HUMAN"`. The basis is
labelled as the system's risk at decision time. No emails are included.

**Errors:**
| Status / code | Cause |
|---|---|
| 401 | anonymous |
| 403 | candidate, or deactivated admin |
| 404 | unknown or unproctored attempt; foreign evidence |
| 409 `review_not_started` | — |
| 409 `review_conflict` | a stale version, or the wrong state. `details` gives the current status, version, outcome and who completed it. |
| 409 `attempt_in_progress` | — |
| 422 | invalid or missing fields |

## UI

* **Reviews** (admin navigation), the queue:
  * status counts, which also act as filters;
  * filters by assessment and finish date;
  * a table with *Risk signal · system* and *Outcome · human* in separate columns;
  * "Load more" for further pages.
* **Attempt review** (`/admin/reviews/:attemptId`):
  * a context header;
  * **left, "System-generated · signals for review, not a verdict"**: the 6A risk panel and the 6B
    evidence timeline, with *Confirm observation / Dismiss* controls while the review is open;
  * **right, "Human-authored · your decision"**:
    * status;
    * notes (author and time);
    * the outcome radio group, with **nothing pre-selected**;
    * a required rationale;
    * Complete, and Revise outcome;
    * the current outcome shown as *Administrative outcome · human* next to *Risk signal at decision · system*;
    * earlier decisions and the review history.
* **On a 409 conflict**, the screen reloads the review and says who changed it. It never retries a
  write on its own.
* **Entry points:**
  * "Open review" in the results page's *Risk & evidence* dialog;
  * "Open review" in the live candidate detail view. Notes can be added live; an outcome is recorded after
    the attempt ends.
* **New shared components:** `Textarea` and `RadioGroup` in `components/ui/Field.tsx`, styled like the
  existing inputs.

## Security and privacy

* **Authorization is server-side.**
  * The `AdminUser` guard is on every route: candidates get 403 everywhere (on their own attempt and on
    anyone else's), anonymous requests 401, and a deactivated admin is refused.
  * Candidate endpoints never expose review data, and a test checks the result, attempt and results
    payloads.
* **Concurrency.** `complete` locks the attempt row, then the review row (`SELECT … FOR UPDATE`); `revise`
  and `mark` lock the review row. Every write also checks the state, and decisions check the version. A
  second administrator therefore waits, sees the first decision and gets 409. That decision is never
  silently overwritten.
* **Audit.** The actions recorded are:
  * `REVIEW_STARTED`
  * `REVIEW_NOTE_ADDED`: the note's id and length, **never its text**
  * `REVIEW_EVIDENCE_MARKED`: the mark and the previous mark
  * `REVIEW_COMPLETED`
  * `REVIEW_REVISED`: the previous and new outcome, the revision, the version, and the risk level, score
    and policy version

  Each is written in the same transaction as its action. The `assessx.review` logger records action and
  ids only: no note text, tokens or PII.
* **Row-level security.**
  * The API and Alembic connect as the same database role, which owns these tables and so isn't subject
    to RLS.
  * Enabling RLS **without policies** (and without FORCE) therefore leaves the API unaffected, while
    denying every other role any access. That includes Supabase's `anon` and `authenticated` Data API
    roles, so neither can read review notes or the audit log.
  * Existing tables are unchanged; hardening them is a separate decision.
  * If the API ever connects as a non-owner role without BYPASSRLS, it would see these tables as empty.
    Grant that role a policy at that point.
* **The append-only audit log protects against the application, not the database owner**, who could
  drop the trigger. Tamper evidence (hash chaining) remains open decision OQ-12.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_review_api.py` | 55 | **Access and isolation:** open with context; unknown, unproctored and malformed attempts; candidates refused on every route (own attempt and another's); anonymous 401; deactivated admin refused; candidate payloads never expose the review.<br>**Lifecycle:** idempotent, server-attributed start; nothing before start; an outcome needs a finished attempt; an expired attempt is settled on completion; server identity and time.<br>**Validation:** forged reviewer, time, state or risk fields rejected; invalid, missing, blank or oversized outcomes, rationales and versions rejected; malformed bodies.<br>**Decisions:** a stale decision doesn't overwrite; completed reviews change only by an audited revision, with v1 kept; revising an open review is refused.<br>**Notes and marks:** notes are immutable, human-authored and never logged; marks are scoped to this attempt and frozen after completion.<br>**Separation:** the basis equals 6A/6B, and the risk, evidence and event store are unchanged; HIGH risk allows all four outcomes and NORMAL risk allows all four; high risk alone produces no outcome; INVALIDATED is recorded only.<br>**Audit:** every action audited with allow-listed details; the log is append-only at the database; audit records survive deletion.<br>**Database:** constraints on states, outcomes, version and foreign keys; one review per attempt; unique revisions; empty notes rejected.<br>**Queue:** risk and review side by side; status, assessment and date filters; invalid parameters rejected; complete paging; no N+1. |
| `backend/tests/test_review_concurrency.py` | 1 | A real race: committed data, two threads on separate connections complete at once. Exactly one decision, one audit record and one 409 naming the winner. |
| `backend/tests/test_review_policy.py` | 7 | Neutral vocabulary (no verdict words in any outcome, mark, action or message); the interpretation separates signal from decision; transitions only move forward; invalid queue cursors |
| `backend/tests/test_migrations.py` (existing) | 3 | Round-trip, plus model–migration agreement including the new tables |
| `apps/desktop/src/features/admin/review/__tests__/review.test.ts` | 6 | Mapping that keeps outcome and risk separate; an unreviewed attempt invents nothing; queue mapping; neutral labels; risk labels never double as outcome labels; history built from allow-listed details |
| `apps/desktop/e2e/review.spec.ts` | 3 | Queue → start → confirm evidence → note → explicit outcome (Flagged on a Low-risk attempt) → revise to Cleared, with history and the earlier decision kept → back in the queue. A stale decision is refused and the review reloaded. A candidate can reach neither the screens nor the API. |

## Known limitations

1. **Queue risk is computed per page.** It's batched into one events query per page of up to 50
   attempts, bounded by each session's 5,000-event ceiling. There's no risk-level filter, because risk is
   derived on demand (6A open item 9).
2. **Single-tenant scope.** Any administrator can review any attempt, as with results and monitoring.
   Per-organisation scoping (TRD §6) and the PROCTOR role (OQ-03) remain open.
3. **Outcomes have no consequences.** INVALIDATED and FLAGGED don't change results or notify anyone. A
   result change or escalation workflow would be a separate feature.
4. **The audit log is append-only against the application, not the database owner.** Hash chaining is
   OQ-12. Evidence *reads* are still log lines (`assessx.evidence`), not audit rows.
5. **Deleting an assessment or unassigning a candidate** still cascades away the attempt and its review.
   This is existing behaviour; only the audit trail survives. Whether reviewed attempts should block
   deletion is an open product decision.
6. **The new screens reach candidates' laptops only through a new app release** (the updater).
