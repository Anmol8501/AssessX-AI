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
* **AI observations are episodes (Phase 5C).** An AI observation type (`AI_EPISODE_TYPES`) is
  reported as a `started` row and later a `resolved` row sharing an `episode_id` — never one row
  per frame. The server keeps the lifecycle honest: a start needs a new episode id; a resolution
  must match an open episode of the same type in this session; the duration is computed here from
  the server's own clock; a stale open episode is closed as `superseded` when a new one of the same
  type starts (the app restarted mid-episode); and open episodes are closed as `session_ended` when
  the session ends. None of this says the candidate did anything wrong.
"""

import logging
import math
import re
import uuid
from collections.abc import Callable, Iterable
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
from app.services.coding.languages import LANGUAGES

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
    E.FACE_NOT_DETECTED: C.AI_OBSERVATION,
    E.MULTIPLE_FACES_DETECTED: C.AI_OBSERVATION,
    E.HEAD_ORIENTATION_CHANGED: C.AI_OBSERVATION,
    E.GAZE_AWAY: C.AI_OBSERVATION,
    E.CAMERA_TOO_DARK: C.AI_OBSERVATION,
    E.FACE_TOO_FAR: C.AI_OBSERVATION,
    E.FACE_TOO_CLOSE: C.AI_OBSERVATION,
    E.PHONE_DETECTED: C.AI_OBSERVATION,
    E.BOOK_DETECTED: C.AI_OBSERVATION,
    E.LAPTOP_DETECTED: C.AI_OBSERVATION,
    E.HANDHELD_DEVICE_DETECTED: C.AI_OBSERVATION,
    E.AI_STATUS: C.AI_HEALTH,
    E.CODING_QUESTION_OPENED: C.CODING,
    E.CODE_PASTED: C.CODING,
    E.CODE_RUN_REQUESTED: C.CODING,
    E.CODE_SUBMITTED: C.CODING,
    E.CODE_LANGUAGE_CHANGED: C.CODING,
}

#: AI observation types recorded as episodes (started → resolved). See the module docstring.
AI_EPISODE_TYPES = frozenset(t for t, c in CATEGORY.items() if c is C.AI_OBSERVATION)
#: Resolutions a client may report. `superseded` and `session_ended` are the server's.
CLIENT_RESOLUTIONS = frozenset({"condition_cleared", "measurement_unavailable", "monitoring_stopped"})
#: AI observation types that may no longer be *started* (webcam validation, 2026-09-30). The gaze
#: signal proved unusable, so GAZE_AWAY is not an event: the app does not produce it and the server
#: refuses a new one. The type stays valid so earlier rows remain, and an episode left open by an
#: earlier app build can still be resolved (or is closed when the session ends).
DISABLED_EPISODE_TYPES = frozenset({E.GAZE_AWAY})
_EPISODE_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_AI_DETECTORS = ("face_presence", "face_tracking", "head_pose", "gaze", "object_detection", "frame_quality")

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
        # The server records these itself, from the requests it receives.
        E.CODE_RUN_REQUESTED,
        E.CODE_SUBMITTED,
        E.CODE_LANGUAGE_CHANGED,
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


def _number_between(low: float, high: float) -> Callable[[Any], bool]:
    return lambda v: (
        isinstance(v, int | float) and not isinstance(v, bool) and math.isfinite(v) and low <= v <= high
    )


def _detector_list(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) <= len(_AI_DETECTORS)
        and len(set(value)) == len(value)
        and all(isinstance(v, str) and v in _AI_DETECTORS for v in value)
    )


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
    "question_number": _int_between(1, 1000),
    "length": _int_between(0, 1_000_000),
    "language": lambda v: isinstance(v, str) and v in LANGUAGES,
    "previous_language": lambda v: isinstance(v, str) and v in LANGUAGES,
    "custom_input": lambda v: isinstance(v, bool),
    # AI observations (Phase 5C) — factual measurements only; no score, risk or verdict field exists
    "phase": _one_of("started", "resolved"),
    "episode_id": lambda v: isinstance(v, str) and bool(_EPISODE_ID.match(v)),
    "detector": _one_of(*_AI_DETECTORS),
    "resolution": _one_of(*CLIENT_RESOLUTIONS, "superseded", "session_ended"),
    "face_count": _int_between(0, 50),
    "confidence": _number_between(0, 1),
    "direction": _one_of("left", "right", "up", "down"),
    "yaw_deg": _number_between(-180, 180),
    "pitch_deg": _number_between(-180, 180),
    "neutral_yaw_deg": _number_between(-180, 180),
    "gaze_horizontal": _number_between(-1, 1),
    "gaze_vertical": _number_between(-1, 1),
    "mean_luminance": _number_between(0, 1),
    "face_area_ratio": _number_between(0, 1),
    # objects in view (2026-10-02) — the class, the model's confidence, which model, the box's size
    "object_class": _one_of("cell_phone", "book", "laptop", "remote"),
    "object_model": _one_of("yolox_s", "yolox_tiny", "efficientdet_lite0"),
    "box_area_ratio": _number_between(0, 1),
    # AI health (Phase 5C)
    "ai_status": _one_of("INITIALIZING", "RUNNING", "DEGRADED", "ERROR", "STOPPED"),
    "ai_reason": _one_of(
        "none",
        "no_runtime",
        "model_load_failed",
        "runtime_error",
        "camera_unavailable",
        "detector_impaired",
        "inference_slow",
        "stopped",
    ),
    "impaired": _detector_list,
    "accelerator": _one_of("CPU", "GPU"),
    # server-only fields
    "state": _one_of(*(s.value for s in DeviceState)),
    "attempt_status": _one_of(*(s.value for s in AttemptStatus)),
}

_INPUT_FIELDS = frozenset({"shortcut", "blocked", "channel"})
#: Every AI episode row: its phase and episode, which detector, and (on resolution) why it ended and
#: how long it lasted. `duration_ms` is always computed by the server.
_EPISODE_FIELDS = frozenset({"phase", "episode_id", "detector", "resolution", "duration_ms"})
#: An object episode's measurement when it started. Never an image, a crop or a description.
_OBJECT_FIELDS = frozenset({"object_class", "confidence", "object_model", "box_area_ratio"})

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
    E.FACE_NOT_DETECTED: _EPISODE_FIELDS,
    E.MULTIPLE_FACES_DETECTED: _EPISODE_FIELDS | {"face_count", "confidence"},
    E.HEAD_ORIENTATION_CHANGED: _EPISODE_FIELDS | {"direction", "yaw_deg", "pitch_deg", "neutral_yaw_deg"},
    E.GAZE_AWAY: _EPISODE_FIELDS | {"direction", "gaze_horizontal", "gaze_vertical"},
    E.CAMERA_TOO_DARK: _EPISODE_FIELDS | {"mean_luminance"},
    E.FACE_TOO_FAR: _EPISODE_FIELDS | {"face_area_ratio"},
    E.FACE_TOO_CLOSE: _EPISODE_FIELDS | {"face_area_ratio"},
    E.PHONE_DETECTED: _EPISODE_FIELDS | _OBJECT_FIELDS,
    E.BOOK_DETECTED: _EPISODE_FIELDS | _OBJECT_FIELDS,
    E.LAPTOP_DETECTED: _EPISODE_FIELDS | _OBJECT_FIELDS,
    E.HANDHELD_DEVICE_DETECTED: _EPISODE_FIELDS | _OBJECT_FIELDS,
    E.AI_STATUS: frozenset({"ai_status", "ai_reason", "impaired", "accelerator"}),
    E.CODING_QUESTION_OPENED: frozenset({"question_number"}),
    E.CODE_PASTED: frozenset({"question_number", "length"}),
    E.CODE_RUN_REQUESTED: frozenset({"question_number", "language", "custom_input"}),
    E.CODE_SUBMITTED: frozenset({"question_number", "language"}),
    E.CODE_LANGUAGE_CHANGED: frozenset({"question_number", "language", "previous_language"}),
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
        if event_type is E.AI_STATUS and "ai_status" not in details:
            raise ValidationFailed(
                "AI_STATUS needs ai_status.",
                details=[{"field": "metadata.ai_status", "message": "Required."}],
            )

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

        if event_type in AI_EPISODE_TYPES:
            details = self._episode(session, event_type, details, now)

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

    def close_open_episodes(self, session: ProctoringSession, at: datetime) -> list[ProctoringEvent]:
        """Resolves every AI episode still open when the session ends (`session_ended`).

        After submission the attempt is locked, so the candidate's app cannot report the end of an
        observation that was still going on; the server closes it at the session's end instead, so
        no episode is left without a duration.
        """
        return [
            self._resolve(session, start, "session_ended", at)
            for start in self._open_episodes(session).values()
        ]

    # -- internals ------------------------------------------------------------------------

    def _episode(
        self,
        session: ProctoringSession,
        event_type: ProctoringEventType,
        details: dict[str, Any],
        now: datetime,
    ) -> dict[str, Any]:
        """Checks an AI episode row against the session's open episodes; returns the details to store."""

        def refuse(field: str, message: str) -> ValidationFailed:
            return ValidationFailed(
                "The AI event is inconsistent.", details=[{"field": f"metadata.{field}", "message": message}]
            )

        phase = details.get("phase")
        episode_id = details.get("episode_id")
        if phase is None or episode_id is None:
            raise refuse("phase" if phase is None else "episode_id", "Required for AI observations.")
        if "duration_ms" in details:
            raise refuse("duration_ms", "Computed by the server.")
        open_episodes = self._open_episodes(session)

        if phase == "started":
            if event_type in DISABLED_EPISODE_TYPES:
                raise refuse("event_type", "This AI observation is disabled and is not recorded.")
            if "resolution" in details:
                raise refuse("resolution", "Only a resolved episode has a resolution.")
            if self._episode_exists(session, episode_id):
                raise refuse("episode_id", "This episode already exists.")
            for start in [e for e in open_episodes.values() if e.event_type == event_type]:
                self._resolve(session, start, "superseded", now)  # left open by an earlier app run
            return details

        resolution = details.get("resolution")
        if resolution not in CLIENT_RESOLUTIONS:
            raise refuse("resolution", "Required, and must be one a client may report.")
        start = open_episodes.get(episode_id)
        if start is None or start.event_type != event_type:
            raise refuse("episode_id", "No open episode of this type with this id.")
        stored = {**details, "duration_ms": _duration_ms(start.recorded_at, now)}
        if "detector" in start.details:
            stored.setdefault("detector", start.details["detector"])
        return stored

    def _resolve(
        self, session: ProctoringSession, start: ProctoringEvent, resolution: str, at: datetime
    ) -> ProctoringEvent:
        details: dict[str, Any] = {
            "phase": "resolved",
            "episode_id": start.details["episode_id"],
            "resolution": resolution,
            "duration_ms": _duration_ms(start.recorded_at, at),
        }
        if "detector" in start.details:
            details["detector"] = start.details["detector"]
        return self.record_server(session, start.event_type, details, at=at)

    def _open_episodes(self, session: ProctoringSession) -> dict[str, ProctoringEvent]:
        """AI episodes started and not yet resolved in this session, by episode id."""
        rows = self.db.scalars(
            select(ProctoringEvent)
            .where(ProctoringEvent.session_id == session.id, ProctoringEvent.category == C.AI_OBSERVATION)
            .order_by(ProctoringEvent.recorded_at)
        )
        return open_episodes(rows)

    def _episode_exists(self, session: ProctoringSession, episode_id: str) -> bool:
        return (
            self.db.scalar(
                select(func.count())
                .select_from(ProctoringEvent)
                .where(
                    ProctoringEvent.session_id == session.id,
                    ProctoringEvent.category == C.AI_OBSERVATION,
                    ProctoringEvent.details["episode_id"].astext == episode_id,
                )
            )
            or 0
        ) > 0

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


def _duration_ms(start: datetime, end: datetime) -> int:
    return max(0, min(int((end - start).total_seconds() * 1000), 24 * 60 * 60 * 1000))


def open_episodes(rows: Iterable[ProctoringEvent]) -> dict[str, ProctoringEvent]:
    """The AI episodes among `rows` that were started and never resolved, by episode id.

    Independent of row order: a start and its resolution can share a timestamp, so a resolution
    closes its episode wherever it appears. Non-episode rows (e.g. AI_STATUS) are ignored.
    """
    started: dict[str, ProctoringEvent] = {}
    resolved: set[str] = set()
    for row in rows:
        if row.event_type not in AI_EPISODE_TYPES:
            continue
        episode = row.details.get("episode_id")
        if row.details.get("phase") == "started":
            started.setdefault(episode, row)
        else:
            resolved.add(episode)
    return {episode: row for episode, row in started.items() if episode not in resolved}
