# EfficientDet-Lite0 vs integrated YOLOX-Tiny (engineering comparison)

Both through the app's production AI worker, same 418 images (214 with a phone, 204 without). No threshold is chosen; cut-off columns are descriptive only.

| | EfficientDet-Lite0 (MediaPipe, default) | YOLOX-Tiny (ONNX Runtime Web, opt-in) |
|---|---|---|
| Licence | Model **unresolved**; runtime Apache-2.0 | Code Apache-2.0 (verified); weights not separately stated (unconfirmed); ORT MIT |
| Model size | 7.3 MB | 20.2 MB (+26.8 MB ORT WebAssembly) |
| Input | 1×320×320×3 float32 (NHWC) | 1×3×416×416 float32 (NCHW, BGR, 0..255, letterbox) |
| CPU steady (median / p90) | 299 / 337 ms | 582 / 593 ms |
| GPU path | MediaPipe GPU delegate | ONNX Runtime WebGPU |
| GPU steady (median / p90) | 115 / 120 ms | 51 / 54 ms |
| CPU cold start (load + first inference) | 1852 ms | 4371 ms |
| GPU cold start (load + first inference) | 8388 ms | 4063 ms |
| Warm-up (CPU / GPU) | none (first inference is the cold one) | load 1686 · warm-up 731 · first 581 ms / load 2109 · warm-up 1062 · first 65 ms |
| Separability AUC (all phones / large phones) | 0.698 / 0.936 | 0.756 / 0.963 |
| Phone confidence: median · p90 · max | 0.177 · 0.686 · 0.851 | 0.169 · 0.840 · 0.964 |
| Phone-free confidence: median · p90 · max | 0.087 · 0.198 · 0.656 | 0.015 · 0.188 · 0.653 |
| Large phones (≥5% of frame) above every phone-free image | 17/37 | 24/37 |
| Large phones at/above 0.5 (descriptive) | 24/37 | 25/37 |
| Partial phones (box cut by frame edge, n=10): median · above every phone-free image | 0.190 · 1/10 | 0.034 · 4/10 |
| Phone-free images at/above 0.5 (descriptive) | 3/204 | 3/204 |
| Highest-scoring phone-free images | 000000063740 (laptop) 0.66; 000000078420 (laptop) 0.60; 000000068765 (keyboard) 0.52; 000000042889 (keyboard) 0.50 | 000000004795 (laptop) 0.65; 000000068765 (keyboard) 0.55; 000000190637 (remote) 0.52; 000000255165 (keyboard) 0.50 |
| CPU↔GPU score drift: max · mean |Δ| (images compared) | 8.82e-2 · 1.76e-2 (11) | 2.39e-6 · 1.76e-7 (418) |
| CPU↔GPU top box: median IoU · boxes with IoU < 0.9 | not recorded (earlier run stored scores only) | 1.000 · 0 |
| …where either score ≥ 0.5: images · minimum IoU | — | 62 · 1.000 |

Integrated YOLOX-Tiny vs the evaluation harness adapter (CPU, 418 images): max |Δscore| 0.0000, mean 0.00000.

CPU = WebAssembly, single thread. "EfficientDet GPU" drift figures come from an 11-image parity sample; YOLOX drift uses all 418 images.
