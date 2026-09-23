# Phase 2 — Assessment Creation (2A, 2B and 2C implemented)

**Status:** **2A, 2B and 2C are implemented** (2026-09-22). Phase 2 is complete; Phase 3 (taking an
exam) has not been started and must not be until explicitly requested.

This is the product owner's plan, recorded as given. It sits alongside `DEVELOPMENT-ROADMAP.md`
(the agreed phase order) and does not replace the PRD/TRD/Knowledge Base, which remain the source
of truth for *what* is built and *how*.

## Goal

At the end of Phase 2, an **Admin** should be able to:

> Create an exam → add questions → configure it → publish/assign it

and the **Candidate** should be able to see that an exam has been assigned to them. Actually taking
the exam belongs to Phase 3.

---

## 2A — Assessment & Question Foundation ✅ implemented

**Goal:** build the database models and Admin UI needed to create an assessment and manage its questions.

### Assessment

Admin can create an assessment with:

- Exam title
- Description
- Instructions
- Duration
- Total marks
- Passing marks
- Number of attempts
- Status
- Created / updated timestamps

Example:

```
Data Structures Mid-Term

Duration: 60 minutes
Total Marks: 50
Passing Marks: 20
Attempts: 1
Status: Draft
```

### Question system

Initial question types:

**MCQ**

```
What is the time complexity of binary search?

○ O(n)
○ O(log n)
○ O(n²)
○ O(1)
```

**Multiple Select**

```
Which are sorting algorithms?

☐ Merge Sort
☐ Binary Search
☐ Quick Sort
☐ BFS
```

**True / False**

```
A stack follows LIFO.

○ True
○ False
```

Each question should support:

- Question text
- Question type
- Marks
- Options
- Correct answer(s)
- Explanation / solution if desired
- Question order

### Admin UI

```
Admin
 │
 └── Assessments
       │
       ├── All Assessments
       │
       └── Create Assessment
                │
                ├── Details
                └── Questions
```

### Not in 2A

❌ No candidate attempt · ❌ No timer · ❌ No exam submission · ❌ No camera · ❌ No proctoring.
This stage builds the assessment **authoring** system only.

**Done when:** Admin can create an assessment and save questions to the database.

---

## 2B — Assessment Builder & Configuration ✅ implemented

**Goal:** turn the basic CRUD system into a proper exam builder — an Admin constructs an entire exam
in one coherent workflow.

```
Create Assessment

① Basic Information
        ↓
② Questions
        ↓
③ Settings
        ↓
④ Review
```

### 1. Basic Information

Title · Description · Instructions · Duration · Total marks · Passing marks

### 2. Question Builder

Admin can: add question · edit question · delete question · duplicate question · change question
order · change marks · preview question · select correct answers.

```
Question 1                     2 marks
──────────────────────────────────────
What does FIFO stand for?

○ First In First Out       ✓
○ First In Final Out
○ Fast In Fast Out
○ None

             Edit   Duplicate   Delete
```

### 3. Exam Settings

Foundation for future exam behaviour:

- Duration
- Maximum attempts
- Randomize questions
- Randomize options
- Show results after submission
- Allow navigation between questions
- Exam availability window

Advanced settings that depend on Phase 3 may remain disabled/placeholder.

### 4. Review

```
Assessment Review

Title: Data Structures Mid-Term
Questions: 25
Total Marks: 50
Duration: 60 min

[ Edit ]       [ Save Draft ]
```

### Assessment states

```
DRAFT
  ↓
READY
  ↓
PUBLISHED
  ↓
ARCHIVED
```

This lifecycle becomes important later.

**Done when:** an Admin can build a complete exam without jumping between disconnected screens, and
save it as a Draft/Ready assessment.

---

## 2C — Publishing & Candidate Assignment ✅ implemented

**Goal:** an Admin can take a completed assessment and assign it to candidates.

Because the college's real student database is not available, Phase 2 uses a small **local/demo**
candidate management system.

```
Candidates

┌─────────────────────────────────────────┐
│ Search candidates...                    │
├───────────┬──────────────┬──────────────┤
│ Name      │ Email        │ Status       │
├───────────┼──────────────┼──────────────┤
│ Rahul     │ rahul@demo   │ Active       │
│ Anmol     │ anmol@demo   │ Active       │
│ Chinmay   │ chinmay@demo │ Active       │
└───────────┴──────────────┴──────────────┘
```

These are **demo candidates, not real institutional data.** If the college adopts AssessX, that data
is imported later rather than building a full institutional-management system before deployment.

### Assignment workflow

```
Assessment
     ↓
Publish
     ↓
Assign Candidates
     ↓
Select candidates
     ↓
Confirm
```

```
Data Structures Mid-Term

Assigned Candidates

☑ Rahul
☑ Anmol
☑ Chinmay
☐ Prakhar
☐ Aman

             [Assign]
```

### Candidate side

The candidate dashboard can now show:

```
My Exams

┌─────────────────────────────────┐
│ Data Structures Mid-Term        │
│                                 │
│ Duration: 60 minutes            │
│ Questions: 25                   │
│ Marks: 50                       │
│                                 │
│ Status: Upcoming                │
│                                 │
│          View Details           │
└─────────────────────────────────┘
```

They **cannot start the exam** — that is Phase 3.

### Publishing rules

Validate before allowing publication:

- Assessment has a title
- Assessment has questions
- Every question is valid
- Correct answers exist
- Marks are valid
- Duration is valid
- At least one candidate is assigned if required

**Done when** this can be demonstrated:

```
ADMIN
Create Exam → Add Questions → Configure → Review → Publish → Assign Demo Candidates
        ↓
CANDIDATE
"My Exams" → See assigned exam
```

---

## Summary

| Phase | Main purpose | Result |
|-------|--------------|--------|
| 2A | Assessment + Question Foundation | Admin can create exams/questions |
| 2B | Assessment Builder + Configuration | Admin can build and review complete exams |
| 2C | Publishing + Candidate Assignment | Candidate can see assigned exams |

## What Phase 2 will NOT contain

❌ Actually starting an exam · ❌ Exam timer · ❌ Answer submission · ❌ Automatic evaluation ·
❌ Exam result generation · ❌ Camera · ❌ Microphone · ❌ Screen monitoring · ❌ Fullscreen
enforcement · ❌ WebRTC · ❌ Live monitoring · ❌ AI proctoring.

Those start becoming relevant in Phase 3.

---

## Open items

Recorded so they are decided deliberately, not during implementation. None of them change the plan
above; they are flagged per the project's rule that conflicts with the PRD/TRD are surfaced, not
silently resolved.

> **Decisions taken during 2C:** the assignment table is `assessment_assignments` with a unique
> `(assessment_id, candidate_id)` pair, so assigning twice is idempotent rather than an error;
> `AssignmentStatus` has only `ASSIGNED` (attempt states belong to Phase 3); publishing requires the
> assessment to pass the readiness check again at the moment of publishing; a published assessment is
> read-only in both the API and the UI, and it can be unpublished only while nobody holds it;
> candidates are created by an administrator with an initial password, because this build has no
> email delivery; `GET /api/v1/candidates/me/assessments` never returns questions or answer keys.
>
> **Decisions taken during 2B:** settings live as columns on `assessments` (no separate table);
> `question_navigation` is `FREE` / `SEQUENTIAL` (no source document defines the modes); readiness
> requires question marks to equal the configured total; reordering uses explicit move controls rather
> than drag-and-drop, to avoid a new dependency; `PUBLISHED`/`ARCHIVED` were deliberately left out.
>
> **Decisions taken during 2A:** no `Organization` entity (standalone showcase deployment); the
> entity is named `Assessment` with routes at `/api/v1/assessments`; `AssessmentStatus` starts with
> `DRAFT` only; questions carry `position` assigned automatically (reordering is 2B); answer keys
> live in `question_options.is_correct` and are returned only to admins.

1. **Organization / tenant association.** `CLAUDE.md` and TRD §6 require tenant-sensitive tables to
   carry an organization association *from day one*, and there is still no `Organization` entity
   (deferred through Phase 1B/1C). Phase 2 creates the first tenant-sensitive tables, so this is the
   natural point to add it — or to record an explicit decision to defer again.
2. **Entity naming.** This plan says "Assessment"; the TRD §5 / PROJECT-CONTEXT entity list says
   `Exam`, `Question`, `QuestionOption`, `ExamQuestion`, `CandidateExam`. Decide which name the
   tables and API use (`/api/v1/exams` vs `/api/v1/assessments`) before the first migration.
3. **Assessment lifecycle vs PRD.** The `DRAFT → READY → PUBLISHED → ARCHIVED` states are from this
   plan; no source document defines them. Confirm they are the canonical lifecycle.
4. **Demo candidates vs the `users` table.** Phase 1B candidates are real `users` rows with a roll
   number. Decide whether Phase 2 "demo candidates" are ordinary seeded `CANDIDATE` users (simplest,
   recommended) or a separate table.
5. **Answer-key exposure (OQ-17).** Correct answers and explanations must never be delivered to a
   candidate client. The authoring API can return them to admins; the candidate-facing shape must
   omit them from the very first endpoint.
6. **Question types beyond 2A.** The PRD also lists short answer, long answer and coding questions.
   2A covers MCQ / multiple-select / true-false only; the model should leave room without building
   the rest.
