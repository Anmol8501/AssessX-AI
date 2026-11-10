# ASSESSX — PHASE 4C PRIVACY AND RETENTION
## Media Privacy, Audio Separation & Audit Accountability

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4C  
**Status:** Approved Specification

---

## 1. Privacy Principles

- **Zero Persistent Media by Default:** WebRTC monitoring streams flow peer-to-peer strictly during active observation. No raw live stream recording or archiving is initiated by Phase 4C.
- **Explicit Audio Separation:** Microphone audio received over WebRTC is **muted by default** (`element.muted = !audioOn`) and requires explicit administrator toggle when institutional policy allows.
- **No Raw Credential Exposure:** One-time WebSocket tickets and short-lived TURN credentials prevent session tokens or static secrets from appearing in client logs or URLs.
- **Monitoring Audit Trail:** Every detail view open, stream request, grant, denial, and termination is persisted in `monitoring_audit_events` linking the administrator, candidate attempt, timestamp, and action without recording media payloads.

---

## 2. Retention & Cleanup

- Monitoring peer connections and tracks terminate immediately when:
  - Administrator closes `CandidateDetailView`.
  - Candidate submits or attempt reaches `TIME_EXPIRED`.
  - WebSocket connection closes or permission is revoked.
- Candidate presence (`candidate_connected`) and watcher mappings are held strictly in volatile memory and cleaned up on socket disconnect.

