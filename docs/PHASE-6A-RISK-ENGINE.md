# Phase 6A — Risk Engine & Event Correlation

**Status:** **Implemented (2026-10-01).** Part of the Risk & Evidence plan
([`PHASE-6-PLAN.md`](PHASE-6-PLAN.md), which the product owner calls "Phase 6"; the roadmap numbers it
Phase 7). **6B (evidence timeline) is implemented** — [`PHASE-6B-EVIDENCE.md`](PHASE-6B-EVIDENCE.md), built on this
engine's signals and windows; **6C (human review) is implemented** — [`PHASE-6C-HUMAN-REVIEW.md`](PHASE-6C-HUMAN-REVIEW.md); each
decision records the risk the reviewer saw (limitation 3 below).

**A risk score in AssessX summarises observable events for a human reviewer. It is not a
determination that the candidate cheated, and it never rejects anyone.**
(Detect → Correlate → **Explain** → Evidence → Human Review.) There is no "cheated", "rejected" or
probability field anywhere, and the policy's own texts are tested for verdict wording.

## Architecture

```
proctoring_events (Phase 4B/5C, append-only, server-timestamped)
        │  one indexed query per attempt (session_id, recorded_at) — ≤ 5000 rows
        ▼
signals.py   normalise → RiskSignal (AI episodes, Phase 4 pairs, instant events; server times only)
        ▼
engine.py    contribution → correlation windows → decay → aggregation (+ peak) — pure, deterministic
        ▼
service.py   RiskService.assess(attempt): live → as of now; ended → as of the session's end
        ▼
GET /api/v1/admin/attempts/{attempt_id}/risk   (AdminUser only; read-only)
        ▼
Desktop: "Attempt risk" panel — live candidate detail view + "View risk" on the results table
```

* **One policy module** (`backend/app/services/risk/policy.py`, `POLICY_VERSION = "6A-v1"`) holds
  every weight, window, half-life, band and explanation. Any change must bump the version, and every
  response carries it.
* **Derived on demand, with no new table and no migration.** The risk is computed from the stored
  events on each request, so nothing is written and there's no stale or conflicting state. There's no
  Redis and no worker. A persisted snapshot becomes relevant in 6C, where a review decision must record
  the score it was based on.
* **Not on the live wall.** Putting risk on every tile would recompute it on every event for every
  candidate. The detail view fetches it instead: at most every 5 s as new events arrive, and every 30 s
  for decay.

## Decisions (product owner approved the recommendations on 2026-10-01)

| Decision | Choice | Why |
|---|---|---|
| Risk bands | **PRD FR-015**: 0–25 Normal · 26–50 Low · 51–75 Medium · 76–100 High | The PRD is the source of truth; the plan's 3 bands were illustrative |
| Prohibited apps | **No contribution** | `PROHIBITED_APP_DETECTED` is part of the *pre-exam* readiness check; the app closes the apps before the exam can start |
| Who can read risk | **Any ADMIN** (same scope as results and monitoring) | Single-tenant build; `created_by_id` is not used for scoping anywhere yet |
| Risk state | **Derived on demand** | Simplest secure option; bounded by the 5000-event ceiling |
| Provisional values | 30 s correlation window, 10 min half-life, tiers below | No source document specifies values |

## The policy (`6A-v1`), all values provisional

A signal contributes **`min(max, base + per_second × duration)`** points. The duration comes from the
**server's `recorded_at`** only; the client's `FOCUS_REGAINED.duration_ms` is ignored.

| Tier | Signal | Base | Per second | Max |
|---|---|---|---|---|
| HIGH | Multiple faces detected | 20 | 1.0 | 40 |
| HIGH | Remote-desktop session | 30 | — | 30 |
| MEDIUM | Face not detected · focus lost · camera disconnected | 8 | 0.5 | 25 |
| MEDIUM | Fullscreen exit | 6 | 0.3 | 20 |
| MEDIUM | Multiple monitors | 10 | — | 10 |
| MEDIUM | Copy / cut / paste / clipboard / print / devtools / restricted shortcut / screenshot attempt | 6 | — | 6 |
| LOW | Head turned from the candidate's neutral | 3 | 0.2 | 12 |
| LOW | Camera too dark | 2 | 0.1 | 8 |
| LOW | Face too far / too close | 1 | 0.05 | 5 |
| LOW | Microphone disconnected | 3 | 0.1 | 10 |
| LOW | Display configuration changed | 3 | — | 3 |
| LOW | Right-click attempt | 1 | — | 1 |

**Never contributes** (always listed in the response under `excluded`, with the reason):
* session lifecycle;
* `ENFORCEMENT_STATUS` (diagnostics);
* the device-readiness events (`DEVICE_CHECK_*`, `PROHIBITED_APP_DETECTED`, `APP_CLOSE_*`);
* `AI_STATUS`, which is reported as **coverage**: "AI unavailable for N s";
* `GAZE_AWAY`, which is disabled.

A test asserts that **every** event type has an explicit decision, so a new event type can't silently
count, or silently not count.

**Correlation.** Signals are swept in time order. A signal joins the current window if it starts
within **30 s** of the window's latest end. A window that spans **≥ 2 event categories** (for
example, AI observation plus window focus) is *correlated*: it adds **25 %** of its members' points,
capped at **15**. Each signal belongs to exactly one window, so nothing is counted twice.

**Decay and aggregation.**
* Each contribution takes effect when its signal ends, then halves every **10 minutes**.
* The **score** is the capped sum (0–100), mapped to the PRD bands.
* Because decay is exponential, one pass gives both the score **now** and the **peak** over the
  attempt, with no rescans.
* A finished attempt is evaluated **as of its end**, so its score never changes with time. The peak
  keeps an early incident visible.
* Rounding is half-up, applied once, at the end.

## API

`GET /api/v1/admin/attempts/{attempt_id}/risk`. Admin only: candidates get 403, anonymous 401,
unknown or unproctored attempts 404, a malformed id 422. It is read-only (any write method gets 405).

The response contains:

| Field | What it holds |
|---|---|
| `attempt_id`, `policy_version`, `calculated_at`, `as_of` | which attempt, under which policy, and when |
| `current_score`, `level` | the score and band now (or at the session's end) |
| `peak_score`, `peak_level`, `peak_at` | the highest point over the attempt |
| `signal_count` | how many signals were counted |
| `contributors[]` | per event type: tier, occurrences, total seconds, points, current points, reason |
| `correlated_windows[]` (up to 20), `correlated_window_count` | correlated moments |
| `excluded[]` | event types that never count, with the reason |
| `ai_unavailable_seconds` | AI coverage gap |
| `interpretation`, `limitations` | "not a verdict" and what the score can't show |

There's no candidate personal data in it, since the screens that show it already identify the
candidate.

## Security and privacy

* The server computes the risk from its own stored events and its own clock. The desktop app never
  computes or sends risk. The event API already refuses unknown fields (such as `risk_score`),
  server-only event types and forged category, source or time.
* No new data is stored: no frames, embeddings, screenshots or audio. It uses structured events only.
* **Limitation, stated in every response:** most signals are reported by the candidate's app, which
  the server can't fully trust. A modified app could suppress events, so **the absence of signals is not
  proof that nothing happened.** Only session and device-state events are server-originated.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_risk_engine.py` | 27 | every event type decided; bands; low, medium and high contributions; caps; instant events; server-only durations (client `duration_ms` ignored); open and resolved episodes; duplicates; malformed and orphan events; excluded events explained; AI coverage; events after `as_of`; correlation inside and outside the window, single category, capped and counted once; decay; peak; determinism under shuffling and repetition; ordering; 5000 events in under 2 s |
| `backend/tests/test_risk_api.py` | 20 | explained response; empty attempt; no PII or verdict; candidate 403 (own and other); anonymous 401; unknown and unproctored 404; malformed 422; writes 405; candidate endpoints never expose risk; no risk injection through events; server clock over client duration and time; a finished attempt fixed at its end and identical on repeat; query count independent of event count (no N+1); a full 5000-event session |
| `apps/desktop/src/features/admin/risk/__tests__/risk.test.ts` | 5 | response mapping, levels, no verdict wording, formatting |
| `apps/desktop/e2e/risk.spec.ts` | 1 | live risk in the detail view; the finished attempt's risk from the results table |

## Known limitations and open items

1. **Every weight, window, half-life and threshold is provisional.** They must be validated on real
   sessions. A change means a new policy version.
2. **The client can suppress signals** (see Security). Server-side corroboration is limited to session
   and device events.
3. **Recomputed each time with the current policy.** A historical score shown under a newer policy may
   differ from what an earlier reviewer saw. 6C should snapshot the assessment with its review decision.
4. **Per-admin or organisation scoping** isn't implemented, and isn't implemented anywhere else yet
   either.
5. Everything else stays open as recorded in `PHASE-6-PLAN.md`:
   * media evidence (FR-017);
   * confirm / dismiss / escalate (FR-018);
   * the PROCTOR role;
   * audit logging of evidence access (OQ-12);
   * risk on the live wall;
   * reports and integrity score.
