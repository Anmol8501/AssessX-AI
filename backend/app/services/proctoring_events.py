"""The proctoring event taxonomy and the one place events are written (Phase 4B).

    client observes ──► POST .../proctoring/events ──► validate ──► record (server time)
    server lifecycle (session start/end, device changes) ────────────► record (server time)

Rules:

* **Observations, not verdicts.** An event says what happened ("paste attempted", "focus lost").
  There is no severity, score or "suspicious" flag on the way in; the client cannot send one
  (the request shape forbids unknown fields) and the server does not invent one. Correlation and
  risk are a later phase and read this table.
* **The server decides what an event is.** The category and the source are derived here from the
  event type and the route — never taken from the request. Session and device events can only be
  recorded by the server; a client cannot report `SESSION_ENDED` or `CAMERA_DISCONNECTED`.
* **Minimal, typed detail.** Each type accepts a short allow-list of fields with fixed types and
  vocabularies (`_FIELDS`, `_TYPE_FIELDS`). Anything else is refused, so clipboard text, typed
  answers, window titles or process names cannot be stored even by a modified client.
* **Retries and repeats do not multiply rows.** A retried request reuses its `client_event_id`
  (unique per session) and gets the original back. An identical event within
  `DEDUPE_WINDOW` of the previous one of its type is folded into it. A session holds at most
  `MAX_EVENTS_PER_SESSION` events.
"""

import logging
import re
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import EventLimitReached, ValidationFailed
from app.models.attempt import AttemptStatus
from app.models.base import utcnow
from app.models.proctoring import DeviceState, ProctoringSession
from app.models.proctoring_event import (
    ProctoringEvent,
    ProctoringEventCategory,
    ProctoringEventSource,
    ProctoringEventType,
)

log = logging.getLogger("assessx.proctoring.events")

E = ProctoringEventType
C = ProctoringEventCategory

#: An identical event (same type, same details) this soon after the previous one is not recorded
#: again — holding a key down, or a burst of the same attempt, is one observation.
DEDUPE_WINDOW = timedelta(seconds=1)
#: A hard ceiling per session, so a misbehaving or hostile client cannot fill the table.
MAX_EVENTS_PER_SESSION = 5000
#: How far a client's own timestamp may sit from the server's before it is ignored as implausible.
CLIENT_CLOCK_TOLERANCE = timedelta(minutes=5)

CATEGORY: dict[ProctoringEventType, ProctoringEventCategory] = {
    E.SESSION_STARTED: C.SESSION,
    E.SESSION_RESUMED: C.SESSION,
    E.SESSION_ENDED: C.SESSION,
    E.CAMERA_DISCONNECTED: C.DEVICE,
    E.CAMERA_RECONNECTED: C.DEVICE,
    E.MIC_DISCONNECTED: C.DEVICE,
    E.MIC_RECONNECTED: C.DEVICE,
    E.FULLSCREEN_ENTER: C.WINDOW,
    E.FULLSCREEN_EXIT: C.WINDOW,
    E.FULLSCREEN_RESTORED: C.WINDOW,
    E.FOCUS_LOST: C.WINDOW,
    E.FOCUS_REGAINED: C.WINDOW,
    E.COPY_ATTEMPT: C.INPUT,
    E.CUT_ATTEMPT: C.INPUT,
    E.PASTE_ATTEMPT: C.INPUT,
    E.CLIPBOARD_ACCESS_ATTEMPT: C.INPUT,
    E.CONTEXT_MENU_ATTEMPT: C.INPUT,
    E.PRINT_ATTEMPT: C.INPUT,
    E.DEVTOOLS_ATTEMPT: C.INPUT,
    E.KEYBOARD_RESTRICTION_ATTEMPT: C.INPUT,
    E.SCREEN_CAPTURE_ATTEMPT: C.INPUT,
    E.MULTIPLE_MONITORS_DETECTED: C.DISPLAY,
    E.DISPLAY_CONFIGURATION_CHANGED: C.DISPLAY,
    E.REMOTE_SESSION_DETECTED: C.SYSTEM,
    E.ENFORCEMENT_STATUS: C.SYSTEM,
    E.DEVICE_CHECK_STARTED: C.SYSTEM,
    E.PROHIBITED_APP_DETECTED: C.SYSTEM,
    E.APP_CLOSE_REQUESTED: C.SYSTEM,
    E.APP_CLOSED: C.SYSTEM,
    E.APP_CLOSE_FAILED: C.SYSTEM,
    E.DEVICE_CHECK_PASSED: C.SYSTEM,
    E.DEVICE_CHECK_FAILED: C.SYSTEM,
}

#: Recorded by the server only. The session lifecycle is the server's, and device changes arrive
#: through the Phase 4A device report — which the server turns into these events itself.
SERVER_ONLY = frozenset(
    {
        E.SESSION_STARTED,
        E.SESSION_RESUMED,
        E.SESSION_ENDED,
        E.CAMERA_DISCONNECTED,
        E.CAMERA_RECONNECTED,
        E.MIC_DISCONNECTED,
        E.MIC_RECONNECTED,
    }
)


# -- metadata vocabulary ---------------------------------------------------------------------

_APP_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,39}$")
_SHORTCUT = re.compile(r"^[A-Z0-9]{1,12}(\+[A-Z0-9]{1,12}){0,4}$")
_CAPABILITIES = frozenset(
    {
        "fullscreen",
        "focus_monitor",
        "keyboard_guard",
        "system_shortcut_guard",
        "clipboard_guard",
        "context_menu_guard",
        "print_guard",
        "capture_protection",
        "always_on_top",
        "display_monitor",
    }
)
_CAPABILITY_STATUS = frozenset({"ACTIVE", "BEST_EFFORT", "UNAVAILABLE"})


def _one_of(*allowed: str) -> Callable[[Any], bool]:
    values = frozenset(allowed)
    return lambda v: isinstance(v, str) and v in values


def _int_between(low: int, high: int) -> Callable[[Any], bool]:
    return lambda v: isinstance(v, int) and not isinstance(v, bool) and low <= v <= high


def _capabilities(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and 0 < len(value) <= len(_CAPABILITIES)
        and all(k in _CAPABILITIES and v in _CAPABILITY_STATUS for k, v in value.items())
    )


_WINDOW_STATE = ("fullscreen", "windowed", "minimized")

#: Every field any event may carry, with the check its value must pass.
_FIELDS: dict[str, Callable[[Any], bool]] = {
    "shortcut": lambda v: isinstance(v, str) and len(v) <= 64 and bool(_SHORTCUT.match(v)),
    "blocked": lambda v: isinstance(v, bool),
    "channel": _one_of("keyboard", "pointer", "clipboard-event", "print-event", "native-hook"),
    "duration_ms": _int_between(0, 24 * 60 * 60 * 1000),
    "previous_state": _one_of(*_WINDOW_STATE),
    "current_state": _one_of(*_WINDOW_STATE),
    "reason": _one_of(
        "minimized", "deactivated", "resized", "user", "focus-regained", "exam-start", "unknown"
    ),
    "display_count": _int_between(0, 32),
    "previous_display_count": _int_between(0, 32),
    "capabilities": _capabilities,
    "environment": _one_of("desktop", "browser"),
    "security_mode": _one_of("STANDARD", "SECURE_KIOSK", "UNKNOWN"),
    # device readiness: a policy identifier (never a path, window title or command line)
    "app": lambda v: isinstance(v, str) and bool(_APP_ID.match(v)),
    "app_category": _one_of(
        "browser",
        "communication",
        "remote-control",
        "screen-recording",
        "ai-assistant",
        "developer-tool",
        "terminal",
        "virtualization",
        "other",
    ),
    "app_count": _int_between(0, 200),
    # server-only fields
    "state": _one_of(*(s.value for s in DeviceState)),
    "attempt_status": _one_of(*(s.value for s in AttemptStatus)),
}

_INPUT_FIELDS = frozenset({"shortcut", "blocked", "channel"})

#: Which fields each event type accepts. A type absent here accepts none.
_TYPE_FIELDS: dict[ProctoringEventType, frozenset[str]] = {
    E.SESSION_ENDED: frozenset({"attempt_status"}),
    E.CAMERA_DISCONNECTED: frozenset({"state"}),
    E.CAMERA_RECONNECTED: frozenset({"state"}),
    E.MIC_DISCONNECTED: frozenset({"state"}),
    E.MIC_RECONNECTED: frozenset({"state"}),
    E.FULLSCREEN_ENTER: frozenset({"reason"}),
    E.FULLSCREEN_EXIT: frozenset({"previous_state", "current_state", "reason"}),
    E.FULLSCREEN_RESTORED: frozenset({"reason"}),
    E.FOCUS_LOST: frozenset({"reason"}),
    E.FOCUS_REGAINED: frozenset({"duration_ms"}),
    E.COPY_ATTEMPT: _INPUT_FIELDS,
    E.CUT_ATTEMPT: _INPUT_FIELDS,
    E.PASTE_ATTEMPT: _INPUT_FIELDS,
    E.CLIPBOARD_ACCESS_ATTEMPT: _INPUT_FIELDS,
    E.CONTEXT_MENU_ATTEMPT: frozenset({"blocked", "channel"}),
    E.PRINT_ATTEMPT: _INPUT_FIELDS,
    E.DEVTOOLS_ATTEMPT: _INPUT_FIELDS,
    E.KEYBOARD_RESTRICTION_ATTEMPT: _INPUT_FIELDS,
    E.SCREEN_CAPTURE_ATTEMPT: _INPUT_FIELDS,
    E.MULTIPLE_MONITORS_DETECTED: frozenset({"display_count"}),
    E.DISPLAY_CONFIGURATION_CHANGED: frozenset({"display_count", "previous_display_count"}),
    E.ENFORCEMENT_STATUS: frozenset({"capabilities", "environment", "security_mode"}),
    E.DEVICE_CHECK_STARTED: frozenset(),
    E.PROHIBITED_APP_DETECTED: frozenset({"app", "app_category"}),
    E.APP_CLOSE_REQUESTED: frozenset({"app"}),
    E.APP_CLOSED: frozenset({"app"}),
    E.APP_CLOSE_FAILED: frozenset({"app"}),
    E.DEVICE_CHECK_PASSED: frozenset({"app_count"}),
    E.DEVICE_CHECK_FAILED: frozenset({"app_count"}),
}


def validate_details(event_type: ProctoringEventType, details: dict[str, Any]) -> dict[str, Any]:
    """The event's details, if every field is allowed for its type and well-formed; else 422."""
    allowed = _TYPE_FIELDS.get(event_type, frozenset())
    problems = []
    for key, value in details.items():
        if key not in allowed:
            problems.append({"field": f"metadata.{key}", "message": f"Not accepted for {event_type.value}."})
        elif not _FIELDS[key](value):
            problems.append({"field": f"metadata.{key}", "message": "Invalid value."})
    if problems:
        raise ValidationFailed("The event metadata is invalid.", details=problems)
    return dict(details)


class ProctoringEventRecorder:
    def __init__(self, db: Session) -> None:
        self.db = db

    def record_server(
        self,
        session: ProctoringSession,
        event_type: ProctoringEventType,
        details: dict[str, Any] | None = None,
        *,
        at: datetime | None = None,
    ) -> ProctoringEvent:
        """Records a server-side lifecycle event. `at` lets session end carry the attempt's end."""
        event = ProctoringEvent(
            session=session,
            event_type=event_type,
            category=CATEGORY[event_type],
            source=ProctoringEventSource.SERVER,
            details=validate_details(event_type, details or {}),
            recorded_at=at or utcnow(),
        )
        self.db.add(event)
        self.db.flush()
        return event

    def record_client(
        self,
        session: ProctoringSession,
        event_type: ProctoringEventType,
        details: dict[str, Any],
        *,
        client_event_id: uuid.UUID,
        client_reported_at: datetime | None,
    ) -> tuple[ProctoringEvent, bool]:
        """Records an event the candidate's app observed. Returns `(event, created)`.

        The caller has already checked that the session belongs to the signed-in candidate and is
        active. `created` is false for a retry (same `client_event_id`) and for a repeat folded
        into the previous identical event.
        """
        if event_type in SERVER_ONLY:
            raise ValidationFailed(
                "This event is recorded by the server, not reported by the client.",
                details=[{"field": "event_type", "message": f"{event_type.value} cannot be reported."}],
            )
        details = validate_details(event_type, details)

        existing = self._by_client_id(session, client_event_id)
        if existing is not None:
            return existing, False  # a retried request: the original stands

        now = utcnow()
        previous = self._latest_of_type(session, event_type)
        if (
            previous is not None
            and previous.details == details
            and now - previous.recorded_at < DEDUPE_WINDOW
        ):
            return previous, False

        if self._count(session) >= MAX_EVENTS_PER_SESSION:
            log.warning("Proctoring event limit reached", extra={"proctoring_session_id": str(session.id)})
            raise EventLimitReached()

        event = ProctoringEvent(
            session=session,
            event_type=event_type,
            category=CATEGORY[event_type],
            source=ProctoringEventSource.CLIENT,
            details=details,
            client_event_id=client_event_id,
            recorded_at=now,
            client_reported_at=self._plausible(client_reported_at, session, now),
        )
        try:
            with self.db.begin_nested():
                self.db.add(event)
                self.db.flush()
        except IntegrityError:
            # The same retry arrived twice at once; the other request's row is the answer.
            winner = self._by_client_id(session, client_event_id)
            if winner is None:
                raise
            return winner, False
        return event, True

    # -- internals ------------------------------------------------------------------------

    def _by_client_id(self, session: ProctoringSession, client_event_id: uuid.UUID) -> ProctoringEvent | None:
        return self.db.scalar(
            select(ProctoringEvent).where(
                ProctoringEvent.session_id == session.id,
                ProctoringEvent.client_event_id == client_event_id,
            )
        )

    def _latest_of_type(
        self, session: ProctoringSession, event_type: ProctoringEventType
    ) -> ProctoringEvent | None:
        return self.db.scalar(
            select(ProctoringEvent)
            .where(ProctoringEvent.session_id == session.id, ProctoringEvent.event_type == event_type)
            .order_by(ProctoringEvent.recorded_at.desc())
            .limit(1)
        )

    def _count(self, session: ProctoringSession) -> int:
        return (
            self.db.scalar(
                select(func.count())
                .select_from(ProctoringEvent)
                .where(ProctoringEvent.session_id == session.id)
            )
            or 0
        )

    @staticmethod
    def _plausible(reported: datetime | None, session: ProctoringSession, now: datetime) -> datetime | None:
        """The client's timestamp if it could be true, otherwise nothing — never an error."""
        if reported is None or reported.tzinfo is None:
            return None
        earliest = (session.started_at or now) - CLIENT_CLOCK_TOLERANCE
        if earliest <= reported <= now + CLIENT_CLOCK_TOLERANCE:
            return reported
        return None
