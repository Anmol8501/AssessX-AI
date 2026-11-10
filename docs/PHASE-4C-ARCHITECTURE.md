# ASSESSX — PHASE 4C ARCHITECTURE
## Live Administrator Monitoring Foundation

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4C  
**Parent Phase:** Phase 4 — Basic Proctoring & Live Monitoring  
**Platform:** Windows Desktop + Web Admin Dashboard (Tauri + React + TypeScript)  
**Backend:** FastAPI + SQLAlchemy + PostgreSQL (Supabase)  
**Status:** Approved Specification

---

## 1. Overview

Phase 4C provides the administrator-facing live monitoring dashboard, near-real-time event stream, authorized WebRTC video transport foundation, and monitoring access audit log for AssessX.

It combines:
- **Phase 4A:** Proctoring session identity, hardware states, and stream ownership.
- **Phase 4B:** Observable examination environment events, severity levels, and recovery states.
- **Phase 3:** Examination schedules, attempt status, and closure lifecycle.

```mermaid
graph TD
    subgraph Candidate ["Candidate Desktop (Tauri / React)"]
        C_CAM["Phase 4A Camera Stream"] --> PUB["useMediaPublisher"]
        C_ENV["Phase 4B Events"] --> API_EVT["POST /proctoring/events"]
        PUB <-->|Signaling Offer/ICE| WS_C["/ws/candidates/me/proctoring"]
    end

    subgraph Backend ["FastAPI & Realtime Hub"]
        WS_C <--> HUB["Realtime Hub & Presence Tracker"]
        API_EVT --> DB[("PostgreSQL (sessions, events, monitoring_audit)")]
        DB -->|Deltas| HUB
        HUB <-->|Deltas & Signaling| WS_A["/ws/admin/monitoring"]
        REST["/admin/monitoring/*"] --> DB
        ICE["/realtime/ice-servers"] --> STUN_TURN["STUN / Short-lived TURN"]
    end

    subgraph Admin ["Administrator Dashboard"]
        WS_A --> WALL["LiveMonitoringPage (4x4 Grid)"]
        REST --> WALL
        WALL --> DETAIL["CandidateDetailView"]
        DETAIL --> VIEW["useMediaViewer (WebRTC)"]
        PUB <==>|Peer-to-Peer Video (No Storage)| VIEW
    end
```

---

## 2. Architectural Principles

1. **Monitoring Visibility, Never Automated Verdicts:** Displays real-time technical state, camera feeds, and factual event timelines. The system never automatically accuses or penalizes candidates.
2. **Backend Authoritativeness:** The PostgreSQL database reached via REST remains the source of truth. WebSockets accelerate UI delivery; reconnecting reconciles state from REST endpoints.
3. **On-Demand Video Scaling:** A 4×4 monitoring grid displays up to 16 status cards per page without opening 16 simultaneous WebRTC video decoders. Live peer-to-peer streams are requested explicitly in `CandidateDetailView` and torn down immediately on close.
4. **No Default Recording:** Live monitoring streams transit peer-to-peer and are never persisted or archived by Phase 4C.
5. **Zero Trust Signaling:** WebSockets require single-use authenticated tickets, role verification (`ADMIN` vs `CANDIDATE`), active attempt checks, and pairing validation before forwarding SDP offers or ICE candidates.

