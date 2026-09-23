"""Assessment and question authoring rules. Routes call this; it owns every decision."""

import logging
import uuid

from sqlalchemy.orm import Session

from app.core.errors import NotFound, ValidationFailed
from app.models.assessment import Assessment, AssessmentStatus
from app.models.question import Question, QuestionOption
from app.models.user import User
from app.repositories.assessments import AssessmentRepository
from app.repositories.questions import QuestionRepository
from app.schemas.assessment import AssessmentCreate, AssessmentUpdate, ReadinessReport
from app.schemas.question import QuestionCreate, QuestionOptionInput, QuestionUpdate, validate_answer_key
from app.services import readiness

log = logging.getLogger("assessx.assessments")


class AssessmentService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.assessments = AssessmentRepository(db)
        self.questions = QuestionRepository(db)

    # -- assessments ---------------------------------------------------------------------

    def list_assessments(self) -> list[Assessment]:
        return self.assessments.list()

    def get(self, assessment_id: uuid.UUID, *, with_questions: bool = False) -> Assessment:
        assessment = self.assessments.get(assessment_id, with_questions=with_questions)
        if assessment is None:
            raise NotFound("Assessment not found.")
        return assessment

    def create(self, payload: AssessmentCreate, *, author: User) -> Assessment:
        assessment = self.assessments.add(
            Assessment(
                title=payload.title,
                description=payload.description or None,
                instructions=payload.instructions or None,
                duration_minutes=payload.duration_minutes,
                total_marks=payload.total_marks,
                passing_marks=payload.passing_marks,
                created_by_id=author.id,
            )
        )
        log.info(
            "Assessment created",
            extra={"assessment_id": str(assessment.id), "user_id": str(author.id)},
        )
        return assessment

    def update(self, assessment_id: uuid.UUID, payload: AssessmentUpdate) -> Assessment:
        assessment = self.get(assessment_id, with_questions=True)
        changes = payload.model_dump(exclude_unset=True)
        for field, value in changes.items():
            setattr(assessment, field, value or None if field in {"description", "instructions"} else value)

        # Cross-field rules: check the values that will actually be stored, not just the patch.
        if assessment.passing_marks > assessment.total_marks:
            raise ValidationFailed(
                "Passing marks cannot exceed total marks.",
                details=[{"field": "passing_marks", "message": "Cannot exceed total marks."}],
            )
        if (
            assessment.availability_start
            and assessment.availability_end
            and assessment.availability_end <= assessment.availability_start
        ):
            raise ValidationFailed(
                "Availability end must be after availability start.",
                details=[{"field": "availability_end", "message": "Must be after the start."}],
            )
        self.db.flush()
        log.info("Assessment updated", extra={"assessment_id": str(assessment.id), "fields": sorted(changes)})
        return assessment

    def delete(self, assessment_id: uuid.UUID) -> None:
        assessment = self.get(assessment_id)
        # Questions and their options go with it (cascade on the relationship and the FK).
        self.assessments.delete(assessment)
        log.info("Assessment deleted", extra={"assessment_id": str(assessment_id)})

    # -- questions -----------------------------------------------------------------------

    def list_questions(self, assessment_id: uuid.UUID) -> list[Question]:
        self.get(assessment_id)  # 404 rather than an empty list for an unknown assessment
        return self.questions.list_for_assessment(assessment_id)

    def get_question(self, assessment_id: uuid.UUID, question_id: uuid.UUID) -> Question:
        self.get(assessment_id)
        question = self.questions.get(question_id, assessment_id=assessment_id)
        if question is None:
            raise NotFound("Question not found.")
        return question

    def add_question(self, assessment_id: uuid.UUID, payload: QuestionCreate) -> Question:
        self.get(assessment_id)
        question = self.questions.add(
            Question(
                assessment_id=assessment_id,
                type=payload.type,
                text=payload.text,
                marks=payload.marks,
                explanation=payload.explanation or None,
                position=self.assessments.next_question_position(assessment_id),
                options=self._build_options(payload.options),
            )
        )
        log.info(
            "Question added",
            extra={
                "assessment_id": str(assessment_id),
                "question_id": str(question.id),
                "type": question.type.value,
            },
        )
        return question

    def update_question(
        self, assessment_id: uuid.UUID, question_id: uuid.UUID, payload: QuestionUpdate
    ) -> Question:
        question = self.get_question(assessment_id, question_id)
        changes = payload.model_dump(exclude_unset=True)

        next_type = payload.type or question.type
        if payload.options is not None:
            # Re-validate against the type that will be stored: changing one without the other
            # could leave, say, an MCQ with two correct answers.
            try:
                validate_answer_key(next_type, payload.options)
            except ValueError as error:
                raise ValidationFailed(
                    str(error), details=[{"field": "options", "message": str(error)}]
                ) from error
            # Remove the old options and flush first: the (question_id, position) unique
            # constraint would otherwise see the old and new rows at the same time.
            question.options.clear()
            self.db.flush()
            question.options = self._build_options(payload.options)
        elif payload.type is not None and payload.type != question.type:
            raise ValidationFailed(
                "Changing the question type requires new options.",
                details=[{"field": "options", "message": "Provide options for the new question type."}],
            )

        for field in ("type", "text", "marks", "explanation"):
            if field in changes:
                setattr(question, field, changes[field] or None if field == "explanation" else changes[field])

        self.db.flush()
        log.info("Question updated", extra={"question_id": str(question.id), "fields": sorted(changes)})
        return question

    def delete_question(self, assessment_id: uuid.UUID, question_id: uuid.UUID) -> None:
        question = self.get_question(assessment_id, question_id)
        self.questions.delete(question)
        self._compact_positions(assessment_id)
        log.info(
            "Question deleted", extra={"assessment_id": str(assessment_id), "question_id": str(question_id)}
        )

    # -- lifecycle -----------------------------------------------------------------------

    @staticmethod
    def readiness(assessment: Assessment) -> ReadinessReport:
        return readiness.evaluate(assessment)

    def mark_ready(self, assessment_id: uuid.UUID) -> Assessment:
        """DRAFT -> READY, refused while anything is incomplete. The backend is the only authority."""
        assessment = self.get(assessment_id, with_questions=True)
        report = readiness.evaluate(assessment)
        if not report.is_ready:
            raise ValidationFailed(
                "This assessment is not ready yet.",
                details=[issue.model_dump() for issue in report.issues],
            )
        if assessment.status is not AssessmentStatus.READY:
            assessment.status = AssessmentStatus.READY
            self.db.flush()
            log.info("Assessment marked ready", extra={"assessment_id": str(assessment.id)})
        return assessment

    def revert_to_draft(self, assessment_id: uuid.UUID) -> Assessment:
        """READY -> DRAFT so an admin can keep editing. Publishing/archiving belong to Phase 2C."""
        assessment = self.get(assessment_id, with_questions=True)
        if assessment.status is not AssessmentStatus.DRAFT:
            assessment.status = AssessmentStatus.DRAFT
            self.db.flush()
            log.info("Assessment reverted to draft", extra={"assessment_id": str(assessment.id)})
        return assessment

    # -- question order and duplication -----------------------------------------------------

    def duplicate_question(self, assessment_id: uuid.UUID, question_id: uuid.UUID) -> Question:
        """Copies a question (text, type, marks, options, answer key) directly after the original."""
        original = self.get_question(assessment_id, question_id)
        insert_at = original.position + 1
        existing = self.questions.list_for_assessment(assessment_id)

        # Make room: everything from the new slot onwards shifts out of the way first, so the
        # (question, position) ordering never sees two rows claiming the same slot.
        offset = len(existing) + 1
        for question in existing:
            if question.position >= insert_at:
                question.position += offset
        self.db.flush()

        copy = self.questions.add(
            Question(
                assessment_id=assessment_id,
                type=original.type,
                text=original.text,
                marks=original.marks,
                explanation=original.explanation,
                position=insert_at,
                options=[
                    QuestionOption(text=option.text, is_correct=option.is_correct, position=option.position)
                    for option in sorted(original.options, key=lambda o: o.position)
                ],
            )
        )
        self._compact_positions(assessment_id)
        log.info(
            "Question duplicated",
            extra={
                "assessment_id": str(assessment_id),
                "source_id": str(question_id),
                "question_id": str(copy.id),
            },
        )
        return copy

    def reorder_questions(self, assessment_id: uuid.UUID, ordered_ids: list[uuid.UUID]) -> list[Question]:
        """Applies an explicit order. The list must be exactly this assessment's questions."""
        self.get(assessment_id)
        questions = self.questions.list_for_assessment(assessment_id)
        existing_ids = {question.id for question in questions}

        if len(ordered_ids) != len(set(ordered_ids)):
            raise ValidationFailed(
                "The same question appears more than once in the order.",
                details=[{"field": "question_ids", "message": "Ids must be unique."}],
            )
        if set(ordered_ids) != existing_ids:
            raise ValidationFailed(
                "The order must list exactly this assessment's questions.",
                details=[{"field": "question_ids", "message": "Every question must appear exactly once."}],
            )

        by_id = {question.id: question for question in questions}
        # Two passes with an offset: positions stay unique while the new order is applied.
        offset = len(questions)
        for index, question_id in enumerate(ordered_ids):
            by_id[question_id].position = index + offset
        self.db.flush()
        for index, question_id in enumerate(ordered_ids):
            by_id[question_id].position = index
        self.db.flush()

        log.info(
            "Questions reordered",
            extra={"assessment_id": str(assessment_id), "count": len(ordered_ids)},
        )
        return self.questions.list_for_assessment(assessment_id)

    def _compact_positions(self, assessment_id: uuid.UUID) -> None:
        """Renumbers to 0..n-1 in current order, so positions stay gap-free after add/delete/copy."""
        for index, question in enumerate(self.questions.list_for_assessment(assessment_id)):
            if question.position != index:
                question.position = index
        self.db.flush()

    @staticmethod
    def _build_options(options: list[QuestionOptionInput]) -> list[QuestionOption]:
        return [
            QuestionOption(text=option.text, is_correct=option.is_correct, position=index)
            for index, option in enumerate(options)
        ]
