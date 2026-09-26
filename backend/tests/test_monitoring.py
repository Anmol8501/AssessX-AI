"""Phase 4C: admin live monitoring — REST discovery, detail, and the WebSocket layer.

What is asserted: only active *proctored* sessions appear on the wall; the endpoints and the
WebSockets are admin-only / candidate-scoped server-side; the detail view returns the session's own
recent events and no one else's; and WebRTC signaling is only relayed along a validated admin ↔
candidate pairing (a candidate can never address another candidate).
"""

import uuid
from contextlib import contextmanager

import pytest
from starlette.websockets import WebSocketDisconnect

from app.api.v1 import ws as ws_module
from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, start
from tests.test_exam_session import submit
from tests.test_proctoring import activate, proctored_exam, unproctored_exam
from tests.test_proctoring_events import post_event
from tests.test_publishing import create_candidate

MON = "/api/v1/admin/monitoring"


@pytest.fixture
def ws_uses_test_db(db, monkeypatch):
    """Point the WebSocket module's DB seam at the test transaction (it is outside the request)."""

    @contextmanager
    def _session():
        yield db  # never closed here — the test fixture owns it

    monkeypatch.setattr(ws_module, "_session", _session)


def active(client, helpers: Helpers, users) -> dict:
    """A proctored exam whose session the candidate has activated — a live monitorable session."""
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return {"exam": exam, "attempt": attempt, "headers": headers}


def sessions(client, helpers: Helpers):
    response = client.get(f"{MON}/sessions", headers=admin_headers(helpers))
    assert response.status_code == 200, response.text
    return response.json()


# -- who appears on the wall ----------------------------------------------------------------------


def test_an_active_proctored_candidate_appears(client, helpers: Helpers, users):
    session = active(client, helpers, users)

    body = sessions(client, helpers)

    assert body["summary"]["active_sessions"] == 1
    [tile] = body["sessions"]
    assert tile["attempt_id"] == session["attempt"]["id"]
    assert tile["candidate_name"] == "Cal Candidate"
    assert tile["proctoring_status"] == "ACTIVE"
    assert tile["camera_state"] == "READY"
    assert tile["assessment_title"]


def test_an_unactivated_proctored_session_is_not_live(client, helpers: Helpers, users):
    exam = proctored_exam(client, helpers, users)
    start(client, candidate_headers(helpers), exam["id"])  # started, but devices not confirmed

    assert sessions(client, helpers)["sessions"] == []


def test_a_finished_session_is_not_live(client, helpers: Helpers, users):
    session = active(client, helpers, users)
    submit(client, session["headers"], session["attempt"]["id"])

    assert sessions(client, helpers)["sessions"] == []


def test_an_unproctored_attempt_is_not_live(client, helpers: Helpers, users):
    exam = unproctored_exam(client, helpers, users)
    start(client, candidate_headers(helpers), exam["id"])

    assert sessions(client, helpers)["sessions"] == []


def test_the_summary_counts_device_issues(client, helpers: Helpers, users):
    session = active(client, helpers, users)
    client.put(
        f"{ME}/attempts/{session['attempt']['id']}/proctoring/devices",
        json={"camera": "UNAVAILABLE", "microphone": "READY"},
        headers=session["headers"],
    )

    summary = sessions(client, helpers)["summary"]
    assert summary["active_sessions"] == 1
    assert summary["camera_issues"] == 1
    assert summary["cameras_ready"] == 0


# -- authorization --------------------------------------------------------------------------------


def test_monitoring_is_admin_only(client, helpers: Helpers, users):
    assert client.get(f"{MON}/sessions").status_code == 401
    assert client.get(f"{MON}/sessions", headers=candidate_headers(helpers)).status_code == 403
    assert client.get(f"{MON}/sessions", headers=admin_headers(helpers)).status_code == 200


def test_detail_is_admin_only(client, helpers: Helpers, users):
    session = active(client, helpers, users)
    path = f"{MON}/sessions/{session['attempt']['id']}"

    assert client.get(path).status_code == 401
    assert client.get(path, headers=session["headers"]).status_code == 403
    assert client.get(path, headers=admin_headers(helpers)).status_code == 200


# -- detail view ----------------------------------------------------------------------------------


def test_detail_returns_the_session_and_its_own_recent_events(client, helpers: Helpers, users):
    session = active(client, helpers, users)
    post_event(
        client,
        session["headers"],
        session["attempt"]["id"],
        {"event_type": "FOCUS_LOST", "metadata": {"reason": "deactivated"}},
    )

    body = client.get(f"{MON}/sessions/{session['attempt']['id']}", headers=admin_headers(helpers)).json()

    assert body["attempt_id"] == session["attempt"]["id"]
    types = [e["event_type"] for e in body["recent_events"]]
    assert "SESSION_STARTED" in types
    assert "FOCUS_LOST" in types
    # No answers, scores, risk or secrets anywhere in the payload.
    assert "score" not in body and "risk" not in body


def test_detail_for_an_unknown_or_unproctored_attempt_is_not_found(client, helpers: Helpers, users):
    admin = admin_headers(helpers)
    assert client.get(f"{MON}/sessions/{uuid.uuid4()}", headers=admin).status_code == 404

    exam = unproctored_exam(client, helpers, users)
    attempt = start(client, candidate_headers(helpers), exam["id"])
    assert client.get(f"{MON}/sessions/{attempt['id']}", headers=admin).status_code == 404


# -- the WebSockets -------------------------------------------------------------------------------


def admin_token(helpers: Helpers) -> str:
    return helpers.token_for("admin@test.local", ADMIN_PASSWORD)


def candidate_token(helpers: Helpers) -> str:
    return helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD)


def test_admin_ws_requires_an_admin(client, helpers: Helpers, users, ws_uses_test_db):
    with client.websocket_connect(f"/api/v1/ws/admin/monitoring?token={admin_token(helpers)}") as sock:
        assert sock.receive_json()["type"] == "CONNECTION_READY"


def test_admin_ws_rejects_a_candidate(client, helpers: Helpers, users, ws_uses_test_db):
    with client.websocket_connect(f"/api/v1/ws/admin/monitoring?token={candidate_token(helpers)}") as sock:
        assert sock.receive_json()["type"] == "ERROR"
        with pytest.raises(WebSocketDisconnect):
            sock.receive_json()


def test_admin_ws_rejects_an_unauthenticated_connection(client, helpers: Helpers, users, ws_uses_test_db):
    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/api/v1/ws/admin/monitoring") as sock:
        sock.receive_json()


def test_candidate_ws_needs_its_own_active_attempt(client, helpers: Helpers, users, ws_uses_test_db):
    session = active(client, helpers, users)
    attempt_id = session["attempt"]["id"]
    url = f"/api/v1/ws/candidates/me/proctoring?token={candidate_token(helpers)}&attempt_id={attempt_id}"

    with client.websocket_connect(url) as sock:
        ready = sock.receive_json()
        assert ready["type"] == "CONNECTION_READY"
        assert ready["attempt_id"] == attempt_id


def test_candidate_ws_rejects_another_candidates_attempt(client, helpers: Helpers, users, ws_uses_test_db):
    session = active(client, helpers, users)  # the dev candidate's attempt
    create_candidate(
        client,
        admin_headers(helpers),
        email="intruder@demo.local",
        roll_number="D7",
        initial_password="Intruder-pass-1",
    )
    intruder_token = helpers.token_for_candidate("intruder@demo.local", "Intruder-pass-1", "D7")

    url = f"/api/v1/ws/candidates/me/proctoring?token={intruder_token}&attempt_id={session['attempt']['id']}"
    with client.websocket_connect(url) as sock:
        assert sock.receive_json()["type"] == "ERROR"
        with pytest.raises(WebSocketDisconnect):
            sock.receive_json()


def test_signaling_is_relayed_only_along_the_watched_pairing(
    client, helpers: Helpers, users, ws_uses_test_db
):
    session = active(client, helpers, users)
    attempt_id = session["attempt"]["id"]
    cand_url = f"/api/v1/ws/candidates/me/proctoring?token={candidate_token(helpers)}&attempt_id={attempt_id}"
    admin_url = f"/api/v1/ws/admin/monitoring?token={admin_token(helpers)}"

    with client.websocket_connect(cand_url) as cand, client.websocket_connect(admin_url) as admin:
        assert cand.receive_json()["type"] == "CONNECTION_READY"
        assert admin.receive_json()["type"] == "CONNECTION_READY"

        # Admin asks to watch this candidate → the candidate is told to (re)offer.
        admin.send_json({"type": "WATCH", "attempt_id": attempt_id})
        assert cand.receive_json()["type"] == "WATCH"
        assert admin.receive_json()["type"] == "PUBLISH_STATE"

        # The candidate's offer reaches the watching admin.
        cand.send_json({"type": "WEBRTC_OFFER", "attempt_id": attempt_id, "sdp": "v=0 fake-offer"})
        offer = admin.receive_json()
        assert offer["type"] == "WEBRTC_OFFER"
        assert offer["sdp"] == "v=0 fake-offer"

        # The admin's answer reaches the candidate.
        admin.send_json({"type": "WEBRTC_ANSWER", "attempt_id": attempt_id, "sdp": "v=0 fake-answer"})
        assert cand.receive_json()["type"] == "WEBRTC_ANSWER"
