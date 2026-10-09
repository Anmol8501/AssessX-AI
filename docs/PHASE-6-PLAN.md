# Phase 6 — Risk & Evidence (6A, 6B and 6C implemented)

**Status:** **6A implemented** (2026-10-01) — [`PHASE-6A-RISK-ENGINE.md`](PHASE-6A-RISK-ENGINE.md);
decisions taken for 6A: PRD FR-015 bands (open item 2), readiness-check apps do not contribute, any
admin may read risk, risk derived on demand (open item 9). **6B implemented** (2026-10-01) —
[`PHASE-6B-EVIDENCE.md`](PHASE-6B-EVIDENCE.md): structured, derived evidence (no media, no new table;
open item 3 stays open for media). **6C implemented** (2026-10-01) —
[`PHASE-6C-HUMAN-REVIEW.md`](PHASE-6C-HUMAN-REVIEW.md): decisions taken for 6C on open items 4 (case-level
outcomes NO_ACTION / CLEARED / FLAGGED / INVALIDATED plus per-evidence confirm/dismiss marks; FLAGGED stands
in for FR-018 "escalate case"), 5 (stays admin-only) and 6 (an append-only `audit_logs` table for review
actions; evidence-read logging and hash chaining stay open).
Originally recorded as a plan (2026-10-01). The product owner gave this plan and said
**"do not code anything right now"**. Nothing here is implemented, and none of it starts until the
product owner explicitly names a stage (6A, 6B or 6C). The plan is recorded as given below; conflicts
with the PRD/TRD and decisions still needed are listed under **Open items**. They are flagged, not
resolved.

> **Numbering note.** The product owner calls this **Phase 6 — Risk & Evidence**. In
> [`DEVELOPMENT-ROADMAP.md`](DEVELOPMENT-ROADMAP.md) Risk & Evidence is **Phase 7**, because the AI
> Proctoring work delivered as "Phase 5" is the roadmap's Phase 6. The same divergence is recorded in
> `PHASE-5-PLAN.md`. Recorded, not reconciled (open item 1).

**Builds on:** Phase 4B/4B.5 factual events (`proctoring_events`: focus, fullscreen, clipboard,
prohibited apps, devices…) and Phase 5C AI observation episodes (`FACE_NOT_DETECTED`,
`MULTIPLE_FACES_DETECTED`, `HEAD_ORIENTATION_CHANGED`, `CAMERA_TOO_DARK`, `FACE_TOO_FAR`,
`FACE_TOO_CLOSE`, each a started/resolved pair with a server-computed duration). See
[`PHASE-5C-AI-EVENT-INTEGRATION.md`](PHASE-5C-AI-EVENT-INTEGRATION.md). Phase 5C deliberately stopped at
factual events: it has no score, risk or verdict. Phase 6 is where risk begins.

**Guiding principle (unchanged, PRD §2 / KB):** *Detect → Correlate → Explain → Evidence → Human
Review.* The AI never decides that a candidate cheated.

---

## The plan (as given by the product owner)

Phase 6 is divided into exactly three parts.

### Part 6A — Risk Engine & Event Correlation

**Goal:** turn individual Phase 5C (and Phase 4) events into a meaningful risk assessment. Individual
events should not immediately mean "cheating":

```
Candidate looks away once → HEAD_ORIENTATION_CHANGED → no major concern

FACE_NOT_DETECTED + WINDOW_FOCUS_LOST + MULTIPLE_FACES_DETECTED → higher risk pattern
```

Part 6A introduces **correlation**.

1. **Event weighting.** Different events have different importance. Example concept:

   | Event | Example weight |
   |---|---|
   | FACE_TOO_FAR | Low |
   | HEAD_ORIENTATION_CHANGED | Low |
   | FACE_NOT_DETECTED | Medium |
   | FOCUS_LOST | Medium |
   | MULTIPLE_FACES_DETECTED | High |
   | Prohibited app detected | High |

   These are **risk contributions, not cheating probabilities**.

2. **Temporal correlation.** Consider *when* events happened. For example:

   ```
   10:20:01  HEAD_ORIENTATION_CHANGED
   10:20:03  HEAD_ORIENTATION_CHANGED
   10:20:04  FOCUS_LOST
   10:20:06  FACE_NOT_DETECTED
   ```

   These are not four unrelated events. AssessX can identify one **possible correlated episode**
   (10:20:01–10:20:06), which reduces noisy individual signals.

3. **Risk score.** A session-level and/or time-window risk score:

   ```
   Event → Weight → Temporal correlation → Risk contribution → Aggregate risk
   ```

   Example bands: 0–100, with 0–29 Low, 30–59 Medium and 60–100 High. The exact thresholds must be
   **configurable and validated**, not assumed to represent a probability of cheating.

4. **Risk decay.** Old events should not permanently dominate the exam: a contribution (for example,
   looking away at 10:10) gradually decreases over time, giving a time-aware risk model.

**6A output**, for example:

```json
{ "attempt_id": 123, "current_risk": 64, "risk_level": "HIGH", "active_episodes": 2 }
```

**Never** return anything like `"candidate_cheated": true`. The system provides risk signals, not a
final accusation.

### Part 6B — Evidence Generation & Evidence Timeline

**Goal:** a risk score alone is not enough. An administrator must be able to see *why* an attempt
received its risk level. Part 6B converts important events into a structured evidence timeline.

1. **Evidence records.** For relevant events, a record containing:
   * evidence ID, attempt ID, event ID, event type;
   * timestamp and duration;
   * severity / risk contribution;
   * source and metadata.

   Example: *Evidence #1042 — 10:24:31 — MULTIPLE_FACES_DETECTED — 4.2 s — source: AI Proctoring —
   risk contribution: High.*

2. **Evidence timeline.** The admin sees the sequence, not a giant list:

   ```
   10:05 ───────────────────────────── 11:05
   10:14 ● Head orientation changed
   10:21 ● Face not detected
   10:32 ● Focus lost
   10:32 ● Face not detected
   10:48 ● Multiple faces detected
   ```

3. **Evidence grouping.** Related events are grouped into an episode. Instead of five separate
   FACE_NOT_DETECTED rows, show one: *FACE_NOT_DETECTED — duration 8.4 s, 10:21:32–10:21:40,
   occurrences 5.* This matches the Phase 5C lifecycle, DETECTED → ONGOING → RESOLVED.

4. **Evidence integrity.** This matters particularly for a proctoring product. Evidence must be:
   * associated with the correct attempt and the correct candidate;
   * timestamped server-side where possible;
   * protected from unauthorized modification;
   * access-controlled and auditable.

   Avoid storing unnecessary raw biometric/media data. The principle stays *Detect → Correlate →
   Explain → Evidence → Human Review*.

5. **Evidence API**, for example:

   ```
   GET /admin/attempts/{attempt_id}/risk
   GET /admin/attempts/{attempt_id}/events
   GET /admin/attempts/{attempt_id}/evidence
   GET /admin/attempts/{attempt_id}/timeline
   ```

   The exact routes should follow the existing API conventions rather than create duplicate patterns.

### Part 6C — Admin Risk Review & Human Decision

**Goal:** a proper interface for the administrator to investigate an attempt. This is where Phase 6
becomes useful for the product.

1. **Risk overview.** For example: candidate, assessment, duration (60 min); risk HIGH; evidence
   (12 events, 4 episodes); started 10:00; submitted 11:00.

2. **Risk timeline.** A chronological view, for example: 10:08 normal · 10:19 head orientation changed ·
   10:27 face not detected (3.4 s) · 10:41 focus lost · 10:42 face not detected · 10:53 multiple faces
   detected (5.1 s). The admin can select an event and inspect its details.

3. **Evidence details.** For example, selecting MULTIPLE_FACES_DETECTED shows:
   * started 10:53:21 and ended 10:53:26 (duration 5.1 s);
   * source AI Proctoring;
   * risk contribution High;
   * status Resolved.

4. **Admin review state.** The review moves UNREVIEWED → UNDER_REVIEW → REVIEWED, with an
   administrative conclusion/annotation. For example: *"Reviewed timeline. Multiple-face event appears
   consistent with another person entering the frame."*

   The system must distinguish **an AI-generated signal ≠ the administrator's conclusion**. This is an
   important security/product distinction.

### Complete Phase 6 architecture

```
             PHASE 5C
          AI OBSERVATIONS
                │
                ▼
        ┌─────────────────┐
        │  FACTUAL EVENTS │
        └────────┬────────┘
                 ▼
════════ PHASE 6A — RISK + CORRELATION ════════
       ┌─────────┴─────────┐
       ▼                   ▼
 Event weighting      Time correlation
       └─────────┬─────────┘
                 ▼
             Risk score
                 ▼
════════ PHASE 6B — EVIDENCE SYSTEM ════════
        Evidence episodes → Timeline
                 ▼
════════ PHASE 6C — HUMAN REVIEW ════════
   Admin dashboard → Review evidence → Admin conclusion
```

**Phase 6 in one line:** 6A — understand the risk → 6B — build the evidence → 6C — let the human
review it.

**What Phase 6 must NOT do:**

```
AI detects something → AI says CHEATING → candidate rejected      ✗
```

Instead:

```
AI detects signal → correlate events → calculate risk → generate evidence → admin reviews → human decision   ✓
```

This keeps Phase 6 cleanly separated from the AI detection work completed in Phase 5C.

---

## Open items (flagged, not resolved)

These are differences from the PRD/TRD (summarised in `PROJECT-CONTEXT.md`) and decisions the plan
leaves open. They need a product-owner decision before or during the relevant stage.

1. **Phase numbering.** The product owner's "Phase 6" is the roadmap's Phase 7 (see the note above).
2. **Risk bands differ from the PRD.** PRD **FR-015** suggests a 0–100 score with **four** bands:
   0–25 Normal, 26–50 Low, 51–75 Medium, 76–100 High, "eventually org-configurable". This plan's
   example uses **three** bands (0–29 Low, 30–59 Medium, 60–100 High). Decide which applies; both
   sources agree the thresholds must be configurable.
3. **Evidence media vs. no raw media.** PRD **FR-017** and the TRD's Evidence Engine (PRD feature 10,
   TRD §30/object storage) define evidence as **screenshots, video segments and audio segments** plus
   metadata, in **object storage**, with configurable retention. This plan says to avoid storing
   unnecessary raw media and defines evidence as structured event records, which matches what Phase 5A
   decided (frames discarded after inference). Media evidence would need all of these, none of which
   exist today:
   * consent and clear communication to candidates (NFR-005);
   * configurable retention and deletion;
   * encrypted, access-controlled object storage (no object storage is in the current zero-cost stack);
   * a way to capture clips around an event on the candidate's device.

   Decide whether 6B is metadata-only evidence (as planned) or includes media.

   **Decided (2026-10-06):** 6B stays metadata-only. Media evidence is added separately as event-triggered
   **evidence clips**: short, video-only, private, hashed and retention-bound clips linked to the 6B items.
   The candidate is told before the exam. See [`EVIDENCE-CLIPS.md`](EVIDENCE-CLIPS.md).
4. **Review actions.** PRD **FR-018** names investigation actions **confirm / dismiss / escalate**; the
   plan defines review **states** UNREVIEWED → UNDER_REVIEW → REVIEWED plus a note. Decide whether
   the conclusion also records a confirm/dismiss/escalate outcome, and what "escalate" means with a
   single ADMIN role.
5. **PROCTOR role.** The PRD introduces a `PROCTOR` role (V1) who reviews evidence and investigates
   sessions. The plan is admin-only; only ADMIN and CANDIDATE exist today. Decide whether 6C stays
   admin-only.
6. **Audit logging.** TRD §30 requires audit logging of **evidence access**, proctoring events and
   admin actions, "append-oriented and protected from unauthorized modification". The enforcement
   mechanism is unspecified (**OQ-12**). The plan's "auditable" evidence needs this decided: an audit
   table, access logging on the evidence/timeline endpoints, and review-note history.
7. **Available signals are narrower than the PRD's example.** PRD **FR-016**'s correlation example uses
   `PHONE_DETECTED`, `GAZE_DEVIATION` and `UNKNOWN_VOICE`. Today:
   * phone detection is blocked by validation (Phase 5B);
   * `GAZE_AWAY` is disabled (Phase 5C calibration);
   * there is no audio detection.

   6A can weight only the events that exist: Phase 4 focus/fullscreen/clipboard/prohibited-app/device
   events, and the Phase 5C face, head and quality episodes.
8. **Weights, correlation window, decay rate and thresholds are unspecified.** No source document gives
   values. Like the Phase 5C thresholds, any values would be provisional, configurable and in need of
   validation on real sessions. They must not be presented as probabilities, and the KB's
   false-positive posture (KB §43) applies: a single weak event is never cheating.
9. **Where the risk engine runs.** The TRD's reference architecture shows an event bus (Redis) feeding
   the Risk Engine. The current deployment deliberately has no Redis or workers. The TRD also says not
   to add scaling infrastructure prematurely, and says the risk model starts rule-based
   (`RiskModel ← RuleBasedRiskEngine`). Decide whether the risk is computed on demand from the event
   store, updated incrementally on each event in-process, or stored per window.
10. **Live wall vs. post-exam review.** PRD feature 12 describes **risk-prioritised triage** on the live
    dashboard. The plan's 6C is a per-attempt investigation view. Decide whether 6A's live risk also
    appears on the Phase 4C wall (for example, sorting tiles or a risk badge), or only in review.
11. **Reports and integrity score.** PRD **FR-019** includes an integrity score, suspicious events and
    evidence references in reports. That is outside this plan's three parts; decide if and when it
    belongs.
12. **API routes.** The plan's example routes (`/admin/attempts/{id}/…`) must follow the existing
    conventions. Current admin routes live under `/api/v1/admin/…`, such as
    `/api/v1/admin/monitoring/sessions/{attempt_id}`, and results under the existing results routes.
13. **Event grouping overlap with Phase 5C.** AI observations are already stored as episodes (one
    started and one resolved row, with a duration). The plan's "occurrences" grouping mainly applies to
    repeated Phase 4 events (for example, several FOCUS_LOST/FOCUS_REGAINED pairs), and to correlated
    windows across types.
