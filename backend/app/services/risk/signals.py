"""Phase 6A step 1: normalise an attempt's stored events into risk signals.

A *signal* is one observable condition with a start, an end and a duration, built only from the
server's `recorded_at` times:

* an AI episode (Phase 5C) — its `started` row to its `resolved` row (same `episode_id`);
* a Phase 4 pair — FOCUS_LOST → FOCUS_REGAINED, FULLSCREEN_EXIT → RESTORED/ENTER, device
  DISCONNECTED → RECONNECTED; the client's own `duration_ms` is never used;
* an instant event — a blocked copy/paste, a display change… (duration 0).

A condition still open when the evaluation happens ends at the session's end, or at `as_of` for a
live session — for *scoring*; `resolved` is False and `end_event_id` None, so the evidence layer
(Phase 6B) can say honestly that no end was recorded. Duplicates collapse: a second start while one
is open, a resolution with no open start, or a repeated episode id are ignored. Events of excluded
types are counted for the explanation but produce no signal. Pure and deterministic: the same events
give the same signals, whatever order they are passed in.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventType
from app.services.risk import policy

E = ProctoringEventType

#: The only facts carried into a signal — small, factual, no identifiers or free text.
_FACTS = ("face_count", "direction")


@dataclass(frozen=True)
class EventRecord:
    """The columns of a stored event the risk engine reads."""

    id: uuid.UUID
    event_type: ProctoringEventType
    category: ProctoringEventCategory
    details: dict[str, Any]
    recorded_at: datetime


@dataclass(frozen=True)
class RiskSignal:
    signal_id: str  # the id of the event that started it
    event_type: ProctoringEventType
    category: ProctoringEventCategory
    started_at: datetime
    ended_at: datetime
    resolved: bool
    facts: dict[str, Any] = field(default_factory=dict)
    #: "INSTANT" (a single event) or "INTERVAL" (an episode or a start/end pair). Phase 6B.
    kind: str = "INTERVAL"
    #: The event that ended it, when one was recorded (None: instant, or no end recorded). Phase 6B.
    end_event_id: str | None = None
    #: How an AI episode ended, as the server recorded it (e.g. `condition_cleared`). Phase 6B.
    resolution: str | None = None

    @property
    def duration_seconds(self) -> float:
        return max(0.0, (self.ended_at - self.started_at).total_seconds())


@dataclass(frozen=True)
class Normalised:
    signals: list[RiskSignal]
    #: event type → how many rows were not turned into signals because the type never contributes
    excluded_counts: dict[ProctoringEventType, int]
    #: seconds during which the on-device AI reported it was not measuring (coverage, not risk)
    ai_unavailable_seconds: float


def _ordered(events: Iterable[EventRecord]) -> list[EventRecord]:
    return sorted(events, key=lambda e: (e.recorded_at, str(e.id)))


def _facts(details: dict[str, Any]) -> dict[str, Any]:
    return {k: details[k] for k in _FACTS if k in details}


def build_signals(
    events: Iterable[EventRecord], *, as_of: datetime, session_end: datetime | None
) -> Normalised:
    horizon = min(as_of, session_end) if session_end else as_of
    ordered = [e for e in _ordered(events) if e.recorded_at <= horizon]
    signals: list[RiskSignal] = []
    excluded: dict[ProctoringEventType, int] = {}

    # AI episodes: started → resolved by episode id (first start wins; resolutions of unknown ids ignored).
    episodes: dict[str, EventRecord] = {}
    episode_order: list[str] = []
    episode_ends: dict[str, EventRecord] = {}
    # Phase 4 pairs: the currently open start per pair type.
    open_pairs: dict[ProctoringEventType, EventRecord] = {}
    pair_signals: list[RiskSignal] = []
    # AI health: periods in which it reported it was not measuring.
    ai_down_since: datetime | None = None
    ai_unavailable = 0.0

    for event in ordered:
        kind = event.event_type
        if kind is E.AI_STATUS:
            status = event.details.get("ai_status")
            if status in policy.AI_MEASURING or status == "STOPPED":
                if ai_down_since is not None:
                    ai_unavailable += (event.recorded_at - ai_down_since).total_seconds()
                    ai_down_since = None
            elif ai_down_since is None:
                ai_down_since = event.recorded_at
        if kind in policy.EXCLUDED:
            excluded[kind] = excluded.get(kind, 0) + 1
            continue
        if event.category is ProctoringEventCategory.AI_OBSERVATION:
            episode_id = event.details.get("episode_id")
            if not isinstance(episode_id, str):
                continue  # malformed — nothing to pair
            if event.details.get("phase") == "started":
                if episode_id not in episodes:
                    episodes[episode_id] = event
                    episode_order.append(episode_id)
            elif episode_id in episodes and episode_id not in episode_ends:
                episode_ends[episode_id] = event
            continue
        if kind in policy.PAIR_ENDS:
            open_pairs.setdefault(kind, event)  # a second start while one is open is a duplicate
            continue
        if kind in policy.END_MARKERS:
            for start_kind, ends in policy.PAIR_ENDS.items():
                if kind in ends and start_kind in open_pairs:
                    start = open_pairs.pop(start_kind)
                    pair_signals.append(
                        RiskSignal(
                            str(start.id),
                            start_kind,
                            start.category,
                            start.recorded_at,
                            event.recorded_at,
                            True,
                            end_event_id=str(event.id),
                        )
                    )
            continue
        if kind in policy.RULES:  # instant
            signals.append(
                RiskSignal(
                    str(event.id),
                    kind,
                    event.category,
                    event.recorded_at,
                    event.recorded_at,
                    True,
                    _facts(event.details),
                    kind="INSTANT",
                )
            )

    for episode_id in episode_order:
        start = episodes[episode_id]
        end = episode_ends.get(episode_id)
        resolution = end.details.get("resolution") if end is not None else None
        signals.append(
            RiskSignal(
                str(start.id),
                start.event_type,
                start.category,
                start.recorded_at,
                end.recorded_at if end is not None else horizon,
                end is not None,
                _facts(start.details),
                end_event_id=str(end.id) if end is not None else None,
                resolution=resolution if isinstance(resolution, str) else None,
            )
        )
    signals.extend(pair_signals)
    for start_kind, start in open_pairs.items():
        signals.append(
            RiskSignal(str(start.id), start_kind, start.category, start.recorded_at, horizon, False)
        )
    if ai_down_since is not None:
        ai_unavailable += (horizon - ai_down_since).total_seconds()

    signals.sort(key=lambda s: (s.started_at, s.ended_at, s.signal_id))
    return Normalised(signals, dict(sorted(excluded.items())), round(ai_unavailable, 3))
