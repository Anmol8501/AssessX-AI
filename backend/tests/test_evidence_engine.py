"""Phase 6B: evidence derived from the Phase 6A analysis — pure and deterministic.

What is asserted: every evidence item is one real signal, identified by the event that started it and
traceable to its source events; recorded times and durations are preserved and nothing is estimated
(an item with no recorded end says so); statuses follow the actual lifecycle (instant, ongoing,
resolved — with how it ended — or no end recorded); duplicates count once; episodes are exactly the
Phase 6A correlated windows, never invented; explanations are factual; the same events always give the
same evidence; and pagination is chronological, complete and bounded.
"""

import random
import uuid

import pytest

from app.models.proctoring_event import ProctoringEventType
from app.services.risk import policy
from app.services.risk.engine import analyze, evaluate
from app.services.risk.evidence import (
    EVIDENCE_VERSION,
    MAX_LIMIT,
    InvalidCursor,
    build_evidence,
    page,
)
from tests.test_risk_engine import at, episode, ev, the_example_sequence

E = ProctoringEventType


def evidence(events, as_of_s: float, end_s: float | None = None):
    live = end_s is None
    analysis = analyze(events, as_of=at(as_of_s), session_end=at(end_s) if end_s is not None else None)
    return build_evidence(analysis, session_live=live)


def only(result):
    [item] = result.items
    return item


# -- items ------------------------------------------------------------------------------------------


def test_a_resolved_episode_is_one_traceable_item_with_its_recorded_times():
    rows = episode(E.FACE_NOT_DETECTED, 5, 15)
    item = only(evidence(rows, 60))
    assert item.evidence_id == str(rows[0].id)
    assert item.source_event_ids == (str(rows[0].id), str(rows[1].id))
    assert (item.started_at, item.ended_at) == (at(5), at(15))
    assert (item.status, item.duration_seconds, item.counted_seconds) == ("RESOLVED", 10.0, 10.0)
    assert item.resolution == "condition_cleared"
    assert (item.tier, item.points) == ("MEDIUM", 13.0)
    assert item.explanation.startswith(policy.RULES[E.FACE_NOT_DETECTED].reason)
    assert "It lasted 10.0 s." in item.explanation
    assert "It ended when the observed condition cleared." in item.explanation


def test_an_instant_event():
    row = ev(E.PASTE_ATTEMPT, 7, shortcut="CTRL+V", blocked=True)
    item = only(evidence([row], 30))
    assert (item.kind, item.status) == ("INSTANT", "INSTANT")
    assert item.started_at == item.ended_at == at(7)
    assert item.duration_seconds == 0.0
    assert item.source_event_ids == (str(row.id),)


def test_an_ongoing_episode_has_no_invented_end():
    item = only(evidence(episode(E.MULTIPLE_FACES_DETECTED, 0, None, face_count=2), 20))
    assert item.status == "ONGOING"
    assert item.ended_at is None and item.duration_seconds is None
    assert item.counted_seconds == 20.0  # what the risk score counted so far
    assert "still ongoing" in item.explanation and "2 faces were detected." in item.explanation


def test_a_missing_end_after_the_session_is_reported_honestly():
    rows = [ev(E.FOCUS_LOST, 10, reason="deactivated")]  # never regained before the end
    item = only(evidence(rows, 999, end_s=40))
    assert item.status == "NO_END_RECORDED"
    assert item.ended_at is None and item.duration_seconds is None
    assert item.counted_seconds == 30.0
    assert "No end was recorded before the session ended" in item.explanation


def test_an_episode_closed_by_the_server_says_so():
    eid = str(uuid.uuid4())
    rows = [
        ev(E.FACE_NOT_DETECTED, 0, phase="started", episode_id=eid),
        ev(E.FACE_NOT_DETECTED, 30, phase="resolved", episode_id=eid, resolution="session_ended"),
    ]
    item = only(evidence(rows, 30, end_s=30))
    assert (item.status, item.resolution) == ("RESOLVED", "session_ended")
    assert "The server closed it when the session ended." in item.explanation


def test_duplicates_become_one_item():
    rows = [ev(E.FOCUS_LOST, 0), ev(E.FOCUS_LOST, 2), ev(E.FOCUS_REGAINED, 6), ev(E.FOCUS_REGAINED, 7)]
    item = only(evidence(rows, 10))
    assert (item.evidence_id, item.source_event_ids) == (str(rows[0].id), (str(rows[0].id), str(rows[2].id)))
    assert item.duration_seconds == 6.0


def test_overlapping_signals_are_separate_items_in_start_order():
    rows = [*episode(E.FACE_NOT_DETECTED, 10, 30), ev(E.FOCUS_LOST, 5), ev(E.FOCUS_REGAINED, 25)]
    items = evidence(rows, 40).items
    assert [i.event_type for i in items] == [E.FOCUS_LOST, E.FACE_NOT_DETECTED]
    assert items[0].ended_at > items[1].started_at  # genuinely overlapping


def test_excluded_events_produce_no_evidence():
    rows = [
        ev(E.SESSION_STARTED, 0),
        ev(E.PROHIBITED_APP_DETECTED, 1, app="whatsapp", app_category="messaging"),
        ev(E.AI_STATUS, 2, ai_status="ERROR"),
        *episode(E.GAZE_AWAY, 3, 9),
    ]
    assert evidence(rows, 30).items == []


def test_empty_attempt():
    result = evidence([], 60)
    assert result.items == [] and result.episodes == {}


# -- episodes -------------------------------------------------------------------------------------------


def test_episodes_are_exactly_the_6a_correlated_windows():
    rows = the_example_sequence()
    result = evidence(rows, 20)
    [window] = analyze(rows, as_of=at(20), session_end=None).windows
    [ep] = result.episodes.values()
    assert ep.member_ids == window.member_ids
    assert len(ep.member_ids) == 4
    assert all(i.episode_id == ep.episode_id for i in result.items)
    assert (ep.started_at, ep.ended_at, ep.status) == (at(1), at(12), "RESOLVED")
    assert ep.bonus_points == round(window.bonus_points, 1)
    assert "does not establish a cause or an intent" in ep.explanation


def test_no_episode_is_invented_when_6a_found_no_correlation():
    far_apart = [*episode(E.HEAD_ORIENTATION_CHANGED, 0, 2), ev(E.FOCUS_LOST, 300), ev(E.FOCUS_REGAINED, 305)]
    same_kind = [
        ev(E.FOCUS_LOST, 0),
        ev(E.FOCUS_REGAINED, 3),
        ev(E.FULLSCREEN_EXIT, 5),
        ev(E.FULLSCREEN_RESTORED, 8),
    ]
    for rows in (far_apart, same_kind):
        result = evidence(rows, 400)
        assert result.episodes == {} and all(i.episode_id is None for i in result.items)


def test_an_episode_with_an_ongoing_member_is_ongoing_and_open():
    rows = [ev(E.FOCUS_LOST, 0), ev(E.FOCUS_REGAINED, 3), *episode(E.FACE_NOT_DETECTED, 5, None)]
    [ep] = evidence(rows, 20).episodes.values()
    assert (ep.status, ep.ended_at) == ("ONGOING", None)


# -- consistency, determinism, wording ------------------------------------------------------------------


def test_item_points_add_up_to_the_6a_contributors():
    rows = the_example_sequence() + episode(E.MULTIPLE_FACES_DETECTED, 400, 410) + [ev(E.PASTE_ATTEMPT, 500)]
    items = evidence(rows, 600).items
    for contributor in evaluate(rows, as_of=at(600), session_end=None).contributors:
        mine = [i for i in items if i.event_type is contributor.event_type]
        assert len(mine) == contributor.occurrences
        assert sum(i.points for i in mine) == pytest.approx(contributor.points, abs=0.11)


def test_the_same_events_give_the_same_evidence():
    rows = the_example_sequence() + episode(E.MULTIPLE_FACES_DETECTED, 400, 410) + [ev(E.PASTE_ATTEMPT, 500)]
    first = evidence(rows, 600)
    for seed in range(5):
        shuffled = rows[:]
        random.Random(seed).shuffle(shuffled)  # noqa: S311 — deterministic test shuffling
        assert evidence(shuffled, 600) == first


def test_versions_are_carried():
    result = evidence([], 0)
    assert (
        (result.policy_version, result.evidence_version) == ("6A-v1", EVIDENCE_VERSION) == ("6A-v1", "6B-v1")
    )


@pytest.mark.parametrize("event_type", sorted(policy.RULES, key=lambda t: t.value))
def test_every_explanation_is_factual(event_type):
    rows = (
        episode(event_type, 0, 5)
        if event_type.value in {t.value for t in policy.RULES if _is_ai(t)}
        else [ev(event_type, 0)]
    )
    text = " ".join(i.explanation for i in evidence(rows, 10).items).lower()
    assert text
    for word in ("cheat", "intent", "guilty", "fraud", "dishonest", "assisted", "proves"):
        assert word not in text


def _is_ai(event_type: ProctoringEventType) -> bool:
    from app.services.proctoring_events import AI_EPISODE_TYPES

    return event_type in AI_EPISODE_TYPES


def test_current_points_decay_but_points_do_not():
    rows = episode(E.MULTIPLE_FACES_DETECTED, 0, 10)
    fresh, later = only(evidence(rows, 10)), only(evidence(rows, 10 + policy.HALF_LIFE_SECONDS))
    assert fresh.points == later.points == 30.0
    assert (fresh.current_points, later.current_points) == (30.0, 15.0)


# -- pagination ------------------------------------------------------------------------------------------


def many(n: int):
    return [ev(E.PASTE_ATTEMPT, i, shortcut="CTRL+V") for i in range(n)]


def test_pages_are_chronological_complete_and_without_overlap():
    result = evidence(many(120), 200)
    seen, cursor = [], None
    while True:
        chunk = page(result, limit=50, cursor=cursor)
        assert chunk.total == 120
        seen += [i.evidence_id for i in chunk.items]
        cursor = chunk.next_cursor
        if cursor is None:
            break
    assert seen == [i.evidence_id for i in result.items]  # all, once, in order
    assert len(seen) == len(set(seen)) == 120


def test_page_size_is_bounded():
    result = evidence(many(250), 300)
    assert len(page(result, limit=10_000).items) == MAX_LIMIT
    assert len(page(result, limit=0).items) == 1


def test_time_range_filters_by_start():
    result = evidence(many(100), 200)
    chunk = page(result, since=at(20), until=at(30))
    assert chunk.total == 10
    assert [i.started_at for i in chunk.items] == [at(s) for s in range(20, 30)]


@pytest.mark.parametrize("bad", ["not-base64!!", "e30", "WyJ4Il0", ""])
def test_an_invalid_cursor_is_rejected(bad):
    with pytest.raises(InvalidCursor):
        page(evidence(many(3), 10), cursor=bad or "=")
