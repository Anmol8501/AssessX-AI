"""The in-process monitoring hub (Phase 4C).

Holds two kinds of live connections and moves typed messages between them:

* **admins** watching the live wall — they receive session deltas and proctoring events, and they
  exchange WebRTC signaling with a candidate they choose to watch;
* **candidates** whose proctored exam is in progress — one signaling connection each, keyed by
  attempt id, used only to negotiate their own live media.

Two rules keep it safe:

* **Identity and target are server-decided.** A candidate connection is bound to *its own* attempt
  id (resolved from the authenticated user), and signaling from a candidate is only ever relayed to
  admins watching *that* attempt. An admin can only watch an attempt that is a currently active
  monitorable session. A client cannot address another candidate by putting an id in a message.
* **The database is authoritative.** Broadcasts are best-effort deltas; if none are delivered, an
  admin's REST refresh still shows correct state. Nothing here is persisted.

Broadcasts originate from two places: async WebSocket handlers (direct `await`), and the sync
proctoring service after a candidate REST action (`publish_threadsafe`, which hops onto the event
loop). The hub captures the running loop lazily so the sync path has somewhere to schedule onto.
"""

import asyncio
import logging
from collections import defaultdict
from typing import Any
from uuid import UUID

from starlette.websockets import WebSocket, WebSocketState

log = logging.getLogger("assessx.monitoring.hub")


class MonitoringHub:
    def __init__(self) -> None:
        self._admins: set[WebSocket] = set()
        #: attempt_id → the candidate's single publisher connection
        self._candidates: dict[UUID, WebSocket] = {}
        #: attempt_id → the set of admin connections currently watching that candidate's media
        self._watchers: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    # -- lifecycle -----------------------------------------------------------------------

    @property
    def has_admins(self) -> bool:
        return bool(self._admins)

    def _remember_loop(self) -> None:
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    async def add_admin(self, ws: WebSocket) -> None:
        self._remember_loop()
        self._admins.add(ws)

    def remove_admin(self, ws: WebSocket) -> None:
        self._admins.discard(ws)
        for watchers in self._watchers.values():
            watchers.discard(ws)

    async def add_candidate(self, attempt_id: UUID, ws: WebSocket) -> None:
        self._remember_loop()
        # A reconnect replaces any stale connection for the same attempt.
        self._candidates[attempt_id] = ws

    def remove_candidate(self, attempt_id: UUID, ws: WebSocket) -> None:
        if self._candidates.get(attempt_id) is ws:
            del self._candidates[attempt_id]

    # -- admin watching a candidate's media ----------------------------------------------

    def watch(self, attempt_id: UUID, admin: WebSocket) -> bool:
        """An admin starts watching one candidate's media. True if that candidate is publishing."""
        self._watchers[attempt_id].add(admin)
        return attempt_id in self._candidates

    def unwatch(self, attempt_id: UUID, admin: WebSocket) -> None:
        self._watchers[attempt_id].discard(admin)

    def candidate_of(self, attempt_id: UUID) -> WebSocket | None:
        return self._candidates.get(attempt_id)

    def is_watching(self, attempt_id: UUID, admin: WebSocket) -> bool:
        return admin in self._watchers.get(attempt_id, set())

    def admins_watching(self, attempt_id: UUID) -> list[WebSocket]:
        return [a for a in self._watchers.get(attempt_id, set()) if a in self._admins]

    # -- sending -------------------------------------------------------------------------

    async def broadcast_admins(self, message: dict[str, Any]) -> None:
        for ws in list(self._admins):
            await self._send(ws, message)

    async def send_to_candidate(self, attempt_id: UUID, message: dict[str, Any]) -> bool:
        ws = self._candidates.get(attempt_id)
        if ws is None:
            return False
        return await self._send(ws, message)

    async def relay_to_watchers(self, attempt_id: UUID, message: dict[str, Any]) -> None:
        for ws in self.admins_watching(attempt_id):
            await self._send(ws, message)

    @staticmethod
    async def _send(ws: WebSocket, message: dict[str, Any]) -> bool:
        if ws.application_state is not WebSocketState.CONNECTED:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception:  # noqa: BLE001 — a broken socket must not break a broadcast to the rest
            log.debug("Dropped a monitoring message to a closed socket", exc_info=True)
            return False

    # -- the sync → async bridge ---------------------------------------------------------

    def publish_threadsafe(self, message: dict[str, Any]) -> None:
        """Broadcast to admins from synchronous code (a candidate's REST action).

        No-op when no event loop is running or no admins are connected, so the proctoring path
        stays cheap and never blocks on realtime delivery.
        """
        loop = self._loop
        if loop is None or not self._admins:
            return
        try:
            asyncio.run_coroutine_threadsafe(self.broadcast_admins(message), loop)
        except RuntimeError:
            log.debug("Monitoring broadcast skipped: event loop not running")


#: The process-wide hub. Imported by the WebSocket routes and the proctoring service.
hub = MonitoringHub()
