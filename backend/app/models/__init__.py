"""ORM models. Import everything here so Alembic and `Base.metadata` see every table."""

from app.models.assessment import Assessment, AssessmentStatus, QuestionNavigation
from app.models.assignment import AssessmentAssignment, AssignmentStatus
from app.models.attempt import (
    ACTIVE_ATTEMPT_STATUSES,
    AssessmentAttempt,
    AttemptAnswer,
    AttemptAnswerOption,
    AttemptStatus,
)
from app.models.auth_session import AuthSession
from app.models.base import Base
from app.models.login_challenge import LoginChallenge
from app.models.proctoring import DeviceState, ProctoringSession, ProctoringSessionStatus
from app.models.proctoring_event import (
    ProctoringEvent,
    ProctoringEventCategory,
    ProctoringEventSource,
    ProctoringEventType,
)
from app.models.question import SINGLE_ANSWER_TYPES, Question, QuestionOption, QuestionType
from app.models.result import AttemptResult
from app.models.user import User, UserRole

__all__ = [
    "ACTIVE_ATTEMPT_STATUSES",
    "SINGLE_ANSWER_TYPES",
    "Assessment",
    "AssessmentAssignment",
    "AssessmentStatus",
    "AssessmentAttempt",
    "AssignmentStatus",
    "AttemptAnswer",
    "AttemptAnswerOption",
    "AttemptResult",
    "AttemptStatus",
    "AuthSession",
    "Base",
    "DeviceState",
    "LoginChallenge",
    "ProctoringEvent",
    "ProctoringEventCategory",
    "ProctoringEventSource",
    "ProctoringEventType",
    "ProctoringSession",
    "ProctoringSessionStatus",
    "Question",
    "QuestionNavigation",
    "QuestionOption",
    "QuestionType",
    "User",
    "UserRole",
]
