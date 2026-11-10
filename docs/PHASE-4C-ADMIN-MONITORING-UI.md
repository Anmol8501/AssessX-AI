# ASSESSX — PHASE 4C ADMIN MONITORING UI
## Monitoring Wall, 4×4 Grid, Filtering & Candidate Detail Layout

**Project:** AssessX — AI-Powered Secure Examination Platform  
**Phase:** 4C  
**Status:** Approved Specification

---

## 1. Dashboard Layout (`LiveMonitoringPage`)

### 1.1 Examination Selector & Status Bar
- Dropdown selector allowing administrators to view all active examinations or narrow down to a single examination.
- Displays examination title, status, scheduled window, total assigned, active candidates, submitted count, and interrupted session count.
- Displays realtime WebSocket connection status (`Live`, `Reconnecting…`, `Disconnected`).

### 1.2 Monitoring Summary Cards
Live aggregate metrics pulled from authoritative backend state:
- Active sessions count.
- Cameras connected count.
- Camera issues count.
- Microphone issues count.
- On-hold / interrupted sessions count.

### 1.3 Search & Status Filters
- **Search Input:** Instant filtering by candidate name or roll number/ID.
- **Filter Chips / Select:** `ALL`, `CONNECTED`, `INTERRUPTED`, `CAMERA_ISSUE`, `MIC_ISSUE`, `FULLSCREEN_EXIT`.

---

## 2. 4×4 Candidate Monitoring Grid (`CandidateMonitoringGrid`)

- Responsive 4-column grid displaying up to **16 candidate cards per page** (`PAGE_SIZE = 16`).
- **Pagination:** Safe clamping and `Previous` / `Next` controls when active candidates exceed 16.
- **Tile Data (`CandidateMonitoringTile`):**
  - Candidate name and masked identifier / roll number.
  - Examination title and status badge.
  - Camera, Microphone, Fullscreen, Candidate Presence, and AI observation counts.
  - State-only preview placeholder inviting click-to-open video to protect administrator bandwidth and CPU.

---

## 3. Candidate Detail View (`CandidateDetailView`)

- **Live Video Panel:**
  - Displays live WebRTC `<video>` stream when authorized and connected.
  - Clear connection status indicator (`Not requested`, `Connecting`, `Connected`, `Reconnecting`, `Failed`, `Candidate Offline`).
  - Explicit **Start/Reconnect Stream** and **Stop Viewing** controls.
  - **Audio Policy:** Microphone audio is muted by default (`audioOn = false`) and only unmuted on explicit administrator action when permitted.
- **Identity & Technical Status:**
  - Candidate ID, Attempt ID, Session ID, Started At, Device connectivity, and Last report timestamp.
- **Chronological Event Timeline:**
  - Powered by Phase 4B `GET /admin/attempts/{id}/proctoring/events` combined with live `PROCTORING_EVENT` WebSocket pushes.
  - Filterable by **Category** (`WINDOW`, `INPUT`, `DEVICE`, `DISPLAY`, `SYSTEM`, `RECOVERY`) and **Severity** (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO`).

