# Phase 7D — Live Video Interview (WebRTC)

**Status:** **Implemented (2026-10-01).** This is the live video interview the product owner added to
Phase 7 ([`PHASE-7-PLAN.md`](PHASE-7-PLAN.md), "Addition … live video interviews"). It was given as "like
Google Meet or Zoom — examples, not to replicate". It builds on 7A
([`PHASE-7A-INTERVIEW-ENGINE.md`](PHASE-7A-INTERVIEW-ENGINE.md)) and reuses Phase 4C's WebRTC plumbing
(ICE servers, STUN and optional Cloudflare TURN). It brings PRD FR-021 (Live Interview: candidate and
interviewer video, audio, screen sharing, chat, timer) into the product.

Decisions approved for 7D (open item 2 of the plan):

| Question | Decision |
|---|---|
| Who interviews? | **Any active ADMIN.** There is no INTERVIEWER role (OQ-03 stays open). |
| Recording? | **None.** No audio, video or screen is stored or passes through the server. |
| Participants | **One-to-one**: one interviewer and one candidate per call. |
| TURN | Cloudflare TURN, as for live monitoring. It's optional, and the operator enables it on Render (see below). |
| Proctoring during calls | **None.** A live interview is supervised by the interviewer. |
| AI copilot (FR-024) | Not built. |

> **What the server holds:** the facts of a call (who opened it, when the candidate joined, when and by
> whom it ended), its text chat, and the interviewer's private notes. **What it never holds:** media.
> WebRTC is peer-to-peer. The server relays only signaling (session descriptions and ICE candidates)
> between the two people on the call, and stores none of it.

## How it works

```
Admin: interview editor ── "Start live call" ──▶ POST …/assignments/{candidate}/call  (opens, or returns the open call)
                                                       │
Candidate: My Interviews / interview page ── "Join live call" ──▶ POST /candidates/me/interview-calls/{id}/join
                                                       │
           both ── WSS /api/v1/ws/interview-calls/{id}?token=… ──  CallHub (in-process, two sides per room)
                         OFFER  candidate ─▶ interviewer
                         ANSWER interviewer ─▶ candidate
                         ICE, MEDIA_STATE   either way
                         CHAT   stored, then delivered to both
                                                       │
                    media: peer-to-peer (STUN; TURN when configured) — never via the server
                                                       │
Admin: "End call" ──▶ POST …/calls/{id}/end ──▶ call ENDED (audited) ──▶ CALL_ENDED to both, sockets closed
```

* **An interview's format.** `interviews.format` is `AI` (the 7A–7C text interview) or `LIVE`. A LIVE
  interview is assigned and published like any other. Its questions are an **optional guide** for the
  interviewer, so publishing does not require them. The candidate cannot start an AI session for it
  (409 `live_interview`).
* **Opening a call.** An administrator opens a call for a candidate assigned to a **published LIVE**
  interview. There is at most one OPEN call per assignment, enforced by a partial unique index. Opening
  again returns the open call (200 rather than 201). Two administrators opening at once get the same
  call (savepoint plus IntegrityError).
* **Joining.** Only the call's own candidate can read or join it. Any other candidate gets 404, and an
  administrator gets 403 on the candidate routes. The first join is recorded (`candidate_joined_at`,
  audited). A rejoin is not recorded again. An ENDED call cannot be joined (409 `call_ended`).
* **Signaling socket.** Authenticated by the session token in the query, as the monitoring sockets are
  (a browser WebSocket cannot set headers). The token is redacted from every log line. The database
  decides the side:
  * the call must be OPEN;
  * a candidate may take only the *candidate* side of their own call;
  * an active administrator takes the *interviewer* side.

  Anyone else gets `ERROR forbidden` and close code 1008. Each side is held by one person: a different
  administrator joining an occupied interviewer side gets `ERROR occupied`, while the same person
  reconnecting replaces their old connection.
* **Relay rules.** Offers are accepted only from the candidate and answers only from the interviewer, so
  the two can never offer at the same time. ICE candidates and media state go either way. Everything is
  sent **only to the other side of this call**, and every value is bounded (SDP and ICE at most 200 000
  characters; `offer_id` matches `[A-Za-z0-9_-]{1,64}`; media state is reduced to three booleans).
  Messages that break these rules are dropped.
* **Chat.** A chat message is stored first (1–2000 characters, trimmed, only while the call is OPEN) and
  then delivered to both sides with its server id, so a reconnecting client merges it without duplicates.
  Chat is visible to both participants and kept with the call record. Messages are not audited one by
  one, and their text is never logged.
* **Interviewer notes.** Private to administrators. A note is never in any candidate response. Notes are
  append-only (no edit or delete routes) and can be added during or after the call. The audit records
  only the note's id and length, never its text.
* **Ending.** Only the interviewer ends a call; the candidate can leave and rejoin while it is open.
  Ending is idempotent and locked (`SELECT … FOR UPDATE`). The audit records the duration and the number
  of chat messages. After the commit, the hub sends `CALL_ENDED` to both sides and closes their sockets.
  A later call with the same candidate is a new record.

## The desktop client

`apps/desktop/src/features/interviews/call/`:

* **`useCall`** — one side of the call:
  * Opens camera and microphone, falling back to microphone only, then camera only, then none (chat
    still works).
  * Opens the call socket with back-off reconnects, and builds an `RTCPeerConnection` with the ICE
    servers from `GET /api/v1/realtime/ice-servers`.
  * The candidate always offers; each offer has a fresh `offer_id`, and answers or ICE for any other id
    are ignored. Signals are processed **one at a time in arrival order**, so an ICE candidate cannot
    overtake its offer.
  * **Video never waits forever.** An attempt that has not connected within 20 s (or a connection that
    fails, or stays disconnected for 6 s) is retried: the candidate makes a fresh offer. After 3
    attempts both sides show **"Video couldn't connect — chat still works"**, with the likely reason
    (whether the server has a TURN relay) and a **Retry video** button. The interviewer's Retry sends
    `RENEGOTIATE`, which the server relays only from the interviewer to the candidate.
  * Every offer pre-negotiates three slots — **microphone, camera, screen**. Muting, turning the camera
    off and screen sharing (`getDisplayMedia` via `replaceTrack`) therefore never renegotiate.
  * Mute and camera-off disable the local track and announce `MEDIA_STATE`.
  * Leaving the page stops every track and closes the connection.
* **`CallScreen`** — the shared layout:
  * the other person, large, or their shared screen with them beside it;
  * your own preview, mirrored, and your shared screen;
  * the controls: mute, camera, share screen, and End call (interviewer) or Leave (candidate);
  * the connection state, the call timer (elapsed against the planned minutes), and a chat panel.
* **`AdminCallPage`** (`/admin/interviews/:id/calls/:callId`, full-screen, outside the shell):
  * the call, with tabs for **Guide** (the question bank with "Listen for: …" expected concepts — admin
    data the candidate never receives), **Notes** and **Chat**;
  * End call, behind a confirmation;
  * once ended, the same URL is the **call record**: opened, joined and ended times with who acted,
    the duration, the chat transcript and the notes (more notes can still be added).
* **`CandidateCallPage`** (`/candidate/interviews/:id/call/:callId`, full-screen): joins, then shows the
  call with chat only. It ends with "The interviewer has ended the call".
* **Admin interview editor:**
  * a **Format** selector (AI or Live). For Live, the AI-only settings — questions asked, follow-ups and
    adaptive difficulty — are hidden and sent as neutral values;
  * for LIVE interviews, **Start live call / Rejoin call** per assigned candidate;
  * a **Calls** history (newest first), linking to each record.
* **Candidate pages.** My Interviews and the interview page show **Join live call** when a call is open,
  or "Waiting for the interviewer". They re-check every 10 s while a live interview waits.

## API

Admin (`AdminUser`):

| Method & path | Result |
|---|---|
| `POST /api/v1/interviews/{id}/assignments/{candidate_id}/call` | 201 opened · 200 the already-open call · 409 not LIVE/not published · 404 not assigned |
| `GET /api/v1/interviews/{id}/calls[?candidate_id=]` | the interview's calls, newest first (≤ 100) |
| `GET /api/v1/interviews/{id}/calls/{call_id}` | the call with its chat and notes (404 through another interview) |
| `POST /api/v1/interviews/{id}/calls/{call_id}/end` | ends it (idempotent) |
| `POST /api/v1/interviews/{id}/calls/{call_id}/notes` | `{body}` (strict, 1–4000) → 201 |

Candidate (`CandidateUser`, own calls only):

| Method & path | Result |
|---|---|
| `GET /api/v1/candidates/me/interview-calls/{call_id}` | the call and its chat, **never notes** |
| `POST /api/v1/candidates/me/interview-calls/{call_id}/join` | records the first join · 409 `call_ended` |

Also:

* `format` is on the interview create, update, list and detail responses and on the candidate's
  interview list and detail.
* `open_call_id` is on the admin assignment rows and the candidate's interviews.

WebSocket: `/api/v1/ws/interview-calls/{call_id}?token=…`.

| Server → client | Meaning |
|---|---|
| `READY {role, peer_present}` | You are connected. |
| `PEER_JOINED {role}` | The other side connected. |
| `PEER_LEFT {role}` | The other side disconnected. |
| `OFFER`, `ANSWER`, `ICE` (each with `offer_id`) | Relayed signaling. |
| `MEDIA_STATE {role, audio, video, screen}` | The other side's toggles. |
| `RENEGOTIATE` (to the candidate only) | The interviewer pressed Retry video: send a fresh offer. |
| `CHAT {message}` | A stored chat message. |
| `CALL_ENDED` | The call has ended. |
| `ERROR {error: forbidden \| occupied}` | Refused. |

## Audit

| Action | When | Details (no text content) |
|---|---|---|
| `INTERVIEW_CALL_OPENED` | an administrator opens a call | `call_id`, `candidate_id` |
| `INTERVIEW_CALL_JOINED` | the candidate's first join | `call_id` |
| `INTERVIEW_CALL_ENDED` | the call ends | `call_id`, `duration_seconds`, `messages` (a count) |
| `INTERVIEW_CALL_NOTE_ADDED` | an administrator adds a note | `call_id`, `note_id`, `length` |

The audit log stays append-only (database trigger).

## Database (migration `0018_phase_7d_live_interview`)

* `interviews.format`: `AI | LIVE`, default `AI`, with a CHECK constraint. Existing interviews stay AI.
* `interview_calls`:
  * columns: interview, assignment, candidate, `status OPEN|ENDED`, `opened_by`, `opened_at`,
    `candidate_joined_at`, `ended_at`, `ended_by`;
  * CHECKs: an ENDED call has an end time and an ender; times are ordered;
  * a **partial unique index**: one OPEN call per assignment.
* `interview_call_messages`: `call_id`, `sender_id`, `body` 1–2000, `sent_at`.
* `interview_call_notes`: `call_id`, `author_id`, `body` 1–4000, `created_at`.
* RLS is enabled with no policies on the three new tables only (the API connects as the table owner;
  this closes them to Supabase's public API roles). Existing tables are not touched.
* The audit-action CHECK is widened by the four actions. The downgrade removes those audit rows first
  (with the append-only trigger disabled only for that statement).

## Deployment: TURN on Render (manual, optional)

Live interviews use the same ICE servers as live monitoring ([`DEPLOYMENT-RENDER.md`](DEPLOYMENT-RENDER.md) §7):

* STUN always.
* TURN when `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` are set on Render. The token is
  secret and stays on the server; apps receive short-lived credentials.

Without TURN, calls connect only when the two networks can reach each other directly. They often
cannot: mobile data and hotspots (carrier-grade NAT), campus, hostel or office Wi-Fi that isolates
devices, and some home routers. The call then shows "Video couldn't connect" while chat keeps working.
**A first production test (2026-10-02) hit exactly this.** Setting the two variables is a manual step
for the operator. Nothing is built into the installer, and no rebuild is needed.

**Cost:** Cloudflare's pricing page (checked 2026-10-02) says SFU and TURN cost $0.05 per GB of egress,
and "the first 1,000 GB each month is free", shared between the two. Only calls that actually need the
relay use it; a 30-minute relayed 720p call is roughly 0.5–0.7 GB.

## Tests

| Suite | Count | Covers |
|---|---|---|
| `backend/tests/test_interview_calls.py` | 9 | LIVE publishes without questions and refuses an AI session; one call per assignment (201 then 200), only for a published LIVE interview and an assigned candidate; only the candidate reads/joins (another candidate 404, admin 403, anonymous 401), first join recorded once; notes private (never in the candidate's view), immutable (no PATCH/PUT/DELETE), strict input, never in audit or logs; end idempotent, candidate cannot end, ended call refuses joins, a later call is new, a call only through its own interview; WebSocket relay (offers only from the candidate, answers only from the interviewer, ICE and media state only to the other side, oversized input dropped); chat stored then delivered to both, oversized dropped; only participants connect (forbidden for another candidate or an unknown call, occupied for a second interviewer, forbidden once ended); ending disconnects both |
| existing suites | — | `test_interview_config`, `test_interview_sessions`, `test_interview_security`, `test_interview_report`, `test_realtime`, `test_monitoring` and `test_migrations` still pass with migration 0018 and the new routes |
| `apps/desktop/src/features/interviews/call/__tests__/call.test.ts` | 8 | socket URL and token encoding; the fixed slot order; strict peer media flags; chat merge (once each, in order) and limits; timer and formatting; AI is the default format; call routes |
| `apps/desktop/e2e/interview-live.spec.ts` | 2 | two browser contexts with synthetic camera, microphone and screen: the admin starts the call (guide visible), the candidate joins from the interview page, **video connects both ways**, the candidate never sees the guide, chat both ways, candidate screen share appears and stops for the admin, admin mute shown to the candidate, a private note (absent from the candidate's API view), End call → the candidate sees the end, the admin sees the record (chat, note, duration), rejoin 409, history lists the call; a candidate cannot open, read, note on or end calls (403) |

## Known limitations

1. **No recording, by decision.** There's nothing to replay; the record is the chat, the notes and the
   times.
2. **One-to-one only.** No panel interviews, no observers. A second administrator sees "occupied".
3. **The CallHub is in-process.** As with live monitoring, both sides must reach the same API instance
   (Render runs one). Scaling out would need a shared relay, and Redis is deliberately not introduced.
4. **TURN against Cloudflare is not tested from this repository.** The same caveat applies to live
   monitoring. Without TURN, restrictive networks may not connect. After three automatic attempts the UI
   says "Video couldn't connect", offers Retry video, and chat still works.
5. **Screen sharing in the installed app has not been verified on a physical machine.** The e2e test
   runs in Microsoft Edge (WebView2's engine) with a synthetic screen; WebView2 shows its own picker.
6. **No scheduling.** A call is started on demand. The candidate's page re-checks every 10 s and shows
   "Join live call" once it's open. There's no calendar, invitation or reminder.
7. **No AI in live calls.** No transcript, evaluation or copilot (FR-024). A live interview has no AI
   report; the interviewer's notes are the assessment.
8. **There's no retention policy** for chat or notes, as for the rest of the project.
