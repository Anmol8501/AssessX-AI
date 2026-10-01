"""Phase 6C review shapes.

Requests are strict (`extra="forbid"`): a body that names a reviewer, an author, a status, a version
it did not read, or a timestamp is rejected — the server derives all of those. Responses separate
what the system generated (risk at decision time, labelled as its basis) from what a person wrote
(`authored_by: "HUMAN"`). People are identified by id and name only; no emails. Nothing here is
served to candidates.
"""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models.attempt import AttemptStatus
from app.models.audit_log import AuditAction, AuditLog
from app.models.proctoring import ProctoringSessionStatus
from app.models.review import EvidenceMark, ReviewDecision, ReviewOutcome
from app.models.user import User
from app.services.review import policy
from app.services.review.service import ReviewQueue, ReviewView

ReviewState = Literal["UNREVIEWED", "IN_REVIEW", "REVIEWED"]
Level = Literal["NORMAL", "LOW", "MEDIUM", "HIGH"]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=policy.MAX_TEXT)]


# -- requests ---------------------------------------------------------------------------------------


class NoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: Text


class MarkSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mark: EvidenceMark


class DecisionCreate(BaseModel):
    """Complete or revise. The outcome and a rationale are required; `expected_version` is the
    version the administrator was looking at, so a decision made on stale information is refused."""

    model_config = ConfigDict(extra="forbid")

    outcome: ReviewOutcome
    rationale: Text
    expected_version: int = Field(ge=1)


# -- responses --------------------------------------------------------------------------------------


class Person(BaseModel):
    id: uuid.UUID
    name: str

    @classmethod
    def of(cls, user: User | None) -> "Person | None":
        return cls(id=user.id, name=user.name) if user else None


class ReviewContext(BaseModel):
    """What the administrator is reviewing — the same identification the results table shows."""

    attempt_id: uuid.UUID
    attempt_number: int
    attempt_status: AttemptStatus
    started_at: datetime
    finalized_at: datetime | None
    assessment_id: uuid.UUID
    assessment_title: str
    candidate_id: uuid.UUID
    candidate_name: str
    candidate_roll_number: str | None
    proctoring_status: ProctoringSessionStatus


class NoteOut(BaseModel):
    note_id: uuid.UUID
    authored_by: Literal["HUMAN"] = "HUMAN"
    author: Person
    body: str
    created_at: datetime


class DecisionBasis(BaseModel):
    """The system-generated risk and evidence summary at the moment of the decision (a record of
    what the reviewer saw — not an input to the outcome)."""

    policy_version: str
    evidence_version: str
    as_of: datetime
    risk_score: int
    risk_level: Level
    peak_score: int
    peak_level: Level
    signal_count: int
    evidence_count: int
    episode_count: int


class DecisionOut(BaseModel):
    revision: int
    authored_by: Literal["HUMAN"] = "HUMAN"
    outcome: ReviewOutcome
    outcome_description: str
    rationale: str
    decided_by: Person
    decided_at: datetime
    basis: DecisionBasis

    @classmethod
    def of(cls, d: ReviewDecision) -> "DecisionOut":
        return cls(
            revision=d.revision,
            outcome=d.outcome,
            outcome_description=policy.OUTCOME_DESCRIPTIONS[d.outcome],
            rationale=d.rationale,
            decided_by=Person.of(d.decided_by),
            decided_at=d.decided_at,
            basis=DecisionBasis(
                policy_version=d.policy_version,
                evidence_version=d.evidence_version,
                as_of=d.risk_as_of,
                risk_score=d.risk_score,
                risk_level=d.risk_level,
                peak_score=d.peak_score,
                peak_level=d.peak_level,
                signal_count=d.signal_count,
                evidence_count=d.evidence_count,
                episode_count=d.episode_count,
            ),
        )


class MarkOut(BaseModel):
    evidence_id: uuid.UUID
    mark: EvidenceMark
    marked_by: Person
    marked_at: datetime


class HistoryEntry(BaseModel):
    action: AuditAction
    actor: Person
    occurred_at: datetime
    details: dict[str, Any]

    @classmethod
    def of(cls, row: AuditLog) -> "HistoryEntry":
        return cls(
            action=row.action, actor=Person.of(row.actor), occurred_at=row.occurred_at, details=row.details
        )


class OutcomeOption(BaseModel):
    outcome: ReviewOutcome
    description: str


class AttemptReviewOut(BaseModel):
    context: ReviewContext
    status: ReviewState
    version: int | None
    outcome: ReviewOutcome | None
    started_by: Person | None
    started_at: datetime | None
    completed_by: Person | None
    completed_at: datetime | None
    #: An outcome can be recorded only once the attempt has finished (its evidence is final).
    can_complete: bool
    notes: list[NoteOut]
    #: Newest revision first. The first entry is the current outcome.
    decisions: list[DecisionOut]
    marks: list[MarkOut]
    history: list[HistoryEntry]
    outcome_options: list[OutcomeOption]
    interpretation: str = policy.INTERPRETATION

    @classmethod
    def of(cls, v: ReviewView) -> "AttemptReviewOut":
        a, r = v.attempt, v.review
        return cls(
            context=ReviewContext(
                attempt_id=a.id,
                attempt_number=a.attempt_number,
                attempt_status=a.status,
                started_at=a.started_at,
                finalized_at=a.finalized_at,
                assessment_id=a.assessment_id,
                assessment_title=a.assessment.title,
                candidate_id=a.candidate_id,
                candidate_name=a.candidate.name,
                candidate_roll_number=a.candidate.roll_number,
                proctoring_status=v.session.status,
            ),
            status=r.status.value if r else "UNREVIEWED",
            version=r.version if r else None,
            outcome=r.outcome if r else None,
            started_by=Person.of(r.started_by) if r else None,
            started_at=r.started_at if r else None,
            completed_by=Person.of(r.completed_by) if r else None,
            completed_at=r.completed_at if r else None,
            can_complete=a.is_finalized,
            notes=[
                NoteOut(note_id=n.id, author=Person.of(n.author), body=n.body, created_at=n.created_at)
                for n in v.notes
            ],
            decisions=[DecisionOut.of(d) for d in v.decisions],
            marks=[
                MarkOut(
                    evidence_id=m.evidence_event_id,
                    mark=m.mark,
                    marked_by=Person.of(m.author),
                    marked_at=m.created_at,
                )
                for m in v.marks
            ],
            history=[HistoryEntry.of(h) for h in v.history],
            outcome_options=[
                OutcomeOption(outcome=o, description=d) for o, d in policy.OUTCOME_DESCRIPTIONS.items()
            ],
        )


class QueueItem(BaseModel):
    attempt_id: uuid.UUID
    attempt_number: int
    attempt_status: AttemptStatus
    started_at: datetime
    finalized_at: datetime | None
    assessment_id: uuid.UUID
    assessment_title: str
    candidate_name: str
    candidate_roll_number: str | None
    #: System-generated (6A), current. A signal for prioritising review — not an outcome.
    risk_level: Level
    risk_score: int
    peak_level: Level
    #: Human-authored (6C).
    review_status: ReviewState
    outcome: ReviewOutcome | None
    reviewed_by: Person | None
    reviewed_at: datetime | None


class QueueCounts(BaseModel):
    UNREVIEWED: int
    IN_REVIEW: int
    REVIEWED: int


class ReviewQueueOut(BaseModel):
    calculated_at: datetime
    counts: QueueCounts
    items: list[QueueItem]
    next_cursor: str | None
    interpretation: str = policy.INTERPRETATION

    @classmethod
    def of(cls, q: ReviewQueue, calculated_at: datetime) -> "ReviewQueueOut":
        items = []
        for row in q.rows:
            a, r, risk = row.attempt, row.review, q.risks[row.attempt.id]
            items.append(
                QueueItem(
                    attempt_id=a.id,
                    attempt_number=a.attempt_number,
                    attempt_status=a.status,
                    started_at=a.started_at,
                    finalized_at=a.finalized_at,
                    assessment_id=a.assessment_id,
                    assessment_title=a.assessment.title,
                    candidate_name=a.candidate.name,
                    candidate_roll_number=a.candidate.roll_number,
                    risk_level=risk.level,
                    risk_score=risk.current_score,
                    peak_level=risk.peak_level,
                    review_status=r.status.value if r else "UNREVIEWED",
                    outcome=r.outcome if r else None,
                    reviewed_by=Person.of(r.completed_by) if r else None,
                    reviewed_at=r.completed_at if r else None,
                )
            )
        return cls(
            calculated_at=calculated_at,
            counts=QueueCounts(**q.counts),
            items=items,
            next_cursor=q.next_cursor,
        )
