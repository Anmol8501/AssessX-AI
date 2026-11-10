# ASSESSX — PHASE 4C TEST PLAN
## Monitoring Dashboard, WebRTC Signaling & Security Verification

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4C  
**Status:** Approved Specification

---

## 1. Test Coverage Matrix

### 1.1 Backend Tests (`backend/tests/test_monitoring_foundation.py`)
- **M1: MonitoringAuditEvent Model & Schema Serialization:** Verify creation and serialization of monitoring audit events (`DASHBOARD_OPENED`, `DETAIL_OPENED`, `STREAM_REQUESTED`, `STREAM_GRANTED`, `STREAM_ENDED`).
- **M2: Stream Authorization Grant Schema:** Validate short-lived stream request grants with expiry and attempt binding.
- **M3: Exam Monitoring Summary Schema:** Verify exam counts (`total_assigned`, `active_sessions`, `submitted_count`, `interrupted_count`).
- **M4: Existing Suite Compatibility:** Validate compatibility with `test_monitoring.py` and `test_realtime.py`.

### 1.2 Desktop Unit Tests (`apps/desktop/src/features/admin/monitoring/__tests__/monitoringFoundation.test.ts`)
- **F1: 4×4 Grid Pagination Logic:** Verify page clamping, 16-item slicing, and navigation across large candidate counts.
- **F2: Candidate Search & Status Filtering:** Verify filtering by candidate name, roll number, examination ID, and device/hold status.
- **F3: Timeline Category & Severity Filtering:** Verify client-side filtering of proctoring events by Phase 4B category and severity.
- **F4: WebRTC MediaState & IceServer Parsing:** Verify WebRTC state indicators and ICE configuration helpers.

