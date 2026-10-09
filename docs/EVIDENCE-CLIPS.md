# Evidence clips (PRD FR-017)

**Status:** implemented locally, not deployed. Off in production until an operator configures private
storage and switches it on (see "Production setup").

**A clip is supporting context, not a verdict.** AssessX records a short camera clip around certain
factual events so that a human reviewer can see the moment. The event says what was observed, the clip
shows it, and a person decides what it means. No screen, label or API calls a clip proof of anything.

```
camera ──▶ live proctoring (WebRTC, unchanged) and on-device AI (5B), unchanged
   │                     │
   │                     ▼
   │        factual event, after 5C's stabilisation ──▶ server records it
   │                                                         │
   ▼                                                         ▼
rolling buffer (app) ◀── "upload clip X" ◀── evidence policy: eligible? linked? cooldown? cap?
   │
   ▼  pre-event seconds + event + post-event seconds, one WebM, video only
upload ──▶ validated, SHA-256, private storage ──▶ READY ──▶ admin review (video via the API only)
                                                    │
                                                    ▼  retention period
                                                 EXPIRED (video deleted, record kept)
```

## What is recorded, and why

| Recorded | Not recorded |
|---|---|
| Short clips from the **primary webcam**, video only, around qualifying events | Audio, ever |
| The clip's metadata: candidate, assessment, attempt, session, events, camera, times, size, SHA-256, lifecycle | Continuous video, the screen, frames outside a clip |
| Audit rows for every lifecycle step and every view | Face recognition, identity embeddings, biometric templates |

Clips exist to give the reviewer of a **factual event** the context of that moment (PRD FR-017, KB §22).
Their purpose is that review and nothing else, and they are deleted when the retention period ends.

**The candidate is told before the exam starts.** The proctoring check builds its text from the server's
policy, so it always matches what is done:
* the microphone is never recorded;
* the camera is not recorded continuously;
* which moments produce a clip, and how many seconds before and after;
* that a person reviews each clip;
* how long clips are kept.

With clips switched off, the original "nothing is recorded" statement is shown.

## The event → clip policy (server-side)

The server alone decides whether an event gets a clip (`app/services/evidence_clips/service.py`). An
event qualifies only if **all** of these are true:

1. Clips are enabled. The setting `EVIDENCE_CLIPS_ENABLED` defaults to on outside production and off in
   production.
2. The event is an AI observation **start** (`phase: started`) of an allow-listed type
   (`EVIDENCE_EVENT_TYPES`):
   * face not detected, multiple faces, head turned away;
   * face too far or too close, upper body not visible;
   * phone, book, laptop or handheld device detected.

   Resolutions, health statuses, `CAMERA_TOO_DARK` (the video would be dark) and every non-AI event
   (focus, clipboard and so on) never qualify.
3. The event passed Phase 5C's temporal stabilisation. Flickers never become events, so they never
   become clips.
4. The session is active, and the candidate's app said at activation that it can record
   (`evidence_recorder`). An older app is never asked for a clip it cannot make.

**Deduplication and cooldown:**
* An event that falls inside a clip still being captured is **linked to that clip**. Three related
  events within one window produce one clip, which lists all three.
* After that, no new clip starts within `EVIDENCE_COOLDOWN_SECONDS` (default 30 s) of the previous one.
* At most `EVIDENCE_MAX_CLIPS_PER_SESSION` (default 20) clips are made per session.

An event that gets no clip still stands, and is reviewed as before.

## The rolling buffer (desktop app)

`apps/desktop/src/features/proctoring/evidence/`.

* **What it records.** A *clone* of the camera's video track, scaled to at most
  `EVIDENCE_MAX_WIDTH`×`HEIGHT` (640×360) and `EVIDENCE_FRAME_RATE` (10 fps), encoded by the browser's
  `MediaRecorder` as WebM (VP8) at `EVIDENCE_VIDEO_BITS_PER_SECOND` (250 kbit/s). The original track (live
  view, AI) is never touched.
* **Overlapping segments.** A WebM stream can only be played from its start, so the last N seconds can't
  be cut out of one long recording. Instead a new, self-contained recorder starts every `pre_seconds`.
  * On an event, the newest segment that began at least `pre_seconds` earlier keeps recording until
    `post_seconds` after the event, and becomes the clip.
  * The clip therefore holds between `pre` and `2 × pre` seconds before the event, plus `post` seconds
    after. With the defaults (5 s and 10 s) that is 15–20 s; measured clips in the e2e run were 18.7 s.
* **Bounded.**
  * About 3 segments exist at once, in memory only, and nothing is written to disk.
  * A segment is dropped as soon as it is too old to be a pre-event buffer.
  * A segment that reaches the byte ceiling is cut short.
  * At most 4 captures wait for the server's answer, and only for `post + 120` seconds.
* **The server decides; the app records.**
  * The capture starts when the event is observed, because the pre-event seconds only live in the buffer
    for a few seconds.
  * When the server's answer for that event arrives (`clip_request` in the event response), the capture
    is uploaded to *the clip id the server chose*, or discarded.
* **When the exam ends** (submission, time up, sign-out) the recorder stops.
  * A capture in progress is finished with what it has and may still be uploaded before its deadline.
  * No new capture can start. The server also refuses events, and therefore new clips, after the attempt
    ends.

## Storage

`app/services/evidence_clips/storage.py`: one small interface (`put`, `get`, `delete`), two backends.

| Backend | Use | Notes |
|---|---|---|
| `local` (default) | development and tests | Files under `EVIDENCE_LOCAL_DIR` (`backend/var/evidence`, git-ignored), written atomically and never overwritten. **Refused in production**: Render's disk is wiped on every deploy |
| `supabase` | production | A **private** Supabase Storage bucket, reached by the API alone with the service-role key over Supabase's REST API. No SDK, no new dependency |

* **Object names** are `clips/<256 random bits>.webm`, generated by the server. They are never derived
  from ids or anything a client sent, and every backend refuses any other shape, so no path can escape
  the bucket.
* **No storage location ever leaves the API.** Not the key, URL, bucket or a signed link, not even to
  administrators. An administrator's app asks the API for the video; the API checks who is asking,
  re-verifies the hash, records the view and returns the bytes with `Cache-Control: no-store`. The app
  plays them from memory (`blob:`) and releases them when the panel closes. Clips are at most 1.5 MB, so
  streaming through the API costs little; signed URLs would be needed only for much larger media.
* The desktop CSP gained `media-src 'self' blob:` for that player, and nothing else.

## Security model

| Threat | Control | Test |
|---|---|---|
| A candidate reads evidence | Every admin route is `AdminUser` (candidates 403, anonymous 401). Candidate responses carry only their own clip *request* and the recording policy, never evidence data | `test_candidates_never_reach_admin_evidence_routes`, the 6B `test_candidate_endpoints_never_expose_evidence`, e2e |
| Candidate A touches B's clip | Upload and failure routes resolve the attempt from the signed-in candidate (`get_attempt`), then the clip *within that attempt* (404 otherwise) | `test_another_candidate_can_never_upload_to_or_fail_a_clip` |
| Cross-attempt IDOR (admin) | Every admin route is attempt-scoped: a clip id from another attempt is 404 | `test_admins_reach_a_clip_only_through_its_own_attempt` |
| A client chooses ids or paths | The server creates every clip, derives candidate, assessment, attempt and session, links events, generates the storage key and computes the hash. Request bodies are bytes plus a bounded duration; failure reports are a closed list (`extra=forbid`) | ownership test, `test_storage_keys_are_unpredictable_and_strictly_shaped` |
| Oversized or hostile uploads | Global 2 MiB request limit, then a streamed per-clip ceiling (`EVIDENCE_MAX_CLIP_BYTES`, 1.5 MB); `Content-Type: video/webm` only; EBML/WebM magic check; one successful upload per clip, at most 3 attempts; an upload deadline | `test_upload_validation`, `test_an_oversized_upload_is_refused`, `test_a_clip_is_uploaded_once`, deadline test |
| Flooding | Clips only for stabilised, allow-listed events; cooldown; per-session cap; the existing per-session event ceiling | `test_cooldown_and_the_per_session_cap` |
| Bulk viewing (an admin account misused) | Evidence-media views are rate-limited per admin (`EVIDENCE_VIEWS_PER_HOUR`, 120); a refusal is a HIGH security event and alert (Phase 8 final) | `test_evidence_views_are_rate_limited_per_admin` |
| Tampering in storage | SHA-256 taken by the server on upload and checked again on every view; a mismatch or missing object refuses the view and is audited | `test_a_tampered_or_missing_video_fails_its_integrity_check` |
| Deleted or expired evidence | 410 `evidence_unavailable`; the record stays | delete and retention tests |
| Database exposure | Both new tables have RLS and the least-privilege runtime policy (Phase 8B); the video is never in the database | `test_every_table_has_rls_and_the_runtime_policy` |
| Leaking secrets | The service-role key is server-only (`SecretStr`). Storage errors carry no key, URL or object name. Logs carry clip ids, sizes and timings only | Supabase transport test |

**Admin scope** is single-tenant, as for results, monitoring and review: any administrator may review any
attempt's clips (finding AX-16). Narrowing this needs per-assessment ownership, which the product doesn't
have yet.

## Lifecycle, failure handling and audit

| Status | Meaning | How it ends |
|---|---|---|
| `CREATING` | the server accepted an event and waits for the recording | `READY`, or `FAILED` |
| `READY` | stored and hashed; viewable by administrators | `EXPIRED` (retention) or `DELETED` (admin) |
| `FAILED` | no video. Reasons: `upload_missing` (deadline passed), `recorder_unavailable`, `recording_failed`, `capture_interrupted`, `too_large`, `upload_failed`, `invalid_content`, `storage_error` | final |
| `EXPIRED` | the retention period ended: video deleted, record kept | final |
| `DELETED` | an administrator deleted the video, with a reason: record kept | final |

**Evidence never breaks an exam.**
* The event is recorded first; the clip decision runs after it in a savepoint, and its failure is logged
  and ignored.
* Upload failures are retried at most twice (after 2 s and 5 s). Storage errors give a 503, and the clip
  is marked `FAILED` after 3 attempts.
* A clip the app never sends is swept to `FAILED` after its deadline (window end + 120 s).
* The e2e suite proves an exam whose every upload is dropped carries on and submits normally, with the
  clip recorded as `FAILED: upload_failed`.

**Audit** (`audit_logs`, append-only), with ids only and never video, keys or URLs:
* `EVIDENCE_CLIP_CREATED`, `_READY` and `_FAILED`: actor is the candidate, or none for the deadline sweep;
* `_VIEWED`, `_VERIFIED`, `_INTEGRITY_FAILED` and `_DELETED`: actor is the administrator;
* `_EXPIRED`: no actor, because the system acts.

## Integrity

* On upload the server computes SHA-256 over the exact bytes it stores, and records `hash_algorithm`,
  `sha256`, `byte_size` and `ready_at`. A hash sent by the app is never accepted (none is asked for).
* `GET …/media` re-reads the object and compares hashes with `hmac.compare_digest` before returning
  anything.
* `GET …/integrity` returns expected and actual hash and size, plus `verified`, and is audited.
* A changed or missing object fails both checks (tested by altering one byte, and by deleting the file).
* This protects against changes in storage. It doesn't make the database row tamper-evident against the
  database owner; that is the open audit decision OQ-12.

## Retention

* `READY` clips are kept for `EVIDENCE_RETENTION_DAYS` (default 30, allowed 1–365), counted from
  `ready_at`. Only the server's configuration sets it; there is no API to change it.
* When the period ends, the video is deleted and the clip becomes `EXPIRED`. Its metadata and audit trail
  remain.
* **Review hold:** a clip whose attempt has a Phase 6C review `IN_REVIEW` is not deleted until the review
  completes.
* **Where it runs:** every `EVIDENCE_MAINTENANCE_INTERVAL_MINUTES` (60) inside the API, in a worker thread,
  and on demand with `python -m app.cli evidence-maintenance`.
* **Scheduling:** an hourly GitHub Actions job calls the token-protected maintenance endpoint (`docs/SECURITY-OPERATIONS.md`), so retention does not depend on the API being awake; the API's own hourly task and the CLI remain as fallbacks.
  Retention is therefore "at least N days", not "exactly N days". For a strict schedule, run the CLI
  command from a scheduler.

## Storage cost estimate

The upper bound per clip comes from the bitrate cap. Real webcam footage is usually below the cap; the
synthetic test camera's clips were about 12 KB.

```
size ≤ bitrate × length ÷ 8
     = 250,000 bit/s × 20 s ÷ 8 ≈ 625 KB   (≈ 470 KB for a 15 s clip)
```

| Scenario | Clips | Storage (upper bound) |
|---|---|---|
| One candidate, worst case (cap of 20 clips) | 20 | ≈ 12.5 MB |
| One exam: 50 candidates × 4 clips on average | 200 | ≈ 125 MB |
| A month: 20 such exams | 4,000 | ≈ 2.5 GB |
| Stored at any time with 30-day retention | about one month's worth | ≈ 2.5 GB |

To scale: `GB ≈ candidates × clips per candidate × kbps × seconds ÷ 8,000,000`.

* **Halving storage:** halve the bitrate (to 125 kbit/s; the picture gets softer), or shorten retention.
* **Free tier fit:** check your Supabase plan's storage and egress limits. Free plans have historically
  included only about 1 GB of storage, so the scenario above would need a paid plan, a lower bitrate,
  fewer clips or shorter retention.
* **Egress:** each administrator view also downloads one clip's size.

## Production setup (manual, operator only; nothing here is automatic)

1. **Supabase → Storage → New bucket.**
   * Name it `assessx-evidence`.
   * Leave **Public bucket OFF**.
   * Optionally set the file size limit to 2 MB and the allowed MIME types to `video/webm`.
   * **Don't add any storage policies.** Without policies, Supabase's `anon` and `authenticated` roles
     can't read or write the bucket; only the service role (the API) can.
2. **Supabase → Project Settings → API:** copy the **service_role** key. It's a secret: never put it in
   the desktop app, the repository or a chat.
3. **Render → Environment** (secrets marked *):

   | Variable | Value |
   |---|---|
   | `EVIDENCE_STORAGE_BACKEND` | `supabase` |
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` * | the service_role key |
   | `EVIDENCE_CLIPS_ENABLED` | `true` |
   | `EVIDENCE_RETENTION_DAYS` | optional (default 30) |

   A production API refuses to start with clips enabled and no private storage configured.
4. **Deploy.** Migration `0027` creates the tables, with RLS. The re-run verification queries in
   `docs/security/DATABASE-ROLES.md` §2 now expect 41 tables.
5. **Verify** with a test exam:
   * a clip appears in the review, and **View evidence** plays it;
   * a public URL for the bucket (`…/storage/v1/object/public/assessx-evidence/x`) returns an error;
   * the audit log shows `EVIDENCE_CLIP_VIEWED`.
6. **Release a desktop app with the recorder** (the next version after 0.1.3). Until candidates update,
   their apps report no recorder, so the server requests no clips from them. Nothing fails or piles up.

**To switch clips off:** set `EVIDENCE_CLIPS_ENABLED=false`. Existing clips stay viewable until they
expire. To remove every stored video immediately, delete the clips in the review (each is audited), or
empty the bucket by hand.

## Known limitations

1. **The capture is client-side.** A modified app can decline to record, record something else, or send
   an altered video. The server checks shape, size, timing and ownership, and hashes what it receives,
   but it can't prove what a camera saw. A missing clip is never evidence that nothing happened.
2. **Timing is approximate.** The window times are the server's, around its own event time. The video's
   start depends on the candidate's device and the network, typically within a second.
3. **WebM duration metadata.** `MediaRecorder` WebM files carry no total duration, so some players can't
   seek before playback. The reported `duration_ms` is the app's (bounded), and is labelled as reported.
4. **Tested with a synthetic camera only.** Chromium's real `MediaRecorder` was exercised end to end on
   the e2e synthetic camera, and the clip decoded. A real webcam inside the packaged WebView2 app hasn't
   been tested, so check that in a pilot.
5. **Supabase Storage is untested against a real project.** The REST calls are exercised with a fake
   transport.
6. **The secondary (phone) camera doesn't exist yet.** The model is source-aware (`SECONDARY_CAMERA`), so
   adding it needs no second evidence system.
7. **Retention on a sleeping free instance** runs only while the API is awake (see Retention).
8. **Admin scope is single-tenant** (AX-16).

## Configuration reference

All server-side settings live in `backend/app/core/config.py`; candidates can change none of them.

| Setting | Default | Bounds |
|---|---|---|
| `EVIDENCE_CLIPS_ENABLED` | on outside production, off in production | |
| `EVIDENCE_EVENT_TYPES` | 10 AI observation types (above) | must be known event types |
| `EVIDENCE_PRE_SECONDS` / `EVIDENCE_POST_SECONDS` | 5 / 10 | 2–15 / 2–20 |
| `EVIDENCE_MAX_CLIP_SECONDS` | 30 | 10–60, and ≥ 2 × pre + post |
| `EVIDENCE_MAX_CLIP_BYTES` | 1,500,000 | ≤ `MAX_REQUEST_BYTES` |
| `EVIDENCE_VIDEO_BITS_PER_SECOND` | 250,000 | 100,000–1,500,000 |
| `EVIDENCE_MAX_WIDTH` / `HEIGHT` / `FRAME_RATE` | 640 / 360 / 10 | |
| `EVIDENCE_COOLDOWN_SECONDS` | 30 | 0–600 |
| `EVIDENCE_MAX_CLIPS_PER_SESSION` | 20 | 1–200 |
| `EVIDENCE_UPLOAD_GRACE_SECONDS` | 120 | 30–3600 |
| `EVIDENCE_MAX_UPLOAD_ATTEMPTS` | 3 | 1–10 |
| `EVIDENCE_RETENTION_DAYS` | 30 | 1–365 |
| `EVIDENCE_MAINTENANCE_INTERVAL_MINUTES` | 60 (0 = only the CLI) | 0–1440 |
| `EVIDENCE_STORAGE_BACKEND` | `local` | `local` is refused in production when enabled |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVIDENCE_BUCKET` | none, none, `assessx-evidence` | https only in production |

## API

**Candidate** (their own attempt only):
* `POST …/proctoring/activate` gains `evidence_recorder: bool`.
* `POST …/proctoring/events` answers with `clip_request: {clip_id, upload}` or `null`.
* `PUT …/proctoring/evidence-clips/{clip_id}?duration_ms=` takes a `video/webm` body and answers
  `{clip_id, status}`.
* `POST …/proctoring/evidence-clips/{clip_id}/failure` takes `{reason}`.
* `GET` exam detail and proctoring session include `recording`: the policy, which is disclosure, not
  evidence.

**Administrator** (`/api/v1/admin/attempts/{attempt_id}/…`):
* `evidence-clips`: list with the events each clip covers;
* `evidence-clips/{clip_id}`: metadata;
* `…/media`: the video, after an integrity check (409 if not ready or failed, 410 if deleted or expired);
* `…/integrity`: expected and actual hash;
* `DELETE …/{clip_id}`: with a reason.
* The Phase 6B evidence items gain `clip` (status, camera, duration, `has_video`) for the event they
  started with.
