"""Coding analytics for one assessment (coding assessments, stage C4). Administrators only.

Facts computed from stored rows: submissions, verdicts, runtimes, languages, scores. Nothing here ranks
candidates or turns a number into a judgement — candidates are listed by name, never sorted by score.
"""

import uuid
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.attempt import AssessmentAttempt
from app.models.code_execution import CodeExecution, ExecutionKind, ExecutionStatus, Verdict
from app.models.question import Question, QuestionType
from app.models.result import AttemptResult
from app.services.evaluation import CodingBest, coding_marks


def _avg(values: list[float]) -> Decimal | None:
    if not values:
        return None
    return (Decimal(sum(values)) / Decimal(len(values))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _rate(part: int, whole: int) -> Decimal | None:
    return _avg([100.0 * part / whole]) if whole else None


def _best(question: Question, subs: list[CodeExecution]) -> tuple[CodeExecution | None, int]:
    partial = bool(question.coding_version and question.coding_version.partial_scoring)
    best, best_marks = None, -1
    for e in subs:
        marks = coding_marks(
            question.marks,
            partial,
            CodingBest(
                e.id,
                e.verdict.value if e.verdict else "",
                e.passed or 0,
                e.total or 0,
                e.passed_weight or 0,
                e.total_weight or 0,
                e.language,
            ),
        )
        if marks > best_marks:
            best, best_marks = e, marks
    return best, max(best_marks, 0)


def coding_analytics(db: Session, assessment_id: uuid.UUID) -> dict:
    questions = list(
        db.scalars(
            select(Question)
            .where(Question.assessment_id == assessment_id, Question.type == QuestionType.CODING)
            .order_by(Question.position)
        )
    )
    attempts = list(
        db.scalars(select(AssessmentAttempt).where(AssessmentAttempt.assessment_id == assessment_id))
    )
    by_attempt = {a.id: a for a in attempts}
    submissions = (
        list(
            db.scalars(
                select(CodeExecution).where(
                    CodeExecution.attempt_id.in_(list(by_attempt)), CodeExecution.kind == ExecutionKind.SUBMIT
                )
            )
        )
        if by_attempt
        else []
    )
    judged = [s for s in submissions if s.status is ExecutionStatus.COMPLETED]

    per_question = []
    for number, q in enumerate(questions, start=1):
        mine = [s for s in judged if s.question_id == q.id]
        attempted = {s.attempt_id for s in submissions if s.question_id == q.id}
        accepted = [s for s in mine if s.verdict is Verdict.ACCEPTED]
        solved = {s.attempt_id for s in accepted}
        failures = Counter(s.verdict.value for s in mine if s.verdict and s.verdict is not Verdict.ACCEPTED)
        best_marks = [_best(q, [s for s in mine if s.attempt_id == a])[1] for a in attempted]
        per_question.append(
            {
                "question_id": q.id,
                "number": q.position + 1,
                "coding_number": number,
                "title": q.text,
                "marks": q.marks,
                "candidates_attempted": len(attempted),
                "submissions": len([s for s in submissions if s.question_id == q.id]),
                "acceptance_rate": _rate(len(accepted), len(mine)),
                "solved_rate": _rate(len(solved), len(attempted)),
                "average_score": _avg([float(m) for m in best_marks]),
                "average_runtime_ms": _avg(
                    [float(s.runtime_ms) for s in accepted if s.runtime_ms is not None]
                ),
                "languages": dict(Counter(s.language for s in submissions if s.question_id == q.id)),
                "common_failure": failures.most_common(1)[0][0] if failures else None,
            }
        )

    results = {
        r.attempt_id: r
        for r in db.scalars(select(AttemptResult).where(AttemptResult.assessment_id == assessment_id))
    }
    per_candidate = []
    for attempt in sorted(attempts, key=lambda a: (a.candidate.name.lower(), a.attempt_number)):
        mine = [s for s in submissions if s.attempt_id == attempt.id]
        if not mine:
            continue
        problems = []
        for q in questions:
            subs = [s for s in judged if s.attempt_id == attempt.id and s.question_id == q.id]
            best, marks = _best(q, subs)
            problems.append(
                {
                    "question_id": q.id,
                    "submissions": len([s for s in mine if s.question_id == q.id]),
                    "best_verdict": best.verdict.value if best and best.verdict else None,
                    "best_passed": best.passed if best else None,
                    "total": best.total if best else None,
                    "marks": marks if best else None,
                }
            )
        result = results.get(attempt.id)
        per_candidate.append(
            {
                "attempt_id": attempt.id,
                "candidate_name": attempt.candidate.name,
                "attempt_number": attempt.attempt_number,
                "problems_attempted": len({s.question_id for s in mine}),
                "submissions": len(mine),
                "languages": sorted({s.language for s in mine}),
                "pass_rate": _rate(
                    len([s for s in mine if s.verdict is Verdict.ACCEPTED]),
                    len([s for s in mine if s.status is ExecutionStatus.COMPLETED]),
                ),
                "coding_score": result.coding_score if result else None,
                "coding_maximum": result.coding_maximum if result else None,
                "problems": problems,
            }
        )

    finished = list(results.values())
    return {
        "assessment_id": assessment_id,
        "questions": per_question,
        "candidates": per_candidate,
        "summary": {
            "results": len(finished),
            "mcq_average": _avg([float(r.mcq_score) for r in finished if r.mcq_score is not None]),
            "mcq_maximum": next((r.mcq_maximum for r in finished if r.mcq_maximum is not None), None),
            "coding_average": _avg([float(r.coding_score) for r in finished if r.coding_score is not None]),
            "coding_maximum": next(
                (r.coding_maximum for r in finished if r.coding_maximum is not None), None
            ),
            "total_average": _avg([float(r.score) for r in finished]),
            "total_maximum": next((r.maximum_score for r in finished), None),
        },
    }
