"""Phase 7A — the interview engine's fixed rules, in one place.

**Phase 7A does not evaluate candidate answers.** Nothing in this package scores, ranks or judges an
answer, and nothing calls an AI model. Question selection is deterministic and server-controlled; a
follow-up is the one an administrator configured for that question, asked while the interview's
follow-up budget lasts — not an adaptive choice. Phase 7B replaces that one decision (whether to ask
the follow-up) with an evaluation; the rest of the engine stays as it is.
"""

from app.models.interview import DIFFICULTY_RANK, InterviewDifficulty, InterviewQuestionType, InterviewType

MAX_TOPICS = 12
MAX_TOPIC_LENGTH = 60
MAX_CONCEPTS = 20
MAX_CONCEPT_LENGTH = 200
MAX_QUESTION_TEXT = 2000
MAX_CONTEXT = 4000
MAX_ANSWER = 10_000

#: Which question types an interview of each type may ask.
TYPE_COMPATIBILITY: dict[InterviewType, frozenset[InterviewQuestionType]] = {
    InterviewType.TECHNICAL: frozenset(
        {InterviewQuestionType.TECHNICAL, InterviewQuestionType.CONCEPTUAL, InterviewQuestionType.SCENARIO}
    ),
    InterviewType.BEHAVIORAL: frozenset({InterviewQuestionType.BEHAVIORAL}),
    InterviewType.MIXED: frozenset(InterviewQuestionType),
}


def within_difficulty(question: InterviewDifficulty, ceiling: InterviewDifficulty) -> bool:
    """The interview's difficulty is a ceiling: never ask harder than configured."""
    return DIFFICULTY_RANK[question] <= DIFFICULTY_RANK[ceiling]
