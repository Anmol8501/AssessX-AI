# AssessX Phase 4A Proctoring Lifecycle Specification

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4A — Proctoring Session Foundation  

---

## 1. Lifecycle Coordination with Exam Phases

### 1.1 Phase 3A (Activation Binding)
* An attempt is created when the candidate begins.
* If `assessment.proctoring_required == true`, the backend creates an associated `ProctoringSession` with status `NOT_STARTED`.
* The candidate cannot enter the examination paper until the proctoring check passes.
* When the candidate clicks "Start Exam", `activate()` is called with `DeviceReport`.
* The backend transitions the session to `ACTIVE` and records `started_at = utcnow()`.

### 1.2 Active Examination Monitoring (Phase 4A & 3B)
* While the candidate is answering questions:
  - If a device disconnects or is captured by another app, `track.onended` fires on the client.
  - The client transitions local state to `UNAVAILABLE` and notifies the server via `PUT /attempts/{attempt_id}/proctoring/devices` or `POST /attempts/{attempt_id}/proctoring/interruption`.
  - The server logs the event and increments `interruption_count`.
  - When the candidate plugs the device back in, `devicechange` event triggers an automatic recheck and recovery to `ACTIVE`.

### 1.3 Phase 3C (Submission & Teardown Closure)
* When the candidate confirms submission or time expires:
  - Examination closure begins.
  - Desktop client calls `mediaStream.getTracks().forEach(t => t.stop())`.
  - Camera and microphone hardware activity LEDs turn OFF immediately.
  - The backend marks the attempt `SUBMITTED` or `TIME_EXPIRED` and atomically transitions `ProctoringSession.status` to `ENDED` with `ended_at = finalized_at`.
  - Stop is completely idempotent.

