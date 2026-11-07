"""Conversation state management for the AI Assistant.

Each conversation is a persistent sequence of messages between an admin and the AI.
The conversation stores enough history to send to Gemini on each turn, and tracks
whether an exam creation has been signalled and processed.
"""

import json
import logging
import re
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models.ai_conversation import AiConversation, AiMessage, MessageRole
from app.services.ai_assistant.prompts import EXAM_CREATION_SYSTEM_PROMPT
from app.services.ai_assistant.provider import AssistantProviderError, GeminiProvider

log = logging.getLogger("assessx.ai_assistant.conversation")

# Pattern to find the CREATE_EXAM JSON block in the assistant's reply
_CREATE_EXAM_PATTERN = re.compile(
    r"```json\s*(\{[^`]*\"action\"\s*:\s*\"CREATE_EXAM\"[^`]*\})\s*```",
    re.DOTALL,
)


def _extract_create_exam_payload(text: str) -> dict[str, Any] | None:
    """Extract and parse the CREATE_EXAM JSON block from the assistant reply, if present."""
    match = _CREATE_EXAM_PATTERN.search(text)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
        if isinstance(data, dict) and data.get("action") == "CREATE_EXAM":
            return data
    except (ValueError, KeyError):
        pass
    return None


class ConversationService:
    """Manages AI Assistant conversations for one admin user."""

    def __init__(self, db: Session, provider: GeminiProvider) -> None:
        self._db = db
        self._provider = provider

    def get_or_create_conversation(self, admin_id: uuid.UUID) -> AiConversation:
        """Return the admin's most recent active conversation, or start a new one."""
        conv = (
            self._db.query(AiConversation)
            .filter(
                AiConversation.admin_id == admin_id,
                AiConversation.is_active == True,  # noqa: E712
            )
            .order_by(AiConversation.created_at.desc())
            .first()
        )
        if conv is None:
            conv = AiConversation(admin_id=admin_id)
            self._db.add(conv)
            self._db.flush()
        return conv

    def get_conversation(self, conversation_id: uuid.UUID, admin_id: uuid.UUID) -> AiConversation | None:
        """Return a specific conversation belonging to this admin."""
        return (
            self._db.query(AiConversation)
            .filter(
                AiConversation.id == conversation_id,
                AiConversation.admin_id == admin_id,
            )
            .first()
        )

    def send_message(
        self,
        conversation: AiConversation,
        user_text: str,
    ) -> tuple[str, dict[str, Any] | None]:
        """Send a user message, get the assistant reply, persist both, and return
        (reply_text, create_exam_payload_or_None).
        """
        # Build history for Gemini from stored messages
        history = self._build_history(conversation)

        # Persist user message first
        user_msg = AiMessage(
            conversation_id=conversation.id,
            role=MessageRole.USER.value,
            content=user_text,
        )
        self._db.add(user_msg)
        self._db.flush()

        # Call provider
        try:
            reply_text = self._provider.chat(
                system_instruction=EXAM_CREATION_SYSTEM_PROMPT,
                history=history,
                user_message=user_text,
            )
        except AssistantProviderError as error:
            log.warning("AI provider error in conversation %s: %s", conversation.id, error)
            raise

        # Persist assistant reply
        assistant_msg = AiMessage(
            conversation_id=conversation.id,
            role=MessageRole.ASSISTANT.value,
            content=reply_text,
        )
        self._db.add(assistant_msg)

        # Check for CREATE_EXAM signal
        create_payload = _extract_create_exam_payload(reply_text)
        if create_payload:
            conversation.pending_exam_payload = json.dumps(create_payload)

        self._db.flush()
        return reply_text, create_payload

    def new_conversation(self, admin_id: uuid.UUID) -> AiConversation:
        """Start a fresh conversation (deactivates any existing active ones for this admin)."""
        self._db.query(AiConversation).filter(
            AiConversation.admin_id == admin_id,
            AiConversation.is_active == True,  # noqa: E712
        ).update({"is_active": False})
        conv = AiConversation(admin_id=admin_id)
        self._db.add(conv)
        self._db.flush()
        return conv

    def _build_history(self, conversation: AiConversation) -> list[dict[str, Any]]:
        """Convert stored messages to Gemini-format history (alternating user/model turns)."""
        messages = (
            self._db.query(AiMessage)
            .filter(AiMessage.conversation_id == conversation.id)
            .order_by(AiMessage.created_at)
            .all()
        )
        history: list[dict[str, Any]] = []
        for msg in messages:
            role = "user" if msg.role == MessageRole.USER.value else "model"
            history.append({"role": role, "parts": [{"text": msg.content}]})
        return history
