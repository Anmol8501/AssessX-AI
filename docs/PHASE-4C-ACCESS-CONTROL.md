# ASSESSX — PHASE 4C ACCESS CONTROL
## Authorization Boundaries & Signaling Enforcement

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4C  
**Status:** Approved Specification

---

## 1. Access Control Model

- **Admin Enforcement (`AdminUser`):** All `/api/v1/admin/monitoring/*` routes enforce `UserRole.ADMIN`. Candidate tokens receive HTTP 403; unauthenticated calls receive HTTP 401.
- **WebSocket Admission (`SocketGuard` & `admit`):**
  - Requires single-use ticket (`WS /api/v1/ws/admin/monitoring?ticket=...`).
  - Validates `user.role == UserRole.ADMIN` before socket acceptance.
  - Enforces per-user concurrent connection limits (`slots`).
  - Periodically revalidates session authenticity during socket lifetime (`SocketGuard`).
- **Stream Pairing Validation:**
  - `WATCH` checks `_is_active_monitorable(attempt_id)` — refuses ended or unproctored attempts.
  - `WEBRTC_ANSWER` and `ICE_CANDIDATE` are dropped unless `hub.is_watching(attempt_id, ws)` is true.
  - Candidate signaling validates `_owned_active_session(user.id, attempt_id)`.
- **No Content Mutation:** Monitoring routes cannot alter candidate answers, adjust exam clocks, or bypass submission closure.

