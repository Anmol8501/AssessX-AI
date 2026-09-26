"""The typed message protocol for the monitoring WebSockets (Phase 4C).

Every message is `{"type": <MessageType>, ...fields}`. The protocol is deliberately small and
explicit — no arbitrary dictionaries — and carries only factual state and WebRTC signaling. It
never carries risk, verdicts, media frames, answers or secrets.
"""

import enum
from typing import Any


class MessageType(enum.StrEnum):
    # server → admin: live session state (the DB is still authoritative; these are deltas)
    SESSION_ADDED = "SESSION_ADDED"
    SESSION_UPDATED = "SESSION_UPDATED"
    SESSION_REMOVED = "SESSION_REMOVED"
    PROCTORING_EVENT = "PROCTORING_EVENT"
    # server → client: connection lifecycle
    CONNECTION_READY = "CONNECTION_READY"
    ERROR = "ERROR"
    # WebRTC signaling, relayed verbatim between an admin viewer and a candidate publisher
    WEBRTC_OFFER = "WEBRTC_OFFER"
    WEBRTC_ANSWER = "WEBRTC_ANSWER"
    ICE_CANDIDATE = "ICE_CANDIDATE"
    # admin → server: ask to view / stop viewing a candidate's live media
    WATCH = "WATCH"
    UNWATCH = "UNWATCH"
    # candidate/admin → server: whether the candidate is currently publishing media
    PUBLISH_STATE = "PUBLISH_STATE"


def message(type_: MessageType, **fields: Any) -> dict[str, Any]:
    return {"type": type_.value, **fields}
