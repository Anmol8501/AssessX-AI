"""Evidence clips (PRD FR-017): event → clip policy, upload, integrity, access, retention, failure handling.

The video store is a temporary directory (`LocalEvidenceStorage`); Supabase storage is exercised with a
fake transport. Every test runs against the real API and database, as the app and an admin would.
"""

import hashlib
import json
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select

from app.core.config import Settings, get_settings
from app.models.audit_log import AuditAction, AuditLog
from app.models.base import utcnow
from app.models.evidence_clip import EvidenceClip, EvidenceClipEvent, EvidenceClipStatus
from app.services.evidence_clips import storage as storage_module
from app.services.evidence_clips.service import EvidenceClipService, looks_like_webm, run_maintenance
from app.services.evidence_clips.storage import (
    LocalEvidenceStorage,
    ObjectMissing,
    StorageError,
    SupabaseEvidenceStorage,
    check_key,
    new_key,
)
from tests.conftest import Helpers
from tests.test_assessments import admin_headers, candidate_headers
from tests.test_attempts import ME, start
from tests.test_exam_session import submit
from tests.test_proctoring import activate, intruder, proctored_exam, session_row
from tests.test_proctoring_events import post_event

#: The start of a real WebM file (EBML header naming DocType "webm"), then arbitrary frame bytes.
WEBM = (
    b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\xf2\x81\x04\x42\xf3\x81\x08\x42\x82\x84webm"
    + bytes(range(256)) * 40
)
CLIPS = "/api/v1/admin/attempts/{}/evidence-clips"


@pytest.fixture
def store(tmp_path: Path):
    local = LocalEvidenceStorage(tmp_path / "evidence")
    storage_module.use_storage(local)
    yield local
    storage_module.use_storage(None)


@pytest.fixture
def active(client, helpers: Helpers, users, store):
    exam = proctored_exam(client, helpers, users)
    headers = candidate_headers(helpers)
    attempt = start(client, headers, exam["id"])
    activate(client, headers, attempt["id"], evidence_recorder=True)
    return {"exam": exam, "attempt": attempt, "headers": headers}


def started(client, active, event_type: str = "FACE_NOT_DETECTED", expect: int = 201, **extra) -> dict:
    metadata = {"phase": "started", "episode_id": str(uuid.uuid4())}
    if event_type == "MULTIPLE_FACES_DETECTED":
        metadata["face_count"] = 2
    return post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": event_type, "metadata": metadata},
        expect=expect,
        **extra,
    )


def upload(client, active, clip_id: str, data: bytes = WEBM, expect: int = 200, **kwargs) -> dict:
    headers = {**active["headers"], "Content-Type": kwargs.pop("content_type", "video/webm")}
    response = client.put(
        f"{ME}/attempts/{active['attempt']['id']}/proctoring/evidence-clips/{clip_id}",
        content=data,
        headers=headers,
        params=kwargs,
    )
    assert response.status_code == expect, response.text
    return response.json()


def clip_row(db, clip_id: str) -> EvidenceClip:
    db.expire_all()
    return db.scalar(select(EvidenceClip).where(EvidenceClip.id == uuid.UUID(clip_id)))


def audits(db, action: AuditAction) -> list[AuditLog]:
    return list(db.scalars(select(AuditLog).where(AuditLog.action == action)))


def ready_clip(client, db, active) -> str:
    clip_id = started(client, active)["clip_request"]["clip_id"]
    upload(client, active, clip_id)
    return clip_id


def age(db, clip_id: str, seconds: int) -> None:
    """Moves a clip's times into the past, as if its window ended long ago."""
    clip = clip_row(db, clip_id)
    delta = timedelta(seconds=seconds)
    clip.event_at -= delta
    clip.window_starts_at -= delta
    clip.window_ends_at -= delta
    clip.upload_deadline -= delta
    clip.created_at -= delta
    db.flush()


# -- the event → clip policy -------------------------------------------------------------------------------


def test_a_qualifying_event_creates_a_clip_owned_entirely_by_the_server(client, db, active, users):
    response = started(client, active)
    request = response["clip_request"]
    assert request["upload"] is True
    clip = clip_row(db, request["clip_id"])
    session = session_row(db, active["attempt"])
    assert clip.status is EvidenceClipStatus.CREATING
    assert str(clip.attempt_id) == active["attempt"]["id"]
    assert clip.candidate_id == users["candidate"].id
    assert str(clip.assessment_id) == active["exam"]["id"]
    assert clip.proctoring_session_id == session.id
    assert str(clip.trigger_event_id) == response["id"]
    assert clip.source_type.value == "PRIMARY_CAMERA"
    settings = get_settings()
    assert clip.window_starts_at == clip.event_at - timedelta(seconds=settings.evidence_pre_seconds)
    assert clip.window_ends_at == clip.event_at + timedelta(seconds=settings.evidence_post_seconds)
    assert clip.storage_key is None and clip.sha256 is None
    created = audits(db, AuditAction.EVIDENCE_CLIP_CREATED)
    assert len(created) == 1 and created[0].actor_id == users["candidate"].id


@pytest.mark.parametrize(
    "body",
    [
        {"event_type": "CAMERA_TOO_DARK", "metadata": {"phase": "started", "episode_id": str(uuid.uuid4())}},
        {"event_type": "FOCUS_LOST", "metadata": {}},
        {"event_type": "PASTE_ATTEMPT", "metadata": {}},
    ],
)
def test_events_outside_the_policy_get_no_clip(client, db, active, body):
    response = post_event(client, active["headers"], active["attempt"]["id"], body)
    assert response["clip_request"] is None
    assert db.scalar(select(EvidenceClip)) is None


def test_a_resolved_episode_gets_no_clip_only_its_start_does(client, db, active):
    episode = str(uuid.uuid4())
    first = post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {"event_type": "FACE_NOT_DETECTED", "metadata": {"phase": "started", "episode_id": episode}},
    )
    end = post_event(
        client,
        active["headers"],
        active["attempt"]["id"],
        {
            "event_type": "FACE_NOT_DETECTED",
            "metadata": {"phase": "resolved", "episode_id": episode, "resolution": "condition_cleared"},
        },
    )
    assert first["clip_request"]["upload"] is True
    assert end["clip_request"] is None


def test_events_inside_an_open_window_share_one_clip(client, db, active):
    first = started(client, active)["clip_request"]
    second = started(client, active, "MULTIPLE_FACES_DETECTED")["clip_request"]
    assert second == {"clip_id": first["clip_id"], "upload": False}
    assert db.scalar(select(EvidenceClip.id).where(EvidenceClip.id != uuid.UUID(first["clip_id"]))) is None
    linked = list(
        db.scalars(
            select(EvidenceClipEvent.event_id).where(EvidenceClipEvent.clip_id == uuid.UUID(first["clip_id"]))
        )
    )
    assert len(linked) == 2


def test_cooldown_and_the_per_session_cap(client, db, active, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "evidence_cooldown_seconds", 60)
    first = started(client, active)["clip_request"]["clip_id"]
    age(db, first, 30)  # its window has ended, but the cooldown has not
    assert started(client, active)["clip_request"] is None
    age(db, first, 60)  # cooldown over
    second = started(client, active)["clip_request"]
    assert second["upload"] is True and second["clip_id"] != first

    monkeypatch.setattr(settings, "evidence_max_clips_per_session", 2)
    age(db, second["clip_id"], 120)
    assert started(client, active)["clip_request"] is None  # capped


def test_a_retried_event_is_told_about_its_clip_again(client, db, active):
    client_event_id = str(uuid.uuid4())
    body = {
        "event_type": "FACE_NOT_DETECTED",
        "metadata": {"phase": "started", "episode_id": str(uuid.uuid4())},
        "client_event_id": client_event_id,
    }
    url = f"{ME}/attempts/{active['attempt']['id']}/proctoring/events"
    first = client.post(url, json=body, headers=active["headers"]).json()
    again = client.post(url, json=body, headers=active["headers"])
    assert again.status_code == 200
    assert again.json()["clip_request"] == first["clip_request"]


def test_an_app_that_cannot_record_is_never_asked_for_a_clip(client, db, helpers: Helpers, active):
    # The same candidate resumes on an app without a recorder (e.g. an older version): no clip requests.
    activate(client, active["headers"], active["attempt"]["id"], evidence_recorder=False)
    response = started(client, active)
    assert response["clip_request"] is None
    assert db.scalar(select(EvidenceClip)) is None


def test_clips_off_means_no_clip_and_the_event_still_records(client, db, active, monkeypatch):
    monkeypatch.setattr(get_settings(), "evidence_clips_enabled", False)
    response = started(client, active)
    assert response["clip_request"] is None
    assert db.scalar(select(EvidenceClip)) is None


def test_a_broken_clip_decision_never_loses_the_event(client, db, active, monkeypatch):
    def explode(*args, **kwargs):
        raise RuntimeError("simulated")

    monkeypatch.setattr(EvidenceClipService, "_request", explode)
    response = started(client, active)
    assert response["clip_request"] is None
    assert response["event_type"] == "FACE_NOT_DETECTED"


# -- upload ---------------------------------------------------------------------------------------------


def test_an_upload_is_hashed_by_the_server_and_stored_privately(client, db, active, store, users):
    clip_id = started(client, active)["clip_request"]["clip_id"]
    result = upload(client, active, clip_id, duration_ms=14_800)
    assert result == {"clip_id": clip_id, "status": "READY"}
    clip = clip_row(db, clip_id)
    assert clip.status is EvidenceClipStatus.READY
    assert clip.sha256 == hashlib.sha256(WEBM).hexdigest()
    assert clip.byte_size == len(WEBM) and clip.content_type == "video/webm" and clip.duration_ms == 14_800
    assert clip.retain_until == clip.ready_at + timedelta(days=get_settings().evidence_retention_days)
    check_key(clip.storage_key)  # server-made, unpredictable shape
    assert store.get(clip.storage_key) == WEBM
    assert clip.storage_key not in json.dumps(result)
    ready = audits(db, AuditAction.EVIDENCE_CLIP_READY)
    assert len(ready) == 1 and ready[0].actor_id == users["candidate"].id


def test_upload_validation(client, db, active, monkeypatch):
    clip_id = started(client, active)["clip_request"]["clip_id"]
    upload(client, active, clip_id, content_type="video/mp4", expect=415)
    upload(client, active, clip_id, data=b"", expect=422)
    upload(client, active, clip_id, duration_ms=10_000_000, expect=422)
    assert clip_row(db, clip_id).status is EvidenceClipStatus.CREATING  # none of these spent the clip

    not_webm = started(client, active, "MULTIPLE_FACES_DETECTED")  # linked to the open clip
    assert not_webm["clip_request"]["upload"] is False
    upload(client, active, clip_id, data=b"<script>alert(1)</script>" * 10, expect=415)
    clip = clip_row(db, clip_id)
    assert clip.status is EvidenceClipStatus.FAILED and clip.failure_reason == "invalid_content"


def test_an_oversized_upload_is_refused(client, db, active, monkeypatch):
    monkeypatch.setattr(get_settings(), "evidence_max_clip_bytes", 100_000)
    clip_id = started(client, active)["clip_request"]["clip_id"]
    upload(client, active, clip_id, data=WEBM + b"\0" * 200_000, expect=413)


def test_a_clip_is_uploaded_once(client, db, active):
    clip_id = ready_clip(client, db, active)
    body = upload(client, active, clip_id, expect=409)
    assert body["error"]["code"] == "evidence_upload_closed"


def test_an_upload_after_the_deadline_is_refused_and_the_clip_fails(client, db, active):
    clip_id = started(client, active)["clip_request"]["clip_id"]
    age(db, clip_id, 3600)
    upload(client, active, clip_id, expect=409)
    clip = clip_row(db, clip_id)
    assert clip.status is EvidenceClipStatus.FAILED and clip.failure_reason == "upload_missing"


def test_storage_failure_is_retried_a_bounded_number_of_times(client, db, active, monkeypatch):
    class Broken:
        name = "broken"

        def put(self, *args):
            raise StorageError("down")

    storage_module.use_storage(Broken())
    clip_id = started(client, active)["clip_request"]["clip_id"]
    for _ in range(get_settings().evidence_max_upload_attempts - 1):
        upload(client, active, clip_id, expect=503)
        assert clip_row(db, clip_id).status is EvidenceClipStatus.CREATING
    upload(client, active, clip_id, expect=503)
    clip = clip_row(db, clip_id)
    assert clip.status is EvidenceClipStatus.FAILED and clip.failure_reason == "storage_error"
    # The exam carries on: events are still recorded.
    post_event(
        client, active["headers"], active["attempt"]["id"], {"event_type": "FOCUS_LOST", "metadata": {}}
    )


def test_the_app_can_report_a_failed_capture(client, db, active):
    clip_id = started(client, active)["clip_request"]["clip_id"]
    url = f"{ME}/attempts/{active['attempt']['id']}/proctoring/evidence-clips/{clip_id}/failure"
    assert client.post(url, json={"reason": "made_up"}, headers=active["headers"]).status_code == 422
    bad = client.post(url, json={"reason": "recording_failed", "status": "READY"}, headers=active["headers"])
    assert bad.status_code == 422
    response = client.post(url, json={"reason": "recording_failed"}, headers=active["headers"])
    assert response.status_code == 200 and response.json()["status"] == "FAILED"
    assert clip_row(db, clip_id).failure_reason == "recording_failed"


def test_no_clip_starts_after_the_exam_but_a_pending_one_may_still_arrive(client, db, active):
    clip_id = started(client, active)["clip_request"]["clip_id"]
    submit(client, active["headers"], active["attempt"]["id"])
    started(client, active, expect=409)  # the event itself is refused once the attempt ended
    assert db.scalar(select(EvidenceClip.id).where(EvidenceClip.id != uuid.UUID(clip_id))) is None
    upload(client, active, clip_id)  # the clip whose window straddled the submission is not lost
    assert clip_row(db, clip_id).status is EvidenceClipStatus.READY


# -- ownership and IDOR --------------------------------------------------------------------------------


def test_another_candidate_can_never_upload_to_or_fail_a_clip(client, db, helpers: Helpers, active):
    clip_id = started(client, active)["clip_request"]["clip_id"]
    other = intruder(client, helpers, active["exam"])
    url = f"{ME}/attempts/{active['attempt']['id']}/proctoring/evidence-clips/{clip_id}"
    assert client.put(url, content=WEBM, headers={**other, "Content-Type": "video/webm"}).status_code == 404
    assert client.post(url + "/failure", json={"reason": "upload_failed"}, headers=other).status_code == 404
    # Their own attempt, someone else's clip id: still not found.
    own = start(client, other, active["exam"]["id"])
    activate(client, other, own["id"], evidence_recorder=True)
    cross = f"{ME}/attempts/{own['id']}/proctoring/evidence-clips/{clip_id}"
    assert client.put(cross, content=WEBM, headers={**other, "Content-Type": "video/webm"}).status_code == 404
    assert clip_row(db, clip_id).status is EvidenceClipStatus.CREATING


def test_unknown_clip_ids_and_admins_on_candidate_routes(client, helpers: Helpers, active):
    upload(client, active, str(uuid.uuid4()), expect=404)
    clip_id = started(client, active)["clip_request"]["clip_id"]
    url = f"{ME}/attempts/{active['attempt']['id']}/proctoring/evidence-clips/{clip_id}"
    assert (
        client.put(
            url, content=WEBM, headers={**admin_headers(helpers), "Content-Type": "video/webm"}
        ).status_code
        == 403
    )
    assert client.put(url, content=WEBM, headers={"Content-Type": "video/webm"}).status_code == 401


def test_candidates_never_reach_admin_evidence_routes(client, db, helpers: Helpers, active):
    clip_id = ready_clip(client, db, active)
    base = CLIPS.format(active["attempt"]["id"])
    for method, url in [
        ("GET", base),
        ("GET", f"{base}/{clip_id}"),
        ("GET", f"{base}/{clip_id}/media"),
        ("GET", f"{base}/{clip_id}/integrity"),
        ("DELETE", f"{base}/{clip_id}"),
    ]:
        kwargs = {"json": {"reason": "testing"}} if method == "DELETE" else {}
        assert client.request(method, url, headers=active["headers"], **kwargs).status_code == 403
        assert client.request(method, url, **kwargs).status_code == 401


def test_admins_reach_a_clip_only_through_its_own_attempt(client, db, helpers: Helpers, active, users):
    clip_id = ready_clip(client, db, active)
    other = intruder(client, helpers, active["exam"])
    other_attempt = start(client, other, active["exam"]["id"])
    admin = admin_headers(helpers)
    wrong = CLIPS.format(other_attempt["id"])
    for suffix in ("", "/media", "/integrity"):
        assert client.get(f"{wrong}/{clip_id}{suffix}", headers=admin).status_code == 404
    assert client.get(wrong, headers=admin).json()["clips"] == []


# -- admin review -----------------------------------------------------------------------------------------


def test_an_admin_lists_and_watches_a_clip_and_it_is_audited(client, db, helpers: Helpers, active, users):
    clip_id = ready_clip(client, db, active)
    started(client, active, "MULTIPLE_FACES_DETECTED")  # a later event, in a new window? (cooldown: none)
    admin = admin_headers(helpers)
    listing = client.get(CLIPS.format(active["attempt"]["id"]), headers=admin)
    assert listing.status_code == 200
    body = listing.json()
    clip = next(c for c in body["clips"] if c["clip_id"] == clip_id)
    assert clip["status"] == "READY" and clip["has_video"] is True and clip["source_type"] == "PRIMARY_CAMERA"
    assert clip["events"][0]["event_type"] == "FACE_NOT_DETECTED" and clip["events"][0]["trigger"] is True
    assert "cheat" not in json.dumps(body).lower()
    row = clip_row(db, clip_id)
    assert row.storage_key not in listing.text  # never any storage location

    media = client.get(f"{CLIPS.format(active['attempt']['id'])}/{clip_id}/media", headers=admin)
    assert media.status_code == 200
    assert media.content == WEBM
    assert media.headers["content-type"].startswith("video/webm")
    assert media.headers["cache-control"] == "no-store"
    viewed = audits(db, AuditAction.EVIDENCE_CLIP_VIEWED)
    assert len(viewed) == 1 and viewed[0].actor_id == users["admin"].id
    assert viewed[0].details["clip_id"] == clip_id


def test_the_6b_timeline_shows_which_items_have_a_clip(client, db, helpers: Helpers, active):
    clip_id = ready_clip(client, db, active)
    timeline = client.get(
        f"/api/v1/admin/attempts/{active['attempt']['id']}/evidence", headers=admin_headers(helpers)
    ).json()
    with_clip = [i for i in timeline["items"] if i["clip"]]
    assert len(with_clip) == 1
    assert with_clip[0]["clip"]["clip_id"] == clip_id and with_clip[0]["clip"]["has_video"] is True


def test_a_tampered_or_missing_video_fails_its_integrity_check(client, db, helpers: Helpers, active, store):
    clip_id = ready_clip(client, db, active)
    admin = admin_headers(helpers)
    base = f"{CLIPS.format(active['attempt']['id'])}/{clip_id}"
    assert client.get(f"{base}/integrity", headers=admin).json()["verified"] is True

    path = store.root / clip_row(db, clip_id).storage_key
    path.write_bytes(WEBM[:-1] + b"X")
    response = client.get(f"{base}/media", headers=admin)
    assert response.status_code == 409 and response.json()["error"]["code"] == "evidence_integrity_failed"
    check = client.get(f"{base}/integrity", headers=admin).json()
    assert check["verified"] is False and check["actual_sha256"] != check["expected_sha256"]
    assert audits(db, AuditAction.EVIDENCE_CLIP_INTEGRITY_FAILED)

    path.unlink()
    assert client.get(f"{base}/media", headers=admin).status_code == 409
    assert client.get(f"{base}/integrity", headers=admin).json()["actual_sha256"] is None


def test_a_clip_without_video_is_not_ready(client, db, helpers: Helpers, active):
    clip_id = started(client, active)["clip_request"]["clip_id"]
    response = client.get(
        f"{CLIPS.format(active['attempt']['id'])}/{clip_id}/media", headers=admin_headers(helpers)
    )
    assert response.status_code == 409 and response.json()["error"]["code"] == "evidence_not_ready"


def test_an_admin_deletes_a_clip_with_a_reason(client, db, helpers: Helpers, active, store, users):
    clip_id = ready_clip(client, db, active)
    key = clip_row(db, clip_id).storage_key
    admin = admin_headers(helpers)
    base = f"{CLIPS.format(active['attempt']['id'])}/{clip_id}"
    assert client.request("DELETE", base, headers=admin).status_code == 422  # a reason is required
    response = client.request("DELETE", base, headers=admin, json={"reason": "Recorded in error"})
    assert response.status_code == 200 and response.json()["status"] == "DELETED"
    with pytest.raises(ObjectMissing):
        store.get(key)
    gone = client.get(f"{base}/media", headers=admin)
    assert gone.status_code == 410 and gone.json()["error"]["code"] == "evidence_unavailable"
    assert client.request("DELETE", base, headers=admin, json={"reason": "again"}).status_code == 200
    deleted = audits(db, AuditAction.EVIDENCE_CLIP_DELETED)
    assert len(deleted) == 1 and deleted[0].actor_id == users["admin"].id


# -- lifecycle sweeps --------------------------------------------------------------------------------------


def test_retention_deletes_the_video_keeps_the_record_and_holds_open_reviews(
    client, db, helpers: Helpers, active, store
):
    clip_id = ready_clip(client, db, active)
    key = clip_row(db, clip_id).storage_key
    clip = clip_row(db, clip_id)
    clip.retain_until = utcnow() - timedelta(minutes=1)
    db.flush()

    # A review in progress holds the clip.
    admin = admin_headers(helpers)
    assert (
        client.post(f"/api/v1/admin/attempts/{active['attempt']['id']}/review", headers=admin).status_code
        == 201
    )
    held = EvidenceClipService(db).enforce_retention(now=utcnow())
    assert held == {"expired": 0, "held": 1, "errors": 0}
    assert store.get(key) == WEBM

    from app.models.review import AttemptReview, ReviewStatus

    review = db.scalar(
        select(AttemptReview).where(AttemptReview.attempt_id == uuid.UUID(active["attempt"]["id"]))
    )
    assert review.status is ReviewStatus.IN_REVIEW
    db.delete(review)  # the review is no longer in progress: the hold lifts
    db.flush()
    assert EvidenceClipService(db).enforce_retention(now=utcnow())["expired"] == 1
    clip = clip_row(db, clip_id)
    assert clip.status is EvidenceClipStatus.EXPIRED and clip.expired_at is not None and clip.sha256
    with pytest.raises(ObjectMissing):
        store.get(key)
    expired = audits(db, AuditAction.EVIDENCE_CLIP_EXPIRED)
    assert len(expired) == 1 and expired[0].actor_id is None  # the system's own action
    assert (
        client.get(f"{CLIPS.format(active['attempt']['id'])}/{clip_id}/media", headers=admin).status_code
        == 410
    )


def test_maintenance_fails_clips_whose_upload_never_came(client, db, active):
    clip_id = started(client, active)["clip_request"]["clip_id"]
    age(db, clip_id, 3600)
    result = run_maintenance(db)
    assert result["failed"] == 1
    clip = clip_row(db, clip_id)
    assert clip.status is EvidenceClipStatus.FAILED and clip.failure_reason == "upload_missing"
    failed = audits(db, AuditAction.EVIDENCE_CLIP_FAILED)
    assert failed and failed[-1].actor_id is None


# -- what the candidate is told --------------------------------------------------------------------------


def test_the_candidate_sees_the_evidence_policy_before_and_during_the_exam(client, active):
    detail = client.get(f"{ME}/assessments/{active['exam']['id']}", headers=active["headers"]).json()
    policy = detail["recording"]
    settings = get_settings()
    assert policy["enabled"] is True and policy["retention_days"] == settings.evidence_retention_days
    assert (
        policy["pre_seconds"] == settings.evidence_pre_seconds
        and "FACE_NOT_DETECTED" in policy["event_types"]
    )
    session = client.get(
        f"{ME}/attempts/{active['attempt']['id']}/proctoring", headers=active["headers"]
    ).json()
    assert session["recording"] == policy


# -- storage and configuration ----------------------------------------------------------------------------


def test_storage_keys_are_unpredictable_and_strictly_shaped(tmp_path: Path):
    keys = {new_key() for _ in range(200)}
    assert len(keys) == 200
    for key in keys:
        check_key(key)
    local = LocalEvidenceStorage(tmp_path)
    for bad in [
        "../x.webm",
        "clips/../../etc/passwd",
        "clips/a.webm",
        "/abs/path.webm",
        "clips/" + "a" * 43 + ".exe",
    ]:
        with pytest.raises(StorageError):
            local.put(bad, b"x", "video/webm")
    key = new_key()
    local.put(key, b"data", "video/webm")
    with pytest.raises(StorageError):
        local.put(key, b"other", "video/webm")  # never overwritten


def test_supabase_storage_uses_the_private_api_and_never_leaks_its_key():
    calls = []

    def transport(method, url, headers, body, timeout):
        calls.append((method, url, headers, body))
        if method == "GET" and "missing" in url:
            return 404, b""
        if method == "POST" and len(calls) > 3:
            return 500, b""
        return (200, b"video") if method == "GET" else (200, b"{}")

    secret = "service-role-secret-value"  # noqa: S105 — a test value
    store = SupabaseEvidenceStorage("https://proj.supabase.co", secret, "assessx-evidence", transport)
    key = new_key()
    store.put(key, b"v", "video/webm")
    assert store.get(key) == b"video"
    store.delete(key)
    (put_method, put_url, put_headers, _), (_, get_url, _, _), (del_method, del_url, _, _) = calls
    assert (
        put_method == "POST"
        and put_url == f"https://proj.supabase.co/storage/v1/object/assessx-evidence/{key}"
    )
    assert get_url == f"https://proj.supabase.co/storage/v1/object/authenticated/assessx-evidence/{key}"
    assert del_method == "DELETE" and del_url.endswith(key)
    assert put_headers["x-upsert"] == "false"
    try:
        store.put(new_key(), b"v", "video/webm")
    except StorageError as error:
        assert secret not in str(error) and "storage" in str(error)
    with pytest.raises(StorageError):
        SupabaseEvidenceStorage("http://insecure", secret, "b", transport)


def test_production_refuses_unsafe_evidence_configuration():
    base = {"app_env": "production", "secret_key": "s" * 48, "cors_origins": ["https://app"]}
    with pytest.raises(ValueError, match="EVIDENCE_STORAGE_BACKEND=supabase"):
        Settings(**base, evidence_clips_enabled=True)
    with pytest.raises(ValueError, match="SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"):
        Settings(**base, evidence_storage_backend="supabase")
    assert Settings(**base).evidence_enabled is False  # off in production unless switched on
    with pytest.raises(ValueError, match="unknown event types"):
        Settings(evidence_event_types=["NOT_AN_EVENT"])
    with pytest.raises(ValueError, match="2 x PRE"):
        Settings(evidence_pre_seconds=15, evidence_post_seconds=20, evidence_max_clip_seconds=30)


def test_webm_sniffing():
    assert looks_like_webm(WEBM)
    assert not looks_like_webm(b"\x00\x00\x00\x18ftypmp42")
    assert not looks_like_webm(b"\x1a\x45\xdf\xa3" + b"matroska" + b"\0" * 60)
