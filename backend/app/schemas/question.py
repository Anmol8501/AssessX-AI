import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models.question import SINGLE_ANSWER_TYPES, QuestionType

QuestionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
OptionText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
Explanation = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]

MIN_CHOICE_OPTIONS = 2
MAX_OPTIONS = 10
TRUE_FALSE_LABELS = ("True", "False")


class QuestionOptionInput(BaseModel):
    text: OptionText
    is_correct: bool = False


def validate_answer_key(question_type: QuestionType, options: list[QuestionOptionInput]) -> None:
    """The type-specific rules. Enforced here so they apply to create and update alike, and so the
    backend never depends on the client having checked them."""
    correct = [option for option in options if option.is_correct]

    if question_type is QuestionType.TRUE_FALSE:
        labels = [option.text.strip().lower() for option in options]
        if labels != [label.lower() for label in TRUE_FALSE_LABELS]:
            raise ValueError("A true/false question must have exactly two options: True and False.")
    elif len(options) < MIN_CHOICE_OPTIONS:
        raise ValueError(f"Provide at least {MIN_CHOICE_OPTIONS} options.")

    if len(options) > MAX_OPTIONS:
        raise ValueError(f"A question can have at most {MAX_OPTIONS} options.")

    seen = {option.text.strip().lower() for option in options}
    if len(seen) != len(options):
        raise ValueError("Options must be distinct.")

    if question_type in SINGLE_ANSWER_TYPES:
        if len(correct) != 1:
            raise ValueError("Select exactly one correct answer.")
    elif not correct:
        raise ValueError("Select at least one correct answer.")


class QuestionCreate(BaseModel):
    type: QuestionType
    text: QuestionText
    marks: int = Field(default=1, gt=0, le=100)
    explanation: Explanation | None = None
    options: list[QuestionOptionInput] = Field(min_length=2, max_length=MAX_OPTIONS)

    @model_validator(mode="after")
    def _check_answer_key(self) -> "QuestionCreate":
        validate_answer_key(self.type, self.options)
        return self


class QuestionUpdate(BaseModel):
    """Options are replaced as a whole when supplied — partial option edits would leave the answer
    key ambiguous. `type` may change, in which case options must be supplied to match it."""

    type: QuestionType | None = None
    text: QuestionText | None = None
    marks: int | None = Field(default=None, gt=0, le=100)
    explanation: Explanation | None = None
    options: list[QuestionOptionInput] | None = Field(default=None, min_length=2, max_length=MAX_OPTIONS)

    @model_validator(mode="after")
    def _check_answer_key(self) -> "QuestionUpdate":
        if self.options is not None and self.type is not None:
            validate_answer_key(self.type, self.options)
        return self


class QuestionOptionOut(BaseModel):
    """Admin-facing option. `is_correct` is the answer key: the candidate-facing shape added in a
    later phase must omit it (OQ-17)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    is_correct: bool
    position: int


class QuestionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    assessment_id: uuid.UUID
    type: QuestionType
    text: str
    marks: int
    position: int
    explanation: str | None
    options: list[QuestionOptionOut]
    created_at: datetime
    updated_at: datetime
