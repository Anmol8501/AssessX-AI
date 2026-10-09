"""Exam control for administrators: put a running exam on hold (freeze it), release it, or end it.

Admin-only (`AdminUser`): a candidate gets 403 and an anonymous request 401. Any administrator may
control any attempt, the same scope as live monitoring in this single-tenant build. Each change is
audited (`ATTEMPT_HELD`, `ATTEMPT_RELEASED`, `ATTEMPT_ENDED_BY_ADMIN`) and pushed live to the
candidate's app and the monitoring wall. The optional note is visible to administrators only.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.api.deps import AdminUser, DbSession
from app.models.attempt import AssessmentAttempt, AttemptStatus
from app.models.attempt_message import MAX_MESSAGE_LENGTH
from app.models.user import User
from app.schemas.attempt import AttemptControl
from app.schemas.review import Person
from app.services.attempt_control import AttemptControlService

router = APIRouter(prefix="/admin/attempts", tags=["admin exam control"])


class HoldRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Why, for other administrators. Never shown to the candidate, never logged (only its length).
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None


class MessageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_MESSAGE_LENGTH)
    ]


class SentMessage(BaseModel):
    """A message as the proctor sees it: who sent it and whether the candidate has read it."""

    id: uuid.UUID
    body: str
    sent_at: datetime
    sent_by: Person | None
    acknowledged_at: datetime | None


class AdminAttemptControl(AttemptControl):
    attempt_id: uuid.UUID
    status: AttemptStatus
    held_by: Person | None
    hold_note: str | None
    ended_by: Person | None
    #: Every message sent during this attempt, oldest first.
    sent_messages: list[SentMessage] = []


def _person(db: DbSession, user_id: uuid.UUID | None) -> Person | None:
    user = db.get(User, user_id) if user_id else None
    return Person(id=user.id, name=user.name) if user else None


def _out(db: DbSession, attempt: AssessmentAttempt) -> AdminAttemptControl:
    return AdminAttemptControl(
        **AttemptControl.of(attempt).model_dump(),
        attempt_id=attempt.id,
        status=attempt.status,
        held_by=_person(db, attempt.held_by_id) if attempt.is_on_hold else None,
        hold_note=attempt.hold_note if attempt.is_on_hold else None,
        ended_by=_person(db, attempt.ended_by_id),
        sent_messages=[
            SentMessage(
                id=m.id,
                body=m.body,
                sent_at=m.sent_at,
                sent_by=Person(id=m.sender.id, name=m.sender.name) if m.sender else None,
                acknowledged_at=m.acknowledged_at,
            )
            for m in attempt.messages
        ],
    )


@router.get("/{attempt_id}/control", response_model=AdminAttemptControl)
def attempt_control(attempt_id: uuid.UUID, _: AdminUser, db: DbSession) -> AdminAttemptControl:
    return _out(db, AttemptControlService(db).for_admin(attempt_id))


@router.post("/{attempt_id}/hold", response_model=AdminAttemptControl)
def hold_attempt(
    attempt_id: uuid.UUID, payload: HoldRequest, admin: AdminUser, db: DbSession
) -> AdminAttemptControl:
    """Freezes the exam: the candidate cannot answer or submit until released. The clock keeps
    running. Holding an attempt already on hold changes nothing."""
    return _out(db, AttemptControlService(db).hold(attempt_id, admin, payload.note or None))


@router.post("/{attempt_id}/release", response_model=AdminAttemptControl)
def release_attempt(attempt_id: uuid.UUID, admin: AdminUser, db: DbSession) -> AdminAttemptControl:
    """Lets the candidate continue with the time that is left. The tab-switch count is kept."""
    return _out(db, AttemptControlService(db).release(attempt_id, admin))


@router.post("/{attempt_id}/messages", response_model=AdminAttemptControl)
def send_message(
    attempt_id: uuid.UUID, payload: MessageRequest, admin: AdminUser, db: DbSession
) -> AdminAttemptControl:
    """Shows the candidate a short message on their exam screen (for example a warning about something
    seen on camera) until they acknowledge it. Only while the exam is running."""
    return _out(db, AttemptControlService(db).send_message(attempt_id, admin, payload.body))


@router.post("/{attempt_id}/end", response_model=AdminAttemptControl)
def end_attempt(attempt_id: uuid.UUID, admin: AdminUser, db: DbSession) -> AdminAttemptControl:
    """Ends the exam for the candidate: the answers saved so far are submitted and graded."""
    return _out(db, AttemptControlService(db).end(attempt_id, admin))
