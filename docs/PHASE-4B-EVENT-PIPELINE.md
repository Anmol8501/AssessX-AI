# ASSESSX — PHASE 4B EVENT PIPELINE
## End-to-End Event Ingestion, Local Buffering & Synchronization Specification

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4B  
**Parent Phase:** Phase 4 — Basic Proctoring & Live Monitoring  
**Status:** Approved Specification

---

## 1. Event Ingestion Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant D as Desktop App (React / Tauri)
    participant Q as Local Buffer (localStorage)
    participant B as Backend (FastAPI)
    participant DB as Supabase PostgreSQL
    participant A as Admin Dashboard

    D->>D: Observe Violation / Transition (e.g. FOCUS_LOST)
    D->>D: Fold Rapid Repeats (< 1500ms dedupe)
    D->>Q: Enqueue PendingEvent (UUID client_event_id, timestamp)
    D->>B: POST /attempts/{id}/proctoring/events
    alt Network OK & Session Open
        B->>B: Validate Token, Attempt Status & Session Lock
        B->>B: Validate Event Metadata & Categorize
        B->>DB: INSERT INTO proctoring_events (idempotent ON CONFLICT DO NOTHING)
        DB-->>B: Event Record Committed
        B-->>A: Realtime Push (Session Changed Notification)
        B-->>D: HTTP 201 / 200 (RecordedEvent)
        D->>Q: Dequeue and Acknowledge Event
    else Offline or Network Interrupted
        B--x D: Connection Error / Timeout
        D->>D: Retain in Local Buffer & Schedule Backoff
        Note over D,Q: Backoff delay: 2s -> 4s -> 8s (max 30s)
        D->>B: Retry Event from Buffer upon Reconnection
    end
```

---

## 2. Ingestion & Synchronization Rules

### 2.1 Deduplication & Idempotency
- **Client Folding:** Identical events of the same `event_type` and metadata within `1500ms` are collapsed into a single observation to prevent burst spam (e.g., holding `Ctrl+V` down).
- **Server Deduplication:** Database enforces `UNIQUE(session_id, client_event_id)`. Re-sending an event that was previously acknowledged will return the original record with HTTP 200 instead of inserting a duplicate row.
- **Dedupe Window:** Server-side `DEDUPE_WINDOW` of 1 second folds identical observations occurring in quick succession.

### 2.2 Local Queue Durability
- Pending events are held in `localStorage` under `assessx.proctoring-events.{attempt_id}` bounded to 200 entries.
- If storage is restricted or disabled, events remain buffered in-memory for the lifetime of the desktop window.
- The queue is drained sequentially (FIFO) to preserve relative temporal causality.

### 2.3 Autorun & Termination Handling
- Once the attempt is locked (`SUBMITTED` or `TIME_EXPIRED`), the backend rejects new events with `attempt_locked` (HTTP 409).
- When `attempt_locked` or `event_limit_reached` is received, the client halts retry loops and discards obsolete queue entries cleanly.

