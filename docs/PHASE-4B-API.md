# ASSESSX — PHASE 4B API SPECIFICATION
## Proctoring Environment Events & Admin Timeline Endpoints

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4B  
**Parent Phase:** Phase 4 — Basic Proctoring & Live Monitoring  
**Status:** Approved Specification

---

## 1. Candidate Event Ingestion Endpoints

### 1.1 Ingest Environment Event
```http
POST /api/v1/candidates/me/attempts/{attempt_id}/proctoring/events
```

**Security:** Candidate bearer token required; strictly scoped to the authenticated candidate.

**Request Body (`ProctoringEventIn`):**
```json
{
  "event_type": "FULLSCREEN_EXIT",
  "client_event_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "client_reported_at": "2026-11-09T18:00:00Z",
  "metadata": {
    "previous_state": "fullscreen",
    "current_state": "windowed",
    "reason": "user"
  }
}
```

**Responses:**
- `201 Created`: Event accepted and persisted.
- `200 OK`: Duplicate retry recognized; previously saved event returned.
- `409 Conflict`: Attempt locked (`attempt_locked`) or proctoring not active (`proctoring_not_active`).
- `422 Unprocessable Entity`: Unknown event type or invalid metadata properties.

**Response Body (`ProctoringEventOut`):**
```json
{
  "id": "e4b2d588-4229-4d69-a86d-1bfb66860012",
  "event_type": "FULLSCREEN_EXIT",
  "category": "WINDOW",
  "severity": "MEDIUM",
  "source": "CLIENT",
  "metadata": {
    "previous_state": "fullscreen",
    "current_state": "windowed",
    "reason": "user"
  },
  "recorded_at": "2026-11-09T18:00:00.123456Z",
  "client_reported_at": "2026-11-09T18:00:00Z",
  "clip_request": null
}
```

---

### 1.2 Candidate Proctoring Events Status
```http
GET /api/v1/candidates/me/attempts/{attempt_id}/proctoring/events/status
```

**Response Body:**
```json
{
  "attempt_id": "7a353683-fc36-4cf0-8802-0e31e679a78a",
  "session_id": "d05fe7bb-84ad-4cbe-bda2-1bf7183eec18",
  "total_events": 14,
  "last_event_recorded_at": "2026-11-09T18:05:12.450123Z",
  "session_status": "ACTIVE"
}
```

---

## 2. Administrator Monitoring Endpoints

### 2.1 List Proctoring Events
```http
GET /api/v1/admin/attempts/{attempt_id}/proctoring/events?limit=50&category=WINDOW&severity=MEDIUM
```

**Security:** Admin token required (`AdminUser`).

**Query Parameters:**
- `limit` (int, default 50, max 200)
- `offset` (int, default 0)
- `category` (optional `ProctoringEventCategory`)
- `event_type` (optional `ProctoringEventType`)
- `severity` (optional `INFO`, `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
- `since` (optional ISO 8601 datetime)
- `until` (optional ISO 8601 datetime)

**Response Body:**
```json
{
  "attempt_id": "7a353683-fc36-4cf0-8802-0e31e679a78a",
  "total": 4,
  "limit": 50,
  "offset": 0,
  "items": [
    {
      "id": "e4b2d588-4229-4d69-a86d-1bfb66860012",
      "event_type": "FULLSCREEN_EXIT",
      "category": "WINDOW",
      "severity": "MEDIUM",
      "source": "CLIENT",
      "metadata": {
        "previous_state": "fullscreen",
        "current_state": "windowed",
        "reason": "user"
      },
      "recorded_at": "2026-11-09T18:00:00.123456Z",
      "client_reported_at": "2026-11-09T18:00:00Z"
    }
  ]
}
```

