# Coding Assessments — plan and decisions

**Status:** Phase 0 (read-only audit) done 2026-10-02. The product owner approved the proposal and said
**"start implementing … use everything which is free forever and does not cost anything"**. Stages are
built one at a time; this file records the decisions and the order.

## Product rule

Three assessment types, chosen by the administrator and **enforced by the server**:

| Type | Allowed questions |
|---|---|
| `MCQ` (MCQ only) | the existing objective types: MCQ, multiple-select, true/false |
| `CODING` (coding only) | coding problems |
| `MIXED` | both, in the exact order the administrator sets |

Existing assessments become `MCQ` and behave exactly as before.

## Architecture (one assessment engine)

```
Assessment (assessment_type)
   └── questions  (existing table; authoritative position; marks per assessment)
         ├── MCQ / MULTIPLE_SELECT / TRUE_FALSE → question_options (unchanged)
         └── CODING → pins one immutable coding_problem_version
coding_problems (reusable library) ── coding_problem_versions (immutable once published)
                                         └── coding_test_cases (PUBLIC | HIDDEN)
```

* **Code never runs in FastAPI or on Render.** A separate *runner* pulls jobs from the API over HTTPS with
  its own token. It has no database credentials and no inbound ports. It runs each test in a fresh,
  network-less, read-only, resource-limited container as a non-root user, under gVisor where available.
* **The queue is PostgreSQL** (a jobs table claimed with `FOR UPDATE SKIP LOCKED`), the same pattern as
  the 7B evaluation runner. No Redis.
* **Hidden tests and reference solutions never leave the server.** The only route that returns them is
  the runner's claim route.

## Decisions (approved with "start implementing")

1. **Free forever only.**
   * Editor: CodeMirror 6 (MIT).
   * Sandbox: Docker plus gVisor (free, open source), using official language images (free).
   * Queue: PostgreSQL. No Redis, no paid judge APIs, no paid hosting.
   * The runner runs on a free host the operator chooses: an Oracle Cloud *Always Free* VM, or any
     Windows/Linux PC with Docker that is switched on during exams.
2. **Sandbox:** Docker hardening, plus gVisor (`runsc`) when the host supports it.
3. **Which submission counts:** the candidate's **best** submission.
4. **Partial scores:** whole marks, rounded down (never over-awarded).
5. **Submitting or timing out with a submission still running:** those jobs finish, then the result is
   produced; until then the candidate sees "Being evaluated".
6. **Library:** a reusable **coding-problem** library in v1. Existing MCQs stay per assessment.
7. **An assessment's questions are locked once any attempt exists.** This closes the old gap where a
   published exam's questions could still be edited.
8. **Default policies:**
   * paste **off**, custom input **off**, language switching **on**;
   * 20 submissions per problem;
   * 10 runs per minute;
   * 2 s and 256 MB per test, with more for Java.
9. **Languages:** Python 3.12, C (gcc, C17), C++ (g++, C++20), Java 21, from one server-side registry.

## Stages (each starts only when the product owner says so)

| Stage | Scope |
|---|---|
| **C1** | Assessment type and server rules; the question lock once attempts exist; the coding-problem library (versions, test cases, language registry); the admin problem builder and library picker. Publishing an assessment that contains coding questions is refused until C2 provides a runner. |
| **C2** | Runner service (Docker sandbox) and job queue; Run / Submit / Validate; rate limits; idempotency |
| **C3** | Candidate coding page (CodeMirror), drafts and autosave, submission history, navigation and statuses |
| **C4** | Scoring (best submission, partial), results and reports (MCQ / coding sections), proctoring events, analytics |
| **C5** | Security hardening; sandbox attack tests in all four languages; full MCQ / Coding / Mixed end-to-end tests; runner runbook |

## Corrections recorded during the audit

The desktop app's native keyboard hook **does** block Alt+Tab, the Windows key, Alt+F4 and Ctrl+Esc
during a proctored exam. `docs/EXAM-CONTROL.md` previously said they could not be blocked.

---

## Stage C1: implemented (2026-10-02)

**What it does**

* **Assessment type.** Admins choose MCQ only, Coding only or Mixed when creating an assessment, and can
  change it later under Basic information. The server enforces the type when:
  * a question is added — 422, with a plain message;
  * the type is changed — refused while existing questions don't fit;
  * the assessment is checked for readiness — the final gate.

  Existing assessments are MCQ only.
* **Question lock.** Once any attempt exists, adding, editing, deleting, duplicating or reordering
  questions, or changing the type, is refused with 409 `assessment_in_use`. Other settings, such as the
  description, can still change. One older test that deleted questions after an attempt now asserts the
  refusal.
* **Coding-problem library** (admin nav → **Coding Problems**).
  * **Versions:** a problem has versions. Drafts can be edited; a published version never changes, and
    "New version" copies the newest version, test cases included.
  * **What a version holds:**
    * title, difficulty, tags;
    * statement, input and output format, constraints;
    * examples;
    * languages and starter code;
    * time and memory limits;
    * suggested points, partial scoring;
    * an optional reference solution (admin only);
    * public and hidden test cases with weights.
  * **Publishing** is refused until the draft is complete: a statement, a language, a public and a
    hidden test, and a reference solution in an enabled language.
  * **The preview** uses the same function the candidate API will use, and that shape has no field for
    hidden tests or the reference solution.
  * **Deleting** is refused while an assessment uses the problem; disable it instead.
* **Coding questions.** `POST /assessments/{id}/coding-questions` pins a published version:
  * once per assessment;
  * marks default to the version's suggested points;
  * only the marks can be edited;
  * the question can move to another published version of the same problem before any attempt.

  The existing reorder endpoint gives mixed assessments one authoritative order.
* **Language registry.** `backend/app/services/coding/languages.py` covers Python 3.12, C (GCC 14,
  C17), C++ (GCC 14, C++20) and Java 21. For each it holds the free official image, the compile and run
  commands (plain arguments, never a shell), the time factor, extra memory, and the starter template.
* **Gate until C2.** `CODING_EXECUTION_ENABLED` (default off) keeps an assessment with coding questions
  from being marked Ready, so candidates never meet a question that can't run.

**APIs**

* `/api/v1/coding-problems` (admin only):
  * the list, with filters for search, difficulty, tag, language, published-only and enabled-only;
  * create, get, enable or disable, delete;
  * `/languages`;
  * `/{id}/versions`: new draft, get, patch, discard, `/publish`, `/preview`;
  * `/{id}/versions/{vid}/test-cases`: create, patch, delete.
* `/api/v1/assessments/{id}/coding-questions`, and `/questions/{qid}/coding-version`.

**Migration `0020_coding_problems`**

* `assessments.assessment_type`.
* `coding_problems`, `coding_problem_versions` (one draft per problem, with CHECKs on limits and status)
  and `coding_test_cases` (size and weight CHECKs). RLS is on for these new tables only.
* `questions.coding_problem_version_id` (RESTRICT), with a CHECK.
* Four audit actions: `CODING_PROBLEM_CREATED`, `CODING_PROBLEM_DELETED`, `CODING_VERSION_CREATED`,
  `CODING_VERSION_PUBLISHED`.

**Tests**

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_coding_problems.py` | 13 | create, strict input, registry validation, publish checklist, version immutability and copy, preview with no hidden data or reference, test-case bounds and order, filters, delete and discard, admin only, audit |
| `backend/tests/test_assessment_types.py` | 11 | type rule on every path, mixed order, coding pinning, version move, type change, runner gate, question lock, in-use delete, candidate refused |
| `apps/desktop/src/features/coding/__tests__/coding.test.ts` | 6 | — |
| `apps/desktop/e2e/coding-library.spec.ts` | 1 | the full admin flow |
| Existing builder, assessment, publishing and readiness end-to-end tests | — | still pass |

---

## Stage C2: implemented (2026-10-02)

**What it does**

* **The job queue is a table, `code_executions`.** It holds one row per Run, Submit or Validate.
  * Runners claim rows with `FOR UPDATE SKIP LOCKED` and a 180 s lease.
  * An expired lease is reclaimed; after 3 claims the job fails as a *system error*.
  * No Redis.
* **The runner** (`runner/`) is a separate program using only Python's standard library and the Docker
  CLI. It holds no database credentials and opens no inbound ports. Each test runs in its own fresh
  sandbox container. See `runner/README.md` for the restrictions, the threat model, free hosting and
  setup.
* **The server judges.**
  * Runner jobs carry test *inputs* only, never expected outputs.
  * The API compares outputs, ignoring trailing spaces and trailing blank lines.
  * It maps runner outcomes to verdicts: Accepted, Wrong answer, Compilation error, Runtime error, Time
    limit exceeded, Memory limit exceeded, Output limit exceeded, System error.
  * A missing result is never a pass.
* **Candidate API** — `/candidates/me/attempts/{attempt}/coding/{question}`:
  * the problem view (public data and policies);
  * `POST /runs` (sample tests, or the candidate's own input if the assessment allows it);
  * `POST /submissions` (every test);
  * `GET /executions/{id}`;
  * `GET /submissions` (own history).
* **Checks on every candidate request:**
  * the candidate's own open attempt, not on hold, with proctoring active when required;
  * a coding question of that assessment;
  * a language enabled on the problem;
  * custom input only when the assessment allows it;
  * one job in flight per question;
  * 10 runs and 3 submissions per minute per attempt;
  * the per-problem submission limit (default 20);
  * a global queue cap of 500;
  * an idempotency key, so a retry returns the original.

  Another candidate's attempt or execution returns 404.
* **What candidates see:** sample tests in full (input, expected output, their output and errors);
  hidden tests only as "passed X of Y", never their input, output or error text; never the reference
  solution.
* **Validate** (admin): runs the reference solution against every test. It marks the version validated
  only when everything passes and the version hasn't changed since. A version with a reference solution
  needs this before it can be published (once `CODING_EXECUTION_ENABLED` is on).
* **Runner routes** (`/api/v1/internal/runner/claim`, `/jobs/{id}/result`, `/jobs/{id}/fail`):
  * `X-Runner-Token` only, compared in constant time;
  * a user's session token is not accepted;
  * 404 when `RUNNER_TOKEN` is unset;
  * in production the token must be at least 32 characters.
* **Assessment settings → Coding:** "allow custom input" (default off) and "submissions per problem"
  (default 20).

**Migration `0021_code_executions`**

* The `code_executions` table: CHECKs on source and input size and on scope, a unique idempotency key per
  attempt, and RLS.
* `assessments.coding_allow_custom_input` and `coding_max_submissions`.

**Tests**

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_code_execution.py` | 15 | judging, round trip, hidden-data hiding, custom-input policy, request checks, cross-candidate access, in-flight rule, rate limits, submission limit, hold and ended, runner auth, leases, failures, validation, policies |
| `runner/tests/test_sandbox.py` (real Docker) | 16 | Python, C, C++ and Java: success, runtime error, compile error, time, memory and output limits, fork bomb, no network, read-only filesystem, no carry-over between tests, no environment leak, unprivileged user, no leftovers |
| `apps/desktop/e2e/coding-runner.spec.ts` (real runner, when `ASSESSX_RUNNER_E2E=1`) | 1 | validation fails on a wrong hidden test, passes after the fix, then publish |
| Live smoke test with the real runner | — | validate 4/4; Python and Java submissions accepted 4/4; C++ wrong answer 0/4; C compile error with the compiler's message; the rate limit refused a 4th submission within a minute; no token or hidden data in the logs |

**Bugs caught while building C2**

* **Sharing one container across a job's tests would have let a submission carry a hidden test's input
  into a sample test's visible output.** Fixed: a fresh container per test.
* **`timeout` reports a time-out as exit code 124**, so it's now recognised as a time-out.
* **The JVM printed a "Picked up JAVA_TOOL_OPTIONS" line on every Java run.** Removed.

---

## Stage C3: implemented (2026-10-02)

**What it does**

* **Coding workspace** (inside the existing exam screen; nothing about MCQ exams changes):
  * the problem on the left, the editor and console on the right, with a draggable divider (also
    adjustable with the arrow keys) and a "Wide editor" mode;
  * a toolbar with the language choice (only the problem's enabled languages), text size, light/dark
    theme, reset to starter code (confirmed) and the save status;
  * Run, and Submit (confirmed, showing the submissions left);
  * Ctrl+Enter runs, Ctrl+Shift+Enter submits.
* **Editor: CodeMirror 6** (MIT; `codemirror`, `@codemirror/lang-python`, `lang-cpp`, `lang-java`,
  `theme-one-dark`). It provides syntax highlighting, line numbers, bracket matching, auto-indent (Tab
  indents), search and replace, keyword completion, and undo history. No extra Tauri permissions, and
  the app's security policy is unchanged.
* **Console** with three tabs:
  * **Results:** queued, then running, then the verdict, tests passed, time and memory; the compiler
    output; sample tests with input, expected output, the candidate's output and errors; hidden tests
    only as "X of Y passed";
  * **Your input:** only when the assessment allows custom input;
  * **Submissions:** the candidate's own history.
* **Autosave:**
  * debounced (1.5 s after typing stops), never per keystroke;
  * every edit is also kept in local storage at once;
  * saves on blur, on hide and on leaving the question;
  * an offline save retries every 5 s and the status says so;
  * a newer local copy is restored on reopen.

  The server stores one draft per (attempt, question) with a revision. A stale save, for example from
  another window, gets 409 `draft_conflict`, and the screen offers "Load newest". Newer code is never
  overwritten.
* **Idempotent Run and Submit:** a retried request reuses its key, so a double click or a network retry
  never creates two jobs.
* **Navigation:**
  * MCQ-only exams are unchanged ("Question n of N");
  * coding-only exams show "Problem n";
  * mixed exams show "Question n" (by position) and "Coding n";
  * coding statuses are *not started*, *in progress*, *being checked*, *passed* and *not all tests
    passed*, each with its own colour and an accessible name;
  * a coding problem counts as answered for "Submit Exam" once it has a submission.
* **Lockdown:** inside the code editor, and only there, its find shortcuts (Ctrl+F, Ctrl+G,
  Ctrl+Shift+G) are allowed during a proctored exam. Copy, cut and paste stay restricted (the
  security-first default).

**API and migration**

* Migration `0022_coding_drafts`: the `coding_drafts` table, unique per (attempt, question), with a
  source size check, a revision number, and RLS.
* `PUT /candidates/me/attempts/{a}/coding/{q}/draft`, with the same checks as Run.
* The problem view now includes the draft.
* `GET /candidates/me/attempts/{a}/coding-progress`.
* The attempt view gains `assessment_type` and `coding` (progress per question).

**Tests**

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_coding_drafts.py` | 4 | revisions and stale saves, restore, checks, cross-candidate access, hold and end, the progress sequence, attempt view |
| `apps/desktop/src/features/coding/__tests__/candidate.test.ts` | 13 | labels per type, statuses, which code opens, local backup (and storage blocked), keys, answered rule, editor-only shortcuts |
| `apps/desktop/e2e/coding-candidate.spec.ts` (real runner, `ASSESSX_RUNNER_E2E=1`) | 2 | autosave and reload restore, Run, Submit with hidden tests as counts only, history, navigator statuses, wrong answer; a mixed exam's labels and order |
| Existing exam-control, environment, coding-library and interview end-to-end tests | 15 | all still pass |

**Not yet (C4):**
* coding scores in results;
* MCQ and coding sections in reports;
* coding proctoring events;
* analytics;
* the paste and copy policy toggles.

## Stage C4: implemented (2026-10-02)

**Scoring**

* A coding question scores from the candidate's **best judged submission**; ties go to the earliest.
* **Partial scoring** (the problem version's setting, on by default):
  `floor(marks × passed weight ÷ total weight)`. It always rounds down, so a candidate is never
  over-awarded. With partial scoring off, only an accepted submission scores.
* An accepted submission is full marks, whatever is submitted after it.
* No submission means *unanswered*. Some marks means the new outcome **PARTIAL** ("Partly correct").
* Pass or fail is still decided on raw marks against the passing marks.
* The client never sends a score. Judging and scoring are both server-side.

**Being evaluated**

* An exam can end while a submission is still queued or running. Its result then does not exist yet.
* The candidate's result says **"Your code is being evaluated"**, and the app asks again every 4 s.
* When the runner reports the last pending submission, the result is produced.
* If a submission is never judged, it is failed as a **system error** after 10 minutes
  (`EvaluationService.EVALUATION_WAIT`), and the result is produced without it. A system error is
  never the candidate's fault, and it never counts as a pass.

**Results and reports**

* Results carry **sections**: MCQ score and maximum, and coding score and maximum. A section is
  empty when the exam has no questions of that kind. They also carry `partial_count`.
* Each coding question's line shows:
  * its tests passed out of its total tests (never which tests);
  * the verdict;
  * the language.
* Results never include the code, the hidden inputs or outputs, or the reference solution.
* These show on the candidate's result screen, the candidate's results list, and the administrator's
  results table.

**Coding activity events** (on a proctored attempt's timeline)

* **Recorded by the server:**
  * `CODE_RUN_REQUESTED` (language, whether custom input was used);
  * `CODE_SUBMITTED` (language);
  * `CODE_LANGUAGE_CHANGED` (language and previous language).
* **Reported by the client:**
  * `CODING_QUESTION_OPENED`;
  * `CODE_PASTED` (the paste's length only, never its text).
* Every event carries the question number. They form a new `CODING` category.
* The client cannot report the server-recorded types (422).
* The risk engine **excludes** all five types. They are facts about solving a problem, never risk
  signals, and nothing classifies cheating.

**Paste policy**

* `assessments.coding_allow_paste`, off by default.
* An administrator sets it under Settings → Coding: "Allow copy and paste inside the code editor".
* When it is on, copy, cut and paste work inside the code editor only. They stay blocked everywhere
  else in the exam, and each paste is reported as `CODE_PASTED`.
* When it is off, nothing changes from C3.

**Analytics**

* `GET /assessments/{id}/coding-analytics`, administrators only. It is shown under the results table
  as "Coding analytics".
* **Per problem:**
  * candidates who submitted, and the number of submissions;
  * acceptance rate and solved rate;
  * average marks and the average runtime of accepted submissions;
  * languages used;
  * the most common failing verdict.
* **Per candidate:** listed by name, never ranked or sorted by score.
  * problems tried, submissions, accepted rate and languages;
  * coding marks;
  * the best verdict per problem.
* **Summary:** average MCQ, coding and total marks.
* All of it is computed from stored rows. None of it is a judgement about anyone.

**API and migration**

* Migration `0023_coding_results_and_events`:
  * `attempt_results` gains `partial_count` (non-negative), `mcq_score`, `mcq_maximum`,
    `coding_score` and `coding_maximum`. They are nullable, so older results keep them empty.
  * the five event types and the `CODING` category are added. The downgrade deletes those rows first.
  * `assessments.coding_allow_paste` is added.
* `GET /candidates/me/attempts/{a}/result` returns `evaluating: true` (and no numbers) while a
  submission is pending.
* `QuestionResult` gains `kind`, `tests_passed`, `tests_total`, `verdict` and `language`.
* The attempt view gains `coding_allow_paste`.

**Tests**

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_coding_results.py` | 14 | partial and all-or-nothing arithmetic, rounding down, best submission and ties; partial result end to end; mixed sections in the candidate, list and admin views; unanswered coding; being evaluated, then produced on completion; the 10-minute system-error fallback; server-recorded events with their fields; client-reportable versus server-only types; no events when unproctored; analytics (admin-only, figures, no code or hidden data); the paste setting |
| `backend/tests/test_evaluation.py`, `test_builder.py`, risk-engine policy test | updated | the new result fields, the new setting default, an explicit risk decision for each coding event |
| `apps/desktop/src/features/coding/__tests__/results.test.ts` | 5 | coding result line, "Partly correct" label and colour, sections, language names |
| `apps/desktop/e2e/coding-results.spec.ts` (real runner, `ASSESSX_RUNNER_E2E=1`) | 1 | 2 of 3 tests is 6 / 10; the candidate's sections and coding line with no hidden data; the admin's section totals and coding analytics |
| `apps/desktop/e2e/coding-library.spec.ts` | updated | the paste toggle is off by default, saves, and survives a reload |

**Not yet (C5):**
* sandbox attack tests in all four languages;
* full MCQ / Coding / Mixed end-to-end tests;
* the runner runbook;
* final hardening.

## Stage C5: implemented (2026-10-02) — coding assessments complete

**Audit findings and fixes**

* **The runner trusted each job's image, file name and commands.** Now `runner/assessx_runner/policy.py`
  checks every job before Docker is touched. A job must match one of the runner's own language
  profiles exactly, and its limits, sizes and ids must be in bounds. Otherwise it is refused and
  reported as a runner failure (a system error, never the candidate's fault). A backend test keeps the
  profiles identical to the API's registry.
* **The runner would send its token over plain HTTP** if it was configured that way. Now
  `RUNNER_API_URL` must be `https://`, except to localhost.
* **Image tags can change upstream.** Optional `RUNNER_IMAGE_PINS` runs exact `repo@sha256:` digests
  instead of the tags.
* **Production configuration.** The API refuses to start with `CODING_EXECUTION_ENABLED=true` but no
  `RUNNER_TOKEN`, since submissions would never be judged. It also refuses a `RUNNER_TOKEN` equal to
  `SECRET_KEY`.
* **Confirmed sound, unchanged:**
  * the sandbox flags and one container per test;
  * no expected outputs on the runner;
  * server-side judging;
  * bounded runner reports;
  * the constant-time token check;
  * rate limits and the queue cap.

**Tests**

| Suite | Count | Covers |
|---|---|---|
| `runner/tests/test_attacks.py` (real Docker) | 22 | In Python, C, C++ and Java each:<br>• a probe for network, writes to the code folder and system, the Docker socket, the token in any process's environment, the user, capabilities, and files carried between tests<br>• infinite loop, memory bomb, endless output, fork or thread bomb (and the runner survives)<br>• for C and C++, a compile-time bomb |
| `runner/tests/test_policy.py` | 42 | Accepted profiles. Refused: other images or commands, path-like file names, oversized source or input, out-of-range limits, odd tests, unsafe ids. A refused job never reaches Docker. Also digest pins (and that the pinned image is what runs), https only, and the worker reporting refusals. |
| `backend/tests/test_coding_hardening.py` | 9 | Production configuration checks; the runner profiles match the registry; forged runner reports (unknown tests, a missing test, OK with wrong output, a verdict or oversized output) never pass; a sweep of every candidate coding endpoint for hidden inputs and outputs and the reference; oversized source and input refused before queueing |
| `apps/desktop/e2e/coding-full-flow.spec.ts` (real runner) | 1 | A whole mixed exam: True/False right and wrong; C++ accepted; Java partly right (int overflow, 2 of 3, 6 marks); 21 / 30 with sections 5 / 10 and 16 / 20; per-language lines; admin sections and analytics; no hidden data |

**Operations:** [`docs/RUNNER-RUNBOOK.md`](RUNNER-RUNBOOK.md) covers:
* before-exam checks;
* monitoring with a read-only queue query;
* incidents and their effect on candidates;
* the stop switch;
* changing the token by hand;
* updating and pinning images;
* capacity;
* the security model.

### Change after C5: each hidden test's verdict (2026-10-02)

At the product owner's request, a submission now shows each hidden test's own verdict, not just the
count:

```
Hidden tests: 1 of 2 passed. Their inputs and outputs are not shown.
Hidden test 1   Wrong answer
Hidden test 2   Passed
```

* **Sample tests are unchanged:** the input, the expected output, the candidate's output and errors
  are all shown.
* **Each hidden test shows only** its number among the hidden tests and its verdict: passed, wrong
  answer, time limit exceeded, memory limit exceeded, runtime error, and so on.
* **Never shown for a hidden test:**
  * its input;
  * its expected output;
  * the program's output or errors;
  * its runtime.
* **The API** sends this as `ExecutionOut.hidden_results` (`number`, `verdict`), on judged
  submissions only. Runs check the sample tests only, so they have no hidden results.
* **Tests:**
  * `test_code_execution.py` (`test_each_hidden_test_shows_only_its_verdict`, plus the existing
    round-trip and hidden-failure tests) checks that a hidden test's output is never shown, even when
    the program prints its input;
  * a unit test covers the labels;
  * the `coding-candidate` and `coding-full-flow` end-to-end tests check the list on screen.
