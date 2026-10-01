"""Admin views of one attempt's proctoring: risk (Phase 6A) and evidence (Phase 6B). 6C adds review.

Admin-only, enforced server-side by `AdminUser`, like every admin route: a candidate gets 403 and an
anonymous request 401. Read-only — there is no way to set, edit or override a risk score. Any
administrator may read any attempt, the same scope as results and live monitoring in this
single-tenant build (assessments are not yet scoped to their author).
"""

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import AdminUser, DbSession
from app.models.base import utcnow
from app.schemas.evidence import (
    EvidenceDetail,
    EvidenceEpisodeOut,
    EvidenceItemOut,
    EvidenceTimeline,
    SourceEvent,
)
from app.schemas.risk import AttemptRisk
from app.services.risk.evidence import DEFAULT_LIMIT, MAX_LIMIT
from app.services.risk.service import RiskService

router = APIRouter(prefix="/admin/attempts", tags=["admin attempts"])
#: Who read which attempt's evidence (ids only). A persistent audit table is open decision OQ-12.
audit = logging.getLogger("assessx.evidence")


@router.get("/{attempt_id}/risk", response_model=AttemptRisk)
def attempt_risk(attempt_id: uuid.UUID, _: AdminUser, db: DbSession) -> AttemptRisk:
    """The attempt's risk state, calculated by the server from its stored events (policy 6A-v1).

    A summary of observable signals for human review — not a determination that anyone cheated.
    404 when the attempt does not exist or is not proctored.
    """
    now = utcnow()
    return AttemptRisk.of(attempt_id, RiskService(db).assess(attempt_id, now=now), calculated_at=now)


@router.get("/{attempt_id}/evidence", response_model=EvidenceTimeline)
def attempt_evidence(
    attempt_id: uuid.UUID,
    admin: AdminUser,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> EvidenceTimeline:
    """The attempt's evidence timeline, oldest first, one bounded page at a time.

    Every item is a real signal traced to its stored events; episodes are the risk engine's
    correlated windows. Evidence describes what was observed — not intent, not a verdict.
    `since`/`until` select items by start time; `next_cursor` continues the list.
    """
    now = utcnow()
    result = RiskService(db).evidence(
        attempt_id, now=now, limit=limit, cursor=cursor, since=since, until=until
    )
    page_episodes = {i.episode_id for i in result.page.items if i.episode_id}
    audit.info(
        "Evidence read",
        extra={"admin_id": str(admin.id), "attempt_id": str(attempt_id), "items": len(result.page.items)},
    )
    return EvidenceTimeline(
        attempt_id=attempt_id,
        policy_version=result.evidence.policy_version,
        evidence_version=result.evidence.evidence_version,
        calculated_at=now,
        as_of=result.evidence.as_of,
        session_live=result.evidence.session_live,
        total=result.page.total,
        items=[EvidenceItemOut.of(i) for i in result.page.items],
        episodes=[
            EvidenceEpisodeOut.of(e)
            for key, e in sorted(result.evidence.episodes.items())
            if key in page_episodes
        ],
        next_cursor=result.page.next_cursor,
    )


@router.get("/{attempt_id}/evidence/{evidence_id}", response_model=EvidenceDetail)
def attempt_evidence_item(
    attempt_id: uuid.UUID, evidence_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> EvidenceDetail:
    """One evidence item of this attempt, its episode, and the stored events it came from.

    404 if the attempt is unknown/unproctored or the evidence id is not part of *this* attempt.
    """
    result = RiskService(db).evidence_item(attempt_id, evidence_id, now=utcnow())
    audit.info(
        "Evidence item read",
        extra={"admin_id": str(admin.id), "attempt_id": str(attempt_id), "evidence_id": str(evidence_id)},
    )
    return EvidenceDetail(
        attempt_id=attempt_id,
        policy_version=result.evidence.policy_version,
        evidence_version=result.evidence.evidence_version,
        item=EvidenceItemOut.of(result.item),
        episode=EvidenceEpisodeOut.of(result.episode) if result.episode else None,
        source_events=[
            SourceEvent(
                event_id=e.id,
                event_type=e.event_type,
                source=e.source,
                recorded_at=e.recorded_at,
                details=e.details,
            )
            for e in result.source_events
        ],
    )
