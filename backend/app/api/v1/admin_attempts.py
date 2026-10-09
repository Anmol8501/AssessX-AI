"""Admin views of one attempt's proctoring: risk (Phase 6A), evidence (Phase 6B) and evidence clips
(FR-017). 6C adds review.

Admin-only, enforced server-side by `AdminUser`, like every admin route: a candidate gets 403 and an
anonymous request 401. Read-only — there is no way to set, edit or override a risk score. Any
administrator may read any attempt, the same scope as results and live monitoring in this
single-tenant build (assessments are not yet scoped to their author).
"""

import logging
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response
from sqlalchemy import select

from app.api.deps import AdminUser, DbSession
from app.core.config import get_settings
from app.models.base import utcnow
from app.models.evidence_clip import EvidenceClip, EvidenceClipEvent
from app.schemas.evidence import (
    EvidenceDetail,
    EvidenceEpisodeOut,
    EvidenceItemOut,
    EvidenceTimeline,
    SourceEvent,
)
from app.schemas.evidence_clips import (
    EvidenceClipList,
    EvidenceClipOut,
    EvidenceClipRef,
    EvidenceDeleteIn,
    EvidenceIntegrityOut,
)
from app.schemas.risk import AttemptRisk
from app.services.evidence_clips.service import EvidenceClipService
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
        items=_with_clips(db, attempt_id, [EvidenceItemOut.of(i) for i in result.page.items]),
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
        item=_with_clips(db, attempt_id, [EvidenceItemOut.of(result.item)])[0],
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


# -- evidence clips (FR-017) -----------------------------------------------------------------------------


def _with_clips(db, attempt_id: uuid.UUID, items: list[EvidenceItemOut]) -> list[EvidenceItemOut]:  # noqa: ANN001
    """Attaches each item's clip: the clip that covers the event the item started with."""
    rows = db.execute(
        select(EvidenceClipEvent.event_id, EvidenceClip)
        .join(EvidenceClip, EvidenceClip.id == EvidenceClipEvent.clip_id)
        .where(EvidenceClip.attempt_id == attempt_id)
    ).all()
    refs: dict[uuid.UUID, EvidenceClipRef] = {event_id: EvidenceClipOut.ref(clip) for event_id, clip in rows}
    return [item.model_copy(update={"clip": refs.get(item.evidence_id)}) for item in items]


@router.get("/{attempt_id}/evidence-clips", response_model=EvidenceClipList)
def attempt_evidence_clips(attempt_id: uuid.UUID, admin: AdminUser, db: DbSession) -> EvidenceClipList:
    """Every evidence clip of this attempt, oldest first, with the events each covers.

    Metadata only: the video is fetched separately (`/media`). An unknown attempt simply has no clips.
    """
    clips = EvidenceClipService(db).for_attempt(attempt_id)
    audit.info("Evidence clips listed", extra={"admin_id": str(admin.id), "attempt_id": str(attempt_id)})
    return EvidenceClipList(
        attempt_id=attempt_id,
        retention_days=get_settings().evidence_retention_days,
        clips=[EvidenceClipOut.of(c) for c in clips],
    )


@router.get("/{attempt_id}/evidence-clips/{clip_id}", response_model=EvidenceClipOut)
def attempt_evidence_clip(
    attempt_id: uuid.UUID, clip_id: uuid.UUID, _: AdminUser, db: DbSession
) -> EvidenceClipOut:
    """One clip of this attempt. 404 if the clip belongs to any other attempt."""
    return EvidenceClipOut.of(EvidenceClipService(db).clip_of_attempt(attempt_id, clip_id))


@router.get("/{attempt_id}/evidence-clips/{clip_id}/media")
def attempt_evidence_clip_media(
    attempt_id: uuid.UUID, clip_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> Response:
    """The clip's video, streamed through the API after its SHA-256 is checked. Audited (VIEWED).

    No storage URL is ever issued: each view is an authenticated, authorized request. 409 when there is
    no video yet (or the capture failed) or the integrity check fails; 410 once the video was deleted.
    """
    clip, data = EvidenceClipService(db).media(attempt_id, clip_id, admin)
    return Response(
        content=data,
        media_type=clip.content_type or "video/webm",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": 'inline; filename="evidence-clip.webm"',
            "X-Evidence-SHA256": clip.sha256 or "",
        },
    )


@router.get("/{attempt_id}/evidence-clips/{clip_id}/integrity", response_model=EvidenceIntegrityOut)
def attempt_evidence_clip_integrity(
    attempt_id: uuid.UUID, clip_id: uuid.UUID, admin: AdminUser, db: DbSession
) -> EvidenceIntegrityOut:
    """Re-reads the stored video and compares its SHA-256 and size with those taken when it was stored."""
    result = EvidenceClipService(db).verify(attempt_id, clip_id, admin)
    return EvidenceIntegrityOut(clip_id=clip_id, **vars(result))


@router.delete("/{attempt_id}/evidence-clips/{clip_id}", response_model=EvidenceClipOut)
def delete_evidence_clip(
    attempt_id: uuid.UUID, clip_id: uuid.UUID, payload: EvidenceDeleteIn, admin: AdminUser, db: DbSession
) -> EvidenceClipOut:
    """Deletes the clip's video (the metadata and its audit trail remain, as DELETED). Needs a reason."""
    return EvidenceClipOut.of(EvidenceClipService(db).delete(attempt_id, clip_id, admin, payload.reason))
