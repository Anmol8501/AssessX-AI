"""Phase 7B — the versioned evaluation rubrics and the deterministic scoring policy.

The model scores each rubric dimension 0–10; **the server** computes the overall 0–100 score from those
dimension scores and the rubric's fixed weights. The model never chooses the final number, so the same
dimension scores always give the same overall score, and a change of weights is a new rubric version.
Old evaluations keep the rubric id and version they were made with and are never re-scored under a newer
one. Rubrics are code, not admin configuration (Phase 7B decision 5).

AI evaluation is an assessment signal and does not make hiring decisions.
"""

from dataclasses import dataclass

from app.models.interview import InterviewQuestionType

SCORE_MIN = 0
SCORE_MAX = 10


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    #: What the evaluator is told this dimension measures.
    description: str
    #: Integer percentage; a rubric's weights sum to exactly 100.
    weight: int


@dataclass(frozen=True)
class Rubric:
    id: str
    version: str
    dimensions: tuple[Dimension, ...]

    @property
    def keys(self) -> tuple[str, ...]:
        return tuple(d.key for d in self.dimensions)


TECHNICAL_V1 = Rubric(
    id="technical",
    version="technical-v1",
    dimensions=(
        Dimension("correctness", "Correctness", "Statements made are correct for the question asked.", 30),
        Dimension(
            "conceptual_understanding",
            "Conceptual understanding",
            "The answer shows understanding of the underlying concepts, not just terms. Valid alternative "
            "explanations count fully.",
            25,
        ),
        Dimension("completeness", "Completeness", "The answer covers what the question asks for.", 20),
        Dimension(
            "reasoning", "Reasoning", "Explanations, trade-offs or justification are sound and relevant.", 15
        ),
        Dimension("technical_accuracy", "Technical accuracy", "Terminology and specifics are precise.", 10),
    ),
)

BEHAVIORAL_V1 = Rubric(
    id="behavioral",
    version="behavioral-v1",
    dimensions=(
        Dimension("relevance", "Relevance", "The answer addresses the question asked.", 20),
        Dimension(
            "situation_clarity",
            "Situation clarity",
            "The context of the example is clear enough to follow. "
            "A STAR structure is helpful, not required.",
            15,
        ),
        Dimension("actions", "Actions", "The candidate's own actions are described specifically.", 25),
        Dimension("reasoning", "Reasoning", "Why those actions were taken is explained.", 15),
        Dimension("outcome", "Outcome", "The result, or what was learned, is stated.", 15),
        Dimension(
            "communication",
            "Communication",
            "The answer is organised and understandable. Not language fluency, accent or style.",
            10,
        ),
    ),
)

RUBRICS = (TECHNICAL_V1, BEHAVIORAL_V1)

_FOR_TYPE: dict[InterviewQuestionType, Rubric] = {
    InterviewQuestionType.TECHNICAL: TECHNICAL_V1,
    InterviewQuestionType.CONCEPTUAL: TECHNICAL_V1,
    InterviewQuestionType.SCENARIO: TECHNICAL_V1,
    InterviewQuestionType.BEHAVIORAL: BEHAVIORAL_V1,
}


def rubric_for(question_type: InterviewQuestionType) -> Rubric:
    """Behavioral answers are never scored on technical dimensions, nor the reverse."""
    return _FOR_TYPE[question_type]


def overall_score(rubric: Rubric, scores: dict[str, int]) -> int:
    """0–100 from 0–10 dimension scores and integer weights: exact, rounded half up, once."""
    if set(scores) != set(rubric.keys):
        raise ValueError("Scores must cover exactly the rubric's dimensions.")
    total = sum(d.weight * scores[d.key] for d in rubric.dimensions)  # 0 … 1000
    return (total + 5) // 10
