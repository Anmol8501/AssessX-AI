"""Schemas for Phase 3B: Examination Session Continuity, Answer Persistence & Recovery.

Defines wire formats for:
- Batch answer synchronization with monotonic revisions and idempotency keys
- Real-time periodic heartbeat telemetry and session dropout detection
- Crash recovery and resumption handshake
- Proctor/admin live continuity monitoring
"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AnswerSyncItem(BaseModel):
    """One question's answer payload sent by the desktop client.

    Contains candidate option selections accompanied by monotonic revision sequence and
    idempotency token for deterministic deduplication and out-of-order rejection.
    """

    model_config = ConfigDict(extra="forbid")

    question_id: uuid.UUID
    selected_option_ids: list[uuid.UUID]
    client_revision: int = Field(..., ge=1, description="Strictly monotonic revision counter.")
    idempotency_key: str = Field(..., min_length=8, max_length=64, description="UUID per answer change.")
    client_timestamp: datetime = Field(..., description="Timestamp when selection was modified.")


class AnswerSyncBatchRequest(BaseModel):
    """Batch of dirty or unconfirmed answer changes enqueued on the client."""

    model_config = ConfigDict(extra="forbid")

    attempt_id: uuid.UUID
    answers: list[AnswerSyncItem] = Field(..., min_length=1, max_length=100)


class AnswerSyncItemResult(BaseModel):
    """Per-question sync confirmation returned to the client."""

    model_config = ConfigDict(from_attributes=True)

    question_id: uuid.UUID
    status: Literal["synced", "ignored_older_revision", "conflict"]
    server_revision: int
    synced_at: datetime
    message: str | None = None


class AnswerSyncBatchResponse(BaseModel):
    """Confirmation of processed batch answers with authoritative server timestamps."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    results: list[AnswerSyncItemResult]
    server_timestamp: datetime


class SessionHeartbeatRequest(BaseModel):
    """Periodic health beacon emitted by the desktop client during active exam sessions."""

    model_config = ConfigDict(extra="forbid")

    attempt_id: uuid.UUID
    device_id: str = Field(..., max_length=128)
    client_timestamp: datetime
    network_quality: str = Field(default="GOOD", max_length=32)
    pending_sync_count: int = Field(default=0, ge=0)
    last_synced_revision: int = Field(default=0, ge=0)


class SessionHeartbeatResponse(BaseModel):
    """Server response confirming exam clock, attempt status, and required control actions."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    status: str
    server_timestamp: datetime
    remaining_seconds: int
    action_required: Literal["NONE", "REFRESH_SESSION", "TERMINATE"] = "NONE"


class SessionRecoveryRequest(BaseModel):
    """Handshake request initiated by desktop application upon restart or network recovery."""

    model_config = ConfigDict(extra="forbid")

    attempt_id: uuid.UUID
    device_id: str = Field(..., max_length=128)
    crash_recovery_token: str | None = Field(default=None, max_length=256)
    last_known_revision: int = Field(default=0, ge=0)


class SessionRecoveryAnswerItem(BaseModel):
    """Snapshot of an answer currently stored on the server."""

    question_id: uuid.UUID
    selected_option_ids: list[uuid.UUID]
    server_revision: int
    updated_at: datetime


class SessionRecoveryResponse(BaseModel):
    """Authoritative server state returned to restore candidate exam state."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    status: str
    resumable: bool
    remaining_seconds: int
    server_answers: list[SessionRecoveryAnswerItem]
    server_revision: int
    recovery_token: str
    server_timestamp: datetime


class AttemptContinuitySummary(BaseModel):
    """Factual telemetry summary exposed to proctors and administrators."""

    model_config = ConfigDict(from_attributes=True)

    attempt_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str
    status: str
    last_heartbeat_at: datetime | None
    seconds_since_heartbeat: int | None
    is_dropped_out: bool
    device_id: str | None
    network_quality: str | None
    pending_sync_count: int
    last_synced_revision: int
    total_answers_synced: int
