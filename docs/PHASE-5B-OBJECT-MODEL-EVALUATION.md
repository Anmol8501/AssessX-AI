# Phase 5B — Object-detector model evaluation (phone detection)

**Status:** evaluation (2026-09-26), followed by a reversible, opt-in YOLOX-Tiny integration
(2026-09-27 — see [the section at the end](#reversible-yolox-tiny-integration-2026-09-27)). The
evaluation itself changed no production code; by default the app still ships
MediaPipe EfficientDet-Lite0 behind the detector abstraction, reporting raw confidence only, with no
"phone detected" decision. No threshold was chosen. Phase 5C was not touched.

**Why.** The Phase 5B validation ([PHASE-5B-AI-DETECTORS.md](PHASE-5B-AI-DETECTORS.md)) showed that
EfficientDet-Lite0 separates phones poorly: phone-free webcam frames reached 0.39 while typical phone
frames scored 0.06–0.33, and false positives included a laptop touchpad (0.599) and a USB receiver
(0.521). This document compares alternatives on the same data.

> **Engineering comparison, not an accuracy study.** 418 generic COCO/MediaPipe images and one
> participant's webcam on one laptop. No statistical accuracy is claimed for any model.

## Candidates, sources and licences

| Candidate | Exact artifact | Code licence | Model/artifact licence | Evidence |
|---|---|---|---|---|
| **EfficientDet-Lite0** (current) | `mediapipe-models/object_detector/efficientdet_lite0/float16/1` · 7.3 MB · SHA-256 `4b591000…99e780993` | MediaPipe runtime Apache-2.0 | **UNRESOLVED** | No model card linked; no licence in the file or its storage metadata |
| **EfficientDet-Lite2** | `…/efficientdet_lite2/float16/1` · 12.1 MB · `5d4ebec1…18ba173302` | same | **UNRESOLVED** | same as Lite0 |
| **YOLOX-Nano / Tiny / S** | Megvii-BaseDetection/YOLOX release `0.1.1rc0` (2021-08-18) official ONNX: nano 3.7 MB `c789161e…0b7d`, tiny 20.2 MB `427cc366…f0b7`, s 35.9 MB `c5c2d13e…7d02` | Apache-2.0 (repo LICENSE, verified) | Apache-2.0 — weights published in the same Apache-2.0 repository's release; the release states no separate terms | GitHub API + LICENSE; repo maintained (last push 2025-06), weights unchanged since 2021 |
| **D-FINE-N** | Peterande/D-FINE @ `956d1709` (2026-08-19); checkpoint `dfine_n_coco.pth` from Peterande/storage `dfinev1.0`; exported locally → 17.1 MB `626762da…9d262` | Apache-2.0 (verified) | Apache-2.0 (storage repo LICENSE, verified). **COCO-only checkpoint used**: the README warns Objects365-pretrained checkpoints may carry Objects365 dataset terms and are not commercially cleared | GitHub API + README |
| **D-FINE-S** | `dfine_s_coco.pth` | Apache-2.0 | Apache-2.0 | **Not evaluated** — the export crashed natively inside PyTorch 2.14 (CPU) in the model's encoder |
| **ONNX Runtime Web** (runtime for YOLOX / D-FINE) | `onnxruntime-web` 1.30.0 | MIT (verified) | — | The npm package ships no LICENSE/notices; upstream `ThirdPartyNotices.txt` for v1.30.0 (6,369 lines: Eigen MPL-2.0, protobuf, Abseil, FlatBuffers, emsdk, …) must be shipped with it |

All candidates are trained on COCO, whose images carry their own (mixed Flickr) licences — a caveat
that applies equally to every model here. Ultralytics YOLO (AGPL-3.0) and GPL-licensed YOLO variants
(v6, v7, v9) were excluded on licence grounds.

**D-FINE export note.** PyTorch 2.14's classic exporter crashed, so the official script ran with
PyTorch's newer exporter (opset 18). The exported graph was checked against the original PyTorch
model on five COCO phone images: phone scores agree within ≤ 0.009. The exported model emits
contiguous COCO-80 labels, so **cell phone = 67** (D-FINE remaps to category id 77 only in its
evaluation code) — verified on real phone images.

## Results on the image benchmark (CPU scoring; 214 phone images, 204 phone-free)

Full tables: [apps/desktop/benchmarks/models/results/comparison.md](../apps/desktop/benchmarks/models/results/comparison.md).
Separability is the ROC AUC between phone and phone-free images (threshold-free; 0.5 = chance).

| Model | AUC all phones | AUC phones ≥ 5% of frame | median phone-free | max phone-free | phones above every phone-free image (all / large) |
|---|---|---|---|---|---|
| EfficientDet-Lite0 | 0.698 | 0.936 | 0.087 | 0.656 | 26/214 · 17/37 |
| EfficientDet-Lite2 | 0.791 | 0.973 | 0.066 | 0.693 | 36/214 · 18/37 |
| YOLOX-Nano | 0.683 | 0.920 | 0.014 | 0.598 | 33/214 · 18/37 |
| YOLOX-Tiny | 0.756 | 0.963 | 0.015 | 0.653 | 50/214 · 24/37 |
| YOLOX-S | **0.810** | 0.965 | 0.023 | 0.753 | **58/214** · 19/37 |
| D-FINE-N | 0.809 | 0.964 | **0.175** | 0.793 | 52/214 · 23/37 |

## Results on the live webcam (all models scored the same frames; ~30 frames per step)

| Step — median / max | EfficientDet-Lite0 | YOLOX-Tiny | YOLOX-S | D-FINE-N |
|---|---|---|---|---|
| No phone (start) | 0.036 / 0.049 | 0.008 / 0.016 | 0.003 / 0.006 | **0.445 / 0.518** |
| Empty hands | 0.170 / 0.465 | 0.097 / 0.279 | 0.053 / 0.365 | **0.716 / 0.882** |
| Mouse / charger / USB stick | 0.077 / 0.310 | 0.039 / 0.282 | 0.012 / 0.132 | 0.492 / 0.696 |
| Remote / calculator / book | 0.129 / 0.401 | 0.023 / 0.354 | 0.017 / 0.354 | 0.473 / 0.670 |
| Laptop / keyboard | 0.039 / 0.070 | 0.008 / 0.021 | 0.004 / 0.050 | 0.464 / 0.607 |
| No phone (end) | 0.034 / 0.044 | 0.009 / 0.041 | 0.004 / 0.007 | 0.450 / 0.564 |
| Phone, portrait, close | 0.226 / 0.798 | 0.041 / 0.840 | 0.110 / 0.853 | 0.536 / 0.961 |
| Phone, arm's length | 0.496 / 0.756 | 0.241 / 0.870 | 0.518 / 0.928 | 0.668 / 0.924 |
| Phone, landscape | 0.437 / 0.784 | 0.323 / 0.803 | 0.217 / 0.848 | 0.691 / 0.945 |
| Phone, back to camera | 0.486 / 0.763 | 0.754 / 0.892 | 0.839 / 0.914 | 0.916 / 0.951 |
| Phone in hand, low | 0.490 / 0.662 | 0.627 / 0.837 | 0.756 / 0.935 | 0.836 / 0.901 |
| Phone, partly visible | 0.057 / 0.571 | 0.013 / 0.645 | 0.169 / 0.913 | 0.526 / 0.887 |

Step windows include the participant's transitions, so a phone step also contains some frames
without a phone. EfficientDet-Lite0's phone scores differed markedly from the earlier webcam session
(medians 0.06–0.33 then, 0.06–0.50 now), a reminder of how small this evidence is.

## Latency (single frame) and size

| Model | Size | CPU steady (Edge / packaged WebView2) | CPU cold start | GPU steady (Edge / WebView2) | GPU cold start (Edge, fresh) |
|---|---|---|---|---|---|
| EfficientDet-Lite0 | 7.3 MB | 299 ms / 67 ms* | 1.9 s | 115 ms (MediaPipe GPU) | 8.4 s |
| EfficientDet-Lite2 | 12.1 MB | 776 ms | 2.1 s | 267 ms (MediaPipe GPU) | 16.8 s |
| YOLOX-Nano | 3.7 MB | 226 ms / 171 ms | 2.1 s | 22 ms / 38 ms (WebGPU) | 3.1 s |
| YOLOX-Tiny | 20.2 MB | 628 ms / 580 ms | 2.9 s | 44 ms / 43 ms (WebGPU) | 5.7 s |
| YOLOX-S | 35.9 MB | **2,544 ms** | 4.6 s | 114 ms (WebGPU) | 6.0 s |
| D-FINE-N | 17.1 MB | 744 ms / 709 ms | 3.4 s | 124 ms / 155 ms (WebGPU) | 14.1 s |

CPU = WebAssembly, single thread (the app's WebView is not cross-origin isolated). Intel UHD
(gen-12lp) GPU. \*EfficientDet-Lite0 measured far faster inside WebView2 than in Edge; not explained.

- **WebGPU is available inside the packaged app's WebView2**, and ONNX Runtime Web ran under the app's
  exact CSP (`script-src 'self' 'wasm-unsafe-eval'`) with no violations, on WASM and WebGPU.
- **ONNX Runtime WebGPU scores were identical to CPU** on the parity sample (max difference 0.0000).
  **MediaPipe's GPU delegate was not**: EfficientDet-Lite0 differed from CPU by up to 0.088 and
  Lite2 by up to 0.264 — a threshold tuned on one path would not hold on the other.

## Assessment

- **EfficientDet-Lite0 (current):** weakest separation on images (AUC 0.698); on the webcam, empty
  hands reach 0.465 while close or partly visible phones have medians of 0.06–0.23. Licence unresolved.
- **EfficientDet-Lite2:** better on images (AUC 0.791) but ~0.78 s per frame on CPU, a large
  CPU/GPU score drift, and the same unresolved licence. Not tested live.
- **YOLOX-Nano:** fastest, but no better than Lite0 on images (AUC 0.683). Not tested live.
- **YOLOX-Tiny:** consistently low scores on phone-free scenes (images: median 0.015; webcam: every
  no-phone step's median ≤ 0.10, max ≤ 0.354), the most large phones scoring above every phone-free
  image (24/37), and phone steps reaching 0.80–0.89. Runs on both paths: ~0.6 s/frame CPU, ~44 ms
  WebGPU. Apache-2.0, verified. Weak on close-up and partly visible phones (medians 0.04 / 0.01).
- **YOLOX-S:** best image separability (AUC 0.810) and the cleanest webcam negatives, but 2.5 s per
  frame on CPU makes it unusable without a GPU; 114 ms on WebGPU.
- **D-FINE-N:** strong image AUC (0.809), but on the webcam it scores ~0.45 with no phone in view and
  up to 0.88 on empty hands — **its scores do not separate phones from ordinary webcam scenes.** Also a
  14 s WebGPU cold start and a non-reference export path. Not suitable.

## Recommendation

**YOLOX-Tiny is the most promising replacement candidate** — not a production-ready detector. It is
the only candidate that combines low phone-free scores on both datasets, clearly better high-score
separation than EfficientDet-Lite0 on the live webcam, a verified permissive licence, and acceptable
latency on both CPU (~0.6 s, the worst case the app must support) and WebGPU (~44 ms) with identical
scores on both. YOLOX-S would be the choice only if a GPU could be required, which is not decided.

What the evidence does **not** show: a defensible threshold. Even for YOLOX-Tiny, a close-up or
partly visible phone often scores below what empty hands or a remote reached (0.28–0.35). Single
frames are not reliable; frames scoring 0.8+ appeared in every phone step, which suggests that
evidence across time (a Phase 5C concern) may matter more than any single-frame cut-off.

## Required next step

1. **EfficientDet-Lite0 should remain** as the shipped detector (raw confidence, no decision) until a
   replacement is validated — it is not deleted or replaced by this evaluation.
2. **A replacement can be implemented reversibly**: YOLOX-Tiny as a second, selectable object-detector
   runtime behind the existing detector abstraction (ONNX Runtime Web, CPU with optional WebGPU),
   with EfficientDet-Lite0 kept. This needs a product decision, the ONNX Runtime licence notices in the
   installer, and ~20 MB (FP32) added to the installer.
3. **More representative validation data is required before any production threshold** — for any
   model: labelled webcam frames from several people, cameras, rooms, lighting conditions and phone
   models, including close-up and partly visible phones and common desk objects.

Steps 2 and 3 are not alternatives: a replacement can be built now, but only step 3 can justify a
"phone detected" decision.

---

# Reversible YOLOX-Tiny integration (2026-09-27)

**Status:** YOLOX-Tiny is integrated as a **second, opt-in object model** behind the existing
`AIRuntime → PhoneDetector → Observation` path. **EfficientDet-Lite0 remains the default and is
unchanged.** No threshold, no "phone detected" decision, no Phase 5C behaviour. Nothing committed.

## How it is selected

- Build-time flag `VITE_OBJECT_DETECTOR_MODEL` = `efficientdet_lite0` (default, also when unset) or
  `yolox_tiny`. An unknown value **fails the build** (`scripts/fetch-ai-assets.mjs`); if it ever
  reached the app, the runtime would report it as an error — it is never replaced by the default.
- The E2E test seam can choose the model per page (`window.__assessxAI.objectModel`).
- **No automatic fallback between models.** If YOLOX-Tiny cannot load (missing file, failed integrity
  check, no usable backend), object detection reports ERROR with the reason — it is not silently
  swapped for EfficientDet, whose scores mean something different. Face presence/count, tracking,
  head pose, gaze and frame quality keep running (verified by E2E).
- **Removal:** delete `ai/objectDetection/`, the `yolox_tiny` branch in `mediapipe/worker.ts`, the
  YOLOX entries in the asset script, the `onnxruntime-web` dependency and its Vite alias.

## Architecture changes (additive)

- `ai/objectDetection/models.ts` — model registry, provenance, processing contract, flag parsing.
- `ai/objectDetection/yolox.ts` — pure preprocessing (letterbox, BGR NCHW 0–255) and postprocessing
  (grid/stride decoding, objectness × class score, class-wise NMS); unit-tested.
- `ai/objectDetection/yoloxBackend.ts` — ONNX Runtime Web backend inside the **existing** AI worker:
  fetch → SHA-256 integrity check → session (WebGPU if an adapter exists and a warm-up inference
  succeeds within 30 s, else WebAssembly) → warm-up → first post-warm-up inference, each timed.
- `mediapipe/worker.ts` — the object step branches on the configured model; inference became async.
  The frame, scheduling, transfer and discard path is unchanged.
- The phone observation's detector id is now model-neutral (`object-detection`), and every
  observation carries `metadata.objectModel`. Telemetry reports the object backend (model,
  accelerator, load / warm-up / first-inference ms, fallback reason) and any load errors.
- Fixed while integrating: in development, a stopped pipeline's late STOPPED update could overwrite
  the live pipeline's state (React StrictMode remount); only the current pipeline now publishes.

## Model provenance and integrity

| | |
|---|---|
| File | `yolox_tiny.onnx`, 20,219,662 bytes |
| Source | `https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx` |
| Version | release `0.1.1rc0` (2021-08-18), commit `e1052df71842031413f6030723c3607b839c80ce` |
| SHA-256 | `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7` (pinned; checked at build and at load) |
| Graph | ONNX IR 6, opset 11, exported by PyTorch 1.7; ops Add, Concat, Conv, MaxPool, Mul, Reshape, Resize, Sigmoid, Slice, Transpose |
| Input | `images` float32 [1, 3, 416, 416] |
| Output | `output` float32 [1, 3549, 85] — per anchor cx, cy, w, h (raw), objectness, 80 COCO class scores (sigmoid in-graph) |
| Classes | contiguous COCO-80; **cell phone = 67** |
| Preprocessing | aspect-preserving resize, placed top-left, padded with 114; BGR; raw 0–255; NCHW |
| Postprocessing | strides 8/16/32 (52²+26²+13² anchors); centre = (raw + grid)·stride, size = exp(raw)·stride, ÷ letterbox scale; score = objectness × class; class-wise greedy NMS IoU 0.45 (YOLOX demo); **no score threshold** (the demo's 0.1 visualisation cut-off is not applied); top 1 candidate reported |

## Runtime, packaging and licensing

- `onnxruntime-web` **1.30.0** (MIT), pinned. Its WebGPU build loads the **asyncify** WebAssembly
  runtime (`ort-wasm-simd-threaded.asyncify.{mjs,wasm}`, 26.8 MB) at run time.
- The default build ships **neither the YOLOX model nor the ONNX Runtime WebAssembly**; they are
  included only when a build sets `VITE_OBJECT_DETECTOR_MODEL=yolox_tiny`. ONNX Runtime's 66 KB
  JavaScript is compiled into the AI worker of every build (inert unless YOLOX is selected).
- Notices (installed next to the app in every installer): `THIRD_PARTY_NOTICES.md` plus verbatim
  `third-party/YOLOX-LICENSE.txt`, `third-party/onnxruntime-LICENSE.txt` and
  `third-party/onnxruntime-ThirdPartyNotices.txt`. YOLOX **code** licence: Apache-2.0, verified (no
  NOTICE file upstream). YOLOX-Tiny **weights**: not separately stated — **unconfirmed**. ONNX
  Runtime: MIT, verified; its own npm dependencies (flatbuffers, guid-typescript, long,
  onnxruntime-common, platform, protobufjs) are listed; whether the prebuilt bundle inlines them is
  unverified.

## Measurements (production AI worker, same 418 images)

Full table: [benchmarks/models/results/comparison-integration.md](../apps/desktop/benchmarks/models/results/comparison-integration.md).

| | EfficientDet-Lite0 | YOLOX-Tiny (integrated) |
|---|---|---|
| CPU steady (median / p90) | 299 / 337 ms | 582 / 593 ms |
| GPU steady | 115 ms (MediaPipe GPU) | **51 ms** (WebGPU) |
| Load · warm-up · first inference after warm-up | no warm-up (cold start 1.85 s CPU / 8.4 s GPU) | CPU 1,686 · 731 · 581 ms; WebGPU 2,109 · 1,062 · 65 ms |
| Image AUC (all / large phones) | 0.698 / 0.936 | 0.756 / 0.963 |
| Phone-free median · max | 0.087 · 0.656 | 0.015 · 0.653 |
| Large phones above every phone-free image | 17/37 | 24/37 |
| Partial phones (box cut by frame edge, n = 10) above every phone-free image | 1/10 | 4/10 |
| CPU↔GPU score drift | up to 0.088 (11-image sample) | max 2.4×10⁻⁶, mean 1.8×10⁻⁷ over 418; boxes max Δ 1.8×10⁻⁶ |

The integrated YOLOX-Tiny reproduces the evaluation adapter exactly (418/418 images, max Δ 0.0000).
WebGPU really runs on the GPU (≈11× faster; 415/418 scores differ at float precision).

## Real webcam smoke test (production worker, both models on the same frames)

One participant, one laptop camera, 11 guided steps (~40 frames each); numbers only.

| Step — median / max | EfficientDet-Lite0 | YOLOX-Tiny |
|---|---|---|
| No phone (start · end) | 0.049 / 0.122 · 0.029 / 0.150 | 0.015 / 0.255 · 0.010 / 0.076 |
| Empty hands | 0.097 / 0.233 | 0.155 / 0.257 |
| Desk object (mouse/charger/remote) | 0.085 / 0.430 | 0.097 / 0.362 |
| Phone in hand | 0.438 / 0.622 | 0.469 / 0.769 |
| Phone close to camera | 0.295 / 0.745 | **0.038** / 0.949 |
| Phone partly visible | 0.573 / 0.800 | 0.702 / 0.845 |
| Phone on desk | 0.043 / 0.706 | **0.013** / 0.782 |
| Phone portrait · landscape · tilted back (medians) | 0.626 · 0.356 · 0.387 | 0.579 · 0.574 · 0.387 |

Pooled over all frames: **EfficientDet-Lite0 frame AUC 0.774, YOLOX-Tiny 0.710**; highest no-phone
frame 0.430 vs 0.362; phone frames above every no-phone frame 139/292 vs 148/292. **This session does
not show YOLOX-Tiny as clearly better** — it collapses on close-up and on-desk phones — whereas the
previous session favoured it. With one person and one camera, these sessions are anecdotes.

## Validation-dataset infrastructure

`apps/desktop/benchmarks/validation/`: `manifest.schema.json` (labels `PHONE_PRESENT` /
`PHONE_ABSENT`; person, camera, room, lighting, phone size/visibility/position/orientation/box,
distractor type, consent reference, person-level split, two labellers), `manifest.template.json`,
`validate.mjs` (schema rules, file SHA-256, labeller ≠ reviewer, no person in two splits, coverage
report; self-test `validate.test.mjs`), and `README.md` (consent, privacy, storage, collection and
labelling protocol). `benchmarks/models/run.mjs --dataset=<dir>` runs any model on a validated
dataset. **No dataset exists yet and none was fabricated.**

## Known limitations

- No production threshold exists for either model; the evidence does not support one.
- YOLOX-Tiny is weak on close-up and on-desk phones; EfficientDet-Lite0 on partly visible ones —
  both inconsistently across sessions.
- On CPU, YOLOX-Tiny (~0.58 s) plus the face tasks exceed the 500 ms sampling interval, so AI health
  reports DEGRADED ("slower than expected") on machines without WebGPU.
- A YOLOX-enabled installer carries ~27 MB (runtime) + 20 MB (model) more before compression.
- Before the first processed frame, a failed object model is visible in `loadErrors`, but the
  detector's own state updates only on that first frame (≈ one sampling interval).
- Model-weights licence unconfirmed; ONNX Runtime component notices not verified per component.
