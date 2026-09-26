import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.assessment import Assessment
    from app.models.assignment import AssessmentAssignment
    from app.models.proctoring import ProctoringSession
    from app.models.question import Question, QuestionOption
    from app.models.result import AttemptResult
    from app.models.user import User


class AttemptStatus(enum.StrEnum):
    """An attempt is open, or it ended one of two ways.

    `SUBMITTED` is the candidate choosing to finish; `TIME_EXPIRED` is the clock finishing for
    them. Both are terminal and both make the attempt immutable — they differ only in how it
    ended, which Phase 3C's report will want to say.

    Code asks `ACTIVE_ATTEMPT_STATUSES` / `TERMINAL_ATTEMPT_STATUSES` rather than comparing
    against a particular member, so adding a state later does not mean hunting for comparisons.
    """

    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"
    TIME_EXPIRED = "TIME_EXPIRED"


#: Statuses that mean the candidate may still answer.
ACTIVE_ATTEMPT_STATUSES = frozenset({AttemptStatus.IN_PROGRESS})

#: Statuses that mean the attempt is finished and frozen. Nothing moves an attempt out of these.
TERMINAL_ATTEMPT_STATUSES = frozenset({AttemptStatus.SUBMITTED, AttemptStatus.TIME_EXPIRED})


class AssessmentAttempt(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One candidate's sitting of one assessment: `Assessment → Assignment → Attempt`.

    The assignment is carried as a foreign key rather than re-derived, so an attempt can never
    outlive the assignment that authorised it (unassigning a candidate removes their attempt).

    **The clock lives here, not on the client** (FR-006). `expires_at` is written once by the
    server when the attempt is created, from `started_at + assessments.duration_minutes`, and is
    never recomputed and never accepted from a request. Every read and write of the attempt
    compares it against the server's own clock, so a candidate cannot buy time by changing their
    system clock, editing JavaScript state or replaying a request.

    No organization association, consistent with every other table in this build (TRD §6 wants one
    on tenant-sensitive tables; the deferral is recorded in `docs/PHASE-3-PLAN.md`).
    """

    __tablename__ = "assessment_attempts"
    __table_args__ = (
        UniqueConstraint(
            "assessment_id",
            "candidate_id",
            "attempt_number",
            name="uq_attempt_assessment_candidate_number",
        ),
        CheckConstraint("attempt_number > 0", name="ck_attempts_number_positive"),
        # At most one open attempt per candidate per assessment, enforced by the database rather
        # than by a read-then-write in the service: two concurrent "Start Exam" clicks race, and
        # only one of them can win here. A partial index (rather than a plain unique constraint)
        # is what lets Phase 3B add finished attempts alongside the open one.
        Index(
            "uq_attempt_one_active_per_candidate",
            "assessment_id",
            "candidate_id",
            unique=True,
            postgresql_where=text("status = 'IN_PROGRESS'"),
        ),
    )

    assessment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessment_assignments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: 1 for the first sitting. Checked against `assessments.max_attempts` before an attempt is made.
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    status: Mapped[AttemptStatus] = mapped_column(
        Enum(AttemptStatus, name="attempt_status", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=AttemptStatus.IN_PROGRESS,
        index=True,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    #: The deadline, fixed at creation. Server-written and server-read only.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: When the candidate chose to submit. Null for an attempt the clock ended.
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: When the attempt became immutable, however it ended. For an expiry this is `expires_at` —
    #: the moment the exam actually ended, not the later moment the server noticed.
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    assessment: Mapped["Assessment"] = relationship(lazy="joined")
    candidate: Mapped["User"] = relationship(lazy="joined")
    assignment: Mapped["AssessmentAssignment"] = relationship()
    answers: Mapped[list["AttemptAnswer"]] = relationship(
        back_populates="attempt",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    #: The score, once the attempt has been finalized and evaluated. `None` while it is running.
    result: Mapped["AttemptResult | None"] = relationship(
        back_populates="attempt",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
    )
    #: Present only when the attempt was proctored at the moment it started (Phase 4A). `None`
    #: means an unproctored attempt, not a missing row.
    proctoring_session: Mapped["ProctoringSession | None"] = relationship(
        back_populates="attempt",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
    )

    @property
    def is_active(self) -> bool:
        return self.status in ACTIVE_ATTEMPT_STATUSES

    @property
    def is_finalized(self) -> bool:
        return self.status in TERMINAL_ATTEMPT_STATUSES

    def has_expired_at(self, now: datetime) -> bool:
        """Whether the deadline has passed. `>=` so the final instant does not grant a free tick."""
        return now >= self.expires_at

    def remaining_seconds(self, now: datetime) -> int:
        """Whole seconds left, never negative.

        Truncated rather than rounded, so the display can only ever understate the time left —
        rounding up would hand back a second the server will not honour.
        """
        if self.is_finalized:
            return 0
        return max(0, int((self.expires_at - now).total_seconds()))

    def __repr__(self) -> str:
        return f"<AssessmentAttempt {self.assessment_id} #{self.attempt_number} {self.status}>"


class AttemptAnswer(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """What one candidate has recorded against one question of one attempt.

    A row exists as soon as the candidate selects something, and survives clearing the selection,
    because "answered, then cleared" and "never opened" are different states and evaluation tells
    them apart.

    Nothing here says whether the answer is right. Evaluation is Phase 3C and reads
    `question_options.is_correct`, which never leaves the server.
    """

    __tablename__ = "attempt_answers"
    __table_args__ = (
        UniqueConstraint("attempt_id", "question_id", name="uq_attempt_answer_attempt_question"),
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    attempt: Mapped[AssessmentAttempt] = relationship(back_populates="answers")
    question: Mapped["Question"] = relationship()
    selections: Mapped[list["AttemptAnswerOption"]] = relationship(
        back_populates="answer",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    @property
    def selected_option_ids(self) -> list[uuid.UUID]:
        return [selection.option_id for selection in self.selections]

    @property
    def is_answered(self) -> bool:
        return bool(self.selections)

    def __repr__(self) -> str:
        return f"<AttemptAnswer attempt={self.attempt_id} question={self.question_id}>"


class AttemptAnswerOption(UUIDPrimaryKeyMixin, Base):
    """One option the candidate selected.

    A row per selection rather than a JSON array or a delimited string: it is the same choice
    Phase 2A made for `question_options`, it gives the database a real foreign key (an option that
    belongs to another question cannot be stored at all), and it makes Phase 3C's "did the selected
    set equal the correct set?" an ordinary SQL comparison.
    """

    __tablename__ = "attempt_answer_options"
    __table_args__ = (UniqueConstraint("answer_id", "option_id", name="uq_attempt_answer_option"),)

    answer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("attempt_answers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    option_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("question_options.id", ondelete="CASCADE"), nullable=False, index=True
    )

    answer: Mapped[AttemptAnswer] = relationship(back_populates="selections")
    option: Mapped["QuestionOption"] = relationship()

    def __repr__(self) -> str:
        return f"<AttemptAnswerOption answer={self.answer_id} option={self.option_id}>"
