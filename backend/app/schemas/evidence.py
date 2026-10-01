"""The admin-facing evidence timeline of one attempt (Phase 6B).

Evidence explains what the system observed — it does not determine intent, prove anything, or
replace human review. No candidate PII, no verdict field, no raw media: only structured facts about
stored events, and the ids of those events so every item can be traced.
"""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

from app.models.proctoring_event import (
    ProctoringEventCategory,
    ProctoringEventSource,
    ProctoringEventType,
)
from app.services.risk.evidence import EvidenceEpisode, EvidenceItem

Status = Literal["INSTANT", "ONGOING", "RESOLVED", "NO_END_RECORDED"]

INTERPRETATION = (
    "Evidence describes what the proctoring system observed. It does not determine intent or prove "
    "that anything improper happened; a human reviewer decides."
)


class EvidenceItemOut(BaseModel):
    evidence_id: uuid.UUID
    event_type: ProctoringEventType
    category: ProctoringEventCategory
    kind: Literal["INSTANT", "INTERVAL"]
    status: Status
    started_at: datetime
    #: only a recorded end; null when none was recorded (never estimated)
    ended_at: datetime | None
    duration_seconds: float | None
    #: the duration the risk score counted (up to now, or to the session's end, if no end was recorded)
    counted_seconds: float
    resolution: str | None
    tier: Literal["LOW", "MEDIUM", "HIGH"]
    points: float
    current_points: float
    episode_id: uuid.UUID | None
    source_event_ids: list[uuid.UUID]
    explanation: str
    facts: dict[str, Any]

    @classmethod
    def of(cls, item: EvidenceItem) -> "EvidenceItemOut":
        return cls(**{**vars(item), "source_event_ids": list(item.source_event_ids)})


class EvidenceEpisodeOut(BaseModel):
    episode_id: uuid.UUID
    started_at: datetime
    ended_at: datetime | None
    status: Status
    member_ids: list[uuid.UUID]
    event_types: list[ProctoringEventType]
    categories: list[ProctoringEventCategory]
    bonus_points: float
    explanation: str

    @classmethod
    def of(cls, episode: EvidenceEpisode) -> "EvidenceEpisodeOut":
        return cls(
            **{
                **vars(episode),
                "member_ids": list(episode.member_ids),
                "event_types": list(episode.event_types),
                "categories": list(episode.categories),
            }
        )


class EvidenceTimeline(BaseModel):
    attempt_id: uuid.UUID
    policy_version: str
    evidence_version: str
    calculated_at: datetime
    as_of: datetime
    session_live: bool
    #: items in the requested time range (all pages)
    total: int
    items: list[EvidenceItemOut]
    #: the episodes the items on this page belong to
    episodes: list[EvidenceEpisodeOut]
    next_cursor: str | None
    interpretation: str = INTERPRETATION


class SourceEvent(BaseModel):
    """A stored event behind an evidence item, as recorded (its fields were allow-listed on arrival)."""

    event_id: uuid.UUID
    event_type: ProctoringEventType
    source: ProctoringEventSource
    recorded_at: datetime
    details: dict[str, Any]


class EvidenceDetail(BaseModel):
    attempt_id: uuid.UUID
    policy_version: str
    evidence_version: str
    item: EvidenceItemOut
    episode: EvidenceEpisodeOut | None
    source_events: list[SourceEvent]
    interpretation: str = INTERPRETATION
