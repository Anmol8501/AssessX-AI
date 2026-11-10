# ASSESSX — PHASE 2B IMPLEMENTATION REPORT
## PowerShell, Command Prompt, Task Manager & System Utility Restrictions

**Project:** AssessX  
**Phase:** 2B of 4 (Advanced Windows Security Enforcement)  
**Date:** November 8, 2026  
**Status:** Completed & Verified  

---

## 1. Executive Summary

Phase 2B implements **PowerShell, Command Prompt, Task Manager & System Utility Restrictions** for the AssessX Windows examination platform. It builds upon Phase 2A (Application Allowlisting & Execution Control) and the Phase 1 foundation (Device Provisioning, Secure Shell, and Native Security Agent).

The primary objective is to enforce administrator-controlled, account-scoped restrictions against high-risk command shells, process management tools, and administrative utilities on candidate workstations during an examination, while strictly preserving workstation stability, accessibility tools, developer safety, and administrator maintenance recovery.

---

## 2. Architecture & Design Principles

1. **Account-Scoped Policy Enforcement:**
   Restrictions target the dedicated examination account (`AssessXCandidate`) using user-scoped registry policies (`HKEY_USERS\<CandidateSID>\...`) or candidate user session environment controls. Authorized administrators, service accounts, and Windows background recovery mechanisms are never locked out of Task Manager, CMD, or PowerShell.
2. **Native Windows Policy Enforcement:**
   Rather than relying purely on userland keyboard hooks or reactive process termination, the subsystem directly configures and verifies supported Windows policy keys:
   - `DisableTaskMgr` (DWORD: 1) under `Software\Microsoft\Windows\CurrentVersion\Policies\System`
   - `DisableCMD` (DWORD: 1 = disable interactive prompt; DWORD: 2 = disable prompt and batch execution) under `Software\Policies\Microsoft\Windows\System`
   - `DisableRegistryTools` (DWORD: 1) under `Software\Microsoft\Windows\CurrentVersion\Policies\System`
   - PowerShell Constrained Language Mode (`__PSLockdownPolicy = 4`) and script execution policies.
3. **Critical Operating System Component Protection:**
   Essential Windows components (`explorer.exe` shell, `dwm.exe` compositor, `csrss.exe`, `lsass.exe`, `services.exe`, `ctfmon.exe`, `TextInputHost.exe`, and AssessX desktop binaries) are protected by a non-overridable safety guard. Any attempt to block or restrict a critical component is immediately rejected during policy validation.
4. **Independent Post-Application Verification:**
   No restriction is marked `ACTIVE` merely because an API was called. The engine performs an independent verification read from the Windows registry. If the verified state does not match the requested state, it transitions to `VERIFICATION_FAILED` and automatically rolls back.
5. **Change Journal & Reversion:**
   Every registry change is logged to the Phase 1A change journal prior to execution, and all policies default to `DETECTION_ONLY` (Audit Mode), guaranteeing that developer machines remain safe.

---

## 3. Detailed Component Breakdown

### 3.1 Module 2B.1: PowerShell Restriction Module
- **Location:** `apps/desktop/src-tauri/src/system_utility/powershell.rs`
- **Functionality:**
  - Discovers Windows PowerShell (v5.1 in `System32\WindowsPowerShell\v1.0\powershell.exe`) and PowerShell 7 Core (`Program Files\PowerShell\7\pwsh.exe`).
  - Normalizes identities using Phase 2A `ApplicationIdentity` (calculates SHA-256 binary hash, Authenticode publisher, and product version).
  - Configurable modes: `Allow`, `Restrict` (Constrained Language Mode), `Block`, `DetectionOnly`.
  - Scoped to examination account while preserving administrator administrative access.

### 3.2 Module 2B.2: Command Prompt Restriction Module
- **Location:** `apps/desktop/src-tauri/src/system_utility/cmd.rs`
- **Functionality:**
  - Discovers `cmd.exe` in `System32` and `SysWOW64`.
  - Integrates with Windows `DisableCMD` registry policy key.
  - Supports `Restrict` (DWORD 1: interactive prompt disabled, scripts permitted) and `Block` (DWORD 2: both prompt and batch scripts prohibited).
  - Re-reads and independently verifies registry DWORD value after modification.

### 3.3 Module 2B.3: Task Manager Restriction Module
- **Location:** `apps/desktop/src-tauri/src/system_utility/task_manager.rs`
- **Functionality:**
  - Discovers `taskmgr.exe` in `System32`.
  - Integrates with Windows `DisableTaskMgr` registry policy key (DWORD 1).
  - Account-scoped to candidate profile; preserves administrator recovery workflows.
  - Verification read ensures Task Manager access is reliably governed.

### 3.4 Module 2B.4: System Utility Inventory & Categorization
- **Location:** `apps/desktop/src-tauri/src/system_utility/inventory.rs`
- **Functionality:**
  - Categorizes system utilities into Categories A through F:
    - **Category A (Command & Scripting):** `powershell.exe`, `pwsh.exe`, `cmd.exe`, `wscript.exe`, `cscript.exe`, `mshta.exe`
    - **Category B (Process & Task Management):** `taskmgr.exe`, `resmon.exe`, `perfmon.exe`
    - **Category C (Administrative Consoles):** `regedit.exe`, `mmc.exe`
    - **Category D (System Configuration):** `msconfig.exe`, `control.exe`
    - **Category E (System Navigation):** `explorer.exe` (Protected Shell), `WindowsTerminal.exe`
    - **Category F (Custom Utilities):** Institutional administrative exceptions
  - Assigns criticality levels (`CriticalProtected`, `HighRisk`, `MediumRisk`, `LowRisk`).
  - Implements `is_protected_system_utility` guard for essential OS components.

### 3.5 Module 2B.5: Centralized System Utility Policy Manager & Conflict Detector
- **Location:** `apps/desktop/src-tauri/src/system_utility/policy.rs`
- **Functionality:**
  - State lifecycle: `Draft` → `Validated` → `AwaitingAdminApproval` → `Applying` → `Verifying` → `Active` (with `ValidationFailed`, `ApprovalDenied`, `ApplyFailed`, `VerificationFailed`, `RestorationRequired`).
  - Pre-flight conflict detector: Blocks attempts to restrict protected Windows executables.
  - Explicit administrator approval gate: Requires confirmed administrator token to apply policies.
  - One-click safe baseline restoration: Instantly removes restriction keys and resets modes to `DetectionOnly`.

### 3.6 Module 2B.6: Real-time Detector & Security Agent IPC Integration
- **Location:** `apps/desktop/src-tauri/src/system_utility/detector.rs`, `security_agent/protocol.rs`, `security_agent/ipc.rs`
- **Functionality:**
  - Scans active processes against the configured utility policy.
  - Emits structured tamper and security events:
    - `POWERSHELL_EXECUTION_DETECTED` / `POWERSHELL_EXECUTION_BLOCKED`
    - `CMD_EXECUTION_DETECTED` / `CMD_EXECUTION_BLOCKED`
    - `TASK_MANAGER_ACCESS_DETECTED` / `TASK_MANAGER_ACCESS_BLOCKED`
    - `SYSTEM_UTILITY_ACCESS_BLOCKED`
  - Dispatches events to Phase 1C `TamperDetector` and queues in `BackendClient`.
  - Extended Named Pipe IPC with `GetUtilityInventory`, `GetUtilityPolicy`, and `ScanUtilityViolations`.

### 3.7 Module 2B.7: Administrator Dashboard UI
- **Location:** `apps/desktop/src/features/admin/system-utility/`
- **Components:**
  - `types.ts`: TypeScript contracts for inventory, shell reports, policy config, and scan summaries.
  - `systemUtility.ts`: Typed IPC client bridge invoking Tauri backend commands.
  - `SystemUtilityCard.tsx`: Multi-tab administration card mounted cleanly in `SettingsPage.tsx`:
    - **Core Shells & Task Manager Tab:** Live status cards for PowerShell, CMD, and Task Manager with mode selectors.
    - **Utility Inventory Tab:** Searchable table with category tags, criticality badges, and OS protection flags.
    - **Policy Engine & Approval Tab:** Lifecycle badge, conflict preview, registry targets, approval checkbox, and apply/revert controls.
    - **Violations & Security Scan Tab:** One-click process vulnerability scan with violation table.

### 3.8 Module 2B.8: Backend API & Database Schemas
- **Location:** `backend/app/schemas/device.py`, `backend/app/api/v1/devices.py`
- **Functionality:**
  - `SystemUtilityItemSchema`, `DeviceSystemUtilityReport`, `SystemUtilityPolicyResponse`, and `SystemUtilityPolicyUpdateRequest`.
  - `POST /api/v1/devices/{device_identifier}/utilities/report`: Ingests workstation utility status and shell restriction state.
  - `GET /api/v1/devices/{device_identifier}/utilities/policy`: Supplies active utility policies.

---

## 4. Verification & Testing Matrix

| Test Suite | Scope | Result | Details |
|---|---|---|---|
| Rust Unit Tests | `system_utility::*` | **17 / 17 PASSED** | Catalog completeness, critical guards, discovery, registry keys, policy lifecycle, detector |
| Rust Regression | `application_control::*` | **9 / 9 PASSED** | Phase 2A allowlist matching, capabilities, and inventory |
| Rust Regression | `security_agent::*` | **15 / 15 PASSED** | Extended IPC request discriminants, watchdog, tamper logging, heartbeat |
| Rust Regression | `secure_shell::*` | **11 / 11 PASSED** | Kiosk capabilities, lifecycle, crash recovery, restoration |
| Rust Regression | `provisioning::*` | **10 / 10 PASSED** | Device readiness, hardware, candidate account, validation |
| Desktop Unit Tests | Vitest (`test:unit`) | **280 / 280 PASSED** | All 25 test suites passing, including new `systemUtility.test.ts` |
| TypeScript Compiler | `npx tsc -b` | **0 ERRORS** | Full strict TypeScript compilation succeeded |
| Desktop Linter | `npx oxlint` | **0 ERRORS** | Clean linting pass across 332 files |
| Backend Linter | `uv run ruff check` | **ALL CHECKS PASSED** | Pydantic v2 schemas and FastAPI endpoints verified |

---

## 5. Acceptance Criteria Verification

1. **PowerShell Detection & Scoping:** Windows PowerShell and PowerShell 7 detected, with Constrained Language Mode and policy states (`Available`, `Restricted`, `BlockedByPolicy`, `DetectionOnly`).
2. **Command Prompt Detection & Scoping:** Discovered `cmd.exe`, integrated with `DisableCMD` (DWORD 1/2), and verified via registry re-read.
3. **Task Manager Detection & Scoping:** Discovered `taskmgr.exe`, integrated with `DisableTaskMgr` (DWORD 1), with administrator recovery workflow preserved.
4. **Categorized Inventory:** Categories A through F populated with hashes, publishers, and non-overridable OS protections.
5. **Conflict Detection:** Attempting to restrict `explorer.exe` or core OS components is blocked with `CRITICAL_COMPONENT_PROTECTION`.
6. **Administrator Approval Gate:** Required explicit administrator confirmation to transition policy out of `AwaitingAdminApproval`.
7. **Security Agent & Event Reporting:** Real-time detector dispatches tamper and queued security events.
8. **Rollback & Recovery:** Revert button and automatic rollback on verification failure restore baseline settings.
9. **No Regression:** All Phase 1A, 1B, 1C, and 2A tests continue to pass at 100%.
10. **Git Cleanliness:** All changes remain unstaged and uncommitted in local workspace.

---

## 6. Conclusion & Next Phase Readiness

Phase 2B is fully implemented, verified, and integrated into AssessX. The system prevents candidate access to unauthorized command shells and administrative utilities through native, account-scoped Windows policies.

**Ready for Phase 2C:** Advanced Keyboard Shortcut, Windows Key & Navigation Restrictions.

