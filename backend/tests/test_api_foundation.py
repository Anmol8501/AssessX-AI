"""API foundation: health, error shapes, request ids, validation of query/path input."""

import logging

from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, CANDIDATE_ROLL, Helpers, engine

# -- health ------------------------------------------------------------------------------------


def test_versioned_health_reports_database(client):
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


def test_unversioned_liveness_probe(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_reports_degraded_when_database_is_down(client, monkeypatch):
    monkeypatch.setattr("app.api.v1.health.check_database", lambda: False)

    response = client.get("/api/v1/health")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "database": "unavailable"}


# -- database ----------------------------------------------------------------------------------


def test_database_connection_and_schema_present():
    with engine.connect() as connection:
        assert connection.execute(text("SELECT 1")).scalar() == 1
        tables = {
            row[0]
            for row in connection.execute(
                text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
            )
        }
    assert {"users", "auth_sessions", "login_challenges", "alembic_version"} <= tables


# -- error shape ---------------------------------------------------------------------------------


def test_unknown_route_is_a_json_not_found(client):
    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_wrong_method_is_a_json_error(client):
    response = client.delete("/api/v1/health")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_invalid_query_parameter_is_a_validation_error(client, helpers: Helpers, users):
    token = helpers.token_for("admin@test.local", ADMIN_PASSWORD)

    response = client.get("/api/v1/users", params={"role": "WIZARD"}, headers=helpers.bearer(token))

    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "validation_error"
    assert body["details"][0]["field"] == "query.role"


def test_malformed_json_body_is_a_validation_error(client):
    response = client.post(
        "/api/v1/auth/login/admin", content=b"{not json", headers={"Content-Type": "application/json"}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_unexpected_error_is_masked(client, monkeypatch):
    def boom() -> bool:
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr("app.api.v1.health.check_database", boom)

    # The default TestClient re-raises server errors; here we want the client-facing response.
    with TestClient(client.app, raise_server_exceptions=False) as quiet_client:
        response = quiet_client.get("/api/v1/health")

    assert response.status_code == 500
    assert response.json() == {"error": {"code": "internal_error", "message": "Something went wrong."}}
    assert "secret internal detail" not in response.text


def test_every_response_carries_a_request_id(client):
    generated = client.get("/health")
    supplied = client.get("/health", headers={"X-Request-ID": "abc-123"})

    assert generated.headers["X-Request-ID"]
    assert supplied.headers["X-Request-ID"] == "abc-123"


# -- logging hygiene --------------------------------------------------------------------------


def test_logs_never_contain_passwords_or_tokens(client, helpers: Helpers, users, caplog):
    caplog.set_level(logging.DEBUG)

    login = helpers.login_candidate("candidate@test.local", CANDIDATE_PASSWORD, roll_number=CANDIDATE_ROLL)
    token = login.json()["token"]
    client.get("/api/v1/auth/me", headers=helpers.bearer(token))
    helpers.login_candidate("candidate@test.local", "wrong-password")

    captured = caplog.text + " ".join(str(vars(r)) for r in caplog.records)
    assert CANDIDATE_PASSWORD not in captured
    assert "wrong-password" not in captured
    assert token not in captured
    assert "$argon2" not in captured
    # …while useful events are still recorded.
    assert "User signed in" in caplog.text
    assert "Failed sign-in attempt" in caplog.text
