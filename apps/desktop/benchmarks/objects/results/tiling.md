# Object detection: whole frame vs whole frame + tiles (COCO cache)

Generated 2026-10-02T13:32:42.583Z by benchmarks/objects/tiling.mjs. 408 COCO val2017 images (COCO val2017).
Rates are the share of images whose best candidate of the class reaches the provisional threshold.
Single images, no temporal confirmation: the app additionally requires two sightings within 6 s.

## yolox_s (webgpu; thresholds phone 0.45, book 0.5, laptop 0.55, remote 0.5)

| Images | n | Whole frame | + tiles |
|---|---|---|---|
| Phone, tiny (< 1% of frame) | 130 | 35% | 55% |
| Phone, small (1–5%) | 47 | 77% | 79% |
| Phone, large (≥ 5%) | 37 | 73% | 78% |
| Phone, all | 214 | 50% | 64% |
| book images: book found | 40 | 30% | 45% |
| laptop images: laptop found | 40 | 75% | 78% |
| remote images: remote found | 40 | 45% | 60% |
| **False alarm:** phone-free images with a "phone" | 194 | 4% | 10% |
| Keyboard/mouse images with a "book" (COCO scenes often contain one) | 74 | 5% | 16% |
| Keyboard/mouse images with a "laptop" (COCO scenes often contain one) | 74 | 53% | 61% |
| Keyboard/mouse images with a "remote" (COCO scenes often contain one) | 74 | 7% | 9% |

## yolox_tiny (webgpu; thresholds phone 0.45, book 0.5, laptop 0.55, remote 0.5)

| Images | n | Whole frame | + tiles |
|---|---|---|---|
| Phone, tiny (< 1% of frame) | 130 | 12% | 35% |
| Phone, small (1–5%) | 47 | 49% | 70% |
| Phone, large (≥ 5%) | 37 | 68% | 78% |
| Phone, all | 214 | 30% | 50% |
| book images: book found | 40 | 18% | 33% |
| laptop images: laptop found | 40 | 68% | 80% |
| remote images: remote found | 40 | 25% | 40% |
| **False alarm:** phone-free images with a "phone" | 194 | 2% | 6% |
| Keyboard/mouse images with a "book" (COCO scenes often contain one) | 74 | 5% | 9% |
| Keyboard/mouse images with a "laptop" (COCO scenes often contain one) | 74 | 55% | 64% |
| Keyboard/mouse images with a "remote" (COCO scenes often contain one) | 74 | 3% | 5% |

