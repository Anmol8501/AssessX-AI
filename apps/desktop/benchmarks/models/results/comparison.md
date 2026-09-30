# Object-detector comparison (engineering comparison — not an accuracy study)

## Phone separability (CPU, full dataset: 214 phone images, 204 phone-free)

| Model | AUC all phones | AUC phones ≥5% | median phone | median phone ≥5% | median phone-free | max phone-free | phones above every phone-free image | large phones above every phone-free image |
|---|---|---|---|---|---|---|---|---|
| efficientdet-lite0 | 0.698 | 0.936 | 0.177 | 0.616 | 0.087 | 0.656 | 26/214 | 17/37 |
| efficientdet-lite2 | 0.791 | 0.973 | 0.312 | 0.688 | 0.066 | 0.693 | 36/214 | 18/37 |
| yolox-nano | 0.683 | 0.920 | 0.059 | 0.588 | 0.014 | 0.598 | 33/214 | 18/37 |
| yolox-tiny | 0.756 | 0.963 | 0.169 | 0.799 | 0.015 | 0.653 | 50/214 | 24/37 |
| yolox-s | 0.810 | 0.965 | 0.475 | 0.800 | 0.023 | 0.753 | 58/214 | 19/37 |
| dfine-n | 0.809 | 0.964 | 0.551 | 0.877 | 0.175 | 0.793 | 52/214 | 23/37 |

## Descriptive counts at fixed cut-offs (NOT chosen thresholds)

| Model | cut-off | phones at/above (TP) | phones below (FN) | large phones at/above | phone-free at/above (FP) | FP by group |
|---|---|---|---|---|---|---|
| efficientdet-lite0 | 0.3 | 82 | 132 | 30/37 | 9 | laptop 4, remote 1, keyboard 3, mouse 1 |
| efficientdet-lite0 | 0.5 | 46 | 168 | 24/37 | 3 | laptop 2, keyboard 1 |
| efficientdet-lite0 | 0.7 | 21 | 193 | 15/37 | 0 | — |
| efficientdet-lite2 | 0.3 | 110 | 104 | 34/37 | 11 | laptop 3, book 2, remote 1, keyboard 5 |
| efficientdet-lite2 | 0.5 | 73 | 141 | 24/37 | 2 | laptop 1, keyboard 1 |
| efficientdet-lite2 | 0.7 | 35 | 179 | 18/37 | 0 | — |
| yolox-nano | 0.3 | 62 | 152 | 23/37 | 4 | laptop 1, keyboard 2, mouse 1 |
| yolox-nano | 0.5 | 43 | 171 | 20/37 | 1 | keyboard 1 |
| yolox-nano | 0.7 | 27 | 187 | 17/37 | 0 | — |
| yolox-tiny | 0.3 | 85 | 129 | 27/37 | 9 | laptop 2, remote 2, keyboard 5 |
| yolox-tiny | 0.5 | 59 | 155 | 25/37 | 3 | laptop 1, remote 1, keyboard 1 |
| yolox-tiny | 0.7 | 45 | 169 | 23/37 | 0 | — |
| yolox-s | 0.3 | 127 | 87 | 31/37 | 15 | laptop 3, book 1, remote 4, keyboard 6, mouse 1 |
| yolox-s | 0.5 | 103 | 111 | 27/37 | 7 | laptop 2, remote 1, keyboard 4 |
| yolox-s | 0.7 | 70 | 144 | 25/37 | 1 | laptop 1 |
| dfine-n | 0.3 | 160 | 54 | 36/37 | 52 | laptop 16, book 4, remote 9, keyboard 14, mouse 8, hands 1 |
| dfine-n | 0.5 | 119 | 95 | 31/37 | 14 | laptop 2, book 2, remote 2, keyboard 6, mouse 2 |
| dfine-n | 0.7 | 76 | 138 | 24/37 | 5 | laptop 1, remote 1, keyboard 2, mouse 1 |

## Latency (single frame, ms) and size

| Model | size (MB) | CPU cold start | CPU steady median (p90) | GPU path | GPU cold start | GPU steady median (p90) | CPU↔GPU max score diff (sample) |
|---|---|---|---|---|---|---|---|
| efficientdet-lite0 | 7.3 | 1852 | 299 (337) | GPU | 8388 | 115 (120) | 0.0882 |
| efficientdet-lite2 | 12.1 | 2061 | 776 (841) | GPU | 16815 | 267 (315) | 0.2642 |
| yolox-nano | 3.7 | 2114 | 226 (256) | webgpu | 3076 | 22 (25) | 0.0000 |
| yolox-tiny | 20.2 | 2931 | 628 (696) | webgpu | 5671 | 44 (48) | 0.0000 |
| yolox-s | 35.9 | 4574 | 2544 (3575) | webgpu | 5970 | 114 (122) | 0.0000 |
| dfine-n | 17.1 | 3439 | 744 (782) | webgpu | 14129 | 124 (131) | 0.0000 |

CPU = WebAssembly, single thread (the app’s WebView is not cross-origin isolated). Cold start = model load + first inference in a freshly launched browser.
