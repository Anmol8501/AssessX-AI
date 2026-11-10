# ASSESSX — PHASE 2A IMPLEMENTATION REPORT
## Application Allowlisting & Execution Control

**Project:** AssessX  
**Phase:** 2A of 4 (Advanced Windows Security Enforcement)  
**Date:** November 8, 2026  
**Status:** Completed & Verified  

---

## 1. Executive Summary

Phase 2A implements **Application Allowlisting & Execution Control** for the AssessX Windows examination platform. It builds directly upon the Phase 1 foundation (Phase 1A: Device Provisioning, Phase 1B: Secure Shell, Phase 1C: Native Security Agent) without altering or regressing any existing functionality.

The objective of Phase 2A is to provide a deterministic, auditable system to identify, classify, allowlist, and supervise applications on candidate workstations. It ensures that only authorized processes execute during an examination, while strictly preserving candidate workstation safety through multi-stage policy transitions and an explicit administrator approval gate.

---

## 2. Architecture & Design Principles

1. **Non-Destructive Safety Default:**
   All execution-control mechanisms default to `AUDIT_MODE`. The system never terminates arbitrary processes or applies kernel-level restrictions without explicit administrator approval and a validated rollback plan.
2. **Deterministic Application Identity:**
   Applications are identified using a multi-attribute cryptographic signature:
   - Full executable path (normalized uppercase for comparison)
   - Canonical file name
   - Publisher name from Authenticode digital signatures
   - Cryptographic SHA-256 binary hash
   - File size and version metadata
3. **High-Performance In-Memory Caching:**
   To prevent hash recalculation overhead across periodic polling intervals, process identities are cached in a thread-safe `RwLock<HashMap<String, CachedIdentity>>` keyed by file path and last-modified timestamp.
4. **Graduated Windows Capability Detection:**
   Recognizing that Windows Home, Pro, and Enterprise editions expose distinct enforcement mechanisms, the engine assesses:
   - App Control for Business (WDAC)
   - AppLocker & Application Identity Service (`AppIDSvc`)
   - Software Restriction Policies (SRP - legacy)
   - In-Process Supervision & Watchdog Polling (Universal fallback)

---

## 3. Detailed Component Breakdown

### 3.1 Module 2A.1: Windows Application Inventory
- **Location:** `apps/desktop/src-tauri/src/application_control/identity.rs`, `inventory.rs`
- **Functionality:**
  - `ApplicationIdentity`: Struct capturing executable path, file name, publisher, product name, SHA-256 hash, and file size.
  - `RunningApplication`: Encapsulates process ID, parent process ID, session ID, command line arguments, start time, and cryptographic `ApplicationIdentity`.
  - Windows Process Enumeration: Uses Win32 ToolHelp32 snapshot (`CreateToolhelp32Snapshot`, `Process32FirstW`, `Process32NextW`) combined with `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, ...)` and `QueryFullProcessImageNameW` to safely inspect process paths across all integrity levels.
  - Authenticode Extraction: Inspects PE headers and Win32 version resources (`GetFileVersionInfoW`, `VerQueryValueW`).
  - Hash Computation & Caching: Thread-safe SHA-256 digest caching minimizes disk I/O on repeated scans.

### 3.2 Module 2A.2: Application Allowlist Manager
- **Location:** `apps/desktop/src-tauri/src/application_control/allowlist.rs`
- **Functionality:**
  - Rule Categories:
    - `CRITICAL_SYSTEM`: Core Windows operating system processes (`csrss.exe`, `lsass.exe`, `wininit.exe`, `services.exe`, etc.).
    - `ASSESSX_CORE`: AssessX desktop shell, background services, updater, and IPC agents.
    - `EXAM_REQUIRED`: Examination dependencies (e.g., approved calculator, secure browser runtime).
    - `EXAM_OPTIONAL`: Optional subject-specific tools.
    - `ADMIN_APPROVED`: Dynamically added institutional administrative exceptions.
  - Match Criteria: Matches by SHA-256 hash, normalized file path prefix, or publisher signature.
  - Persistence: Stores rules in `%APPDATA%\AssessX\application_allowlist.json`.

### 3.3 Module 2A.3: Windows Enforcement Capability Detection
- **Location:** `apps/desktop/src-tauri/src/application_control/capability.rs`
- **Functionality:**
  - Queries Windows edition via WMI/Registry (`Caption` in `Win32_OperatingSystem`).
  - Evaluates WDAC support (available on Windows 10/11 Pro, Enterprise, Education).
  - Evaluates AppLocker support (requires Enterprise/Education and running `AppIDSvc` service).
  - Inspects `AppIDSvc` service status via Windows Service Control Manager (`OpenSCManagerW`, `OpenServiceW`, `QueryServiceStatusProcess`).
  - Recommends best enforcement mode (`PROCESS_SUPERVISION` on Home/Pro without AppLocker; `APPLOCKER` or `WDAC` on Enterprise/Education).

### 3.4 Module 2A.4: Application-Control Policy Engine
- **Location:** `apps/desktop/src-tauri/src/application_control/policy.rs`
- **Functionality:**
  - Formal State Lifecycle:
    `DRAFT` → `VALIDATED` → `AWAITING_ADMIN_APPROVAL` → `APPLYING` → `VERIFYING` → `ACTIVE` (or `FAILED` / `REVERTED`).
  - Change Journal Integration: All policy adjustments are logged to the Phase 1A provisioning journal before application.
  - Preview & Validation: Verifies that AssessX core components and critical Windows processes are not inadvertently blocked.
  - Reversion: Instant fallback to `AUDIT_MODE` or previous allowlist upon command.

### 3.5 Module 2A.5: Unauthorized Application Detection & Classifier
- **Location:** `apps/desktop/src-tauri/src/application_control/detector.rs`
- **Functionality:**
  - Evaluates all active processes against the current allowlist.
  - Classifies each process into:
    - `APPROVED`: Matches active allowlist rule.
    - `UNAPPROVED`: Unknown executable running without allowlist entry (logged in audit mode).
    - `DENIED`: Explicitly blacklisted executable (e.g., prohibited remote access, debuggers, screen recorders).
  - Tamper & Security Event Dispatch: Emits tamper events to the Phase 1C `tamper` module when unapproved or denied applications run during an active exam session.

### 3.6 Module 2A.6: Security Agent IPC Integration
- **Location:** `apps/desktop/src-tauri/src/security_agent/protocol.rs`, `ipc.rs`
- **Functionality:**
  - Extended Named Pipe IPC protocol with 4 new request discriminants:
    - `GetAppInventory`: Returns running applications with identities.
    - `GetAppAllowlist`: Returns active allowlist rules and mode.
    - `GetEnforcementCapabilities`: Returns detected Windows capabilities.
    - `ScanApplicationViolations`: Triggers real-time security scan and returns classification summary.

### 3.7 Module 2A.7: Administrator Policy Management UI
- **Location:** `apps/desktop/src/features/admin/application-control/`
- **Components:**
  - `ApplicationControlCard.tsx`: Multi-tab administration card with:
    1. **Running Applications Tab:** Real-time process list with SHA-256 hashes, publishers, and one-click allowlisting.
    2. **Allowlist Rules Tab:** Categorized allowlist entries with search, rule addition, and removal.
    3. **Enforcement & Capabilities Tab:** Edition check, AppLocker / WDAC status, mode selector (Audit, Supervised, Enforced), and approval dialog.
    4. **Violations & Security Scan Tab:** One-click vulnerability scan displaying approved, unapproved, and denied process counts.
  - Mounted cleanly in `apps/desktop/src/features/admin/pages/SettingsPage.tsx`.

### 3.8 Module 2A.8: Backend & API Integration
- **Location:** `backend/app/schemas/device.py`, `backend/app/api/v1/devices.py`
- **Endpoints:**
  - `POST /api/v1/devices/{device_identifier}/applications/inventory`: Receives candidate workstation application inventories.
  - `GET /api/v1/devices/{device_identifier}/applications/allowlist`: Supplies customized application allowlists and enforcement modes per device/institution.

---

## 4. Verification & Testing Matrix

| Test Suite | Scope | Result | Details |
|---|---|---|---|
| Rust Unit Tests | `application_control::*` | **9 / 9 PASSED** | Identity extraction, baseline rules, capabilities, approval gate, classifier |
| Rust Regression | `security_agent::*` | **15 / 15 PASSED** | IPC protocol extensions, watchdog, tamper logging, heartbeat |
| Rust Regression | `secure_shell::*` | **11 / 11 PASSED** | Kiosk capabilities, lifecycle, crash recovery, restoration |
| Rust Regression | `provisioning::*` | **10 / 10 PASSED** | Device readiness, hardware, candidate account, validation |
| Desktop Unit Tests | Vitest (`test:unit`) | **273 / 273 PASSED** | All 24 test suites passing, including new `applicationControl.test.ts` |
| TypeScript Compiler | `npx tsc -b` | **0 ERRORS** | Full strict TypeScript compilation succeeded |
| Desktop Linter | `npx oxlint` | **0 ERRORS** | Clean linting pass across 328 files |
| Backend Linter | `uv run ruff check` | **ALL CHECKS PASSED** | Pydantic v2 schemas and FastAPI endpoints verified |

---

## 5. Safety, Integrity & Rollback

- **No Developer Lockout:** All default policies initialize in `AUDIT_MODE`.
- **Protected Processes:** The baseline allowlist protects Windows kernel subsystems and developer IDEs during non-examination states.
- **Fail-Safe Restoration:** In the event of an unexpected termination, the Phase 1B crash recovery and Phase 1C watchdog automatically revert any transient execution blocks.

---

## 6. Conclusion & Next Phase Readiness

Phase 2A is fully functional, thoroughly tested, and integrated. The AssessX platform now has complete visibility and execution-control governance over running applications.

**Ready for Phase 2B:** Advanced Command Shell & Scripting Enforcement (PowerShell, CMD, and Script Host Restrictions).

