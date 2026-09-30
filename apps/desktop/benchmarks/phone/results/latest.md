Images: 418 (214 with a phone, 204 without). Errors: 0.

| Group | Label | n | min | p10 | median | p90 | max |
|---|---|---|---|---|---|---|---|
| phone | phone | 214 | 0.008 | 0.041 | 0.177 | 0.686 | 0.851 |
| laptop | no-phone | 40 | 0.012 | 0.029 | 0.083 | 0.284 | 0.656 |
| book | no-phone | 40 | 0.015 | 0.025 | 0.042 | 0.128 | 0.264 |
| remote | no-phone | 40 | 0.022 | 0.039 | 0.083 | 0.173 | 0.328 |
| keyboard | no-phone | 40 | 0.045 | 0.059 | 0.123 | 0.239 | 0.521 |
| mouse | no-phone | 34 | 0.033 | 0.043 | 0.111 | 0.197 | 0.492 |
| hands | no-phone | 7 | 0.021 | 0.021 | 0.085 | 0.100 | 0.113 |
| face (portrait) | no-phone | 1 | 0.056 | 0.056 | 0.056 | 0.056 | 0.056 |
| empty frame | no-phone | 2 | 0.004 | 0.004 | 0.004 | 0.004 | 0.006 |

| Phone size (largest annotated) | n | median score |
|---|---|---|
| phone < 1% of frame | 130 | 0.108 |
| phone 1–5% of frame | 47 | 0.418 |
| phone ≥ 5% of frame | 37 | 0.616 |

| Threshold | Phones at/above (recall on this set) | Phone-free images at/above (false positives) | Of which remote |
|---|---|---|---|
| 0.05 | 182/214 (85%) | 155/204 | 32/40 |
| 0.1 | 146/214 (68%) | 87/204 | 16/40 |
| 0.15 | 115/214 (54%) | 41/204 | 9/40 |
| 0.2 | 101/214 (47%) | 20/204 | 4/40 |
| 0.25 | 88/214 (41%) | 14/204 | 3/40 |
| 0.3 | 82/214 (38%) | 9/204 | 1/40 |
| 0.35 | 73/214 (34%) | 8/204 | 0/40 |
| 0.4 | 63/214 (29%) | 6/204 | 0/40 |
| 0.5 | 46/214 (21%) | 3/204 | 0/40 |
| 0.6 | 34/214 (16%) | 1/204 | 0/40 |
| 0.7 | 21/214 (10%) | 0/204 | 0/40 |
| 0.8 | 5/214 (2%) | 0/204 | 0/40 |

Highest-scoring phone-free images:
- 000000063740.jpg (laptop): 0.656
- 000000078420.jpg (laptop): 0.599
- 000000068765.jpg (keyboard): 0.521
- 000000042889.jpg (keyboard): 0.498
- 000000513688.jpg (mouse): 0.492
- 000000110449.jpg (laptop): 0.465
- 000000248314.jpg (keyboard): 0.388
- 000000131138.jpg (laptop): 0.362
- 000000201646.jpg (remote): 0.328
- 000000189820.jpg (keyboard): 0.291

Lowest-scoring phone images:
- 000000522393.jpg (phone 0.00% of frame): 0.008
- 000000176606.jpg (phone 0.02% of frame): 0.008
- 000000032887.jpg (phone 0.01% of frame): 0.014
- 000000076416.jpg (phone 1.62% of frame): 0.018
- 000000442456.jpg (phone 0.01% of frame): 0.019

Object-detector time per image (CPU): median 233.400 ms, p90 241.800 ms.
