"""Publishing, demo candidates and assessment/candidate assignment (Phase 2C)."""

import logging
import uuid

from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models.assessment import Assessment, AssessmentStatus
from app.models.assignment import AssessmentAssignment
from app.models.base import utcnow
from app.models.user import User, UserRole
from app.repositories.assignments import AssignmentRepository
from app.repositories.users import UserRepository
from app.schemas.assignment import CandidateCreate
from app.services.users import UserService

log = logging.getLogger("assessx.assignments")


class CandidateService:
    """Demo candidates: real `users` rows with the CANDIDATE role, created by an administrator.

    There is no institutional directory in this showcase build — no import, SSO or invitation flow.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self.users = UserRepository(db)
        self.user_service = UserService(db)
        self.assignments = AssignmentRepository(db)

    def list_with_counts(self) -> list[tuple[User, int]]:
        counts = self.assignments.counts_by_candidate()
        return [(candidate, counts.get(candidate.id, 0)) for candidate in self.assignments.list_candidates()]

    def create(self, payload: CandidateCreate) -> User:
        if self.users.get_by_email(payload.email):
            raise Conflict("A user with that email already exists.")
        if self.users.get_by_roll_number(payload.roll_number):
            raise Conflict("A candidate with that roll number already exists.")

        # The role is fixed here: this endpoint can never mint an administrator.
        candidate = self.user_service.create(
            name=payload.name,
            email=payload.email,
            password=payload.initial_password,
            role=UserRole.CANDIDATE,
            roll_number=payload.roll_number,
        )
        log.info("Demo candidate created", extra={"user_id": str(candidate.id)})
        return candidate


class AssignmentService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.repo = AssignmentRepository(db)
        self.users = UserRepository(db)

    # -- publishing ---------------------------------------------------------------------

    def publish(self, assessment: Assessment) -> Assessment:
        """READY → PUBLISHED. Callers validate readiness first; a draft can never skip the step."""
        if assessment.status is AssessmentStatus.DRAFT:
            raise ValidationFailed(
                "Mark the assessment ready before publishing it.",
                details=[{"field": "status", "message": "A draft cannot be published directly."}],
            )
        if assessment.status is not AssessmentStatus.PUBLISHED:
            assessment.status = AssessmentStatus.PUBLISHED
            assessment.published_at = assessment.published_at or utcnow()
            self.db.flush()
            log.info("Assessment published", extra={"assessment_id": str(assessment.id)})
        return assessment

    def unpublish(self, assessment: Assessment) -> Assessment:
        """PUBLISHED → DRAFT, refused once candidates hold it so their assignment cannot be
        invalidated underneath them."""
        if assessment.status is not AssessmentStatus.PUBLISHED:
            return assessment
        if self.repo.count_for_assessment(assessment.id) > 0:
            raise Conflict("Unassign every candidate before returning this assessment to draft.")
        assessment.status = AssessmentStatus.DRAFT
        assessment.published_at = None
        self.db.flush()
        log.info("Assessment unpublished", extra={"assessment_id": str(assessment.id)})
        return assessment

    # -- assignment ----------------------------------------------------------------------

    def list_assignments(self, assessment_id: uuid.UUID) -> list[AssessmentAssignment]:
        return self.repo.list_for_assessment(assessment_id)

    def assign(
        self, assessment: Assessment, candidate_ids: list[uuid.UUID], *, assigned_by: User
    ) -> tuple[list[AssessmentAssignment], list[uuid.UUID]]:
        """Assigns a published assessment. Returns the new assignments and any already in place."""
        if assessment.status is not AssessmentStatus.PUBLISHED:
            raise ValidationFailed(
                "Publish the assessment before assigning candidates.",
                details=[{"field": "status", "message": "Only a published assessment can be assigned."}],
            )

        existing = self.repo.assigned_candidate_ids(assessment.id)
        created: list[AssessmentAssignment] = []
        already: list[uuid.UUID] = []

        for candidate_id in dict.fromkeys(candidate_ids):  # de-duplicate, keep order
            if candidate_id in existing:
                already.append(candidate_id)
                continue
            candidate = self.users.get(candidate_id)
            if candidate is None:
                raise NotFound("One of the selected candidates does not exist.")
            if candidate.role is not UserRole.CANDIDATE:
                raise ValidationFailed(
                    "Only candidates can be assigned an assessment.",
                    details=[{"field": "candidate_ids", "message": f"{candidate.email} is not a candidate."}],
                )
            if not candidate.is_active:
                raise ValidationFailed(
                    "Inactive candidates cannot be assigned an assessment.",
                    details=[{"field": "candidate_ids", "message": f"{candidate.email} is inactive."}],
                )
            created.append(
                self.repo.add(
                    AssessmentAssignment(
                        assessment_id=assessment.id,
                        candidate_id=candidate.id,
                        assigned_by_id=assigned_by.id,
                    )
                )
            )

        if created:
            log.info(
                "Candidates assigned",
                extra={"assessment_id": str(assessment.id), "count": len(created)},
            )
        return created, already

    def unassign(self, assessment_id: uuid.UUID, candidate_id: uuid.UUID) -> None:
        assignment = self.repo.get(assessment_id, candidate_id)
        if assignment is None:
            raise NotFound("That candidate is not assigned to this assessment.")
        self.repo.delete(assignment)
        log.info(
            "Candidate unassigned",
            extra={"assessment_id": str(assessment_id), "candidate_id": str(candidate_id)},
        )

    def list_for_candidate(self, candidate_id: uuid.UUID) -> list[tuple[AssessmentAssignment, int]]:
        """Only ever called with the authenticated candidate's own id."""
        return self.repo.list_for_candidate(candidate_id)
