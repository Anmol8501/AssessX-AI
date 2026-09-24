import uuid

from fastapi import APIRouter, status

from app.api.deps import AdminUser, DbSession
from app.models.assessment import Assessment
from app.models.assignment import AssessmentAssignment
from app.schemas.assessment import (
    AssessmentCreate,
    AssessmentDetail,
    AssessmentSettings,
    AssessmentSummary,
    AssessmentUpdate,
    ReorderQuestions,
)
from app.schemas.assignment import AssignCandidates, AssignmentOut, AssignmentResult
from app.schemas.question import QuestionCreate, QuestionOut, QuestionUpdate
from app.schemas.result import AdminResult, AssessmentResults
from app.services.assessments import AssessmentService
from app.services.assignments import AssignmentService
from app.services.results import ResultService

# Admin-only for the whole router: authoring is never available to a candidate. Candidate-facing
# assessment views arrive in Phase 2C with their own shape (no answer keys).
router = APIRouter(prefix="/assessments", tags=["assessments"])


def _summary(assessment: Assessment) -> AssessmentSummary:
    return AssessmentSummary(
        id=assessment.id,
        title=assessment.title,
        description=assessment.description,
        status=assessment.status,
        duration_minutes=assessment.duration_minutes,
        total_marks=assessment.total_marks,
        passing_marks=assessment.passing_marks,
        question_count=len(assessment.questions),
        allocated_marks=sum(question.marks for question in assessment.questions),
        assignment_count=len(assessment.assignments),
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
    )


def _assignment(assignment: AssessmentAssignment) -> AssignmentOut:
    return AssignmentOut(
        id=assignment.id,
        candidate_id=assignment.candidate_id,
        candidate_name=assignment.candidate.name,
        candidate_email=assignment.candidate.email,
        candidate_roll_number=assignment.candidate.roll_number,
        status=assignment.status,
        assigned_at=assignment.assigned_at,
    )


def _detail(assessment: Assessment) -> AssessmentDetail:
    return AssessmentDetail(
        **_summary(assessment).model_dump(),
        instructions=assessment.instructions,
        settings=AssessmentSettings.model_validate(assessment, from_attributes=True),
        questions=[
            QuestionOut.model_validate(q) for q in sorted(assessment.questions, key=lambda q: q.position)
        ],
        readiness=AssessmentService.readiness(assessment),
    )


@router.get("", response_model=list[AssessmentSummary])
def list_assessments(_: AdminUser, db: DbSession) -> list[AssessmentSummary]:
    return [_summary(assessment) for assessment in AssessmentService(db).list_assessments()]


@router.post("", response_model=AssessmentDetail, status_code=status.HTTP_201_CREATED)
def create_assessment(payload: AssessmentCreate, admin: AdminUser, db: DbSession) -> AssessmentDetail:
    return _detail(AssessmentService(db).create(payload, author=admin))


@router.get("/{assessment_id}", response_model=AssessmentDetail)
def get_assessment(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> AssessmentDetail:
    return _detail(AssessmentService(db).get(assessment_id, with_questions=True))


@router.patch("/{assessment_id}", response_model=AssessmentDetail)
def update_assessment(
    assessment_id: uuid.UUID, payload: AssessmentUpdate, _: AdminUser, db: DbSession
) -> AssessmentDetail:
    return _detail(AssessmentService(db).update(assessment_id, payload))


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assessment(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> None:
    AssessmentService(db).delete(assessment_id)


@router.post("/{assessment_id}/ready", response_model=AssessmentDetail)
def mark_ready(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> AssessmentDetail:
    """DRAFT -> READY. Rejected with the outstanding issues while the assessment is incomplete."""
    return _detail(AssessmentService(db).mark_ready(assessment_id))


@router.post("/{assessment_id}/publish", response_model=AssessmentDetail)
def publish(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> AssessmentDetail:
    """READY -> PUBLISHED. Readiness is re-checked here, so a stale UI cannot publish a broken exam."""
    service = AssessmentService(db)
    assessment = service.mark_ready(assessment_id)  # revalidates and is a no-op when already READY
    return _detail(AssignmentService(db).publish(assessment))


@router.post("/{assessment_id}/unpublish", response_model=AssessmentDetail)
def unpublish(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> AssessmentDetail:
    """PUBLISHED -> DRAFT, refused while candidates are assigned."""
    assessment = AssessmentService(db).get(assessment_id, with_questions=True)
    return _detail(AssignmentService(db).unpublish(assessment))


@router.get("/{assessment_id}/assignments", response_model=list[AssignmentOut])
def list_assignments(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> list[AssignmentOut]:
    AssessmentService(db).get(assessment_id)
    return [_assignment(a) for a in AssignmentService(db).list_assignments(assessment_id)]


@router.post(
    "/{assessment_id}/assignments", response_model=AssignmentResult, status_code=status.HTTP_201_CREATED
)
def assign_candidates(
    assessment_id: uuid.UUID, payload: AssignCandidates, admin: AdminUser, db: DbSession
) -> AssignmentResult:
    """Assigns a published assessment. Candidates already holding it are reported, not duplicated."""
    assessment = AssessmentService(db).get(assessment_id)
    created, already = AssignmentService(db).assign(assessment, payload.candidate_ids, assigned_by=admin)
    return AssignmentResult(assigned=[_assignment(a) for a in created], already_assigned=already)


@router.delete("/{assessment_id}/assignments/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def unassign_candidate(
    assessment_id: uuid.UUID, candidate_id: uuid.UUID, _: AdminUser, db: DbSession
) -> None:
    AssessmentService(db).get(assessment_id)
    AssignmentService(db).unassign(assessment_id, candidate_id)


@router.get("/{assessment_id}/results", response_model=AssessmentResults)
def assessment_results(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> AssessmentResults:
    """Every candidate's result for one assessment.

    Admin-only, like the rest of this router: a candidate calling it gets 403, and a candidate's
    own result comes from `/api/v1/candidates/me/...` instead. Reading this also evaluates any
    finished attempt that has not been scored yet, so nothing is silently missing from the table.

    Scores only — no ranking, no analytics, no proctoring.
    """
    assessment = AssessmentService(db).get(assessment_id, with_questions=True)
    results = ResultService(db).list_for_assessment(assessment_id)
    return AssessmentResults(
        assessment_id=assessment.id,
        assessment_title=assessment.title,
        total_marks=assessment.total_marks,
        passing_marks=assessment.passing_marks,
        assigned_count=len(assessment.assignments),
        results=[
            AdminResult(
                attempt_id=result.attempt_id,
                candidate_id=result.candidate_id,
                candidate_name=result.candidate.name,
                candidate_email=result.candidate.email,
                candidate_roll_number=result.candidate.roll_number,
                attempt_number=result.attempt.attempt_number,
                attempt_status=result.attempt.status,
                score=result.score,
                maximum_score=result.maximum_score,
                percentage=result.percentage,
                passing_marks=result.passing_marks,
                passed=result.passed,
                correct_count=result.correct_count,
                incorrect_count=result.incorrect_count,
                unanswered_count=result.unanswered_count,
                submitted_at=result.attempt.submitted_at,
                evaluated_at=result.evaluated_at,
            )
            for result in results
        ],
    )


@router.post("/{assessment_id}/draft", response_model=AssessmentDetail)
def revert_to_draft(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> AssessmentDetail:
    """READY -> DRAFT so the assessment can be edited again."""
    return _detail(AssessmentService(db).revert_to_draft(assessment_id))


# -- questions -------------------------------------------------------------------------------


@router.get("/{assessment_id}/questions", response_model=list[QuestionOut])
def list_questions(assessment_id: uuid.UUID, _: AdminUser, db: DbSession) -> list[QuestionOut]:
    return [QuestionOut.model_validate(q) for q in AssessmentService(db).list_questions(assessment_id)]


@router.post("/{assessment_id}/questions", response_model=QuestionOut, status_code=status.HTTP_201_CREATED)
def create_question(
    assessment_id: uuid.UUID, payload: QuestionCreate, _: AdminUser, db: DbSession
) -> QuestionOut:
    return QuestionOut.model_validate(AssessmentService(db).add_question(assessment_id, payload))


@router.post("/{assessment_id}/questions/reorder", response_model=list[QuestionOut])
def reorder_questions(
    assessment_id: uuid.UUID, payload: ReorderQuestions, _: AdminUser, db: DbSession
) -> list[QuestionOut]:
    """Sets the explicit question order. The body must list every question exactly once."""
    questions = AssessmentService(db).reorder_questions(assessment_id, payload.question_ids)
    return [QuestionOut.model_validate(question) for question in questions]


@router.post(
    "/{assessment_id}/questions/{question_id}/duplicate",
    response_model=QuestionOut,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_question(
    assessment_id: uuid.UUID, question_id: uuid.UUID, _: AdminUser, db: DbSession
) -> QuestionOut:
    """Copies the question, answer key included, into the slot right after the original."""
    return QuestionOut.model_validate(AssessmentService(db).duplicate_question(assessment_id, question_id))


@router.get("/{assessment_id}/questions/{question_id}", response_model=QuestionOut)
def get_question(
    assessment_id: uuid.UUID, question_id: uuid.UUID, _: AdminUser, db: DbSession
) -> QuestionOut:
    return QuestionOut.model_validate(AssessmentService(db).get_question(assessment_id, question_id))


@router.patch("/{assessment_id}/questions/{question_id}", response_model=QuestionOut)
def update_question(
    assessment_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: QuestionUpdate,
    _: AdminUser,
    db: DbSession,
) -> QuestionOut:
    return QuestionOut.model_validate(
        AssessmentService(db).update_question(assessment_id, question_id, payload)
    )


@router.delete("/{assessment_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(assessment_id: uuid.UUID, question_id: uuid.UUID, _: AdminUser, db: DbSession) -> None:
    AssessmentService(db).delete_question(assessment_id, question_id)
