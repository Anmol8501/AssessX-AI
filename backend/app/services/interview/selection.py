"""QuestionSelectionService — which question a session asks, and when it is finished.

Pure and deterministic: the same interview and the same session history always give the same answer,
so a refresh, a reconnect or a repeated request can never move the interview on or change its paper.
The client never chooses a question; the server derives the current one from the session.

The rules (Phase 7A):

1. **The plan.** At session start, the eligible primary questions are the interview's active PRIMARY
   questions whose topic is one of the interview's topics, whose type suits the interview type, and
   whose difficulty is at or below the interview's. The first `question_count` of them, in authored
   order `(position, id)`, are the plan. It is stored with the session and never recomputed.
2. **After a primary is answered** — if follow-ups are enabled, the session's follow-up budget is not
   spent, and that primary has an active follow-up — the follow-up is asked next. At most one per
   primary (also a database constraint). This is the administrator's configured follow-up, not an
   evaluation of the answer; Phase 7B will make that decision.
3. **Otherwise** the next primary of the plan not yet presented is asked.
4. **When none is left**, the interview is complete.

**Phase 7B (adaptive interviews).** With `adaptive_difficulty` on, the plan is instead the whole eligible
pool within [min_difficulty, difficulty], still frozen at start; each next primary is the first unasked
one *at the target difficulty* the adaptive policy set (or, if that level is exhausted, the nearest level,
preferring the easier), and the interview stops after `question_count` primaries. Whether a follow-up is
asked becomes the policy's decision (`adaptive.py`) — still at most one per question, within the budget.
Without adaptive difficulty the 7A rules above are unchanged.
"""

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from app.models.interview import (
    DIFFICULTY_RANK,
    Interview,
    InterviewDifficulty,
    InterviewQuestion,
    InterviewSessionItem,
    ItemState,
    QuestionKind,
)
from app.services.interview.policy import TYPE_COMPATIBILITY, within_difficulty


@dataclass(frozen=True)
class NextQuestion:
    kind: QuestionKind
    question_id: uuid.UUID
    #: For a follow-up: the item of the primary it follows.
    parent_item_id: uuid.UUID | None = None


def _order(question: InterviewQuestion) -> tuple[int, str]:
    return (question.position, str(question.id))


def eligible_primaries(
    interview: Interview, questions: Iterable[InterviewQuestion]
) -> list[InterviewQuestion]:
    allowed = TYPE_COMPATIBILITY[interview.interview_type]
    topics = set(interview.topics)
    return sorted(
        (
            q
            for q in questions
            if q.kind is QuestionKind.PRIMARY
            and q.is_active
            and q.topic in topics
            and q.question_type in allowed
            and within_difficulty(q.difficulty, interview.difficulty)
            and (
                not interview.adaptive_difficulty or within_difficulty(interview.min_difficulty, q.difficulty)
            )
        ),
        key=_order,
    )


def build_plan(interview: Interview, questions: Iterable[InterviewQuestion]) -> list[str]:
    """The ordered primary question ids a new session will ask. May be shorter than `question_count`
    only if the interview was published without enough questions — which publishing prevents."""
    eligible = eligible_primaries(interview, questions)
    if interview.adaptive_difficulty:
        return [str(q.id) for q in eligible]  # the pool; `question_count` bounds how many are asked
    return [str(q.id) for q in eligible[: interview.question_count]]


def follow_ups_by_parent(questions: Iterable[InterviewQuestion]) -> dict[uuid.UUID, InterviewQuestion]:
    return {
        q.parent_question_id: q
        for q in questions
        if q.kind is QuestionKind.FOLLOW_UP and q.is_active and q.parent_question_id is not None
    }


def available_follow_up(
    *,
    last: InterviewSessionItem | None,
    follow_ups: dict[uuid.UUID, InterviewQuestion],
    follow_ups_enabled: bool,
    max_follow_ups: int,
    follow_ups_used: int,
) -> InterviewQuestion | None:
    """The configured follow-up that *may* be asked after `last` — whether it *is* asked is the caller's
    (7A: always; 7B: the adaptive policy)."""
    if last is None or last.kind is not QuestionKind.PRIMARY or last.state is not ItemState.ANSWERED:
        return None
    if not follow_ups_enabled or follow_ups_used >= max_follow_ups:
        return None
    return follow_ups.get(last.question_id)


def next_primary(
    *,
    plan: Sequence[str],
    items: Sequence[InterviewSessionItem],
    question_count: int,
    target: InterviewDifficulty | None = None,
    difficulty_of: dict[str, InterviewDifficulty] | None = None,
) -> uuid.UUID | None:
    """The next unasked primary of the plan — at the target difficulty when one is given (else the nearest
    level, preferring the easier), in authored order. None when `question_count` primaries have been
    asked or the plan is exhausted."""
    presented = {str(i.question_id) for i in items if i.kind is QuestionKind.PRIMARY}
    if len(presented) >= question_count:
        return None
    remaining = [q for q in plan if q not in presented]
    if not remaining:
        return None
    if target is None or difficulty_of is None:
        return uuid.UUID(remaining[0])
    goal = DIFFICULTY_RANK[target]

    def distance(question_id: str) -> tuple[int, int]:
        rank = DIFFICULTY_RANK[difficulty_of[question_id]]
        return (abs(rank - goal), rank)  # nearest level first; on a tie, the easier one

    best = min(distance(q) for q in remaining)
    return uuid.UUID(next(q for q in remaining if distance(q) == best))


def next_question(
    *,
    plan: Sequence[str],
    items: Sequence[InterviewSessionItem],
    follow_ups: dict[uuid.UUID, InterviewQuestion],
    follow_ups_enabled: bool,
    max_follow_ups: int,
    follow_ups_used: int,
) -> NextQuestion | None:
    """What to ask after the last item was answered (or first, with no items). None: complete."""
    """The 7A rule: the configured follow-up while the budget lasts, else the next primary of the plan."""
    last = items[-1] if items else None
    if last is not None and last.state is not ItemState.ANSWERED:
        raise ValueError("The current question has not been answered.")
    follow_up = available_follow_up(
        last=last,
        follow_ups=follow_ups,
        follow_ups_enabled=follow_ups_enabled,
        max_follow_ups=max_follow_ups,
        follow_ups_used=follow_ups_used,
    )
    if follow_up is not None and last is not None:
        return NextQuestion(QuestionKind.FOLLOW_UP, follow_up.id, last.id)
    primary = next_primary(plan=plan, items=items, question_count=len(plan))
    return NextQuestion(QuestionKind.PRIMARY, primary) if primary else None
