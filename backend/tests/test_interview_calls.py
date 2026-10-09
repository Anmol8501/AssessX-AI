"""Phase 7D: live video interview calls — REST lifecycle, access, privacy, and the signaling WebSocket.

What is asserted: a LIVE interview publishes without a question bank and refuses an AI session; an
administrator opens one call per assignment (opening again returns it), only for a published LIVE
interview and an assigned candidate; only that candidate can read and join it (another candidate gets 404,
an administrator 403 on candidate routes); the interviewer's notes are immutable, never shown to the
candidate and never logged; ending is idempotent, recorded, and a later call is a new record; on the
WebSocket, only the call's two sides connect (anyone else is refused, a second interviewer is told the call
is occupied), offers only flow candidate → interviewer and answers only the other way, ICE and media
state are relayed to the other side only, chat is stored then delivered to both, oversized input is
dropped, and ending the call disconnects both sides. No media is stored anywhere.
"""

import uuid
from contextlib import contextmanager

import pytest
from sqlalchemy import func, select

from app.api.v1 import ws_calls
from app.models.audit_log import AuditLog
from app.models.interview_call import InterviewCall, InterviewCallMessage
from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_interview_config import BASE, ME, add_question, assign, call, create
from tests.test_publishing import create_candidate


@pytest.fixture
def ws_calls_use_test_db(db, monkeypatch):
    @contextmanager
    def _session():
        yield db

    monkeypatch.setattr(ws_calls, "_session", _session)
    from app.realtime import security as socket_security

    monkeypatch.setattr(socket_security, "db_session", _session)


@pytest.fixture
def admin(helpers: Helpers, users):
    return admin_headers(helpers)


@pytest.fixture
def candidate(helpers: Helpers, users):
    return candidate_headers(helpers)


@pytest.fixture
def live(client, admin, users):
    interview = create(
        client, admin, format="LIVE", question_count=1, max_follow_ups=0, follow_ups_enabled=False
    )
    add_question(
        client, admin, interview["id"], text="Walk me through a project you led.", expected_concepts=["scope"]
    )
    call(client, "POST", f"{BASE}/{interview['id']}/publish", admin, 200)
    assign(client, admin, interview["id"], users["candidate"].id)
    return interview


def open_call(client, admin, interview, users, expect=201) -> dict:
    return call(
        client, "POST", f"{BASE}/{interview['id']}/assignments/{users['candidate'].id}/call", admin, expect
    )


def actions(db) -> list[str]:
    return [
        r.action.value
        for r in db.scalars(select(AuditLog).order_by(AuditLog.occurred_at))
        if "CALL" in r.action.value
    ]


# -- the LIVE format -----------------------------------------------------------------------------------


def test_a_live_interview_publishes_without_questions_and_refuses_an_ai_session(
    client, admin, candidate, users
):
    interview = create(
        client, admin, format="LIVE", question_count=1, max_follow_ups=0, follow_ups_enabled=False
    )
    assert interview["format"] == "LIVE" and interview["issues"] == []
    call(client, "POST", f"{BASE}/{interview['id']}/publish", admin, 200)
    assign(client, admin, interview["id"], users["candidate"].id)
    error = call(client, "POST", f"{ME}/interviews/{interview['id']}/session", candidate, 409)
    assert error["error"]["code"] == "live_interview"
    [listed] = call(client, "GET", f"{ME}/interviews", candidate, 200)
    assert listed["format"] == "LIVE" and listed["open_call_id"] is None
    assert create(client, admin)["format"] == "AI"  # the default stays the AI interview


# -- opening, joining, notes, ending -------------------------------------------------------------------


def test_one_call_per_assignment_and_only_for_a_published_live_interview(client, db, admin, users, live):
    first = open_call(client, admin, live, users)
    assert first["status"] == "OPEN" and first["opened_by"]["id"] == str(users["admin"].id)
    assert first["candidate_joined_at"] is None and first["messages"] == [] and first["notes"] == []
    again = open_call(client, admin, live, users, expect=200)
    assert again["call_id"] == first["call_id"]
    [row] = call(client, "GET", f"{BASE}/{live['id']}/assignments", admin, 200)
    assert row["open_call_id"] == first["call_id"]

    ai = create(client, admin, title="AI", question_count=1, max_follow_ups=0, follow_ups_enabled=False)
    add_question(client, admin, ai["id"])
    call(client, "POST", f"{BASE}/{ai['id']}/publish", admin, 200)
    assign(client, admin, ai["id"], users["candidate"].id)
    call(client, "POST", f"{BASE}/{ai['id']}/assignments/{users['candidate'].id}/call", admin, 409)
    draft = create(
        client,
        admin,
        format="LIVE",
        title="Draft",
        question_count=1,
        max_follow_ups=0,
        follow_ups_enabled=False,
    )
    call(client, "POST", f"{BASE}/{draft['id']}/assignments/{users['candidate'].id}/call", admin, 409)
    call(
        client, "POST", f"{BASE}/{live['id']}/assignments/{users['admin'].id}/call", admin, 404
    )  # not assigned
    assert actions(db) == ["INTERVIEW_CALL_OPENED"]


def test_only_the_assigned_candidate_reads_and_joins(
    client, db, helpers: Helpers, admin, candidate, users, live
):
    opened = open_call(client, admin, live, users)
    [listed] = call(client, "GET", f"{ME}/interviews", candidate, 200)
    assert listed["open_call_id"] == opened["call_id"]
    url = f"{ME}/interview-calls/{opened['call_id']}"
    joined = call(client, "POST", f"{url}/join", candidate, 200)
    assert joined["status"] == "OPEN" and joined["interviewer_name"] == users["admin"].name
    call(client, "POST", f"{url}/join", candidate, 200)  # a rejoin is not a new record
    assert actions(db) == ["INTERVIEW_CALL_OPENED", "INTERVIEW_CALL_JOINED"]
    assert db.get(InterviewCall, uuid.UUID(opened["call_id"])).candidate_joined_at is not None

    other = create_candidate(
        client, admin, email="o@demo.local", roll_number="O1", initial_password="Other-pass-123"
    )
    assign(client, admin, live["id"], other["id"])
    intruder = helpers.bearer(helpers.token_for_candidate("o@demo.local", "Other-pass-123", "O1"))
    call(client, "GET", url, intruder, 404)
    call(client, "POST", f"{url}/join", intruder, 404)
    call(client, "GET", url, admin, 403)
    call(client, "GET", url, None, 401)
    call(client, "GET", f"{ME}/interview-calls/{uuid.uuid4()}", candidate, 404)


def test_interviewer_notes_are_private_immutable_and_not_logged(
    client, db, admin, candidate, users, live, caplog
):
    opened = open_call(client, admin, live, users)
    secret = "Strong ownership story; probe estimation next time."
    noted = call(
        client, "POST", f"{BASE}/{live['id']}/calls/{opened['call_id']}/notes", admin, 201, {"body": secret}
    )
    assert noted["notes"][0]["body"] == secret and noted["notes"][0]["authored_by"] == "HUMAN"
    seen = call(client, "GET", f"{ME}/interview-calls/{opened['call_id']}", candidate, 200)
    assert "notes" not in seen and secret not in str(seen)
    for method in ("PATCH", "PUT", "DELETE"):
        response = client.request(
            method, f"{BASE}/{live['id']}/calls/{opened['call_id']}/notes", headers=admin
        )
        assert response.status_code == 405
    call(
        client, "POST", f"{BASE}/{live['id']}/calls/{opened['call_id']}/notes", candidate, 403, {"body": "x"}
    )
    call(
        client,
        "POST",
        f"{BASE}/{live['id']}/calls/{opened['call_id']}/notes",
        admin,
        422,
        {"body": "x", "author_id": "y"},
    )
    assert secret not in str([r.details for r in db.scalars(select(AuditLog))]) and secret not in caplog.text


def test_ending_is_recorded_idempotent_and_a_later_call_is_new(client, db, admin, candidate, users, live):
    opened = open_call(client, admin, live, users)
    url = f"{BASE}/{live['id']}/calls/{opened['call_id']}"
    call(client, "POST", f"{url}/end", candidate, 403)  # the candidate leaves; only the interviewer ends
    ended = call(client, "POST", f"{url}/end", admin, 200)
    assert ended["status"] == "ENDED" and ended["ended_by"]["id"] == str(users["admin"].id)
    assert call(client, "POST", f"{url}/end", admin, 200)["ended_at"] == ended["ended_at"]
    error = call(client, "POST", f"{ME}/interview-calls/{opened['call_id']}/join", candidate, 409)
    assert error["error"]["code"] == "call_ended"
    second = open_call(client, admin, live, users)
    assert second["call_id"] != opened["call_id"]
    history = call(client, "GET", f"{BASE}/{live['id']}/calls", admin, 200)
    assert [h["status"] for h in history] == ["OPEN", "ENDED"]
    other = create(
        client,
        admin,
        format="LIVE",
        title="Other",
        question_count=1,
        max_follow_ups=0,
        follow_ups_enabled=False,
    )
    call(
        client, "GET", f"{BASE}/{other['id']}/calls/{opened['call_id']}", admin, 404
    )  # through its own interview only


# -- the signaling WebSocket ---------------------------------------------------------------------------


def ws_url(call_id: str, token: str) -> str:
    return f"/api/v1/ws/interview-calls/{call_id}?token={token}"


def tokens(helpers: Helpers) -> tuple[str, str]:
    return (
        helpers.token_for("admin@test.local", ADMIN_PASSWORD),
        helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD),
    )


@pytest.mark.usefixtures("ws_calls_use_test_db")
def test_signaling_flows_only_between_the_two_sides(client, helpers: Helpers, admin, users, live):
    opened = open_call(client, admin, live, users)
    admin_token, cand_token = tokens(helpers)
    with client.websocket_connect(ws_url(opened["call_id"], admin_token)) as interviewer:
        ready = interviewer.receive_json()
        assert ready == {"type": "READY", "role": "interviewer", "peer_present": False}
        with client.websocket_connect(ws_url(opened["call_id"], cand_token)) as cand:
            assert cand.receive_json() == {"type": "READY", "role": "candidate", "peer_present": True}
            assert interviewer.receive_json() == {"type": "PEER_JOINED", "role": "candidate"}

            # Offers only from the candidate; answers only from the interviewer.
            interviewer.send_json({"type": "OFFER", "sdp": "v=0 forged", "offer_id": "x"})
            cand.send_json({"type": "OFFER", "sdp": "v=0 candidate-offer", "offer_id": "o-1"})
            assert interviewer.receive_json() == {
                "type": "OFFER",
                "sdp": "v=0 candidate-offer",
                "offer_id": "o-1",
            }
            cand.send_json({"type": "ANSWER", "sdp": "v=0 forged"})
            interviewer.send_json({"type": "ANSWER", "sdp": "v=0 answer", "offer_id": "o-1"})
            assert cand.receive_json() == {"type": "ANSWER", "sdp": "v=0 answer", "offer_id": "o-1"}

            cand.send_json({"type": "ICE", "candidate": "candidate:1 udp", "offer_id": "o-1"})
            assert interviewer.receive_json()["candidate"] == "candidate:1 udp"
            interviewer.send_json({"type": "ICE", "candidate": "x" * 200_001})  # oversized: dropped
            interviewer.send_json(
                {"type": "MEDIA_STATE", "audio": False, "video": True, "screen": True, "extra": 1}
            )
            assert cand.receive_json() == {
                "type": "MEDIA_STATE",
                "role": "interviewer",
                "audio": False,
                "video": True,
                "screen": True,
            }
            # Only the interviewer may ask for a fresh offer; the candidate's request is dropped.
            cand.send_json({"type": "RENEGOTIATE"})
            interviewer.send_json({"type": "RENEGOTIATE", "extra": "x"})
            assert cand.receive_json() == {"type": "RENEGOTIATE"}
        assert interviewer.receive_json() == {"type": "PEER_LEFT", "role": "candidate"}


@pytest.mark.usefixtures("ws_calls_use_test_db")
def test_chat_is_stored_then_delivered_to_both(client, db, helpers: Helpers, admin, users, live):
    opened = open_call(client, admin, live, users)
    admin_token, cand_token = tokens(helpers)
    with client.websocket_connect(ws_url(opened["call_id"], admin_token)) as interviewer:
        interviewer.receive_json()
        with client.websocket_connect(ws_url(opened["call_id"], cand_token)) as cand:
            cand.receive_json()
            interviewer.receive_json()
            cand.send_json({"type": "CHAT", "body": "x" * 2001})  # oversized: dropped, not stored
            cand.send_json({"type": "CHAT", "body": "  Can you hear me?  "})
            for sock in (cand, interviewer):
                got = sock.receive_json()
                assert got["type"] == "CHAT" and got["message"]["body"] == "Can you hear me?"
                assert got["message"]["sender_role"] == "CANDIDATE"
    assert [m.body for m in db.scalars(select(InterviewCallMessage))] == ["Can you hear me?"]
    detail = call(client, "GET", f"{BASE}/{live['id']}/calls/{opened['call_id']}", admin, 200)
    assert [m["body"] for m in detail["messages"]] == ["Can you hear me?"]


@pytest.mark.usefixtures("ws_calls_use_test_db")
def test_only_the_participants_may_connect(client, db, helpers: Helpers, admin, users, live):
    opened = open_call(client, admin, live, users)
    other = create_candidate(
        client, admin, email="o2@demo.local", roll_number="O2", initial_password="Other-pass-123"
    )
    intruder = helpers.token_for_candidate("o2@demo.local", "Other-pass-123", "O2")
    with client.websocket_connect(ws_url(opened["call_id"], intruder)) as sock:
        assert sock.receive_json() == {"type": "ERROR", "error": "forbidden"}
    with client.websocket_connect(ws_url(str(uuid.uuid4()), tokens(helpers)[0])) as sock:
        assert sock.receive_json()["error"] == "forbidden"
    assert other["id"]

    from app.models.user import UserRole
    from app.services.users import UserService

    UserService(db).create(
        name="Bea", email="a2@test.local", password=ADMIN_PASSWORD, role=UserRole.ADMIN, username="bea"
    )
    db.flush()
    second = helpers.login_admin("a2@test.local", ADMIN_PASSWORD, username="bea").json()["token"]
    with client.websocket_connect(ws_url(opened["call_id"], tokens(helpers)[0])) as interviewer:
        interviewer.receive_json()
        with client.websocket_connect(ws_url(opened["call_id"], second)) as sock:
            assert sock.receive_json() == {"type": "ERROR", "error": "occupied"}  # one-to-one

    call(client, "POST", f"{BASE}/{live['id']}/calls/{opened['call_id']}/end", admin, 200)
    with client.websocket_connect(ws_url(opened["call_id"], tokens(helpers)[1])) as sock:
        assert sock.receive_json()["error"] == "forbidden"  # an ended call accepts nobody
    assert db.scalar(select(func.count()).select_from(InterviewCallMessage)) == 0


@pytest.mark.usefixtures("ws_calls_use_test_db")
def test_ending_the_call_disconnects_both_sides(client, helpers: Helpers, admin, users, live):
    opened = open_call(client, admin, live, users)
    admin_token, cand_token = tokens(helpers)
    with client.websocket_connect(ws_url(opened["call_id"], admin_token)) as interviewer:
        interviewer.receive_json()
        with client.websocket_connect(ws_url(opened["call_id"], cand_token)) as cand:
            cand.receive_json()
            interviewer.receive_json()
            call(client, "POST", f"{BASE}/{live['id']}/calls/{opened['call_id']}/end", admin, 200)
            assert cand.receive_json()["type"] == "CALL_ENDED"
            assert interviewer.receive_json()["type"] == "CALL_ENDED"
