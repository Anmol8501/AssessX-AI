# AssessX Phase 4A Test Plan & Verification Strategy

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4A — Proctoring Session Foundation  

---

## 1. Test Scope & Objectives

Verify:
- Device enumeration and readable labels.
- Device selection persistence.
- Constraints generation for camera and microphone.
- Readiness state calculation under various hardware conditions.
- Error classification (permission denied, not found, busy/in-use).
- Disconnection and reconnection behavior.
- Backend API endpoints (readiness, activation, device status, interruption, stop).
- Schema validation and constraint enforcement.
- Privacy and track cleanup.

---

## 2. Test Execution Plan

1. **Frontend Unit Tests (`apps/desktop/src/features/proctoring/__tests__/devices.test.ts`)**:
   - `test_device_classification`: Classify standard DOMException types.
   - `test_constraints_generation`: Verify constraints with and without exact `deviceId`.
   - `test_device_enumeration`: Mock `navigator.mediaDevices.enumerateDevices` and test filtering.
   - `test_device_id_persistence`: Test storage and retrieval.
   - `test_readiness_calculation`: Verify state matrix against policy (camera-only vs camera+mic).
   - `test_track_release`: Verify track stopping on unmount.

2. **Backend Unit Tests (`backend/tests/test_proctoring_foundation.py`)**:
   - `test_device_report_schema_with_selected_devices`
   - `test_proctoring_readiness_schema`
   - `test_proctoring_interruption_schema`
   - `test_proctoring_session_out_schema`
   - `test_activation_requires_ready_devices`
   - `test_interruption_tracking`
   - `test_idempotent_stop_operation`

3. **Workspace Full Verification**:
   - `cargo test`
   - `pytest`
   - `npm run test:unit`
   - `npx tsc -b`
   - `npm run lint` / `ruff check`

