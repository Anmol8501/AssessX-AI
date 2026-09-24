# Phase 3 — Exam Attempt (complete)

**Status:** **3A, 3B and 3C are implemented** (2026-09-23). Phase 3 is complete: a candidate can
open an assigned exam, answer it under a server-authoritative countdown, finish by submitting or by
running out of time, and see how it was marked; an administrator can see every candidate's score
for an assessment. **Phase 4 (Basic Proctoring) has not been started** and must not be until the
product owner asks for it.

This is the product owner's plan, recorded as given. It sits alongside `DEVELOPMENT-ROADMAP.md` (the
agreed phase order) and `PHASE-2-PLAN.md`, and does not replace the PRD/TRD/Knowledge Base, which
remain the source of truth for *what* is built and *how*.

## Goal

Turn the assigned assessment into a real candidate exam experience.

```
Candidate → My Exams → Exam Details → Instructions → Start Exam → Timer → Questions → Answers → Submit → Results
```

**Phase 3 contains no AI proctoring.** Proctoring begins in Phase 4.

---

## 3A — Candidate Exam Experience ✅ implemented

**Goal:** build the complete candidate-facing exam interface.

### Includes

- Candidate sees assigned exams
- Exam details page
- Exam instructions
- Pre-exam confirmation
- Start Exam flow
- Exam attempt creation
- Exam session initialization
- Question display
- MCQ answering
- Multiple-select answering
- True/False answering
- Next/Previous navigation
- Question navigation panel
- Answered/unanswered indicators
- Question counter
- Exam progress
- Auto-save answers
- Candidate can resume an active attempt if appropriate

### Database / foundation

- Exam Attempt
- Attempt status
- Candidate ↔ Assessment ↔ Attempt relationship
- Attempt start time
- Attempt timestamps
- Attempt/question answer storage

### Does NOT include

❌ Camera · ❌ Microphone · ❌ Fullscreen enforcement · ❌ Proctoring · ❌ AI detection ·
❌ Risk scoring

---

## 3B — Exam Session, Timer & Submission ✅ implemented

**Goal:** make the exam attempt a reliable, controlled session.

### Includes

- Countdown timer
- Server-authoritative timing
- Start/end timestamps
- Remaining-time calculation
- Auto-save
- Session recovery
- Browser/app refresh recovery
- Reconnect handling
- Attempt state management

### Attempt lifecycle

```
ASSIGNED
    ↓
STARTED
    ↓
IN_PROGRESS
    ↓
SUBMITTED
```

Also handle:

```
IN_PROGRESS
    ↓
TIME_EXPIRED
```

### Submission

- Manual submission
- Submit confirmation
- Automatic submission when time expires
- Prevent submission duplication
- Lock submitted attempts
- Prevent modification after submission
- Validate final answers
- Record submission timestamp

### Security

- Candidate can only access their own attempt
- Candidate cannot modify another candidate's attempt
- Candidate cannot manipulate server-side timing
- Candidate cannot submit someone else's attempt
- Backend remains authoritative

### Does NOT include

❌ AI proctoring · ❌ Camera/mic monitoring · ❌ Suspicious-event detection · ❌ Risk scoring

---

## 3C — Evaluation & Candidate Results ✅ implemented

**Goal:** complete the exam lifecycle after submission.

### Includes

- Automatic evaluation
- MCQ evaluation
- Multiple-select evaluation
- True/False evaluation
- Marks calculation
- Total score
- Maximum marks
- Percentage
- Pass/fail calculation based on assessment passing marks
- Result persistence

### Candidate results

The candidate can see:

- Assessment name
- Attempt number
- Submission date/time
- Score
- Total marks
- Percentage
- Pass/fail status
- Basic result summary

**Respect the assessment's Show Results configuration.** If results are configured not to be shown
immediately, the candidate must not receive the score prematurely.

### Admin side

The admin can view:

- Candidate attempts
- Submission status
- Score
- Percentage
- Pass/fail
- Attempt number

Advanced analytics and proctoring evidence are **not** included yet.

---

## Phase 3 complete flow

```
                 PHASE 3
                    │
        ┌───────────┴───────────┐
        │                       │
      3A                      3B
 Exam Experience        Session & Submission
        │                       │
        └───────────┬───────────┘
                    │
                   3C
             Evaluation
              & Results
```

| Stage | Purpose |
|-------|---------|
| 3A — Take the Exam | Candidate can actually open and answer the assigned assessment |
| 3B — Control the Attempt | Timer, autosave, recovery, submission and attempt security |
| 3C — Evaluate the Exam | Evaluate answers, calculate marks and display/store results |

## Definition of Done

At the end of Phase 3:

**Admin**

```
Create → Configure → Ready → Publish → Assign
```

**Candidate**

```
My Exams
   ↓
Instructions
   ↓
Start
   ↓
Answer Questions
   ↓
Timer
   ↓
Submit
```

**System**

```
Attempt
   ↓
Evaluate
   ↓
Score
   ↓
Result
```

The project's standing Definition of Done (TRD §59, repeated in `CLAUDE.md`) also applies: tests
exist and pass, error handling exists, security considerations are addressed, documentation is
updated, and existing functionality still works.

Only then may **Phase 4 — Basic Proctoring** begin (camera + microphone + fullscreen + session
monitoring + basic proctoring events).

---

## What Phase 3 builds on

Phase 2 deliberately left hooks for this stage; they are not yet used by anything.

| Already in place | Where | Phase 3 use |
|---|---|---|
| `assessment_assignments` with unique `(assessment_id, candidate_id)` | `app/models/assignment.py` | Attempts hang off the assignment row |
| `AssignmentStatus` with only `ASSIGNED` | same | Extending it is an enum value + constraint migration, no table rewrite |
| `max_attempts`, `randomize_questions`, `randomize_options`, `show_results`, `question_navigation`, `availability_start/end` | `assessments` columns (Phase 2B) | Stored and validated only — **nothing honours them yet**; Phase 3 is where the runtime must |
| `question_options.is_correct` as the answer key | `app/models/question.py` | Server-side evaluation reads it; the candidate shape must keep omitting it (OQ-17) |
| `GET /api/v1/candidates/me/assessments`, scoped to the session user, carrying no questions or answer keys | `app/api/v1/candidates.py` | The "My Exams" entry point the flow starts from |
| Readiness check requiring question marks to sum to `total_marks` | `app/services/readiness.py` | Makes `total_marks` a safe denominator for scoring |

---

## Open items

Recorded so they are decided deliberately rather than during implementation, per the project rule
that conflicts with the PRD/TRD are surfaced, not silently resolved. **None of them change the plan
above.** Several must be settled before the stage they belong to is written.

> **Decisions taken during 3A:** the entities are `AssessmentAttempt` (`assessment_attempts`),
> `AttemptAnswer` (`attempt_answers`) and `AttemptAnswerOption` (`attempt_answer_options`), matching
> the `Assessment`/`AssessmentAssignment` naming Phase 2 chose over the TRD's `Exam`; routes live
> under `/api/v1/candidates/me`, beside the existing `me/assessments`; `AttemptStatus` has only
> `IN_PROGRESS`, and `ACTIVE_ATTEMPT_STATUSES` is the single place that defines "still open";
> starting is idempotent and returns 200 whether it created or resumed; a partial unique index
> (`uq_attempt_one_active_per_candidate`) makes a second open attempt impossible at the database
> level; selections are relational rows rather than JSON, so an option belonging to another question
> cannot be stored; an answer row survives clearing, so "answered then cleared" stays distinct from
> "never opened"; the availability window is enforced when starting only; and `randomize_questions`
> / `randomize_options` are still **not** applied (item 6 below remains open).
>
> **Still true after 3A:** no timer, no deadline, no submission, no scoring, no results, and no
> admin attempt view.

### Must be decided before 3A (settled — see the note above)

1. **Entity naming.** This plan says "Exam Attempt". TRD §5 / KB §38 name the entities `ExamAttempt`,
   `Answer` and `Submission` (and `CandidateExam`, which Phase 2 implemented as
   `assessment_assignments`). Phase 2 already diverged once by naming the root entity `Assessment`
   instead of `Exam`. Decide the table and route names (`/api/v1/attempts` vs `/api/v1/sessions` —
   TRD §26 lists `/api/v1/sessions`) before the first migration.
2. **Whether `Submission` is its own entity.** TRD §5 lists `Answer` *and* `Submission` separately.
   The plan describes submission as an event on the attempt (status + timestamp). Decide whether
   submission is a row or a state transition; it changes the schema.
3. **One lifecycle enum or two.** The plan's lifecycle begins at `ASSIGNED`, which is today a value of
   `AssignmentStatus` on `assessment_assignments`, while `STARTED` / `IN_PROGRESS` / `SUBMITTED` /
   `TIME_EXPIRED` describe an attempt. Decide whether one enum spans both tables, or the assignment
   keeps a coarse status and the attempt carries its own — and, if two, what keeps them consistent.
4. **`STARTED` vs `IN_PROGRESS`.** No source document defines either. Decide what observable event
   moves an attempt between them, or collapse them into one state; two states that nothing
   distinguishes will be a source of bugs.
5. **`question_navigation` vs the navigation panel.** 3A lists Next/Previous *and* a question
   navigation panel with answered/unanswered indicators and mark-for-review. `SEQUENTIAL` must
   disable free jumping. Decide what the panel shows under `SEQUENTIAL` (hidden, or visible but
   non-clickable) and whether mark-for-review survives at all in that mode.
6. **OQ-19 — randomization semantics.** `randomize_questions` and `randomize_options` are already
   stored but no document says whether the seed is per-candidate, whether it is reproducible, or how
   the randomized order is persisted so a later review shows the candidate what they actually saw.
   The order must be fixed at attempt creation and stored, or resuming an attempt reshuffles it.
7. **Resume rules.** "Resume an active attempt if appropriate" is undefined. Decide what makes an
   attempt resumable, what happens to an attempt abandoned past its duration, and whether resuming is
   automatic on opening the exam or an explicit action.
8. **Attempt numbering against `max_attempts`.** Decide when an attempt consumes one of the allowed
   attempts (at creation or at submission), and whether a `TIME_EXPIRED` or abandoned attempt
   consumes one.
9. **Availability window enforcement.** `availability_start` / `availability_end` are stored but
   Phase 2 explicitly does not open or close anything automatically. Decide whether Start Exam is
   blocked outside the window, and what happens to an in-progress attempt when `availability_end`
   passes mid-exam.

> **Decisions taken during 3B:** `expires_at` is a stored column written once at attempt
> creation from `started_at + duration_minutes`, never recomputed and never accepted from a
> request; `AttemptStatus` gains `SUBMITTED` and `TIME_EXPIRED`, both terminal, with
> `TERMINAL_ATTEMPT_STATUSES` as the single definition of "finished"; `finalized_at` records when
> an attempt became immutable and is set to `expires_at` for an expiry (the moment the exam
> actually ended, not when the server noticed); `submitted_at` is set only for a manual
> submission; expiry is applied by `AttemptService.settle()` on **every** candidate interaction,
> so no background worker is needed for correctness; submission takes the attempt row
> `FOR UPDATE` (with `of=`, because the model's eager loads are outer joins PostgreSQL will not
> lock), which is what makes submit-versus-expiry deterministic; submitting twice returns the same
> attempt rather than failing; a write to a finished attempt is refused with a dedicated
> `attempt_locked` error code so the client can show the finished state rather than a save
> failure; and the countdown is anchored to `server_time` returned alongside `expires_at`, making
> the local clock irrelevant.
>
> **Still true after 3B:** no score, percentage, pass/fail, result record or admin results view.

### Must be decided before 3B (settled — see the note above)

10. **OQ-07 — offline grace window.** TRD §47 allows short interruptions with local state and
    resync; FR-006 makes the server authoritative for duration. Undefined and required by "reconnect
    handling" and "session recovery": the maximum offline grace window, whether elapsed time keeps
    running while disconnected, how buffered auto-saves are ordered and trusted on resync, conflict
    resolution, and whether an exam auto-terminates past a threshold.
11. **Auto-save semantics.** Decide the cadence (interval vs on-change vs both), whether a save is
    per-answer or per-attempt, what the client does when a save fails, and whether an unsaved answer
    can be lost without the candidate being told. The candidate must receive clear status on failure
    (TRD §46).
12. **Time source and clock skew.** The countdown must be derived from server time (FR-006). Decide
    how remaining time is delivered (absolute server deadline vs remaining seconds), and confirm the
    client clock is never trusted for expiry.
13. **Who enforces expiry.** Decide whether `TIME_EXPIRED` is produced by the server rejecting a late
    write, by a scheduled sweep, or both. A client that never calls back must still end up expired —
    which is the first thing in this project that may want a worker.

> **Decisions taken during 3C:** scoring is exact-set matching for all three objective types —
> the selected options must equal the correct options, with no partial credit and no negative
> marking; an empty selection is *unanswered* rather than wrong, and that check runs first so a
> malformed question with no correct option cannot award marks for answering nothing; pass/fail is
> decided on raw marks against `assessments.passing_marks`, never on the rounded percentage; the
> percentage is an exact `Numeric(5,2)` computed once, and a zero-mark paper scores 0% rather than
> dividing by zero; `attempt_results` holds one row per attempt (`uq_attempt_result_attempt`), is
> written inside the same transaction that finalizes the attempt, and is **never recomputed**;
> `passing_marks` is snapshotted onto the result; candidate visibility honours the assessment's
> `show_results` setting, with every number `null` rather than zero when withheld; the candidate's
> breakdown reports per-question outcome and marks but never which option was correct.
>
> **Changed after 3C, on the product owner's instruction (2026-09-24):** mark-for-review was
> removed entirely — button, setting, API route and the `marked_for_review` column (migration
> 0009); the Leave-exam button was removed, so a started exam runs to submission or to the
> deadline; and `question_navigation` = `SEQUENTIAL` is the "cannot return to a previous
> question" setting, relabelled in the builder to say so plainly.
>
> **Still true after 3C:** no proctoring, camera, microphone, risk scoring, evidence or interviews.

### Must be decided before 3C (settled — see the note above)

14. **Multiple-select scoring.** Not specified anywhere. Decide all-or-nothing vs partial credit, and
    if partial, the exact formula and whether wrong selections subtract. This changes stored results,
    so it cannot be revisited casually afterwards.
15. **Negative marking.** Not mentioned in the plan or any source document. Confirm there is none,
    rather than leaving it ambiguous.
16. **Unanswered questions.** Confirm they score zero and are distinguishable in storage from an
    answer that scored zero.
17. **`show_results` release mechanism.** It is currently a boolean. "Not shown immediately" implies
    something later releases them. Decide who releases results and when (admin action, availability
    end, a per-assessment release timestamp) — otherwise results configured as hidden stay hidden
    forever.
18. **Result immutability and recomputation.** Decide whether the score is computed once and stored
    or recomputed on read. TRD §30 audits "result modification", which implies stored results that
    can change; if an admin edits an answer key after submissions exist, decide what happens.
19. **Pass/fail rounding.** `passing_marks` is an integer and percentage is derived. Confirm pass is
    `score >= passing_marks` on raw marks, not on a rounded percentage.

### Carried forward, not new to Phase 3

20. **Organization / tenant association.** Phase 3 adds more tenant-sensitive tables (attempts,
    answers, results) with still no `Organization` entity. `CLAUDE.md` and TRD §6 require tenant
    association from day one; it has been deferred by explicit decision through Phases 1B, 1C and 2.
    Either add it here or record the deferral again.
21. **Audit logging (TRD §30).** Exam start, exam submission and result modification are named as
    audited actions. No audit log exists yet — it is a tracked known limitation in
    `backend/README.md`. Decide whether Phase 3 introduces it or Phase 9 does.
22. **OQ-17 — answer-key exposure.** Already respected by `GET /api/v1/candidates/me/assessments`.
    The question-delivery endpoint in 3A is the highest-risk place in the project for leaking
    `is_correct`; it must omit answer keys and explanations at the query level, and a test must
    assert it.
23. **OQ-18 — subjective grading.** Not yet applicable: only MCQ, multiple-select and true/false
    exist, so all Phase 3 evaluation is objective. It becomes blocking when short/long answer
    questions (PRD FR-003) are added.
24. **Redis.** Not required by anything in this plan — PostgreSQL can hold authoritative attempt
    state and deadlines. Introduce it only if a concrete Phase 3 requirement justifies it
    (TRD §36, §49).
