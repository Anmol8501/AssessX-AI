# Phase 7B — AI Answer Evaluation & Adaptive Interview

**Status:** **Implemented (2026-10-01)** on top of Phase 7A
([`PHASE-7A-INTERVIEW-ENGINE.md`](PHASE-7A-INTERVIEW-ENGINE.md)). Part of the AI Interviews plan
([`PHASE-7-PLAN.md`](PHASE-7-PLAN.md)). The product owner calls it "Phase 7"; the roadmap numbers it
Phase 8. **7C (report and human review) is implemented** — [`PHASE-7C-INTERVIEW-REPORT.md`](PHASE-7C-INTERVIEW-REPORT.md).

> **AI evaluation is an assessment signal and does not make hiring decisions.** Nothing in 7B hires,
> rejects, ranks or selects a candidate, or ends an interview because of a score. Candidates never see a
> score. The AI's output never controls the interview: it is validated into plain values, and
> deterministic code decides what happens next.

## Architecture

```
POST answer ─► lock the session · save the answer · record a PENDING evaluation · commit
               └─► response: { processing: true }          (no evaluator configured → UNAVAILABLE, move on at once)
                         │  FastAPI background task, after the response — same process, no Celery/Redis/worker
                         ▼
EvaluationRunner: claim (lock the evaluation, take a lease, count the attempt; read the STORED answer)
                         ▼  no database connection held
AnswerEvaluationService: context → provider (timeout, bounded retries) → strict validation → normalized result
                         ▼
EvaluationRunner: lock the session → lock the evaluation → write once (COMPLETED / FAILED) → audit
                         ▼
AdaptivePolicy (deterministic code) → present the next question (follow-up / harder / easier) or complete
Candidate app: polls the state every 1.5 s ("Processing your answer…") until the next question appears.
```

| File | Responsibility |
|---|---|
| `services/interview/rubrics.py` | Versioned rubrics; the server's scoring policy |
| `services/interview/prompts.py` | The versioned prompt (`7b-prompt-v1`) and the strict output schema |
| `services/interview/llm.py` | `EvaluationProvider`: the Anthropic adapter (standard-library HTTP, explicit timeout) and the labelled stub. No new dependency. |
| `services/interview/evaluation.py` | Context, calls, validation, normalization (`EVALUATOR_VERSION = 7B-v1`) |
| `services/interview/adaptive.py` | The deterministic policy (`7B-v1`) |
| `services/interview/runner.py` | The background run: claim, evaluate, record |
| `services/interview/sessions.py` | Answer, state and `advance`, the single place an interview moves on |

## Rubrics and scoring

| Rubric | Used for | Dimensions (weight %) |
|---|---|---|
| `technical-v1` | TECHNICAL, CONCEPTUAL and SCENARIO questions | correctness 30 · conceptual understanding 25 · completeness 20 · reasoning 15 · technical accuracy 10 |
| `behavioral-v1` | BEHAVIORAL questions | relevance 20 · situation clarity 15 · actions 25 · reasoning 15 · outcome 15 · communication 10 (organisation and clarity; **not** fluency, accent or style) |

* **The model scores each dimension 0–10 as an integer.** The **server** computes the overall score:
  0–100 = Σ weight × score, rounded half up, once.
* **The model never chooses the final number.** The same dimension scores always give the same overall
  score.
* **Rubrics are code, not admin configuration.** Changing a weight means a new rubric version. Each
  evaluation keeps the rubric, evaluator and prompt versions and the model it was made with, and is never
  re-scored under a newer rubric.
* **`confidence`** (0–1) is the model's own signal. **It is not a probability that the evaluation is
  correct.** It is used only to *block* difficulty changes when it is low.

## Grounding and anti-hallucination

* **The evaluation context holds only** the interview type, the question (with its context, topic and
  difficulty), the question's expected concepts **numbered**, the competency (behavioral questions) and
  the rubric — plus **the stored answer**. It holds no candidate name, roll number, email or any other
  identity.
* **Concepts are referenced only by index** into the question's own list, so the model cannot invent a
  concept. The server maps the indexes back to the text.
* **Evidence quotes must occur in the answer.** Matching ignores case and whitespace. Quotes that don't
  match are dropped and flagged `UNVERIFIED_QUOTE_REMOVED`.
* **The prompt** says to judge conceptual correctness rather than keywords, and that valid alternative
  explanations count fully. It forbids invented facts, judgements of the person, hiring language,
  inferences about protected characteristics, and reasoning traces.
* **No reasoning trace is requested or stored.**

## Prompt-injection defence

* **Trusted and untrusted parts are kept apart:**
  * the system instructions are fixed;
  * the context is built from the server's own records;
  * the candidate's answer is sent inside a `<candidate_answer>` block, with any copy of that tag inside
    the answer neutralized so it can't close the block early.
* The instructions state that **nothing inside the answer is an instruction**.
* **Output comes only through one forced tool call** (`tool_choice`), whose input schema is the strict
  output shape. There is no free text to parse.
* **Even then, the output is untrusted:**
  * `extra="forbid"` and strict types;
  * no booleans as numbers, no NaN or infinity;
  * scores 0–10 over exactly the rubric's dimensions;
  * confidence 0–1;
  * at most 5 items per list, items ≤ 200 characters, feedback ≤ 600 characters;
  * concept indexes valid and disjoint;
  * control characters stripped.

  Anything else is `INVALID_OUTPUT`, which is recorded as FAILED, never stored as a result, and never
  retried.
* **A model reply that tries to set `status`, `verdict`, `overall_score` and the like is rejected;**
  tests prove it.
* **Consistency flags** for the reviewer: `HIGH_SCORE_WITH_MISSING_CONCEPTS`,
  `LOW_SCORE_WITHOUT_STATED_GAPS`, `HIGH_SCORE_WITH_INCORRECT_POINTS`, `LOW_CONFIDENCE`, `HIRING_LANGUAGE`.

## The adaptive policy (`adaptive.py`, `7B-v1`)

| After a primary answer… | Rule |
|---|---|
| **Follow-up** | Asked only if one is configured, follow-ups are enabled and the budget isn't spent; **and** the overall score is < 70 or an expected concept is missing. At most one per question, never a follow-up of a follow-up (database constraint). |
| **Difficulty** (adaptive interviews only) | ≥ 80 → one level harder; ≤ 40 → one level easier; otherwise unchanged. Never outside [`min_difficulty`, `difficulty`]. **No change when confidence < 0.5.** Follow-up answers never move the difficulty. |
| **Next question** | The first unasked eligible primary at the target difficulty, in authored order. If that level is exhausted, the nearest level within bounds, preferring the easier one. Never a repeat; always within the interview's topics; at most `question_count` primaries. |
| **No evaluation signal** | No evaluator configured, it failed, or it didn't arrive within `evaluation_wait_seconds` (25 s). **The 7A rule applies:** the configured follow-up while the budget lasts; difficulty unchanged. Recorded as `PLAN` (no evaluator) or `FALLBACK` (it failed or was late). |

Every question records how it was chosen: `selected_by` is PLAN, ADAPTIVE or FALLBACK. Every decision
made with an evaluator involved is audited as `INTERVIEW_ADAPTIVE_DECISION`, recording the signal, the
change, the reason and the policy version.

**Configuration** (new; admin-only; validated min ≤ starting ≤ maximum by both the service and a database
CHECK):
* `adaptive_difficulty` (default **off**);
* `min_difficulty`;
* `starting_difficulty`.

The existing `difficulty` is the maximum. With adaptive difficulty off, 7A behaviour is unchanged, and
existing interviews were back-filled that way.

## Lifecycle and failure handling

**Evaluation status:**
* `PENDING`: requested; a run may hold a lease.
* `COMPLETED`: validated and immutable.
* `FAILED`: carries a `failure_reason`: TIMEOUT, RATE_LIMITED, PROVIDER_ERROR, INVALID_OUTPUT or
  INPUT_TOO_LONG.
* `UNAVAILABLE`: NOT_CONFIGURED.

**A failure is never a score.** There's no "AI failed → 0".

**Retries:**
* *Within a run:* timeouts, 429s, 5xx and network errors are retried up to `LLM_MAX_RETRIES` (2) times,
  with 1 s and then 2 s backoff. Bad output and 4xx errors are not retried.
* *Across runs:* if a server restart or crash abandons a run, its lease expires. The next read of the
  session then schedules it again, at most **3 runs** per evaluation. After that it is FAILED (TIMEOUT).

**Waiting:**
* The interview clock **keeps running** during evaluation.
* After 25 s without a result, the next question appears by the fallback rule. The evaluation still
  finishes and is recorded, but never moves the interview a second time.

**Exactly once:**
* There is one evaluation row per (answer, evaluator version, rubric version).
* The runner skips a row that isn't PENDING or is leased, so two runs make **one** provider call.
* `advance` moves on only under the session lock while no question is presented, so the evaluator and
  the candidate's poll can't both present a question.
* All three are tested with real concurrent connections.

**Other cases:**
* An answer submitted before the deadline is still evaluated after the interview has timed out, but no new
  question is presented.
* Ending the interview early while an answer is processing works normally.

## Cost and abuse controls

* **There is no "evaluate" endpoint.** Evaluation starts only when an answer is submitted, so per session
  it is bounded by question count + follow-ups (≤ 60) × 3 runs × (1 + 2) calls.
* Answers are capped at 10,000 characters; anything empty or oversized never reaches the provider.
* Every call has a timeout (20 s), and output is capped at 1,024 tokens.
* There is still **no general rate limiting** (a backend-wide gap; Phase 9).

## API

* **Candidate:** no new routes. `POST …/answers` and `GET …/interview-sessions/{id}` now return
  `processing`. They **never** include a score, feedback, confidence, rubric or model. Any request body
  naming `score`, `overall_score`, `rubric_version`, `evaluator_version`, `model`, `confidence` or the
  like is rejected with 422.
* **Admin (read-only):** `GET /api/v1/interviews/{id}/assignments/{candidate_id}/evaluations` returns, for
  each item, the question, the stored answer, how it was chosen, and the evaluation:
  * status, scores, concepts, strengths, feedback, flags;
  * model and versions;
  * the label "an assessment signal… does not make hiring decisions".

  It never returns prompts or raw model output. 403 for candidates, 401 anonymous, 404 if not
  assigned / not started / wrong interview. It reads in two queries (items, evaluations), not one per
  answer.

## Configuration and secrets

| Setting | Notes |
|---|---|
| `LLM_PROVIDER` | `none` (default) / `anthropic` / `stub` |
| `LLM_API_KEY` | A `SecretStr`, masked in reprs and logs, sent only in the request header. **Never in the desktop app**, any Vite variable, any response, log or error (provider error bodies are not echoed; tests check). |
| `LLM_MODEL` | default `claude-haiku-4-5-20251001`, changeable without code |
| `LLM_TIMEOUT_SECONDS` | 20 |
| `LLM_MAX_RETRIES` | 2 |
| `EVALUATION_WAIT_SECONDS` | 25 |

Production **refuses to start** with `LLM_PROVIDER=stub`, or with `anthropic` and no key. See
[`DEPLOYMENT-RENDER.md`](DEPLOYMENT-RENDER.md).

**`stub`** is a deterministic **test double, not AI**:
* allowed only in development and test;
* labelled `stub` / `stub` on every evaluation;
* returns mid scores, or strong / weak / invalid output on `[[stub:strong|weak|invalid]]` markers, so
  automated tests can exercise the policy.

**Until a key is set, production records every answer as UNAVAILABLE, and interviews run exactly as in
7A.** An Anthropic key adds a **per-answer cost**.

## Database (migration `0016_phase_7b_answer_evaluation`)

**`interview_evaluations`**:
* links to the item (the answer), the session and the question (all CASCADE);
* status and failure reason;
* provenance: provider, model, evaluator / rubric / prompt versions;
* `dimension_scores` (JSONB), `overall_score` (0–100), `confidence` (0–1, 2 dp);
* present and missing concepts (as text), incorrect points, strengths, evidence quotes, feedback (≤ 600),
  flags;
* attempts (≤ 3), lease, latency, token counts, requested / completed times.

Constraints:
* unique (item, evaluator version, rubric version);
* COMPLETED ⇔ scored;
* FAILED/UNAVAILABLE ⇔ a reason;
* all ranges.

Indexed by item and by session. RLS is enabled with no policies, as in 0014/0015.

**Other changes:**
* `interviews`: `adaptive_difficulty`, `min_difficulty`, `starting_difficulty` (+ CHECK on the bounds);
* `interview_sessions`: `current_difficulty`, `difficulty_changes`;
* `interview_session_items`: `selected_by`;
* five new audit actions.

Existing rows are back-filled to 7A behaviour. Downgrade removes only what 0016 added.

## Audit and observability

**Audit actions:**
* `INTERVIEW_EVALUATION_REQUESTED`, `…_COMPLETED`, `…_FAILED`, `…_RETRIED`;
* `INTERVIEW_ADAPTIVE_DECISION`.

Their details are ids, statuses, scores, versions, provider calls, retry reasons, latency and flags —
**never the answer, the prompt or the feedback text**. Evaluator actions are attributed to the session's
candidate with `initiated_by: evaluator`.

The `assessx.interviews.*` loggers record ids, status and latency only.

## Separation from proctoring (Phase 6)

Interview evaluation writes no proctoring events, risk, evidence or reviews. A low score is not a
suspicion, and proctoring never changes a score; tests assert both. Any later link (for example, a 7C
report showing both side by side) must keep the two as separate dimensions.

## Desktop

* **Candidate:** after Submit, the answer is locked and a "Processing your answer…" screen shows, with the
  timer still running. It polls every 1.5 s until the next question arrives. Scores and feedback are never
  shown.
* **Admin:**
  * the configuration form gains "Adapt difficulty to the answers", with Minimum and Starting difficulty
    (`difficulty` relabelled as the maximum);
  * each started candidate had **View evaluations**, a read-only list (superseded in 7C by the session report — [`PHASE-7C-INTERVIEW-REPORT.md`](PHASE-7C-INTERVIEW-REPORT.md) — which shows the same evaluations):
    * question, answer, how each question was chosen;
    * status, score / 100, model confidence, warnings, dimension scores, feedback, covered and not-covered
      concepts, quotes;
    * provider/model and versions, under the note that it is an assessment signal, not a decision.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_interview_adaptive_policy.py` | 11 | weights sum to 100; rubric by question type; exact half-up scoring; follow-up rules; ±1 within bounds, adaptive-only, primary-only, confidence gate; no signal → 7A rule; next primary by target, nearest-easier fallback, no repeats, the count limit; prompt delimiting and tag neutralization; concepts by index; no identity; system-prompt rules |
| `backend/tests/test_interview_evaluation.py` | 49 | normalization; **26 malformed outputs rejected** (types, extras such as `score`/`status`, ranges, NaN/infinity, confidence 3.4, dimensions, indexes, sizes); quote verification; contradiction flags; control characters; timeout / 429 / 5xx retried and bounded; bad output and 4xx not retried; an oversized or empty answer never sent; a provider crash → failure; injection passed only as delimited content; the adapter's forced tool call, headers, parsing, status mapping and timeouts; the key never in errors, logs or reprs; settings from the server only; production refuses the stub and a keyless provider |
| `backend/tests/test_interview_adaptive_api.py` | 25 | processing, then the next question; the **stored** answer is what's evaluated; no scores to the candidate; strong ↑ / weak ↓ within bounds, recorded and audited; the evaluation decides the follow-up; failures (provider, rate limit, invalid output) are never a score, with the fallback asked and bounded calls; a late evaluation doesn't hold the candidate and is recorded later without a second advance; an abandoned run is rescheduled, and runs are bounded; a double run records once; the clock and completion are unaffected; ending early while processing; 9 forged fields rejected; the admin evaluations view and its access rules; adaptive configuration validation and the publish gate; no Phase 6 data and no answer text in the audit log; no evaluator → UNAVAILABLE with 7A behaviour; a lying provider can't set status or score |
| `backend/tests/test_interview_evaluation_concurrency.py` | 2 | real races: two runs → one provider call; an evaluation finishing during a fallback poll → moves on once |
| all Phase 7A suites | 83 | unchanged and passing (with no evaluator configured, 7A behaviour is preserved) |
| `apps/desktop/src/features/interviews/__tests__/interviews.test.ts` | 6 (+1) | adaptive defaults are consistent |
| `apps/desktop/e2e/interview-adaptive.spec.ts` | 2 | a strong answer → processing → a harder next question; no score shown to the candidate; the admin sees the evaluation (90/100, stub, versions, "not a decision"). A candidate can't read evaluations or send scores. |

## Known limitations

1. **Values are provisional.** The thresholds (70 / 80 / 40), confidence gate, rubric weights and wait
   are unvalidated choices, like Phase 6's risk weights. They need checking against real interviews, and
   changing them means new versions.
2. **The model can still be wrong or inconsistent.** Validation constrains its form, not its judgement.
   Flags help a reviewer, but every score needs human review (7C). Output isn't fully deterministic even
   at temperature 0; versions and timestamps are kept for auditing drift.
3. **English-centred.** Multilingual evaluation isn't designed or tested. Language fluency is excluded
   from scoring, but a model may still be affected by it.
4. **Evaluation time counts against the interview clock**, up to 25 s per answer at worst.
5. **No admin re-evaluation yet.** The schema supports versioned re-evaluation; the workflow is for 7C or
   later.
6. **No AI-generated questions.** Follow-ups and difficulty only choose from the administrator's bank.
7. **No general rate limiting** (backend-wide; Phase 9). Cost is bounded per session as described above.
8. **The background run lives in the API process.** A Render restart abandons in-flight runs; they are
   recovered on the next read, within the run limit.
9. **Text only.** Voice, video and the live WebRTC interview are later Phase 7 work.

## Phase 7C boundary

7C builds the report (per-question analysis, timeline, summaries), the human review of interview output
(reusing 6C's review and audit patterns where sensible), and any admin re-evaluation. It must keep the
rules above:
* AI output is a signal;
* the outcome is human-authored;
* there is no hire/reject automation;
* proctoring risk and interview performance are shown side by side, never merged.
