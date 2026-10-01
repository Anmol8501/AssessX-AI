"""The admin-facing risk state of one attempt (Phase 6A).

An explanation of observable signals for a human reviewer — never a verdict. There is deliberately
no field meaning "cheated", "rejected" or a probability of misconduct, and no candidate PII: the
admin views that show this already identify the candidate.
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventType
from app.services.risk.engine import RiskAssessment

Level = Literal["NORMAL", "LOW", "MEDIUM", "HIGH"]


class RiskContributor(BaseModel):
    event_type: ProctoringEventType
    tier: Literal["LOW", "MEDIUM", "HIGH"]
    occurrences: int
    total_seconds: float
    #: points before decay — its contribution to the peak
    points: float
    #: points still counting at `as_of`, after decay — its contribution to the current score
    current_points: float
    reason: str


class RiskWindow(BaseModel):
    started_at: datetime
    ended_at: datetime
    event_types: list[ProctoringEventType]
    categories: list[ProctoringEventCategory]
    signal_count: int
    bonus_points: float


class RiskExcluded(BaseModel):
    event_type: ProctoringEventType
    count: int
    reason: str


class AttemptRisk(BaseModel):
    attempt_id: uuid.UUID
    policy_version: str
    #: when this was calculated (server clock)
    calculated_at: datetime
    #: the moment the score describes: now for a live session, its end for a finished one
    as_of: datetime
    current_score: int
    level: Level
    peak_score: int
    peak_level: Level
    peak_at: datetime | None
    signal_count: int
    contributors: list[RiskContributor]
    correlated_windows: list[RiskWindow]
    correlated_window_count: int
    excluded: list[RiskExcluded]
    ai_unavailable_seconds: float
    interpretation: str
    limitations: str

    @classmethod
    def of(cls, attempt_id: uuid.UUID, assessment: RiskAssessment, calculated_at: datetime) -> "AttemptRisk":
        return cls(
            attempt_id=attempt_id,
            policy_version=assessment.policy_version,
            calculated_at=calculated_at,
            as_of=assessment.as_of,
            current_score=assessment.current_score,
            level=assessment.level,
            peak_score=assessment.peak_score,
            peak_level=assessment.peak_level,
            peak_at=assessment.peak_at,
            signal_count=assessment.signal_count,
            contributors=[RiskContributor(**vars(c)) for c in assessment.contributors],
            correlated_windows=[
                RiskWindow(
                    started_at=w.started_at,
                    ended_at=w.ended_at,
                    event_types=list(w.event_types),
                    categories=list(w.categories),
                    signal_count=w.signal_count,
                    bonus_points=round(w.bonus_points, 1),
                )
                for w in assessment.correlated_windows
            ],
            correlated_window_count=assessment.correlated_window_count,
            excluded=[RiskExcluded(**vars(x)) for x in assessment.excluded],
            ai_unavailable_seconds=assessment.ai_unavailable_seconds,
            interpretation=assessment.interpretation,
            limitations=assessment.limitations,
        )
