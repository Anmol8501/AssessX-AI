# Phase 5C — AI Event Integration & Real-time Proctoring

**Status:** **Implemented (2026-09-30)**, on top of Phase 5A ([PHASE-5A-AI-FOUNDATION.md](PHASE-5A-AI-FOUNDATION.md))
and Phase 5B ([PHASE-5B-AI-DETECTORS.md](PHASE-5B-AI-DETECTORS.md)). Phase 5C turns the on-device
AI's per-frame observations into **stable, factual proctoring events**, stores them in the existing
Phase 4B event log, and shows them live in Phase 4C admin monitoring.

**Phase 5C does not determine whether a candidate cheated.** An AI event records what the camera
image showed, when, and for how long: "no face was detected for 12 s", "two faces were detected",
"the head was turned left". It carries no score, risk level, severity, probability or verdict, and
no such field is accepted anywhere. Interpreting events (correlation, risk, evidence, human review)
belongs to a later phase and has **not** been started.

**Calibration revision (2026-09-30).** A guided real-webcam session (see "Webcam validation"
below) showed several provisional values did not fit real measurements. Approved changes, applied:
`FACE_NOT_DETECTED` needs 3 frames (was 5); head orientation is measured against the candidate's own
calibrated neutral yaw (18° deviation) instead of an absolute 25° yaw / 20° pitch; looking down is not
an event; `GAZE_AWAY` is **disabled**; `FACE_TOO_FAR` is 0.03 (was 0.015). All values remain
provisional — this is calibration, not validation.

**Phone detection is not an event.** Phase 5B found no defensible phone threshold (see
[PHASE-5B-OBJECT-MODEL-EVALUATION.md](PHASE-5B-OBJECT-MODEL-EVALUATION.md)). There is no
`PHONE_DETECTED` event type, object-detection output is ignored by the event processor, and the
server rejects a phone event. No threshold was chosen and the object detector was not changed.

> **Numbering note.** The product owner calls this "Phase 5"; the roadmap numbers AI Proctoring as
> Phase 6. Recorded, not reconciled — see `PHASE-5-PLAN.md`.

## Architecture

```
camera ─▶ FrameScheduler ─▶ MediaPipe runtime (worker) ─▶ 5B detectors ─▶ observations (per frame)
                                                                              │
                                   AIPipeline.subscribeFrames ◀───────────────┘
                                              │
           ┌──────────────── AIEventProcessor (apps/desktop/src/features/proctoring/ai/events/) ───┐
           │ readConditions  → present / absent / unknown per condition                           │
           │ ConditionStabilizer → debounce, min frames, clear delay, cooldown, unknown timeout    │
           │ episode lifecycle → one `started` + one `resolved` event per episode                 │
           │ AI_STATUS reporter → health changes only, after they hold                            │
           └──────────────────────────────┬───────────────────────────────────────────────────────┘
                                          │ useEventReporter.report()  (Phase 4B queue: ordered,
                                          ▼                              persisted, retried, idempotent)
            POST /api/v1/candidates/me/attempts/{id}/proctoring/events
                                          │
             ProctoringEventService (validates, owns time/category/source, keeps the lifecycle honest)
                                          │
                              proctoring_events (existing table)
                                          │
            notify.event_recorded + notify.session_changed  (existing Phase 4C hub)
                                          ▼
            Admin wall tile (AI status, ongoing count) · Candidate detail → "AI Monitoring" section
```

* **Centralised.** Detectors remain pure normalisers (5B). The only place observations become events
  is `AIEventProcessor`, fed by a new `AIPipeline.subscribeFrames` hook.
* **Reused, not parallel.** No new table, service, queue or realtime channel. Migration `0013` only
  widens the two CHECK constraints of `proctoring_events`. No Redis / Celery / Kafka / RabbitMQ /
  microservice / cloud inference was added.
* **Privacy unchanged.** Frames are still released after inference. Events carry only small
  numeric measurements (a count, angles in degrees, gaze summaries, luminance, face-area ratio,
  the model's own detection confidence). No image, crop, landmark, embedding or identity is stored
  or sent.

## Event taxonomy

Two new categories, kept apart so a technical failure is never read as something about the candidate:

| Category | Event type | Measured from (5B) | Metadata (besides the episode fields) |
|---|---|---|---|
| `AI_OBSERVATION` | `FACE_NOT_DETECTED` | face presence: `faceCount == 0` | — |
| `AI_OBSERVATION` | `MULTIPLE_FACES_DETECTED` | face presence: `faceCount ≥ 2` | `face_count`, `confidence` (model) |
| `AI_OBSERVATION` | `HEAD_ORIENTATION_CHANGED` | head pose yaw, relative to the candidate's calibrated neutral | `direction` (left/right), `yaw_deg`, `neutral_yaw_deg`, `pitch_deg` (factual only) |
| `AI_OBSERVATION` | `GAZE_AWAY` | **disabled** — never produced; the server refuses a new one | (earlier rows only) |
| `AI_OBSERVATION` | `CAMERA_TOO_DARK` | frame quality mean luminance | `mean_luminance` |
| `AI_OBSERVATION` | `FACE_TOO_FAR` | frame quality face-area ratio | `face_area_ratio` |
| `AI_OBSERVATION` | `FACE_TOO_CLOSE` | frame quality face-area ratio | `face_area_ratio` |
| `AI_HEALTH` | `AI_STATUS` | pipeline health | `ai_status`, `ai_reason`, `impaired`, `accelerator` |

Episode fields on every AI observation row: `phase` (`started`/`resolved`), `episode_id` (UUID),
`detector`, and on resolution `resolution` and the server-computed `duration_ms`.

**Not produced**, because the observations cannot support them honestly: a blocked camera, a
partially visible face, generic "poor frame quality", any phone/object event, looking down (pitch),
and gaze away (`GAZE_AWAY` — disabled, see below). The first three
would need a new measurement or a validated rule; they are listed under open items.

Direction conventions (measured in 5B): `left`/`right` are the candidate's own left/right, measured
as the sign of the deviation from the candidate's neutral yaw.

### Neutral head calibration

A fixed yaw limit judges the camera's position as much as the head: in the webcam session the
participant's "looking at the screen" yaw sat anywhere between −3° and −12°. So each monitoring run
calibrates the candidate's **neutral yaw** (`ai/events/headCalibration.ts`, `HeadCalibrator`):

1. Only usable frames count — exactly one face and a finite head-pose yaw within ±40°. Any other
   frame (no face, several faces, landmarker failure, implausible yaw) **breaks the run**; unknown
   data never contributes.
2. The neutral is the median of the first run of **5 consecutive** usable yaws whose spread
   (max − min) is **≤ 8°**; a run that is too spread out slides forward, so an outlier or a candidate
   still settling is never locked in (at ~1.2 frames/s this takes ~4 s of sitting still).
3. Once set, the neutral is **fixed** for the rest of the run — it never drifts, including during a
   long head turn, so a turn can never become the new "normal". A restarted app recalibrates.
4. Until calibrated, head orientation is `unknown` (no event can start).
5. A head is turned when `|yaw − neutral| > 18°`, then the usual stabilisation applies. There is no
   absolute yaw limit. Pitch never makes the condition present.

The event records `neutral_yaw_deg`, so a reviewer can see what the turn was measured from. The
processor exposes its calibration state through `diagnostics()` (mirrored to the test seam as
`eventDiagnostics`, and shown live in the webcam session panel).

### GAZE_AWAY disabled

The gaze summaries did not follow an eyes-only look in the webcam session (eyes-left gave a median of
−0.05 — the wrong sign — against a 0.35 threshold), so gaze is not a usable event signal:

* The desktop processor never produces it: `DISABLED_EVENT_TYPES` (not part of the configurable
  `AIEventConfig`, so no override can re-enable it) removes it from `PRODUCED_EVENT_TYPES`, and no
  stabiliser exists for it.
* The server refuses a new `GAZE_AWAY` start (`DISABLED_EPISODE_TYPES`, 422). The type stays in the
  taxonomy so earlier rows remain valid, and an episode left open by an earlier build can still be
  resolved or is closed at session end.
* The admin state reports `gaze: "not_used"`, and the admin UI shows no gaze indicator.
* The gaze detector and its observations are unchanged — available for diagnostics and a future
  validation.

## Lifecycle: DETECTED → ONGOING → RESOLVED

An episode is **two rows**, never one per frame. This follows the existing convention of
`FOCUS_LOST` → `FOCUS_REGAINED` with `duration_ms`.

* **Detected**: the condition held long enough, so the client reports `phase: started` with a new
  `episode_id`.
* **Ongoing**: this is not stored as rows. An episode is ongoing while it is started and not yet
  resolved. The server derives it for the admin view (`ai.active`, with `started_at`).
* **Resolved**: the client reports `phase: resolved` with the same `episode_id` and one of these
  resolutions:
  * `condition_cleared`: the condition stopped holding;
  * `measurement_unavailable`: the condition could not be measured for too long;
  * `monitoring_stopped`: the exam view closed, or a restarted app is closing an earlier run's episode.

The server resolves episodes itself in two cases:

* `superseded`: a new episode of the same type starts while an older one is still open, which
  happens when the app restarted without closing it.
* `session_ended`: the session ends (on submit or timeout). This resolution is recorded at the
  session's end instant, the same server time as `SESSION_ENDED`.

**Server rules.** The candidate app cannot bend the lifecycle:

* A `started` row must use a new episode id.
* A `resolved` row must match an **open** episode of the same type **in the same session**.
* A client may not send `duration_ms`. The server computes it from its own `recorded_at` times.
* A client may not use the resolutions `superseded` or `session_ended`, or any unknown resolution.
* A client may not set category, source or time. Phase 4B already enforced this.
* Every metadata field is on a per-type allow-list and range-checked. There is no field for a
  score, risk, verdict, image or embedding, so none can be accepted.
* Another candidate gets `404` on this attempt.
* After the attempt ends, events are refused.

## Temporal stabilisation

All values are in `ai/events/config.ts` (`DEFAULT_AI_EVENT_CONFIG`).

**Every value is provisional.** The PRD, TRD and KB require smoothing but specify no durations or
limits. These values are not validated product decisions, and they must be validated on
representative data before anyone relies on them.

| Parameter | Default | Meaning |
|---|---|---|
| `startAfterMs` / `minFrames` | 3 s / **3** frames (face absent; was 5); 3 s / 5 (head); 2 s / 4 (multiple faces); 5 s / 6 (dark, too far/close) | The condition must hold for at least this long, over at least this many frames |
| `resolveAfterMs` / `minClearFrames` | 2 s / 3 frames | The condition must be clear for this long before the episode resolves |
| `cooldownMs` | 3 s | After a resolution, no new episode of that type can start for this long |
| `unknownResolveMs` | 5 s | An open episode that cannot be measured for this long resolves as `measurement_unavailable` |
| `frameStaleMs` | 3 s | No processed frame for this long means every condition is treated as unknown |
| `statusStableMs` | 3 s | An AI health change is reported only after it has held for this long |

| Threshold | Default | Note |
|---|---|---|
| Head yaw deviation from the calibrated neutral | 18° (was an absolute 25° yaw / 20° pitch) | Deliberate turns measured ~20–30° from a neutral of −3° to −12° |
| Head calibration | 5 consecutive samples, spread ≤ 8°, \|yaw\| ≤ 40° | See "Neutral head calibration" |
| Gaze | — | `GAZE_AWAY` disabled; the 0.35 limits remain only for the diagnostic reading |
| Dark luminance | < 0.10 | Mean relative luminance, on a 0–1 scale |
| Face too far / too close | area < **0.03** (was 0.015) / > 0.35 | Largest face box as a fraction of the frame; moving far back still measured ≥ 0.049 |

**Unknown is never absent.** If a detector produced nothing usable for a frame, its conditions are
`unknown`. This happens when its model failed or was skipped, or when there is no face for head,
gaze or face size. An unknown reading never starts an episode and never counts as the condition
clearing. For example, when the face disappears, head and gaze become unknown; they are not reported
as "forward". And when the AI fails, it produces no `FACE_NOT_DETECTED` episode.

## AI health (`AI_STATUS`)

`ai_status` is one of `INITIALIZING`, `RUNNING`, `DEGRADED`, `ERROR` or `STOPPED`. It comes with an
`ai_reason`:

* `none`
* `no_runtime`
* `model_load_failed`
* `runtime_error`
* `camera_unavailable`
* `detector_impaired`, together with `impaired` naming the affected detectors
* `inference_slow`
* `stopped`

The reason is derived from structured health inputs, never parsed from text.

How status is reported:

* A change is reported only after it has held for `statusStableMs`. A borderline latency therefore
  cannot flood the log.
* `STOPPED` is reported only if a status was reported before it. React StrictMode's development
  remount therefore leaves no trace.

The server derives the admin state from these rows using a pure function, `derive_ai_state`, so
REST and realtime always agree:

* An observation indicator is `unknown` unless the AI is `RUNNING` or `DEGRADED` and that
  detector is not impaired.
* A failed AI shows **Unknown**, never a normal-looking candidate.

## Admin monitoring

* **Wall tile:** two new indicators, `AI` (status) and `AI observations` (the number of ongoing
  episodes).
* **Candidate detail → "AI Monitoring":**
  * the AI status badge and its reason;
  * the indicators (Face, Faces, Head, Camera image), each `Unknown` when not measured; there is no
    gaze indicator, and the note says gaze is not used;
  * the ongoing observations, each with its start time and a live duration;
  * this note: *"Factual on-device camera observations with provisional thresholds. They do not
    determine whether a candidate cheated."*
* **Timeline:** entries read like "Face not detected — started" and "Face not detected — ended
  (after 12s, cleared)".
* **Live updates:** each AI event triggers the existing `PROCTORING_EVENT` and `SESSION_UPDATED`
  deltas, so the tile and the detail view update live without a new realtime path.

Also fixed: a pre-existing Phase 4C race could list one event twice. It happened when a
`PROCTORING_EVENT` delta arrived after the REST snapshot that already contained it. The higher event
rate of 5C made this visible. Such deltas are now skipped.

## Files

**Backend**
- `app/models/proctoring_event.py`: 8 event types and 2 categories.
- `alembic/versions/0013_ai_proctoring_events.py`: widens the CHECK constraints. Downgrade deletes
  only the AI rows.
- `app/services/proctoring_events.py`:
  - the episode validation and lifecycle;
  - `close_open_episodes`;
  - `open_episodes`, which does not depend on row order.
- `app/services/proctoring.py`: closes open episodes at session end.
- `app/repositories/monitoring.py` (`ai_events`), `app/schemas/monitoring.py` (`AIMonitoringState`),
  `app/services/monitoring.py` (`derive_ai_state`, `ai` on every tile and detail).

**Desktop**
- `ai/events/`: `config.ts`, `conditions.ts`, `headCalibration.ts`, `stabilizer.ts`, `status.ts`,
  `processor.ts`.
- `ai/pipeline.ts`: `subscribeFrames`.
- `ai/useAIPipeline.ts`:
  - runs the processor when given `report`;
  - persists open episode ids so a restarted app closes its leftovers.
- `ProctoredExam.tsx`: passes the reporter.
- `environment/useEventReporter.ts`: metadata may now contain a string list.
- `ai/seam.ts` and `ai/testRuntime.ts`:
  - `scene` and `ScriptedMediaPipeRuntime` (**test only**; not reachable in the packaged app);
  - `events` overrides for fast tests.
- `admin/monitoring/`: `types.ts` (`ai`), `ai.ts` (neutral labels), `AIMonitoringSection.tsx`,
  `events.ts`, `CandidateDetailView.tsx`, `CandidateMonitoringTile.tsx`.

## Tests

| Suite | What it covers |
|---|---|
| `backend/tests/test_ai_events.py` (67) | Lifecycle and server-computed duration; every type; reuse, mismatch and double-resolve rejection; malformed rows; client durations and server-only resolutions refused; range checks; `superseded`; `session_ended` at session end; AI_STATUS validation; no phone or verdict types; no score, image or embedding fields; forged category, source and time; cross-candidate and cross-session refusal; `derive_ai_state` (unknown handling, impaired detectors, equal timestamps); tile and detail `ai`; admin-only; realtime deltas; REST and delta agreement |
| `ai/__tests__/events.test.ts` (61) | Normaliser, including unknown ≠ absent and phone output ignored; stabiliser (spike, flicker, duration and frame count, cooldown, brief clear, unknown timeout); status mapping; processor (one start and one resolve, independent conditions, stale frames, stop, status debounce, StrictMode, leftovers, no forbidden words); real 5B detectors driven by a scripted runtime |
| `e2e/ai-events.spec.ts` (7) | Face leaves and returns as one episode with a server duration; admin AI section updates live (multiple faces, head turn, dark, then clear) and the tile indicators; AI failure gives ERROR, `measurement_unavailable` and Unknown, with no false "no face"; submit gives `session_ended`; API forgery attempts are refused; the **real MediaPipe** model on an empty camera gives exactly one `FACE_NOT_DETECTED` episode and no phone event |

The Phase 4 E2E specs assert exact sequences of their own events. The shared `recordedEvents` helper
therefore leaves out the AI categories unless called with `{ ai: true }`.

## Known limitations

- **Thresholds and timings are provisional.** They must be validated on representative webcam data,
  across lighting, skin tones, glasses and camera positions, before anyone relies on them.
- **Gaze is disabled.** `GAZE_AWAY` produces nothing until gaze is validated.
- **Head calibration assumes the candidate starts by looking at the screen.** If they are turned away
  (and still) for the first seconds, that becomes their neutral. The neutral is fixed for the run and
  is not recalibrated if the camera or seating changes mid-exam; a restarted app recalibrates.
  Until calibration succeeds, head orientation is unknown on the desktop, while the admin state (which
  does not know the calibration status) shows "Forward" when no head episode is open.
- **Server time is delivery time.** The server stamps `recorded_at` on arrival (the Phase 4B policy).
  Events queued while offline are recorded when delivered, so a duration can be shorter than the
  real episode. `client_reported_at` is kept as a hint.
- **Per-type episodes only.** One open episode per type. A head that turns from left to right stays
  in one episode, which keeps its starting direction.
- **The admin AI state is derived from all of a session's AI rows on each tile build.** This is
  bounded by the 5000-event ceiling. Two rows per episode keep it small, but it has not been load-tested.
- **Restart recovery is best-effort.** Open episode ids are kept in `localStorage`. If that is lost,
  the server still closes them as `superseded` or `session_ended`.

## Webcam validation

`apps/desktop/benchmarks/webcam/events-session.spec.ts` runs a guided session on a real webcam with
the shipped settings (`npx playwright test --config benchmarks/webcam/playwright.config.ts
events-session`). It records only numbers — per step: the events the server recorded and when, the
detectors' raw measurements, and the yaw deviation from the calibrated neutral — to the git-ignored
`benchmarks/.cache/webcam/`.

**Session 1 (2026-09-30, original settings; one participant, one laptop webcam, one room):** no false
events while sitting normally, during quick glances or a 1 s dip out of view; face absence and face
too close became single episodes that resolved ~2 s after the condition cleared. But the real sample
rate was ~1.2 frames/s, so `FACE_NOT_DETECTED`'s 5-frame requirement delayed it to ~5 s after leaving;
head turns (~20–30°) never passed the absolute 25°, the neutral varied from −3° to −12°; looking down
sat exactly on the 20° pitch line; eyes-only gaze did not move the gaze signal; `FACE_TOO_FAR` (0.015)
was unreachable (≥ 0.049); a covered lens was caught as `FACE_NOT_DETECTED`, not `CAMERA_TOO_DARK`
(auto-exposure). These findings led to the calibration revision above. Multiple faces were not tested.
The revised settings have not yet been re-run on a real webcam.

## Open items (flagged, not resolved)

1. **Thresholds and durations.** None are specified by the PRD, TRD or KB. One webcam session led to
   a calibration revision; representative validation (more people, cameras, lighting) is still needed.
2. **Gaze** — disabled; re-enabling needs a validated gaze signal and threshold.
3. **Camera blocked / darkness** — a covered lens is not reliably dark (auto-exposure); no darkness
   threshold change was made.
4. **Phone detection** remains blocked by validation (5B). There is no event and no threshold.
5. **Unsupported conditions:** camera blocked, face partially visible, generic poor frame quality.
   Each needs a documented rule or a new measurement.
6. **Phase numbering** (5 vs 6), as in `PHASE-5-PLAN.md`.
7. **Risk, evidence and review** are a later phase and have not been started.
