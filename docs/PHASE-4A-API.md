# AssessX Phase 4A API Specification
## Proctoring Session Foundation

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4A  
**Base URL:** `/api/v1`  
**Authentication:** Candidate Bearer Token (`CandidateUser`) / Admin Bearer Token (`AdminUser`)

---

## 1. Candidate Proctoring Endpoints

### 1.1 Retrieve Proctoring Session State
* **Method:** `GET`
* **Route:** `/api/v1/candidates/me/attempts/{attempt_id}/proctoring`
* **Response:** `200 OK`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "attempt_id": "550e8400-e29b-41d4-a716-446655440001",
  "status": "NOT_STARTED",
  "camera_state": "READY",
  "microphone_state": "READY",
  "selected_camera_id": "camera-dev-id-1234",
  "selected_camera_label": "Integrated Webcam (04f2:b61e)",
  "selected_microphone_id": "mic-dev-id-5678",
  "selected_microphone_label": "Microphone Array (Realtek Audio)",
  "readiness_state": "READY",
  "device_failure_reason": null,
  "interruption_count": 0,
  "started_at": null,
  "ended_at": null,
  "devices_reported_at": "2026-11-09T18:00:00Z"
}
```

---

### 1.2 Report Proctoring Readiness
* **Method:** `POST`
* **Route:** `/api/v1/candidates/me/attempts/{attempt_id}/proctoring/readiness`
* **Request Body:**
```json
{
  "camera": "READY",
  "microphone": "READY",
  "selected_camera_id": "camera-dev-id-1234",
  "selected_camera_label": "Integrated Webcam (04f2:b61e)",
  "selected_microphone_id": "mic-dev-id-5678",
  "selected_microphone_label": "Microphone Array (Realtek Audio)",
  "readiness_state": "READY",
  "device_failure_reason": null
}
```
* **Response:** `200 OK` (`ProctoringSessionOut`)

---

### 1.3 Activate Proctoring Session
* **Method:** `POST`
* **Route:** `/api/v1/candidates/me/attempts/{attempt_id}/proctoring/activate`
* **Request Body:**
```json
{
  "camera": "READY",
  "microphone": "READY",
  "selected_camera_id": "camera-dev-id-1234",
  "selected_camera_label": "Integrated Webcam (04f2:b61e)",
  "selected_microphone_id": "mic-dev-id-5678",
  "selected_microphone_label": "Microphone Array (Realtek Audio)",
  "readiness_state": "READY",
  "evidence_recorder": false
}
```
* **Response:** `200 OK` (`ProctoringSessionOut`)
* **Errors:**
  - `400 Bad Request` if camera or microphone is not `READY`.
  - `403 Forbidden` if attempt is already locked/finalized.
  - `404 Not Found` if exam is not proctored.

---

### 1.4 Report Device Availability Change
* **Method:** `PUT`
* **Route:** `/api/v1/candidates/me/attempts/{attempt_id}/proctoring/devices`
* **Request Body:**
```json
{
  "camera": "UNAVAILABLE",
  "microphone": "READY",
  "readiness_state": "CAMERA_UNAVAILABLE",
  "device_failure_reason": "Device was unplugged"
}
```
* **Response:** `200 OK` (`ProctoringSessionOut`)

---

### 1.5 Report Device Interruption
* **Method:** `POST`
* **Route:** `/api/v1/candidates/me/attempts/{attempt_id}/proctoring/interruption`
* **Request Body:**
```json
{
  "device_type": "camera",
  "reason": "TRACK_ENDED",
  "message": "Camera hardware connection was severed"
}
```
* **Response:** `200 OK` (`ProctoringSessionOut`)

---

### 1.6 Stop Proctoring Session
* **Method:** `POST`
* **Route:** `/api/v1/candidates/me/attempts/{attempt_id}/proctoring/stop`
* **Response:** `200 OK`
```json
{
  "attempt_id": "550e8400-e29b-41d4-a716-446655440001",
  "status": "ENDED",
  "stopped_at": "2026-11-09T18:30:00Z"
}
```

---

## 2. Admin Proctoring Inspection Endpoint

### 2.1 Get Attempt Proctoring Detail
* **Method:** `GET`
* **Route:** `/api/v1/admin/attempts/{attempt_id}/proctoring`
* **Response:** `200 OK` (`AdminProctoringDetail`)
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "attempt_id": "550e8400-e29b-41d4-a716-446655440001",
  "candidate_id": "550e8400-e29b-41d4-a716-446655440002",
  "status": "ACTIVE",
  "camera_state": "READY",
  "microphone_state": "READY",
  "selected_camera_id": "camera-dev-id-1234",
  "selected_camera_label": "Integrated Webcam (04f2:b61e)",
  "selected_microphone_id": "mic-dev-id-5678",
  "selected_microphone_label": "Microphone Array (Realtek Audio)",
  "readiness_state": "READY",
  "interruption_count": 0,
  "started_at": "2026-11-09T18:00:00Z",
  "ended_at": null,
  "devices_reported_at": "2026-11-09T18:05:00Z"
}
```

