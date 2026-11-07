"""Validates and creates an exam from the AI Assistant's CREATE_EXAM payload.

This service validates the payload against the same rules the backend enforces,
then uses the existing AssessmentService to build the exam and questions.
"""

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import BadRequest
from app.models.assessment import AssessmentType
from app.models.question import SINGLE_ANSWER_TYPES, QuestionType
from app.models.user import User
from app.schemas.assessment import AssessmentCreate
from app.schemas.question import QuestionCreate, QuestionOptionInput
from app.services.assessments import AssessmentService

log = logging.getLogger("assessx.ai_assistant.exam_creator")

_VALID_TYPES = {qt.value for qt in QuestionType if qt != QuestionType.CODING}
_VALID_ASSESSMENT_TYPES = {at.value for at in AssessmentType}


def _validate_payload(payload: dict[str, Any]) -> None:
    """Validate the CREATE_EXAM payload before touching the database.

    Raises BadRequest with a descriptive message on the first problem found.
    """
    assessment = payload.get("assessment")
    questions = payload.get("questions")

    if not isinstance(assessment, dict):
        raise BadRequest("AI payload missing 'assessment' object")
    if not isinstance(questions, list) or len(questions) == 0:
        raise BadRequest("AI payload missing 'questions' list")

    # Assessment fields
    title = assessment.get("title", "").strip()
    if not title:
        raise BadRequest("Exam title is required")

    assessment_type_raw = assessment.get("assessment_type", "MCQ")
    if assessment_type_raw not in _VALID_ASSESSMENT_TYPES:
        raise BadRequest(f"Invalid assessment_type: {assessment_type_raw!r}")

    total_marks = assessment.get("total_marks")
    passing_marks = assessment.get("passing_marks")
    duration_minutes = assessment.get("duration_minutes")

    if not isinstance(total_marks, int) or total_marks <= 0:
        raise BadRequest("total_marks must be a positive integer")
    if not isinstance(passing_marks, int) or passing_marks < 0:
        raise BadRequest("passing_marks must be a non-negative integer")
    if passing_marks > total_marks:
        raise BadRequest("passing_marks cannot exceed total_marks")
    if not isinstance(duration_minutes, int) or duration_minutes <= 0:
        raise BadRequest("duration_minutes must be a positive integer")

    # Questions
    marks_sum = 0
    for i, q in enumerate(questions, 1):
        q_type = q.get("type", "")
        if q_type not in _VALID_TYPES:
            raise BadRequest(
                f"Question {i}: unsupported type {q_type!r}. Use MCQ, MULTIPLE_SELECT, or TRUE_FALSE"
            )
        if q_type == "CODING":
            raise BadRequest(f"Question {i}: CODING questions cannot be created through the AI Assistant")

        text = q.get("text", "").strip()
        if not text:
            raise BadRequest(f"Question {i}: text is required")

        marks = q.get("marks")
        if not isinstance(marks, int) or marks <= 0:
            raise BadRequest(f"Question {i}: marks must be a positive integer")
        marks_sum += marks

        options = q.get("options", [])
        if not isinstance(options, list) or len(options) < 2:
            raise BadRequest(f"Question {i}: must have at least 2 options")
        if len(options) > 10:
            raise BadRequest(f"Question {i}: cannot have more than 10 options")

        correct_count = sum(1 for opt in options if opt.get("is_correct", False))

        qt = QuestionType(q_type)
        if qt in SINGLE_ANSWER_TYPES and correct_count != 1:
            raise BadRequest(
                f"Question {i} ({q_type}): must have exactly one correct answer, found {correct_count}"
            )
        if qt == QuestionType.MULTIPLE_SELECT and correct_count < 1:
            raise BadRequest(f"Question {i} (MULTIPLE_SELECT): must have at least one correct answer")

        if qt == QuestionType.TRUE_FALSE:
            option_texts = [opt.get("text", "").strip() for opt in options]
            if option_texts != ["True", "False"]:
                raise BadRequest(
                    f"Question {i} (TRUE_FALSE): options must be exactly "
                    f'["True", "False"], got {option_texts}'
                )

    if marks_sum != total_marks:
        raise BadRequest(
            f"Question marks sum ({marks_sum}) does not equal total_marks ({total_marks}). "
            "The AI-generated exam has a marks mismatch."
        )


def create_exam_from_payload(
    payload: dict[str, Any],
    admin: User,
    db: Session,
) -> str:
    """Validate the payload and create the exam + questions in the database.

    Returns the new assessment's ID (as a string).
    Raises BadRequest if the payload is invalid.
    """
    _validate_payload(payload)

    assessment_data = payload["assessment"]
    questions_data = payload["questions"]

    service = AssessmentService(db)

    create_input = AssessmentCreate(
        title=assessment_data["title"].strip(),
        assessment_type=AssessmentType(assessment_data.get("assessment_type", "MCQ")),
        description=assessment_data.get("description") or None,
        instructions=assessment_data.get("instructions") or None,
        duration_minutes=int(assessment_data["duration_minutes"]),
        total_marks=int(assessment_data["total_marks"]),
        passing_marks=int(assessment_data["passing_marks"]),
    )

    assessment = service.create(create_input, author=admin)
    log.info("AI Assistant created assessment %s for admin %s", assessment.id, admin.id)

    for i, q_data in enumerate(questions_data):
        q_input = QuestionCreate(
            type=QuestionType(q_data["type"]),
            text=q_data["text"].strip(),
            marks=int(q_data["marks"]),
            explanation=q_data.get("explanation") or None,
            options=[
                QuestionOptionInput(
                    text=opt["text"].strip(),
                    is_correct=bool(opt.get("is_correct", False)),
                )
                for opt in q_data["options"]
            ],
        )
        service.add_question(assessment.id, q_input)
        log.info("AI Assistant added question %d to assessment %s", i + 1, assessment.id)

    db.flush()
    return str(assessment.id)
