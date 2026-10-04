"""Phase 5C: on-device AI observations as factual proctoring events.

What is asserted: AI observations reuse the Phase 4B event store as *episodes* — a `started` row and
a `resolved` row sharing an `episode_id`, never one row per frame; the server keeps that lifecycle
honest (no resolving an episode that is not open, no reused ids, no client durations, no
server-only resolutions) and computes every duration itself; open episodes are closed when a new
one of the same type supersedes them and when the session ends; AI health is its own category and
never counts as an observation about the candidate; there is no phone event and no score, risk or
verdict field anywhere; and the admin monitoring views derive a factual AI state from these rows.
"""

import uuid
from datetime import timedelta

import pytest

from app.models.base import utcnow
from app.models.proctoring_event import (
    ProctoringEvent,
    ProctoringEventCategory,
    ProctoringEventSource,
    ProctoringEventType,
)
from app.realtime import notify
from app.services.monitoring import MonitoringService, derive_ai_state
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import start
from tests.test_exam_session import submit
from tests.test_proctoring import activate, intruder, proctored_exam, session_row
from tests.test_proctoring_events import events_of, post_event, types_of

MON = "/api/v1/admin/monitoring"
E = ProctoringEventType


@pytest.fixture
def active(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return {"exam": exam, "attempt": attempt, "headers": headers}


def episode(client, active, event_type: str, phase: str, episode_id: str, expect: int = 201, **metadata):
    return post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": event_type, "metadata": {"phase": phase, "episode_id": episode_id, **metadata}},
        expect=expect,
    )


def status(client, active, ai_status: str, expect: int = 201, **metadata):
    return post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "AI_STATUS", "metadata": {"ai_status": ai_status, **metadata}},
        expect=expect,
    )


def new_id() -> str:
    return str(uuid.uuid4())


def ai_rows(db, active) -> list[ProctoringEvent]:
    return [
        e
        for e in events_of(db, active["attempt"])
        if e.category in (ProctoringEventCategory.AI_OBSERVATION, ProctoringEventCategory.AI_HEALTH)
    ]


# -- the episode lifecycle -------------------------------------------------------------------------


def test_an_episode_is_a_started_and_a_resolved_row_with_a_server_duration(client, db, active):
    eid = new_id()
    episode(client, active, "FACE_NOT_DETECTED", "started", eid, detector="face_presence")
    [start_row] = ai_rows(db, active)
    start_row.recorded_at = utcnow() - timedelta(seconds=7)  # the episode began 7 s ago
    db.flush()

    body = episode(client, active, "FACE_NOT_DETECTED", "resolved", eid, resolution="condition_cleared")

    assert body["event_type"] == "FACE_NOT_DETECTED"
    rows = ai_rows(db, active)
    assert [r.details["phase"] for r in rows] == ["started", "resolved"]
    resolved = rows[1]
    assert resolved.category is ProctoringEventCategory.AI_OBSERVATION
    assert resolved.source is ProctoringEventSource.CLIENT
    assert 6500 <= resolved.details["duration_ms"] <= 9000
    assert resolved.details["detector"] == "face_presence"  # carried over from the start
    assert resolved.details["resolution"] == "condition_cleared"


@pytest.mark.parametrize(
    ("event_type", "metadata"),
    [
        ("FACE_NOT_DETECTED", {"detector": "face_presence"}),
        ("MULTIPLE_FACES_DETECTED", {"detector": "face_presence", "face_count": 2, "confidence": 0.91}),
        (
            "HEAD_ORIENTATION_CHANGED",
            {
                "detector": "head_pose",
                "direction": "left",
                "yaw_deg": 11.5,
                "neutral_yaw_deg": -10.0,
                "pitch_deg": -2,
            },
        ),
        ("CAMERA_TOO_DARK", {"detector": "frame_quality", "mean_luminance": 0.04}),
        ("FACE_TOO_FAR", {"detector": "frame_quality", "face_area_ratio": 0.01}),
        ("FACE_TOO_CLOSE", {"detector": "frame_quality", "face_area_ratio": 0.62}),
    ],
)
def test_every_ai_observation_type_is_accepted_as_an_episode(client, db, active, event_type, metadata):
    eid = new_id()
    episode(client, active, event_type, "started", eid, **metadata)
    episode(client, active, event_type, "resolved", eid, resolution="condition_cleared")

    rows = ai_rows(db, active)
    assert [r.event_type.value for r in rows] == [event_type, event_type]
    assert all(r.category is ProctoringEventCategory.AI_OBSERVATION for r in rows)


def test_a_resolution_must_match_an_open_episode_of_the_same_type(client, db, active):
    eid = new_id()
    episode(client, active, "FACE_TOO_CLOSE", "started", eid)

    episode(
        client, active, "FACE_TOO_CLOSE", "resolved", new_id(), expect=422, resolution="condition_cleared"
    )
    episode(
        client,
        active,
        "HEAD_ORIENTATION_CHANGED",
        "resolved",
        eid,
        expect=422,
        resolution="condition_cleared",
    )
    episode(client, active, "FACE_TOO_CLOSE", "resolved", eid, resolution="condition_cleared")
    # already resolved: a second resolution is refused, not recorded twice
    episode(client, active, "FACE_TOO_CLOSE", "resolved", eid, expect=422, resolution="condition_cleared")

    assert len(ai_rows(db, active)) == 2


def test_an_episode_id_cannot_be_started_twice(client, db, active):
    eid = new_id()
    episode(client, active, "FACE_TOO_CLOSE", "started", eid)
    episode(client, active, "FACE_TOO_CLOSE", "resolved", eid, resolution="condition_cleared")

    episode(client, active, "FACE_TOO_CLOSE", "started", eid, expect=422)
    episode(client, active, "HEAD_ORIENTATION_CHANGED", "started", eid, expect=422)
    assert len(ai_rows(db, active)) == 2


@pytest.mark.parametrize(
    "metadata",
    [
        {},  # no phase / episode id
        {"phase": "started"},
        {"episode_id": "00000000-0000-4000-8000-000000000000"},
        {"phase": "started", "episode_id": "not-a-uuid"},
        {"phase": "ongoing", "episode_id": "00000000-0000-4000-8000-000000000000"},
        {"phase": "started", "episode_id": "00000000-0000-4000-8000-000000000000", "duration_ms": 5},
        {
            "phase": "started",
            "episode_id": "00000000-0000-4000-8000-000000000000",
            "resolution": "condition_cleared",
        },
        {"phase": "resolved", "episode_id": "00000000-0000-4000-8000-000000000000"},  # no resolution
    ],
)
def test_malformed_episode_rows_are_rejected(client, db, active, metadata):
    post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "FACE_NOT_DETECTED", "metadata": metadata},
        expect=422,
    )
    assert ai_rows(db, active) == []


def test_the_client_cannot_report_a_duration_or_a_server_only_resolution(client, db, active):
    eid = new_id()
    episode(client, active, "FACE_NOT_DETECTED", "started", eid)

    episode(
        client,
        active,
        "FACE_NOT_DETECTED",
        "resolved",
        eid,
        expect=422,
        resolution="condition_cleared",
        duration_ms=1,
    )
    episode(client, active, "FACE_NOT_DETECTED", "resolved", eid, expect=422, resolution="session_ended")
    episode(client, active, "FACE_NOT_DETECTED", "resolved", eid, expect=422, resolution="superseded")
    episode(client, active, "FACE_NOT_DETECTED", "resolved", eid, expect=422, resolution="guilty")

    assert len(ai_rows(db, active)) == 1


@pytest.mark.parametrize("resolution", ["condition_cleared", "measurement_unavailable", "monitoring_stopped"])
def test_every_client_resolution_is_accepted(client, db, active, resolution):
    eid = new_id()
    episode(client, active, "HEAD_ORIENTATION_CHANGED", "started", eid, direction="down")
    episode(client, active, "HEAD_ORIENTATION_CHANGED", "resolved", eid, resolution=resolution)
    assert ai_rows(db, active)[-1].details["resolution"] == resolution


def test_a_head_turn_records_the_candidates_calibrated_neutral(client, db, active):
    """Head orientation is a deviation from the candidate's own neutral yaw, which the event keeps."""
    episode(
        client,
        active,
        "HEAD_ORIENTATION_CHANGED",
        "started",
        new_id(),
        detector="head_pose",
        direction="right",
        yaw_deg=-31.2,
        neutral_yaw_deg=-10.4,
        pitch_deg=3.0,
    )
    [row] = ai_rows(db, active)
    assert row.details["neutral_yaw_deg"] == -10.4
    episode(client, active, "HEAD_ORIENTATION_CHANGED", "started", new_id(), expect=422, neutral_yaw_deg=999)


def test_a_new_gaze_away_episode_is_refused(client, db, active):
    """GAZE_AWAY is disabled: the server refuses a new one, whatever a client sends."""
    episode(
        client, active, "GAZE_AWAY", "started", new_id(), expect=422, direction="left", gaze_horizontal=0.9
    )
    assert ai_rows(db, active) == []


def test_a_gaze_episode_left_open_by_an_earlier_build_can_still_be_closed(client, db, active):
    """Rows recorded before GAZE_AWAY was disabled stay valid and are closed normally."""
    old, other = new_id(), new_id()
    session = session_row(db, active["attempt"])
    for eid in (old, other):
        db.add(
            ProctoringEvent(
                session=session,
                event_type=E.GAZE_AWAY,
                category=ProctoringEventCategory.AI_OBSERVATION,
                source=ProctoringEventSource.CLIENT,
                details={"phase": "started", "episode_id": eid},
                recorded_at=utcnow() - timedelta(seconds=5),
            )
        )
    db.flush()

    episode(client, active, "GAZE_AWAY", "resolved", old, resolution="monitoring_stopped")
    submit(client, active["headers"], active["attempt"]["id"])

    gaze = [r for r in ai_rows(db, active) if r.event_type is E.GAZE_AWAY]
    resolved = [r for r in gaze if r.details["phase"] == "resolved"]
    assert {r.details["episode_id"]: r.details["resolution"] for r in resolved} == {
        old: "monitoring_stopped",
        other: "session_ended",
    }


def test_measurements_outside_their_ranges_are_rejected(client, db, active):
    for metadata in (
        {"face_count": 51},
        {"face_count": 1.5},
        {"confidence": 1.2},
        {"confidence": True},
        {"yaw_deg": 400},
        {"gaze_horizontal": -3},
        {"direction": "behind"},
        {"detector": "phone"},
    ):
        episode(client, active, "MULTIPLE_FACES_DETECTED", "started", new_id(), expect=422, **metadata)
    assert ai_rows(db, active) == []


def test_a_new_episode_supersedes_a_stale_open_one_of_the_same_type(client, db, active):
    """The app restarted mid-episode: the old start never got a resolution."""
    stale, fresh = new_id(), new_id()
    episode(client, active, "FACE_NOT_DETECTED", "started", stale)
    episode(client, active, "CAMERA_TOO_DARK", "started", new_id())  # other types are untouched

    episode(client, active, "FACE_NOT_DETECTED", "started", fresh)

    rows = [r for r in ai_rows(db, active) if r.event_type is E.FACE_NOT_DETECTED]
    closed = [r for r in rows if r.details["phase"] == "resolved"]
    assert len(closed) == 1
    assert closed[0].details["episode_id"] == stale
    assert closed[0].details["resolution"] == "superseded"
    assert closed[0].source is ProctoringEventSource.SERVER
    # the superseded episode can no longer be resolved by the client
    episode(
        client, active, "FACE_NOT_DETECTED", "resolved", stale, expect=422, resolution="condition_cleared"
    )
    dark = [r for r in ai_rows(db, active) if r.event_type is E.CAMERA_TOO_DARK]
    assert [r.details["phase"] for r in dark] == ["started"]


def test_open_episodes_are_closed_when_the_session_ends(client, db, active):
    face, head, done = new_id(), new_id(), new_id()
    episode(client, active, "FACE_NOT_DETECTED", "started", face, detector="face_presence")
    episode(client, active, "HEAD_ORIENTATION_CHANGED", "started", head, direction="right")
    episode(client, active, "CAMERA_TOO_DARK", "started", done)
    episode(client, active, "CAMERA_TOO_DARK", "resolved", done, resolution="condition_cleared")

    submit(client, active["headers"], active["attempt"]["id"])

    rows = events_of(db, active["attempt"])
    ended = [r for r in rows if r.details.get("resolution") == "session_ended"]
    assert sorted(r.details["episode_id"] for r in ended) == sorted([face, head])
    assert all(r.source is ProctoringEventSource.SERVER for r in ended)
    assert all(r.details["duration_ms"] >= 0 for r in ended)
    assert next(r for r in ended if r.details["episode_id"] == face).details["detector"] == "face_presence"
    # Closed at the session's end instant — the same server time as SESSION_ENDED itself.
    [session_ended] = [r for r in rows if r.event_type is E.SESSION_ENDED]
    assert all(r.recorded_at == session_ended.recorded_at for r in ended)


def test_a_session_without_ai_events_ends_exactly_as_before(client, db, active):
    submit(client, active["headers"], active["attempt"]["id"])
    assert types_of(db, active["attempt"]) == ["SESSION_STARTED", "SESSION_ENDED"]


def test_ai_events_are_refused_once_the_attempt_has_ended(client, db, active):
    submit(client, active["headers"], active["attempt"]["id"])
    episode(client, active, "FACE_NOT_DETECTED", "started", new_id(), expect=409)


# -- AI health ---------------------------------------------------------------------------------------


def test_ai_status_is_health_not_an_observation(client, db, active):
    status(client, active, "DEGRADED", ai_reason="detector_impaired", impaired=["gaze"], accelerator="CPU")

    [row] = ai_rows(db, active)
    assert row.event_type is E.AI_STATUS
    assert row.category is ProctoringEventCategory.AI_HEALTH
    assert row.details == {
        "ai_status": "DEGRADED",
        "ai_reason": "detector_impaired",
        "impaired": ["gaze"],
        "accelerator": "CPU",
    }


@pytest.mark.parametrize(
    "metadata",
    [
        {},  # ai_status is required
        {"ai_status": "CHEATING"},
        {"ai_status": "ERROR", "ai_reason": "candidate_suspicious"},
        {"ai_status": "DEGRADED", "impaired": ["gaze", "gaze"]},
        {"ai_status": "DEGRADED", "impaired": ["phone_detector"]},
        {"ai_status": "DEGRADED", "impaired": "gaze"},
        {"ai_status": "RUNNING", "phase": "started"},
        {"ai_status": "RUNNING", "risk_score": 0.1},
    ],
)
def test_invalid_ai_status_reports_are_rejected(client, db, active, metadata):
    post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "AI_STATUS", "metadata": metadata},
        expect=422,
    )
    assert ai_rows(db, active) == []


def test_ai_status_does_not_use_the_episode_lifecycle(client, db, active):
    status(client, active, "INITIALIZING")
    status(client, active, "RUNNING", ai_reason="none", accelerator="CPU")
    status(client, active, "ERROR", ai_reason="runtime_error")
    assert [r.details["ai_status"] for r in ai_rows(db, active)] == ["INITIALIZING", "RUNNING", "ERROR"]


# -- what does not exist -----------------------------------------------------------------------------


@pytest.mark.parametrize("event_type", ["CHEATING_DETECTED", "SUSPICIOUS_BEHAVIOUR", "PHONE_USE_CONFIRMED"])
def test_there_is_no_verdict_event(client, db, active, event_type):
    post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": event_type, "metadata": {"phase": "started", "episode_id": new_id()}},
        expect=422,
    )
    assert ai_rows(db, active) == []


# -- objects in view (2026-10-02) ------------------------------------------------------------------

OBJECT_TYPES = {
    "PHONE_DETECTED": "cell_phone",
    "BOOK_DETECTED": "book",
    "LAPTOP_DETECTED": "laptop",
    "HANDHELD_DEVICE_DETECTED": "remote",
}


@pytest.mark.parametrize(("event_type", "object_class"), OBJECT_TYPES.items())
def test_an_object_in_view_is_an_episode_with_its_measurement(client, db, active, event_type, object_class):
    eid = new_id()
    started = episode(
        client,
        active,
        event_type,
        "started",
        eid,
        detector="object_detection",
        object_class=object_class,
        confidence=0.72,
        object_model="yolox_s",
        box_area_ratio=0.012,
    )
    assert started["category"] == "AI_OBSERVATION"
    episode(client, active, event_type, "resolved", eid, resolution="condition_cleared")
    rows = [r for r in ai_rows(db, active) if r.event_type.value == event_type]
    assert [r.details["phase"] for r in rows] == ["started", "resolved"]
    assert rows[0].details["object_class"] == object_class and rows[0].details["object_model"] == "yolox_s"
    assert rows[1].details["duration_ms"] >= 0  # computed by the server


@pytest.mark.parametrize(
    "bad",
    [
        {"object_class": "smartwatch"},
        {"object_model": "yolov8"},
        {"confidence": 1.5},
        {"box_area_ratio": -0.1},
        {"image": "data:image/jpeg;base64,AAAA"},
        {"crop": "AAAA"},
        {"verdict": "phone use"},
    ],
)
def test_an_object_event_accepts_only_its_measurement(client, db, active, bad):
    episode(
        client,
        active,
        "PHONE_DETECTED",
        "started",
        new_id(),
        expect=422,
        **{"object_class": "cell_phone", **bad},
    )
    assert ai_rows(db, active) == []


def test_object_events_are_not_risk_signals():
    from app.services.risk import policy

    for event_type in OBJECT_TYPES:
        assert E(event_type) in policy.EXCLUDED


@pytest.mark.parametrize(
    "forged",
    [
        {"cheating_score": 0.9},
        {"risk_score": 80},
        {"fraud_probability": 0.5},
        {"verdict": "guilty"},
        {"suspicious": True},
        {"objectClass": "cell phone"},
        {"image": "data:image/png;base64,AAAA"},
        {"embedding": "0.1,0.2"},
    ],
)
def test_no_score_verdict_or_image_field_is_accepted(client, db, active, forged):
    episode(
        client, active, "MULTIPLE_FACES_DETECTED", "started", new_id(), expect=422, face_count=2, **forged
    )
    assert ai_rows(db, active) == []


def test_the_client_cannot_forge_category_source_or_time_on_ai_events(client, db, active):
    for forged in ({"category": "SESSION"}, {"source": "SERVER"}, {"recorded_at": "2020-01-01T00:00:00Z"}):
        post_event(
            client,
            active["headers"],
            active["attempt"]["id"],
            {"event_type": "FACE_NOT_DETECTED", "metadata": {"phase": "started", "episode_id": new_id()}},
            expect=422,
            **forged,
        )
    assert ai_rows(db, active) == []


# -- authorization -----------------------------------------------------------------------------------


def test_another_candidate_cannot_add_or_resolve_ai_events(client, helpers: Helpers, db, active):
    eid = new_id()
    episode(client, active, "FACE_NOT_DETECTED", "started", eid)
    other = intruder(client, helpers, active["exam"])

    for metadata in (
        {"phase": "resolved", "episode_id": eid, "resolution": "condition_cleared"},
        {"phase": "started", "episode_id": new_id()},
    ):
        response = client.post(
            f"/api/v1/candidates/me/attempts/{active['attempt']['id']}/proctoring/events",
            json={"client_event_id": new_id(), "event_type": "FACE_NOT_DETECTED", "metadata": metadata},
            headers=other,
        )
        assert response.status_code == 404, response.text
    response = client.post(
        f"/api/v1/candidates/me/attempts/{active['attempt']['id']}/proctoring/events",
        json={"client_event_id": new_id(), "event_type": "AI_STATUS", "metadata": {"ai_status": "ERROR"}},
        headers=other,
    )
    assert response.status_code == 404, response.text
    assert len(ai_rows(db, active)) == 1


def test_an_episode_cannot_be_resolved_from_another_session(client, helpers: Helpers, users, db, active):
    """Episode ids are scoped to their own session: the same candidate's other attempt cannot close it."""
    eid = new_id()
    episode(client, active, "FACE_NOT_DETECTED", "started", eid)
    other_exam = proctored_exam(client, helpers, users)
    other_attempt = start(client, active["headers"], other_exam["id"])
    activate(client, active["headers"], other_attempt["id"])

    post_event(
        client,
        active["headers"],
        other_attempt["id"],
        {
            "event_type": "FACE_NOT_DETECTED",
            "metadata": {"phase": "resolved", "episode_id": eid, "resolution": "condition_cleared"},
        },
        expect=422,
    )
    assert [r.details["phase"] for r in ai_rows(db, active)] == ["started"]


# -- the derived AI state (monitoring) ---------------------------------------------------------------


def _row(event_type, details, seconds=0) -> ProctoringEvent:
    return ProctoringEvent(
        event_type=event_type,
        category=ProctoringEventCategory.AI_HEALTH
        if event_type is E.AI_STATUS
        else ProctoringEventCategory.AI_OBSERVATION,
        details=details,
        recorded_at=utcnow() + timedelta(seconds=seconds),
    )


def _start(event_type, eid, seconds=0, **extra):
    return _row(event_type, {"phase": "started", "episode_id": eid, **extra}, seconds)


def _end(event_type, eid, seconds=0):
    return _row(
        event_type, {"phase": "resolved", "episode_id": eid, "resolution": "condition_cleared"}, seconds
    )


RUNNING = _row(E.AI_STATUS, {"ai_status": "RUNNING", "ai_reason": "none"}, -100)


def test_no_ai_events_means_everything_unknown():
    state = derive_ai_state([])
    assert state.status is None
    assert (state.face, state.face_count, state.head_orientation, state.camera_quality) == (
        "unknown",
        "unknown",
        "unknown",
        "unknown",
    )
    assert state.gaze == "not_used"
    assert state.active == []


def test_the_admin_state_shows_which_objects_are_in_view():
    assert derive_ai_state([]).objects == "unknown"
    assert derive_ai_state([RUNNING]).objects == "none"
    state = derive_ai_state(
        [RUNNING, _start(E.PHONE_DETECTED, "p", object_class="cell_phone"), _start(E.BOOK_DETECTED, "b")]
    )
    assert state.objects == "detected" and state.objects_seen == ["book", "cell_phone"]
    assert (
        derive_ai_state([RUNNING, _start(E.PHONE_DETECTED, "p"), _end(E.PHONE_DETECTED, "p", 5)]).objects
        == "none"
    )
    impaired = _row(E.AI_STATUS, {"ai_status": "DEGRADED", "impaired": ["object_detection"]}, -50)
    assert derive_ai_state([impaired]).objects == "unknown"


def test_a_running_ai_with_no_open_episodes_reports_the_normal_state():
    state = derive_ai_state([RUNNING])
    assert state.status == "RUNNING"
    assert (state.face, state.face_count, state.head_orientation, state.camera_quality) == (
        "detected",
        "one",
        "forward",
        "good",
    )


def test_gaze_is_never_presented_as_a_signal():
    """GAZE_AWAY is disabled: even an episode left open by an earlier app build does not make the
    admin state say "away" — gaze is reported as not used."""
    for rows in ([], [RUNNING], [RUNNING, _start(E.GAZE_AWAY, "old", direction="left")]):
        assert derive_ai_state(rows).gaze == "not_used"


def test_open_episodes_drive_the_indicators():
    state = derive_ai_state(
        [
            RUNNING,
            _start(E.MULTIPLE_FACES_DETECTED, "a", face_count=2),
            _start(
                E.HEAD_ORIENTATION_CHANGED, "b", 1, direction="right", yaw_deg=-31.0, neutral_yaw_deg=-10.0
            ),
            _start(E.CAMERA_TOO_DARK, "d", 3),
        ]
    )
    assert state.face_count == "multiple"
    assert state.head_orientation == "right"
    assert state.camera_quality == "issue"
    assert [a.event_type for a in state.active] == [
        E.MULTIPLE_FACES_DETECTED,
        E.HEAD_ORIENTATION_CHANGED,
        E.CAMERA_TOO_DARK,
    ]


def test_resolved_episodes_are_no_longer_active_even_with_equal_timestamps():
    start_row = _start(E.HEAD_ORIENTATION_CHANGED, "h", 0, direction="left")
    end_row = _end(E.HEAD_ORIENTATION_CHANGED, "h", 0)
    end_row.recorded_at = start_row.recorded_at
    for rows in ([RUNNING, start_row, end_row], [RUNNING, end_row, start_row]):
        state = derive_ai_state(rows)
        assert state.head_orientation == "forward"
        assert state.active == []


def test_no_face_makes_head_unknown_rather_than_forward():
    state = derive_ai_state([RUNNING, _start(E.FACE_NOT_DETECTED, "f")])
    assert state.face == "not_detected"
    assert state.face_count == "none"
    assert state.head_orientation == "unknown"


@pytest.mark.parametrize("ai_status", ["ERROR", "STOPPED", "INITIALIZING"])
def test_an_ai_that_is_not_measuring_reports_unknown_not_normal(ai_status):
    state = derive_ai_state([RUNNING, _row(E.AI_STATUS, {"ai_status": ai_status}, 5)])
    assert state.status == ai_status
    assert {state.face, state.face_count, state.head_orientation, state.camera_quality} == {"unknown"}


def test_an_impaired_detector_reports_unknown_for_its_indicator_only():
    impaired = {"ai_status": "DEGRADED", "ai_reason": "detector_impaired", "impaired": ["head_pose"]}
    state = derive_ai_state([_row(E.AI_STATUS, impaired)])
    assert state.status == "DEGRADED"
    assert state.impaired == ["head_pose"]
    assert state.head_orientation == "unknown"
    assert state.face == "detected"
    assert state.camera_quality == "good"


# -- monitoring REST and realtime ----------------------------------------------------------------------


def test_the_monitoring_tile_and_detail_carry_the_ai_state(client, helpers: Helpers, active):
    status(client, active, "RUNNING", ai_reason="none", accelerator="CPU")
    episode(client, active, "HEAD_ORIENTATION_CHANGED", "started", new_id(), direction="left", yaw_deg=33.0)

    wall = client.get(f"{MON}/sessions", headers=admin_headers(helpers)).json()
    [tile] = [s for s in wall["sessions"] if s["attempt_id"] == active["attempt"]["id"]]
    assert tile["ai"]["status"] == "RUNNING"
    assert tile["ai"]["head_orientation"] == "left"

    detail = client.get(f"{MON}/sessions/{active['attempt']['id']}", headers=admin_headers(helpers)).json()
    assert detail["ai"]["head_orientation"] == "left"
    assert detail["ai"]["active"][0]["event_type"] == "HEAD_ORIENTATION_CHANGED"
    assert detail["ai"]["active"][0]["metadata"]["yaw_deg"] == 33.0
    assert "HEAD_ORIENTATION_CHANGED" in [e["event_type"] for e in detail["recent_events"]]
    for forbidden in ("score", "risk", "cheating", "verdict", "suspicious"):
        assert forbidden not in str(detail["ai"]).lower()


def test_the_ai_state_is_admin_only(client, helpers: Helpers, active):
    path = f"{MON}/sessions/{active['attempt']['id']}"
    assert client.get(path, headers=active["headers"]).status_code == 403


def test_an_ai_event_is_broadcast_as_an_event_and_a_session_update(client, db, active, monkeypatch):
    sent: list[dict] = []
    monkeypatch.setattr(notify.hub.__class__, "has_admins", property(lambda self: True))
    monkeypatch.setattr(notify.hub, "publish_threadsafe", sent.append)

    episode(client, active, "FACE_NOT_DETECTED", "started", new_id())

    kinds = [m["type"] for m in sent]
    assert kinds == ["PROCTORING_EVENT", "SESSION_UPDATED"]
    assert sent[0]["event"]["event_type"] == "FACE_NOT_DETECTED"
    assert sent[0]["event"]["category"] == "AI_OBSERVATION"
    assert sent[1]["session"]["ai"]["face"] in {"not_detected", "unknown"}


def test_the_session_delta_and_rest_agree_on_the_ai_state(client, db, helpers: Helpers, active):
    status(client, active, "RUNNING")
    episode(client, active, "HEAD_ORIENTATION_CHANGED", "started", new_id(), direction="right")

    delta = MonitoringService(db).session_delta(uuid.UUID(active["attempt"]["id"]))
    detail = client.get(f"{MON}/sessions/{active['attempt']['id']}", headers=admin_headers(helpers)).json()
    assert delta["session"]["ai"] == {k: detail["ai"][k] for k in delta["session"]["ai"]}
    assert session_row(db, active["attempt"]) is not None
