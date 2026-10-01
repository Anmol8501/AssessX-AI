"""Phase 6B: evidence — what the system observed, derived from the Phase 6A analysis.

Evidence explains what was observed. It does not determine intent, it does not prove anything, and it
does not replace human review (Detect → Correlate → Explain → **Evidence** → Human Review).

* **An evidence item is one Phase 6A signal**, so every item corresponds to real stored events. Its id
  is the id of the event that started it (stable and traceable); `source_event_ids` lists that event
  and, when one was recorded, the event that ended it.
* **An evidence episode is exactly one Phase 6A correlated window.** No correlation is invented here;
  its id is derived deterministically from its members.
* **Honest lifecycle.** `INSTANT` (a single event), `ONGOING` (live, not ended yet), `RESOLVED` (an end
  was recorded — with how it ended), `NO_END_RECORDED` (the session ended without an end event).
  `ended_at` and `duration_seconds` are only the *recorded* ones; nothing is estimated. What the risk
  score counted (up to now, or to the session's end) is given separately as `counted_seconds`.
* **Factual explanations** — the policy's description plus measured facts. No intent, no conclusion.

Pure and deterministic: the same events, `as_of` and policy give the same evidence.
"""

import base64
import binascii
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventType
from app.services.risk import policy
from app.services.risk.engine import Analysis, CorrelatedWindow, current_points
from app.services.risk.signals import RiskSignal

EVIDENCE_VERSION = "6B-v1"
#: Episode ids are UUID5s of their members under this fixed namespace (deterministic, not secret).
_EPISODE_NAMESPACE = uuid.UUID("6b0e7a1c-5d2f-4c8e-9a3b-1f2e3d4c5b6a")

Status = Literal["INSTANT", "ONGOING", "RESOLVED", "NO_END_RECORDED"]

_RESOLUTIONS = {
    "condition_cleared": "It ended when the observed condition cleared.",
    "measurement_unavailable": "It ended because the condition could no longer be measured.",
    "monitoring_stopped": "It ended when AI monitoring stopped.",
    "superseded": "The server closed it when a newer observation of the same kind started.",
    "session_ended": "The server closed it when the session ended.",
}
_CATEGORY_NAMES = {
    ProctoringEventCategory.AI_OBSERVATION: "AI observation",
    ProctoringEventCategory.WINDOW: "exam window",
    ProctoringEventCategory.INPUT: "restricted input",
    ProctoringEventCategory.DEVICE: "device",
    ProctoringEventCategory.DISPLAY: "display",
    ProctoringEventCategory.SYSTEM: "system",
    ProctoringEventCategory.SESSION: "session",
    ProctoringEventCategory.AI_HEALTH: "AI health",
}


@dataclass(frozen=True)
class EvidenceItem:
    evidence_id: str
    event_type: ProctoringEventType
    category: ProctoringEventCategory
    kind: str  # INSTANT | INTERVAL
    status: Status
    started_at: datetime
    ended_at: datetime | None  # only a recorded end
    duration_seconds: float | None  # only a recorded duration (0 for an instant)
    counted_seconds: float  # the duration the risk score counted
    resolution: str | None
    tier: policy.Tier
    points: float
    current_points: float
    episode_id: str | None
    source_event_ids: tuple[str, ...]
    explanation: str
    facts: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class EvidenceEpisode:
    episode_id: str
    started_at: datetime
    ended_at: datetime | None  # None unless every member has a recorded end
    status: Status
    member_ids: tuple[str, ...]
    event_types: tuple[ProctoringEventType, ...]
    categories: tuple[ProctoringEventCategory, ...]
    bonus_points: float
    explanation: str


@dataclass(frozen=True)
class EvidenceSet:
    policy_version: str
    evidence_version: str
    as_of: datetime
    session_live: bool
    items: list[EvidenceItem]
    episodes: dict[str, EvidenceEpisode]


def _seconds(value: float) -> str:
    if value < 60:
        return f"{value:.1f} s"
    minutes, seconds = divmod(round(value), 60)
    return f"{minutes} min {seconds:02d} s"


def _status(signal: RiskSignal, session_live: bool) -> Status:
    if signal.kind == "INSTANT":
        return "INSTANT"
    if signal.resolved:
        return "RESOLVED"
    return "ONGOING" if session_live else "NO_END_RECORDED"


def _explain(signal: RiskSignal, status: Status) -> str:
    parts = [policy.RULES[signal.event_type].reason]
    if isinstance(signal.facts.get("face_count"), int):
        parts.append(f"{signal.facts['face_count']} faces were detected.")
    if isinstance(signal.facts.get("direction"), str):
        parts.append(f"Direction: {signal.facts['direction']}.")
    if status == "RESOLVED":
        if signal.duration_seconds > 0:
            parts.append(f"It lasted {_seconds(signal.duration_seconds)}.")
        if signal.resolution in _RESOLUTIONS:
            parts.append(_RESOLUTIONS[signal.resolution])
    elif status == "ONGOING":
        parts.append(f"It is still ongoing ({_seconds(signal.duration_seconds)} so far).")
    elif status == "NO_END_RECORDED":
        parts.append(
            "No end was recorded before the session ended; the risk score counted it until then "
            f"({_seconds(signal.duration_seconds)})."
        )
    return " ".join(parts)


def _episode(window: CorrelatedWindow, members: list[EvidenceItem]) -> EvidenceEpisode:
    statuses = {m.status for m in members}
    status: Status = (
        "ONGOING"
        if "ONGOING" in statuses
        else "NO_END_RECORDED"
        if "NO_END_RECORDED" in statuses
        else "RESOLVED"
    )
    ends = [m.ended_at for m in members]
    names = ", ".join(_CATEGORY_NAMES.get(c, c.value.lower()) for c in window.categories)
    return EvidenceEpisode(
        episode_id=str(uuid.uuid5(_EPISODE_NAMESPACE, "|".join(window.member_ids))),
        started_at=window.started_at,
        ended_at=max(ends) if all(e is not None for e in ends) else None,  # type: ignore[type-var]
        status=status,
        member_ids=window.member_ids,
        event_types=window.event_types,
        categories=window.categories,
        bonus_points=round(window.bonus_points, 1),
        explanation=(
            f"{len(members)} signals of {len(window.categories)} kinds ({names}) occurred within "
            f"{policy.CORRELATION_WINDOW_SECONDS:.0f} s of each other. Grouping them in time does not "
            "establish a cause or an intent."
        ),
    )


def build_evidence(analysis: Analysis, *, session_live: bool) -> EvidenceSet:
    episode_of: dict[str, CorrelatedWindow] = {m: w for w in analysis.windows for m in w.member_ids}
    items: list[EvidenceItem] = []
    for signal in analysis.signals:
        status = _status(signal, session_live)
        window = episode_of.get(signal.signal_id)
        points = analysis.points[signal.signal_id]
        items.append(
            EvidenceItem(
                evidence_id=signal.signal_id,
                event_type=signal.event_type,
                category=signal.category,
                kind=signal.kind,
                status=status,
                started_at=signal.started_at,
                ended_at=signal.ended_at if status in ("INSTANT", "RESOLVED") else None,
                duration_seconds=round(signal.duration_seconds, 1)
                if status in ("INSTANT", "RESOLVED")
                else None,
                counted_seconds=round(signal.duration_seconds, 1),
                resolution=signal.resolution,
                tier=policy.RULES[signal.event_type].tier,
                points=round(points, 1),
                current_points=round(current_points(points, signal.ended_at, analysis.as_of), 1),
                episode_id=(
                    str(uuid.uuid5(_EPISODE_NAMESPACE, "|".join(window.member_ids)))
                    if window is not None
                    else None
                ),
                source_event_ids=tuple(i for i in (signal.signal_id, signal.end_event_id) if i),
                explanation=_explain(signal, status),
                facts=dict(signal.facts),
            )
        )
    items.sort(key=lambda i: (i.started_at, i.evidence_id))
    by_id = {i.evidence_id: i for i in items}
    episodes = {}
    for window in analysis.windows:
        episode = _episode(window, [by_id[m] for m in window.member_ids])
        episodes[episode.episode_id] = episode
    return EvidenceSet(policy.POLICY_VERSION, EVIDENCE_VERSION, analysis.as_of, session_live, items, episodes)


# -- pagination -----------------------------------------------------------------------------------

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class InvalidCursor(ValueError):
    pass


def encode_cursor(item: EvidenceItem) -> str:
    raw = json.dumps([item.started_at.isoformat(), item.evidence_id]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        started, evidence_id = json.loads(raw)
        return datetime.fromisoformat(started), str(uuid.UUID(evidence_id))
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError) as error:
        raise InvalidCursor("Invalid cursor.") from error


@dataclass(frozen=True)
class EvidencePage:
    items: list[EvidenceItem]
    total: int
    next_cursor: str | None


def page(
    evidence: EvidenceSet,
    *,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> EvidencePage:
    """Chronological page of items (by start), optionally within [since, until), after `cursor`.

    `total` is the number of items in the [since, until) range, whatever the cursor.
    """
    limit = max(1, min(limit, MAX_LIMIT))
    in_range = [
        i
        for i in evidence.items
        if (since is None or i.started_at >= since) and (until is None or i.started_at < until)
    ]
    remaining = in_range
    if cursor is not None:
        after = _decode_cursor(cursor)
        remaining = [i for i in in_range if (i.started_at, i.evidence_id) > after]
    chunk = remaining[:limit]
    return EvidencePage(
        items=chunk,
        total=len(in_range),
        next_cursor=encode_cursor(chunk[-1]) if len(remaining) > limit else None,
    )
