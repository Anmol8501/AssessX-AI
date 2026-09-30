"""Monitoring WebSockets (Phase 4C): live state for admins, WebRTC signaling for live media.

Two endpoints, both authenticated by a bearer token in the query string (a browser WebSocket
cannot set an Authorization header):

* ``/api/v1/ws/admin/monitoring`` — an **admin** viewer. Receives session deltas and proctoring
  events, and relays WebRTC answer/ICE to a candidate it has chosen to watch.
* ``/api/v1/ws/candidates/me/proctoring`` — a **candidate** publisher for *their own* active
  proctored attempt. Relays its WebRTC offer/ICE to admins watching it.

Security is server-side throughout: the token decides identity, the role decides which endpoint is
allowed, and signaling is only ever relayed along a validated admin ↔ candidate pairing for a
currently active monitorable session. No message carries a video frame — media travels peer-to-peer
over WebRTC; the WebSocket is signaling and state only. The database (reached via REST) stays
authoritative, so a missed message is corrected by the admin's periodic refresh/reconnect.
"""

import logging
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import APIRouter
from sqlalchemy.orm import Session
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.attempt import AssessmentAttempt
from app.models.proctoring import ProctoringSessionStatus
from app.models.user import User, UserRole
from app.realtime.hub import hub
from app.realtime.messages import MessageType, message
from app.services.auth import AuthService

log = logging.getLogger("assessx.monitoring.ws")

router = APIRouter()

# Close codes (RFC 6455 application range).
_POLICY_VIOLATION = 1008

_SDP_MAX = 200_000  # a generous ceiling on one SDP/ICE payload


@contextmanager
def _session() -> Iterator[Session]:
    """A short-lived DB session for a WebSocket handler (outside the request middleware).

    A single seam so the whole module's database access — auth and the monitorable/ownership
    checks — can be pointed at the test transaction in the suite.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _authenticate(token: str | None) -> User | None:
    """Resolves a token to a live user, or None. Uses its own short-lived DB session."""
    if not token:
        return None
    try:
        with _session() as db:
            session = AuthService(db, get_settings()).authenticate(token)
            user = session.user
            _ = user.role  # load while the session is open
            return user
    except Exception:  # noqa: BLE001 — any auth failure is just "not authenticated"
        return None


def _clean(value: object) -> bool:
    return isinstance(value, str) and 0 < len(value) <= _SDP_MAX


@router.websocket("/ws/admin/monitoring")
async def admin_monitoring(ws: WebSocket) -> None:
    user = _authenticate(ws.query_params.get("token"))
    if user is None:
        await ws.close(code=_POLICY_VIOLATION)
        return
    if user.role is not UserRole.ADMIN:
        await ws.accept()
        await ws.send_json(message(MessageType.ERROR, error="forbidden"))
        await ws.close(code=_POLICY_VIOLATION)
        return

    await ws.accept()
    await hub.add_admin(ws)
    await ws.send_json(message(MessageType.CONNECTION_READY, role="admin"))
    try:
        while True:
            data = await ws.receive_json()
            await _handle_admin_message(ws, data)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.debug("Admin monitoring socket error", exc_info=True)
    finally:
        # Tell each watched candidate this admin is gone, then forget the admin.
        for attempt_id in list(_watched_attempts(ws)):
            await _stop_watch(ws, attempt_id)
        hub.remove_admin(ws)


def _watched_attempts(ws: WebSocket) -> list[uuid.UUID]:
    return [aid for aid, admins in hub._watchers.items() if ws in admins]  # noqa: SLF001 — same package


async def _handle_admin_message(ws: WebSocket, data: dict) -> None:
    kind = data.get("type")
    attempt_id = _as_uuid(data.get("attempt_id"))

    if kind == MessageType.WATCH.value and attempt_id is not None:
        if not _is_active_monitorable(attempt_id):
            await ws.send_json(
                message(MessageType.ERROR, error="not_monitorable", attempt_id=str(attempt_id))
            )
            return
        publishing = hub.watch(attempt_id, ws)
        # Ask the candidate (if connected) to (re)send an offer for this new watcher.
        await hub.send_to_candidate(attempt_id, message(MessageType.WATCH, attempt_id=str(attempt_id)))
        await ws.send_json(
            message(MessageType.PUBLISH_STATE, attempt_id=str(attempt_id), publishing=publishing)
        )

    elif kind == MessageType.UNWATCH.value and attempt_id is not None:
        await _stop_watch(ws, attempt_id)

    elif (
        kind in {MessageType.WEBRTC_ANSWER.value, MessageType.ICE_CANDIDATE.value} and attempt_id is not None
    ):
        # Relayed to the candidate only if this admin is actually watching that attempt.
        if not hub.is_watching(attempt_id, ws):
            return
        payload = data.get("sdp") if kind == MessageType.WEBRTC_ANSWER.value else data.get("candidate")
        if not _clean(payload):
            return
        field = "sdp" if kind == MessageType.WEBRTC_ANSWER.value else "candidate"
        await hub.send_to_candidate(
            attempt_id, message(MessageType(kind), attempt_id=str(attempt_id), **{field: payload})
        )


async def _stop_watch(ws: WebSocket, attempt_id: uuid.UUID) -> None:
    hub.unwatch(attempt_id, ws)
    if not hub.admins_watching(attempt_id):
        await hub.send_to_candidate(attempt_id, message(MessageType.UNWATCH, attempt_id=str(attempt_id)))


@router.websocket("/ws/candidates/me/proctoring")
async def candidate_proctoring(ws: WebSocket) -> None:
    user = _authenticate(ws.query_params.get("token"))
    attempt_id = _as_uuid(ws.query_params.get("attempt_id"))
    if user is None or attempt_id is None:
        await ws.close(code=_POLICY_VIOLATION)
        return
    if user.role is not UserRole.CANDIDATE or not _owned_active_session(user.id, attempt_id):
        await ws.accept()
        await ws.send_json(message(MessageType.ERROR, error="forbidden"))
        await ws.close(code=_POLICY_VIOLATION)
        return

    await ws.accept()
    await hub.add_candidate(attempt_id, ws)
    await ws.send_json(message(MessageType.CONNECTION_READY, role="candidate", attempt_id=str(attempt_id)))
    try:
        while True:
            data = await ws.receive_json()
            await _handle_candidate_message(ws, attempt_id, data)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.debug("Candidate proctoring socket error", exc_info=True)
    finally:
        hub.remove_candidate(attempt_id, ws)


async def _handle_candidate_message(ws: WebSocket, attempt_id: uuid.UUID, data: dict) -> None:
    kind = data.get("type")
    # A candidate can only ever signal about *their own* bound attempt — the attempt id is the
    # connection's, never taken from the message.
    if kind in {MessageType.WEBRTC_OFFER.value, MessageType.ICE_CANDIDATE.value}:
        payload = data.get("sdp") if kind == MessageType.WEBRTC_OFFER.value else data.get("candidate")
        if not _clean(payload):
            return
        field = "sdp" if kind == MessageType.WEBRTC_OFFER.value else "candidate"
        await hub.relay_to_watchers(
            attempt_id, message(MessageType(kind), attempt_id=str(attempt_id), **{field: payload})
        )
    elif kind == MessageType.PUBLISH_STATE.value:
        publishing = bool(data.get("publishing"))
        await hub.relay_to_watchers(
            attempt_id, message(MessageType.PUBLISH_STATE, attempt_id=str(attempt_id), publishing=publishing)
        )


# -- validation (own DB session; WS is outside the request middleware) ------------------------


def _as_uuid(value: object) -> uuid.UUID | None:
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def _is_active_monitorable(attempt_id: uuid.UUID) -> bool:
    with _session() as db:
        attempt = db.get(AssessmentAttempt, attempt_id)
        if attempt is None or not attempt.is_active or attempt.proctoring_session is None:
            return False
        return attempt.proctoring_session.status is ProctoringSessionStatus.ACTIVE


def _owned_active_session(user_id: uuid.UUID, attempt_id: uuid.UUID) -> bool:
    with _session() as db:
        attempt = db.get(AssessmentAttempt, attempt_id)
        if attempt is None or attempt.candidate_id != user_id or not attempt.is_active:
            return False
        session = attempt.proctoring_session
        return session is not None and session.status is ProctoringSessionStatus.ACTIVE
