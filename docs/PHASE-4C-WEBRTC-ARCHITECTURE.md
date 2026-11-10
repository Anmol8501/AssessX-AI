# ASSESSX — PHASE 4C WEBRTC ARCHITECTURE
## Authorized Media Transport & Signaling Foundation

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4C  
**Status:** Approved Specification

---

## 1. Signaling & Media Flow

Phase 4C establishes a peer-to-peer WebRTC pipeline reusing the Phase 4A candidate camera stream without duplicating device capture.

```mermaid
sequenceDiagram
    autonumber
    participant Admin as Admin Viewer (useMediaViewer)
    participant API as Backend REST & Audit
    participant WS as Backend Signaling Hub (ws.py)
    participant Cand as Candidate Publisher (useMediaPublisher)

    Admin->>API: POST /admin/monitoring/sessions/{id}/stream/request
    API-->>Admin: Authorized Grant + MonitoringAuditEvent recorded
    Admin->>WS: WATCH (attempt_id)
    WS->>WS: Validate Admin Role & Active Monitorable Attempt
    WS->>Cand: WATCH (attempt_id)
    Cand->>API: GET /realtime/ice-servers
    API-->>Cand: STUN + Short-lived TURN credentials
    Cand->>Cand: Create RTCPeerConnection + Add Phase 4A Video/Audio Tracks
    Cand->>WS: WEBRTC_OFFER (sdp, offer_id)
    WS->>Admin: WEBRTC_OFFER (sdp, offer_id)
    Admin->>WS: WEBRTC_ANSWER (sdp, offer_id)
    WS->>Cand: WEBRTC_ANSWER (sdp, offer_id)
    Cand<-->WS: ICE_CANDIDATE (offer_id)
    WS<-->Admin: ICE_CANDIDATE (offer_id)
    Cand==>Admin: Encrypted DTLS-SRTP Media Stream
    Admin->>API: POST /admin/monitoring/sessions/{id}/stream/terminate
    Admin->>WS: UNWATCH (attempt_id)
    WS->>Cand: UNWATCH (attempt_id)
    Cand->>Cand: Close RTCPeerConnection
```

---

## 2. Signaling Security & State Tracking

- **One-Time WebSocket Tickets:** Both admin (`/ws/admin/monitoring`) and candidate (`/ws/candidates/me/proctoring`) sockets authenticate via single-use, short-lived `/api/v1/realtime/ws-ticket` tokens. Raw JWTs never appear in WS URLs.
- **Offer Correlation (`offer_id`):** Every SDP offer generates a unique `offer_id`. Answers and ICE candidates for mismatched or stale negotiations are discarded.
- **ICE / STUN / TURN Policy:**
  - Server-side `GET /api/v1/realtime/ice-servers` supplies public STUN and dynamic short-lived HMAC TURN credentials.
  - TURN relay access is granted **only** to administrators and candidates currently in an active proctored exam or live interview (`_may_relay`).
  - Zero static TURN credentials are bundled into desktop binaries or React code.
- **Bitrate Limiting:** Candidate video sender limits bitrate via `limitLiveVideo(sender, track)` to protect candidate uplink bandwidth and administrator decoding load.
- **Clean Teardown:** Closing `CandidateDetailView`, switching exams, or ending the candidate attempt stops WebRTC tracks and clears watchers cleanly.

