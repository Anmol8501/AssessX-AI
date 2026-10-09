"""ORM models. Import everything here so Alembic and `Base.metadata` see every table."""

from app.models.assessment import Assessment, AssessmentStatus, AssessmentType, QuestionNavigation
from app.models.assignment import AssessmentAssignment, AssignmentStatus
from app.models.attempt import (
    ACTIVE_ATTEMPT_STATUSES,
    AssessmentAttempt,
    AttemptAnswer,
    AttemptAnswerOption,
    AttemptStatus,
)
from app.models.attempt_message import AttemptMessage
from app.models.audit_log import AuditAction, AuditLog
from app.models.auth_session import AuthSession
from app.models.base import Base
from app.models.code_execution import CodeExecution, ExecutionKind, ExecutionStatus, Verdict
from app.models.coding import (
    CodingDifficulty,
    CodingProblem,
    CodingProblemVersion,
    CodingTestCase,
    CodingVersionStatus,
    TestCaseVisibility,
)
from app.models.coding_draft import CodingDraft
from app.models.evidence_clip import EvidenceClip, EvidenceClipEvent, EvidenceClipStatus, EvidenceSource
from app.models.interview import (
    CompletionReason,
    Interview,
    InterviewAssignment,
    InterviewDifficulty,
    InterviewFormat,
    InterviewQuestion,
    InterviewQuestionType,
    InterviewSession,
    InterviewSessionItem,
    InterviewSessionStatus,
    InterviewStatus,
    InterviewType,
    ItemState,
    QuestionKind,
    SelectedBy,
)
from app.models.interview_call import CallStatus, InterviewCall, InterviewCallMessage, InterviewCallNote
from app.models.interview_evaluation import EvaluationFailure, EvaluationStatus, InterviewEvaluation
from app.models.interview_review import (
    AnswerMark,
    InterviewReview,
    InterviewReviewDecision,
    InterviewReviewMark,
    InterviewReviewNote,
    InterviewReviewOutcome,
    InterviewReviewStatus,
)
from app.models.login_challenge import LoginChallenge
from app.models.proctoring import DeviceState, ProctoringSession, ProctoringSessionStatus
from app.models.proctoring_event import (
    ProctoringEvent,
    ProctoringEventCategory,
    ProctoringEventSource,
    ProctoringEventType,
)
from app.models.question import OBJECTIVE_TYPES, SINGLE_ANSWER_TYPES, Question, QuestionOption, QuestionType
from app.models.result import AttemptResult
from app.models.review import (
    AttemptReview,
    EvidenceMark,
    ReviewDecision,
    ReviewMark,
    ReviewNote,
    ReviewOutcome,
    ReviewStatus,
)
from app.models.security import PasswordResetCode, RateLimitHit
from app.models.security_event import MaintenanceHeartbeat, SecurityAlert, SecurityEvent
from app.models.user import User, UserRole

__all__ = [
    "MaintenanceHeartbeat",
    "SecurityAlert",
    "SecurityEvent",
    "EvidenceClip",
    "EvidenceClipEvent",
    "EvidenceClipStatus",
    "EvidenceSource",
    "PasswordResetCode",
    "RateLimitHit",
    "AttemptMessage",
    "CodingDraft",
    "CodeExecution",
    "ExecutionKind",
    "ExecutionStatus",
    "Verdict",
    "TestCaseVisibility",
    "OBJECTIVE_TYPES",
    "CodingVersionStatus",
    "CodingTestCase",
    "CodingProblemVersion",
    "CodingProblem",
    "CodingDifficulty",
    "AssessmentType",
    "ACTIVE_ATTEMPT_STATUSES",
    "AnswerMark",
    "SINGLE_ANSWER_TYPES",
    "Assessment",
    "AssessmentAssignment",
    "AssessmentStatus",
    "AssessmentAttempt",
    "AssignmentStatus",
    "AttemptAnswer",
    "AttemptAnswerOption",
    "AttemptResult",
    "AttemptReview",
    "AttemptStatus",
    "AuditAction",
    "AuditLog",
    "AuthSession",
    "Base",
    "CallStatus",
    "CompletionReason",
    "DeviceState",
    "EvaluationFailure",
    "EvaluationStatus",
    "EvidenceMark",
    "Interview",
    "InterviewAssignment",
    "InterviewCall",
    "InterviewCallMessage",
    "InterviewCallNote",
    "InterviewDifficulty",
    "InterviewFormat",
    "InterviewEvaluation",
    "InterviewQuestion",
    "InterviewQuestionType",
    "InterviewReview",
    "InterviewReviewDecision",
    "InterviewReviewMark",
    "InterviewReviewNote",
    "InterviewReviewOutcome",
    "InterviewReviewStatus",
    "InterviewSession",
    "InterviewSessionItem",
    "InterviewSessionStatus",
    "InterviewStatus",
    "InterviewType",
    "ItemState",
    "LoginChallenge",
    "ProctoringEvent",
    "ProctoringEventCategory",
    "ProctoringEventSource",
    "ProctoringEventType",
    "ProctoringSession",
    "ProctoringSessionStatus",
    "Question",
    "QuestionKind",
    "QuestionNavigation",
    "QuestionOption",
    "QuestionType",
    "ReviewDecision",
    "ReviewMark",
    "ReviewNote",
    "ReviewOutcome",
    "ReviewStatus",
    "SelectedBy",
    "User",
    "UserRole",
]
