"""Phase 7A — interview configuration (admin): the interview, its question bank, publishing, assignment.

DRAFT interviews are edited freely; PUBLISHED ones are locked (every session must see one paper) and
can be assigned. Unpublishing is refused while anyone is assigned. Every change is recorded in the
append-only audit log with ids and field names only — never question or answer text.
"""

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, InterviewLocked, NotFound, ValidationFailed
from app.models.audit_log import AuditAction
from app.models.base import utcnow
from app.models.interview import (
    DIFFICULTY_RANK,
    Interview,
    InterviewAssignment,
    InterviewDifficulty,
    InterviewFormat,
    InterviewQuestion,
    InterviewSession,
    InterviewSessionItem,
    InterviewSessionStatus,
    InterviewStatus,
    QuestionKind,
)
from app.models.interview_evaluation import InterviewEvaluation
from app.models.user import User, UserRole
from app.repositories.audit import AuditRepository
from app.repositories.interviews import InterviewRepository
from app.repositories.users import UserRepository
from app.schemas.interview import (
    FollowUpCreate,
    InterviewCreate,
    InterviewUpdate,
    QuestionCreate,
    QuestionUpdate,
    ReadinessIssue,
)
from app.services.interview.selection import eligible_primaries

log = logging.getLogger("assessx.interviews")


@dataclass(frozen=True)
class AssignmentProgress:
    assignment: InterviewAssignment
    session: InterviewSession | None
    #: NOT_STARTED, ACTIVE or COMPLETED — an ACTIVE session past its deadline reads as COMPLETED
    #: (TIME_EXPIRED) here without being written: an admin's read never changes a candidate's session.
    status: str
    expired: bool
    primary_answered: int
    follow_ups_answered: int


class InterviewService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = InterviewRepository(db)
        self.audit = AuditRepository(db)
        self.users = UserRepository(db)

    # -- helpers -----------------------------------------------------------------------------

    def get(self, interview_id: uuid.UUID) -> Interview:
        interview = self.repo.get(interview_id)
        if interview is None:
            raise NotFound("Interview not found.")
        return interview

    def _draft(self, interview_id: uuid.UUID) -> Interview:
        interview = self.get(interview_id)
        if interview.status is not InterviewStatus.DRAFT:
            raise InterviewLocked()
        return interview

    def _record(self, admin: User, action: AuditAction, interview: Interview, **details: object) -> None:
        self.audit.record(
            actor_id=admin.id,
            action=action,
            interview_id=interview.id,
            details={k: v for k, v in details.items() if v is not None},
        )
        log.info("Interview action", extra={"action": action.value, "interview_id": str(interview.id)})

    @staticmethod
    def _check_budget(question_count: int, max_follow_ups: int) -> None:
        if max_follow_ups > question_count:
            raise ValidationFailed(
                "Too many follow-ups.",
                details=[{"field": "max_follow_ups", "message": "At most one follow-up per question."}],
            )

    @staticmethod
    def _check_topic(interview: Interview, topic: str) -> str:
        """The question's topic must be one of the interview's approved topics (matched case-insensitively,
        stored in the interview's spelling)."""
        for approved in interview.topics:
            if approved.lower() == topic.lower():
                return approved
        raise ValidationFailed(
            "That topic is not one of this interview's topics.",
            details=[{"field": "topic", "message": "Choose one of the interview's topics."}],
        )

    # -- interviews --------------------------------------------------------------------------

    def list_all(self) -> list[tuple[Interview, int, int]]:
        return self.repo.list_all()

    @staticmethod
    def _check_difficulty(
        minimum: InterviewDifficulty, starting: InterviewDifficulty, maximum: InterviewDifficulty
    ) -> None:
        if not DIFFICULTY_RANK[minimum] <= DIFFICULTY_RANK[starting] <= DIFFICULTY_RANK[maximum]:
            raise ValidationFailed(
                "Difficulty bounds are inconsistent.",
                details=[
                    {
                        "field": "starting_difficulty",
                        "message": "Minimum ≤ starting ≤ maximum difficulty is required.",
                    }
                ],
            )

    def create(self, payload: InterviewCreate, admin: User) -> Interview:
        self._check_budget(payload.question_count, payload.max_follow_ups)
        data = payload.model_dump()
        data["starting_difficulty"] = data["starting_difficulty"] or payload.difficulty
        self._check_difficulty(data["min_difficulty"], data["starting_difficulty"], payload.difficulty)
        interview = Interview(**data, status=InterviewStatus.DRAFT, created_by_id=admin.id)
        self.repo.add(interview)
        self._record(admin, AuditAction.INTERVIEW_CREATED, interview)
        return interview

    def update(self, interview_id: uuid.UUID, payload: InterviewUpdate, admin: User) -> Interview:
        interview = self._draft(interview_id)
        changes = payload.model_dump(exclude_unset=True)
        # `description` and `instructions` may be set to null (cleared); everything else is required.
        for required in (
            "title",
            "interview_type",
            "difficulty",
            "topics",
            "duration_minutes",
            "question_count",
            "follow_ups_enabled",
            "max_follow_ups",
            "adaptive_difficulty",
            "min_difficulty",
            "starting_difficulty",
        ):
            if required in changes and changes[required] is None:
                raise ValidationFailed(
                    "A required field cannot be empty.", details=[{"field": required, "message": "Required."}]
                )
        self._check_budget(
            changes.get("question_count", interview.question_count),
            changes.get("max_follow_ups", interview.max_follow_ups),
        )
        self._check_difficulty(
            changes.get("min_difficulty", interview.min_difficulty),
            changes.get("starting_difficulty", interview.starting_difficulty),
            changes.get("difficulty", interview.difficulty),
        )
        for field, value in changes.items():
            setattr(interview, field, value)
        self.db.flush()
        self._record(admin, AuditAction.INTERVIEW_UPDATED, interview, fields=sorted(changes))
        return interview

    def delete(self, interview_id: uuid.UUID, admin: User) -> None:
        """Only a draft — which, since unpublishing needs no one assigned, has no sessions either."""
        interview = self._draft(interview_id)
        self._record(admin, AuditAction.INTERVIEW_DELETED, interview)
        self.repo.delete(interview)

    def issues(self, interview: Interview, questions: list[InterviewQuestion]) -> list[ReadinessIssue]:
        if interview.format is InterviewFormat.LIVE:
            # A live interview is held by a person; its questions are an optional guide (Phase 7D).
            return []
        issues: list[ReadinessIssue] = []
        if not interview.topics:
            issues.append(ReadinessIssue(field="topics", message="Add at least one topic."))
        eligible = len(eligible_primaries(interview, questions))
        if eligible < interview.question_count:
            issues.append(
                ReadinessIssue(
                    field="questions",
                    message=(
                        f"{interview.question_count} questions are asked, but only {eligible} active primary "
                        "question(s) match the interview's topics, type and difficulty."
                    ),
                )
            )
        if interview.follow_ups_enabled and interview.max_follow_ups < 1:
            issues.append(
                ReadinessIssue(field="max_follow_ups", message="Follow-ups are enabled but the limit is 0.")
            )
        return issues

    def publish(self, interview_id: uuid.UUID, admin: User) -> Interview:
        interview = self.get(interview_id)
        if interview.status is InterviewStatus.PUBLISHED:
            return interview
        issues = self.issues(interview, self.repo.questions(interview.id))
        if issues:
            raise ValidationFailed(
                "The interview is not ready to publish.", details=[i.model_dump() for i in issues]
            )
        interview.status = InterviewStatus.PUBLISHED
        interview.published_at = utcnow()
        self.db.flush()
        self._record(admin, AuditAction.INTERVIEW_PUBLISHED, interview)
        return interview

    def unpublish(self, interview_id: uuid.UUID, admin: User) -> Interview:
        interview = self.get(interview_id)
        if interview.status is InterviewStatus.DRAFT:
            return interview
        if self.repo.count_assignments(interview.id) > 0:
            raise Conflict("Unassign every candidate before returning this interview to draft.")
        interview.status = InterviewStatus.DRAFT
        interview.published_at = None
        self.db.flush()
        self._record(admin, AuditAction.INTERVIEW_UNPUBLISHED, interview)
        return interview

    # -- questions ---------------------------------------------------------------------------

    def add_question(
        self, interview_id: uuid.UUID, payload: QuestionCreate, admin: User
    ) -> InterviewQuestion:
        interview = self._draft(interview_id)
        data = payload.model_dump()
        data["topic"] = self._check_topic(interview, payload.topic)
        question = InterviewQuestion(
            interview_id=interview.id,
            kind=QuestionKind.PRIMARY,
            position=self.repo.next_position(interview.id),
            **data,
        )
        self.repo.add(question)
        self._record(
            admin,
            AuditAction.INTERVIEW_QUESTION_CREATED,
            interview,
            question_id=str(question.id),
            kind="PRIMARY",
        )
        return question

    def add_follow_up(
        self, interview_id: uuid.UUID, parent_id: uuid.UUID, payload: FollowUpCreate, admin: User
    ) -> InterviewQuestion:
        interview = self._draft(interview_id)
        parent = self.repo.question(interview.id, parent_id)
        if parent is None:
            raise NotFound("Question not found.")
        if parent.kind is not QuestionKind.PRIMARY:
            raise ValidationFailed(
                "A follow-up can only follow a primary question.",
                details=[{"field": "parent_question_id", "message": "Follow-ups cannot have follow-ups."}],
            )
        if any(q.parent_question_id == parent.id for q in self.repo.questions(interview.id)):
            raise Conflict("That question already has a follow-up. Each question has at most one.")
        question = InterviewQuestion(
            interview_id=interview.id,
            kind=QuestionKind.FOLLOW_UP,
            parent_question_id=parent.id,
            question_type=parent.question_type,
            topic=parent.topic,
            difficulty=parent.difficulty,
            position=parent.position,
            **payload.model_dump(),
        )
        self.repo.add(question)
        self._record(
            admin,
            AuditAction.INTERVIEW_QUESTION_CREATED,
            interview,
            question_id=str(question.id),
            kind="FOLLOW_UP",
            parent_question_id=str(parent.id),
        )
        return question

    def update_question(
        self, interview_id: uuid.UUID, question_id: uuid.UUID, payload: QuestionUpdate, admin: User
    ) -> InterviewQuestion:
        interview = self._draft(interview_id)
        question = self.repo.question(interview.id, question_id)
        if question is None:
            raise NotFound("Question not found.")
        changes = payload.model_dump(exclude_unset=True)
        for required in ("text", "question_type", "topic", "difficulty", "expected_concepts", "is_active"):
            if required in changes and changes[required] is None:
                raise ValidationFailed(
                    "A required field cannot be empty.", details=[{"field": required, "message": "Required."}]
                )
        inherited = {"question_type", "topic", "difficulty", "competency", "context"}
        if question.kind is QuestionKind.FOLLOW_UP and inherited & set(changes):
            raise ValidationFailed(
                "A follow-up takes its type, topic and difficulty from its primary question.",
                details=[
                    {"field": f, "message": "Not editable on a follow-up."}
                    for f in sorted(inherited & set(changes))
                ],
            )
        if "topic" in changes:
            changes["topic"] = self._check_topic(interview, changes["topic"])
        for field, value in changes.items():
            setattr(question, field, value)
        if question.kind is QuestionKind.PRIMARY:
            # Keep the follow-up's inherited fields in step with its primary.
            for follow_up in self.repo.questions(interview.id):
                if follow_up.parent_question_id == question.id:
                    follow_up.question_type = question.question_type
                    follow_up.topic = question.topic
                    follow_up.difficulty = question.difficulty
        self.db.flush()
        self._record(
            admin,
            AuditAction.INTERVIEW_QUESTION_UPDATED,
            interview,
            question_id=str(question.id),
            fields=sorted(changes),
        )
        return question

    def delete_question(self, interview_id: uuid.UUID, question_id: uuid.UUID, admin: User) -> None:
        """Deleting a primary also deletes its follow-up (database cascade)."""
        interview = self._draft(interview_id)
        question = self.repo.question(interview.id, question_id)
        if question is None:
            raise NotFound("Question not found.")
        self._record(
            admin,
            AuditAction.INTERVIEW_QUESTION_DELETED,
            interview,
            question_id=str(question.id),
            kind=question.kind.value,
        )
        self.repo.delete(question)
        self.db.expire_all()

    def reorder(
        self, interview_id: uuid.UUID, question_ids: list[uuid.UUID], admin: User
    ) -> list[InterviewQuestion]:
        """Sets the order of the primary questions — the order sessions ask them in."""
        interview = self._draft(interview_id)
        questions = self.repo.questions(interview.id)
        primaries = {q.id: q for q in questions if q.kind is QuestionKind.PRIMARY}
        if len(question_ids) != len(set(question_ids)) or set(question_ids) != set(primaries):
            raise ValidationFailed(
                "The new order must list every primary question exactly once.",
                details=[{"field": "question_ids", "message": "Send all primary question ids, once each."}],
            )
        for position, question_id in enumerate(question_ids):
            primaries[question_id].position = position
        for question in questions:
            if question.parent_question_id in primaries:
                question.position = primaries[question.parent_question_id].position
        self.db.flush()
        self._record(admin, AuditAction.INTERVIEW_QUESTIONS_REORDERED, interview, count=len(question_ids))
        return self.repo.questions(interview.id)

    # -- assignment --------------------------------------------------------------------------

    def progress(self, interview_id: uuid.UUID) -> list[AssignmentProgress]:
        self.get(interview_id)
        rows = self.repo.assignments(interview_id)
        counts = self.repo.answered_counts([s.id for _, s in rows if s is not None])
        now = utcnow()
        out: list[AssignmentProgress] = []
        for assignment, session in rows:
            if session is None:
                out.append(AssignmentProgress(assignment, None, "NOT_STARTED", False, 0, 0))
                continue
            expired = session.status is InterviewSessionStatus.ACTIVE and session.has_expired_at(now)
            status = "COMPLETED" if expired else session.status.value
            primary, follow = counts.get(session.id, (0, 0))
            out.append(AssignmentProgress(assignment, session, status, expired, primary, follow))
        return out

    def evaluations(
        self, interview_id: uuid.UUID, candidate_id: uuid.UUID
    ) -> tuple[InterviewSession, list[tuple[InterviewSessionItem, int, InterviewEvaluation | None]]]:
        """A candidate's items, each with its primary number and newest evaluation — in two queries
        (items, evaluations), not one per answer."""
        self.get(interview_id)
        session = self.repo.session_for(interview_id, candidate_id)
        if session is None:
            raise NotFound("That candidate has not started this interview.")
        items = self.repo.items(session.id)
        newest: dict[uuid.UUID, InterviewEvaluation] = {}
        for evaluation in self.db.scalars(
            select(InterviewEvaluation)
            .where(InterviewEvaluation.session_id == session.id)
            .order_by(InterviewEvaluation.requested_at, InterviewEvaluation.id)
        ):
            newest[evaluation.item_id] = evaluation
        numbers: dict[uuid.UUID, int] = {}
        out: list[tuple[InterviewSessionItem, int, InterviewEvaluation | None]] = []
        for item in items:
            if item.kind is QuestionKind.PRIMARY:
                numbers[item.id] = len(numbers) + 1
            number = numbers.get(item.id) or numbers.get(item.parent_item_id or item.id, 0)
            out.append((item, number, newest.get(item.id)))
        return session, out

    def assign(
        self, interview_id: uuid.UUID, candidate_ids: list[uuid.UUID], admin: User
    ) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
        interview = self.get(interview_id)
        if interview.status is not InterviewStatus.PUBLISHED:
            raise ValidationFailed(
                "Publish the interview before assigning candidates.",
                details=[{"field": "status", "message": "Only a published interview can be assigned."}],
            )
        existing = self.repo.assigned_candidate_ids(interview.id)
        created: list[uuid.UUID] = []
        already: list[uuid.UUID] = []
        for candidate_id in dict.fromkeys(candidate_ids):
            if candidate_id in existing:
                already.append(candidate_id)
                continue
            candidate = self.users.get(candidate_id)
            if candidate is None:
                raise NotFound("One of the selected candidates does not exist.")
            if candidate.role is not UserRole.CANDIDATE:
                raise ValidationFailed(
                    "Only candidates can be assigned an interview.",
                    details=[{"field": "candidate_ids", "message": f"{candidate.email} is not a candidate."}],
                )
            if not candidate.is_active:
                raise ValidationFailed(
                    "Inactive candidates cannot be assigned an interview.",
                    details=[{"field": "candidate_ids", "message": f"{candidate.email} is inactive."}],
                )
            self.repo.add(
                InterviewAssignment(
                    interview_id=interview.id, candidate_id=candidate.id, assigned_by_id=admin.id
                )
            )
            created.append(candidate.id)
        if created:
            self._record(
                admin, AuditAction.INTERVIEW_ASSIGNED, interview, candidate_ids=[str(c) for c in created]
            )
        return created, already

    def unassign(self, interview_id: uuid.UUID, candidate_id: uuid.UUID, admin: User) -> None:
        """Removes the assignment — and with it the candidate's session and answers (cascade), as
        unassigning an assessment removes the attempt. The audit record remains."""
        interview = self.get(interview_id)
        assignment = self.repo.assignment(interview.id, candidate_id)
        if assignment is None:
            raise NotFound("That candidate is not assigned to this interview.")
        self._record(admin, AuditAction.INTERVIEW_UNASSIGNED, interview, candidate_id=str(candidate_id))
        self.repo.delete(assignment)
