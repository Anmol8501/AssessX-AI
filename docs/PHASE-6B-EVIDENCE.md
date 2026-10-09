# Phase 6B — Evidence Generation & Evidence Timeline

**Status:** **Implemented (2026-10-01)** on top of Phase 6A
([`PHASE-6A-RISK-ENGINE.md`](PHASE-6A-RISK-ENGINE.md)). This is part of the Risk & Evidence plan
([`PHASE-6-PLAN.md`](PHASE-6-PLAN.md)). The product owner calls it "Phase 6"; the roadmap numbers it
Phase 7. **6C (human review) is implemented** —
[`PHASE-6C-HUMAN-REVIEW.md`](PHASE-6C-HUMAN-REVIEW.md); its reviewers mark evidence items, and each
decision records the evidence counts they saw.

**Evidence explains what the system observed. It does not determine intent, does not prove that
anything improper happened, and does not replace human review.**
(Detect → Correlate → Explain → **Evidence** → Human Review.)

## Architecture: derived, deterministic, no new storage

```
proctoring_events (5C, append-only, server-timestamped)
      ▼
6A  analyze(): signals · points · correlated windows (now with member ids)
      ▼
6B  build_evidence(): items (one per signal) · episodes (one per window) · explanations
      ▼
GET /api/v1/admin/attempts/{id}/evidence[?limit&cursor&since&until]
GET /api/v1/admin/attempts/{id}/evidence/{evidence_id}      (AdminUser, read-only)
      ▼
"Proctoring evidence" timeline: live candidate detail view · "Risk & evidence" dialog on the results page
```

* **An evidence item is one Phase 6A signal**, so every item corresponds to real stored events.
  * `evidence_id` is the id of the **event that started it**: stable, deterministic, traceable.
  * `source_event_ids` lists that event and, when one was recorded, the event that ended it.
* **An evidence episode is exactly one Phase 6A correlated window.** 6B invents no correlation.
  * `episode_id` is a deterministic UUID5 of its member ids.
  * Its explanation says that grouping signals in time "does not establish a cause or an intent".
* **No new table and no migration.** Evidence is derived on demand from the immutable event store,
  like 6A's risk. Nothing is copied, cached or writable. There's no RLS change.
* **The additions to 6A are additive only**; 6A's outputs are unchanged, and its 47 tests still pass:
  * `RiskSignal` gains `kind`, `end_event_id` and `resolution`;
  * `CorrelatedWindow` gains `member_ids`;
  * the new `analyze()` function exposes per-signal points.
* **Versioning:** every response carries `policy_version` (`6A-v1`, which governs contributions) and
  `evidence_version` (`6B-v1`, which governs derivation and explanations).

## Lifecycle: honest, never estimated

| Status | Meaning | `ended_at` / `duration_seconds` |
|---|---|---|
| `INSTANT` | a single event (e.g. a blocked paste) | = the start / 0 |
| `RESOLVED` | an end was recorded, plus `resolution` for AI episodes: `condition_cleared`, `measurement_unavailable`, `monitoring_stopped`, or server-set `superseded` / `session_ended` | the recorded end / duration |
| `ONGOING` | a live session; not ended yet | `null` / `null` |
| `NO_END_RECORDED` | the session ended without an end event (e.g. focus lost, never regained) | `null` / `null` |

`counted_seconds` is what the **risk score** counted: up to now for an ongoing signal, or up to the
session's end for one with no end recorded. It's given separately and labelled as such, so the
evidence never presents an estimate as a recorded time.

An episode is `ONGOING` if any member is, `NO_END_RECORDED` if any member has no end, and otherwise
`RESOLVED`. Its `ended_at` is set only when every member has a recorded end.

Duplicates collapse exactly as in 6A: a second start while one is open, an end with nothing open, or
a repeated episode id. Overlapping signals remain separate items. Items are ordered by
`(started_at, evidence_id)`.

**Not evidence:** events of excluded types (the readiness check, AI health, session lifecycle,
disabled gaze). They never contribute to risk, and the 6A risk response lists them with the reason.

## Explanations

Each explanation is the policy's factual description plus the measured facts. For example: *"More than
one face was in the camera view for a sustained interval. 2 faces were detected. It lasted 5.1 s. It
ended when the observed condition cleared."* No intent and no conclusion. For every contributing event
type, a test asserts that words such as "cheat", "intent", "guilty", "fraud", "assisted" and "proves"
never appear.

## API

**`GET /api/v1/admin/attempts/{attempt_id}/evidence`**
* Parameters:
  * `limit`: default 50, from 1 to 200, otherwise 422;
  * `cursor`: opaque, at most 256 characters; an invalid cursor gets 422;
  * `since` / `until`: select items by start time.
* Returns:
  * `attempt_id`, `policy_version`, `evidence_version`, `calculated_at`, `as_of`, `session_live`;
  * `total` (the items in range), `items[]`, `episodes[]` (those on this page), `next_cursor`;
  * `interpretation`.

**`GET /api/v1/admin/attempts/{attempt_id}/evidence/{evidence_id}`**
* Returns the item, its episode, and its **source events** (id, type, source, server time, and the
  details already allow-listed when the event arrived).
* An evidence id that isn't part of *this* attempt returns **404**. This is attempt isolation: another
  attempt's id can't be read through a different attempt.

**Authorization** is the same `AdminUser` guard as every admin route:
* candidates get 403 (their own attempt and anyone else's), anonymous requests 401;
* unknown or unproctored attempts 404; malformed ids 422;
* any write method on either route 405.

Admin scope is single-tenant (any admin), consistent with results, monitoring and 6A.

**Access trail:** each read logs `Evidence read` / `Evidence item read` on the `assessx.evidence`
logger, with **ids only** (admin, attempt, item count or evidence id). No tokens and no personal data.
A persistent, tamper-evident audit table is still the open decision OQ-12.

## Performance

Pairing a start with its end needs the session's events in order, so the server reads the session's
rows in **one indexed query**, on `(session_id, recorded_at)`. That read is bounded by the existing
5,000-event ceiling, and the server then paginates the derived items. The browser never receives more
than one page. A test asserts that the query count doesn't grow with the number of events (no N+1).

A per-page database query can't correctly pair an episode whose start sits on an earlier page, so
correctness was chosen within a hard bound. There's no Redis.

## Realtime

Nothing is pushed over the WebSocket, and there's no second realtime path. The live detail view
re-fetches the first page (throttled to every 5 s) when new events arrive, the same way as 6A's risk.
It doesn't reset the list if the admin has paged further. Phase 4C monitoring is unchanged.

## UI

"Proctoring evidence" shows:
* the item count and the evidence/policy versions;
* a chronological list of time, event, duration (or "N s so far" / "no end recorded (N s counted)"),
  contribution ("Medium · 13 pts") and status;
* correlated items bracketed under a "Correlated · N signals · start–end" header.

Selecting a row shows its explanation, how it ended, its times, its current risk points and its source
events, which are loaded on demand. "Load more" pages on, and the interpretation note is always shown.

It appears in the live candidate detail view, under the risk panel, and in the results page's
**Risk & evidence** dialog. There's no review or decision UI; that's 6C.

## Privacy

Structured events only: no video, frames, embeddings, screenshots or audio. No candidate PII in the
responses, since the screens that show them already identify the candidate.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_evidence_engine.py` | 45 (incl. 22 per-type explanation checks) | an item from an event and from an episode; timestamps and durations preserved; instant; ongoing; resolved (including closed by the server); no end recorded; duplicates; overlapping; excluded events; empty; episodes exactly equal to the 6A windows (and none invented); ongoing episode; points consistent with 6A contributors; determinism under shuffling; versions; factual wording; decay of current points; pagination complete, ordered, bounded, range-filtered and rejecting invalid cursors |
| `backend/tests/test_evidence_api.py` | 25 | chronological, traceable timeline (every source id is a stored event of that session); empty; finished attempt fixed, repeatable and honest about missing ends; detail with episode and source events; no PII or verdict; **another attempt's evidence id returns 404**; unknown ids and attempts 404; malformed ids 422; candidates (own and other) 403; anonymous 401; create or modify 405; events can't smuggle evidence fields; candidate endpoints never expose evidence; paging complete and bounded; invalid paging 422; time range; no N+1; access log with ids only |
| `apps/desktop/src/features/admin/evidence/__tests__/evidence.test.ts` | 5 | mapping; a missing end stays null; page merging; honest duration labels; no verdict wording |
| `apps/desktop/e2e/evidence.spec.ts` | 1 | live timeline with a correlated episode, details and source events; the finished attempt from the results dialog |

**Not applicable:** "database constraints" and migration tests, because 6B adds no table and no
migration.

## Known limitations

1. **Values are provisional (6A).** Contributions and correlation are computed under policy `6A-v1`,
   and must be validated on real sessions.
2. **Client-reported signals can be suppressed** by a modified app, so missing evidence isn't proof
   that nothing happened. Only session and device-state events come from the server.
3. **Recomputed from events each time.** If the policy changes, an old attempt's contributions and
   episodes may change. 6C should snapshot what a reviewer saw with their decision.
4. **The access trail is a log line, not a persistent audit table** (OQ-12).
5. **Admin scope is single-tenant.**
6. Media evidence (FR-017) is now provided by **evidence clips**, which attach to these items
   ([`EVIDENCE-CLIPS.md`](EVIDENCE-CLIPS.md)). The items themselves are unchanged.
