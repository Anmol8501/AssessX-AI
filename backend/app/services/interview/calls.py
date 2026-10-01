"""Phase 7D — CallService: live video interview calls (one interviewer, one candidate).

The server keeps the facts of a call and authorises everything; the media itself is peer-to-peer and
never stored. An administrator opens a call for a candidate assigned to a published LIVE interview (at
most one OPEN call per assignment — opening again returns it); the assigned candidate joins; either side
chats; the interviewer writes private notes; the interviewer ends it. Every lookup is scoped: a candidate
only ever reaches calls of their own assignments, and a call only through its own interview.
"""

import logging
import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import CallEnded, Conflict, NotFound
from app.models.audit_log import AuditAction
from app.models.base import utcnow
from app.models.interview import InterviewFormat, InterviewStatus
from app.models.interview_call import CallStatus, InterviewCall, InterviewCallMessage, InterviewCallNote
from app.models.user import User, UserRole
from app.repositories.audit import AuditRepository
from app.repositories.interviews import InterviewRepository

log = logging.getLogger("assessx.interviews.calls")

MAX_MESSAGE = 2000
MAX_NOTE = 4000


class CallService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = InterviewRepository(db)
        self.audit = AuditRepository(db)

    def _record(self, actor: User, action: AuditAction, call: InterviewCall, **details: object) -> None:
        self.audit.record(
            actor_id=actor.id,
            action=action,
            interview_id=call.interview_id,
            details={"call_id": str(call.id), **{k: v for k, v in details.items() if v is not None}},
        )
        log.info("Interview call action", extra={"action": action.value, "call_id": str(call.id)})

    # -- lookups -------------------------------------------------------------------------------------

    def for_admin(self, interview_id: uuid.UUID, call_id: uuid.UUID) -> InterviewCall:
        call = self.db.scalar(
            select(InterviewCall).where(
                InterviewCall.id == call_id, InterviewCall.interview_id == interview_id
            )
        )
        if call is None:
            raise NotFound("Call not found.")
        return call

    def for_candidate(self, call_id: uuid.UUID, candidate: User) -> InterviewCall:
        """Only a call of this candidate's own assignment; anything else is not found."""
        call = self.db.scalar(
            select(InterviewCall).where(
                InterviewCall.id == call_id, InterviewCall.candidate_id == candidate.id
            )
        )
        if call is None:
            raise NotFound("Call not found.")
        return call

    def participant(self, call_id: uuid.UUID, user: User) -> tuple[InterviewCall, str] | None:
        """For the signaling socket: the OPEN call and the side this user may take, or None.

        The candidate side is only ever the call's own candidate; the interviewer side is an administrator.
        """
        call = self.db.get(InterviewCall, call_id)
        if call is None or not call.is_open:
            return None
        if user.role is UserRole.CANDIDATE and call.candidate_id == user.id:
            return call, "candidate"
        if user.role is UserRole.ADMIN and user.is_active:
            return call, "interviewer"
        return None

    def messages(self, call: InterviewCall) -> list[InterviewCallMessage]:
        return list(
            self.db.scalars(
                select(InterviewCallMessage)
                .where(InterviewCallMessage.call_id == call.id)
                .order_by(InterviewCallMessage.sent_at, InterviewCallMessage.id)
            )
        )

    def notes(self, call: InterviewCall) -> list[InterviewCallNote]:
        return list(
            self.db.scalars(
                select(InterviewCallNote)
                .where(InterviewCallNote.call_id == call.id)
                .order_by(InterviewCallNote.created_at, InterviewCallNote.id)
            )
        )

    def open_calls(self, assignment_ids: list[uuid.UUID]) -> dict[uuid.UUID, uuid.UUID]:
        """`{assignment: its OPEN call}` in one query."""
        if not assignment_ids:
            return {}
        rows = self.db.execute(
            select(InterviewCall.assignment_id, InterviewCall.id).where(
                InterviewCall.assignment_id.in_(assignment_ids), InterviewCall.status == CallStatus.OPEN
            )
        )
        return {a: c for a, c in rows.all()}

    def history(self, interview_id: uuid.UUID, candidate_id: uuid.UUID | None = None) -> list[InterviewCall]:
        query = select(InterviewCall).where(InterviewCall.interview_id == interview_id)
        if candidate_id is not None:
            query = query.where(InterviewCall.candidate_id == candidate_id)
        return list(self.db.scalars(query.order_by(InterviewCall.opened_at.desc()).limit(100)))

    # -- writes --------------------------------------------------------------------------------------

    def open(
        self, interview_id: uuid.UUID, candidate_id: uuid.UUID, admin: User
    ) -> tuple[InterviewCall, bool]:
        """Opens the call (or returns the one already open). Only for a published LIVE interview the
        candidate is assigned to."""
        interview = self.repo.get(interview_id)
        if interview is None:
            raise NotFound("Interview not found.")
        if interview.format is not InterviewFormat.LIVE:
            raise Conflict("Only a live interview has calls.")
        if interview.status is not InterviewStatus.PUBLISHED:
            raise Conflict("Publish the interview before opening a call.")
        assignment = self.repo.assignment(interview.id, candidate_id)
        if assignment is None:
            raise NotFound("That candidate is not assigned to this interview.")
        existing = self.open_calls([assignment.id]).get(assignment.id)
        if existing is not None:
            return self.for_admin(interview.id, existing), False
        call = InterviewCall(
            interview_id=interview.id,
            assignment_id=assignment.id,
            candidate_id=candidate_id,
            status=CallStatus.OPEN,
            opened_by=admin,
            opened_at=utcnow(),
        )
        try:
            # Two administrators opening at once race on the one-open-call index; the loser returns
            # the winner's call.
            with self.db.begin_nested():
                self.db.add(call)
                self.db.flush()
        except IntegrityError:
            existing = self.open_calls([assignment.id]).get(assignment.id)
            if existing is None:
                raise
            return self.for_admin(interview.id, existing), False
        self._record(admin, AuditAction.INTERVIEW_CALL_OPENED, call, candidate_id=str(candidate_id))
        return call, True

    def join(self, call_id: uuid.UUID, candidate: User) -> InterviewCall:
        call = self.for_candidate(call_id, candidate)
        if not call.is_open:
            raise CallEnded()
        if call.candidate_joined_at is None:
            call.candidate_joined_at = utcnow()
            self.db.flush()
            self._record(candidate, AuditAction.INTERVIEW_CALL_JOINED, call)
        return call

    def end(self, interview_id: uuid.UUID, call_id: uuid.UUID, admin: User) -> InterviewCall:
        """Ends the call (idempotent). The interviewer ends a call; a candidate simply leaves it."""
        call = self.db.scalar(
            select(InterviewCall)
            .where(InterviewCall.id == call_id, InterviewCall.interview_id == interview_id)
            .with_for_update(of=InterviewCall)
            .execution_options(populate_existing=True)
        )
        if call is None:
            raise NotFound("Call not found.")
        if call.is_open:
            call.status = CallStatus.ENDED
            call.ended_at = utcnow()
            call.ended_by = admin
            self.db.flush()
            self._record(
                admin,
                AuditAction.INTERVIEW_CALL_ENDED,
                call,
                duration_seconds=duration(call),
                messages=len(self.messages(call)),
            )
        return call

    def add_note(
        self, interview_id: uuid.UUID, call_id: uuid.UUID, admin: User, body: str
    ) -> InterviewCallNote:
        call = self.for_admin(interview_id, call_id)
        note = InterviewCallNote(call_id=call.id, author=admin, body=body, created_at=utcnow())
        self.db.add(note)
        self.db.flush()
        # Only that a note exists and its length — never its text.
        self._record(
            admin, AuditAction.INTERVIEW_CALL_NOTE_ADDED, call, note_id=str(note.id), length=len(body)
        )
        return note

    def add_message(self, call: InterviewCall, sender: User, body: str) -> InterviewCallMessage | None:
        """A chat message from a validated participant of an OPEN call. Not audited one by one (the call
        record holds them); empty or oversized text is dropped."""
        text_ = body.strip()
        if not call.is_open or not text_ or len(text_) > MAX_MESSAGE:
            return None
        message = InterviewCallMessage(call_id=call.id, sender=sender, body=text_, sent_at=utcnow())
        self.db.add(message)
        self.db.flush()
        return message


def duration(call: InterviewCall, now: datetime | None = None) -> int:
    end = call.ended_at or now or utcnow()
    return max(0, int((end - call.opened_at).total_seconds()))
