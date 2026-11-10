"""AI Assistant API — exam creation chatbot (admin only).

All routes are admin-only. The Gemini API key never appears in any response.
Conversation history is persisted in the database, so it survives page reloads.

Routes:
    POST   /api/v1/admin/ai/chat                              Send a message; get a reply
    GET    /api/v1/admin/ai/conversations/active              Get the active conversation
    POST   /api/v1/admin/ai/conversations/new                 Start a fresh conversation
    GET    /api/v1/admin/ai/conversations/{id}                Get a specific conversation
    POST   /api/v1/admin/ai/conversations/{id}/confirm-exam   Confirm and create the exam
"""

import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter

from app.api.deps import AdminUser, AppSettings, DbSession
from app.core.errors import AiAssistantProviderError, AiAssistantUnavailable, BadRequest, NotFound
from app.models.ai_conversation import AiConversation, AiMessage
from app.schemas.ai_assistant import (
    ChatIn,
    ChatMessageOut,
    ChatOut,
    ConfirmExamIn,
    ConfirmExamOut,
    ConversationOut,
)
from app.services.ai_assistant.conversation import ConversationService
from app.services.ai_assistant.exam_creator import create_exam_from_payload
from app.services.ai_assistant.provider import AssistantProviderError, GeminiProvider

log = logging.getLogger("assessx.ai_assistant.api")

router = APIRouter(prefix="/admin/ai", tags=["admin", "ai-assistant"])


class _StubGeminiProvider:
    """Deterministic stub provider for development/testing when no key is set."""

    name = "stub"

    def chat(
        self,
        system_instruction: str,  # noqa: ARG002
        history: list[dict[str, Any]],  # noqa: ARG002
        user_message: str,  # noqa: ARG002
    ) -> str:
        return (
            "Hello! I am the AssessX AI Assistant (stub mode). "
            "To generate real exams, set GEMINI_API_KEY in your server configuration."
        )


def _get_provider(settings: AppSettings) -> Any:
    """Build and return the Gemini provider, or raise 503 if not configured."""
    if settings.gemini_api_key is not None:
        return GeminiProvider(
            api_key=settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_model,
            timeout=settings.llm_timeout_seconds,
        )
    if settings.llm_provider == "stub" and not settings.is_production:
        return _StubGeminiProvider()

    raise AiAssistantUnavailable()


def _conversation_to_out(conv: AiConversation, db: DbSession) -> ConversationOut:
    messages = (
        db.query(AiMessage).filter(AiMessage.conversation_id == conv.id).order_by(AiMessage.created_at).all()
    )
    pending_dict: dict[str, Any] | None = None
    if conv.pending_exam_payload:
        try:
            pending_dict = json.loads(conv.pending_exam_payload)
        except Exception:
            pending_dict = None

    return ConversationOut(
        id=conv.id,
        is_active=conv.is_active,
        created_at=conv.created_at,
        messages=[
            ChatMessageOut(id=m.id, role=m.role, content=m.content, created_at=m.created_at) for m in messages
        ],
        has_pending_exam=conv.pending_exam_payload is not None,
        pending_exam=pending_dict,
        created_assessment_id=conv.created_assessment_id,
    )


@router.post("/chat", response_model=ChatOut)
def chat(
    body: ChatIn,
    admin: AdminUser,
    db: DbSession,
    settings: AppSettings,
) -> ChatOut:
    """Send a message to the AI Assistant and get a reply."""
    provider = _get_provider(settings)
    service = ConversationService(db, provider)

    if body.conversation_id:
        conv = service.get_conversation(body.conversation_id, admin.id)
        if conv is None:
            raise NotFound("Conversation not found.")
    else:
        conv = service.get_or_create_conversation(admin.id)

    try:
        reply, create_payload = service.send_message(conv, body.message)
    except AssistantProviderError as error:
        log.warning("AI provider error for admin %s: %s", admin.id, error)
        raise AiAssistantProviderError(f"The AI service is temporarily unavailable: {error}") from error

    db.commit()

    return ChatOut(
        conversation_id=conv.id,
        reply=reply,
        has_pending_exam=create_payload is not None,
        pending_exam=create_payload,
    )


@router.get("/conversations/active", response_model=ConversationOut | None)
def get_active_conversation(admin: AdminUser, db: DbSession) -> ConversationOut | None:
    """Return the admin's current active conversation, or null if none exists."""
    conv = (
        db.query(AiConversation)
        .filter(
            AiConversation.admin_id == admin.id,
            AiConversation.is_active == True,  # noqa: E712
        )
        .order_by(AiConversation.created_at.desc())
        .first()
    )
    if conv is None:
        return None
    return _conversation_to_out(conv, db)


@router.post("/conversations/new", response_model=ConversationOut, status_code=201)
def new_conversation(admin: AdminUser, db: DbSession, settings: AppSettings) -> ConversationOut:
    """Start a fresh conversation (deactivates the current one)."""
    provider = _get_provider(settings)
    service = ConversationService(db, provider)
    conv = service.new_conversation(admin.id)
    db.commit()
    return _conversation_to_out(conv, db)


@router.get("/conversations/{conversation_id}", response_model=ConversationOut)
def get_conversation(
    conversation_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
) -> ConversationOut:
    """Return a specific conversation by ID (must belong to this admin)."""
    conv = (
        db.query(AiConversation)
        .filter(
            AiConversation.id == conversation_id,
            AiConversation.admin_id == admin.id,
        )
        .first()
    )
    if conv is None:
        raise NotFound("Conversation not found.")
    return _conversation_to_out(conv, db)


@router.post("/conversations/{conversation_id}/confirm-exam", response_model=ConfirmExamOut)
def confirm_exam_creation(
    conversation_id: uuid.UUID,
    body: ConfirmExamIn,
    admin: AdminUser,
    db: DbSession,
    settings: AppSettings,
) -> ConfirmExamOut:
    """Create the exam from the pending AI-generated payload."""
    _get_provider(settings)

    if not body.confirm:
        raise BadRequest("Set confirm=true to proceed with exam creation.")

    conv = (
        db.query(AiConversation)
        .filter(
            AiConversation.id == conversation_id,
            AiConversation.admin_id == admin.id,
        )
        .first()
    )
    if conv is None:
        raise NotFound("Conversation not found.")

    if conv.pending_exam_payload is None:
        raise BadRequest("No pending exam to create. Ask the assistant to generate an exam first.")

    if conv.created_assessment_id is not None:
        raise BadRequest("An exam has already been created from this proposal.")

    try:
        payload = json.loads(conv.pending_exam_payload)
    except (ValueError, TypeError) as error:
        raise BadRequest("Stored exam payload is corrupted.") from error

    assessment_id = create_exam_from_payload(payload, admin, db)
    conv.created_assessment_id = uuid.UUID(assessment_id)
    conv.pending_exam_payload = None
    db.commit()

    log.info("Admin %s confirmed AI exam creation: assessment %s", admin.id, assessment_id)

    return ConfirmExamOut(
        assessment_id=uuid.UUID(assessment_id),
        message="Exam created successfully as a DRAFT. You can now review and publish it.",
    )
