# Phase 7A — AI Interview Engine & Question Flow

**Status:** **Implemented (2026-10-01).** First stage of the AI Interviews plan
([`PHASE-7-PLAN.md`](PHASE-7-PLAN.md)). The product owner calls it "Phase 7"; the roadmap numbers it
Phase 8. **7B (AI answer evaluation) is implemented** — [`PHASE-7B-AI-EVALUATION.md`](PHASE-7B-AI-EVALUATION.md),
which keeps everything below and adds evaluation and adaptive selection (with no evaluator configured, 7A
behaviour is unchanged). **7C (report & human review) has not been started.**

> **Phase 7A does not evaluate candidate answers.** Nothing scores, ranks or judges an answer, and
> nothing calls an AI model. There is no LLM, no provider key and no generated question anywhere.
> Question selection is deterministic and server-controlled. A follow-up is the one an administrator
> configured for that question, not an adaptive choice. Answers are stored exactly as written, for 7B
> to evaluate and 7C to report.

## Architecture

```
Admin (AdminUser)                               Candidate (CandidateUser, own data only)
/api/v1/interviews…                             /api/v1/candidates/me/interviews…, /interview-sessions/…
      │                                                   │
InterviewService ── configure · questions · publish ·     InterviewSessionService ── start/resume · state ·
      │             assign (DRAFT editable, PUBLISHED      │                          answer · complete
      │             locked)                                │      │
      ▼                                                    ▼      ▼
interviews · interview_questions · interview_assignments   QuestionSelectionService (pure, deterministic)
                                                           interview_sessions · interview_session_items
                                   ╰──────────── audit_logs (append-only; ids and lengths, never text) ───╯
```

* **An interview is its own entity.** It has its own tables and is created, published and assigned
  like an assessment. It is **not** an assessment: it has no marks, no answer key, no results and no
  proctoring.
* **It is fully separate from Phase 6.** An interview writes no proctoring events and has no
  proctoring session, risk, evidence or review; a test asserts that. A weak answer is never a
  proctoring signal, and a proctoring event is never an interview score.
* **It is transport-independent.** Sessions, questions and answers don't assume text, so the live
  WebRTC video interview the product owner added to Phase 7 can later attach to the same session.

## Lifecycles

**Interview:**
```
DRAFT ──publish (enough eligible questions)──► PUBLISHED ──unpublish (nobody assigned)──► DRAFT
```
* Edits to the interview and its questions are allowed only in DRAFT. Once published, every session
  sees the same questions.
* Delete is allowed only in DRAFT.

**Session** (one per candidate per interview; no restart, no pause):
```
NOT_STARTED (no row) ──start──► ACTIVE ──┬─ all planned questions answered ─► COMPLETED (ALL_ANSWERED)
                                         ├─ deadline reached ───────────────► COMPLETED (TIME_EXPIRED)
                                         └─ candidate ends early ───────────► COMPLETED (ENDED_BY_CANDIDATE)
```
* There is no PAUSED state. Nothing stops the server's clock, so a candidate can't buy time.
* COMPLETED is final: there are no new questions and no new answers.

**Session item** (one presented question):
```
PRESENTED ──answer (once, immutable)──► ANSWERED
```
* At most one item is PRESENTED per session, enforced by a partial unique index.
* A question appears in a session at most once, enforced by a unique constraint.

## Question selection (`services/interview/selection.py`)

1. **The plan.** At start, the eligible questions are the interview's **active primary** questions
   that meet all of these:
   * the topic is one of the interview's topics;
   * the type suits the interview type:
     * TECHNICAL → technical, conceptual or scenario questions;
     * BEHAVIORAL → behavioral questions;
     * MIXED → any;
   * the difficulty is **at or below** the interview's difficulty.

   The first `question_count` of them, in authored order `(position, id)`, are stored on the session as
   `question_plan`. The plan is never recomputed, so a refresh, a reconnect or a repeated request can't
   change the questions.
2. **After a primary question is answered,** its configured follow-up is asked next, if all of these
   hold:
   * follow-ups are enabled;
   * the session's follow-up budget (`max_follow_ups`) isn't used up;
   * the question has an active follow-up.

   A question has **at most one follow-up**, enforced by a unique constraint. The budget is counted when
   a follow-up is asked. There is never a follow-up to a follow-up.
3. **Otherwise** the next unasked question in the plan is asked. **When none are left,** the session
   completes.

The client never names a question. The current question is derived from the session.

## API

**Admin**, `/api/v1/interviews` (`AdminUser`):

| Route | Purpose |
|---|---|
| `GET` / `POST /interviews` | List; create (DRAFT) |
| `GET` / `PATCH` / `DELETE /interviews/{id}` | Detail, including questions, the eligible count and publishing `issues`; edit and delete are DRAFT-only, otherwise 409 `interview_locked` |
| `POST /interviews/{id}/publish` · `/unpublish` | Publish (422 with the issues unless enough eligible questions exist); unpublish (409 while anyone is assigned) |
| `POST /interviews/{id}/questions` | Add a primary question (its topic must be one of the interview's) |
| `PATCH` / `DELETE /interviews/{id}/questions/{qid}` | Edit or delete (deleting a primary deletes its follow-up) |
| `POST /interviews/{id}/questions/{qid}/follow-up` | Add the question's follow-up (409 if one exists). It inherits the topic, type and difficulty. |
| `POST /interviews/{id}/questions/reorder` | The order of primary questions (must list every one exactly once) |
| `GET` / `POST /interviews/{id}/assignments` · `DELETE …/{candidate_id}` | Progress per candidate (**never answers**); assign (published only, active candidates only); unassign |

**Candidate**, `/api/v1/candidates/me` (`CandidateUser`; every lookup is scoped to the signed-in
candidate):

| Route | Purpose |
|---|---|
| `GET /interviews` · `GET /interviews/{id}` | My assigned, published interviews; details. 404 if the interview isn't mine or isn't published. |
| `POST /interviews/{id}/session` | Start (201) or resume (200). Idempotent; there is no restart. |
| `GET /interview-sessions/{sid}` | **The authoritative state:** status, `server_time`, `expires_at`, `remaining_seconds`, progress and the current question. Never advances the session. |
| `POST /interview-sessions/{sid}/answers` | `{item_id, answer_text}` (1–10,000 characters, trimmed). Saves the answer and presents the next question (or completes) **in one transaction**; the response is the new state. |
| `POST /interview-sessions/{sid}/complete` | End early (idempotent). The question on screen is left unanswered. |

**The current question as the candidate sees it** contains: item id, kind, number, text, context,
topic, difficulty, type and the advisory time limit. **Never** `expected_concepts`, `competency`, bank
ids or any evaluation field. These are separate response classes that don't have those fields.

**Errors** use the standard `{"error": {code, message, details}}` format:

| Status / code | Cause |
|---|---|
| 401 | anonymous |
| 403 | wrong role |
| 404 | not yours, unknown, or unpublished |
| 409 `stale_question` | the item isn't the current one: a retry, a replay or a second window. Nothing is saved; `details.current_item_id` |
| 409 `interview_completed` | the session has ended (`details.completion_reason`) |
| 409 `interview_locked` | the interview is published |
| 422 | invalid input, or unknown fields such as `status`, `score`, `candidate_id`, `remaining_seconds` |

## The clock

* `expires_at = started_at + duration` is written **once** at start, from the server's clock.
* Every read and write first applies the clock (`settle`, the same rule as exam attempts):
  * an ACTIVE session past its deadline is completed as TIME_EXPIRED;
  * `completed_at` is set to **the deadline**, not to "now";
  * the action is audited as `ended_by: server_clock`.
* An answer **at or after** the deadline is refused (`>=`: the final instant is not a free tick).
* No request carries a time. Client clocks and headers are ignored, and forged timing fields are 422.
* The desktop countdown measures its offset from `server_time` and resyncs every 30 s and on focus.
  Reaching zero locally only prompts it to ask the server.
* A question's own time limit is **advisory** (shown as "Suggested time") and not enforced; the
  interview deadline is.

## Concurrency and transactions

* Every session write locks the session row (`SELECT … FOR UPDATE`) and works out what happens from the
  locked state.
* **A double-clicked or retried answer:** the second request waits for the first, sees the item already
  answered, and gets 409 `stale_question`. The session moves on exactly once.
* **Two simultaneous starts** race on the unique `(interview, candidate)` key. The loser's savepoint
  rolls back and it resumes the winner's session.
* Both races are tested for real: committed data, with two threads on separate database connections.
* Every check runs before any write, so a refused request writes nothing. The deliberate exception is
  applying the clock, which is kept, as for exam attempts, because `DatabaseSessionMiddleware` commits on
  handled errors.

## Database (migration `0015_phase_7a_interview_engine`)

| Table | Notes |
|---|---|
| `interviews` | type, difficulty, topics (JSONB array), duration 5–180, `question_count` 1–30, `follow_ups_enabled`, `max_follow_ups` (≤ `question_count`), status, `created_by` (RESTRICT), `published_at` (set ⇔ PUBLISHED) |
| `interview_questions` | `kind`, `parent_question_id`, `text` (1–2000), `question_type`, `topic`, `difficulty`, `expected_concepts` (JSONB, admin-only), `competency` (admin-only), `context`, `time_limit_seconds` (10–3600), `position`, `is_active`. Constraints:<br>• FOLLOW_UP ⇔ it has a parent;<br>• the parent is in the **same interview** (composite foreign key);<br>• one follow-up per primary (unique). |
| `interview_assignments` | unique `(interview, candidate)` |
| `interview_sessions` | unique `(interview, candidate)` and unique assignment; COMPLETED ⇔ `completed_at` and a reason are set; `expires_at > started_at`; `question_plan` (JSONB array); `follow_ups_used` |
| `interview_session_items` | unique `(session, sequence)` and `(session, question)`; partial unique index allowing one PRESENTED item per session; ANSWERED ⇔ an answer and `answered_at` are set; answer 1–10,000 characters; `answered_at ≥ presented_at` |

**Indexes, each for a real lookup:**
* interviews by status and author;
* questions by `(interview, position)`, used for selection and listing;
* assignments by candidate, for "My Interviews";
* sessions by candidate, and by `(interview, status)`, for admin progress;
* items by session and sequence (from the unique constraint);
* `audit_logs (interview_session_id, occurred_at)`.

**Changes to `audit_logs`** (additive): 14 `INTERVIEW_*` actions are added to the action CHECK, plus
nullable `interview_id` and `interview_session_id` columns with no foreign key, so records outlive what
they describe.

**RLS:** enabled with no policies on the five new tables, as in 0014. The owning API role is
unaffected; other roles, such as Supabase's Data API roles, are denied. Existing tables are unchanged.

**Downgrade** drops the new tables. To restore the narrower CHECK on the append-only `audit_logs`, it
deletes the interview audit rows, lifting the trigger only for that one statement.

## Audit trail

**Admin actions:** created, updated (field names), deleted, published, unpublished; question created,
updated or deleted; questions reordered; assigned, unassigned.

**Candidate actions:**
* session started;
* answer submitted (item id, question id, kind, sequence, **length only**);
* session completed (the reason; `ended_by: server_clock` for expiry).

**Never recorded:** answer or question text, tokens or credentials. The `assessx.interviews` logger
records action and ids only.

## Desktop

**Admin, "Interviews":**
* the list, and creating an interview;
* the editor:
  * configuration (read-only once published);
  * the publishing checklist;
  * questions with Move up / Move down, Add follow-up, Activate / Deactivate and Delete. Expected
    concepts and competency are labelled "for future evaluation (hidden from candidates)".
  * once published, candidate assignment with progress only (status, n of N answered, follow-ups).

**Candidate, "My Interviews":**
* the list;
* a details page with instructions and Start / Resume;
* a **full-screen runner**, outside the app shell:
  * "Question n of N", or "Follow-up to question n";
  * the server-anchored countdown (the exam's `ExamTimer`, reused);
  * the question, with its context;
  * a text answer and a character counter;
  * Submit answer, and End interview (with a confirmation).

**Answers aren't lost:**
* A draft is kept per question in this browser only (`localStorage`, failing safe).
* Nothing says "saved" until the server confirms.
* After a failure the typed text stays on screen with a message.
* A stale or late submission reloads the state and says why.

## Security assumptions and limitations

1. **The desktop app is untrusted.** The server decides the questions, their order, follow-ups, the
   time and completion. The app holds no secret. Question and answer text is rendered as plain text
   (React escaping, no HTML).
2. **Interviews are not proctored** (decision 8; PRD FR-022 is open). A candidate can paste from
   elsewhere. Proctoring an interview would be a deliberate, separate link.
3. **No rate limiting.** This applies to the whole backend; answers are capped at 10,000 characters.
   Phase 9 hardening.
4. **Single-tenant.** Any admin manages any interview, as with assessments.
5. **Unassigning a candidate deletes their session and answers** (cascade), as unassigning an
   assessment deletes the attempt; the audit trail remains. Whether this should be blocked once answers
   exist is open for 7C.
6. **Question time limits are advisory.**
7. **Text only.** Voice, video and the live WebRTC interview are later Phase 7 work, with no media
   stored now.
8. **No answer review screen.** Admins see progress only; answers are for 7C's report.

## Phase 7B integration boundary

7B adds an `AnswerEvaluationService` that reads a session item's answer, the question's
`expected_concepts`/`competency` and a rubric, and writes an evaluation **next to** the item. It never
changes the item. It replaces exactly one decision in `selection.next_question`: whether to ask the
follow-up, which is configured today and would become evaluation-driven, still bounded by the same
one-per-question constraint and budget.

None of these change:
* the plan;
* the clock;
* the locking;
* the candidate response shapes.

The audit trail already records which answer, which question and when; 7B adds which model and version
evaluated it.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_interview_selection.py` | 14 | eligibility (topic, type compatibility, difficulty ceiling, active, primary only); the plan is first-N in authored order and deterministic under shuffling; first question; follow-up only after its primary, within budget, never a follow-up's follow-up, inactive follow-ups skipped; completion; no repeats; refuses to advance past an unanswered question |
| `backend/tests/test_interview_config.py` | 26 | create, update and validation (13 invalid configurations, including mass-assigned `status`/`created_by_id`); approved topics; question validation; follow-up inheritance and the one-per-question limit; cross-interview question ids are 404; reorder; the publish gate, then locked; the budget issue; unpublish and delete rules; assignment rules; audit without text; candidate 403 and anonymous 401 on all 15 admin routes; malformed ids |
| `backend/tests/test_interview_sessions.py` | 29 | list and detail; start, then resume, then no restart; refresh never advances; full progression with a bounded follow-up; follow-ups off; answers stored as written and unscored; stale item, question id and replay all refused with nothing saved; 11 malformed or tampered bodies; maximum length; the deadline fixed from the duration and `>=` at the deadline; a late answer refused and the session ended *at its deadline*; reads apply the clock; client times ignored; ending early is idempotent; admin progress without answers, and an admin read never writes; audit sequence without text; expiry audited as `server_clock` |
| `backend/tests/test_interview_security.py` | 9 | candidate B can't read, answer or end A's session; cross-session item; another interview's question; unassigned, draft and unknown interviews are 404; roles on all candidate routes; evaluation metadata absent from every candidate response; injection-shaped text stored as data; errors have no stack traces or SQL; an interview creates no proctoring, attempt or review data |
| `backend/tests/test_interview_concurrency.py` | 2 | a real double submit (one saved, one 409, advanced once); real simultaneous starts (one session, one first question) |
| `backend/tests/test_migrations.py` (existing) | 3 | round trip plus model–migration agreement, including the new tables and the audit changes |
| `apps/desktop/src/features/interviews/__tests__/interviews.test.ts` | 5 | question ordering and pairing; list parsing; labels never judge the candidate; drafts persist and clear, and fail safe without storage |
| `apps/desktop/e2e/interview.spec.ts` | 2 | the admin configures, adds questions and a follow-up, publishes and assigns; the candidate takes the interview, gets the follow-up, refreshes mid-interview (same question, draft kept), completes; reopening shows it finished; the admin sees progress, not answers. A candidate can't reach configuration by screen or API; an admin can't use candidate routes. |
