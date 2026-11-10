# ASSESSX — PHASE 4C API SPECIFICATION
## Live Monitoring, Stream Authorization & Audit Endpoints

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4C  
**Status:** Approved Specification

---

## 1. Monitoring REST Endpoints

### 1.1 Examination Summaries
```http
GET /api/v1/admin/monitoring/exams
```
Returns examinations with live operational telemetry (`total_assigned`, `active_sessions`, `submitted_count`, `interrupted_count`, `proctoring_enabled`).

---

### 1.2 Active Monitoring Sessions
```http
GET /api/v1/admin/monitoring/sessions?assessment_id={uuid}
```
Returns summary metrics and active `MonitoringSession` tiles, optionally scoped to an examination.

---

### 1.3 Candidate Detail Snapshot
```http
GET /api/v1/admin/monitoring/sessions/{attempt_id}
```
Returns `MonitoringDetail` with live device readiness, AI status, exam control, and recent proctoring events. Records `DETAIL_OPENED` in `monitoring_audit_events`.

---

### 1.4 Authorized Stream Request & Audit
```http
POST /api/v1/admin/monitoring/sessions/{attempt_id}/stream/request
```
Validates administrator role and active session eligibility, records `STREAM_REQUESTED` & `STREAM_GRANTED` in `monitoring_audit_events`, and returns short-lived authorization metadata (`attempt_id`, `expires_at`, `stream_grant_id`).

---

### 1.5 Stream Termination Audit
```http
POST /api/v1/admin/monitoring/sessions/{attempt_id}/stream/terminate
```
Records `STREAM_ENDED` audit entry when an administrator closes the stream or stops viewing.

---

### 1.6 Monitoring Access Audit Log
```http
GET /api/v1/admin/monitoring/audit?attempt_id={uuid}&limit=50&offset=0
```
Returns paginated `MonitoringAuditEvent` history for institutional compliance and accountability.

---

## 2. WebSocket Endpoints

- **Admin Socket:** `WS /api/v1/ws/admin/monitoring?ticket={ticket}`
  - Receives: `CONNECTION_READY`, `SESSION_UPDATED`, `SESSION_REMOVED`, `PROCTORING_EVENT`, `WEBRTC_OFFER`, `ICE_CANDIDATE`, `PUBLISH_STATE`.
  - Sends: `WATCH`, `UNWATCH`, `WEBRTC_ANSWER`, `ICE_CANDIDATE`.
- **Candidate Socket:** `WS /api/v1/ws/candidates/me/proctoring?ticket={ticket}&attempt_id={uuid}`
  - Receives: `CONNECTION_READY`, `WATCH`, `UNWATCH`, `WEBRTC_ANSWER`, `ICE_CANDIDATE`, `ATTEMPT_CONTROL`.
  - Sends: `WEBRTC_OFFER`, `ICE_CANDIDATE`, `PUBLISH_STATE`.

