# Object detection: phones, books, other devices (2026-10-02)

**Status:** implemented and tested. The thresholds are **provisional**. They are to be tuned with the
guided calibration session ([below](#calibration-you-run-this)). Nothing has been committed.

## What changed, and why

Before this change, the camera AI ran an object model on every frame but only recorded a raw
confidence. Phase 5B had found no threshold that separated phones from ordinary desk objects (see
[PHASE-5B-OBJECT-MODEL-EVALUATION.md](PHASE-5B-OBJECT-MODEL-EVALUATION.md)). So there was no
"phone detected" warning and no admin event.

On 2026-10-02 the product owner asked for object detection to work, including small objects, and
decided the following:

| Decision | Choice |
|---|---|
| Model | **YOLOX-S where WebGPU works, YOLOX-Tiny otherwise.** Megvii's official ONNX releases, Apache-2.0, free. This is not Ultralytics YOLO, which is AGPL-3.0. |
| Objects | Mobile phone, book, another laptop or tablet, remote/calculator-like device. These are COCO classes. Earbuds, smartwatches and paper notes are not COCO classes, so no free model can detect them. |
| On detection | A **warning to the candidate** and a **factual event for the administrator**. It **never locks** the exam, keeping the earlier "AI warns only" rule. |
| Thresholds | Provisional values now, plus a guided calibration session the product owner runs on a real webcam. |

## How it works

```
camera (now 1280×720) → AI worker
   ├─ face tasks (MediaPipe, unchanged)
   └─ YOLOX: whole frame + one zoomed tile per frame (rotating)
        └─ best candidate per class → OBJECT_DETECTION observation (confidence, box, size, region, model)
             └─ event layer: confidence ≥ threshold[model][class] (+0.05 if found only in a tile)
                  └─ 2 sightings within 6 s → PHONE_DETECTED / BOOK_DETECTED / LAPTOP_DETECTED /
                     HANDHELD_DEVICE_DETECTED episode (started … resolved after 5 s without one)
                       ├─ candidate: "A mobile phone is visible. Put it away…" (warning only)
                       └─ admin: live "Objects" indicator, ongoing list, evidence timeline
```

* **Model choice at load.** The worker tries the models in this order:
  1. YOLOX-S on WebGPU, accepted only after a warm-up inference finishes within 30 s;
  2. YOLOX-Tiny on WebGPU;
  3. YOLOX-Tiny on WebAssembly (CPU).

  YOLOX-S is never run on the CPU, where it takes about 2.5 s a frame. Each model file is checked
  against its pinned SHA-256 before use. The model that actually ran is recorded in every observation
  and event (`object_model`), because scores are not comparable between models.
* **Small objects (tiling).** Besides the whole frame, the detector looks at four overlapping zoomed
  quadrants. Each is 60% of the frame's width and height, so an object appears about 1.7× larger.
  * **WebGPU:** every frame runs the whole frame plus one quadrant, in rotation.
  * **CPU:** every other frame runs one region, alternating the whole frame and the next quadrant.
    Frames that are skipped count as "not measured", never as "no object".
  * The same object seen in the whole frame and in a tile is kept once, at its higher score.
* **Camera resolution** is now requested at 1280×720 (it was 640×360), so a small phone has real
  detail. The live view sent to the administrator is still scaled to about 640 wide, so it uses no
  extra upload.
* **Confirmation over time.** One frame is never an event. The object must be seen in **2 frames
  within 6 s**. Frames without a sighting in between do not reset the count; this matters because a
  small object is often visible in only one tile. The episode ends after **5 s and 5 measured
  frames** with no sighting.
* **Provisional thresholds** (`OBJECT_THRESHOLDS` in `ai/events/config.ts`):

  | Model | Phone | Book | Laptop/tablet | Handheld device |
  |---|---|---|---|---|
  | YOLOX-S | 0.45 | 0.50 | 0.55 | 0.50 |
  | YOLOX-Tiny | 0.45 | 0.50 | 0.55 | 0.50 |
  | EfficientDet-Lite0 (comparison builds) | 0.55 | 0.55 | 0.60 | 0.55 |

  An object found only in a tile needs the threshold **+0.05**.

  **Where the phone values come from:** on the earlier live-webcam sessions, frames without a phone
  reached at most about 0.37 (YOLOX-S) or 0.36 (YOLOX-Tiny), while phone steps reached 0.8–0.9.
  **Book, laptop and handheld device have no measurements yet**, so their values are conservative
  starting points for the calibration session to replace.

## What it records, and what it never records

* An event carries only:
  * the class;
  * the model's confidence when the episode started;
  * which model produced it;
  * the box's share of the frame;
  * the server-computed duration.

  The server rejects any other field, including images, crops and verdicts.
* **No frame, image or video is stored or sent.** Frames are discarded after inference, as before.
* Events are **facts, not verdicts.** "Confidence" is the model's confidence in one region of the
  image. It is not a probability that anyone used a phone.
* **Risk:** the four types are listed as *excluded* in the risk engine (Phase 6A). They appear in the
  evidence timeline and in review, but they are **not scored** until the thresholds are calibrated.
  The product owner can change this later.

## Measured on the COCO image set (`benchmarks/objects/results/tiling.md`)

The app's own YOLOX code ran on 408 cached COCO val2017 photos, with the whole frame only and then
with the whole frame plus tiles. These are single images with no temporal confirmation. COCO photos
are not webcam frames, so this measures the models and the tiling, **not** the production false-alarm
rate.

| | YOLOX-S whole frame | YOLOX-S + tiles | YOLOX-Tiny whole frame | YOLOX-Tiny + tiles |
|---|---|---|---|---|
| Phones under 1% of the frame (130) | 35% | **55%** | 12% | **35%** |
| Phones 1–5% (47) | 77% | 79% | 49% | 70% |
| Phones ≥ 5% (37) | 73% | 78% | 68% | 78% |
| Book images: book found (40) | 30% | 45% | 18% | 33% |
| Laptop images: laptop found (40) | 75% | 78% | 68% | 80% |
| Remote images: remote found (40) | 45% | 60% | 25% | 40% |
| Phone-free images with a "phone" (194) | 4% | 10% | 2% | 6% |

The +0.05 tile margin takes YOLOX-S's phone-free false positives from 10% to 8%, at a cost of tiny
phones from 55% to 53%.

**Speed.** On this development machine (Intel UHD, WebGPU), YOLOX-S runs at about 150 ms per
inference, so about 0.3 s per frame for the whole frame plus a tile. The full pipeline ran at about
2.4 frames a second, and AI health stayed RUNNING.

## Calibration (you run this)

```
cd apps/desktop
npm run calibrate:objects                                    # YOLOX-S (WebGPU) — the default path
SESSION_OBJECT_MODEL=yolox_tiny npm run calibrate:objects    # the CPU fallback model
```

**Before you start:** have the backend running, as for the end-to-end tests. Have a phone to hand,
and if you can, a book, a tablet or second laptop, a calculator or remote, a mug and headphones.

**The session:** about 6 minutes, 18 guided steps in an Edge window:
* the phone near your face, its back to the camera, at your ear, low in your hand, at arm's length,
  as far away as possible, half out of view, and on the desk;
* a book in your hand and on the desk;
* another laptop or tablet;
* a calculator or remote;
* look-alikes that must **not** count: empty hands, a mug, headphones, paper.

Skip anything you don't have.

**What it records:** numbers only. For each step and class it records the confidences and which
events actually fired. It then suggests a threshold per class: just above every look-alike frame,
plus 0.05, with the share of object frames that threshold would catch. Results go to the git-ignored
`benchmarks/.cache/webcam/`. **No image is captured.**

**Applying the result** is a deliberate edit to `OBJECT_THRESHOLDS`. Send me the generated `.md` and
I will apply and test the values.

The harness was dry-run on the synthetic camera: 18 steps, YOLOX-S on WebGPU, report written.

## Limitations (honest)

* **The thresholds are provisional.** The real false-alarm rate on webcams is not known until the
  calibration session (and ideally sessions with several people, cameras and rooms).
* **Small objects on CPU-only machines.** Without WebGPU, YOLOX-Tiny runs every other frame and a
  given tile comes round only every 8 object passes. A tiny phone seen *only* in a tile may take a long
  time to confirm, or never confirm. Phones of ordinary size are unaffected.
* **Classes are COCO's.** A tablet is usually seen as a laptop or a phone. A calculator is often seen
  as a remote or a phone. Earbuds, smartwatches and notes cannot be detected.
* **Look-alikes.** On still photos, remotes, mice and dark rectangles sometimes score as phones (see
  the COCO table). Confirmation over time reduces this on video, but it cannot remove it.
* **Installer size.** Every default installer now carries YOLOX-S (36 MB), YOLOX-Tiny (20 MB) and
  ONNX Runtime's WebAssembly (27 MB), before compression.
* **Model weights' licence.** YOLOX's code is Apache-2.0. The release states no separate terms for
  the weights, recorded as "unconfirmed" in `apps/desktop/THIRD_PARTY_NOTICES.md`, as before.

## Files

| Area | Files |
|---|---|
| Models, tiling, YOLOX | `ai/objectDetection/{models,tiling,yolox,yoloxBackend}.ts` |
| Worker and protocol | `ai/mediapipe/{worker,protocol,config,runtime}.ts` |
| Detector | `ai/detectors/object.ts` (`ObjectPresenceDetector`) |
| Events | `ai/events/{config,conditions,stabilizer}.ts` (new types, thresholds, tile margin, tolerant pending) |
| Candidate and admin | `proctoring/environment/examRules.ts` (warnings and a new rule), `proctoring/devices.ts` (720p), `environment/useMediaPublisher.ts` (live view stays ~640 wide), `admin/monitoring/{ai,types}.ts` ("Objects" indicator) |
| Backend | `models/proctoring_event.py`, migration `0024_object_detection_events`, `services/proctoring_events.py` (fields), `services/monitoring.py` + `schemas/monitoring.py` (`objects`, `objects_seen`), `services/risk/policy.py` (excluded) |
| Assets | `scripts/fetch-ai-assets.mjs` (both YOLOX models by default), `THIRD_PARTY_NOTICES.md` |
| Tools | `benchmarks/objects/tiling.mjs` (COCO comparison), `benchmarks/webcam/objects-calibration.spec.ts` (`npm run calibrate:objects`) |

## Tests

| Suite | Covers |
|---|---|
| `ai/__tests__/yolox.test.ts` | Both model contracts, the four COCO indices, mode defaults and load order, tiling plans (WebGPU, CPU, EfficientDet), tile coverage, mapping and merging, multi-class decoding, observations per class (model, size, region), skipped frames are not "none" |
| `ai/__tests__/events.test.ts` | Per-model, per-class thresholds and metadata; the tile margin; unknown model or frame is unknown; tolerant pending (gaps, window, reset); one PHONE_DETECTED episode end to end; below threshold or one stray frame is never an event |
| `ai/__tests__/detectors.test.ts`, `runtime.test.ts`, `examControl.test.ts` | Detector per class; the worker load configuration; a warning for every event type |
| `backend/tests/test_ai_events.py` | Each object type as an episode with a server-computed duration; only its measurement fields (no image, crop or verdict); excluded from risk; the admin AI state (`objects`, `objects_seen`, unknown when impaired); still no verdict event types |
| `e2e/ai-events.spec.ts` | A phone below threshold is no event; a phone in view gives one episode, the candidate's warning, the admin's live "Objects: Phone" and "Mobile phone in view (confidence 81%)"; a book gives its own episode; putting both away ends both and clears the warning; the exam never locks. The real YOLOX model on the empty synthetic camera raises no object event. |
