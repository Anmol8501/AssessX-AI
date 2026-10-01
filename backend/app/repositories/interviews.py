import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.interview import (
    Interview,
    InterviewAssignment,
    InterviewQuestion,
    InterviewSession,
    InterviewSessionItem,
    InterviewStatus,
    QuestionKind,
)


class InterviewRepository:
    """Phase 7A. Every candidate-reachable lookup is scoped by `candidate_id` in the query itself, so
    another candidate's interview or session is *not found* rather than found-then-refused."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, row: object) -> None:
        self.db.add(row)
        self.db.flush()

    def delete(self, row: object) -> None:
        self.db.delete(row)
        self.db.flush()

    # -- interviews (admin) ------------------------------------------------------------------

    def list_all(self) -> list[tuple[Interview, int, int]]:
        """`(interview, primary question count, assignment count)`, newest first, in one query."""
        primaries = (
            select(func.count())
            .select_from(InterviewQuestion)
            .where(
                InterviewQuestion.interview_id == Interview.id, InterviewQuestion.kind == QuestionKind.PRIMARY
            )
            .scalar_subquery()
        )
        assigned = (
            select(func.count())
            .select_from(InterviewAssignment)
            .where(InterviewAssignment.interview_id == Interview.id)
            .scalar_subquery()
        )
        rows = self.db.execute(select(Interview, primaries, assigned).order_by(Interview.created_at.desc()))
        return [(i, int(p), int(a)) for i, p, a in rows.all()]

    def get(self, interview_id: uuid.UUID) -> Interview | None:
        return self.db.get(Interview, interview_id)

    def questions(self, interview_id: uuid.UUID) -> list[InterviewQuestion]:
        return list(
            self.db.scalars(
                select(InterviewQuestion)
                .where(InterviewQuestion.interview_id == interview_id)
                .order_by(InterviewQuestion.position, InterviewQuestion.id)
            )
        )

    def question(self, interview_id: uuid.UUID, question_id: uuid.UUID) -> InterviewQuestion | None:
        """Scoped to the interview: another interview's question id is simply not found."""
        return self.db.scalar(
            select(InterviewQuestion).where(
                InterviewQuestion.id == question_id, InterviewQuestion.interview_id == interview_id
            )
        )

    def next_position(self, interview_id: uuid.UUID) -> int:
        highest = self.db.scalar(
            select(func.max(InterviewQuestion.position)).where(InterviewQuestion.interview_id == interview_id)
        )
        return 0 if highest is None else highest + 1

    # -- assignments -------------------------------------------------------------------------

    def assignments(
        self, interview_id: uuid.UUID
    ) -> list[tuple[InterviewAssignment, InterviewSession | None]]:
        rows = self.db.execute(
            select(InterviewAssignment, InterviewSession)
            .outerjoin(InterviewSession, InterviewSession.assignment_id == InterviewAssignment.id)
            .where(InterviewAssignment.interview_id == interview_id)
            .order_by(InterviewAssignment.assigned_at, InterviewAssignment.id)
        )
        return [(a, s) for a, s in rows.all()]

    def assignment(self, interview_id: uuid.UUID, candidate_id: uuid.UUID) -> InterviewAssignment | None:
        return self.db.scalar(
            select(InterviewAssignment).where(
                InterviewAssignment.interview_id == interview_id,
                InterviewAssignment.candidate_id == candidate_id,
            )
        )

    def assigned_candidate_ids(self, interview_id: uuid.UUID) -> set[uuid.UUID]:
        return set(
            self.db.scalars(
                select(InterviewAssignment.candidate_id).where(
                    InterviewAssignment.interview_id == interview_id
                )
            )
        )

    def count_assignments(self, interview_id: uuid.UUID) -> int:
        return (
            self.db.scalar(
                select(func.count())
                .select_from(InterviewAssignment)
                .where(InterviewAssignment.interview_id == interview_id)
            )
            or 0
        )

    def answered_counts(self, session_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int]]:
        """`{session: (primaries answered, follow-ups answered)}` in one query (admin progress)."""
        if not session_ids:
            return {}
        rows = self.db.execute(
            select(InterviewSessionItem.session_id, InterviewSessionItem.kind, func.count())
            .where(
                InterviewSessionItem.session_id.in_(session_ids),
                InterviewSessionItem.answer_text.is_not(None),
            )
            .group_by(InterviewSessionItem.session_id, InterviewSessionItem.kind)
        )
        counts: dict[uuid.UUID, list[int]] = {sid: [0, 0] for sid in session_ids}
        for session_id, kind, count in rows.all():
            counts[session_id][0 if kind is QuestionKind.PRIMARY else 1] = int(count)
        return {sid: (c[0], c[1]) for sid, c in counts.items()}

    # -- candidate ---------------------------------------------------------------------------

    def for_candidate(self, candidate_id: uuid.UUID) -> list[tuple[Interview, InterviewSession | None]]:
        """The candidate's assigned, published interviews and their session, if started."""
        rows = self.db.execute(
            select(Interview, InterviewSession)
            .join(InterviewAssignment, InterviewAssignment.interview_id == Interview.id)
            .outerjoin(InterviewSession, InterviewSession.assignment_id == InterviewAssignment.id)
            .where(
                InterviewAssignment.candidate_id == candidate_id,
                Interview.status == InterviewStatus.PUBLISHED,
            )
            .order_by(InterviewAssignment.assigned_at.desc(), Interview.id)
        )
        return [(i, s) for i, s in rows.all()]

    def session_for(
        self, interview_id: uuid.UUID, candidate_id: uuid.UUID, *, lock: bool = False
    ) -> InterviewSession | None:
        query = select(InterviewSession).where(
            InterviewSession.interview_id == interview_id, InterviewSession.candidate_id == candidate_id
        )
        if lock:
            query = query.with_for_update(of=InterviewSession).execution_options(populate_existing=True)
        return self.db.scalar(query)

    def session(
        self, session_id: uuid.UUID, candidate_id: uuid.UUID, *, lock: bool = False
    ) -> InterviewSession | None:
        """The candidate's own session, optionally held `FOR UPDATE` until the transaction ends.

        Every write to a session goes through the lock, so a double-click, a retried request or a
        second window serialise here: the second reads the first one's result and cannot advance
        the interview twice. `of=` because the session eager-loads its interview.
        """
        query = select(InterviewSession).where(
            InterviewSession.id == session_id, InterviewSession.candidate_id == candidate_id
        )
        if lock:
            query = query.with_for_update(of=InterviewSession).execution_options(populate_existing=True)
        return self.db.scalar(query)

    def items(self, session_id: uuid.UUID) -> list[InterviewSessionItem]:
        return list(
            self.db.scalars(
                select(InterviewSessionItem)
                .where(InterviewSessionItem.session_id == session_id)
                .order_by(InterviewSessionItem.sequence)
                .execution_options(populate_existing=True)
            )
        )
