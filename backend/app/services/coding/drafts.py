"""Coding drafts and progress (coding assessments, stage C3).

* `save` stores the candidate's working code for one question of their own open attempt. A save names
  the revision it started from; if the server has moved on (another tab saved first), it is refused with
  the current revision, so newer code is never silently overwritten. Saving goes through the same checks
  as running code: own attempt, open, not on hold, proctoring active when required, a coding question of
  this assessment, an enabled language.
* `progress` summarises each coding question of an attempt for the navigator: not started, in progress
  (a draft), pending (a submission being judged), passed (a submission accepted), or not passed (judged
  submissions, none accepted). Facts only — never a score.
"""

import enum
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, ValidationFailed
from app.models.attempt import AssessmentAttempt
from app.models.code_execution import CodeExecution, ExecutionKind, ExecutionStatus, Verdict
from app.models.coding_draft import CodingDraft
from app.models.proctoring_event import ProctoringEventType
from app.models.question import Question, QuestionType
from app.models.user import User
from app.services.coding.execution import ExecutionService
from app.services.coding.languages import LANGUAGES


class DraftConflict(Conflict):
    code = "draft_conflict"
    message = (
        "This code was changed somewhere else (another window). Reload to continue from the newest version."
    )


class CodingStatus(enum.StrEnum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING = "PENDING"
    PASSED = "PASSED"
    NOT_PASSED = "NOT_PASSED"


class DraftService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, attempt_id: uuid.UUID, question_id: uuid.UUID) -> CodingDraft | None:
        return self.db.scalar(
            select(CodingDraft).where(
                CodingDraft.attempt_id == attempt_id, CodingDraft.question_id == question_id
            )
        )

    def save(
        self,
        candidate: User,
        attempt_id: uuid.UUID,
        question_id: uuid.UUID,
        *,
        language: str,
        source: str,
        base_revision: int | None,
    ) -> CodingDraft:
        # Same gate as running code (and the attempt row is locked, so two saves serialise).
        attempt, question = ExecutionService(self.db)._context(candidate, attempt_id, question_id)
        if language not in question.coding_version.languages or language not in LANGUAGES:
            raise ValidationFailed("That language is not allowed for this problem.")
        draft = self.get(attempt.id, question.id)
        if draft is None:
            if base_revision not in (None, 0):
                raise DraftConflict(details={"revision": 0})
            draft = CodingDraft(
                attempt_id=attempt.id, question_id=question.id, language=language, source=source, revision=1
            )
            self.db.add(draft)
        else:
            if base_revision != draft.revision:
                raise DraftConflict(details={"revision": draft.revision})
            if draft.language != language:
                ExecutionService(self.db).record_event(
                    attempt,
                    question,
                    ProctoringEventType.CODE_LANGUAGE_CHANGED,
                    language=language,
                    previous_language=draft.language,
                )
            draft.language = language
            draft.source = source
            draft.revision += 1
        self.db.flush()
        return draft

    def progress(self, attempt: AssessmentAttempt) -> list[dict]:
        questions = list(
            self.db.scalars(
                select(Question)
                .where(Question.assessment_id == attempt.assessment_id, Question.type == QuestionType.CODING)
                .order_by(Question.position)
            )
        )
        if not questions:
            return []
        drafts = {
            d.question_id: d
            for d in self.db.scalars(select(CodingDraft).where(CodingDraft.attempt_id == attempt.id))
        }
        submissions: dict[uuid.UUID, list[CodeExecution]] = {}
        for execution in self.db.scalars(
            select(CodeExecution).where(
                CodeExecution.attempt_id == attempt.id, CodeExecution.kind == ExecutionKind.SUBMIT
            )
        ):
            submissions.setdefault(execution.question_id, []).append(execution)
        out = []
        for question in questions:
            mine = submissions.get(question.id, [])
            judged = [e for e in mine if e.status is ExecutionStatus.COMPLETED]
            best = max(judged, key=lambda e: (e.verdict is Verdict.ACCEPTED, e.passed or 0), default=None)
            if any(e.status in (ExecutionStatus.QUEUED, ExecutionStatus.RUNNING) for e in mine):
                status = CodingStatus.PENDING
            elif best is not None and best.verdict is Verdict.ACCEPTED:
                status = CodingStatus.PASSED
            elif judged:
                status = CodingStatus.NOT_PASSED
            elif question.id in drafts and drafts[question.id].source.strip():
                status = CodingStatus.IN_PROGRESS
            else:
                status = CodingStatus.NOT_STARTED
            out.append(
                {
                    "question_id": question.id,
                    "status": status.value,
                    "submissions": len(mine),
                    "best_passed": best.passed if best else None,
                    "total": best.total if best else None,
                }
            )
        return out
