"""Phase 7A — the interview engine: configuration, questions, assignment, sessions and answers.

An interview is its own entity, created, published and assigned like an assessment but with its own
tables: it has no marks, no answer key and no proctoring. **Nothing here evaluates an answer** — answers
are stored as the candidate wrote them, for Phase 7B to evaluate and Phase 7C to report.

The engine is transport-independent. A session, its questions and its answers do not assume how the
candidate answered (text today); a voice or live video interview can attach to the same session later.
"""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.user import User


class InterviewType(enum.StrEnum):
    TECHNICAL = "TECHNICAL"
    BEHAVIORAL = "BEHAVIORAL"
    MIXED = "MIXED"


class InterviewFormat(enum.StrEnum):
    """AI: the server-run text interview (7A–7C). LIVE: a live video call with a human interviewer (7D),
    where the question bank is the interviewer's guide and nothing is evaluated by AI."""

    AI = "AI"
    LIVE = "LIVE"


class InterviewDifficulty(enum.StrEnum):
    """Ordered: an interview's difficulty is a ceiling for the questions it may ask."""

    EASY = "EASY"
    MEDIUM = "MEDIUM"
    HARD = "HARD"


DIFFICULTY_RANK: dict[InterviewDifficulty, int] = {
    InterviewDifficulty.EASY: 1,
    InterviewDifficulty.MEDIUM: 2,
    InterviewDifficulty.HARD: 3,
}


class InterviewStatus(enum.StrEnum):
    """DRAFT (editable) → PUBLISHED (locked; assignable). Unpublishing needs no one assigned."""

    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"


class QuestionKind(enum.StrEnum):
    PRIMARY = "PRIMARY"
    FOLLOW_UP = "FOLLOW_UP"


class InterviewQuestionType(enum.StrEnum):
    TECHNICAL = "TECHNICAL"
    BEHAVIORAL = "BEHAVIORAL"
    CONCEPTUAL = "CONCEPTUAL"
    SCENARIO = "SCENARIO"


class InterviewSessionStatus(enum.StrEnum):
    """A session exists only once started (NOT_STARTED is the absence of a row). ACTIVE → COMPLETED,
    one direction. There is no PAUSED state: nothing stops the server's clock."""

    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"


class CompletionReason(enum.StrEnum):
    ALL_ANSWERED = "ALL_ANSWERED"
    TIME_EXPIRED = "TIME_EXPIRED"
    ENDED_BY_CANDIDATE = "ENDED_BY_CANDIDATE"


class SelectedBy(enum.StrEnum):
    """How a session item came to be asked (Phase 7B): the fixed plan (7A order, no evaluation
    involved), the adaptive policy acting on a validated evaluation, or the fallback when no
    evaluation signal was available in time. Recorded so every question's origin is auditable."""

    PLAN = "PLAN"
    ADAPTIVE = "ADAPTIVE"
    FALLBACK = "FALLBACK"


class ItemState(enum.StrEnum):
    """A session item is created when its question is presented, and answered at most once."""

    PRESENTED = "PRESENTED"
    ANSWERED = "ANSWERED"


def _in(column: str, values: type[enum.StrEnum]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v.value}'" for v in values) + ")"


def _rank(column: str) -> str:
    """SQL for a difficulty's order, so the database can compare levels."""
    return f"(CASE {column} WHEN 'EASY' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END)"


def _enum(kind: type[enum.StrEnum], name: str, length: int = 20) -> Enum:
    return Enum(kind, name=name, native_enum=False, length=length, validate_strings=True)


class Interview(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """An interview an administrator configures (Phase 7A).

    `difficulty` is a ceiling: questions at or below it are eligible. `max_follow_ups` is the
    interview-wide follow-up budget; each primary question has at most one follow-up. Configuration is
    the server's: once published, the interview and its questions are locked, so every session sees
    the same paper.
    """

    __tablename__ = "interviews"
    __table_args__ = (
        CheckConstraint(_in("interview_type", InterviewType), name="ck_interviews_type"),
        CheckConstraint(_in("difficulty", InterviewDifficulty), name="ck_interviews_difficulty"),
        CheckConstraint(_in("status", InterviewStatus), name="ck_interviews_status"),
        CheckConstraint("duration_minutes BETWEEN 5 AND 180", name="ck_interviews_duration"),
        CheckConstraint("question_count BETWEEN 1 AND 30", name="ck_interviews_question_count"),
        CheckConstraint(
            "max_follow_ups >= 0 AND max_follow_ups <= question_count", name="ck_interviews_max_follow_ups"
        ),
        CheckConstraint("jsonb_typeof(topics) = 'array'", name="ck_interviews_topics_array"),
        CheckConstraint(
            "(status = 'PUBLISHED') = (published_at IS NOT NULL)", name="ck_interviews_published_iff_at"
        ),
        CheckConstraint(_in("format", InterviewFormat), name="ck_interviews_format"),
        CheckConstraint(_in("min_difficulty", InterviewDifficulty), name="ck_interviews_min_difficulty"),
        CheckConstraint(
            _in("starting_difficulty", InterviewDifficulty), name="ck_interviews_starting_difficulty"
        ),
        # Phase 7B: min ≤ starting ≤ difficulty (the maximum).
        CheckConstraint(
            f"{_rank('min_difficulty')} <= {_rank('starting_difficulty')} "
            f"AND {_rank('starting_difficulty')} <= {_rank('difficulty')}",
            name="ck_interviews_difficulty_bounds",
        ),
    )

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    interview_type: Mapped[InterviewType] = mapped_column(
        _enum(InterviewType, "interview_type"), nullable=False
    )
    format: Mapped[InterviewFormat] = mapped_column(
        _enum(InterviewFormat, "interview_format"),
        nullable=False,
        default=InterviewFormat.AI,
        server_default=InterviewFormat.AI.value,
    )
    difficulty: Mapped[InterviewDifficulty] = mapped_column(
        _enum(InterviewDifficulty, "interview_difficulty"), nullable=False
    )
    #: The approved topics. A question's topic must be one of them.
    topics: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    #: How many primary questions a session asks.
    question_count: Mapped[int] = mapped_column(Integer, nullable=False)
    follow_ups_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    #: The most follow-ups one session may ask (each primary has at most one).
    max_follow_ups: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[InterviewStatus] = mapped_column(
        _enum(InterviewStatus, "interview_status"), nullable=False, default=InterviewStatus.DRAFT, index=True
    )
    #: Phase 7B. Off: the 7A plan (questions at or below `difficulty`, authored order). On: each next
    #: primary question is chosen at a difficulty the adaptive policy sets, between `min_difficulty`
    #: and `difficulty` (the maximum), starting at `starting_difficulty`, one level per step.
    adaptive_difficulty: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    min_difficulty: Mapped[InterviewDifficulty] = mapped_column(
        _enum(InterviewDifficulty, "interview_difficulty"),
        nullable=False,
        default=InterviewDifficulty.EASY,
        server_default="EASY",
    )
    starting_difficulty: Mapped[InterviewDifficulty] = mapped_column(
        _enum(InterviewDifficulty, "interview_difficulty"), nullable=False
    )
    created_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped["User"] = relationship(lazy="joined")
    questions: Mapped[list["InterviewQuestion"]] = relationship(
        back_populates="interview",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by=lambda: [InterviewQuestion.position, InterviewQuestion.id],
    )
    assignments: Mapped[list["InterviewAssignment"]] = relationship(
        back_populates="interview", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def is_published(self) -> bool:
        return self.status is InterviewStatus.PUBLISHED

    def __repr__(self) -> str:
        return f"<Interview {self.title!r} {self.status}>"


class InterviewQuestion(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One question of an interview's controlled bank — administrator-authored, never generated.

    A FOLLOW_UP belongs to exactly one PRIMARY question of the **same** interview (a composite foreign
    key), and a primary has at most one follow-up (`parent_question_id` is unique). `expected_concepts`
    and `competency` are metadata for future evaluation (Phase 7B): they are never sent to candidates,
    and Phase 7A does not check answers against them. `context` is part of the question as presented.
    """

    __tablename__ = "interview_questions"
    __table_args__ = (
        UniqueConstraint("id", "interview_id", name="uq_interview_questions_id_interview"),
        UniqueConstraint("parent_question_id", name="uq_interview_questions_one_follow_up"),
        ForeignKeyConstraint(
            ["parent_question_id", "interview_id"],
            ["interview_questions.id", "interview_questions.interview_id"],
            ondelete="CASCADE",
            name="fk_interview_questions_parent_same_interview",
        ),
        CheckConstraint(_in("kind", QuestionKind), name="ck_interview_questions_kind"),
        CheckConstraint(_in("question_type", InterviewQuestionType), name="ck_interview_questions_type"),
        CheckConstraint(_in("difficulty", InterviewDifficulty), name="ck_interview_questions_difficulty"),
        CheckConstraint(
            "(kind = 'FOLLOW_UP') = (parent_question_id IS NOT NULL)",
            name="ck_interview_questions_follow_up_parent",
        ),
        CheckConstraint("char_length(text) BETWEEN 1 AND 2000", name="ck_interview_questions_text_length"),
        CheckConstraint("position >= 0", name="ck_interview_questions_position"),
        CheckConstraint(
            "time_limit_seconds IS NULL OR time_limit_seconds BETWEEN 10 AND 3600",
            name="ck_interview_questions_time_limit",
        ),
        CheckConstraint(
            "jsonb_typeof(expected_concepts) = 'array'", name="ck_interview_questions_concepts_array"
        ),
        Index("ix_interview_questions_interview_position", "interview_id", "position"),
    )

    interview_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[QuestionKind] = mapped_column(_enum(QuestionKind, "interview_question_kind"), nullable=False)
    parent_question_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[InterviewQuestionType] = mapped_column(
        _enum(InterviewQuestionType, "interview_question_type"), nullable=False
    )
    topic: Mapped[str] = mapped_column(String(60), nullable=False)
    difficulty: Mapped[InterviewDifficulty] = mapped_column(
        _enum(InterviewDifficulty, "interview_difficulty"), nullable=False
    )
    #: Admin-only: concepts (technical) or response dimensions (behavioral) for future evaluation.
    expected_concepts: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    #: Admin-only: the competency a behavioral question explores.
    competency: Mapped[str | None] = mapped_column(String(120), nullable=True)
    #: Shown with the question: a scenario's background.
    context: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Advisory, shown to the candidate. Not enforced in 7A — the interview deadline is.
    time_limit_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    interview: Mapped[Interview] = relationship(back_populates="questions")

    def __repr__(self) -> str:
        return f"<InterviewQuestion {self.kind} {self.topic!r}>"


class InterviewAssignment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A candidate who may take an interview. Only published interviews are assigned."""

    __tablename__ = "interview_assignments"
    __table_args__ = (UniqueConstraint("interview_id", "candidate_id", name="uq_interview_assignment"),)

    interview_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assigned_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    interview: Mapped[Interview] = relationship(back_populates="assignments", lazy="joined")
    candidate: Mapped["User"] = relationship(foreign_keys=[candidate_id], lazy="joined")


class InterviewSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One candidate's sitting of one interview. The server owns all of it.

    `expires_at` is fixed at start from the interview's duration and never recomputed. `question_plan`
    is the ordered primary question ids chosen at start, so a refresh, a reconnect or a later edit can
    never change the paper. One session per candidate per interview: there is no restart.
    """

    __tablename__ = "interview_sessions"
    __table_args__ = (
        UniqueConstraint("interview_id", "candidate_id", name="uq_interview_session_candidate"),
        CheckConstraint(_in("status", InterviewSessionStatus), name="ck_interview_sessions_status"),
        CheckConstraint(
            "completion_reason IS NULL OR " + _in("completion_reason", CompletionReason),
            name="ck_interview_sessions_reason",
        ),
        CheckConstraint(
            "(status = 'COMPLETED') = (completed_at IS NOT NULL AND completion_reason IS NOT NULL)",
            name="ck_interview_sessions_completed_iff",
        ),
        CheckConstraint("expires_at > started_at", name="ck_interview_sessions_expiry_after_start"),
        CheckConstraint("follow_ups_used >= 0", name="ck_interview_sessions_follow_ups"),
        CheckConstraint(
            _in("current_difficulty", InterviewDifficulty), name="ck_interview_sessions_difficulty"
        ),
        CheckConstraint("difficulty_changes >= 0", name="ck_interview_sessions_difficulty_changes"),
        CheckConstraint("jsonb_typeof(question_plan) = 'array'", name="ck_interview_sessions_plan_array"),
        Index("ix_interview_sessions_interview_status", "interview_id", "status"),
    )

    interview_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interviews.id", ondelete="CASCADE"), nullable=False
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assignment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_assignments.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    status: Mapped[InterviewSessionStatus] = mapped_column(
        _enum(InterviewSessionStatus, "interview_session_status"),
        nullable=False,
        default=InterviewSessionStatus.ACTIVE,
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completion_reason: Mapped[CompletionReason | None] = mapped_column(
        _enum(CompletionReason, "interview_completion_reason"), nullable=True
    )
    question_plan: Mapped[list[str]] = mapped_column(JSONB, nullable=False)
    follow_ups_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Phase 7B: the difficulty the next primary question is chosen at (informational when not adaptive).
    current_difficulty: Mapped[InterviewDifficulty] = mapped_column(
        _enum(InterviewDifficulty, "interview_difficulty"), nullable=False
    )
    #: How many times the adaptive policy changed the difficulty (one level each).
    difficulty_changes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    interview: Mapped[Interview] = relationship(lazy="joined")
    items: Mapped[list["InterviewSessionItem"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="InterviewSessionItem.sequence",
    )

    @property
    def is_active(self) -> bool:
        return self.status is InterviewSessionStatus.ACTIVE

    def has_expired_at(self, now: datetime) -> bool:
        """`>=`, as for exam attempts: the final instant is not a free tick."""
        return now >= self.expires_at

    def remaining_seconds(self, now: datetime) -> int:
        """Whole seconds left, truncated — the display can only understate the time."""
        if not self.is_active:
            return 0
        return max(0, int((self.expires_at - now).total_seconds()))


class InterviewSessionItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One question as presented in a session, and the candidate's answer to it.

    Created when the question is presented; the answer is written once and never changed. At most
    one item per session is PRESENTED (a partial unique index), and a question appears in a session at
    most once.
    """

    __tablename__ = "interview_session_items"
    __table_args__ = (
        UniqueConstraint("session_id", "sequence", name="uq_interview_items_sequence"),
        UniqueConstraint("session_id", "question_id", name="uq_interview_items_question_once"),
        Index(
            "uq_interview_items_one_presented",
            "session_id",
            unique=True,
            postgresql_where=text("state = 'PRESENTED'"),
        ),
        CheckConstraint(_in("kind", QuestionKind), name="ck_interview_items_kind"),
        CheckConstraint(_in("state", ItemState), name="ck_interview_items_state"),
        CheckConstraint(_in("selected_by", SelectedBy), name="ck_interview_items_selected_by"),
        CheckConstraint("sequence >= 1", name="ck_interview_items_sequence"),
        CheckConstraint(
            "(kind = 'FOLLOW_UP') = (parent_item_id IS NOT NULL)", name="ck_interview_items_follow_up_parent"
        ),
        CheckConstraint(
            "(state = 'ANSWERED') = (answer_text IS NOT NULL AND answered_at IS NOT NULL)",
            name="ck_interview_items_answered_iff",
        ),
        CheckConstraint(
            "answer_text IS NULL OR char_length(answer_text) BETWEEN 1 AND 10000",
            name="ck_interview_items_answer_length",
        ),
        CheckConstraint(
            "answered_at IS NULL OR answered_at >= presented_at", name="ck_interview_items_answer_order"
        ),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_questions.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[QuestionKind] = mapped_column(_enum(QuestionKind, "interview_question_kind"), nullable=False)
    parent_item_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("interview_session_items.id", ondelete="CASCADE"), nullable=True
    )
    state: Mapped[ItemState] = mapped_column(
        _enum(ItemState, "interview_item_state"), nullable=False, default=ItemState.PRESENTED
    )
    selected_by: Mapped[SelectedBy] = mapped_column(
        _enum(SelectedBy, "interview_item_selected_by"),
        nullable=False,
        default=SelectedBy.PLAN,
        server_default=SelectedBy.PLAN.value,
    )
    presented_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped[InterviewSession] = relationship(back_populates="items")
    question: Mapped[InterviewQuestion] = relationship(lazy="joined")
