"""Phase 8A + 8B security regression tests.

AUTHENTICATION — sign-in throttling per (account, client), account and client; no account oracle;
success clears; expiry; X-Forwarded-For never trusted; challenge issuance bounded; the challenge never
contains its answer as text.
RESOURCES — request bodies over the limit are refused (declared and streamed); security headers;
the API description is not published in production.
SESSIONS — password change (other sessions end), sign out everywhere, deactivation, one-time reset codes
(single use, expiring, generic errors, never logged).
WEBSOCKETS — tickets (single use, purpose-bound, unforgeable, expiring); legacy tokens can be switched
off; a socket closes after its session is revoked; oversized frames close it.
EXAMS — one exam, one sign-in: a second session is refused; takeover after silence or sign-out.
AUDIT — sign-ins, sessions, exam and question changes recorded, never secrets or answer keys.
FIXES — PUBLISHED cannot be reverted to draft; exam-defining settings freeze once attempts exist;
TURN relay only for those who need it; a non-production AI runtime is never shown as measuring.
"""

import time
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, text, update
from starlette.websockets import WebSocketDisconnect

from app.core.config import Settings, get_settings
from app.models.audit_log import AuditAction, AuditLog
from app.models.base import utcnow
from app.models.security import RateLimitHit
from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, CANDIDATE_ROLL, Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import start
from tests.test_monitoring import ws_uses_test_db  # noqa: F401 — fixture
from tests.test_proctoring import activate, proctored_exam

AUTH = "/api/v1/auth"
CAND = "candidate@test.local"


def wrong(helpers: Helpers, email: str = CAND, **kw):
    return helpers.login_candidate(email, "Wrong-password-1", **kw)


def actions(db, *wanted: AuditAction) -> list[AuditLog]:
    return list(
        db.scalars(select(AuditLog).where(AuditLog.action.in_(wanted)).order_by(AuditLog.occurred_at))
    )


@pytest.fixture
def trusted_ip_header(monkeypatch):
    """Behave as behind Cloudflare: the client address comes from CF-Connecting-IP."""
    monkeypatch.setattr(get_settings(), "client_ip_header", "cf-connecting-ip")


# -- sign-in throttling (AX-01) ---------------------------------------------------------------------------


def test_repeated_failures_throttle_even_the_right_password(helpers, users, db):
    for _ in range(5):
        assert wrong(helpers).status_code == 401
    challenge = helpers.solved_challenge()
    response = helpers.client.post(
        f"{AUTH}/login/candidate",
        json={
            "roll_number": CANDIDATE_ROLL,
            "email": CAND,
            "password": CANDIDATE_PASSWORD,
            "challenge_id": str(challenge),
            "challenge_answer": "ABC234",
        },
    )
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_attempts"
    assert int(response.headers["Retry-After"]) > 0
    # Throttled before the challenge: it was not spent.
    from app.models.login_challenge import LoginChallenge

    assert db.get(LoginChallenge, challenge).consumed_at is None
    assert len(actions(db, AuditAction.SIGN_IN_THROTTLED)) == 1


def test_an_unknown_account_is_throttled_exactly_like_a_real_one(helpers, users):
    for _ in range(5):
        wrong(helpers, "nobody@test.local")
    real = [wrong(helpers).status_code for _ in range(5)]
    ghost = wrong(helpers, "nobody@test.local")
    assert real == [401] * 5
    assert ghost.status_code == 429  # same limit, same message: nothing reveals which address exists
    assert ghost.json()["error"]["message"].startswith("Too many attempts")


def test_one_client_cannot_spray_many_accounts(helpers, users, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_max_failures_per_client", 6)
    for i in range(6):
        assert wrong(helpers, f"victim{i}@test.local").status_code == 401
    assert wrong(helpers, "fresh@test.local").status_code == 429


def test_one_account_cannot_be_attacked_from_many_clients(helpers, users, monkeypatch, trusted_ip_header):
    monkeypatch.setattr(get_settings(), "login_max_failures_per_account", 8)
    for i in range(8):
        response = helpers.client.post(
            f"{AUTH}/login/candidate",
            headers={"CF-Connecting-IP": f"198.51.100.{i}"},
            json={
                "roll_number": CANDIDATE_ROLL,
                "email": CAND,
                "password": "nope-nope-1",
                "challenge_id": str(helpers.solved_challenge()),
                "challenge_answer": "ABC234",
            },
        )
        assert response.status_code == 401
    response = helpers.client.post(
        f"{AUTH}/login/candidate",
        headers={"CF-Connecting-IP": "203.0.113.9"},
        json={
            "roll_number": CANDIDATE_ROLL,
            "email": CAND,
            "password": "nope-nope-1",
            "challenge_id": str(helpers.solved_challenge()),
            "challenge_answer": "ABC234",
        },
    )
    assert response.status_code == 429


def test_the_owner_is_not_locked_out_by_an_attacker_elsewhere(helpers, users, trusted_ip_header):
    def attempt(ip: str, password: str):
        return helpers.client.post(
            f"{AUTH}/login/candidate",
            headers={"CF-Connecting-IP": ip},
            json={
                "roll_number": CANDIDATE_ROLL,
                "email": CAND,
                "password": password,
                "challenge_id": str(helpers.solved_challenge()),
                "challenge_answer": "ABC234",
            },
        )

    for _ in range(5):
        attempt("192.0.2.66", "attacker-guess-1")
    assert attempt("192.0.2.66", "attacker-guess-1").status_code == 429
    assert attempt("192.0.2.10", CANDIDATE_PASSWORD).status_code == 200  # the real user, elsewhere


def test_x_forwarded_for_is_never_trusted(helpers, users, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_max_failures_per_client", 3)
    for i in range(3):
        helpers.client.post(
            f"{AUTH}/login/candidate",
            headers={"X-Forwarded-For": f"10.0.0.{i}"},
            json={
                "roll_number": CANDIDATE_ROLL,
                "email": f"x{i}@test.local",
                "password": "nope-nope-1",
                "challenge_id": str(helpers.solved_challenge()),
                "challenge_answer": "ABC234",
            },
        )
    assert wrong(helpers, "y@test.local").status_code == 429


def test_success_clears_the_count_and_failures_expire(helpers, users, db):
    for _ in range(4):
        wrong(helpers)
    assert helpers.login_candidate(CAND, CANDIDATE_PASSWORD).status_code == 200
    for _ in range(4):
        assert wrong(helpers).status_code == 401  # counting started again
    wrong(helpers)
    assert wrong(helpers).status_code == 429
    # Fifteen minutes later the window has passed.
    db.execute(update(RateLimitHit).values(hit_at=utcnow() - timedelta(minutes=16)))
    assert helpers.login_candidate(CAND, CANDIDATE_PASSWORD).status_code == 200


def test_sign_ins_are_audited_without_secrets(helpers, users, db):
    wrong(helpers)
    helpers.login_candidate(CAND, CANDIDATE_PASSWORD)
    [failed] = actions(db, AuditAction.SIGN_IN_FAILED)
    [ok] = actions(db, AuditAction.SIGN_IN_SUCCEEDED)
    assert failed.actor_id is None and failed.details["email_domain"] == "test.local"
    assert ok.actor_id == users["candidate"].id
    dumped = str(failed.details) + str(ok.details)
    assert "Wrong-password" not in dumped and CANDIDATE_PASSWORD not in dumped and CAND not in dumped


def test_challenge_issuance_is_bounded_per_client(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "challenge_max_per_client", 3)
    assert [client.get(f"{AUTH}/challenge").status_code for _ in range(3)] == [200] * 3
    assert client.get(f"{AUTH}/challenge").status_code == 429


def test_the_challenge_image_does_not_contain_its_answer(client, db):
    body = client.get(f"{AUTH}/challenge").json()
    assert "<text" not in body["image_svg"] and "answer" not in body
    from app.services.challenges import ALPHABET, render_svg

    svg = render_svg(ALPHABET[:6])
    assert "<text" not in svg and ">A<" not in svg


# -- resource limits and headers (AX-02 / AX-11 / AX-12) --------------------------------------------------


def test_an_oversized_body_is_refused_before_it_is_read(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_request_bytes", 64 * 1024)
    big = b'{"email": "' + b"a" * (70 * 1024) + b'"}'
    declared = client.post(f"{AUTH}/login/admin", content=big, headers={"Content-Type": "application/json"})
    assert declared.status_code == 413 and declared.json()["error"]["code"] == "payload_too_large"

    def chunks():
        for _ in range(20):
            yield b"x" * 8192

    streamed = client.post(
        f"{AUTH}/login/admin", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert streamed.status_code == 413
    assert "Traceback" not in streamed.text


def test_normal_payloads_and_bounded_fields(helpers, users):
    assert helpers.login_candidate(CAND, CANDIDATE_PASSWORD).status_code == 200
    huge_password = helpers.login_candidate(CAND, "p" * 300)
    assert huge_password.status_code == 422


def test_api_responses_carry_security_headers(client):
    response = client.get("/api/v1/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_production_publishes_no_api_description(monkeypatch):
    production = Settings(
        app_env="production",
        database_url="postgresql+psycopg://u:p@localhost:5432/x",
        secret_key="s" * 48,
        cors_origins=["http://tauri.localhost"],
    )
    import app.main as main

    monkeypatch.setattr(main, "get_settings", lambda: production)
    built = main.create_app()
    assert built.openapi_url is None and built.docs_url is None


# -- sessions and passwords (AX-06) -----------------------------------------------------------------------


def test_changing_the_password_ends_every_other_session(helpers, users, client, db):
    first = helpers.token_for(CAND, CANDIDATE_PASSWORD)
    second = helpers.token_for(CAND, CANDIDATE_PASSWORD)
    bad = client.post(
        f"{AUTH}/password",
        json={"current_password": "wrong", "new_password": "Brand-new-pass-1"},
        headers=helpers.bearer(second),
    )
    # 400, not 401: a typo must not look like an expired session (the app would sign the user out).
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "current_password_incorrect"
    assert client.get(f"{AUTH}/me", headers=helpers.bearer(second)).status_code == 200
    same = client.post(
        f"{AUTH}/password",
        json={"current_password": CANDIDATE_PASSWORD, "new_password": CANDIDATE_PASSWORD},
        headers=helpers.bearer(second),
    )
    assert same.status_code == 422
    short = client.post(
        f"{AUTH}/password",
        json={"current_password": CANDIDATE_PASSWORD, "new_password": "short"},
        headers=helpers.bearer(second),
    )
    assert short.status_code == 422
    ok = client.post(
        f"{AUTH}/password",
        json={"current_password": CANDIDATE_PASSWORD, "new_password": "Brand-new-pass-1"},
        headers=helpers.bearer(second),
    )
    assert ok.status_code == 204
    assert client.get(f"{AUTH}/me", headers=helpers.bearer(first)).status_code == 401
    assert client.get(f"{AUTH}/me", headers=helpers.bearer(second)).status_code == 200
    assert helpers.login_candidate(CAND, "Brand-new-pass-1").status_code == 200
    assert helpers.login_candidate(CAND, CANDIDATE_PASSWORD).status_code == 401
    assert len(actions(db, AuditAction.PASSWORD_CHANGED)) == 1


def test_sign_out_everywhere(helpers, users, client, db):
    a, b = helpers.token_for(CAND, CANDIDATE_PASSWORD), helpers.token_for(CAND, CANDIDATE_PASSWORD)
    response = client.post(f"{AUTH}/logout-all", headers=helpers.bearer(a))
    assert response.status_code == 200 and response.json()["sessions_ended"] == 2
    for token in (a, b):
        assert client.get(f"{AUTH}/me", headers=helpers.bearer(token)).status_code == 401
    assert len(actions(db, AuditAction.SESSIONS_REVOKED)) == 1


def test_an_admin_deactivates_and_reactivates_a_candidate(helpers, users, client, db):
    admin = admin_headers(helpers)
    token = helpers.token_for(CAND, CANDIDATE_PASSWORD)
    cid = users["candidate"].id
    assert client.post(f"/api/v1/candidates/{cid}/deactivate", headers=admin).json()["is_active"] is False
    assert client.get(f"{AUTH}/me", headers=helpers.bearer(token)).status_code in (401, 403)
    assert helpers.login_candidate(CAND, CANDIDATE_PASSWORD).status_code == 403
    assert client.post(f"/api/v1/candidates/{cid}/reactivate", headers=admin).status_code == 200
    assert helpers.login_candidate(CAND, CANDIDATE_PASSWORD).status_code == 200
    # A candidate cannot do any of this, nor target an administrator through these routes.
    cand = helpers.bearer(helpers.token_for(CAND, CANDIDATE_PASSWORD))
    assert client.post(f"/api/v1/candidates/{cid}/deactivate", headers=cand).status_code == 403
    assert client.post(f"/api/v1/candidates/{users['admin'].id}/deactivate", headers=admin).status_code == 404
    assert [
        a.action for a in actions(db, AuditAction.ACCOUNT_DEACTIVATED, AuditAction.ACCOUNT_REACTIVATED)
    ] == [
        AuditAction.ACCOUNT_DEACTIVATED,
        AuditAction.ACCOUNT_REACTIVATED,
    ]


NEW_PASSWORD = "Reset-pass-123"  # noqa: S105 — a test fixture value


def redeem(helpers: Helpers, code: str, email: str = CAND, password: str = NEW_PASSWORD):
    return helpers.client.post(
        f"{AUTH}/password-reset",
        json={
            "email": email,
            "code": code,
            "new_password": password,
            "challenge_id": str(helpers.solved_challenge()),
            "challenge_answer": "ABC234",
        },
    )


def test_a_reset_code_is_single_use_short_lived_and_ends_every_session(helpers, users, client, db):
    admin = admin_headers(helpers)
    token = helpers.token_for(CAND, CANDIDATE_PASSWORD)
    cid = users["candidate"].id
    issued = client.post(f"/api/v1/candidates/{cid}/reset-code", headers=admin).json()
    code = issued["code"]
    assert len(code) >= 18 and issued["expires_at"]
    assert redeem(helpers, code, email="someone-else@test.local").status_code == 401  # wrong account: generic
    assert redeem(helpers, code).status_code == 204
    assert client.get(f"{AUTH}/me", headers=helpers.bearer(token)).status_code == 401
    assert helpers.login_candidate(CAND, "Reset-pass-123").status_code == 200
    again = redeem(helpers, code, password="Another-pass-123")
    assert (
        again.status_code == 401
        and again.json()["error"]["message"] == "That reset code is not valid or has expired."
    )

    expired = client.post(f"/api/v1/candidates/{cid}/reset-code", headers=admin).json()["code"]
    from app.models.security import PasswordResetCode

    db.execute(update(PasswordResetCode).values(expires_at=utcnow() - timedelta(minutes=1)))
    assert redeem(helpers, expired).status_code == 401
    audited = str(
        [
            a.details
            for a in actions(db, AuditAction.PASSWORD_RESET_ISSUED, AuditAction.PASSWORD_RESET_COMPLETED)
        ]
    )
    assert code not in audited and expired not in audited


def test_a_new_reset_code_voids_the_old_one(helpers, users, client):
    admin = admin_headers(helpers)
    cid = users["candidate"].id
    old = client.post(f"/api/v1/candidates/{cid}/reset-code", headers=admin).json()["code"]
    new = client.post(f"/api/v1/candidates/{cid}/reset-code", headers=admin).json()["code"]
    assert redeem(helpers, old).status_code == 401
    assert redeem(helpers, new).status_code == 204


# -- WebSockets (AX-04 / AX-05) ---------------------------------------------------------------------------


def ticket(client, headers, purpose: str = "monitoring") -> str:
    response = client.post("/api/v1/realtime/ws-ticket", json={"purpose": purpose}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["ticket"]


@pytest.mark.usefixtures("ws_uses_test_db")
def test_a_ticket_opens_one_socket_once(client, helpers, users):
    admin = admin_headers(helpers)
    one = ticket(client, admin)
    with client.websocket_connect(f"/api/v1/ws/admin/monitoring?ticket={one}") as sock:
        assert sock.receive_json()["type"] == "CONNECTION_READY"
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/api/v1/ws/admin/monitoring?ticket={one}") as sock,
    ):
        sock.receive_json()  # used already


@pytest.mark.usefixtures("ws_uses_test_db")
def test_tickets_are_bound_to_their_purpose_and_cannot_be_forged(client, helpers, users):
    admin = admin_headers(helpers)
    call_ticket = ticket(client, admin, "call")
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/api/v1/ws/admin/monitoring?ticket={call_ticket}") as sock,
    ):
        sock.receive_json()
    forged = ticket(client, admin)[:-4] + "abcd"
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/api/v1/ws/admin/monitoring?ticket={forged}") as sock,
    ):
        sock.receive_json()
    assert client.post("/api/v1/realtime/ws-ticket", json={"purpose": "monitoring"}).status_code == 401


@pytest.mark.usefixtures("ws_uses_test_db")
def test_an_expired_ticket_is_refused(client, helpers, users, monkeypatch):
    admin = admin_headers(helpers)
    old = ticket(client, admin)
    from app.realtime import security

    monkeypatch.setattr(security.time, "time", lambda: time.time_ns() / 1e9 + 3600)
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/api/v1/ws/admin/monitoring?ticket={old}") as sock,
    ):
        sock.receive_json()


@pytest.mark.usefixtures("ws_uses_test_db")
def test_the_legacy_token_can_be_switched_off(client, helpers, users, monkeypatch):
    from tests.test_monitoring import admin_token

    token = admin_token(helpers)
    with client.websocket_connect(f"/api/v1/ws/admin/monitoring?token={token}") as sock:
        assert sock.receive_json()["type"] == "CONNECTION_READY"  # still accepted for 0.1.3 apps
    monkeypatch.setattr(get_settings(), "ws_allow_legacy_token", False)
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(f"/api/v1/ws/admin/monitoring?token={token}") as sock,
    ):
        sock.receive_json()


@pytest.mark.usefixtures("ws_uses_test_db")
def test_a_socket_closes_once_its_session_is_revoked(client, helpers, users, monkeypatch):
    from app.realtime import security

    monkeypatch.setattr(security, "RECHECK_SECONDS", 0.05)
    admin = admin_headers(helpers)
    one = ticket(client, admin)
    with client.websocket_connect(f"/api/v1/ws/admin/monitoring?ticket={one}") as sock:
        assert sock.receive_json()["type"] == "CONNECTION_READY"
        assert client.post(f"{AUTH}/logout", headers=admin).status_code == 204
        with pytest.raises(WebSocketDisconnect) as closed:
            sock.receive_json()
        assert closed.value.code == 1008


@pytest.mark.usefixtures("ws_uses_test_db")
def test_an_oversized_frame_closes_the_socket(client, helpers, users, monkeypatch):
    from app.realtime import security

    monkeypatch.setattr(security, "MAX_MESSAGE_CHARS", 1000)
    one = ticket(client, admin_headers(helpers))
    with client.websocket_connect(f"/api/v1/ws/admin/monitoring?ticket={one}") as sock:
        assert sock.receive_json()["type"] == "CONNECTION_READY"
        sock.send_text('{"type": "WATCH", "pad": "' + "x" * 2000 + '"}')
        with pytest.raises(WebSocketDisconnect) as closed:
            sock.receive_json()
        assert closed.value.code == 1009


def test_a_flooding_socket_is_closed():
    """The token bucket drops excess messages and gives up on a connection that keeps flooding."""
    import asyncio

    from app.realtime.security import SocketGuard

    class FakeSocket:
        def __init__(self):
            self.closed = None

        async def receive_text(self):
            return '{"type": "PING"}'

        async def close(self, code):
            self.closed = code

    sock = FakeSocket()
    guard = SocketGuard(sock, None)

    async def drain():
        received = 0
        while await guard.receive() is not None:
            received += 1
        return received

    received = asyncio.run(drain())
    assert sock.closed == 1008 and received < 200


# -- one exam, one sign-in (AX-07) ------------------------------------------------------------------------


def exam_with_attempt(client, helpers, users):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"])
    return exam, attempt, headers


def test_a_second_sign_in_cannot_use_an_exam_in_progress(client, helpers, users, db):
    _, attempt, owner = exam_with_attempt(client, helpers, users)
    other = candidate_headers(helpers)  # the same candidate, signed in a second time
    url = f"/api/v1/candidates/me/attempts/{attempt['id']}"
    refused = client.get(url, headers=other)
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "attempt_in_use_elsewhere"
    client.get(url, headers=other)
    assert len(actions(db, AuditAction.ATTEMPT_ACCESS_BLOCKED)) == 1  # at most once a minute
    assert client.get(url, headers=owner).status_code == 200


def test_the_exam_moves_to_a_new_sign_in_after_silence_or_sign_out(client, helpers, users, db):
    from app.models.attempt import AssessmentAttempt

    _, attempt, owner = exam_with_attempt(client, helpers, users)
    url = f"/api/v1/candidates/me/attempts/{attempt['id']}"
    second = candidate_headers(helpers)
    # The owner's laptop crashed: nothing heard from it for longer than the takeover window.
    db.execute(
        update(AssessmentAttempt)
        .where(AssessmentAttempt.id == uuid.UUID(attempt["id"]))
        .values(bound_seen_at=utcnow() - timedelta(minutes=5))
    )
    assert client.get(url, headers=second).status_code == 200
    assert client.get(url, headers=owner).status_code == 409  # the old session no longer holds it
    [taken] = actions(db, AuditAction.ATTEMPT_SESSION_TAKEN_OVER)
    assert taken.details["previous_session"] == "silent"
    # Signing out releases it at once.
    assert client.post(f"{AUTH}/logout", headers=second).status_code == 204
    third = candidate_headers(helpers)
    assert client.get(url, headers=third).status_code == 200


# -- audit of exam changes (AX-08) ------------------------------------------------------------------------


def test_exam_and_answer_key_changes_are_audited_without_content(client, helpers, users, db):
    admin = admin_headers(helpers)
    from tests.test_assessments import create_assessment

    created = create_assessment(client, admin, title="Audit me")
    question = client.post(
        f"/api/v1/assessments/{created['id']}/questions",
        json={
            "type": "MCQ",
            "text": "Secret question text",
            "marks": 5,
            "options": [{"text": "Right", "is_correct": True}, {"text": "Wrong", "is_correct": False}],
        },
        headers=admin,
    ).json()
    client.patch(
        f"/api/v1/assessments/{created['id']}/questions/{question['id']}",
        json={
            "options": [{"text": "Right", "is_correct": False}, {"text": "Wrong", "is_correct": True}],
        },
        headers=admin,
    )
    [updated] = actions(db, AuditAction.QUESTION_UPDATED)
    assert updated.details["answer_key_changed"] is True
    rows = actions(
        db, AuditAction.ASSESSMENT_CREATED, AuditAction.QUESTION_CREATED, AuditAction.QUESTION_UPDATED
    )
    assert len(rows) == 3 and all(r.actor_id == users["admin"].id for r in rows)
    assert "Secret question text" not in str([r.details for r in rows]) and "Right" not in str(
        [r.details for r in rows]
    )


# -- small fixes (AX-09 / AX-10 / AX-13 / BX-06) ----------------------------------------------------------


def test_a_published_exam_cannot_be_reverted_to_draft(client, helpers, users):
    exam = proctored_exam(client, helpers, users)
    response = client.post(f"/api/v1/assessments/{exam['id']}/draft", headers=admin_headers(helpers))
    assert response.status_code == 409


def test_exam_defining_settings_freeze_once_attempts_exist(client, helpers, users):
    exam, _, _ = exam_with_attempt(client, helpers, users)
    admin = admin_headers(helpers)
    frozen = client.patch(
        f"/api/v1/assessments/{exam['id']}", json={"proctoring_required": False}, headers=admin
    )
    assert frozen.status_code == 409 and frozen.json()["error"]["code"] == "assessment_in_use"
    assert (
        client.patch(
            f"/api/v1/assessments/{exam['id']}", json={"title": "Renamed"}, headers=admin
        ).status_code
        == 200
    )


def test_turn_relay_only_for_those_who_need_it(client, helpers, users, monkeypatch):
    from app.api.v1 import realtime as realtime_api
    from app.services.ice import IceServerProvider
    from tests.test_realtime import Clock, FakeCloudflare, turn_settings

    monkeypatch.setattr(realtime_api, "provider", IceServerProvider(FakeCloudflare(), Clock()))
    client.app.dependency_overrides[get_settings] = lambda: turn_settings()
    try:
        idle = client.get("/api/v1/realtime/ice-servers", headers=candidate_headers(helpers)).json()
        staff = client.get("/api/v1/realtime/ice-servers", headers=admin_headers(helpers)).json()
    finally:
        del client.app.dependency_overrides[get_settings]
    assert idle["turn_enabled"] is False and all("credential" not in s for s in idle["ice_servers"])
    assert staff["turn_enabled"] is True


def test_a_non_production_ai_runtime_is_never_shown_as_measuring():
    from app.models.proctoring_event import ProctoringEvent, ProctoringEventCategory, ProctoringEventType
    from app.services.monitoring import derive_ai_state

    def status(**details):
        return ProctoringEvent(
            event_type=ProctoringEventType.AI_STATUS,
            category=ProctoringEventCategory.AI_HEALTH,
            details={"ai_status": "RUNNING", **details},
            recorded_at=utcnow(),
        )

    assert derive_ai_state([status(production_capable=True)], production=True).face == "detected"
    fake = derive_ai_state([status(production_capable=False, runtime_kind="mock")], production=True)
    assert (fake.face, fake.head_orientation, fake.camera_quality, fake.objects) == ("unknown",) * 4


# -- database roles and row level security (BX-01 / BX-05) ------------------------------------------------


def test_every_table_has_rls_and_the_runtime_policy(db):
    from app.core.db_security import APPEND_ONLY, POLICY_NAME, RUNTIME_ROLE
    from app.models import Base

    for table in Base.metadata.tables:
        assert db.scalar(text("SELECT relrowsecurity FROM pg_class WHERE relname = :t"), {"t": table}), table
        policy = db.scalar(
            text("SELECT count(*) FROM pg_policies WHERE tablename = :t AND policyname = :p"),
            {"t": table, "p": POLICY_NAME},
        )
        assert policy == 1, f"{table} has no runtime policy — call secure_table() in its migration"
        for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE"):
            granted = db.scalar(
                text("SELECT has_table_privilege(:r, :t, :p)"),
                {"r": RUNTIME_ROLE, "t": table, "p": privilege},
            )
            expected = privilege in ("SELECT", "INSERT") or table not in APPEND_ONLY
            assert granted is expected, (table, privilege)


def test_the_runtime_role_works_but_cannot_change_the_schema_or_history(db, users):
    db.execute(text("SAVEPOINT runtime_probe"))
    db.execute(text("SET LOCAL ROLE assessx_runtime"))
    assert db.scalar(text("SELECT count(*) FROM users")) >= 3  # the policy admits it to every row
    db.execute(
        text(
            "INSERT INTO rate_limit_hits (id, bucket, key, hit_at) "
            "VALUES (gen_random_uuid(), 'probe', 'k', now())"
        )
    )
    for forbidden in (
        "UPDATE audit_logs SET details = '{}'",
        "DELETE FROM audit_logs",
        "DROP TABLE users",
        "ALTER TABLE users ADD COLUMN pwned text",
        "CREATE TABLE public.pwned (id int)",
        "ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only",
    ):
        db.execute(text("SAVEPOINT attempt"))
        with pytest.raises(Exception, match="(?i)permission denied|must be owner"):
            db.execute(text(forbidden))
        db.execute(text("ROLLBACK TO SAVEPOINT attempt"))
    db.execute(text("ROLLBACK TO SAVEPOINT runtime_probe"))


def test_a_role_without_a_policy_sees_nothing_even_with_a_grant(db, users):
    """What Supabase's `anon`/`authenticated` roles would face: RLS with no policy for them."""
    db.execute(text("SAVEPOINT probe"))
    db.execute(text("CREATE ROLE assessx_probe_api NOLOGIN"))
    db.execute(text("GRANT SELECT ON users TO assessx_probe_api"))
    db.execute(text("SET LOCAL ROLE assessx_probe_api"))
    assert db.scalar(text("SELECT count(*) FROM users")) == 0
    db.execute(text("ROLLBACK TO SAVEPOINT probe"))


def test_the_runtime_role_definition_is_not_a_login_role(db):
    login, bypass = db.execute(
        text("SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'assessx_runtime'")
    ).one()
    assert login is False and bypass is False


# -- every route checks the role (AX-21 lives in test_route_authz.py) -------------------------------------

ADMIN_EMAIL = "admin@test.local"
_ = ADMIN_PASSWORD
