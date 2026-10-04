"""Phase 7D — the live interview call WebSocket: signaling and chat between the two participants.

``/api/v1/ws/interview-calls/{call_id}?token=…`` — authenticated by the bearer token (a browser
WebSocket cannot set headers). The database decides who may connect: the call must be OPEN; a candidate
only to a call of their own assignment (the *candidate* side); an administrator as the *interviewer*.
Each side is held by one person at a time (a call is one-to-one); the same person reconnecting replaces
their old connection.

Relaying is strictly between the two sides of this call: offers only from the candidate, answers only
from the interviewer, ICE candidates and media state either way, each size-bounded. The interviewer
may ask the candidate for a fresh offer (RENEGOTIATE) when video did not connect. Chat messages are
stored first, then delivered to both. No media passes through — WebRTC is peer-to-peer — and nothing here
is recorded.
"""

import logging
import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import APIRouter
from sqlalchemy.orm import Session
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.models.user import User
from app.realtime.calls import CallMessage, call_hub, other
from app.schemas.interview_call import ChatMessageOut
from app.services.auth import AuthService
from app.services.interview.calls import CallService

log = logging.getLogger("assessx.interviews.calls.ws")

router = APIRouter()

_POLICY_VIOLATION = 1008
_SDP_MAX = 200_000
_OFFER_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@contextmanager
def _session() -> Iterator[Session]:
    """A short-lived DB session (outside the request middleware). One seam, so tests can point it at
    the test transaction."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _authenticate(token: str | None) -> User | None:
    if not token:
        return None
    try:
        with _session() as db:
            user = AuthService(db, get_settings()).authenticate(token).user
            _ = (user.role, user.name, user.is_active)
            return user
    except Exception:  # noqa: BLE001 — any auth failure is "not authenticated"
        return None


def _side(call_id: uuid.UUID, user: User) -> str | None:
    with _session() as db:
        found = CallService(db).participant(call_id, db.get(User, user.id) or user)
        return found[1] if found else None


def _msg(kind: CallMessage, **fields: object) -> dict:
    return {"type": kind.value, **fields}


def _offer_id(data: dict) -> dict[str, str]:
    value = data.get("offer_id")
    return {"offer_id": value} if isinstance(value, str) and _OFFER_ID.match(value) else {}


def _clean(value: object) -> bool:
    return isinstance(value, str) and 0 < len(value) <= _SDP_MAX


@router.websocket("/ws/interview-calls/{call_id}")
async def interview_call(ws: WebSocket, call_id: uuid.UUID) -> None:
    user = _authenticate(ws.query_params.get("token"))
    if user is None:
        await ws.close(code=_POLICY_VIOLATION)
        return
    side = _side(call_id, user)
    if side is None:
        await ws.accept()
        await ws.send_json(_msg(CallMessage.ERROR, error="forbidden"))
        await ws.close(code=_POLICY_VIOLATION)
        return

    await ws.accept()
    if not await call_hub.join(call_id, side, user.id, ws):
        await ws.send_json(_msg(CallMessage.ERROR, error="occupied"))
        await ws.close(code=_POLICY_VIOLATION)
        return
    peer = other(side)
    await ws.send_json(_msg(CallMessage.READY, role=side, peer_present=call_hub.present(call_id, peer)))
    await call_hub.send(call_id, peer, _msg(CallMessage.PEER_JOINED, role=side))
    try:
        while True:
            data = await ws.receive_json()
            if isinstance(data, dict):
                await _handle(ws, call_id, side, user, data)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.debug("Interview call socket error", exc_info=True)
    finally:
        if call_hub.leave(call_id, side, ws):
            await call_hub.send(call_id, peer, _msg(CallMessage.PEER_LEFT, role=side))


async def _handle(ws: WebSocket, call_id: uuid.UUID, side: str, user: User, data: dict) -> None:
    kind = data.get("type")
    peer = other(side)
    if kind == CallMessage.OFFER.value and side == "candidate" and _clean(data.get("sdp")):
        await call_hub.send(call_id, peer, _msg(CallMessage.OFFER, sdp=data["sdp"], **_offer_id(data)))
    elif kind == CallMessage.ANSWER.value and side == "interviewer" and _clean(data.get("sdp")):
        await call_hub.send(call_id, peer, _msg(CallMessage.ANSWER, sdp=data["sdp"], **_offer_id(data)))
    elif kind == CallMessage.ICE.value and _clean(data.get("candidate")):
        await call_hub.send(
            call_id, peer, _msg(CallMessage.ICE, candidate=data["candidate"], **_offer_id(data))
        )
    elif kind == CallMessage.RENEGOTIATE.value and side == "interviewer":
        await call_hub.send(call_id, peer, _msg(CallMessage.RENEGOTIATE))
    elif kind == CallMessage.MEDIA_STATE.value:
        state = {k: bool(data.get(k)) for k in ("audio", "video", "screen")}
        await call_hub.send(call_id, peer, _msg(CallMessage.MEDIA_STATE, role=side, **state))
    elif kind == CallMessage.CHAT.value and isinstance(data.get("body"), str):
        stored = _store_chat(call_id, user, data["body"])
        if stored is not None:
            await call_hub.broadcast(call_id, _msg(CallMessage.CHAT, message=stored))


def _store_chat(call_id: uuid.UUID, user: User, body: str) -> dict | None:
    """Stores a chat message (only from a participant of an OPEN call) and returns it as sent."""
    with _session() as db:
        service = CallService(db)
        found = service.participant(call_id, db.get(User, user.id) or user)
        if found is None:
            return None
        message = service.add_message(found[0], db.get(User, user.id) or user, body)
        return ChatMessageOut.of(message).model_dump(mode="json") if message else None
