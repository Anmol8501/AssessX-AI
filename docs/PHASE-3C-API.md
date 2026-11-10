# ASSESSX — PHASE 3C API SPECIFICATION
## Submission, Exit Authorization & Closure Endpoints

**Base Prefix:** `/api/v1/candidates/me/attempts/{attempt_id}`

---

### 1. `POST /submission/prepare`
**Purpose:** Pre-submission validation and question progress summary.  
**Response:**
```json
{
  "attempt_id": "uuid",
  "total_questions": 20,
  "answered_questions": 18,
  "unanswered_questions": 2,
  "remaining_seconds": 1420,
  "pending_sync_count": 0,
  "eligible_for_submission": true,
  "reason": null
}
```

---

### 2. `POST /submission/confirm`
**Purpose:** Finalizes examination, freezes answers, creates immutable snapshot and receipt.  
**Request:**
```json
{
  "idempotency_key": "uuid-or-unique-string",
  "device_id": "DESKTOP-WIN-9901",
  "submission_type": "MANUAL"
}
```
**Response:**
```json
{
  "attempt_id": "uuid",
  "submission_id": "uuid",
  "receipt_id": "RCPT-A1B2C3D4-20261109-HEX",
  "submission_type": "MANUAL",
  "submitted_at": "2026-11-09T10:30:00Z",
  "snapshot_hash": "sha256-hex-digest",
  "total_questions": 20,
  "total_answered": 18,
  "status": "SUBMITTED"
}
```

---

### 3. `GET /submission/receipt`
**Purpose:** Retrieves authoritative submission receipt after reload or restart.  
**Response:**
```json
{
  "receipt_id": "RCPT-A1B2C3D4-20261109-HEX",
  "submission_id": "uuid",
  "attempt_id": "uuid",
  "candidate_name": "Jane Candidate",
  "examination_title": "Advanced Operating Systems",
  "submitted_at": "2026-11-09T10:30:00Z",
  "submission_type": "MANUAL",
  "snapshot_hash": "sha256-hex-digest",
  "total_answered": 18,
  "total_questions": 20,
  "status": "SUBMITTED"
}
```

---

### 4. `POST /closure/authorize`
**Purpose:** Authorizes examination closure and returns signed cryptographic exit token.  
**Request:**
```json
{
  "device_id": "DESKTOP-WIN-9901"
}
```
**Response:**
```json
{
  "attempt_id": "uuid",
  "authorized": true,
  "exit_token": "token.timestamp.hmac_signature",
  "expires_at": "2026-11-09T10:45:00Z",
  "allowed_actions": ["RESTORE_ENVIRONMENT", "RELEASE_LOCKDOWN", "EXIT_SHELL"]
}
```

---

### 5. `POST /closure/complete`
**Purpose:** Reports successful native Windows security restoration to backend.  
**Request:**
```json
{
  "device_id": "DESKTOP-WIN-9901",
  "exit_token": "token.timestamp.hmac_signature",
  "restoration_status": "RESTORED",
  "restored_subsystems": ["NAVIGATION", "SYSTEM_UTILITIES", "APPLICATION_CONTROL", "PERIPHERALS", "LOCKDOWN_WINDOW"]
}
```
**Response:**
```json
{
  "attempt_id": "uuid",
  "closure_status": "CLOSED",
  "completed_at": "2026-11-09T10:31:00Z"
}
```

---

### 6. `GET /api/v1/admin/attempts/{attempt_id}/submission`
**Purpose:** Admin audit view of submission, snapshot integrity hash, and closure records.

