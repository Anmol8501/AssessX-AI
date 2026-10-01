# Phase 7C — Interview Report, Admin Review & Integration

**Status:** **Implemented (2026-10-01)**, completing the AI Interviews plan
([`PHASE-7-PLAN.md`](PHASE-7-PLAN.md)) on top of 7A ([`PHASE-7A-INTERVIEW-ENGINE.md`](PHASE-7A-INTERVIEW-ENGINE.md))
and 7B ([`PHASE-7B-AI-EVALUATION.md`](PHASE-7B-AI-EVALUATION.md)). The product owner calls it "Phase 7";
the roadmap numbers it Phase 8. The live WebRTC interview the product owner added to Phase 7 is 7D
([`PHASE-7D-LIVE-INTERVIEW.md`](PHASE-7D-LIVE-INTERVIEW.md)).

> **The AI assists; a person interprets.** The report shows the stored AI evaluations, labelled as
> AI-generated assessment signals. The human review records a person's administrative interpretation.
> Nothing hires, rejects, ranks or eliminates anyone. No score sets a status or an outcome. A reviewer's
> view never overwrites the AI's, and the AI's never overwrites the reviewer's.

## Architecture

```
interview_sessions · items (answers) · interview_evaluations (7B) · audit (adaptive decisions)
        │   read only — never re-evaluated, never modified
        ▼
InterviewReportService (policy 7C-v1, fixed number of queries)  ──►  GET …/sessions/{id}/report
        ▼
InterviewReviewService ──► interview_reviews · notes · decisions (with basis) · marks ──► audit_logs
        ▼
Desktop: Interviews → Reports & reviews (queue) → report page (AI sections | Human review panel)
```

**Derived, not stored.** The report is rebuilt from the stored rows on each request, so there is no
report table or snapshot. A COMPLETED evaluation never changes, so a finished session's report is
stable. What a reviewer saw is recorded with their decision (the basis).

**A separate review domain from Phase 6C.** The 6C tables are bound to assessment attempts, proctoring
evidence and misconduct outcomes (`attempt_id` is a required foreign key, the decision basis holds risk
columns, marks point at proctoring events). The interview review therefore has its own four tables but
**the same patterns**:
* UNREVIEWED (no row) → IN_REVIEW → REVIEWED, then revisions with a reason;
* immutable notes and decisions;
* `expected_version` plus `FOR UPDATE`, and 409 `review_conflict`;
* the append-only `audit_logs`;
* the same UI conventions.

## The report

| Section | Content | Source |
|---|---|---|
| Header | Candidate (name, roll number, email: admin-only), interview configuration, **three separate statuses**: interview (ACTIVE / COMPLETED + reason), AI evaluation (NONE / PENDING / PARTIAL / COMPLETE), human review (UNREVIEWED / IN_REVIEW / REVIEWED); start, end, duration | Stored rows |
| **AI evaluation summary** (labelled "AI-generated assessment signal") | AI score / 100 (**partial** when some answered primary wasn't evaluated); evaluated *n* of *m*; dimension means per rubric version; models, evaluator, rubric and report-policy versions | 7B evaluations |
| Completion (a completion figure, **not a score**) | Primary questions answered / planned (%), follow-ups asked and answered, duration | Session and items |
| Topics | Per configured topic: asked, answered, evaluated, AI score, concepts most often not covered | 7B evaluations |
| Questions and answers | Each question (text, topic, type, difficulty, primary or follow-up, how it was chosen, expected concepts as rubric context), the answer (plain text), the answer state, the AI evaluation (scores, concepts, strengths, quotes, feedback, confidence, flags, versions) and the reviewer's Agree/Disagree | Items, 7B evaluations, marks |
| Adaptive timeline | Q → answer state → the **policy's recorded reason** (e.g. "strong answer — one level harder; follow-up asked") | `INTERVIEW_ADAPTIVE_DECISION` audit records: rule codes, not AI reasoning |
| Proctoring | "Not applicable: interviews are not proctored in this build. Proctoring risk is never combined with interview results." | Stated, not hidden |
| **Human review** | Status, notes, outcome, rationale, revisions, history | Review tables and audit |

### Aggregation policy `7C-v1`

7C adds no second scoring algorithm; it reuses 7B's stored per-answer `overall_score`.

* **AI score** = the mean, rounded half up, of the **evaluated primary** answers.
* **Follow-ups are not averaged.** They are asked only after weak answers, so averaging them would make
  the score depend on the interview's path. They are shown and evaluated per question.
* **Topic score** = the same mean within a topic.
* **Dimension means** are per rubric version, to one decimal.
* **Failed, unavailable or pending evaluations are excluded, never counted as 0.** Coverage ("*n* of
  *m* evaluated") and the partial flag say so.

**Answer states are kept distinct:** NOT_ANSWERED · EVALUATION_PENDING · ANSWERED_NOT_EVALUATED · EVALUATED.

## The human review

**Outcomes** (a human administrative interpretation, never an employment decision on its own, never
automatic):

| Outcome | Meaning |
|---|---|
| `MEETS_EXPECTATIONS` | In the reviewer's judgement, the interview meets the expectations set for it |
| `NEEDS_FURTHER_ASSESSMENT` | The reviewer wants further assessment before reaching a view |
| `DOES_NOT_MEET_EXPECTATIONS` | In the reviewer's judgement, it does not |
| `INCONCLUSIVE` | The session doesn't represent the candidate fairly (technical problems, an abandoned interview) |

6C's NO_ACTION / CLEARED / FLAGGED / INVALIDATED describe misconduct handling, not interview performance,
and are refused here (422).

**Rules:**
* **Completing requires:**
  * an ended interview (otherwise 409 `interview_in_progress`; completion first applies the server's
    clock);
  * **no pending evaluations** (otherwise 409 `evaluations_pending`; the report also shows
    `blocked_reason`);
  * an outcome;
  * a rationale (1–4000 characters);
  * `expected_version`.
* **The decision is immutable and records its basis:** the report policy version, AI score and partial
  flag, evaluation state, evaluated / answered / planned counts, and evaluator and rubric versions.
* **Revising** creates revision *n + 1* with a reason; earlier decisions stay. Revising to the outcome
  already recorded is 422 (add a note instead).
* **Notes** are immutable and human-authored; there is no edit or delete route.
* **Agree / Disagree** marks one answer's AI evaluation:
  * only while the review is in progress;
  * only for a completed evaluation of *this* session;
  * append-only, newest wins;
  * **never changes the AI score.**
* **The UI** pre-selects no outcome and asks for confirmation: "your administrative interpretation… not
  an AI decision".
* **Separation is tested both ways:**
  * no AI score ever sets a review;
  * reviewing never changes an evaluation, an answer or the session;
  * human text never enters the AI record;
  * interview reviews never touch proctoring reviews, evidence or risk.

## API (admin only, `AdminUser`)

| Method and path | Purpose |
|---|---|
| `GET /api/v1/interviews/reports?interview_id&session_status&review_status&evaluation_state&finished_from&finished_to&limit&cursor` | The queue: sessions newest first (keyset paging, ≤ 50 per page), counts per review status, evaluation state and AI score for the page (one query). **Never ranked or sorted by score.** |
| `GET /api/v1/interviews/{id}/sessions/{session_id}/report` | The report. The session must belong to that interview, otherwise 404. |
| `POST …/review` | Start (201) or return the existing review (200) |
| `POST …/review/notes` | `{body}` |
| `PUT …/review/marks/{item_id}` | `{mark: AGREE \| DISAGREE}`. 404 if the item isn't in this session; 422 if it has no completed evaluation. |
| `POST …/review/complete` | `{outcome, rationale, expected_version}` |
| `POST …/review/revise` | Same body |

* Writes return the whole report.
* Requests are strict: any of `reviewer_id`, `decided_by_id`, `completed_at`, `status`, `ai_score`,
  `candidate_id`, `evaluator_version`, `organization_id` → 422.
* Candidates get 403 everywhere, anonymous requests 401.
* **There is no candidate-facing report.** No candidate response contains a score, an outcome, a note or
  rubric context.
* The assignments list now includes `session_id`, so the editor can link to the report. The 7B
  evaluations endpoint remains for compatibility.

## Audit

**Actions:**
* `INTERVIEW_REVIEW_STARTED`, `…_NOTE_ADDED` (note id and length, **never the text**),
  `…_ANSWER_MARKED` (item, evaluation, mark, previous mark);
* `…_COMPLETED` / `…_REVISED` (outcome, previous outcome, revision, version, AI score and partial flag,
  evaluation state, report policy version).

These are written in the same transaction as the action, in the append-only `audit_logs`. The report
shows the review history, capped at 200 entries.

**Report reads** are logged on `assessx.interviews.report` with ids only, as evidence reads are, not as
audit rows (a live report would flood the table).

## Database (migration `0017_phase_7c_interview_review`)

| Table | Contents |
|---|---|
| `interview_reviews` | Unique session; status; outcome; version; started_by/at; completed_by/at. CHECKs: REVIEWED ⇔ an outcome and a completer; version ≥ 1; completion after start. |
| `interview_review_notes` | 1–4000 characters; immutable |
| `interview_review_decisions` | Unique (review, revision); outcome; rationale; decided_by/at; the basis (report policy version; AI score 0–100 or null; partial flag; evaluation state; counts with evaluated ≤ answered ≤ planned; evaluator and rubric version lists) |
| `interview_review_marks` | Item, evaluation, AGREE/DISAGREE, author, time |

* User foreign keys are RESTRICT; session, item and evaluation foreign keys are CASCADE.
* RLS is enabled with no policies, as in 0014–0016.
* `audit_logs` gains the five actions.
* No existing table changes. Downgrade removes only what 0017 added.

## Desktop

* **Interviews:** a **Reports & reviews** button opens the queue.
* **Queue** (`/admin/interviews/reports`):
  * review-status counts, which also act as filters, plus filters for completed / in progress and
    partial / pending;
  * a table with columns Candidate · Interview · **AI evaluation** · **Human review**;
  * "Load more".
* **Report** (`/admin/interviews/:id/sessions/:sessionId`), with the AI sections on the left (summary,
  topics, questions with Agree/Disagree, timeline, proctoring) and the **Human review** panel on the
  right:
  * status, notes, an outcome with no default, a rationale, a confirmation dialog;
  * the outcome next to "AI score then … (AI-generated)";
  * earlier decisions and the history.
* **The interview editor's** assignment rows link to **Open report**.
* **Answers and notes are rendered as plain text.**

## Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_interview_report.py` | 9 | the aggregation policy; a complete report equals the stored 7B scores, with follow-ups excluded from the AI score; topics, dimension means, the timeline's recorded decisions; unanswered vs not-evaluated vs evaluated, a failure never scored 0; partial labelling; pending shown; no evaluator → no AI score; building a report never calls the evaluator; admin-only access, wrong-interview session 404, candidates see no report material; the queue's filters, paging, never ranked, no N+1 |
| `backend/tests/test_interview_review.py` | 30 | start, note, mark, complete by a human, with the basis recorded; completion blocked while the interview runs or evaluations are pending; nothing before start; revision only, with the earlier decision kept; a stale decision refused; marks scoped to completed evaluations of this session; **reviewing never changes AI evaluations, answers or the session**; **no AI score ever sets a review**; interview vs proctoring reviews separated; candidates and anonymous refused on all 7 routes; cross-interview session 404; 8 forged privileged fields 422; 8 invalid decisions 422 (including HIRE, REJECT, CHEATED and 6C's CLEARED); notes immutable and never logged; the audit sequence; database CHECKs; audit append-only |
| `backend/tests/test_interview_review_concurrency.py` | 2 | real races: two reviewers completing at once → one decision, one 409 naming the winner; reading the report during completion → never half-written |
| `apps/desktop/src/features/interviews/report/__tests__/report.test.ts` | 4 | outcome and status labels free of hiring or verdict wording; distinct answer states; policy reasons in words; history lines from allow-listed details |
| `apps/desktop/e2e/interview-report.spec.ts` | 1 | queue → report (AI summary 55/100 labelled, answers, evaluations, timeline, "proctoring: not applicable") → start review → note → Disagree (the AI score stays 20) → outcome with no default → confirmation → revision → history; a candidate gets 403 on the report |
| `apps/desktop/e2e/interview-adaptive.spec.ts` | (updated) | the 7B admin check now reads the evaluation through the report |

## Known limitations

1. **The aggregation policy is a first version.** Equal weights across questions and no follow-ups in the
   score are documented choices, not validated ones; changing them means a new policy version.
2. **There's no export (PDF/CSV) and no search.** Neither exists anywhere in the product; both are
   deferred.
3. **There's no re-evaluation.** A failed or unavailable answer stays unevaluated. Running it again would
   need a versioning decision (a new evaluator version creates a new row, and the report shows the newest).
4. **Single-tenant, ADMIN-only.** There is no INTERVIEWER role (OQ-03) and no organisations. Any admin
   may review any interview, as with every other admin feature.
5. **There's no retention policy** for answers, evaluations, notes or reviews anywhere in the project.
   That's a product and legal decision, and none is invented here.
6. **Unassigning a candidate still deletes their session**, and with it the report and review (existing
   behaviour). The audit trail remains.
7. **Interviews aren't proctored**, so the report has no risk section to show. A future link must keep
   interview performance and proctoring risk side by side, never combined.
8. **The live WebRTC interview** the product owner added to Phase 7 is not yet scheduled into a stage.
