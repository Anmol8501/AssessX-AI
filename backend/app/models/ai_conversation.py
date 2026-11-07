"""AI Assistant conversation models.

An AiConversation belongs to one admin and holds a sequence of AiMessages (alternating
user and assistant turns). The conversation persists across page reloads. When the assistant
signals a CREATE_EXAM action, the JSON payload is stored in `pending_exam_payload` until
the admin confirms and the exam is created.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow


class MessageRole(enum.StrEnum):
    USER = "USER"
    ASSISTANT = "ASSISTANT"


class AiConversation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A single conversation session between one admin and the AI Assistant."""

    __tablename__ = "ai_conversations"
    __table_args__ = (Index("ix_ai_conversations_admin_active", "admin_id", "is_active"),)

    admin_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Whether this is the admin's current active conversation (soft-close by starting a new one).
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    #: JSON payload from the last CREATE_EXAM signal, waiting for admin confirmation.
    pending_exam_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: The assessment ID created from this conversation (once confirmed).
    created_assessment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)

    messages: Mapped[list["AiMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="AiMessage.created_at",
        passive_deletes=True,
    )

    def __repr__(self) -> str:
        return f"<AiConversation admin={self.admin_id} active={self.is_active}>"


class AiMessage(UUIDPrimaryKeyMixin, Base):
    """One turn in an AI conversation (user or assistant)."""

    __tablename__ = "ai_messages"

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("ai_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    conversation: Mapped[AiConversation] = relationship(back_populates="messages")

    def __repr__(self) -> str:
        return f"<AiMessage {self.role} {self.content[:30]!r}>"
