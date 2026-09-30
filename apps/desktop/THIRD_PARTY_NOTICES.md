# Third-party notices — AssessX desktop (on-device AI proctoring)

This file lists the third-party AI runtime and models that the AssessX desktop application ships
(Phase 5B) and reproduces the licence text they are distributed under. It is installed next to the
application by the Windows installer (`bundle.resources` in `src-tauri/tauri.conf.json`).

> **Status: engineering record, not a legal opinion.** What is marked *verified* was checked against
> the primary source named in the table. Items marked *unverified* have not been confirmed and need
> review before distribution. This file does not claim licence compliance; a legal review is still
> required. Other dependencies of the application (fonts, UI libraries, the Tauri runtime) are not
> covered here.

## Shipped components

| Component | Version | Licence | Source | Licence verified from |
|---|---|---|---|---|
| MediaPipe Tasks Vision runtime (`@mediapipe/tasks-vision`, JS bundle + `vision_wasm_module_internal.{js,wasm}`) | 1.0.1 | Apache-2.0 | npm `@mediapipe/tasks-vision` (Google) | npm package metadata (`"license": "Apache-2.0"`); the package ships no LICENSE/NOTICE file, so the upstream MediaPipe `LICENSE` is reproduced below. Upstream has no NOTICE file. |
| BlazeFace short-range face detector (`blaze_face_short_range.tflite`) | float16 / 1 | Apache-2.0 | `storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/` | **Verified** — model card "MediaPipe BlazeFace Model Card (Short Range)": *Licensed under Apache License, Version 2.0* |
| Face Landmarker bundle (`face_landmarker.task`: Face Mesh V2 + Blendshape V2) | float16 / 1 | Apache-2.0 | `storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/` | **Verified** — model cards "MediaPipe Face Mesh V2" and "Blendshape V2": *Licensed under Apache License, Version 2.0* |
| EfficientDet-Lite0 object detector, COCO (`efficientdet_lite0.tflite`) | float16 / 1 | **Unverified** | `storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/` | **Not verified** — the MediaPipe object-detector page links no model card, and neither the model file nor its storage metadata states a licence. EfficientDet (Google AutoML) is published under Apache-2.0 upstream, but this MediaPipe build's licence must be confirmed. |

SHA-256 digests of the three model files are pinned in `scripts/fetch-ai-assets.mjs`.

### Opt-in YOLOX-Tiny object model and ONNX Runtime Web (added for Phase 5B validation)

YOLOX-Tiny is **off by default**. The YOLOX model file and ONNX Runtime's WebAssembly runtime are
included in an installer **only** when that build sets `VITE_OBJECT_DETECTOR_MODEL=yolox_tiny`.
ONNX Runtime Web's JavaScript (66 KB) is compiled into the AI worker of **every** build (inert unless
YOLOX is selected), so its notices ship with every installer. The verbatim upstream texts are
installed next to the application in `third-party/`.

| Component | Version | Licence | Source | Status |
|---|---|---|---|---|
| YOLOX source code (preprocessing/decoding reimplemented from its reference code) | release `0.1.1rc0`, commit `e1052df71842031413f6030723c3607b839c80ce` | Apache-2.0 | github.com/Megvii-BaseDetection/YOLOX | **Verified** — `LICENSE` at that commit (Apache-2.0, "Copyright 2021 Megvii, Base Detection"), reproduced as `third-party/YOLOX-LICENSE.txt`. The repository has **no NOTICE file**. |
| YOLOX-Tiny model (`yolox_tiny.onnx`, 20,219,662 B, SHA-256 `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7`) | release `0.1.1rc0` asset | **Not separately stated** | …/releases/download/0.1.1rc0/yolox_tiny.onnx | **Unconfirmed** — published as a release asset of the Apache-2.0 repository; neither the release nor the README states separate terms for the weights. Not assumed to inherit the code licence; needs confirmation. Trained on COCO (image licences vary). |
| ONNX Runtime Web (`onnxruntime-web`) | 1.30.0 (exact) | MIT | npm / github.com/microsoft/onnxruntime | **Verified** — `LICENSE` at tag v1.30.0, reproduced as `third-party/onnxruntime-LICENSE.txt`. The npm package ships no licence or notices file. |
| ONNX Runtime third-party components | v1.30.0 | Various (e.g. Eigen MPL-2.0, protobuf, Abseil, FlatBuffers, emsdk) | upstream `ThirdPartyNotices.txt` | Reproduced verbatim as `third-party/onnxruntime-ThirdPartyNotices.txt` (6,369 lines; covers all ONNX Runtime builds — which apply to the WebAssembly runtime is **unverified**). |
| `onnxruntime-web` npm dependencies | as locked | flatbuffers Apache-2.0 · guid-typescript ISC · long Apache-2.0 · onnxruntime-common MIT · platform MIT · protobufjs BSD-3-Clause | npm | Declared dependencies. Whether Microsoft's prebuilt `ort.webgpu.min.mjs` inlines any of them is **unverified**. |

SHA-256 of the reproduced texts: YOLOX-LICENSE `577c03d5…aabd51bd92`; onnxruntime-LICENSE
`2f07c727…587a48922c`; onnxruntime-ThirdPartyNotices `143764b9…fba356c83de3`.

### Libraries compiled into the WebAssembly runtime (unverified)

The npm package publishes no bill of materials. Identifier strings in
`vision_wasm_module_internal.wasm`/`.js` indicate that the runtime statically includes code from the
projects below. This list is a **heuristic, unverified** indication — not a complete or confirmed
inventory — and the licences shown are those the projects commonly publish, not checked against the
exact versions MediaPipe 1.0.1 builds with:

TensorFlow Lite (Apache-2.0) · XNNPACK (BSD-3-Clause) · Abseil (Apache-2.0) · Protocol Buffers
(BSD-3-Clause) · Eigen (MPL-2.0) · FlatBuffers (Apache-2.0) · ruy (Apache-2.0) · gemmlowp
(Apache-2.0) · OpenCV (Apache-2.0 for 4.5+, BSD-3-Clause earlier) · libjpeg / libjpeg-turbo (IJG,
BSD-3-Clause, zlib) · libpng (libpng licence) · Emscripten runtime (MIT / University of Illinois NCSA).

Their notices are not reproduced here yet — **open item for legal review.**

## Upstream MediaPipe LICENSE (verbatim)

Source: `https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE`, retrieved 2026-09-26,
SHA-256 `8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8`.

```text
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

===========================================================================
For files under tasks/cc/text/language_detector/custom_ops/utils/utf/
===========================================================================
/*
 * The authors of this software are Rob Pike and Ken Thompson.
 *              Copyright (c) 2002 by Lucent Technologies.
 * Permission to use, copy, modify, and distribute this software for any
 * purpose without fee is hereby granted, provided that this entire notice
 * is included in all copies of any software which is or includes a copy
 * or modification of this software and in all copies of the supporting
 * documentation for such software.
 * THIS SOFTWARE IS BEING PROVIDED "AS IS", WITHOUT ANY EXPRESS OR IMPLIED
 * WARRANTY.  IN PARTICULAR, NEITHER THE AUTHORS NOR LUCENT TECHNOLOGIES MAKE ANY
 * REPRESENTATION OR WARRANTY OF ANY KIND CONCERNING THE MERCHANTABILITY
 * OF THIS SOFTWARE OR ITS FITNESS FOR ANY PARTICULAR PURPOSE.
 */
```
