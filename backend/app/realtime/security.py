"""WebSocket authentication and limits (Phase 8A, AX-04 / AX-05).

**Tickets, not session tokens, in WebSocket URLs.** A browser WebSocket cannot send an Authorization
header, so the credential has to travel in the URL — where proxies may log it. Instead of the session
token (valid for hours or days), the app first asks `POST /api/v1/realtime/ws-ticket` (authenticated by
its normal header) for a ticket: an HMAC-signed, single-purpose reference to that session, valid for
`WS_TICKET_TTL_SECONDS` (default 60 s) and usable once. A logged URL is useless soon after. The legacy
`?token=` is still accepted while `WS_ALLOW_LEGACY_TOKEN` is on, for installed apps up to 0.1.3.

**A socket lives only as long as its session.** `SocketGuard.receive` re-checks the session every
`RECHECK_SECONDS`: after logout, "sign out everywhere", a password change elsewhere, deactivation or
expiry, the socket is closed (code 1008) within that interval.

**Bounded traffic.** Frames are capped by the server (`ws_max_size`) and again here (`MAX_MESSAGE_CHARS`);
messages pass through a per-connection token bucket, excess is dropped, and a connection that keeps
flooding is closed.

Single-use is enforced in this process's memory, which matches the single-instance deployment
(docs/DEPLOYMENT-RENDER.md). A multi-instance deployment would move the used-ticket set to PostgreSQL.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session
from starlette.websockets import WebSocket

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.base import utcnow
from app.models.user import UserRole
from app.repositories.auth_sessions import AuthSessionRepository

PURPOSES = frozenset({"monitoring", "proctoring", "call"})
#: How often an open socket re-checks that its session is still valid.
RECHECK_SECONDS = 30.0
MAX_MESSAGE_CHARS = 256 * 1024
#: Token bucket: sustained messages per second, and the burst allowed.
RATE_PER_SECOND = 20.0
BURST = 60.0
#: A connection that has dropped this many messages for flooding is closed.
MAX_DROPPED = 200

_POLICY_VIOLATION = 1008
_TOO_BIG = 1009

_used: dict[str, float] = {}
_used_lock = threading.Lock()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    return hmac.new(get_settings().secret_key.encode(), payload.encode(), hashlib.sha256).hexdigest()


def issue_ticket(session_id: uuid.UUID, purpose: str) -> tuple[str, int]:
    """A ticket for one WebSocket connection of this session. Returns it and its lifetime (seconds)."""
    if purpose not in PURPOSES:
        raise ValueError("unknown purpose")
    ttl = get_settings().ws_ticket_ttl_seconds
    body = json.dumps(
        {"s": str(session_id), "p": purpose, "e": int(time.time()) + ttl, "n": secrets.token_urlsafe(12)},
        separators=(",", ":"),
    )
    encoded = _b64(body.encode())
    return f"{encoded}.{_sign(encoded)}", ttl


def redeem_ticket(ticket: str, purpose: str) -> uuid.UUID | None:
    """The session id a valid, unexpired, unused ticket for `purpose` refers to — else None. Single use."""
    try:
        encoded, signature = ticket.split(".", 1)
        if not hmac.compare_digest(signature, _sign(encoded)):
            return None
        body = json.loads(_unb64(encoded))
        session_id = uuid.UUID(body["s"])
        expires = int(body["e"])
        nonce = str(body["n"])
        if body["p"] != purpose or expires < time.time():
            return None
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None
    now = time.time()
    with _used_lock:
        for key in [k for k, until in _used.items() if until < now]:
            del _used[key]  # forget tickets that have expired anyway
        if nonce in _used:
            return None
        _used[nonce] = expires
    return session_id


@contextmanager
def db_session() -> Iterator[Session]:
    """A short-lived DB session for socket checks (outside the request middleware). Patched in tests."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@dataclass(frozen=True)
class SocketUser:
    """What a socket handler needs to know about its user — a snapshot, detached from any DB session."""

    id: uuid.UUID
    role: UserRole
    name: str
    is_active: bool


def live_user(session_id: uuid.UUID) -> SocketUser | None:
    """The session's user while the session is valid and the user active; else None."""
    with db_session() as db:
        session = AuthSessionRepository(db).get(session_id)
        if session is None or not session.is_valid(utcnow()) or not session.user.is_active:
            return None
        user = session.user
        return SocketUser(id=user.id, role=user.role, name=user.name, is_active=user.is_active)


def authenticate(ws: WebSocket, purpose: str, legacy) -> tuple[Any, uuid.UUID | None] | None:  # noqa: ANN001
    """Resolves a socket's credential: a ticket for `purpose`, or (if allowed) the legacy token via
    `legacy(token) -> (user, session_id)`. None when neither is valid."""
    ticket = ws.query_params.get("ticket")
    if ticket:
        session_id = redeem_ticket(ticket, purpose)
        user = live_user(session_id) if session_id else None
        if user is None:
            _security("websocket_auth_failed", ws, details={"purpose": purpose, "credential": "ticket"})
        return (user, session_id) if user else None
    token = ws.query_params.get("token")
    if token and get_settings().ws_allow_legacy_token:
        found = legacy(token)
        if found is None:
            _security("websocket_auth_failed", ws, details={"purpose": purpose, "credential": "legacy"})
        return found
    _security("websocket_auth_failed", ws, details={"purpose": purpose, "credential": "none"})
    return None


def _security(
    event_type: str, ws: WebSocket, *, actor_id: Any = None, details: dict[str, Any] | None = None
) -> None:
    from app.core.limits import client_ip
    from app.services import security_events

    security_events.record(event_type, actor_id=actor_id, client_ip=client_ip(ws), details=details)


class SocketSlots:
    """Open sockets per user (CX-12): a user may hold at most `MAX_SOCKETS_PER_USER` at once."""

    def __init__(self) -> None:
        self._open: dict[uuid.UUID, int] = {}

    def acquire(self, user_id: uuid.UUID) -> bool:
        if self._open.get(user_id, 0) >= get_settings().max_sockets_per_user:
            return False
        self._open[user_id] = self._open.get(user_id, 0) + 1
        return True

    def release(self, user_id: uuid.UUID) -> None:
        left = self._open.get(user_id, 0) - 1
        if left > 0:
            self._open[user_id] = left
        else:
            self._open.pop(user_id, None)

    def count(self, user_id: uuid.UUID) -> int:
        return self._open.get(user_id, 0)


slots = SocketSlots()


async def admit(ws: WebSocket, user: Any) -> bool:
    """Takes one of the user's socket slots, or refuses the connection (1008) and records why."""
    if slots.acquire(user.id):
        return True
    _security("websocket_connection_limit", ws, actor_id=user.id, details={"open": slots.count(user.id)})
    await ws.close(code=_POLICY_VIOLATION)
    return False


class SocketGuard:
    """Receives JSON messages for one connection: bounded in size and rate, and only while the
    connection's session is valid. `receive()` returns a dict, or None once the socket was closed."""

    def __init__(self, ws: WebSocket, session_id: uuid.UUID | None, user_id: Any = None) -> None:
        self.ws = ws
        self.session_id = session_id
        self.user_id = user_id
        self.tokens = BURST
        self.updated = time.monotonic()
        self.dropped = 0
        self.next_check = time.monotonic() + RECHECK_SECONDS

    async def _session_valid(self) -> bool:
        if self.session_id is None:
            return True  # legacy token connections were authenticated at connect only
        return await asyncio.to_thread(live_user, self.session_id) is not None

    def _allow(self) -> bool:
        now = time.monotonic()
        self.tokens = min(BURST, self.tokens + (now - self.updated) * RATE_PER_SECOND)
        self.updated = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        self.dropped += 1
        return False

    async def receive(self) -> dict[str, Any] | None:
        while True:
            wait = self.next_check - time.monotonic()
            if wait <= 0:
                self.next_check = time.monotonic() + RECHECK_SECONDS
                if not await self._session_valid():
                    await self.ws.close(code=_POLICY_VIOLATION)
                    return None
                continue
            try:
                text = await asyncio.wait_for(self.ws.receive_text(), timeout=wait)
            except TimeoutError:
                continue
            if len(text) > MAX_MESSAGE_CHARS:
                await asyncio.to_thread(
                    _security,
                    "websocket_abuse",
                    self.ws,
                    actor_id=self.user_id,
                    details={"reason": "oversized"},
                )
                await self.ws.close(code=_TOO_BIG)
                return None
            if not self._allow():
                if self.dropped >= MAX_DROPPED:
                    await asyncio.to_thread(
                        _security,
                        "websocket_abuse",
                        self.ws,
                        actor_id=self.user_id,
                        details={"reason": "flooding"},
                    )
                    await self.ws.close(code=_POLICY_VIOLATION)
                    return None
                continue
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict):
                return data
