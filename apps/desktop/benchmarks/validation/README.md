# Phone-detection validation dataset (structure and protocol)

**No dataset exists yet.** This folder defines how a *representative webcam* validation dataset must
be collected, labelled, checked and used, so that a phone-detection threshold can one day be chosen
on evidence. Nothing here contains or fabricates results.

Why it is needed: the current benchmark (418 COCO/MediaPipe images, `../phone`) is generic
photography, not webcam proctoring frames, and one short webcam session with one person is anecdotal.
Neither represents the population AssessX will run on, so neither can justify a production
threshold (docs/PHASE-5B-OBJECT-MODEL-EVALUATION.md).

## 1. Consent, privacy and storage (before any capture)

These are photographs of people's faces — personal and biometric-adjacent data (KB §42, PRD NFR-005).

- Capture only under an **approved consent protocol**, recorded in the manifest as `consentProtocol`,
  with each participant's consent referenced per sample (`consent_ref`) — the consent records
  themselves are kept elsewhere, not in the manifest.
- Participants are told what is captured, why, where it is stored, for how long, and how to withdraw;
  withdrawal deletes their samples.
- **Pseudonymous ids only** (`P07`, `C2`, `R3`). No names, emails or identifying notes.
- **Never commit images to git.** Store datasets in an access-controlled location, outside the repo,
  with a defined retention period. The manifest may be shared; the images only with authorised people.
- This dataset is a separate, consented research collection. The AssessX app itself never stores
  camera frames, and nothing in this folder changes that.
- Jurisdiction-specific requirements must be reviewed before collection (OQ-13).

## 2. Layout

```
<dataset-name>/
  manifest.json      # validated against manifest.schema.json
  images/            # JPEG/PNG frames, referenced by manifest entries
```

Start from `manifest.template.json`. Each sample records its file, SHA-256, label and scenario:

| Field | Values / meaning |
|---|---|
| `label` | `PHONE_PRESENT` (any part of a **mobile phone** is visible, including partly) · `PHONE_ABSENT` |
| `person`, `camera`, `room` | pseudonymous ids |
| `lighting` | `bright` · `normal` · `dim` · `backlit` · `mixed` |
| `phone_size` | box area / frame area: `small` < 1% · `medium` 1–5% · `large` ≥ 5% (present only) |
| `phone_visibility` | `full` · `partial_frame_edge` · `partial_occluded` (present) · `none` (absent) |
| `phone_position` | `in_hand_face_level` · `in_hand_chest_level` · `in_hand_lap` · `at_ear` · `on_desk` · `against_object` · `other` |
| `phone_orientation` | `portrait_/landscape_` + `screen_facing`/`back_facing` · `flat` · `edge_on` · `other` |
| `phone_box` | normalised box around the visible part of the phone (present only) |
| `distractor_type` | `none` · `empty_hands` · `laptop` · `keyboard` · `mouse` · `usb_device` · `charger_cable` · `remote` · `calculator` · `book_notes` · `headphones_earbuds` · `mug_bottle` · `tablet` · `second_monitor` · `other` |
| `split` | `calibration` or `holdout`, **assigned by person** |
| `labelled_by`, `reviewed_by` | two different labellers |

A tablet is **not** a phone (label it `PHONE_ABSENT`, distractor `tablet`), so that "phone" keeps one
meaning.

## 3. Collection protocol

Cover the scenario space deliberately rather than by chance:

- **People:** many participants, varied skin tones, ages, glasses/no glasses, head coverings.
- **Cameras:** built-in laptop cameras and external USB webcams, several resolutions and qualities.
- **Rooms and lighting:** every `lighting` value; plain and cluttered backgrounds.
- **Phones:** several phone models, colours and cases; every `phone_size`, `phone_visibility`,
  `phone_position` and `phone_orientation` value — especially close-up and partly visible phones,
  where the evaluation showed the models are weakest.
- **Negatives:** every `distractor_type`, including the documented false positives (laptop touchpad,
  USB receiver, remote, keyboard, mouse, empty hands).
- Sample frames from short clips at a fixed interval (not consecutive frames), so samples are not
  near-duplicates.

How many samples are enough is a **product decision** to make from the precision wanted: choose a
target confidence-interval width for the false-positive and detection rates (e.g. Wilson intervals)
and derive the per-scenario counts from it. The validator prints coverage so gaps are visible.

## 4. Labelling

- Label from the image alone, following the definitions above; record the guide version
  (`labellingGuideVersion`).
- Two independent labellers per sample; disagreements are adjudicated, and the adjudicated label is
  the one recorded (`reviewed_by` = the second person).
- Draw `phone_box` around the **visible** part of the phone; compute `phone_size` from it.

## 5. Using it

```bash
node benchmarks/validation/validate.mjs <dataset-dir>              # must print VALID
node benchmarks/models/run.mjs efficientdet-lite0 yolox-tiny-app --dataset=<dataset-dir>
```

Results go to `benchmarks/models/results/<dataset-name>/`, one score per sample per model, with the
scenario attached for per-scenario analysis.

**Rules:** choose any threshold on `calibration` only and report it once on `holdout` (never tune on
holdout); report per-scenario results, not just an average; never mix these results with the COCO
benchmark; never add, alter or "clean up" samples to improve a number.

Self-test of the validator: `node --test benchmarks/validation/validate.test.mjs`.
