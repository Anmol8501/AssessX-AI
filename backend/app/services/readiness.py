"""Whether an assessment may become READY.

The same check powers the review screen (as a list of issues) and the DRAFT → READY transition
(as a gate). Keeping one implementation means the UI can never show "ready" for something the
backend would refuse.
"""

from app.models.assessment import Assessment
from app.models.question import SINGLE_ANSWER_TYPES, Question
from app.schemas.assessment import ReadinessIssue, ReadinessReport
from app.schemas.question import MIN_CHOICE_OPTIONS, TRUE_FALSE_LABELS, QuestionType


def _question_issues(question: Question, number: int) -> list[ReadinessIssue]:
    field = f"questions.{question.id}"
    issues: list[ReadinessIssue] = []

    if not question.text.strip():
        issues.append(ReadinessIssue(field=field, message=f"Question {number} has no text."))
    if question.marks <= 0:
        issues.append(
            ReadinessIssue(field=field, message=f"Question {number} must be worth at least 1 mark.")
        )

    options = question.options
    if any(not option.text.strip() for option in options):
        issues.append(ReadinessIssue(field=field, message=f"Question {number} has a blank option."))

    labels = [option.text.strip().lower() for option in options]
    if len(set(labels)) != len(labels):
        issues.append(ReadinessIssue(field=field, message=f"Question {number} has duplicate options."))

    correct = [option for option in options if option.is_correct]
    if question.type is QuestionType.TRUE_FALSE:
        if labels != [label.lower() for label in TRUE_FALSE_LABELS]:
            issues.append(
                ReadinessIssue(field=field, message=f"Question {number} must offer exactly True and False.")
            )
    elif len(options) < MIN_CHOICE_OPTIONS:
        issues.append(
            ReadinessIssue(
                field=field, message=f"Question {number} needs at least {MIN_CHOICE_OPTIONS} options."
            )
        )

    if question.type in SINGLE_ANSWER_TYPES:
        if len(correct) != 1:
            issues.append(
                ReadinessIssue(field=field, message=f"Question {number} needs exactly one correct answer.")
            )
    elif not correct:
        issues.append(
            ReadinessIssue(field=field, message=f"Question {number} needs at least one correct answer.")
        )
    return issues


def evaluate(assessment: Assessment) -> ReadinessReport:
    """Every reason the assessment is not ready, in the order an admin would fix them."""
    issues: list[ReadinessIssue] = []

    if not assessment.title.strip():
        issues.append(ReadinessIssue(field="title", message="The assessment needs a title."))
    if assessment.duration_minutes <= 0:
        issues.append(ReadinessIssue(field="duration_minutes", message="Duration must be at least 1 minute."))
    if assessment.total_marks <= 0:
        issues.append(ReadinessIssue(field="total_marks", message="Total marks must be greater than zero."))
    if assessment.passing_marks > assessment.total_marks:
        issues.append(
            ReadinessIssue(field="passing_marks", message="Passing marks cannot exceed total marks.")
        )

    if assessment.max_attempts <= 0:
        issues.append(ReadinessIssue(field="max_attempts", message="Allow at least one attempt."))
    if (
        assessment.availability_start
        and assessment.availability_end
        and assessment.availability_end <= assessment.availability_start
    ):
        issues.append(
            ReadinessIssue(
                field="availability_end", message="Availability end must be after availability start."
            )
        )

    questions = sorted(assessment.questions, key=lambda q: q.position)
    if not questions:
        issues.append(ReadinessIssue(field="questions", message="Add at least one question."))

    for number, question in enumerate(questions, start=1):
        issues.extend(_question_issues(question, number))

    # Ordering must be deterministic: 0..n-1 with no gaps or repeats.
    positions = [question.position for question in questions]
    if positions != list(range(len(positions))):
        issues.append(
            ReadinessIssue(
                field="questions", message="Question order is inconsistent. Reorder the questions."
            )
        )

    allocated = sum(question.marks for question in questions)
    if questions and allocated != assessment.total_marks:
        issues.append(
            ReadinessIssue(
                field="total_marks",
                message=(
                    f"Question marks add up to {allocated}, but the assessment is set to "
                    f"{assessment.total_marks}."
                ),
            )
        )

    return ReadinessReport(is_ready=not issues, issues=issues)
