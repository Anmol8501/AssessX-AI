"""Role-based authorization: the backend, not the client, decides who reaches what."""

from tests.conftest import ADMIN_PASSWORD, CANDIDATE_PASSWORD, Helpers


def test_admin_can_list_users(helpers: Helpers, client, users):
    token = helpers.token_for("admin@test.local", ADMIN_PASSWORD)

    response = client.get("/api/v1/users", headers=helpers.bearer(token))

    assert response.status_code == 200
    emails = {u["email"] for u in response.json()}
    assert emails >= {"admin@test.local", "candidate@test.local", "inactive@test.local"}
    assert all("password_hash" not in u for u in response.json())


def test_admin_can_filter_users_by_role(helpers: Helpers, client, users):
    token = helpers.token_for("admin@test.local", ADMIN_PASSWORD)

    response = client.get("/api/v1/users", params={"role": "CANDIDATE"}, headers=helpers.bearer(token))

    assert response.status_code == 200
    assert {u["role"] for u in response.json()} == {"CANDIDATE"}


def test_candidate_cannot_access_admin_endpoint(helpers: Helpers, client, users):
    token = helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD)

    response = client.get("/api/v1/users", headers=helpers.bearer(token))

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_candidate_can_access_candidate_endpoint(helpers: Helpers, client, users):
    token = helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD)

    response = client.get("/api/v1/candidates/me", headers=helpers.bearer(token))

    assert response.status_code == 200
    assert response.json()["email"] == "candidate@test.local"


def test_admin_cannot_access_candidate_only_endpoint(helpers: Helpers, client, users):
    token = helpers.token_for("admin@test.local", ADMIN_PASSWORD)

    response = client.get("/api/v1/candidates/me", headers=helpers.bearer(token))

    assert response.status_code == 403


def test_unauthenticated_request_to_admin_endpoint_is_401_not_403(client, users):
    response = client.get("/api/v1/users")

    assert response.status_code == 401


def test_role_in_request_cannot_escalate(helpers: Helpers, client, users):
    """A client-supplied role is ignored: the session's user decides."""
    token = helpers.token_for("candidate@test.local", CANDIDATE_PASSWORD)

    response = client.get(
        "/api/v1/users",
        headers={**helpers.bearer(token), "X-Role": "ADMIN"},
        params={"role": "ADMIN"},
    )

    assert response.status_code == 403
