"""Development helpers must never reach production."""

from app.core.config import Settings, get_settings
from app.main import create_app


def test_dev_router_is_mounted_outside_production(client, users):
    response = client.post("/api/v1/dev/login-challenges")

    assert response.status_code == 200
    body = response.json()
    assert len(body["answer"]) == 6
    assert body["image_svg"].startswith("<svg")


def test_dev_router_is_absent_in_production(monkeypatch):
    base = get_settings()
    production = Settings(**{**base.model_dump(), "app_env": "production"})
    monkeypatch.setattr("app.main.get_settings", lambda: production)

    paths = {route.path for route in create_app().routes}

    assert "/api/v1/dev/login-challenges" not in paths
    assert "/api/v1/auth/login/candidate" in paths


def test_dev_challenge_is_accepted_by_real_login(client, users):
    from tests.conftest import CANDIDATE_PASSWORD, CANDIDATE_ROLL

    solved = client.post("/api/v1/dev/login-challenges").json()
    response = client.post(
        "/api/v1/auth/login/candidate",
        json={
            "roll_number": CANDIDATE_ROLL,
            "email": "candidate@test.local",
            "password": CANDIDATE_PASSWORD,
            "challenge_id": solved["challenge_id"],
            "challenge_answer": solved["answer"].lower(),
        },
    )
    assert response.status_code == 200
