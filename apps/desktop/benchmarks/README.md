# AI detector validation (Phase 5B)

Reproducible validation tooling for the on-device AI detectors. None of this is part of the app or
the automated test suite. Downloaded data and session results go to the git-ignored
`benchmarks/.cache/` and are never committed or redistributed.

## Phone detector benchmark (`phone/`)

Runs labelled images through the **production** MediaPipe worker (the built `dist/` bundle, same
models and options as the exam: cell phone only, top-1 candidate, CPU) and records the phone
confidence the detector would report.

```bash
npm run build                               # the benchmark uses the built worker bundle
node benchmarks/phone/prepare-coco.mjs      # selects + downloads COCO val2017 images (≈ 60 MB)
node benchmarks/phone/run.mjs               # writes benchmarks/phone/results/latest.{md,json}
```

**Data.** COCO val2017 (human-labelled; per-image licences recorded in the manifest): every image
with an annotated cell phone (214), and phone-free images containing a laptop, book, remote,
keyboard or mouse (194). Plus MediaPipe's own test images (7 of hands, the portrait) and two
synthetic empty frames. Selection is deterministic (sorted by image id).

**How to read it.** The report shows each group's score distribution and a threshold sweep (how many
phone images and phone-free images score at or above each value). It **does not choose a
threshold**. Limits to keep in mind:

- COCO scenes are generic photos, not webcam proctoring frames — a threshold from them is not a
  production threshold.
- COCO labels are incomplete: a "phone-free" image can contain an unlabelled phone.
- Small groups (e.g. 37 images with a large phone) — no statistical accuracy may be claimed.
- Not covered: headphones, calculators, notes, real in-hand webcam phones.

## Object-detector model evaluation (`models/`)

Compares candidate phone detectors on the same images, on CPU and GPU, and on the live webcam. It has
its own `package.json` (ONNX Runtime Web) so the app's dependencies are untouched. Findings:
`docs/PHASE-5B-OBJECT-MODEL-EVALUATION.md`.

```bash
cd benchmarks/models && npm install && cd ../..
node benchmarks/models/run.mjs                 # all candidates → results/*.json (models in .cache/models/)
node benchmarks/models/compare.mjs             # → results/comparison.md
node benchmarks/models/live-session.mjs        # guided live-webcam comparison (numbers only)
node benchmarks/models/webview-check.mjs       # inside the packaged app's WebView2, under the app's CSP
```

Model files (SHA-256 in the evaluation doc) live in the git-ignored `benchmarks/.cache/models/`.
D-FINE ONNX files are exported locally from the official checkpoints (see the doc for the command).
`yolox-tiny-app` runs the app's own integrated YOLOX-Tiny (production AI worker);
`node benchmarks/models/compare-integration.mjs` compares it with EfficientDet-Lite0 →
`results/comparison-integration.md`. `live-session.mjs --production` runs both through the production
worker on the live webcam.

## Validation dataset (`validation/`)

Schema, template, validator and collection/labelling protocol for a future representative webcam
dataset — see `validation/README.md`. No dataset exists yet.

## Guided real-webcam session (`webcam/`)

Opens a visible Edge window on the real camera and walks a participant through ~22 on-screen steps
(head/eye movement, leaving the frame, a phone in several positions, everyday objects, covering the
camera), then a simulated camera disconnect and reconnect, then submit. **Only the detectors' numeric
outputs are recorded — no image, frame or video.** Needs the backend running and ~5 minutes.

```bash
npx playwright test --config benchmarks/webcam/playwright.config.ts
SESSION_CAMERA=synthetic npx playwright test --config benchmarks/webcam/playwright.config.ts   # dry run, no camera
```
