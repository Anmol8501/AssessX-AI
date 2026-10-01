"""Phase 7D — live interview call shapes. Two audiences: the administrator (everything, including the
interviewer's private notes) and the candidate (the call and its chat — never the notes). Requests are
strict: only the text a person types is accepted."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.models.interview_call import InterviewCall, InterviewCallMessage, InterviewCallNote
from app.models.user import UserRole
from app.schemas.review import Person
from app.services.interview.calls import duration


class NoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ChatMessageOut(BaseModel):
    message_id: uuid.UUID
    sender: Person
    sender_role: Literal["INTERVIEWER", "CANDIDATE"]
    body: str
    sent_at: datetime

    @classmethod
    def of(cls, m: InterviewCallMessage) -> "ChatMessageOut":
        return cls(
            message_id=m.id,
            sender=Person(id=m.sender.id, name=m.sender.name),
            sender_role="INTERVIEWER" if m.sender.role is UserRole.ADMIN else "CANDIDATE",
            body=m.body,
            sent_at=m.sent_at,
        )


class CallNoteOut(BaseModel):
    note_id: uuid.UUID
    author: Person
    body: str
    created_at: datetime
    authored_by: Literal["HUMAN"] = "HUMAN"


class CallSummary(BaseModel):
    call_id: uuid.UUID
    interview_id: uuid.UUID
    candidate_id: uuid.UUID
    status: Literal["OPEN", "ENDED"]
    opened_by: Person
    opened_at: datetime
    candidate_joined_at: datetime | None
    ended_at: datetime | None
    ended_by: Person | None
    duration_seconds: int

    @classmethod
    def of(cls, c: InterviewCall) -> "CallSummary":
        return cls(
            call_id=c.id,
            interview_id=c.interview_id,
            candidate_id=c.candidate_id,
            status=c.status.value,
            opened_by=Person(id=c.opened_by.id, name=c.opened_by.name),
            opened_at=c.opened_at,
            candidate_joined_at=c.candidate_joined_at,
            ended_at=c.ended_at,
            ended_by=Person(id=c.ended_by.id, name=c.ended_by.name) if c.ended_by else None,
            duration_seconds=duration(c),
        )


class AdminCallOut(CallSummary):
    interview_title: str
    planned_minutes: int
    candidate_name: str
    candidate_roll_number: str | None
    messages: list[ChatMessageOut]
    notes: list[CallNoteOut]

    @classmethod
    def build(
        cls, c: InterviewCall, messages: list[InterviewCallMessage], notes: list[InterviewCallNote]
    ) -> "AdminCallOut":
        return cls(
            **CallSummary.of(c).model_dump(),
            interview_title=c.interview.title,
            planned_minutes=c.interview.duration_minutes,
            candidate_name=c.candidate.name,
            candidate_roll_number=c.candidate.roll_number,
            messages=[ChatMessageOut.of(m) for m in messages],
            notes=[
                CallNoteOut(
                    note_id=n.id,
                    author=Person(id=n.author.id, name=n.author.name),
                    body=n.body,
                    created_at=n.created_at,
                )
                for n in notes
            ],
        )


class CandidateCallOut(BaseModel):
    """What the candidate sees: the call and its chat. Never the interviewer's notes."""

    call_id: uuid.UUID
    interview_id: uuid.UUID
    interview_title: str
    interviewer_name: str
    status: Literal["OPEN", "ENDED"]
    opened_at: datetime
    ended_at: datetime | None
    planned_minutes: int
    messages: list[ChatMessageOut]

    @classmethod
    def build(cls, c: InterviewCall, messages: list[InterviewCallMessage]) -> "CandidateCallOut":
        return cls(
            call_id=c.id,
            interview_id=c.interview_id,
            interview_title=c.interview.title,
            interviewer_name=c.opened_by.name,
            status=c.status.value,
            opened_at=c.opened_at,
            ended_at=c.ended_at,
            planned_minutes=c.interview.duration_minutes,
            messages=[ChatMessageOut.of(m) for m in messages],
        )
