"""ORM models. Import everything here so Alembic and `Base.metadata` see every table."""

from app.models.assessment import Assessment, AssessmentStatus, QuestionNavigation
from app.models.assignment import AssessmentAssignment, AssignmentStatus
from app.models.auth_session import AuthSession
from app.models.base import Base
from app.models.login_challenge import LoginChallenge
from app.models.question import SINGLE_ANSWER_TYPES, Question, QuestionOption, QuestionType
from app.models.user import User, UserRole

__all__ = [
    "SINGLE_ANSWER_TYPES",
    "Assessment",
    "AssessmentAssignment",
    "AssessmentStatus",
    "AssignmentStatus",
    "AuthSession",
    "Base",
    "LoginChallenge",
    "Question",
    "QuestionNavigation",
    "QuestionOption",
    "QuestionType",
    "User",
    "UserRole",
]
