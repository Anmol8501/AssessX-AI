"""Phase 4B: the proctoring event log.

What is asserted: the server records the session's own lifecycle and device changes; the candidate's
app can report environment observations for its own active session only; every request is
validated against a fixed taxonomy and a per-type field allow-list; the server owns every timestamp,
category and source; retries and repeats do not multiply rows; and nothing can edit or delete an
event.
"""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.base import utcnow
from app.models.proctoring_event import (
    ProctoringEvent,
    ProctoringEventCategory,
    ProctoringEventSource,
    ProctoringEventType,
)
from app.services import proctoring_events
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, start
from tests.test_exam_session import submit, wind_clock_past_deadline
from tests.test_proctoring import (
    READY,
    activate,
    intruder,
    proctored_exam,
    report,
    session_row,
    unproctored_exam,
)

PASTE = {
    "event_type": "PASTE_ATTEMPT",
    "metadata": {"shortcut": "CTRL+V", "blocked": True, "channel": "keyboard"},
}


def post_event(client, headers, attempt_id: str, body: dict, expect: int = 201, **extra):
    payload = {"client_event_id": str(uuid.uuid4()), **body, **extra}
    response = client.post(f"{ME}/attempts/{attempt_id}/proctoring/events", json=payload, headers=headers)
    assert response.status_code == expect, response.text
    return response.json()


def events_of(db, attempt: dict) -> list[ProctoringEvent]:
    session = session_row(db, attempt)
    return list(
        db.scalars(
            select(ProctoringEvent)
            .where(ProctoringEvent.session_id == session.id)
            .order_by(ProctoringEvent.recorded_at)
        )
    )


def types_of(db, attempt: dict) -> list[str]:
    return [event.event_type.value for event in events_of(db, attempt)]


@pytest.fixture
def active(client, helpers: Helpers, users):
    """A proctored attempt whose session is active, and the candidate's headers."""
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return {"exam": exam, "attempt": attempt, "headers": headers}


# -- recorded by the server -------------------------------------------------------------------------


def test_activation_records_session_started(client, db, active):
    assert types_of(db, active["attempt"]) == ["SESSION_STARTED"]
    [event] = events_of(db, active["attempt"])
    assert event.source is ProctoringEventSource.SERVER
    assert event.category is ProctoringEventCategory.SESSION


def test_resuming_records_session_resumed_not_a_second_start(client, db, active):
    activate(client, active["headers"], active["attempt"]["id"])

    assert types_of(db, active["attempt"]) == ["SESSION_STARTED", "SESSION_RESUMED"]


def test_submitting_records_session_ended_at_the_finalization_time(client, db, active):
    finished = submit(client, active["headers"], active["attempt"]["id"])

    ended = events_of(db, active["attempt"])[-1]
    assert ended.event_type is ProctoringEventType.SESSION_ENDED
    assert ended.details == {"attempt_status": "SUBMITTED"}
    assert ended.recorded_at.isoformat() == finished["proctoring"]["ended_at"].replace("Z", "+00:00")


def test_a_timeout_records_session_ended_at_the_deadline(client, db, active):
    session_row(db, active["attempt"]).started_at = utcnow() - timedelta(minutes=10)
    row = wind_clock_past_deadline(db, active["attempt"], seconds_ago=3)

    client.get(f"{ME}/attempts/{active['attempt']['id']}/proctoring", headers=active["headers"])

    # Looked up by type: the simulated deadline sits before the (real-time) SESSION_STARTED row.
    [ended] = [
        e for e in events_of(db, active["attempt"]) if e.event_type is ProctoringEventType.SESSION_ENDED
    ]
    assert ended.details == {"attempt_status": "TIME_EXPIRED"}
    assert ended.recorded_at == row.expires_at


def test_device_changes_become_device_events(client, db, active):
    attempt_id = active["attempt"]["id"]
    report(client, active["headers"], attempt_id, {"camera": "UNAVAILABLE", "microphone": "READY"})
    report(client, active["headers"], attempt_id, {"camera": "DENIED", "microphone": "READY"})  # still lost
    report(client, active["headers"], attempt_id, READY)
    report(client, active["headers"], attempt_id, {"camera": "READY", "microphone": "NOT_READY"})

    device = [e for e in events_of(db, active["attempt"]) if e.category is ProctoringEventCategory.DEVICE]
    assert [(e.event_type.value, e.details) for e in device] == [
        ("CAMERA_DISCONNECTED", {"state": "UNAVAILABLE"}),
        ("CAMERA_RECONNECTED", {"state": "READY"}),
        ("MIC_DISCONNECTED", {"state": "NOT_READY"}),
    ]


# -- reported by the client -----------------------------------------------------------------------


def test_an_observed_event_is_recorded_with_server_owned_fields(client, db, active):
    body = post_event(client, active["headers"], active["attempt"]["id"], PASTE)

    assert body["event_type"] == "PASTE_ATTEMPT"
    assert body["category"] == "INPUT"
    assert body["source"] == "CLIENT"
    assert body["metadata"] == PASTE["metadata"]
    row = events_of(db, active["attempt"])[-1]
    assert row.source is ProctoringEventSource.CLIENT
    assert abs(row.recorded_at - utcnow()) < timedelta(seconds=30)


@pytest.mark.parametrize(
    ("event_type", "metadata"),
    [
        ("FULLSCREEN_ENTER", {"reason": "exam-start"}),
        ("FULLSCREEN_EXIT", {"previous_state": "fullscreen", "current_state": "windowed", "reason": "user"}),
        ("FULLSCREEN_RESTORED", {"reason": "focus-regained"}),
        ("FOCUS_LOST", {"reason": "deactivated"}),
        ("FOCUS_REGAINED", {"duration_ms": 4200}),
        ("COPY_ATTEMPT", {"shortcut": "CTRL+C", "blocked": True, "channel": "keyboard"}),
        ("CUT_ATTEMPT", {"blocked": True, "channel": "clipboard-event"}),
        ("CLIPBOARD_ACCESS_ATTEMPT", {"shortcut": "WIN+V", "blocked": True, "channel": "native-hook"}),
        ("CONTEXT_MENU_ATTEMPT", {"blocked": True, "channel": "pointer"}),
        ("PRINT_ATTEMPT", {"shortcut": "CTRL+P", "blocked": True, "channel": "keyboard"}),
        ("DEVTOOLS_ATTEMPT", {"shortcut": "CTRL+SHIFT+I", "blocked": True, "channel": "keyboard"}),
        ("KEYBOARD_RESTRICTION_ATTEMPT", {"shortcut": "ALT+TAB", "blocked": True, "channel": "native-hook"}),
        ("SCREEN_CAPTURE_ATTEMPT", {"shortcut": "PRINTSCREEN", "blocked": True, "channel": "native-hook"}),
        ("MULTIPLE_MONITORS_DETECTED", {"display_count": 2}),
        ("DISPLAY_CONFIGURATION_CHANGED", {"display_count": 1, "previous_display_count": 2}),
        ("REMOTE_SESSION_DETECTED", {}),
        (
            "ENFORCEMENT_STATUS",
            {"capabilities": {"fullscreen": "ACTIVE", "capture_protection": "UNAVAILABLE"}},
        ),
    ],
)
def test_every_client_event_type_is_accepted_with_its_fields(client, active, event_type, metadata):
    body = post_event(
        client, active["headers"], active["attempt"]["id"], {"event_type": event_type, "metadata": metadata}
    )

    assert body["event_type"] == event_type
    assert body["metadata"] == metadata


@pytest.mark.parametrize(
    "event_type",
    ["SESSION_STARTED", "SESSION_ENDED", "SESSION_RESUMED", "CAMERA_DISCONNECTED", "MIC_RECONNECTED"],
)
def test_server_owned_events_cannot_be_reported_by_the_client(client, db, active, event_type):
    post_event(client, active["headers"], active["attempt"]["id"], {"event_type": event_type}, expect=422)

    assert types_of(db, active["attempt"]) == ["SESSION_STARTED"]


def test_an_unknown_event_type_is_rejected(client, active):
    post_event(
        client, active["headers"], active["attempt"]["id"], {"event_type": "CANDIDATE_CHEATED"}, expect=422
    )


@pytest.mark.parametrize(
    "metadata",
    [
        {"clipboard_text": "the answer is B"},  # not an accepted field at all
        {"shortcut": "CTRL+V", "typed": "secret"},  # one good field does not excuse a bad one
        {"shortcut": "ctrl+v; DROP TABLE"},  # outside the shortcut vocabulary
        {"blocked": "yes"},  # wrong type
        {"channel": "telepathy"},  # outside the channel vocabulary
        {"display_count": 2},  # a field that belongs to a different event type
    ],
)
def test_metadata_outside_the_allow_list_is_rejected(client, db, active, metadata):
    post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "PASTE_ATTEMPT", "metadata": metadata},
        expect=422,
    )

    assert types_of(db, active["attempt"]) == ["SESSION_STARTED"]


@pytest.mark.parametrize(
    "forged",
    [
        {"severity": "CRITICAL"},
        {"candidate_cheated": True},
        {"candidate_id": str(uuid.uuid4())},
        {"recorded_at": "2020-01-01T00:00:00Z"},
        {"source": "SERVER"},
        {"category": "SESSION"},
    ],
)
def test_the_client_cannot_set_fields_the_server_owns(client, db, active, forged):
    post_event(client, active["headers"], active["attempt"]["id"], PASTE, expect=422, **forged)

    assert types_of(db, active["attempt"]) == ["SESSION_STARTED"]


def test_capability_reports_are_limited_to_known_capabilities_and_statuses(client, active):
    attempt_id = active["attempt"]["id"]
    for capabilities in ({"webcam_hack": "ACTIVE"}, {"fullscreen": "ENFORCED"}, {}):
        post_event(
            client,
            active["headers"],
            attempt_id,
            {"event_type": "ENFORCEMENT_STATUS", "metadata": {"capabilities": capabilities}},
            expect=422,
        )


# -- timestamps -----------------------------------------------------------------------------------


def test_a_plausible_client_time_is_kept_alongside_the_server_time(client, db, active):
    reported = (utcnow() - timedelta(seconds=20)).isoformat()

    body = post_event(client, active["headers"], active["attempt"]["id"], PASTE, client_reported_at=reported)

    assert body["client_reported_at"] is not None
    assert body["recorded_at"] > body["client_reported_at"]  # the server's own time stands


def test_an_implausible_client_time_is_discarded_not_trusted(client, db, active):
    forged_times = ("2001-01-01T00:00:00+00:00", (utcnow() + timedelta(days=2)).isoformat())
    # Two different event types, so the second is not folded into the first as a repeat.
    for event_type, forged in zip(("FOCUS_LOST", "PRINT_ATTEMPT"), forged_times, strict=True):
        body = post_event(
            client,
            active["headers"],
            active["attempt"]["id"],
            {"event_type": event_type},
            client_reported_at=forged,
        )
        assert body["client_reported_at"] is None
        assert abs(events_of(db, active["attempt"])[-1].recorded_at - utcnow()) < timedelta(seconds=30)


# -- retries, repeats and limits --------------------------------------------------------------------


def test_a_retried_event_returns_the_original_and_adds_no_row(client, db, active):
    event_id = str(uuid.uuid4())
    first = post_event(client, active["headers"], active["attempt"]["id"], PASTE, client_event_id=event_id)
    retry = post_event(
        client, active["headers"], active["attempt"]["id"], PASTE, expect=200, client_event_id=event_id
    )

    assert retry["id"] == first["id"]
    assert types_of(db, active["attempt"]).count("PASTE_ATTEMPT") == 1


def test_an_identical_burst_is_recorded_once(client, db, active):
    """Holding Ctrl+V fires repeatedly; that is one observation, not a hundred."""
    ids = {post_event(client, active["headers"], active["attempt"]["id"], PASTE)["id"]}
    for _ in range(5):
        ids.add(post_event(client, active["headers"], active["attempt"]["id"], PASTE, expect=200)["id"])

    assert len(ids) == 1
    assert types_of(db, active["attempt"]).count("PASTE_ATTEMPT") == 1


def test_different_details_are_not_folded_together(client, db, active):
    attempt_id = active["attempt"]["id"]
    post_event(client, active["headers"], attempt_id, PASTE)
    post_event(
        client,
        active["headers"],
        attempt_id,
        {
            "event_type": "PASTE_ATTEMPT",
            "metadata": {"shortcut": "SHIFT+INSERT", "blocked": True, "channel": "keyboard"},
        },
    )

    assert types_of(db, active["attempt"]).count("PASTE_ATTEMPT") == 2


def test_a_session_has_an_event_ceiling(client, db, active, monkeypatch):
    monkeypatch.setattr(proctoring_events, "MAX_EVENTS_PER_SESSION", 3)  # SESSION_STARTED is one
    attempt_id = active["attempt"]["id"]
    post_event(client, active["headers"], attempt_id, PASTE)
    post_event(client, active["headers"], attempt_id, {"event_type": "FOCUS_LOST", "metadata": {}})

    response = client.post(
        f"{ME}/attempts/{attempt_id}/proctoring/events",
        json={"client_event_id": str(uuid.uuid4()), "event_type": "PRINT_ATTEMPT"},
        headers=active["headers"],
    )

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "event_limit_reached"


# -- when events are accepted ---------------------------------------------------------------------


def test_events_are_refused_before_the_session_is_active(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    response = client.post(
        f"{ME}/attempts/{attempt['id']}/proctoring/events",
        json={"client_event_id": str(uuid.uuid4()), **PASTE},
        headers=headers,
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "proctoring_not_active"


def test_events_are_refused_once_the_attempt_has_ended(client, db, active):
    submit(client, active["headers"], active["attempt"]["id"])

    response = client.post(
        f"{ME}/attempts/{active['attempt']['id']}/proctoring/events",
        json={"client_event_id": str(uuid.uuid4()), **PASTE},
        headers=active["headers"],
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "attempt_locked"
    assert types_of(db, active["attempt"])[-1] == "SESSION_ENDED"


def test_an_unproctored_attempt_has_no_event_log(client, helpers: Helpers, users):
    exam = unproctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])

    post_event(client, headers, attempt["id"], PASTE, expect=404)


# -- ownership and immutability ---------------------------------------------------------------------


def test_another_candidate_cannot_add_events_to_a_session(client, helpers: Helpers, db, active):
    other = intruder(client, helpers, active["exam"])

    post_event(client, other, active["attempt"]["id"], PASTE, expect=404)

    assert types_of(db, active["attempt"]) == ["SESSION_STARTED"]


def test_an_admin_cannot_use_the_candidate_event_route(client, helpers: Helpers, active):
    post_event(client, admin_headers(helpers), active["attempt"]["id"], PASTE, expect=403)


def test_the_event_route_requires_authentication(client, active):
    response = client.post(
        f"{ME}/attempts/{active['attempt']['id']}/proctoring/events",
        json={"client_event_id": str(uuid.uuid4()), **PASTE},
    )

    assert response.status_code == 401


def test_events_cannot_be_read_changed_or_deleted_through_the_api(client, db, active):
    body = post_event(client, active["headers"], active["attempt"]["id"], PASTE)
    base = f"{ME}/attempts/{active['attempt']['id']}/proctoring/events"

    for method, path in (
        ("GET", base),
        ("PUT", f"{base}/{body['id']}"),
        ("PATCH", f"{base}/{body['id']}"),
        ("DELETE", f"{base}/{body['id']}"),
        ("DELETE", base),
    ):
        assert client.request(method, path, headers=active["headers"]).status_code in {404, 405}

    assert types_of(db, active["attempt"]) == ["SESSION_STARTED", "PASTE_ATTEMPT"]


# -- the development-only event view ------------------------------------------------------------


def test_the_dev_event_view_is_admin_only(client, helpers: Helpers, active):
    path = f"/api/v1/dev/attempts/{active['attempt']['id']}/proctoring-events"

    assert client.get(path).status_code == 401
    assert client.get(path, headers=active["headers"]).status_code == 403
    events = client.get(path, headers=admin_headers(helpers)).json()
    assert [e["event_type"] for e in events] == ["SESSION_STARTED"]


def test_the_dev_event_view_does_not_exist_in_production(monkeypatch):
    from app.core.config import Settings, get_settings
    from app.main import create_app

    production = Settings(**{**get_settings().model_dump(), "app_env": "production"})
    monkeypatch.setattr("app.main.get_settings", lambda: production)

    paths = {route.path for route in create_app().routes}

    assert "/api/v1/dev/attempts/{attempt_id}/proctoring-events" not in paths
    assert "/api/v1/candidates/me/attempts/{attempt_id}/proctoring/events" in paths


# -- device readiness (4B.5) ------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("event_type", "metadata"),
    [
        ("DEVICE_CHECK_STARTED", {}),
        ("PROHIBITED_APP_DETECTED", {"app": "chrome", "app_category": "browser"}),
        ("APP_CLOSE_REQUESTED", {"app": "notepad"}),
        ("APP_CLOSED", {"app": "notepad"}),
        ("APP_CLOSE_FAILED", {"app": "discord"}),
        ("DEVICE_CHECK_PASSED", {"app_count": 0}),
        ("DEVICE_CHECK_FAILED", {"app_count": 2}),
        ("ENFORCEMENT_STATUS", {"capabilities": {"fullscreen": "ACTIVE"}, "security_mode": "STANDARD"}),
    ],
)
def test_device_readiness_events_are_accepted(client, db, active, event_type, metadata):
    body = post_event(
        client, active["headers"], active["attempt"]["id"], {"event_type": event_type, "metadata": metadata}
    )

    assert body["metadata"] == metadata
    assert body["category"] == "SYSTEM"
    assert body["source"] == "CLIENT"


@pytest.mark.parametrize(
    "metadata",
    [
        {"app": "C:\Program Files\Google\Chrome\chrome.exe"},  # a path, not a policy id
        {"app": "Google Chrome - Inbox (3)"},  # a window title
        {"app": "chrome", "app_category": "suspicious"},  # outside the category vocabulary
        {"app": "chrome", "command_line": "--incognito"},  # not an accepted field
    ],
)
def test_readiness_metadata_names_an_app_only_by_its_policy_id(client, db, active, metadata):
    post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "PROHIBITED_APP_DETECTED", "metadata": metadata},
        expect=422,
    )

    assert types_of(db, active["attempt"]) == ["SESSION_STARTED"]


def test_readiness_events_follow_the_session_rules(client, helpers: Helpers, users):
    """Same boundaries as every other event: not before activation, not for someone else."""
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    body = {"event_type": "DEVICE_CHECK_PASSED", "metadata": {"app_count": 0}}

    post_event(client, headers, attempt["id"], body, expect=409)  # session not active yet
    activate(client, headers, attempt["id"])
    post_event(client, headers, attempt["id"], body)
    post_event(client, intruder(client, helpers, exam), attempt["id"], body, expect=404)
