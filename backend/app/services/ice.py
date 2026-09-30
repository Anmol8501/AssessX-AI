"""WebRTC ICE servers for live monitoring video.

A candidate's camera reaches the watching admin peer-to-peer over WebRTC. On the same network that
needs nothing; across networks each side needs a STUN server to learn its public address, and on
networks that forbid direct connections (carrier-grade NAT, strict firewalls — common on mobile
hotspots and campus Wi-Fi) the video must be relayed by a TURN server.

* STUN servers come from `STUN_URLS` and are always returned.
* TURN is used only when `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` are set. The
  token never leaves the server: it is used here to ask Cloudflare for short-lived TURN credentials,
  which are cached until half their lifetime has passed and then renewed.
* Failure is never fatal: if Cloudflare cannot be reached, STUN alone is returned (video then works
  wherever a direct connection is possible) and a warning is logged without any credential.
"""

import json
import logging
import threading
import time
import urllib.request
from collections.abc import Callable
from typing import Any

from app.core.config import Settings

log = logging.getLogger("assessx.realtime.ice")

CLOUDFLARE_TURN_ENDPOINT = (
    "https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"
)
#: Credentials are renewed once this fraction of their lifetime has passed.
_RENEW_FRACTION = 0.5

IceServer = dict[str, Any]
PostJson = Callable[[str, str, dict[str, Any], float], Any]


def _post_json(url: str, token: str, body: dict[str, Any], timeout: float) -> Any:
    request = urllib.request.Request(  # noqa: S310 — fixed https:// endpoint, never user input
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return json.loads(response.read())


def _usable_url(url: str) -> bool:
    # Cloudflare also offers TURN on port 53, which browsers block; offering it only slows ICE down.
    return url.startswith(("stun:", "turn:", "turns:")) and not url.split("?")[0].endswith(":53")


def normalize_ice_servers(payload: Any) -> list[IceServer]:
    """Cloudflare's reply as RTCIceServer objects — tolerant of a single object or a list."""
    raw = payload.get("iceServers") if isinstance(payload, dict) else None
    entries = raw if isinstance(raw, list) else [raw] if isinstance(raw, dict) else []
    servers: list[IceServer] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        urls = entry.get("urls")
        urls = [urls] if isinstance(urls, str) else urls if isinstance(urls, list) else []
        urls = [u for u in urls if isinstance(u, str) and _usable_url(u)]
        if not urls:
            continue
        server: IceServer = {"urls": urls}
        if isinstance(entry.get("username"), str) and isinstance(entry.get("credential"), str):
            server["username"] = entry["username"]
            server["credential"] = entry["credential"]
        servers.append(server)
    return servers


class IceServerProvider:
    """Builds the ICE server list; one instance per process caches the TURN credentials."""

    def __init__(self, post_json: PostJson = _post_json, clock: Callable[[], float] = time.monotonic) -> None:
        self._post_json = post_json
        self._clock = clock
        self._lock = threading.Lock()
        self._turn: list[IceServer] = []
        self._renew_at = 0.0
        self._expires_at = 0.0

    def ice_servers(self, settings: Settings) -> tuple[list[IceServer], bool]:
        """The servers to use, and whether a TURN relay is among them."""
        stun: list[IceServer] = [{"urls": list(settings.stun_urls)}] if settings.stun_urls else []
        turn = self._turn_servers(settings)
        return stun + turn, bool(turn)

    def _turn_servers(self, settings: Settings) -> list[IceServer]:
        key_id, token = settings.cloudflare_turn_key_id, settings.cloudflare_turn_api_token
        if not key_id or not token:
            return []
        with self._lock:
            now = self._clock()
            if self._turn and now < self._renew_at:
                return self._turn
            ttl = settings.turn_credential_ttl_seconds
            try:
                payload = self._post_json(
                    CLOUDFLARE_TURN_ENDPOINT.format(key_id=key_id), token, {"ttl": ttl}, 5.0
                )
                servers = [s for s in normalize_ice_servers(payload) if "username" in s]
            except Exception as error:  # noqa: BLE001 — never fatal: fall back to STUN
                log.warning(
                    "TURN credentials unavailable; using STUN only", extra={"error": type(error).__name__}
                )
                # Keep serving still-valid credentials through a transient failure.
                return self._turn if now < self._expires_at else []
            if not servers:
                log.warning("TURN credentials response had no usable servers; using STUN only")
                return self._turn if now < self._expires_at else []
            self._turn = servers
            self._renew_at = now + ttl * _RENEW_FRACTION
            self._expires_at = now + ttl
            return servers


provider = IceServerProvider()
