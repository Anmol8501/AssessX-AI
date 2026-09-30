"""WebRTC configuration for live monitoring video (see `app/services/ice.py`)."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import AppSettings, CurrentUser
from app.services.ice import provider

router = APIRouter(prefix="/realtime", tags=["realtime"])


class IceServer(BaseModel):
    urls: list[str]
    username: str | None = None
    credential: str | None = None


class IceServersResponse(BaseModel):
    ice_servers: list[IceServer]
    #: Whether a TURN relay is included (video can then connect across restrictive networks).
    turn_enabled: bool


@router.get("/ice-servers", response_model=IceServersResponse, response_model_exclude_none=True)
def ice_servers(user: CurrentUser, settings: AppSettings) -> IceServersResponse:
    """ICE servers for a signed-in admin or candidate. TURN credentials are short-lived."""
    servers, turn = provider.ice_servers(settings)
    return IceServersResponse(ice_servers=[IceServer(**s) for s in servers], turn_enabled=turn)
