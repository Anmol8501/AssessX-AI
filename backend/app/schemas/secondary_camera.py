import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SecondaryCameraSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    attempt_id: uuid.UUID
    status: str
    orientation: str
    expires_at: datetime
    paired_at: datetime | None = None
    streaming_started_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    device_info: str | None = None
    battery_level: int | None = None


class SecondaryCameraPairRequest(BaseModel):
    session_id: uuid.UUID
    token: str
    device_info: str | None = None


class SecondaryCameraPairResponse(BaseModel):
    session_id: uuid.UUID
    status: str
    orientation: str
    mobile_token: str
    assessment_title: str
    candidate_name: str


class SecondaryCameraHeartbeatRequest(BaseModel):
    session_id: uuid.UUID
    mobile_token: str
    battery_level: int | None = Field(default=None, ge=0, le=100)
    status: str | None = None


class SecondaryCameraCreateResponse(BaseModel):
    session: SecondaryCameraSessionOut
    pairing_token: str
    pairing_url: str
    orientation: str
    mandatory: bool
    grace_period_seconds: int
