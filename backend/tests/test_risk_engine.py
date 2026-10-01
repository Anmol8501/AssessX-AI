"""Phase 6A: the risk engine, as pure deterministic functions (no database, no clock).

What is asserted: each event type contributes according to one central, versioned policy; durations
come only from server timestamps; duplicates count once; related signals across categories within a
window are correlated once with a bounded bonus; contributions decay with a fixed half-life; the score
is capped, banded as in PRD FR-015 and explained; excluded events (the pre-exam readiness check, AI
health, session lifecycle, disabled gaze) never contribute; and the same events always give the same
result, in any order.
"""

import random
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.proctoring_event import ProctoringEventCategory, ProctoringEventType
from app.services.proctoring_events import CATEGORY
from app.services.risk import policy
from app.services.risk.engine import evaluate, round_half_up
from app.services.risk.signals import EventRecord, build_signals

E = ProctoringEventType
T0 = datetime(2026, 10, 1, 10, 20, 0, tzinfo=UTC)


def at(seconds: float) -> datetime:
    return T0 + timedelta(seconds=seconds)


def ev(event_type: E, seconds: float, **details) -> EventRecord:
    return EventRecord(uuid.uuid4(), event_type, CATEGORY[event_type], details, at(seconds))


def episode(event_type: E, start: float, end: float | None, **facts) -> list[EventRecord]:
    eid = str(uuid.uuid4())
    rows = [ev(event_type, start, phase="started", episode_id=eid, **facts)]
    if end is not None:
        rows.append(ev(event_type, end, phase="resolved", episode_id=eid, resolution="condition_cleared"))
    return rows


def run(events, as_of_s: float, end_s: float | None = None):
    return evaluate(events, as_of=at(as_of_s), session_end=at(end_s) if end_s is not None else None)


def contributor(result, event_type: E):
    return next(c for c in result.contributors if c.event_type is event_type)


# -- the policy itself ------------------------------------------------------------------------------


def test_every_event_type_has_an_explicit_decision():
    decided = set(policy.RULES) | set(policy.EXCLUDED) | set(policy.END_MARKERS)
    assert decided == set(ProctoringEventType), "a new event type needs an explicit risk decision"
    assert not set(policy.RULES) & set(policy.EXCLUDED)


def test_the_policy_is_versioned_and_banded_as_in_the_prd():
    assert policy.POLICY_VERSION == "6A-v1"
    assert run([], 0).policy_version == "6A-v1"
    bands = {
        0: "NORMAL",
        25: "NORMAL",
        26: "LOW",
        50: "LOW",
        51: "MEDIUM",
        75: "MEDIUM",
        76: "HIGH",
        100: "HIGH",
    }
    for score, level in bands.items():
        assert policy.level_for(score) == level


def test_no_cheating_language_in_the_policy():
    texts = [r.reason for r in policy.RULES.values()] + list(policy.EXCLUDED.values())
    for text in [*texts, policy.LIMITATIONS]:
        assert "cheat" not in text.lower()
    assert "not a determination that the candidate cheated" in policy.INTERPRETATION


# -- contributions ----------------------------------------------------------------------------------


def test_empty_attempt_is_zero_and_normal():
    result = run([], 60)
    assert (result.current_score, result.level, result.peak_score, result.peak_at) == (0, "NORMAL", 0, None)
    assert result.contributors == [] and result.correlated_window_count == 0


def test_a_low_signal():
    result = run(episode(E.FACE_TOO_FAR, 0, 10), 10)  # 1 + 0.05×10 = 1.5
    assert contributor(result, E.FACE_TOO_FAR).tier == "LOW"
    assert contributor(result, E.FACE_TOO_FAR).points == 1.5
    assert (result.current_score, result.level) == (2, "NORMAL")


def test_a_medium_signal():
    result = run(episode(E.FACE_NOT_DETECTED, 0, 10), 10)  # 8 + 0.5×10 = 13
    c = contributor(result, E.FACE_NOT_DETECTED)
    assert (c.tier, c.points, c.total_seconds, c.occurrences) == ("MEDIUM", 13.0, 10.0, 1)
    assert result.current_score == 13


def test_a_high_signal():
    result = run(episode(E.MULTIPLE_FACES_DETECTED, 0, 10, face_count=2), 10)  # 20 + 10 = 30
    assert contributor(result, E.MULTIPLE_FACES_DETECTED).tier == "HIGH"
    assert (result.current_score, result.level) == (30, "LOW")


def test_contributions_are_capped_per_signal():
    result = run(episode(E.FACE_NOT_DETECTED, 0, 3600), 3600)  # 8 + 1800 → capped at 25
    assert contributor(result, E.FACE_NOT_DETECTED).points == 25.0


def test_instant_signals_count_their_base_only():
    result = run([ev(E.PASTE_ATTEMPT, 0, shortcut="CTRL+V", blocked=True)], 0)
    assert contributor(result, E.PASTE_ATTEMPT).points == 6.0


def test_multiple_signals_add_up_and_the_score_is_capped_at_100():
    events = []
    for i in range(6):
        events += episode(E.MULTIPLE_FACES_DETECTED, i * 120, i * 120 + 30)
    result = run(events, 6 * 120)
    assert contributor(result, E.MULTIPLE_FACES_DETECTED).occurrences == 6
    assert result.current_score == 100 and result.level == "HIGH"
    assert result.peak_score == 100


# -- durations, lifecycle and duplicates ------------------------------------------------------------


def test_durations_come_from_server_times_never_the_clients_duration():
    events = [ev(E.FOCUS_LOST, 0, reason="deactivated"), ev(E.FOCUS_REGAINED, 5, duration_ms=10_000_000)]
    assert contributor(run(events, 5), E.FOCUS_LOST).total_seconds == 5.0


def test_an_open_episode_lasts_until_now_or_the_session_end():
    live = build_signals(episode(E.FACE_NOT_DETECTED, 0, None), as_of=at(20), session_end=None).signals
    assert (live[0].duration_seconds, live[0].resolved) == (20.0, False)
    ended = build_signals(episode(E.FACE_NOT_DETECTED, 0, None), as_of=at(999), session_end=at(30)).signals
    assert ended[0].duration_seconds == 30.0


def test_resolved_episodes_use_the_resolution_time():
    signal = build_signals(episode(E.FACE_NOT_DETECTED, 5, 12), as_of=at(60), session_end=None).signals[0]
    assert (signal.duration_seconds, signal.resolved) == (7.0, True)


def test_duplicates_count_once():
    eid = str(uuid.uuid4())
    events = [
        ev(E.FOCUS_LOST, 0),
        ev(E.FOCUS_LOST, 2),  # a second start while one is open
        ev(E.FOCUS_REGAINED, 6),
        ev(E.FOCUS_REGAINED, 7),  # an end with nothing open
        ev(E.FACE_NOT_DETECTED, 10, phase="started", episode_id=eid),
        ev(E.FACE_NOT_DETECTED, 11, phase="started", episode_id=eid),  # the same episode again
        ev(E.FACE_NOT_DETECTED, 15, phase="resolved", episode_id=eid, resolution="condition_cleared"),
        ev(E.FACE_NOT_DETECTED, 16, phase="resolved", episode_id=eid, resolution="condition_cleared"),
    ]
    result = run(events, 20)
    assert (
        contributor(result, E.FOCUS_LOST).occurrences,
        contributor(result, E.FOCUS_LOST).total_seconds,
    ) == (1, 6.0)
    assert (
        contributor(result, E.FACE_NOT_DETECTED).occurrences,
        contributor(result, E.FACE_NOT_DETECTED).total_seconds,
    ) == (1, 5.0)


def test_malformed_and_orphan_events_are_ignored():
    events = [
        ev(E.FACE_NOT_DETECTED, 0, phase="started"),  # no episode id
        ev(E.FACE_NOT_DETECTED, 1, phase="resolved", episode_id=str(uuid.uuid4())),  # never started
        ev(E.CAMERA_RECONNECTED, 2, state="READY"),  # an end with no start
    ]
    result = run(events, 10)
    assert result.contributors == [] and result.current_score == 0


def test_excluded_events_never_contribute_and_are_explained():
    events = [
        ev(E.SESSION_STARTED, 0),
        ev(E.DEVICE_CHECK_STARTED, 1),
        ev(E.PROHIBITED_APP_DETECTED, 1, app="whatsapp", app_category="messaging"),
        ev(E.APP_CLOSED, 2, app="whatsapp"),
        ev(E.DEVICE_CHECK_PASSED, 3, app_count=0),
        ev(E.ENFORCEMENT_STATUS, 4, environment="desktop"),
        ev(E.AI_STATUS, 5, ai_status="RUNNING"),
        *episode(E.GAZE_AWAY, 6, 20, direction="left"),
    ]
    result = run(events, 30)
    assert result.current_score == 0 and result.contributors == []
    excluded = {x.event_type: x for x in result.excluded}
    assert excluded[E.PROHIBITED_APP_DETECTED].reason.startswith("Pre-exam device readiness check")
    assert excluded[E.GAZE_AWAY].count == 2
    assert E.AI_STATUS in excluded and E.SESSION_STARTED in excluded


def test_ai_downtime_is_reported_as_coverage_not_risk():
    events = [
        ev(E.AI_STATUS, 0, ai_status="RUNNING"),
        ev(E.AI_STATUS, 60, ai_status="ERROR"),
        ev(E.AI_STATUS, 300, ai_status="RUNNING"),
    ]
    result = run(events, 400)
    assert result.ai_unavailable_seconds == 240.0
    assert result.current_score == 0


def test_events_after_the_evaluation_time_are_ignored():
    result = run(episode(E.MULTIPLE_FACES_DETECTED, 100, 110), 50)
    assert result.contributors == []


# -- correlation ------------------------------------------------------------------------------------


def the_example_sequence() -> list[EventRecord]:
    """10:20:01 head · 10:20:03 head · 10:20:04 focus lost · 10:20:06 face not detected."""
    return [
        *episode(E.HEAD_ORIENTATION_CHANGED, 1, 2, direction="left"),
        *episode(E.HEAD_ORIENTATION_CHANGED, 3, 4, direction="right"),
        ev(E.FOCUS_LOST, 4),
        ev(E.FOCUS_REGAINED, 9),
        *episode(E.FACE_NOT_DETECTED, 6, 12),
    ]


def test_signals_across_categories_within_the_window_are_one_correlated_window():
    result = run(the_example_sequence(), 12)
    assert result.correlated_window_count == 1
    [window] = result.correlated_windows
    assert window.signal_count == 4
    assert window.started_at == at(1) and window.ended_at == at(12)
    assert set(window.categories) == {ProctoringEventCategory.AI_OBSERVATION, ProctoringEventCategory.WINDOW}
    members = 2 * 3.2 + (8 + 0.5 * 5) + (8 + 0.5 * 6)  # head ×2, focus 5 s, face 6 s
    assert window.bonus_points == pytest.approx(policy.CORRELATION_BONUS_FRACTION * members)


def test_signals_outside_the_window_are_not_correlated():
    events = [*episode(E.HEAD_ORIENTATION_CHANGED, 0, 2), ev(E.FOCUS_LOST, 300), ev(E.FOCUS_REGAINED, 305)]
    assert run(events, 310).correlated_window_count == 0


def test_a_single_category_is_not_a_correlation():
    events = [
        ev(E.FOCUS_LOST, 0),
        ev(E.FOCUS_REGAINED, 3),
        ev(E.FULLSCREEN_EXIT, 5),
        ev(E.FULLSCREEN_RESTORED, 8),
    ]
    assert run(events, 10).correlated_window_count == 0


def test_correlation_bonus_is_capped_and_counted_once():
    events = []
    for i in range(10):  # a long burst: one window, not ten
        events += episode(E.MULTIPLE_FACES_DETECTED, i * 10, i * 10 + 8)
        events += [ev(E.FOCUS_LOST, i * 10 + 1), ev(E.FOCUS_REGAINED, i * 10 + 5)]
    result = run(events, 200)
    assert result.correlated_window_count == 1
    assert result.correlated_windows[0].bonus_points == policy.CORRELATION_BONUS_CAP


# -- decay, peak and determinism --------------------------------------------------------------------


def test_contributions_decay_with_the_half_life():
    events = episode(E.MULTIPLE_FACES_DETECTED, 0, 10)  # 30 points ending at t=10
    assert run(events, 10).current_score == 30
    assert run(events, 10 + policy.HALF_LIFE_SECONDS).current_score == 15
    assert run(events, 10 + 2 * policy.HALF_LIFE_SECONDS).current_score == 8  # 7.5 rounds half up
    assert run(events, 10 + 10 * policy.HALF_LIFE_SECONDS).current_score == 0


def test_an_early_incident_stays_visible_as_the_peak():
    events = episode(E.MULTIPLE_FACES_DETECTED, 60, 70)
    result = run(events, 999_999, end_s=3600)  # finished exam: evaluated at its end
    assert result.as_of == at(3600)
    # decayed by the end of the exam: 30 × 0.5^((3600 − 70) / 600) ≈ 0.51 → 1…
    assert result.current_score == round_half_up(30 * 0.5 ** ((3600 - 70) / policy.HALF_LIFE_SECONDS)) == 1
    assert (result.peak_score, result.peak_level, result.peak_at) == (30, "LOW", at(70))  # …but not forgotten


def test_the_same_events_give_the_same_result_in_any_order():
    events = (
        the_example_sequence() + episode(E.MULTIPLE_FACES_DETECTED, 400, 410) + [ev(E.PASTE_ATTEMPT, 500)]
    )
    first = run(events, 600)
    for seed in range(5):
        shuffled = events[:]
        random.Random(seed).shuffle(shuffled)  # noqa: S311 — deterministic test shuffling, not security
        assert run(shuffled, 600) == first
    assert run(events, 600) == first  # repeated calculation


def test_contributors_are_ordered_by_current_influence():
    events = [ev(E.CONTEXT_MENU_ATTEMPT, 0)] + episode(E.MULTIPLE_FACES_DETECTED, 1, 5)
    result = run(events, 5)
    assert [c.event_type for c in result.contributors] == [E.MULTIPLE_FACES_DETECTED, E.CONTEXT_MENU_ATTEMPT]


def test_a_full_attempt_is_evaluated_in_bounded_time():
    import time

    events = []
    for i in range(1250):  # 5000 rows — the per-session event ceiling
        events += episode(E.HEAD_ORIENTATION_CHANGED, i * 2, i * 2 + 1)
        events += [ev(E.FOCUS_LOST, i * 2), ev(E.FOCUS_REGAINED, i * 2 + 1)]
    started = time.perf_counter()
    result = run(events, 2600)
    assert time.perf_counter() - started < 2.0
    assert result.signal_count == 2500
