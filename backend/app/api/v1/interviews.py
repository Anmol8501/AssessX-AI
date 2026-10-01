"""Phase 7A — interview configuration (admin only).

`AdminUser` on every route: a candidate gets 403, an anonymous request 401. Any administrator may
manage any interview — the same single-tenant scope as assessments. Nothing here evaluates answers;
the assignment list reports progress, never answer content (that is Phase 7C).
"""

import uuid

from fastapi import APIRouter, status

from app.api.deps import AdminUser, DbSession
from app.models.interview import Interview, InterviewQuestion
from app.schemas.interview import (
    AssignmentRow,
    AssignResult,
    EvaluatedAnswer,
    EvaluationOut,
    FollowUpCreate,
    InterviewAssign,
    InterviewCreate,
    InterviewDetail,
    InterviewQuestionAdmin,
    InterviewSummary,
    InterviewUpdate,
    QuestionCreate,
    QuestionReorder,
    QuestionUpdate,
    SessionEvaluations,
)
from app.services.interview.calls import CallService
from app.services.interview.selection import eligible_primaries
from app.services.interview.service import InterviewService

router = APIRouter(prefix="/interviews", tags=["interviews"])


def _detail(service: InterviewService, interview: Interview) -> InterviewDetail:
    questions: list[InterviewQuestion] = service.repo.questions(interview.id)
    return InterviewDetail(
        id=interview.id,
        title=interview.title,
        description=interview.description,
        instructions=interview.instructions,
        interview_type=interview.interview_type,
        format=interview.format,
        difficulty=interview.difficulty,
        topics=interview.topics,
        duration_minutes=interview.duration_minutes,
        question_count=interview.question_count,
        follow_ups_enabled=interview.follow_ups_enabled,
        max_follow_ups=interview.max_follow_ups,
        adaptive_difficulty=interview.adaptive_difficulty,
        min_difficulty=interview.min_difficulty,
        starting_difficulty=interview.starting_difficulty,
        status=interview.status,
        created_at=interview.created_at,
        updated_at=interview.updated_at,
        published_at=interview.published_at,
        questions=[InterviewQuestionAdmin.model_validate(q) for q in questions],
        eligible_question_count=len(eligible_primaries(interview, questions)),
        issues=service.issues(interview, questions),
    )


@router.get("", response_model=list[InterviewSummary])
def list_interviews(_: AdminUser, db: DbSession) -> list[InterviewSummary]:
    return [
        InterviewSummary(
            id=i.id,
            title=i.title,
            interview_type=i.interview_type,
            format=i.format,
            difficulty=i.difficulty,
            status=i.status,
            duration_minutes=i.duration_minutes,
            question_count=i.question_count,
            primary_question_count=primaries,
            assignment_count=assigned,
            created_at=i.created_at,
            published_at=i.published_at,
        )
        for i, primaries, assigned in InterviewService(db).list_all()
    ]


@router.post("", response_model=InterviewDetail, status_code=status.HTTP_201_CREATED)
def create_interview(payload: InterviewCreate, admin: AdminUser, db: DbSession) -> InterviewDetail:
    service = InterviewService(db)
    return _detail(service, service.create(payload, admin))


@router.get("/{interview_id}", response_model=InterviewDetail)
def get_interview(interview_id: uuid.UUID, _: AdminUser, db: DbSession) -> InterviewDetail:
    service = InterviewService(db)
    return _detail(service, service.get(interview_id))


@router.patch("/{interview_id}", response_model=InterviewDetail)
def update_interview(
    interview_id: uuid.UUID, payload: InterviewUpdate, admin: AdminUser, db: DbSession
) -> InterviewDetail:
    """Draft only (409 `interview_locked` once published)."""
    service = InterviewService(db)
    return _detail(service, service.update(interview_id, payload, admin))


@router.delete("/{interview_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_interview(interview_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    InterviewService(db).delete(interview_id, admin)


@router.post("/{interview_id}/publish", response_model=InterviewDetail)
def publish_interview(interview_id: uuid.UUID, admin: AdminUser, db: DbSession) -> InterviewDetail:
    """DRAFT → PUBLISHED, refused (422, with the issues) unless enough eligible questions exist."""
    service = InterviewService(db)
    return _detail(service, service.publish(interview_id, admin))


@router.post("/{interview_id}/unpublish", response_model=InterviewDetail)
def unpublish_interview(interview_id: uuid.UUID, admin: AdminUser, db: DbSession) -> InterviewDetail:
    """PUBLISHED → DRAFT, refused (409) while any candidate is assigned."""
    service = InterviewService(db)
    return _detail(service, service.unpublish(interview_id, admin))


@router.post(
    "/{interview_id}/questions", response_model=InterviewQuestionAdmin, status_code=status.HTTP_201_CREATED
)
def add_question(
    interview_id: uuid.UUID, payload: QuestionCreate, admin: AdminUser, db: DbSession
) -> InterviewQuestionAdmin:
    return InterviewQuestionAdmin.model_validate(
        InterviewService(db).add_question(interview_id, payload, admin)
    )


@router.post("/{interview_id}/questions/reorder", response_model=list[InterviewQuestionAdmin])
def reorder_questions(
    interview_id: uuid.UUID, payload: QuestionReorder, admin: AdminUser, db: DbSession
) -> list[InterviewQuestionAdmin]:
    questions = InterviewService(db).reorder(interview_id, payload.question_ids, admin)
    return [InterviewQuestionAdmin.model_validate(q) for q in questions]


@router.post(
    "/{interview_id}/questions/{question_id}/follow-up",
    response_model=InterviewQuestionAdmin,
    status_code=status.HTTP_201_CREATED,
)
def add_follow_up(
    interview_id: uuid.UUID, question_id: uuid.UUID, payload: FollowUpCreate, admin: AdminUser, db: DbSession
) -> InterviewQuestionAdmin:
    """At most one follow-up per primary question (409 if it already has one)."""
    return InterviewQuestionAdmin.model_validate(
        InterviewService(db).add_follow_up(interview_id, question_id, payload, admin)
    )


@router.patch("/{interview_id}/questions/{question_id}", response_model=InterviewQuestionAdmin)
def update_question(
    interview_id: uuid.UUID, question_id: uuid.UUID, payload: QuestionUpdate, admin: AdminUser, db: DbSession
) -> InterviewQuestionAdmin:
    return InterviewQuestionAdmin.model_validate(
        InterviewService(db).update_question(interview_id, question_id, payload, admin)
    )


@router.delete("/{interview_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question(interview_id: uuid.UUID, question_id: uuid.UUID, admin: AdminUser, db: DbSession) -> None:
    InterviewService(db).delete_question(interview_id, question_id, admin)


@router.get("/{interview_id}/assignments", response_model=list[AssignmentRow])
def list_assignments(interview_id: uuid.UUID, _: AdminUser, db: DbSession) -> list[AssignmentRow]:
    """Who is assigned and how far they have got. Progress only — never answers."""
    progress = InterviewService(db).progress(interview_id)
    open_calls = CallService(db).open_calls([p.assignment.id for p in progress])
    return [
        AssignmentRow(
            candidate_id=p.assignment.candidate_id,
            candidate_name=p.assignment.candidate.name,
            candidate_email=p.assignment.candidate.email,
            candidate_roll_number=p.assignment.candidate.roll_number,
            assigned_at=p.assignment.assigned_at,
            session_id=p.session.id if p.session else None,
            open_call_id=open_calls.get(p.assignment.id),
            session_status=p.status,
            completion_reason=(
                "TIME_EXPIRED" if p.expired else (p.session.completion_reason if p.session else None)
            ),
            started_at=p.session.started_at if p.session else None,
            completed_at=(p.session.expires_at if p.expired else p.session.completed_at)
            if p.session
            else None,
            primary_answered=p.primary_answered,
            primary_total=len(p.session.question_plan)
            if p.session
            else p.assignment.interview.question_count,
            follow_ups_answered=p.follow_ups_answered,
        )
        for p in progress
    ]


@router.get("/{interview_id}/assignments/{candidate_id}/evaluations", response_model=SessionEvaluations)
def candidate_evaluations(
    interview_id: uuid.UUID, candidate_id: uuid.UUID, _: AdminUser, db: DbSession
) -> SessionEvaluations:
    """One candidate's answers with their validated AI evaluations (Phase 7B). Read-only, admin only.

    An assessment signal for a person to review — not a decision, not a ranking. No prompts, raw model
    output or reasoning traces are stored, so none can be returned. 404 if the candidate is not assigned
    or has not started.
    """
    session, rows = InterviewService(db).evaluations(interview_id, candidate_id)
    return SessionEvaluations(
        candidate_id=candidate_id,
        session_status=session.status.value,
        completion_reason=session.completion_reason,
        current_difficulty=session.current_difficulty,
        difficulty_changes=session.difficulty_changes,
        answers=[
            EvaluatedAnswer(
                sequence=item.sequence,
                kind=item.kind,
                number=number,
                question_text=item.question.text,
                topic=item.question.topic,
                difficulty=item.question.difficulty,
                selected_by=item.selected_by.value,
                answer_text=item.answer_text,
                answered_at=item.answered_at,
                evaluation=EvaluationOut.of(e) if e else None,
            )
            for item, number, e in rows
        ],
    )


@router.post("/{interview_id}/assignments", response_model=AssignResult, status_code=status.HTTP_201_CREATED)
def assign_candidates(
    interview_id: uuid.UUID, payload: InterviewAssign, admin: AdminUser, db: DbSession
) -> AssignResult:
    created, already = InterviewService(db).assign(interview_id, payload.candidate_ids, admin)
    return AssignResult(assigned=created, already_assigned=already)


@router.delete("/{interview_id}/assignments/{candidate_id}", status_code=status.HTTP_204_NO_CONTENT)
def unassign_candidate(
    interview_id: uuid.UUID, candidate_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> None:
    InterviewService(db).unassign(interview_id, candidate_id, admin)
