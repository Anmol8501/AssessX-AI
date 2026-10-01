"""Phase 7B — AnswerEvaluationService: context → provider → strict validation → normalized result.

**AI evaluation is an assessment signal and does not make hiring decisions.** This module turns one stored
answer into a validated, normalized evaluation, or a recorded failure. It never writes interview state,
never decides what happens next (that is `adaptive.py`, from validated values only) and never hands raw
model output to anyone.

Model output is untrusted. It is parsed into a strict schema (exact fields, exact types, no booleans as
numbers, no NaN/Infinity, bounded lists and strings), then checked against the question it is about:
concept references must be indexes into that question's own expected concepts (the model cannot invent
concepts), quotes must actually occur in the candidate's answer (or they are dropped and flagged), and
obvious contradictions are flagged for the human reviewer. The overall score is computed here, never
taken from the model.
"""

import math
import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.models.interview_evaluation import EvaluationFailure
from app.services.interview.llm import EvaluationProvider, EvaluationRequest, ProviderError
from app.services.interview.prompts import (
    MAX_FEEDBACK_CHARS,
    MAX_ITEM_CHARS,
    MAX_ITEMS,
    SYSTEM_PROMPT,
    EvaluationContext,
    tool_schema,
    user_message,
)
from app.services.interview.rubrics import SCORE_MAX, SCORE_MIN, overall_score

EVALUATOR_VERSION = "7B-v1"
#: Inputs larger than this are not sent to the provider at all (the answer itself is capped at 10,000).
MAX_ANSWER_CHARS = 10_000
_BACKOFF_SECONDS = (1.0, 2.0)

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SPACE = re.compile(r"\s+")
_HIRING = re.compile(
    r"\b(hire|hiring|hired|reject(ed|ion)?|recommend(ed)? (for|against)|not suitable|unsuitable|"
    r"should not be (hired|employed)|pass(ed)? the interview|fail(ed)? the interview)\b",
    re.IGNORECASE,
)


class InvalidOutput(Exception):
    """The provider answered, but not with a usable evaluation. Never retried (it is not transient)."""


class _Output(BaseModel):
    """Exactly the tool schema. Strict: wrong types are rejected, not coerced."""

    model_config = ConfigDict(extra="forbid", strict=True)

    dimension_scores: dict[str, int]
    present_concept_indexes: list[int] = Field(max_length=50)
    missing_concept_indexes: list[int] = Field(max_length=50)
    incorrect_points: list[str] = Field(max_length=MAX_ITEMS)
    strengths: list[str] = Field(max_length=MAX_ITEMS)
    evidence_quotes: list[str] = Field(max_length=MAX_ITEMS)
    feedback: str = Field(max_length=MAX_FEEDBACK_CHARS)
    confidence: float = Field(ge=0, le=1, allow_inf_nan=False)


@dataclass(frozen=True)
class ValidatedEvaluation:
    dimension_scores: dict[str, int]
    overall_score: int
    confidence: Decimal
    present_concepts: list[str]
    missing_concepts: list[str]
    incorrect_points: list[str]
    strengths: list[str]
    evidence_quotes: list[str]
    feedback: str
    flags: list[str]


@dataclass
class EvaluationOutcome:
    """What one evaluation run produced: a validated result, or a failure reason. Never both."""

    result: ValidatedEvaluation | None = None
    failure: EvaluationFailure | None = None
    provider_calls: int = 0
    latency_ms: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    retried_for: list[str] = field(default_factory=list)


def _clean(text: str) -> str:
    return _CONTROL.sub("", text).strip()


def _texts(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        cleaned = _clean(value)
        if len(cleaned) > MAX_ITEM_CHARS:
            raise InvalidOutput("An item is too long.")
        if cleaned and cleaned not in out:
            out.append(cleaned)
    return out


def _normal(text: str) -> str:
    return _SPACE.sub(" ", text).strip().casefold()


def validate(payload: Any, ctx: EvaluationContext) -> ValidatedEvaluation:
    """Parse → schema → ranges → references → normalize → consistency flags. Raises `InvalidOutput`."""
    if not isinstance(payload, dict):
        raise InvalidOutput("The output is not an object.")
    try:
        out = _Output.model_validate(payload)
    except ValidationError as error:
        raise InvalidOutput("The output does not match the schema.") from error

    # Dimension scores: exactly the rubric's dimensions, integers 0–10.
    if set(out.dimension_scores) != set(ctx.rubric.keys):
        raise InvalidOutput("The scored dimensions do not match the rubric.")
    if any(not SCORE_MIN <= v <= SCORE_MAX for v in out.dimension_scores.values()):
        raise InvalidOutput("A dimension score is out of range.")
    if not math.isfinite(out.confidence):
        raise InvalidOutput("Confidence is not a finite number.")

    # Concepts: indexes into this question's own list — in range, unique, not both present and missing.
    count = len(ctx.expected_concepts)
    present, missing = out.present_concept_indexes, out.missing_concept_indexes
    for indexes in (present, missing):
        if len(set(indexes)) != len(indexes) or any(not 0 <= i < count for i in indexes):
            raise InvalidOutput("A concept index is invalid.")
    if set(present) & set(missing):
        raise InvalidOutput("A concept is reported both present and missing.")

    feedback = _clean(out.feedback)
    incorrect = _texts(out.incorrect_points)
    strengths = _texts(out.strengths)

    # Quotes must actually occur in the stored answer; anything else is dropped and flagged.
    flags: list[str] = []
    answer = _normal(ctx.answer)
    quotes = [q for q in _texts(out.evidence_quotes) if _normal(q) and _normal(q) in answer]
    if len(quotes) != len(_texts(out.evidence_quotes)):
        flags.append("UNVERIFIED_QUOTE_REMOVED")

    scores = dict(out.dimension_scores)
    overall = overall_score(ctx.rubric, scores)
    confidence = Decimal(str(out.confidence)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    # Obvious contradictions are flagged for the reviewer, not silently "fixed".
    if count >= 2 and overall >= 80 and len(missing) * 2 >= count:
        flags.append("HIGH_SCORE_WITH_MISSING_CONCEPTS")
    if overall <= 30 and not missing and not incorrect:
        flags.append("LOW_SCORE_WITHOUT_STATED_GAPS")
    if overall >= 80 and incorrect:
        flags.append("HIGH_SCORE_WITH_INCORRECT_POINTS")
    if confidence < Decimal("0.5"):
        flags.append("LOW_CONFIDENCE")
    if any(_HIRING.search(t) for t in [feedback, *strengths, *incorrect]):
        flags.append("HIRING_LANGUAGE")

    return ValidatedEvaluation(
        dimension_scores=scores,
        overall_score=overall,
        confidence=confidence,
        present_concepts=[ctx.expected_concepts[i] for i in sorted(present)],
        missing_concepts=[ctx.expected_concepts[i] for i in sorted(missing)],
        incorrect_points=incorrect,
        strengths=strengths,
        evidence_quotes=quotes,
        feedback=feedback,
        flags=flags,
    )


def evaluate(
    ctx: EvaluationContext,
    provider: EvaluationProvider,
    *,
    max_retries: int,
    sleep: Callable[[float], None] = time.sleep,
) -> EvaluationOutcome:
    """One evaluation run: at most `1 + max_retries` provider calls, retrying only transient failures
    (timeouts, rate limits, unavailability). Bad output is never retried. Never raises."""
    outcome = EvaluationOutcome()
    if not ctx.answer.strip() or len(ctx.answer) > MAX_ANSWER_CHARS:
        outcome.failure = EvaluationFailure.INPUT_TOO_LONG
        return outcome
    request = EvaluationRequest(
        system=SYSTEM_PROMPT,
        user=user_message(ctx),
        schema=tool_schema(ctx.rubric, len(ctx.expected_concepts)),
        dimensions=ctx.rubric.keys,
        concept_count=len(ctx.expected_concepts),
        answer=ctx.answer,
    )
    started = time.monotonic()
    try:
        for attempt in range(1 + max_retries):
            outcome.provider_calls += 1
            try:
                result = provider.evaluate(request)
            except ProviderError as error:
                if error.retryable and attempt < max_retries:
                    outcome.retried_for.append(error.failure.value)
                    sleep(_BACKOFF_SECONDS[min(attempt, len(_BACKOFF_SECONDS) - 1)])
                    continue
                outcome.failure = error.failure
                return outcome
            outcome.input_tokens, outcome.output_tokens = result.input_tokens, result.output_tokens
            try:
                outcome.result = validate(result.payload, ctx)
            except InvalidOutput:
                outcome.failure = EvaluationFailure.INVALID_OUTPUT
            return outcome
        outcome.failure = outcome.failure or EvaluationFailure.PROVIDER_ERROR
        return outcome
    except Exception:  # noqa: BLE001 — a provider bug must never surface as a crash or a score
        outcome.result = None
        outcome.failure = EvaluationFailure.PROVIDER_ERROR
        return outcome
    finally:
        outcome.latency_ms = int((time.monotonic() - started) * 1000)
