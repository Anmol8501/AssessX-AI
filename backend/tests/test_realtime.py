"""Live monitoring reliability: candidate presence, video recovery, and WebRTC ICE servers.

What is asserted: an admin is told the moment a candidate's app connects or disconnects (the tile
carries `candidate_connected` and when it changed); when a candidate app reconnects while an admin
is watching, it is asked for a fresh video offer; and the ICE servers endpoint returns STUN for any
signed-in user, adds TURN only when Cloudflare TURN is configured — with short-lived credentials
fetched server-side, cached, renewed, and never fatal when Cloudflare is unavailable.
"""

import pytest

from app.api.deps import get_settings
from app.api.v1 import realtime as realtime_api
from app.core.config import Settings
from app.services.ice import CLOUDFLARE_TURN_ENDPOINT, IceServerProvider, normalize_ice_servers
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_monitoring import (  # noqa: F401 — fixture
    MON,
    active,
    admin_token,
    candidate_token,
    ws_uses_test_db,
)

ICE = "/api/v1/realtime/ice-servers"


def ws_urls(helpers: Helpers, attempt_id: str) -> tuple[str, str]:
    cand = f"/api/v1/ws/candidates/me/proctoring?token={candidate_token(helpers)}&attempt_id={attempt_id}"
    admin = f"/api/v1/ws/admin/monitoring?token={admin_token(helpers)}"
    return cand, admin


def next_of(sock, kind: str, limit: int = 5) -> dict:
    for _ in range(limit):
        message = sock.receive_json()
        if message["type"] == kind:
            return message
    raise AssertionError(f"no {kind} message")


# -- candidate presence --------------------------------------------------------------------------------


@pytest.mark.usefixtures("ws_uses_test_db")
def test_the_tile_reports_whether_the_candidate_app_is_connected(client, helpers: Helpers, users):
    session = active(client, helpers, users)
    attempt_id = session["attempt"]["id"]
    detail = f"{MON}/sessions/{attempt_id}"

    before = client.get(detail, headers=admin_headers(helpers)).json()
    assert before["candidate_connected"] is False

    cand_url, _ = ws_urls(helpers, attempt_id)
    with client.websocket_connect(cand_url) as cand:
        assert cand.receive_json()["type"] == "CONNECTION_READY"
        during = client.get(detail, headers=admin_headers(helpers)).json()
        assert during["candidate_connected"] is True
        assert during["candidate_presence_changed_at"] is not None

    after = client.get(detail, headers=admin_headers(helpers)).json()
    assert after["candidate_connected"] is False
    assert after["candidate_presence_changed_at"] >= during["candidate_presence_changed_at"]


@pytest.mark.usefixtures("ws_uses_test_db")
def test_admins_are_told_live_when_the_candidate_app_connects_and_disconnects(
    client, helpers: Helpers, users
):
    session = active(client, helpers, users)
    attempt_id = session["attempt"]["id"]
    cand_url, admin_url = ws_urls(helpers, attempt_id)

    with client.websocket_connect(admin_url) as admin:
        assert admin.receive_json()["type"] == "CONNECTION_READY"
        with client.websocket_connect(cand_url) as cand:
            assert cand.receive_json()["type"] == "CONNECTION_READY"
            online = next_of(admin, "SESSION_UPDATED")
            assert online["session"]["attempt_id"] == attempt_id
            assert online["session"]["candidate_connected"] is True
        offline = next_of(admin, "SESSION_UPDATED")
        assert offline["session"]["candidate_connected"] is False


@pytest.mark.usefixtures("ws_uses_test_db")
def test_a_reconnecting_candidate_is_asked_to_resume_video_for_a_watching_admin(
    client, helpers: Helpers, users
):
    session = active(client, helpers, users)
    attempt_id = session["attempt"]["id"]
    cand_url, admin_url = ws_urls(helpers, attempt_id)

    with client.websocket_connect(admin_url) as admin:
        assert admin.receive_json()["type"] == "CONNECTION_READY"
        admin.send_json({"type": "WATCH", "attempt_id": attempt_id})
        assert next_of(admin, "PUBLISH_STATE")["publishing"] is False  # candidate app not connected yet

        # The candidate app connects (or reconnects after a drop) while the admin is watching.
        with client.websocket_connect(cand_url) as cand:
            assert cand.receive_json()["type"] == "CONNECTION_READY"
            assert cand.receive_json()["type"] == "WATCH"  # → it sends a fresh offer


def test_candidate_presence_is_admin_only(client, helpers: Helpers, users):
    session = active(client, helpers, users)
    response = client.get(f"{MON}/sessions/{session['attempt']['id']}", headers=session["headers"])
    assert response.status_code == 403


# -- ICE servers -------------------------------------------------------------------------------------


def test_ice_servers_require_sign_in(client):
    assert client.get(ICE).status_code == 401


def test_ice_servers_default_to_stun_for_admins_and_candidates(client, helpers: Helpers, users):
    for headers in (admin_headers(helpers), candidate_headers(helpers)):
        body = client.get(ICE, headers=headers).json()
        assert body == {
            "ice_servers": [{"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"]}],
            "turn_enabled": False,
        }


CLOUDFLARE_REPLY = {
    "iceServers": [
        {"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"]},
        {
            "urls": [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turn:turn.cloudflare.com:53?transport=udp",
                "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            "username": "short-lived-user",
            "credential": "short-lived-secret",
        },
    ]
}


def turn_settings(**overrides) -> Settings:
    values = {
        "database_url": "postgresql://u:p@h/db",
        "secret_key": "x" * 16,
        "cloudflare_turn_key_id": "key-123",
        "cloudflare_turn_api_token": "server-side-token",
        "turn_credential_ttl_seconds": 3600,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class FakeCloudflare:
    def __init__(self, reply=CLOUDFLARE_REPLY):
        self.reply = reply
        self.calls: list[tuple[str, str, dict]] = []

    def __call__(self, url, token, body, timeout):
        self.calls.append((url, token, body))
        if isinstance(self.reply, Exception):
            raise self.reply
        return self.reply


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def test_turn_credentials_are_fetched_server_side_and_filtered():
    cloudflare = FakeCloudflare()
    servers, turn = IceServerProvider(cloudflare, Clock()).ice_servers(turn_settings())

    assert turn is True
    assert cloudflare.calls == [
        (CLOUDFLARE_TURN_ENDPOINT.format(key_id="key-123"), "server-side-token", {"ttl": 3600})
    ]
    relay = [s for s in servers if "username" in s]
    assert relay == [
        {
            "urls": [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            "username": "short-lived-user",
            "credential": "short-lived-secret",
        }
    ]  # port 53 (blocked by browsers) removed
    assert all("server-side-token" not in str(s) for s in servers)


def test_turn_credentials_are_cached_then_renewed_at_half_their_lifetime():
    cloudflare, clock = FakeCloudflare(), Clock()
    provider = IceServerProvider(cloudflare, clock)
    provider.ice_servers(turn_settings())
    clock.now += 1799
    provider.ice_servers(turn_settings())
    assert len(cloudflare.calls) == 1
    clock.now += 2
    provider.ice_servers(turn_settings())
    assert len(cloudflare.calls) == 2


def test_cloudflare_failure_keeps_valid_credentials_then_falls_back_to_stun():
    cloudflare, clock = FakeCloudflare(), Clock()
    provider = IceServerProvider(cloudflare, clock)
    provider.ice_servers(turn_settings())

    cloudflare.reply = OSError("unreachable")
    clock.now += 2000  # past renewal, before expiry: the still-valid credentials are kept
    servers, turn = provider.ice_servers(turn_settings())
    assert turn is True

    clock.now += 2000  # past expiry: STUN only, never an error
    servers, turn = provider.ice_servers(turn_settings())
    assert turn is False
    assert servers == [{"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"]}]


def test_turn_is_off_without_both_settings():
    cloudflare = FakeCloudflare()
    for settings in (
        turn_settings(cloudflare_turn_api_token=None),
        turn_settings(cloudflare_turn_key_id=None),
    ):
        assert IceServerProvider(cloudflare, Clock()).ice_servers(settings)[1] is False
    assert cloudflare.calls == []


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (
            {"iceServers": {"urls": ["turn:a:3478"], "username": "u", "credential": "c"}},
            [{"urls": ["turn:a:3478"], "username": "u", "credential": "c"}],
        ),
        ({"iceServers": {"urls": "stun:a:3478"}}, [{"urls": ["stun:a:3478"]}]),
        ({"iceServers": [{"urls": ["http://evil"]}, "junk", {"urls": []}]}, []),
        ({"unexpected": True}, []),
        (None, []),
    ],
)
def test_cloudflare_replies_are_normalised_defensively(payload, expected):
    assert normalize_ice_servers(payload) == expected


def test_the_endpoint_returns_turn_when_configured(client, helpers: Helpers, users, monkeypatch):
    monkeypatch.setattr(realtime_api, "provider", IceServerProvider(FakeCloudflare(), Clock()))
    client.app.dependency_overrides[get_settings] = lambda: turn_settings()
    try:
        # Phase 8A (AX-13): the relay is for someone who needs it now — an administrator here; a candidate
        # only during a proctored exam or a call (tests/test_security_hardening.py).
        body = client.get(ICE, headers=admin_headers(helpers)).json()
    finally:
        del client.app.dependency_overrides[get_settings]
    assert body["turn_enabled"] is True
    assert {"username", "credential"} <= set(body["ice_servers"][-1])
    assert "server-side-token" not in str(body)


@pytest.mark.usefixtures("ws_uses_test_db")
def test_signaling_carries_the_negotiation_id_both_ways(client, helpers: Helpers, users):
    """Each offer's id travels with its answer and ICE, so stale negotiations can be ignored."""
    session = active(client, helpers, users)
    attempt_id = session["attempt"]["id"]
    cand_url, admin_url = ws_urls(helpers, attempt_id)

    with client.websocket_connect(cand_url) as cand, client.websocket_connect(admin_url) as admin:
        assert cand.receive_json()["type"] == "CONNECTION_READY"
        assert admin.receive_json()["type"] == "CONNECTION_READY"
        admin.send_json({"type": "WATCH", "attempt_id": attempt_id})
        assert cand.receive_json()["type"] == "WATCH"
        assert next_of(admin, "PUBLISH_STATE")

        cand.send_json({"type": "WEBRTC_OFFER", "sdp": "v=0 offer", "offer_id": "7"})
        assert next_of(admin, "WEBRTC_OFFER")["offer_id"] == "7"
        admin.send_json(
            {"type": "WEBRTC_ANSWER", "attempt_id": attempt_id, "sdp": "v=0 answer", "offer_id": "7"}
        )
        assert cand.receive_json() == {
            "type": "WEBRTC_ANSWER",
            "attempt_id": attempt_id,
            "sdp": "v=0 answer",
            "offer_id": "7",
        }
        # An id that is not a short opaque token is dropped, never relayed.
        cand.send_json({"type": "ICE_CANDIDATE", "candidate": "{}", "offer_id": "<script>" * 20})
        assert "offer_id" not in next_of(admin, "ICE_CANDIDATE")
