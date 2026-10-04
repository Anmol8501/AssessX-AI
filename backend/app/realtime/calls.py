"""Phase 7D — the in-process hub for live interview calls: who is connected to which call, and relaying.

A call has exactly two sides: the **interviewer** (an administrator) and the **candidate** assigned to the
interview. The hub only ever relays between the two sides *of the same call*; who may take a side is
decided by the WebSocket route from the database before anything reaches here. No media passes through:
the hub carries signaling (SDP offers/answers, ICE candidates), each side's mute/camera/screen state,
and chat messages the route has already stored.
"""

import asyncio
import enum
import logging
from typing import Any
from uuid import UUID

from starlette.websockets import WebSocket, WebSocketState

log = logging.getLogger("assessx.interviews.calls")


class CallMessage(enum.StrEnum):
    READY = "READY"  # server → joiner: you are connected (and whether the other side is present)
    PEER_JOINED = "PEER_JOINED"
    PEER_LEFT = "PEER_LEFT"
    OFFER = "OFFER"  # candidate → interviewer (the candidate always offers)
    ANSWER = "ANSWER"  # interviewer → candidate
    ICE = "ICE"  # either way
    MEDIA_STATE = "MEDIA_STATE"  # either way: {audio, video, screen} on/off
    #: interviewer → candidate: video did not connect, send a fresh offer (the candidate always offers)
    RENEGOTIATE = "RENEGOTIATE"
    CHAT = "CHAT"  # client → server {body}; server → both {message}
    CALL_ENDED = "CALL_ENDED"
    ERROR = "ERROR"


SIDES = ("interviewer", "candidate")


def other(side: str) -> str:
    return "candidate" if side == "interviewer" else "interviewer"


class CallHub:
    def __init__(self) -> None:
        #: call id → side → (user id, socket)
        self._rooms: dict[UUID, dict[str, tuple[UUID, WebSocket]]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def _remember_loop(self) -> None:
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    async def join(self, call_id: UUID, side: str, user_id: UUID, ws: WebSocket) -> bool:
        """Takes a side. False if another person already holds it (a call is one-to-one). The same person
        reconnecting replaces their previous connection, which is closed."""
        self._remember_loop()
        room = self._rooms.setdefault(call_id, {})
        held = room.get(side)
        if held is not None and held[0] != user_id:
            return False
        room[side] = (user_id, ws)
        if held is not None and held[1] is not ws:
            await self._close(held[1])
        return True

    def leave(self, call_id: UUID, side: str, ws: WebSocket) -> bool:
        """Forgets this connection if it still holds the side. True if it did (the peer should be told)."""
        room = self._rooms.get(call_id)
        if not room or side not in room or room[side][1] is not ws:
            return False
        del room[side]
        if not room:
            self._rooms.pop(call_id, None)
        return True

    def present(self, call_id: UUID, side: str) -> bool:
        return side in self._rooms.get(call_id, {})

    async def send(self, call_id: UUID, side: str, message: dict[str, Any]) -> bool:
        held = self._rooms.get(call_id, {}).get(side)
        return await self._send(held[1], message) if held else False

    async def broadcast(self, call_id: UUID, message: dict[str, Any]) -> None:
        for _, ws in list(self._rooms.get(call_id, {}).values()):
            await self._send(ws, message)

    async def end(self, call_id: UUID) -> None:
        """Tells both sides the call has ended and closes their connections."""
        room = self._rooms.pop(call_id, {})
        for _, ws in room.values():
            await self._send(ws, {"type": CallMessage.CALL_ENDED.value, "call_id": str(call_id)})
            await self._close(ws)

    def end_threadsafe(self, call_id: UUID) -> None:
        """`end` from synchronous code (the REST route that ended the call). Best-effort: the call is
        already ENDED in the database, and a client that misses this sees it on its next read."""
        loop = self._loop
        if loop is None or call_id not in self._rooms:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.end(call_id), loop)
        except RuntimeError:
            log.debug("Call end broadcast skipped: event loop not running")

    @staticmethod
    async def _send(ws: WebSocket, message: dict[str, Any]) -> bool:
        if ws.application_state is not WebSocketState.CONNECTED:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception:  # noqa: BLE001 — a broken socket must not break the other side
            log.debug("Dropped a call message to a closed socket", exc_info=True)
            return False

    @staticmethod
    async def _close(ws: WebSocket) -> None:
        if ws.application_state is WebSocketState.CONNECTED:
            try:
                await ws.close(code=1000)
            except Exception:  # noqa: BLE001
                log.debug("Closing a call socket failed", exc_info=True)


#: The process-wide call hub.
call_hub = CallHub()
