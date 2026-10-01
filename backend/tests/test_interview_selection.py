"""Phase 7A: the question selection engine (pure — no database).

What is asserted: only active primary questions matching the interview's topics, type and difficulty
ceiling are eligible; the plan is the first `question_count` in authored order and is deterministic;
a follow-up is asked only after its primary is answered, only while enabled and within budget, and at
most once; nothing repeats; the interview completes when the plan is exhausted; and the engine refuses
to move on while the current question is unanswered.
"""

import random
import uuid

import pytest

from app.models.interview import (
    Interview,
    InterviewDifficulty,
    InterviewQuestion,
    InterviewQuestionType,
    InterviewSessionItem,
    InterviewType,
    ItemState,
    QuestionKind,
)
from app.services.interview.policy import within_difficulty
from app.services.interview.selection import (
    build_plan,
    eligible_primaries,
    follow_ups_by_parent,
    next_question,
)

D = InterviewDifficulty
T = InterviewQuestionType


def interview(**overrides) -> Interview:
    values = {
        "id": uuid.uuid4(),
        "interview_type": InterviewType.TECHNICAL,
        "difficulty": D.MEDIUM,
        "topics": ["Python", "SQL"],
        "question_count": 3,
        "follow_ups_enabled": True,
        "max_follow_ups": 2,
    }
    return Interview(**{**values, **overrides})


def question(position: int, **overrides) -> InterviewQuestion:
    values = {
        "id": uuid.uuid4(),
        "kind": QuestionKind.PRIMARY,
        "question_type": T.TECHNICAL,
        "topic": "Python",
        "difficulty": D.EASY,
        "position": position,
        "is_active": True,
        "text": f"Q{position}",
    }
    return InterviewQuestion(**{**values, **overrides})


def follow_up(parent: InterviewQuestion, **overrides) -> InterviewQuestion:
    return question(parent.position, kind=QuestionKind.FOLLOW_UP, parent_question_id=parent.id, **overrides)


def item(
    q: InterviewQuestion, sequence: int, *, answered: bool = True, parent: InterviewSessionItem | None = None
):
    return InterviewSessionItem(
        id=uuid.uuid4(),
        question_id=q.id,
        sequence=sequence,
        kind=q.kind,
        parent_item_id=parent.id if parent else None,
        state=ItemState.ANSWERED if answered else ItemState.PRESENTED,
    )


def step(iv: Interview, plan, items, questions, used=0):
    return next_question(
        plan=plan,
        items=items,
        follow_ups=follow_ups_by_parent(questions),
        follow_ups_enabled=iv.follow_ups_enabled,
        max_follow_ups=iv.max_follow_ups,
        follow_ups_used=used,
    )


# -- eligibility and the plan -----------------------------------------------------------------------


def test_only_active_primaries_in_topic_type_and_difficulty_are_eligible():
    iv = interview()
    ok = question(0)
    rows = [
        ok,
        question(1, is_active=False),
        question(2, topic="Kubernetes"),
        question(3, question_type=T.BEHAVIORAL),  # not a technical interview's type
        question(4, difficulty=D.HARD),  # above the MEDIUM ceiling
        follow_up(ok),
        question(5, difficulty=D.MEDIUM, question_type=T.SCENARIO, topic="SQL"),
    ]
    assert [q.position for q in eligible_primaries(iv, rows)] == [0, 5]


@pytest.mark.parametrize(
    ("interview_type", "allowed"),
    [
        (InterviewType.TECHNICAL, {T.TECHNICAL, T.CONCEPTUAL, T.SCENARIO}),
        (InterviewType.BEHAVIORAL, {T.BEHAVIORAL}),
        (InterviewType.MIXED, set(T)),
    ],
)
def test_question_types_follow_the_interview_type(interview_type, allowed):
    iv = interview(interview_type=interview_type)
    rows = [question(i, question_type=t) for i, t in enumerate(T)]
    assert {q.question_type for q in eligible_primaries(iv, rows)} == allowed


def test_difficulty_is_a_ceiling():
    assert within_difficulty(D.EASY, D.MEDIUM) and within_difficulty(D.MEDIUM, D.MEDIUM)
    assert not within_difficulty(D.HARD, D.MEDIUM)
    assert all(within_difficulty(d, D.HARD) for d in D)
    assert [d for d in D if within_difficulty(d, D.EASY)] == [D.EASY]


def test_the_plan_is_the_first_n_in_authored_order_and_deterministic():
    iv = interview(question_count=3)
    rows = [question(p) for p in (4, 1, 3, 0, 2)]
    plan = build_plan(iv, rows)
    assert plan == [str(q.id) for q in sorted(rows, key=lambda q: q.position)[:3]]
    for _ in range(20):
        shuffled = rows[:]
        random.shuffle(shuffled)  # noqa: S311 - ordering test, not security
        assert build_plan(iv, shuffled) == plan


def test_a_short_bank_gives_a_short_plan():
    assert len(build_plan(interview(question_count=5), [question(0), question(1)])) == 2


# -- progression ------------------------------------------------------------------------------------


def test_the_first_question_is_the_first_of_the_plan():
    iv = interview()
    rows = [question(0), question(1)]
    nxt = step(iv, build_plan(iv, rows), [], rows)
    assert nxt.kind is QuestionKind.PRIMARY and nxt.question_id == rows[0].id


def test_a_configured_follow_up_comes_after_its_primary_then_the_plan_resumes():
    iv = interview(question_count=2)
    q0, q1 = question(0), question(1)
    f0 = follow_up(q0)
    rows = [q0, q1, f0]
    plan = build_plan(iv, rows)
    i0 = item(q0, 1)
    nxt = step(iv, plan, [i0], rows)
    assert nxt.kind is QuestionKind.FOLLOW_UP and nxt.question_id == f0.id and nxt.parent_item_id == i0.id

    i1 = item(f0, 2, parent=i0)
    nxt = step(iv, plan, [i0, i1], rows, used=1)
    assert nxt.kind is QuestionKind.PRIMARY and nxt.question_id == q1.id  # never a follow-up of a follow-up


def test_no_follow_up_when_disabled_or_over_budget_or_none_configured():
    q0, q1 = question(0), question(1)
    rows = [q0, q1, follow_up(q0)]
    for iv, used in ((interview(follow_ups_enabled=False), 0), (interview(max_follow_ups=1), 1)):
        nxt = step(iv, build_plan(iv, rows), [item(q0, 1)], rows, used=used)
        assert nxt.kind is QuestionKind.PRIMARY and nxt.question_id == q1.id
    iv = interview()
    nxt = step(iv, build_plan(iv, [q0, q1]), [item(q0, 1)], [q0, q1])
    assert nxt.question_id == q1.id


def test_an_inactive_follow_up_is_never_asked():
    q0, q1 = question(0), question(1)
    rows = [q0, q1, follow_up(q0, is_active=False)]
    iv = interview()
    assert step(iv, build_plan(iv, rows), [item(q0, 1)], rows).question_id == q1.id


def test_the_interview_completes_when_the_plan_is_exhausted_and_nothing_repeats():
    iv = interview(question_count=3, follow_ups_enabled=False)
    rows = [question(p) for p in range(3)]
    plan = build_plan(iv, rows)
    items: list[InterviewSessionItem] = []
    asked: list[uuid.UUID] = []
    while (nxt := step(iv, plan, items, rows)) is not None:
        asked.append(nxt.question_id)
        items.append(item(next(q for q in rows if q.id == nxt.question_id), len(items) + 1))
    assert asked == [q.id for q in rows] and len(set(asked)) == 3


def test_a_full_interview_with_follow_ups_respects_the_budget():
    iv = interview(question_count=4, max_follow_ups=2)
    primaries = [question(p) for p in range(4)]
    rows = primaries + [follow_up(q) for q in primaries]  # every primary has one
    plan = build_plan(iv, rows)
    items: list[InterviewSessionItem] = []
    used = 0
    while (nxt := step(iv, plan, items, rows, used)) is not None:
        q = next(r for r in rows if r.id == nxt.question_id)
        parent = next((i for i in items if i.id == nxt.parent_item_id), None)
        items.append(item(q, len(items) + 1, parent=parent))
        used += nxt.kind is QuestionKind.FOLLOW_UP
    kinds = [i.kind for i in items]
    assert kinds.count(QuestionKind.PRIMARY) == 4 and kinds.count(QuestionKind.FOLLOW_UP) == 2
    assert len({i.question_id for i in items}) == len(items)


def test_the_engine_will_not_move_past_an_unanswered_question():
    iv = interview()
    q0 = question(0)
    with pytest.raises(ValueError, match="not been answered"):
        step(iv, build_plan(iv, [q0]), [item(q0, 1, answered=False)], [q0])
