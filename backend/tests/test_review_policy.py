"""Phase 6C: the review vocabulary and transitions (pure — no database).

The outcomes are administrative, not AI classifications: no value or text says a candidate cheated,
and every outcome is described. The transitions only move forward, and a completed review is
changed only by a revision.
"""

import re

import pytest

from app.core.errors import AttemptStillOpen, ReviewConflict, ReviewNotStarted, ValidationFailed
from app.models.audit_log import AuditAction
from app.models.review import UNREVIEWED, EvidenceMark, ReviewOutcome, ReviewStatus
from app.services.review import policy
from app.services.review.service import _decode_cursor

VERDICT = re.compile(
    r"cheat|guilt|fraud|dishonest|misconduct|proves?|confirmed cheating|intent", re.IGNORECASE
)


def test_outcomes_are_neutral_administrative_language():
    assert [o.value for o in ReviewOutcome] == ["NO_ACTION", "CLEARED", "FLAGGED", "INVALIDATED"]
    assert set(policy.OUTCOME_DESCRIPTIONS) == set(ReviewOutcome)
    texts = [
        *policy.OUTCOME_DESCRIPTIONS.values(),
        policy.INTERPRETATION,
        *(m.value for m in ReviewOutcome),
        *(m.value for m in EvidenceMark),
        *(a.value for a in AuditAction),
        ReviewConflict.message,
        ReviewNotStarted.message,
        AttemptStillOpen.message,
    ]
    for value in texts:
        assert not VERDICT.search(value), value


def test_the_interpretation_separates_signal_from_decision():
    assert "written by an administrator" in policy.INTERPRETATION
    assert "do not determine the outcome" in policy.INTERPRETATION
    assert "may differ from the risk level" in policy.INTERPRETATION
    assert "not changed" in policy.OUTCOME_DESCRIPTIONS[ReviewOutcome.INVALIDATED]  # recorded only


def test_the_lifecycle_only_moves_forward():
    assert UNREVIEWED not in {s.value for s in ReviewStatus}  # the absence of a row, never stored
    assert {None} == policy.START_FROM
    assert {ReviewStatus.IN_REVIEW} == policy.COMPLETE_FROM
    assert {ReviewStatus.REVIEWED} == policy.REVISE_FROM  # a completed review changes only by revision
    assert {ReviewStatus.IN_REVIEW} == policy.MARK_FROM  # marks freeze with the decision
    assert {ReviewStatus.IN_REVIEW, ReviewStatus.REVIEWED} == policy.NOTE_FROM


@pytest.mark.parametrize("cursor", ["", "!!", "bm90LWEtY3Vyc29y", "MjAyNi0xMC0wMXxub3QtYS11dWlk"])
def test_invalid_queue_cursors_are_refused(cursor):
    with pytest.raises(ValidationFailed):
        _decode_cursor(cursor)
