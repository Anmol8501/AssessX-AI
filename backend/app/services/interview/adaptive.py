"""Phase 7B — AdaptivePolicy: what to ask next, decided by code from a validated evaluation.

The AI produces an evaluation signal; this policy — deterministic, bounded and unit-tested — turns it into
a decision. The model never chooses a question, a difficulty or an interview state, and nothing here can
hire, reject, rank, end an interview early or touch proctoring risk.

Rules (`7B-v1`):

* **Follow-up** — only after a PRIMARY answer, only if a follow-up is configured for that question, the
  interview enables follow-ups and the session's budget is not spent (at most one per question, never a
  follow-up of a follow-up). With an evaluation, it is asked when the overall score is below
  `FOLLOW_UP_BELOW` or an expected concept was judged missing. **Without one** (no evaluator configured, it
  failed, or it did not arrive in time) the 7A rule applies unchanged: the configured follow-up is asked
  while the budget lasts.
* **Difficulty** — only for an adaptive interview, only after a PRIMARY answer, only with an evaluation
  whose confidence is at least `MIN_CONFIDENCE`: ≥ `RAISE_AT` → one level harder, ≤ `LOWER_AT` → one level
  easier, otherwise unchanged; never outside [min, max]. Without an evaluation it never changes.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.models.interview import DIFFICULTY_RANK, InterviewDifficulty, QuestionKind, SelectedBy

POLICY_VERSION = "7B-v1"
FOLLOW_UP_BELOW = 70
RAISE_AT = 80
LOWER_AT = 40
MIN_CONFIDENCE = Decimal("0.5")

_BY_RANK = {rank: level for level, rank in DIFFICULTY_RANK.items()}


@dataclass(frozen=True)
class Signal:
    """The only parts of an evaluation the policy reads — all validated, server-side values."""

    overall_score: int
    confidence: Decimal
    missing_concepts: int


@dataclass(frozen=True)
class Decision:
    follow_up: bool
    difficulty: InterviewDifficulty
    change: int  # -1, 0 or +1
    selected_by: SelectedBy
    reason: str


def step(
    level: InterviewDifficulty, delta: int, low: InterviewDifficulty, high: InterviewDifficulty
) -> InterviewDifficulty:
    rank = DIFFICULTY_RANK[level] + delta
    return _BY_RANK[max(DIFFICULTY_RANK[low], min(DIFFICULTY_RANK[high], rank))]


def decide(
    *,
    answered: QuestionKind,
    signal: Signal | None,
    evaluated: bool,
    follow_up_available: bool,
    adaptive: bool,
    current: InterviewDifficulty,
    minimum: InterviewDifficulty,
    maximum: InterviewDifficulty,
) -> Decision:
    """`evaluated`: an evaluator was configured for this answer (so a missing signal means it failed or
    was late — FALLBACK — rather than that the server has no evaluator — PLAN)."""
    can_follow = answered is QuestionKind.PRIMARY and follow_up_available
    if signal is None:
        return Decision(
            follow_up=can_follow,
            difficulty=current,
            change=0,
            selected_by=SelectedBy.FALLBACK if evaluated else SelectedBy.PLAN,
            reason="no_evaluation_signal" if evaluated else "no_evaluator_configured",
        )

    weak = signal.overall_score < FOLLOW_UP_BELOW or signal.missing_concepts > 0
    follow_up = can_follow and weak
    target, reason = current, "within_band"
    if adaptive and answered is QuestionKind.PRIMARY:
        if signal.confidence < MIN_CONFIDENCE:
            reason = "low_confidence_no_change"
        elif signal.overall_score >= RAISE_AT:
            target, reason = step(current, +1, minimum, maximum), "strong_answer"
        elif signal.overall_score <= LOWER_AT:
            target, reason = step(current, -1, minimum, maximum), "weak_answer"
    change = DIFFICULTY_RANK[target] - DIFFICULTY_RANK[current]
    if follow_up:
        reason = f"{reason}+follow_up"
    return Decision(
        follow_up=follow_up, difficulty=target, change=change, selected_by=SelectedBy.ADAPTIVE, reason=reason
    )
