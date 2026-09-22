"""Authentication: candidate and administrator sign-in, current user, sign-out, session validity."""

import json
from datetime import timedelta

from sqlalchemy import select

from app.models.auth_session import AuthSession
from app.models.base import utcnow
from tests.conftest import (
    ADMIN_PASSWORD,
    ADMIN_USERNAME,
    CANDIDATE_PASSWORD,
    CANDIDATE_ROLL,
    INACTIVE_PASSWORD,
    INACTIVE_ROLL,
    Helpers,
)

GENERIC = {"code": "invalid_credentials", "message": "Invalid email or password."}


# -- candidate sign-in -----------------------------------------------------------------------


def test_candidate_login_succeeds_with_roll_number_email_and_password(helpers: Helpers, users):
    response = helpers.login_candidate("candidate@test.local", CANDIDATE_PASSWORD)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert len(body["token"]) >= 32
    assert body["user"]["email"] == "candidate@test.local"
    assert body["user"]["role"] == "CANDIDATE"
    assert body["user"]["roll_number"] == CANDIDATE_ROLL


def test_candidate_login_rejects_wrong_roll_number(helpers: Helpers, users):
    response = helpers.login_candidate("candidate@test.local", CANDIDATE_PASSWORD, roll_number="WRONG001")

    assert response.status_code == 401
    assert response.json()["error"] == GENERIC


def test_candidate_roll_number_is_case_and_space_insensitive(helpers: Helpers, users):
    response = helpers.login_candidate(
        "candidate@test.local", CANDIDATE_PASSWORD, roll_number=f"  {CANDIDATE_ROLL.lower()} "
    )

    assert response.status_code == 200


def test_admin_cannot_use_the_candidate_form(helpers: Helpers, users):
    """An administrator has no roll number; the candidate form must not sign them in."""
    response = helpers.login_candidate("admin@test.local", ADMIN_PASSWORD, roll_number="ANY")

    assert response.status_code == 401
    assert response.json()["error"] == GENERIC


def test_candidate_wrong_password_is_generic(helpers: Helpers, users):
    response = helpers.login_candidate("candidate@test.local", "definitely-wrong")

    assert response.status_code == 401
    assert response.json()["error"] == GENERIC
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_unknown_candidate_gets_the_same_error_as_wrong_password(helpers: Helpers, users):
    unknown = helpers.login_candidate("nobody@test.local", "whatever").json()
    wrong = helpers.login_candidate("candidate@test.local", "wrong").json()

    assert unknown == wrong  # no account-existence oracle


def test_inactive_candidate_cannot_log_in(helpers: Helpers, users):
    response = helpers.login_candidate("inactive@test.local", INACTIVE_PASSWORD, roll_number=INACTIVE_ROLL)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_inactive"


def test_malformed_candidate_login_is_a_validation_error(client, users):
    response = client.post("/api/v1/auth/login/candidate", json={"email": "not-an-email", "password": ""})

    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    assert {d["field"] for d in body["details"]} >= {"roll_number", "email", "password", "challenge_id"}


def test_wrong_challenge_answer_is_rejected_before_credentials(helpers: Helpers, users):
    response = helpers.login_candidate("candidate@test.local", CANDIDATE_PASSWORD, answer="WRONG1")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "challenge_invalid"


def test_challenge_is_single_use(helpers: Helpers, client, users):
    challenge_id = helpers.solved_challenge("ABC234")
    payload = {
        "roll_number": CANDIDATE_ROLL,
        "email": "candidate@test.local",
        "password": CANDIDATE_PASSWORD,
        "challenge_id": str(challenge_id),
        "challenge_answer": "ABC234",
    }
    assert client.post("/api/v1/auth/login/candidate", json=payload).status_code == 200
    second = client.post("/api/v1/auth/login/candidate", json=payload)
    assert second.json()["error"]["code"] == "challenge_invalid"


def test_expired_challenge_is_rejected(helpers: Helpers, client, users):
    challenge_id = helpers.solved_challenge("ABC234", expired=True)
    response = client.post(
        "/api/v1/auth/login/candidate",
        json={
            "roll_number": CANDIDATE_ROLL,
            "email": "candidate@test.local",
            "password": CANDIDATE_PASSWORD,
            "challenge_id": str(challenge_id),
            "challenge_answer": "ABC234",
        },
    )
    assert response.json()["error"]["code"] == "challenge_invalid"


def test_challenge_endpoint_returns_image_but_not_the_answer(client):
    response = client.get("/api/v1/auth/challenge")

    assert response.status_code == 200
    body = response.json()
    assert body["image_svg"].startswith("<svg")
    assert set(body) == {"challenge_id", "image_svg", "expires_at"}


# -- administrator sign-in -------------------------------------------------------------------


def test_admin_login_succeeds_with_username_email_and_password(helpers: Helpers, users):
    response = helpers.login_admin("admin@test.local", ADMIN_PASSWORD)

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "ADMIN"
    assert body["user"]["username"] == ADMIN_USERNAME
    assert body["user"]["roll_number"] is None


def test_admin_login_rejects_wrong_username(helpers: Helpers, users):
    response = helpers.login_admin("admin@test.local", ADMIN_PASSWORD, username="someone-else")

    assert response.status_code == 401
    assert response.json()["error"] == GENERIC


def test_admin_login_is_case_insensitive_on_email_and_username(helpers: Helpers, users):
    response = helpers.login_admin("Admin@Test.Local", ADMIN_PASSWORD, username=ADMIN_USERNAME.upper())

    assert response.status_code == 200


def test_candidate_cannot_use_the_admin_form(helpers: Helpers, users):
    """A candidate has no username; the admin form must not sign them in — even with the right password."""
    response = helpers.login_admin("candidate@test.local", CANDIDATE_PASSWORD, username="anything")

    assert response.status_code == 401
    assert response.json()["error"] == GENERIC


def test_admin_wrong_password_is_generic(helpers: Helpers, users):
    response = helpers.login_admin("admin@test.local", "nope")

    assert response.status_code == 401
    assert response.json()["error"] == GENERIC


def test_malformed_admin_login_is_a_validation_error(client, users):
    response = client.post("/api/v1/auth/login/admin", json={"email": "x"})

    assert response.status_code == 422
    fields = {d["field"] for d in response.json()["error"]["details"]}
    assert fields >= {"username", "email", "password", "challenge_id", "challenge_answer"}


def test_admin_wrong_challenge_answer_is_rejected_before_credentials(helpers: Helpers, users):
    response = helpers.login_admin("admin@test.local", ADMIN_PASSWORD, answer="WRONG1")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "challenge_invalid"


# -- shared ----------------------------------------------------------------------------------


def test_login_responses_never_contain_password_material(helpers: Helpers, users):
    for body in (
        helpers.login_candidate("candidate@test.local", CANDIDATE_PASSWORD).json(),
        helpers.login_admin("admin@test.local", ADMIN_PASSWORD).json(),
    ):
        assert "password" not in body["user"]
        assert "password_hash" not in body["user"]
        assert "password" not in json.dumps(body).lower()


def test_me_returns_the_authenticated_user(helpers: Helpers, client, users):
    token = helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD)

    response = client.get("/api/v1/auth/me", headers=helpers.bearer(token))

    assert response.status_code == 200
    assert response.json()["email"] == "candidate@test.local"
    assert response.json()["role"] == "CANDIDATE"


def test_protected_endpoint_rejects_missing_token(client, users):
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_protected_endpoint_rejects_garbage_token(client, helpers: Helpers, users):
    response = client.get("/api/v1/auth/me", headers=helpers.bearer("not-a-real-token"))

    assert response.status_code == 401


def test_logout_revokes_the_session(helpers: Helpers, client, users):
    token = helpers.token_for("admin@test.local", ADMIN_PASSWORD)

    assert client.post("/api/v1/auth/logout", headers=helpers.bearer(token)).status_code == 204
    assert client.get("/api/v1/auth/me", headers=helpers.bearer(token)).status_code == 401
    assert client.post("/api/v1/auth/logout", headers=helpers.bearer(token)).status_code == 401


def test_expired_session_is_rejected(helpers: Helpers, client, db, users):
    token = helpers.token_for("admin@test.local", ADMIN_PASSWORD)
    session = db.scalar(select(AuthSession).where(AuthSession.user_id == users["admin"].id))
    session.expires_at = utcnow() - timedelta(seconds=1)
    db.flush()

    response = client.get("/api/v1/auth/me", headers=helpers.bearer(token))

    assert response.status_code == 401
    assert "expired" in response.json()["error"]["message"].lower()


def test_remember_me_issues_a_longer_session(helpers: Helpers, users):
    short = helpers.login_admin("admin@test.local", ADMIN_PASSWORD, remember=False).json()["expires_at"]
    long = helpers.login_admin("admin@test.local", ADMIN_PASSWORD, remember=True).json()["expires_at"]

    assert long > short


def test_deactivated_user_loses_existing_session(helpers: Helpers, client, db, users):
    token = helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD)
    users["candidate"].is_active = False
    db.flush()

    response = client.get("/api/v1/auth/me", headers=helpers.bearer(token))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_inactive"
