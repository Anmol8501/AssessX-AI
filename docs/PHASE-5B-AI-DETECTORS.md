# Phase 5B — Core AI Proctoring Detectors (partial — phone detection blocked by validation)

**Status:** **5B implemented except phone detection** (2026-09-26), on top of the Phase 5A foundation
([PHASE-5A-AI-FOUNDATION.md](PHASE-5A-AI-FOUNDATION.md)). It is the **perception layer only**: it
answers "what does the camera show?", never "is the candidate cheating?". There is no risk score,
cheating probability, verdict or severity anywhere, and nothing is persisted — turning observations
into proctoring events is **Phase 5C** ([PHASE-5C-AI-EVENT-INTEGRATION.md](PHASE-5C-AI-EVENT-INTEGRATION.md)). **Final status: PARTIAL — BLOCKED BY PHONE
DETECTION VALIDATION** (see Final validation): face presence/count, tracking, head pose, gaze and
frame quality are validated on a real webcam; the phone detector reports raw confidence only, because
neither COCO nor real-webcam data supports a phone threshold with this model.

> **Numbering note.** The product owner calls this "Phase 5"; the roadmap numbers AI Proctoring as
> Phase 6. Recorded, not reconciled — see `PHASE-5-PLAN.md`.

## Decisions and their sources

| Decision | Source |
|---|---|
| Runtime: **MediaPipe Tasks Vision** for face, head orientation and gaze | Named by the Master KB §13, TRD §10, PRD FR-010, PROJECT-CONTEXT §10.1 |
| On-device inference in the desktop app | Phase 5A (constraint-forced; OQ-11 settled for Phase 5 only) |
| Object detection with **MediaPipe EfficientDet-Lite0**, not YOLO | **Product-owner decision, 2026-09-26** — the documents name YOLO, but Ultralytics YOLO is AGPL-3.0. A recorded deviation from the documents' wording |
| Object classes: **cell phone only** | Product-owner decision, 2026-09-26 (PRD FR-009 "Mobile phone", plan 5B.4 "chiefly PHONE") |
| No face recognition, identity, embeddings or liveness | Not Phase 5 (PRD FR-008 / OQ-04) |

## Models

All three are Google MediaPipe models published under **Apache-2.0** (per their model cards). They
are downloaded from Google's model storage by `apps/desktop/scripts/fetch-ai-assets.mjs`, verified
by SHA-256, and served from inside the app — an exam never depends on a CDN. They are not committed.

| Model | Version | Purpose | Size | SHA-256 | Tested |
|---|---|---|---|---|---|
| `blaze_face_short_range.tflite` (BlazeFace short-range) | float16 / v1 | Face presence, count, boxes (feeds tracking) | 229,746 B | `b4578f35…0152f` | Real model, E2E |
| `face_landmarker.task` (Face Landmarker) | float16 / v1 | Head pose (transformation matrix), gaze (eye blendshapes) | 3,758,596 B | `64184e22…e0bc9ff` | Real model, E2E |
| `efficientdet_lite0.tflite` (EfficientDet-Lite0, COCO) | float16 / v1 | Phone candidate | 7,254,339 B | `4b591000…99e780993` | Real model, E2E (no-phone frames only) |

Full digests and URLs are in the asset script. Runtime: `@mediapipe/tasks-vision` **1.0.1**
(Apache-2.0, pinned exactly), ES-module WebAssembly build (11.8 MB; SIMD, which every WebView2
supports). The assets add ≈ 23 MB uncompressed; the resulting installers are 14.4 MB (NSIS) and
14.9 MB (MSI). Licences and notices are recorded in
[apps/desktop/THIRD_PARTY_NOTICES.md](../apps/desktop/THIRD_PARTY_NOTICES.md), which the installer
ships next to the app (see "Licensing" under Final validation).

## Architecture

```
existing proctoring camera (useMediaDevice) — the one camera path; never re-opened
  ▼
FrameProvider → FrameScheduler (5A: one frame in flight) → MediaPipeRuntime (page side)
                                                              │ ImageBitmap *transferred*
                                                              ▼
                                            Web Worker (off the exam's UI thread)
                                              face detector ─┐
                                              face landmarker ├─ only when a face is present
                                              phone detector ─┘   bitmap closed after inference
                                              luminance stats
                                                              │ small factual result (protocol.ts)
                                                              ▼
    Detectors (pure normalisers): face presence · face tracking · head pose · gaze · phone · frame quality
                                                              ▼
                                         Observations (in memory) · AI health · telemetry
```

Code: [apps/desktop/src/features/proctoring/ai/](../apps/desktop/src/features/proctoring/ai/) —
`mediapipe/` (worker, runtime proxy, protocol, config, statistics) and `detectors/`. The 5A
pipeline, scheduler, health, hook and UI are reused, extended only where noted below.

- **One shared frame pipeline, one worker, models loaded once.** Detectors never touch the camera,
  pixels or a model; they read their slice of one per-frame result (`RawInference.payload`).
- **Data minimisation at the thread boundary.** The worker returns face boxes and scores, one pose
  matrix per measured face, the eight eye-direction blendshapes, phone candidates and two luminance
  numbers. It never returns the 478 face landmarks, other facial-expression blendshapes, or pixels.
- **"Unavailable" is not "absent".** A detector whose model failed to load (ERROR) or failed on a
  frame (DEGRADED) emits nothing — it never reports "no face" or "no phone" for a frame it did not
  see. `faceCount: 0` only ever means the face detector ran and found none.
- **No silent stalls.** A load that does not finish in 60 s, or an inference that does not return in
  5 s, terminates the worker and reports ERROR; sampling then stops (no frames are captured for a
  runtime that cannot infer).

## Detectors and observations

All observations use the 5A `Observation` shape. `confidence` is **model confidence** (0..1) in the
detection, or null when the model gives none — never a probability about the candidate.

| Detector (id) | Observation | Fields | Status |
|---|---|---|---|
| Face presence (`mediapipe.face-presence`) | `FACE_PRESENCE`, one per frame | `facePresent`, `faceCount`; box + detector score of the most confident face | **IMPLEMENTED** |
| Multiple faces | (same observation) | `faceCount` > 1 — observational only | **IMPLEMENTED** |
| Face tracking (`mediapipe.face-tracking`) | `FACE_TRACK`, one per visible face | short-lived `trackId`, `trackStartedMs`, `framesSeen`; box, score | **IMPLEMENTED** (provisional parameters) |
| Head pose (`mediapipe.head-pose`) | `HEAD_POSE`, per measured face | `yawDeg`, `pitchDeg`, `rollDeg`; box; confidence null | **IMPLEMENTED** |
| Gaze (`mediapipe.gaze`) | `GAZE`, per measured face | `gazeHorizontal`, `gazeVertical` + the eight `eyeLook*` scores; confidence null | **IMPLEMENTED** (uncalibrated) |
| Phone (`mediapipe.object-detection`) | `OBJECT_DETECTION`, one per frame | `objectClass: cell_phone`; the **most confident candidate's** score + box | **PARTIAL — blocked by validation**: no detected/not-detected decision; COCO and real-webcam data show no defensible threshold (see Final validation) |
| Frame quality (`frame-quality`) | `FRAME_QUALITY`, one per frame | `meanLuminance`, `luminanceStdDev`, `frameWidth/Height`, `faceAreaRatio` | **IMPLEMENTED** (measurements only) |

Notes:

- **Tracking** is not identity: ids (`t1`, `t2`…) mean "the box that overlapped the previous box",
  restart when the camera changes or the exam ends, and are never stored.
- **Head pose** decomposes MediaPipe's column-major transformation matrix as R = Ry·Rx·Rz. The layout
  was confirmed on the real model (translation in elements 12–14; elements 3/7/11 zero), and the
  angles were checked against a known rotation: the test portrait rotated 20° clockwise in the frame
  gives **roll −19.66°** (upright: 0.41°). Sign convention: clockwise in the image ⇒ negative roll.
- **Gaze** is a linear summary of the landmarker's eye blendshape scores (ARKit naming: "Left" is the
  subject's own left): `horizontal = ((outLeft+inRight) − (inLeft+outRight))/2`, positive toward the
  candidate's own left; `vertical` positive up. Not a calibrated angle; direction not validated
  against ground-truth gaze.
- **Phone — why PARTIAL.** EfficientDet-Lite0's metadata defines **no score cut-off**. Measured on the
  portrait (no phone present) it returned ~1,800 "cell phone" candidates at 0.01–0.04, so an early
  build reported "phone detected" on every frame. The detector now asks the model for its single best
  candidate and reports only that score and box. **Deciding "a phone is present" needs a threshold,
  which is UNRESOLVED** and should be set from a benchmark (TRD §40), not guessed. Detection of a real
  phone has **not** been tested (no licensed phone test images were used).
- **Frame quality** applies no "too dark / blocked / too far" labels — no threshold is documented.
- The face detector keeps **MediaPipe's default minimum detection confidence (0.5)**; AssessX sets
  no confidence threshold of its own.

## Performance (measured, one machine — not validated targets)

Development machine, headless Microsoft Edge, CPU (XNNPACK) delegate, 640×480 frames, per frame:

| Stage | Time |
|---|---|
| Luminance statistics | ~5 ms |
| Face detector | ~12 ms |
| Face landmarker (only when a face is present) | ~42–45 ms |
| Phone detector (top-1 candidate) | ~220–233 ms |
| **Total in worker / end-to-end** | **~280–295 ms** |
| Model load (all three) | ~2.3–3.0 s |

With the 5A default 500 ms interval that is ≈ 1.3 frames/s processed. Asking for every phone
candidate instead of the top one took ~800 ms per frame (post-processing thousands of boxes).
Health reports DEGRADED when the rolling-average latency exceeds the sampling interval (i.e.
inference cannot keep up) — that budget replaced 5A's arbitrary 250 ms placeholder.

**GPU is off by default (UNRESOLVED).** This paragraph originally said the GPU path *hung* with two
or more GPU tasks. **That was a misdiagnosis**, corrected by the final validation below: the GPU
works; its *first* inference compiles shaders and took 7.8 s from a cold start, longer than the 5 s
inference watchdog, which terminated it. When enabled, `accelerator` reports `GPU` only if every task
really runs on it.

## Security and privacy

- **CSP change:** `script-src 'self' 'wasm-unsafe-eval'` in `src-tauri/tauri.conf.json`. Required by
  any WebAssembly runtime; it allows WebAssembly compilation only — JavaScript `eval` stays blocked.
- Frames: transferred to the worker, used once, closed. The downscaled statistics copy is cleared.
  Nothing is stored, uploaded, logged or screenshotted; there is no backend call and no new table.
- No landmarks, face geometry, embeddings or identity leave the worker or are kept.
- On-device output runs on the candidate's machine and is **not authoritative security state**; it
  is perception only, kept in memory for 5C to use.
- The mock runtime remains test-only (reachable solely through `window.__assessxAI`, which the
  packaged app never defines); production always selects MediaPipe (unit-tested).

## Changes to the 5A foundation (found while building 5B)

1. **Latent bug fixed:** `AIPipeline.start(stream)` never marked the stream present, so `start()` on
   its own never sampled; the app only worked because the React hook also called `setStream()`.
   Found by the new unit tests.
2. Sampling now stops once the runtime can no longer infer (load failure or error) — previously it
   kept capturing frames nothing could process — and the final counters are kept in telemetry.
3. `setStream()` with an unchanged stream no longer rebuilds the frame source; a changed stream
   calls the new optional `Detector.reset()` (clears face tracks).
4. Documentation corrected: the scheduler chains ticks after each completed frame, so it never
   queues and `framesDropped` is 0 by construction (slow inference lowers `processedFps` instead).
5. Additive contract changes: optional `Observation.boundingBox`, `Detector.reset()`,
   `RuntimeInfo.accelerator`, `RawInference.timingsMs`; telemetry gains `runtime` and
   `lastStageTimingsMs`.

## Testing

- **Unit (vitest, new):** 55 tests (48 at first delivery; 7 runtime tests added in final validation) — every detector (no/one/many faces, confidence pass-through,
  malformed payloads, unavailable ≠ absent, shutdown), the tracker (create/continue/expire/reset),
  pose maths (round trips incl. scaled matrices, and the real portrait matrices), gaze, phone (no
  invented decision), statistics, health (never phrased about the candidate), scheduler (one frame
  in flight, frames always released, clean stop), pipeline lifecycle (load failure, runtime failure,
  camera change, detector isolation, no emission after stop), runtime selection (production never
  picks the mock), and an observation-contract guard that fails on any verdict/risk/severity field.
- **E2E (Playwright):** 5 AI tests — the 5A mock lifecycle/failure/no-runtime paths, and the **real
  MediaPipe runtime** on a no-face camera and on MediaPipe's published test portrait (presence,
  tracking, pose, gaze, the 20° rotation, camera loss → "limited" → reconnect → reset tracks →
  "active", stop on submit). The portrait is fetched at test time into git-ignored `e2e/.cache/`
  and verified by SHA-256; it is not redistributed.

**Results (final validation, 2026-09-26, every figure from the tool's own exit code):** unit
(vitest) **55 passed**; desktop E2E **68 passed** (63 Phase 4 + 5 AI — no regression); backend
**357 passed**; Rust **16 passed**; `tsc -b`, `oxlint` (only two pre-existing Phase 4C warnings)
and the production build pass; the release build produced both installers, each containing
`THIRD_PARTY_NOTICES.md`.

**Packaged-app check (real WebView2, real Tauri CSP, no camera):** in the built release exe,
WebAssembly compiles while JavaScript `eval` stays blocked; all models and the runtime are served
from the app at their verified sizes; the production worker chunk loads all three models (READY,
CPU, 3.2 s) and runs a synthetic frame (no faces, landmarker skipped, one phone candidate,
luminance 0.502 for #808080); dispose works; **no CSP violations**. First (cold) inference: 626 ms.

**Not tested:** multiple people in view; a physically unplugged camera; GPU in production; any
accuracy measurement (TRD §40); machines other than the development machine. (A real webcam, a real
person and a real phone were tested in the final validation's guided session.)

## Final validation (2026-09-26)

### Phone detector — raw output (from the model file and MediaPipe's source)

| Stage | What happens |
|---|---|
| Input | Each frame is resized by MediaPipe to the model input, **float32 [1, 320, 320, 3]** (normalisation from the model's metadata). |
| Model output | Raw tensors: **19,206 anchor boxes × 90 COCO class scores**. The model contains no post-processing/NMS op. |
| Decoding | MediaPipe `TensorsToDetectionsCalculator`, with decoding options (and score transform) from the model's metadata. |
| Score threshold | **Effectively none (0).** The task always passes its `scoreThreshold` into the graph; left unset it is 0, and the model's metadata has no score-thresholding unit. This is why ~1,800 candidates came back per frame. |
| Class | Allowlist `cell phone` = COCO label **index 76** (embedded `labels.txt`). |
| NMS | MediaPipe `NonMaxSuppressionCalculator`: IoU overlap, default algorithm, `min_suppression_threshold` **0.3** (task default), not multi-class. `maxResults: 1` is applied here, so the single returned box is the highest-scoring one after NMS. |
| Confidence | That box's score, 0..1, reported unchanged as `confidence`. |

### Phone detector — benchmark (production worker, CPU)

Tooling: [apps/desktop/benchmarks/](../apps/desktop/benchmarks/) (`phone/`); report:
[benchmarks/phone/results/latest.md](../apps/desktop/benchmarks/phone/results/latest.md). 418 images:
214 COCO val2017 images with an annotated phone; 194 COCO phone-free images with a laptop, book,
remote, keyboard or mouse; 7 MediaPipe hand images; the portrait; 2 empty frames.

| Group | n | median | p90 | max |
|---|---|---|---|---|
| Phone (all sizes) | 214 | 0.177 | 0.686 | 0.851 |
| Phone ≥ 5% of frame | 37 | 0.616 | — | — |
| Laptop (no phone) | 40 | 0.083 | 0.284 | **0.656** |
| Keyboard (no phone) | 40 | 0.123 | 0.239 | **0.521** |
| Mouse (no phone) | 34 | 0.111 | 0.197 | 0.492 |
| Remote (no phone) | 40 | 0.083 | 0.173 | 0.328 |
| Book (no phone) | 40 | 0.042 | 0.128 | 0.264 |
| Hands (no phone) | 7 | 0.085 | 0.100 | 0.113 |
| Empty frames | 2 | 0.004 | — | 0.006 |

Sweep (phone images at/above · phone-free images at/above, of 214 · 204): 0.3 → 82 · 9;
0.5 → 46 · 3; 0.7 → 21 · 0. For phones ≥ 5% of the frame: 0.3 → 30/37; 0.5 → 24/37; 0.7 → 15/37.

**False positives, inspected by eye:** a laptop **touchpad** scored 0.599 and a **USB wireless
receiver** 0.521 — genuine false positives on objects a candidate has on a desk; a desk **landline
telephone** scored 0.492 (a phone, but not a mobile); the 0.656 case is a dark phone-sized object and
may be an unlabelled phone (COCO label noise).
**False negatives:** tiny phones (< 1% of the frame, median 0.108) are mostly missed; even among
large, clearly visible phones, 13/37 score below 0.5.

**Threshold status: NOT SET — phone detection threshold requires a larger validation dataset.** The
score ranges of phones and ordinary desk objects overlap: any cut-off that keeps the touchpad and USB
receiver out also misses a large share of clearly visible phones, and the data is generic COCO
photos, not webcam frames, with no headphones, calculators or real in-hand webcam phones. The
detector stays PARTIAL (raw confidence only). A defensible threshold needs labelled webcam-domain
data; the model's weak separation on this set also suggests evaluating a stronger object model
before relying on phone observations (a product decision — not made here).

### GPU — diagnosis

Isolated diagnostic (production unchanged, CPU): the production worker with the GPU delegate, in
headless Edge **and** the packaged WebView2. The worker's WebGL device was the laptop's Intel UHD GPU
via ANGLE/Direct3D 11 (a real GPU; Windows gives WebView2 the integrated GPU by default).

| Configuration | Loads | First inference (cold) | Steady state |
|---|---|---|---|
| Face detector alone | yes | 2.7–3.0 s | 17–49 ms |
| Landmarker alone | yes | 3.3–3.7 s | 16–66 ms |
| Phone detector alone | yes | 6.0–6.2 s | 110–124 ms |
| All three, one worker, **cold browser** | yes | **7.8 s** | 114–134 ms |
| Three tasks, three workers | yes | 0.3–0.9 s each (shaders cached) | 12–151 ms |

Every configuration works; nothing hangs. The earlier failure was the 5 s inference watchdog killing
the cold first inference. **GPU remains off and UNRESOLVED**: enabling it needs a warm-up inference
inside `load()` (bounded by the 60 s load timeout) and testing across more hardware. CPU remains the
verified runtime.

### Performance and UI impact

Scheduler: ticks are chained after each completed frame — one inference in flight, no queue, each
capture takes the newest frame; slow phone inference lowers the processed rate instead of queueing.
Verified by unit tests (one frame in flight; frames always released; clean stop; runtime: no
pixel-less inference, a hung inference terminates the worker, a late reply is ignored) and E2E:
exactly one live inference worker per exam, **no new worker on camera reconnect**, the worker
terminated on submit, and **0 main-thread long tasks during a 10 s window with all detectors running**
(inference is in the worker). In development React StrictMode creates and immediately stops one extra
pipeline; production does not. Measured CPU cost per frame is unchanged (~290 ms; phone ~225–233 ms;
packaged cold first frame 626 ms). No FPS target is documented — none is claimed.

### Licensing

| Item | Licence | Verified from |
|---|---|---|
| MediaPipe Tasks Vision runtime 1.0.1 | Apache-2.0 | npm metadata; the package ships no LICENSE/NOTICE, so the upstream `LICENSE` is reproduced; upstream has no NOTICE |
| BlazeFace short-range | Apache-2.0 | Model card ("Licensed under Apache License, Version 2.0") |
| Face Landmarker (Face Mesh V2 + Blendshape V2) | Apache-2.0 | Both model cards |
| EfficientDet-Lite0 (MediaPipe build) | **Unverified** | No model card linked; no licence in the file or its storage metadata |
| Libraries compiled into the WASM (TFLite, XNNPACK, Abseil, Protobuf, Eigen, OpenCV, libjpeg, libpng, …) | Various | **Unverified** — indicated by identifiers in the binary only |

Notices: [apps/desktop/THIRD_PARTY_NOTICES.md](../apps/desktop/THIRD_PARTY_NOTICES.md), shipped by
the installer next to the application (`bundle.resources`). This is an engineering record, not a
compliance claim — legal review remains open for the unverified items.

### Real webcam (guided session, 2026-09-26)

Built-in HP Wide Vision HD camera, one participant, one room, the development app on the real
MediaPipe runtime (CPU), 22 guided steps plus a camera-loss/reconnect and submit. **Numbers only were
recorded.** Observations are bucketed by step window, so a few frames per step can belong to the
participant's transition.

| Checked | Result | |
|---|---|---|
| Camera starts / stream reused | Real camera opened once by the exam; AI ran on it | TESTED |
| Face detection & count | 1 face in 100% of baseline frames; count 0 when out of frame or lens covered | TESTED |
| Face lost on upward tilt | Head up: face found in only ~45% of frames | TESTED — limitation |
| Tracking | One track while visible; new short-lived id after the face was lost | TESTED |
| Head pose responds | Turn to own left: median yaw +22.6° (max +53°); right: −14.5° (min −47°); down: pitch up to +18°; up: to −17° | TESTED |
| Pose outliers | Occasional implausible single-frame values at extreme turns (e.g. roll 131°) | TESTED — limitation |
| Gaze | Eyes-left median +0.16 vs eyes-right −0.01 (documented direction), baseline offset ≈ +0.13 — weak, uncalibrated | TESTED |
| Frame quality | Mean luminance 0.62–0.67 normally; 0.011 with the lens covered | TESTED |
| Camera loss / return | Honest reason shown; reconnect returned to RUNNING; same worker (none added) | TESTED (loss simulated by ending the camera track) |
| AI stops cleanly | STOPPED on submit; all inference workers terminated | TESTED |
| Performance (real camera) | ~288 ms/frame on CPU (phone 224 ms), 1.8 frames/s processed, load 2.15 s | TESTED |
| Multiple people | — | NOT TESTED (one participant) |
| Physical unplugging | — | NOT TESTED (built-in camera) |

Phone confidence on the real webcam (per step: median / max):

| Phone in view | median | max | No phone in view | median | max |
|---|---|---|---|---|---|
| Screen to camera, near | 0.111 | 0.672 | Baseline (sitting) | 0.137 | 0.389 |
| Back to camera, near | 0.330 | 0.715 | TV remote | 0.067 | 0.391 |
| Landscape | 0.080 | 0.138 | Headphones | 0.057 | 0.302 |
| Arm's length | 0.134 | 0.611 | Book | 0.061 | 0.210 |
| Partly out of view | 0.061 | 0.138 | Empty hands | 0.074 | 0.157 |
| In hand, chest height | 0.069 | 0.678 | Mug | 0.032 | 0.061 |

Typical phone frames score 0.06–0.33 while frames with **no phone reach 0.39**, and landscape or
partly visible phones never exceeded 0.14. On this camera, as on COCO, no threshold separates phones
from other scenes: this confirms the threshold cannot be set from available data, and that the model
itself separates phones poorly in this setting. (Calculator: participant skipped.)

## UNRESOLVED — requires Phase 5 technical decision

1. Phone "present" threshold — **requires a larger, webcam-domain validation dataset** (see Final
   validation). A model evaluation ([PHASE-5B-OBJECT-MODEL-EVALUATION.md](PHASE-5B-OBJECT-MODEL-EVALUATION.md))
   found YOLOX-Tiny (Apache-2.0) the most promising replacement. It is now integrated as an **opt-in**
   second object model (`VITE_OBJECT_DETECTOR_MODEL=yolox_tiny`); EfficientDet-Lite0 stays the default.
2. GPU delegate — works, but needs warm-up in `load()` and testing on more hardware before enabling.
3. Sampling interval and per-detector cadence (500 ms default; the phone detector dominates cost).
4. Tracker parameters (min overlap 0.3; track ends after 2 missed samples).
5. How many faces get pose/gaze (1 — the face count itself is uncapped).
6. Accuracy of every detector — **no accuracy has been measured** (TRD §40: precision, recall, F1,
   false-positive/negative rates across lighting, cameras, backgrounds, devices, positions).
7. Licences still unverified: the EfficientDet-Lite0 build and the libraries compiled into the WASM.

## Not implemented (Phase 5C and later)

No AI → proctoring-event persistence, no debouncing or temporal event lifecycle, no AI event
broadcasting to admin monitoring, no admin AI timeline, no severity, no risk engine, no evidence or
screenshots, no identity verification, no audio. Admin Live Monitoring is unchanged.
