import contextlib
import logging
import uuid
from typing import Literal

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect, status
from starlette.websockets import WebSocketState

from app.api.deps import CandidateUser, DbSession
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.schemas.secondary_camera import (
    SecondaryCameraCreateResponse,
    SecondaryCameraHeartbeatRequest,
    SecondaryCameraPairRequest,
    SecondaryCameraPairResponse,
    SecondaryCameraSessionOut,
)
from app.services.ice import provider
from app.services.secondary_camera import SecondaryCameraService

log = logging.getLogger("assessx.secondary_camera")

router = APIRouter(prefix="/proctoring/secondary-camera", tags=["secondary_camera"])


@router.post(
    "/attempts/{attempt_id}/session",
    response_model=SecondaryCameraCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def get_or_create_session(
    attempt_id: uuid.UUID,
    user: CandidateUser,
    db: DbSession,
    request: Request,
) -> SecondaryCameraCreateResponse:
    """Create or refresh a short-lived pairing session and QR code URL for the candidate's attempt."""
    # Use Host header from the request so mobile phone reaches the desktop server
    host = request.headers.get("host") or "localhost:1420"
    # If host is backend port 8000, swap to 1420 for Vite frontend unless configured
    if ":8000" in host:
        host = host.replace(":8000", ":1420")

    service = SecondaryCameraService(db)
    session, token, pairing_url = service.create_or_get_pairing_session(attempt_id, user, host=host)
    assessment = session.attempt.assessment

    return SecondaryCameraCreateResponse(
        session=SecondaryCameraSessionOut.model_validate(session),
        pairing_token=token,
        pairing_url=pairing_url,
        orientation=assessment.secondary_camera_orientation,
        mandatory=assessment.secondary_camera_mandatory,
        grace_period_seconds=assessment.secondary_camera_grace_period_seconds,
    )


@router.post("/pair", response_model=SecondaryCameraPairResponse)
def pair_mobile_device(payload: SecondaryCameraPairRequest, db: DbSession) -> SecondaryCameraPairResponse:
    """Public pairing endpoint: mobile phone browser sends session_id and scanned pairing token."""
    service = SecondaryCameraService(db)
    session, mobile_token = service.pair_device(payload.session_id, payload.token, payload.device_info)
    attempt = session.attempt

    return SecondaryCameraPairResponse(
        session_id=session.id,
        status=session.status.value,
        orientation=session.orientation,
        mobile_token=mobile_token,
        assessment_title=attempt.assessment.title,
        candidate_name=attempt.candidate.name or "Candidate",
    )


@router.post("/heartbeat", response_model=SecondaryCameraSessionOut)
def secondary_camera_heartbeat(
    payload: SecondaryCameraHeartbeatRequest, db: DbSession
) -> SecondaryCameraSessionOut:
    """Mobile phone sends heartbeat with battery level and status."""
    service = SecondaryCameraService(db)
    session = service.heartbeat(
        payload.session_id,
        payload.mobile_token,
        battery_level=payload.battery_level,
        status=payload.status,
    )
    return SecondaryCameraSessionOut.model_validate(session)


@router.get("/{session_id}/status", response_model=SecondaryCameraSessionOut)
def get_session_status(session_id: uuid.UUID, db: DbSession) -> SecondaryCameraSessionOut:
    """Polled by desktop to monitor connection progress."""
    service = SecondaryCameraService(db)
    session = service.get_session(session_id)
    return SecondaryCameraSessionOut.model_validate(session)


@router.get("/{session_id}/ice-servers")
def get_secondary_camera_ice_servers(session_id: uuid.UUID, db: DbSession) -> dict:
    """Returns ICE/TURN servers for establishing the WebRTC peer connection."""
    service = SecondaryCameraService(db)
    _ = service.get_session(session_id)
    settings = get_settings()
    servers, turn = provider.ice_servers(settings)
    return {"ice_servers": servers, "turn_enabled": turn}


# --- In-memory WebSocket room relay for WebRTC signaling ---
# session_id -> { "desktop": ws, "mobile": ws }
_rooms: dict[uuid.UUID, dict[str, WebSocket]] = {}


@router.websocket("/ws/{session_id}")
async def secondary_camera_signaling_ws(
    websocket: WebSocket,
    session_id: uuid.UUID,
    role: Literal["desktop", "mobile"],
    token: str | None = None,
) -> None:
    """WebRTC signaling relay between candidate desktop and mobile phone."""
    await websocket.accept()

    # Validate session and token
    with SessionLocal() as db:
        service = SecondaryCameraService(db)
        try:
            _ = service.get_session(session_id)
            if role == "mobile" and (not token or not service.verify_mobile_token(session_id, token)):
                await websocket.close(code=4003, reason="Unauthorized mobile token")
                return
        except Exception:
            await websocket.close(code=4004, reason="Session not found")
            return

    if session_id not in _rooms:
        _rooms[session_id] = {}

    room = _rooms[session_id]
    room[role] = websocket
    peer_role = "mobile" if role == "desktop" else "desktop"

    # Notify peer if already connected
    if peer_role in room and room[peer_role].client_state == WebSocketState.CONNECTED:
        with contextlib.suppress(Exception):
            await room[peer_role].send_json({"type": "peer_connected", "role": role})
            await websocket.send_json({"type": "peer_connected", "role": peer_role})

    try:
        while True:
            data = await websocket.receive_json()
            # Forward signaling payload directly to the opposite peer
            target_ws = room.get(peer_role)
            if target_ws and target_ws.client_state == WebSocketState.CONNECTED:
                await target_ws.send_json(data)
    except (WebSocketDisconnect, Exception) as exc:
        log.debug("WebSocket disconnected for session %s role %s: %s", session_id, role, exc)
    finally:
        room.pop(role, None)
        if peer_role in room and room[peer_role].client_state == WebSocketState.CONNECTED:
            with contextlib.suppress(Exception):
                await room[peer_role].send_json({"type": "peer_disconnected", "role": role})
        if not room:
            _rooms.pop(session_id, None)
