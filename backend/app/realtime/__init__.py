"""In-process realtime layer for live admin monitoring (Phase 4C).

A single `MonitoringHub` instance (`hub`) holds the WebSocket connections and relays typed
messages between admins and candidates. It is deliberately process-local: there is no Redis or
external broker in this build, so live monitoring works within one backend process only. The
database remains authoritative — an admin that misses a message re-fetches current state over REST
(see `services/monitoring.py`), so nothing depends on realtime delivery for correctness.
"""

from app.realtime.hub import MonitoringHub, hub
from app.realtime.messages import MessageType, message

__all__ = ["MessageType", "MonitoringHub", "hub", "message"]
