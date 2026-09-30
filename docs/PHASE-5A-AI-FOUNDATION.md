# Phase 5A — AI Proctoring Foundation (implemented)

**Status:** **5A implemented** (2026-09-26). It is the perception *foundation* only: the
camera→AI pipeline, a swappable runtime, a detector interface, a normalized observation contract,
technical health and performance telemetry. **No real detector ships in 5A** — face/count/object/
head-pose/gaze detectors are Phase 5B, and turning observations into persisted proctoring events is
Phase 5C. Phase 5 produces *observations, never verdicts*: there is no cheating score, risk score,
severity or termination anywhere in this layer.

> **Update — Phase 5B (2026-09-26).** The real detectors now run on this foundation; see
> [PHASE-5B-AI-DETECTORS.md](PHASE-5B-AI-DETECTORS.md). Building 5B also corrected parts of this
> document and code: the scheduler never drops ticks (it chains them — see "Bounded by design"),
> `start()` alone did not begin sampling (fixed), sampling now stops when the runtime fails, and the
> 250 ms latency placeholder was replaced by "slower than the sampling interval". Statements below
> that production "ships no model" describe 5A only.

> **Numbering note.** The product owner calls this **Phase 5 — AI Proctoring**; the roadmap numbers
> AI Proctoring as Phase 6 (its Phase 5, Live Admin Monitoring, was delivered as Phase 4C). Recorded,
> not silently reconciled — see `docs/PHASE-5-PLAN.md`.

## Source-of-truth finding (inference location)

There is **no separate "Phase 5 Knowledge Base" file** in the repository. The authoritative AI
guidance lives in the Master KB (`docs/Knowledge-Base/…`, §12–18, §44–49) and the TRD (§8–10, §34,
§49), both read in full. They:

- forbid sending every frame to the backend / through FastAPI (TRD §8, KB §45) and to an LLM (KB §44);
- describe the **eventual, scale-time** target — `Camera → CV workers → events → Redis → Risk Engine`,
  with GPU workers extracted "as scale increases" (KB §45–48, TRD §49) — as a later extraction, not
  a day-one requirement (TRD §49: "start as a modular monolith"; TRD §36/§46: do not add scaling
  infrastructure prematurely);
- name CV technologies only as *potential* (OpenCV, MediaPipe, YOLO, PyTorch) and require models to
  be **benchmarked before production** (TRD §10, §40) and to remain **replaceable** (TRD §34);
- require privacy-conscious handling and minimal/again biometric storage (KB §42, TRD §42).

They do **not** fix, for the desktop client, an inference location, a frame rate, a resolution, a
model version or a threshold. That decision is `OQ-11`, still open. Given the documents' hard rules
plus the current stack (no GPU worker, no Redis, no media-ingest tier) and the standing rule not to
introduce such infrastructure speculatively, the only compliant shape for 5A is **on-device
inference in the desktop app**, behind abstractions that keep a later move (a bundled native runtime,
or server-side workers) a change of *runtime* only. No model-specific value is invented; the numeric
defaults in `config.ts` are clearly-marked infrastructure placeholders for the Phase 5 KB / Phase 5B
to replace.

## Architecture

```
existing candidate camera (useMediaDevice)            ← one camera acquisition path; never re-opened
  │  MediaStream (also used by the Phase 4C WebRTC publisher)
  ▼
FrameProvider ──► FrameScheduler ──► AIRuntime ──► Detector(s) ──► Observation(s)
  (hidden video,   (controlled rate,   (load/infer/    (Frame → factual   (model-independent,
   ImageBitmap,     latest-frame-wins   unload +        observations)      no verdict fields)
   discard-after)   backpressure)       lifecycle)
                          │                                    │
                          └──────────► PipelineTelemetry   AIHealth (INITIALIZING/RUNNING/
                                        (fps, latency,      DEGRADED/ERROR/STOPPED, honest reason)
                                         drops, load ms)
```

Everything lives in the desktop app under
[apps/desktop/src/features/proctoring/ai/](../apps/desktop/src/features/proctoring/ai/). It is wired
into the active proctored exam in
[ProctoredExam.tsx](../apps/desktop/src/features/proctoring/ProctoredExam.tsx) (`EnforcedExam`), next
to the Phase 4C media publisher, and surfaces a factual header indicator (`AIStatus`).

| Concern | File | Notes |
|---|---|---|
| Contracts | `ai/types.ts` | `Frame`, `RawInference`, `Observation`, `AIRuntime`, `Detector`, `AIHealth`, `PipelineTelemetry` |
| Frame acquisition | `ai/frameProvider.ts` | Reuses the proctoring `MediaStream`; hidden `<video>` → `ImageBitmap`; `close()` discards pixels |
| Sampling / backpressure | `ai/scheduler.ts` | Controlled rate; **one frame in flight**, newest wins; drop/unavailable/latency counters, monotonic clock |
| Runtime lifecycle | `ai/types.ts` + `ai/pipeline.ts` | `UNINITIALIZED→LOADING_MODEL→READY→RUNNING→STOPPING→STOPPED`, `LOAD_FAILED`/`ERROR` |
| Detector interface | `ai/types.ts` | `init/process/shutdown` + per-detector state; 5B implements the real ones |
| Observation model | `ai/types.ts` | Factual; `confidence` is **model** confidence (0..1) or null — never a cheating probability |
| Health | `ai/health.ts` | Honest technical state + reason; never "secure" when not running |
| Orchestration | `ai/pipeline.ts` | Ties it together, session-scoped, discards each frame after inference |
| Runtime selection / test seam | `ai/seam.ts` | Production 5A = **no runtime**; `window.__assessxAI` injects the mock for tests |
| Test-only mock | `ai/testRuntime.ts` | Deterministic mock runtime + detector; `productionCapable: false`; never selected in the app |
| React binding | `ai/useAIPipeline.ts` | Starts with the session, stops (and releases) on unmount; reuses the camera |
| Candidate UI | `ai/AIStatus.tsx` | "AI monitoring: active / starting / limited / unavailable" — factual, no verdict |

## What 5A does, and does not, do

- **Reuses the existing camera.** No second `getUserMedia`, no second capture; the AI frame provider
  is a second *consumer* of the stream the proctoring check already opened.
- **Bounded by design.** At most one frame is ever in flight: the next capture is scheduled only
  after the previous frame finishes, so there is no queue at all and each capture takes the newest
  frame; slow inference lowers the processed rate instead of accumulating frames. (Corrected in 5B:
  this originally said mid-inference ticks were counted as drops — ticks never overlap, so
  `framesDropped` is 0 by construction.)
- **Discards frames.** Each frame's pixels are released immediately after inference. Nothing is
  stored, uploaded, screenshotted or logged; there is no backend call and no new database table.
- **Fails honestly.** No runtime → DEGRADED ("model not installed — arriving in Phase 5B"); failed
  load → ERROR; lost camera → DEGRADED; slow inference → DEGRADED; a technical failure is never
  turned into a statement about the candidate.
- **Session-scoped.** Runs only inside an active proctored attempt and stops — releasing the video
  element, scheduler, detectors and runtime — when the exam ends or the component unmounts.
- **Ships no real model.** In the packaged app there is no CV runtime yet, so the pipeline reports
  DEGRADED rather than running a mock that pretends to detect. The mock is test-only.

**Not in 5A:** any real detector, event correlation, risk/cheating scoring, evidence capture,
persistence of observations, Redis/workers/GPU tier, and the full Phase 5C admin AI-monitoring UI.

## How Phase 5B plugs in

A real detector implements `Detector` (`init/process/shutdown`) and its model is loaded by an
`AIRuntime` implementation (e.g. an ONNX-Runtime-web or MediaPipe-Tasks runtime) whose `infer()`
returns a `RawInference` the detector reads. `selectComponents()` in `ai/seam.ts` is the one place
that chooses the runtime and detectors for a build; 5B replaces its production branch (currently
"no runtime") with the real runtime + detector list. The frame provider, scheduler, backpressure,
health, telemetry, lifecycle and UI need no change. Per-detector sampling rates fit the scheduler's
config seam; the exact rates, resolutions, model versions and thresholds come from the Phase 5 KB.

## Testing

Frontend verification is `tsc` + `oxlint` + Playwright E2E (this project has no frontend unit-test
runner). The E2E suite
([apps/desktop/e2e/ai-proctoring.spec.ts](../apps/desktop/e2e/ai-proctoring.spec.ts)) drives the
deterministic mock through the seam over a synthetic camera and asserts the real behaviour:

1. the pipeline starts with the exam, reaches RUNNING, samples frames into `FRAME_OBSERVED`
   observations, and **stops** (releasing resources) on submit;
2. a failed model load is reported as **unavailable/ERROR**, never as monitoring;
3. with no model installed the pipeline reports **limited/DEGRADED**, never active.

Results (2026-09-26): desktop E2E **66 passed** (63 Phase 4 + 3 Phase 5A, no regression); frontend
production build passes (`tsc -b && vite build`); Rust **16 passed** (unchanged); backend unchanged.

## Open items / limitations (honest)

1. **No production model or on-device performance data yet.** Running a real YOLO/MediaPipe runtime
   inside WebView2 on arbitrary Windows machines (some without a GPU) is unproven; 5B must benchmark
   accuracy and latency (TRD §40) and prove the CPU-fallback and DEGRADED paths on real hardware.
2. **Inference location (OQ-11) is settled only for 5A** (on-device, constraint-forced). A future
   move to server-side workers remains an `AIRuntime` swap plus a media-ingest decision (OQ-14); the
   Phase 5 KB should confirm the long-term choice.
3. **Config defaults are placeholders**, not KB/product values (see `ai/config.ts`).
4. **Observations are in-memory in 5A.** Persisting them as factual proctoring events (reusing the
   Phase 4B store) and propagating them to admin monitoring is Phase 5C.
