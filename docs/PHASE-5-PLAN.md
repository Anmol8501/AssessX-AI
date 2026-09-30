# Phase 5 — AI Proctoring (5A, 5B and 5C implemented)

**Status:** **5A implemented** (perception foundation — [PHASE-5A-AI-FOUNDATION.md](PHASE-5A-AI-FOUNDATION.md))
and **5B implemented except phone detection** (2026-09-26; on-device MediaPipe detectors for face
presence/count, tracking, head pose, gaze and frame quality, validated on a real webcam; the phone
detector is **partial — blocked by validation**, raw confidence only —
[PHASE-5B-AI-DETECTORS.md](PHASE-5B-AI-DETECTORS.md)).
**5C implemented** (2026-09-30 — [PHASE-5C-AI-EVENT-INTEGRATION.md](PHASE-5C-AI-EVENT-INTEGRATION.md)):
observations become debounced, factual episode events (started → resolved) in the existing
`proctoring_events` log, AI health is recorded separately (`AI_STATUS`), and admin monitoring shows an
"AI Monitoring" section live. Thresholds are provisional; there is no phone event, risk score or
verdict — Phase 5C does not determine whether a candidate cheated. Object
detection uses MediaPipe EfficientDet-Lite0 (cell phone only) — a product-owner decision that departs
from the documents' "YOLO" wording (open item 5).

This is the product owner's plan, recorded as given. It is **structure and scope only**: the exact
models, frame rates, resolutions, detector list and thresholds are to be finalised against a
**Phase 5 Knowledge Base** the product owner will provide, then mapped item by item into the Claude
prompts. This plan sits alongside `DEVELOPMENT-ROADMAP.md` and the earlier phase plans, and does not
replace the PRD/TRD/Master Knowledge Base, which remain the source of truth for *what* is built and
*how*. Conflicts with those documents are listed under [Open items](#open-items); they are flagged,
not resolved.

> **Numbering note.** The product owner calls this **Phase 5 — AI Proctoring**. In
> `DEVELOPMENT-ROADMAP.md` AI Proctoring is **Phase 6** (that roadmap's Phase 5 was *Live Admin
> Monitoring*, already delivered inside Phase 4 as **4C**). This divergence is recorded, not
> silently reconciled — see Open items.

## Goal

Turn AssessX from *"the system can observe technical exam conditions"* into *"the system can
automatically detect specific observable events from the candidate's camera/environment."*

```
Camera / Audio / Environment → AI Perception → Observable Detection → Factual Proctoring Event
→ Admin Monitoring → (later phase) Risk / Evidence / Human Review
```

**Phase 5 produces observations, never accusations.** It must **not** decide "candidate is
cheating", "guilty", a "cheating probability", "terminate", or any fraud verdict — those belong to
the later Risk / Evidence / Human Review phase. Phase 5 answers things like "no face detected for 8
seconds", "two faces detected", "phone-like object detected", "head orientation moved significantly
away from the screen".

---

## 5A — AI Proctoring Foundation

**Goal:** build the perception pipeline all future detectors use — not every detector yet.

- **5A.1 Camera → AI pipeline.** Today: `Candidate Camera → Proctoring Session → WebRTC → Admin
  Monitoring`. Phase 5 adds `Candidate Camera → AI Perception Pipeline → Frame Sampling → AI
  Detectors → Observable Events`. **Do not send every raw frame to the FastAPI backend.** Design
  around efficient local/native processing where appropriate; the KB determines the exact
  processing architecture.
- **5A.2 Frame sampling.** A webcam may produce ~30 FPS; AI does not run on every frame. A
  controlled inference rate (`Camera → 30 FPS → frame sampler → selected frames → AI inference`),
  with different detectors allowed different rates (face presence/count frequent; phone/head-pose
  moderate; others configurable). Exact FPS/resolution/model requirements come from the KB — nothing
  hardcoded before reviewing it.
- **5A.3 AI runtime.** A clean inference layer: model loading, lifecycle, inference, input
  preprocessing, output normalisation, error handling, performance monitoring, resource management.
  The point is to swap model A for model B later without rewriting the proctoring system.
- **5A.4 Detector interface.** A consistent `Frame → Detector → Observation`. An observation carries
  factual fields: detector, timestamp, observation type, confidence, relevant metadata — **not**
  `cheating_score` / `risk_score` / `verdict`.
- **5A.5 Candidate privacy.** An explicit decision on whether frames are stored. Default should avoid
  unnecessary storage (`frame → inference → observation → discard`), rather than storing every frame
  for later analysis, **unless the KB specifically requires evidence snapshots.** Must be defined
  before implementation.
- **5A.6 AI health monitoring.** The system knows whether AI monitoring is actually functioning
  (camera connected, pipeline running, each detector running, inference healthy). Technical states:
  `INITIALIZING`, `RUNNING`, `DEGRADED`, `ERROR`, `STOPPED`. This is technical health, not a
  cheating judgment.
- **5A.7 Performance monitoring.** Track inference latency, processing FPS, dropped frames, model
  load time, CPU/GPU/memory usage, camera availability, detector errors — especially important on a
  Windows desktop target. AI must not destroy the exam experience.
- **5A.8 Output.** By the end of 5A: `Camera → frame acquisition → sampling → AI runtime → detector
  interface → normalized observations → AI health state`. Not all detectors need to be finished.

## 5B — Core AI Detectors

Where AssessX starts understanding what is visible. Each detector is **independently testable** (no
one giant `AIProctoringFunction()`), and each provides **model confidence** (where the model
supplies it) — which is confidence in the *detection*, never "probability the candidate cheated".

- **5B.1 Face presence** — `FACE_PRESENT` / `FACE_NOT_PRESENT`, factual (detected + confidence +
  timestamp, or not detected + timestamp).
- **5B.2 Multiple-person detection** — `NO_FACE` / `ONE_FACE` / `MULTIPLE_FACES`. Say "multiple
  faces detected", never "candidate is cheating".
- **5B.3 Face tracking** — where the KB supports it, treat consecutive face frames as one continuous
  observation rather than four unrelated events (basis for later temporal reasoning).
- **5B.4 Phone / object detection** — an object detector for prohibited objects, chiefly `PHONE`
  (`PHONE_DETECTED`). Configurable so future objects (book, secondary device, reference material)
  can be added without a rewrite; implement only objects the KB explicitly supports.
- **5B.5 Head pose** — orientation `FORWARD` / `LEFT` / `RIGHT` / `UP` / `DOWN` / `UNKNOWN`. Report
  "head orientation changed significantly", not "looking at notes".
- **5B.6 Gaze / eye direction** — a separate detector from head pose (if the KB requires it):
  `GAZE_FORWARD` / `GAZE_AWAY` / `GAZE_UNKNOWN`. Gaze away ≠ cheating.
- **5B.7 Camera / environment quality** — technical input conditions: `CAMERA_BLOCKED`,
  `CAMERA_TOO_DARK`, `FACE_TOO_FAR`, `FACE_TOO_CLOSE`, `FACE_PARTIALLY_VISIBLE`, `POOR_FRAME_QUALITY`
  — only those the KB supports.
- **5B.10 Output.** `Camera → AI Runtime → {Face, Face count, Phone/Object, Head pose, Gaze,
  Environment} → normalized observations`. The exact detector list is finalised against the KB.

## 5C — AI Event Integration & Real-time Proctoring

Connects the detectors to the Phase 4A–4C system. **This is not the risk engine.**

- **5C.1 AI observation → proctoring event.** Alongside Phase 4B's factual technical events, add
  AI-generated factual events (`FACE_NOT_DETECTED`, `MULTIPLE_FACES_DETECTED`, `PHONE_DETECTED`,
  `HEAD_ORIENTATION_CHANGED`, `GAZE_AWAY` — names finalised from the KB).
- **5C.2 Temporal event handling.** Consecutive "no face" frames are one continuous observation
  (`NO_FACE_STARTED → NO_FACE_CONTINUING → NO_FACE_ENDED`), not three identical events.
- **5C.3 Debouncing.** Detectors fluctuate (phone/no-phone/phone…); apply temporal stabilisation
  (`detection → validation → persistence threshold → event`). Exact thresholds come from the
  KB/testing, not invented now.
- **5C.4 Event lifecycle.** Where useful: `DETECTED → ONGOING → RESOLVED`, with start/continue/resolve
  timestamps and a duration (e.g. multiple faces 10:32:10 → resolved 10:32:18, 8 s) — far more useful
  than hundreds of individual detections.
- **5C.5 Existing event-store integration.** Reuse the Phase 4B/4B.5 `proctoring_events` architecture
  (`AI detector → observation → AI event processor → existing event system → PostgreSQL → realtime
  hub → admin monitoring`). **No parallel event database** unless the KB explicitly requires it.
- **5C.6 Admin live monitoring integration.** Extend Phase 4C so the admin can see factual AI
  indicators (Face: Detected, Faces: 1, Phone: Not detected) and AI events in the timeline — never a
  "🔴 CHEATING" badge.
- **5C.7 Admin detail panel.** Add an "AI Monitoring" section to the Phase 4C candidate detail view:
  pipeline/detector health, current observations (face present, count, phone, head orientation), and
  recent AI events — observation, not verdict.
- **5C.8 AI health vs candidate events.** Keep them separate: system health
  (`AI_PIPELINE_STARTED`, `AI_PIPELINE_ERROR`, `MODEL_LOAD_FAILED`, `CAMERA_STREAM_UNAVAILABLE`,
  `INFERENCE_DEGRADED`) vs candidate observations (`FACE_NOT_DETECTED`, `MULTIPLE_FACES`,
  `PHONE_DETECTED`, `GAZE_AWAY`, …).
- **5C.9 Failure handling.** If a model crashes, the GPU is unavailable, the camera drops, or
  inference is too slow, show an honest `DEGRADED` state with the reason and which detectors are up —
  never a false "everything is secure".
- **5C.10 No risk engine yet.** Phase 5 stops at `observation → event`. Correlation, risk, evidence
  and human review are a later phase and must not be mixed in.

## What Phase 5 achieves

```
Candidate Camera → AI Perception → {Face detection · Object detection · Head/Gaze analysis}
→ Observations → Temporal processing → Factual AI events → {PostgreSQL, Live Monitoring} → Admin review
```

Only after that does the next major layer (Risk + Evidence + Correlation, roadmap Phase 7 / later)
consider multiple events together — which Phase 5 itself must not do.

---

## Open items

Recorded so they are decided deliberately rather than during implementation, per the project rule
that conflicts with the PRD/TRD/KB are surfaced, not silently resolved. **None of them change the
plan above.** Several must be settled before the stage they belong to is written, and several depend
on the **Phase 5 Knowledge Base the product owner will supply** — the plan above is scope only.

### Roadmap and scope

1. **Numbering divergence (before 5A).** The product owner's "Phase 5" is the roadmap's **Phase 6 —
   AI Proctoring**; the roadmap's Phase 5 (Live Admin Monitoring) was delivered as Phase 4C. Decide
   whether to renumber `DEVELOPMENT-ROADMAP.md` (shift 6→5, 7→6, …) or keep the roadmap numbers and
   treat "Phase 5" as an alias. The roadmap table is **not** renumbered until this is decided; this
   plan is linked from the roadmap's AI-Proctoring row with a note.
2. **The Phase 5 Knowledge Base is a prerequisite.** The exact detector list, event names, models,
   frame rate, resolution, confidence handling and stabilisation thresholds are deferred to it.
   Nothing in 5A–5C is hardcoded before it is reviewed and mapped item by item.

### Architecture (before 5A — highest impact)

3. **Where CV inference runs (OQ-11, HIGH IMPACT).** On-device (Tauri/Rust or a bundled runtime on
   the candidate's Windows machine) vs server-side GPU workers. TRD §8 forbids sending every frame to
   the backend; TRD §9/§37 imply GPU-worker inference; KB §45 sketches `Candidate → WebRTC/media
   pipeline → AI processing workers`. **The current build has no GPU worker, no Redis and no worker
   tier.** This decision drives bandwidth, GPU spend, tamper resistance (on-device inference is
   attacker-controlled), privacy posture, and the media transport below. Must be settled first.
4. **Media transport for AI (OQ-14).** No ingest path is defined for candidate camera → AI. Phase 4C
   established WebRTC *peer-to-peer to an admin viewer*; that is not an ingest path to inference
   workers. Options: on-device inference with events-only upload (fits TRD §8 and 5A.1's "don't send
   raw frames to FastAPI"), WebRTC/SFU ingest to workers, or periodic chunked frame upload. Ties to
   item 3.
5. **Models and licensing.** PROJECT-CONTEXT §10.1 names **YOLO** for object detection and
   **MediaPipe** for face/pose/gaze, behind swappable interfaces (`ObjectDetector`, `FaceDetector`,
   `GazeDetector`, …) — consistent with 5A.3/5A.4. Confirm the exact models/versions, licensing, and
   accuracy benchmarking (TRD requires precision/recall/F1/FP/FN/latency across lighting, camera
   quality, backgrounds, device types). Face **recognition/liveness** (OQ-04) is a *different*
   capability from Phase 5's face *detection/count* — keep them distinct; identity verification is
   not in this plan unless the KB adds it.
6. **Redis / worker / event-bus (before 5C).** PROJECT-CONTEXT §7.3 describes event-driven proctoring
   over Redis/event bus feeding the risk engine; the current stack is PostgreSQL only (Phase 4C's
   realtime hub is in-process, no Redis). Decide whether 5C introduces Redis/workers or stays
   in-process for now. **Do not introduce Kafka to "scale"** (TRD §36). PostgreSQL stays authoritative.

### Events and data (before 5C)

7. **AI event schema.** 5C.4's lifecycle (`DETECTED/ONGOING/RESOLVED` with start/end and duration)
   does not map cleanly onto the append-only `proctoring_events` row model. Decide whether an AI
   event is one row updated across its lifecycle, paired start/end rows, or a new column set —
   without creating a parallel event table (5C.5). FR-014's `confidence`, `severity` and
   `evidence reference` columns (deferred in 4B) may finally be needed for AI events (confidence at
   least); confirm severity/evidence stay out until the risk/evidence phase.
8. **Canonical AI event enum (OQ-05).** Add the AI event types to the single authoritative event
   enum with the existing ones; finalise names from the KB (`FACE_NOT_DETECTED` vs `NO_FACE`, etc.).
9. **Confidence is model confidence, not a verdict.** The plan is explicit and correct; enforce it in
   the schema and UI so `0.91` is never rendered or stored as "91% cheating".

### Privacy and honesty

10. **Frame storage / consent (5A.5, NFR-005, OQ-13).** Decide storage (discard-after-inference vs
    evidence snapshots), biometric-data handling (KB §42: avoid unnecessary biometric storage),
    consent wording, retention, and jurisdiction. Biometric processing of a candidate's face is
    sensitive; the readiness/consent surface from Phase 4A is the natural place to disclose it.
11. **No claims beyond what is validated.** Detection accuracy must be benchmarked before any claim;
    no "AI detects cheating" language anywhere (KB §56 product-honesty rule, PRD/TRD security-honesty
    rules). Phase 5 outputs observations; the UI must not imply verdicts (5C.6/5C.7).

### Platform

12. **On-device performance on candidate hardware.** If inference runs on-device in the Tauri app,
    running YOLO/MediaPipe within WebView2/Rust on arbitrary Windows machines (some without a GPU) is
    unproven; 5A.7's performance budget and graceful `DEGRADED` degradation (5C.9) are essential.
