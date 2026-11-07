"""Pydantic schemas for the AI Assistant API endpoints."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class ChatMessageOut(BaseModel):
    """A single message in the conversation history."""

    id: uuid.UUID
    role: str  # "USER" or "ASSISTANT"
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationOut(BaseModel):
    """Full conversation with message history."""

    id: uuid.UUID
    is_active: bool
    created_at: datetime
    messages: list[ChatMessageOut] = []
    has_pending_exam: bool = False
    pending_exam: dict[str, Any] | None = None
    created_assessment_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


class ChatIn(BaseModel):
    """Body for POST /api/v1/admin/ai/chat."""

    message: str = Field(min_length=1, max_length=10_000)
    conversation_id: uuid.UUID | None = None


class ChatOut(BaseModel):
    """Response from POST /api/v1/admin/ai/chat."""

    conversation_id: uuid.UUID
    reply: str
    has_pending_exam: bool
    pending_exam: dict[str, Any] | None = None


class ConfirmExamIn(BaseModel):
    """Body for POST /api/v1/admin/ai/conversations/{id}/confirm-exam."""

    confirm: bool = True


class ConfirmExamOut(BaseModel):
    """Response after successfully creating the exam."""

    assessment_id: uuid.UUID
    message: str
