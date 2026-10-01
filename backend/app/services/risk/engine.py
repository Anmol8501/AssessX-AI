"""Phase 6A risk engine: signals → contributions → correlation → decay → an explainable risk state.

Deterministic and pure — no database, no clock, no randomness: the same events, the same `as_of`
and the same policy always give the same result. It never states that anyone cheated; the output is
a summary of observable signals for a human reviewer (`policy.INTERPRETATION`).

1. **Contribution** — each signal's points: `min(max_points, base + per_second × duration)`
   (policy.RULES). Server timestamps only.
2. **Correlation** — signals are swept in time order; a signal joins the current window when it
   starts within `CORRELATION_WINDOW_SECONDS` of the window's latest end. A window spanning at least
   `CORRELATION_MIN_CATEGORIES` event categories is *correlated* and adds a bounded bonus
   (`CORRELATION_BONUS_FRACTION` of its members' points, at most `CORRELATION_BONUS_CAP`). Each signal
   belongs to exactly one window, so nothing is counted twice.
3. **Decay** — every contribution (and bonus) takes effect when its signal (window) ended and halves
   every `HALF_LIFE_SECONDS` afterwards, so an early incident does not dominate the whole exam.
4. **Aggregation** — the score at time t is the sum of decayed contributions, capped at 100 and
   mapped to the PRD bands. Because contributions decay exponentially, the score is updated in one
   pass (`S(t2) = S(t1)·0.5^((t2−t1)/h) + new`), which gives both the score at `as_of` and the **peak**
   over the attempt in O(n) — no rescans.
"""

import math
from dataclasses import dataclass
from datetime import datetime

from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventType
from app.services.risk import policy
from app.services.risk.signals import EventRecord, RiskSignal, build_signals

#: At most this many correlated windows are listed (the most significant); the total is always given.
MAX_LISTED_WINDOWS = 20


@dataclass(frozen=True)
class Contributor:
    event_type: ProctoringEventType
    tier: policy.Tier
    occurrences: int
    total_seconds: float
    points: float  # before decay
    current_points: float  # after decay at `as_of`
    reason: str


@dataclass(frozen=True)
class CorrelatedWindow:
    started_at: datetime
    ended_at: datetime
    event_types: tuple[ProctoringEventType, ...]
    categories: tuple[ProctoringEventCategory, ...]
    signal_count: int
    bonus_points: float
    #: The signals in this window (their start-event ids), in time order. Phase 6B.
    member_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Analysis:
    """The per-signal detail behind a `RiskAssessment` — what the evidence layer (Phase 6B) reads."""

    as_of: datetime
    signals: list[RiskSignal]
    #: signal id → points before decay
    points: dict[str, float]
    windows: list[CorrelatedWindow]
    excluded_counts: dict[ProctoringEventType, int]
    ai_unavailable_seconds: float


@dataclass(frozen=True)
class Excluded:
    event_type: ProctoringEventType
    count: int
    reason: str


@dataclass(frozen=True)
class RiskAssessment:
    policy_version: str
    as_of: datetime
    current_score: int
    level: policy.Level
    peak_score: int
    peak_level: policy.Level
    peak_at: datetime | None
    signal_count: int
    contributors: list[Contributor]
    correlated_windows: list[CorrelatedWindow]
    correlated_window_count: int
    excluded: list[Excluded]
    ai_unavailable_seconds: float
    interpretation: str = policy.INTERPRETATION
    limitations: str = policy.LIMITATIONS


def round_half_up(value: float) -> int:
    return int(math.floor(value + 0.5))


def _points(signal: RiskSignal) -> float:
    rule = policy.RULES[signal.event_type]
    return min(rule.max_points, rule.base_points + rule.points_per_second * signal.duration_seconds)


def _decay(age_seconds: float) -> float:
    return 0.5 ** (max(0.0, age_seconds) / policy.HALF_LIFE_SECONDS)


def _windows(signals: list[RiskSignal], points: dict[str, float]) -> list[CorrelatedWindow]:
    windows: list[CorrelatedWindow] = []
    group: list[RiskSignal] = []
    group_end: datetime | None = None

    def close() -> None:
        categories = sorted({s.category for s in group})
        if len(group) >= 2 and len(categories) >= policy.CORRELATION_MIN_CATEGORIES:
            bonus = min(
                policy.CORRELATION_BONUS_CAP,
                policy.CORRELATION_BONUS_FRACTION * sum(points[s.signal_id] for s in group),
            )
            windows.append(
                CorrelatedWindow(
                    started_at=group[0].started_at,
                    ended_at=max(s.ended_at for s in group),
                    event_types=tuple(sorted({s.event_type for s in group})),
                    categories=tuple(categories),
                    signal_count=len(group),
                    bonus_points=bonus,
                    member_ids=tuple(s.signal_id for s in group),
                )
            )

    for signal in signals:  # already sorted by (start, end, id)
        if (
            group_end is not None
            and (signal.started_at - group_end).total_seconds() <= policy.CORRELATION_WINDOW_SECONDS
        ):
            group.append(signal)
            group_end = max(group_end, signal.ended_at)
        else:
            if group:
                close()
            group, group_end = [signal], signal.ended_at
    if group:
        close()
    return windows


def analyze(events: list[EventRecord], *, as_of: datetime, session_end: datetime | None) -> Analysis:
    """Signals, their points and the correlated windows — the shared first half of the engine."""
    effective_as_of = min(as_of, session_end) if session_end else as_of
    normalised = build_signals(events, as_of=effective_as_of, session_end=session_end)
    signals = [s for s in normalised.signals if s.event_type in policy.RULES]
    points = {s.signal_id: _points(s) for s in signals}
    return Analysis(
        as_of=effective_as_of,
        signals=signals,
        points=points,
        windows=_windows(signals, points),
        excluded_counts=normalised.excluded_counts,
        ai_unavailable_seconds=normalised.ai_unavailable_seconds,
    )


def current_points(points: float, ended_at: datetime, as_of: datetime) -> float:
    """A contribution's points still counting at `as_of`, after decay."""
    return points * _decay((as_of - ended_at).total_seconds())


def evaluate(events: list[EventRecord], *, as_of: datetime, session_end: datetime | None) -> RiskAssessment:
    """The risk state of one attempt's events, as of `as_of` (a live session: now; ended: its end)."""
    analysis = analyze(events, as_of=as_of, session_end=session_end)
    effective_as_of, signals, points, windows = (
        analysis.as_of,
        analysis.signals,
        analysis.points,
        analysis.windows,
    )

    # Every contribution takes effect at its end time; one pass gives the score over time.
    items = sorted(
        [(s.ended_at, points[s.signal_id]) for s in signals]
        + [(w.ended_at, w.bonus_points) for w in windows],
        key=lambda item: item[0],
    )
    score, at, peak, peak_at = 0.0, None, 0.0, None
    for when, value in items:
        if at is not None:
            score *= _decay((when - at).total_seconds())
        score += value
        at = when
        if score > peak + 1e-9:
            peak, peak_at = score, when
    current = score * _decay((effective_as_of - at).total_seconds()) if at is not None else 0.0

    by_type: dict[ProctoringEventType, list[RiskSignal]] = {}
    for s in signals:
        by_type.setdefault(s.event_type, []).append(s)
    contributors = [
        Contributor(
            event_type=kind,
            tier=policy.RULES[kind].tier,
            occurrences=len(group),
            total_seconds=round(sum(s.duration_seconds for s in group), 1),
            points=round(sum(points[s.signal_id] for s in group), 1),
            current_points=round(
                sum(
                    points[s.signal_id] * _decay((effective_as_of - s.ended_at).total_seconds())
                    for s in group
                ),
                1,
            ),
            reason=policy.RULES[kind].reason,
        )
        for kind, group in by_type.items()
    ]
    contributors.sort(key=lambda c: (-c.current_points, -c.points, c.event_type.value))

    listed = sorted(windows, key=lambda w: (-w.bonus_points, w.started_at))[:MAX_LISTED_WINDOWS]
    listed.sort(key=lambda w: w.started_at)
    current_score = min(policy.MAX_SCORE, round_half_up(current))
    peak_score = min(policy.MAX_SCORE, round_half_up(peak))
    return RiskAssessment(
        policy_version=policy.POLICY_VERSION,
        as_of=effective_as_of,
        current_score=current_score,
        level=policy.level_for(current_score),
        peak_score=peak_score,
        peak_level=policy.level_for(peak_score),
        peak_at=peak_at if peak_score > 0 else None,
        signal_count=len(signals),
        contributors=contributors,
        correlated_windows=listed,
        correlated_window_count=len(windows),
        excluded=[Excluded(k, n, policy.EXCLUDED[k]) for k, n in analysis.excluded_counts.items()],
        ai_unavailable_seconds=round(analysis.ai_unavailable_seconds, 1),
    )
