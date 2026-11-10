# STAGE 0 REPOSITORY AUDIT & ARCHITECTURE PLAN
## AssessX — Phase 2B: PowerShell, Command Prompt, Task Manager & System Utility Restrictions

**Audit Date:** November 8, 2026  
**Status:** Audit Completed — Ready for Staged Implementation  

---

## 1. Executive Summary

AssessX provides institutions with a secure, controlled Windows examination environment. In Phase 2A, the project established **Application Allowlisting & Execution Control**, including cryptographic process identity normalization (SHA-256, path, publisher), process enumeration, capability detection (WDAC, AppLocker, in-process supervision), and a verified policy engine.

**Phase 2B (PowerShell, Command Prompt, Task Manager & System Utility Restrictions)** extends this foundation by implementing targeted, account-scoped restrictions against high-risk Windows management utilities and scripting shells:
1. **Windows PowerShell & PowerShell 7 (`pwsh.exe`)**
2. **Windows Command Prompt (`cmd.exe`)**
3. **Task Manager (`taskmgr.exe`)**
4. **Administrative & Diagnostic System Utilities** (Registry Editor, Computer Management, Services console, Local Group Policy Editor, etc.)
5. **Categorized System Utility Policy Management** with explicit safety boundaries and administrator approval.

### Primary Architectural Objectives:
- **Account-Scoped Enforcement:** Restrictions must apply to the dedicated examination account (`AssessXCandidate`) and must never lock out or impair the authorized administrator, IT maintenance accounts, or Windows background recovery mechanisms.
- **Genuine Windows-Native Enforcement:** In addition to Phase 2A process supervision and allowlist enforcement, native Windows policy mechanisms (Registry policy keys under `HKCU\Software\Policies`, `HKCU\Software\Microsoft\Windows\CurrentVersion\Policies`, and PowerShell ConstrainedLanguageMode) are leveraged and independently verified.
- **Non-Destructive Development Safety:** The engine defaults to `AUDIT_MODE` / `DETECTION_ONLY` unless explicitly commanded and approved by an administrator, preventing developer lockout.
- **Critical System Protection:** Essential operating system processes (`explorer.exe`, `dwm.exe`, `csrss.exe`, `lsass.exe`, `ctfmon.exe`, `TextInputHost.exe`, and AssessX binaries) are protected by a non-overridable bypass list.

---

## 2. Existing Repository State & Reusability Matrix

| Existing Component | Location | Phase 2B Reuse Role |
|---|---|---|
| **Application Identity & Inventory** | `src-tauri/src/application_control/identity.rs`, `inventory.rs` | Reused directly to discover executable paths, calculate SHA-256 hashes, verify Authenticode signatures, and enumerate running processes. |
| **Application Allowlist & Classifier** | `src-tauri/src/application_control/allowlist.rs`, `detector.rs` | Reused to classify utilities (`APPROVED`, `UNAPPROVED`, `DENIED`), match baseline system rules, and emit tamper/security events. |
| **Enforcement Capability Detector** | `src-tauri/src/application_control/capability.rs` | Reused to determine Windows edition, AppLocker availability, WDAC support, and AppIDSvc status. |
| **Candidate Account Foundation** | `src-tauri/src/provisioning/accounts.rs` | Reused to target the `AssessXCandidate` user account and retrieve user SID for per-user registry hive policies. |
| **Windows Info & Registry Utilities** | `src-tauri/src/provisioning/windows_info.rs` | Reused for registry reading and edition detection. Extended for safe policy write operations. |
| **Change Journal** | `src-tauri/src/provisioning/journal.rs` | Reused to record all utility restriction state changes and provide verified rollback checkpoints. |
| **Security Agent IPC Protocol** | `src-tauri/src/security_agent/protocol.rs`, `ipc.rs` | Extended with Phase 2B request discriminants and utility violation event types. |
| **Tamper & Security Event Dispatch** | `src-tauri/src/security_agent/tamper.rs`, `backend_client.rs` | Ingests utility violation events (`POWERSHELL_EXECUTION_BLOCKED`, `CMD_EXECUTION_BLOCKED`, `TASK_MANAGER_ACCESS_BLOCKED`, `SYSTEM_UTILITY_ACCESS_BLOCKED`). |
| **Settings Admin Page** | `apps/desktop/src/features/admin/pages/SettingsPage.tsx` | Reused to mount the new `SystemUtilityCard.tsx` alongside Phase 1 and Phase 2A cards. |
| **Backend Device & Event Models** | `backend/app/schemas/device.py`, `backend/app/api/v1/devices.py` | Extended with utility inventory, utility policy schemas, and restriction sync endpoints. |

---

## 3. Detailed Audit of Phase 2B Modules

| Module | Requirement | Status | Existing Foundation | Action for Phase 2B |
|---|---|---|---|---|
| **2B.1** | PowerShell Restriction | `PARTIALLY_IMPLEMENTED` | Phase 2A identifies `powershell.exe` in process inventory. | Implement discovery for Windows PowerShell and PowerShell 7 (`pwsh.exe`), ConstrainedLanguageMode / registry policies, candidate scoping, and verification. |
| **2B.2** | Command Prompt Restriction | `PARTIALLY_IMPLEMENTED` | Phase 2A identifies `cmd.exe` in process inventory. | Implement `DisableCMD` registry policy key integration (DWORD 1/2) for candidate account, alternate path discovery, and independent verification. |
| **2B.3** | Task Manager Restriction | `PARTIALLY_IMPLEMENTED` | Phase 2A identifies `taskmgr.exe` in process inventory. | Implement `DisableTaskMgr` registry policy key integration (DWORD 1) for candidate account, ensuring admin recovery is preserved. |
| **2B.4** | System Utility Inventory & Categories | `PARTIALLY_IMPLEMENTED` | Baseline rules exist in `allowlist.rs`. | Define structured categories A to F (Command/Scripting, Process Mgmt, Admin Tools, Config Tools, Navigation, Custom) with criticality metadata and non-overridable protections. |
| **2B.5** | Centralized Utility Policy Manager | `PARTIALLY_IMPLEMENTED` | Policy engine pattern exists in `application_control/policy.rs`. | Build `system_utility/policy.rs` with lifecycle (`DRAFT` → `VALIDATED` → `AWAITING_ADMIN_APPROVAL` → `APPLYING` → `VERIFYING` → `ACTIVE`), conflict checks, and rollback. |
| **2B.6** | Security Agent Integration | `READY_FOR_INTEGRATION` | IPC protocol & tamper module exist in `security_agent`. | Add utility IPC discriminants and structured event classifications (`POWERSHELL_EXECUTION_DETECTED`, `CMD_EXECUTION_BLOCKED`, etc.). |
| **2B.7** | Administrator Dashboard | `MISSING` | UI card pattern established in Phase 1 & 2A. | Build `SystemUtilityCard.tsx` with PowerShell, CMD, Task Manager, utility table, policy preview dialog, and approval gate. |
| **2B.8** | Backend & Database Sync | `PARTIALLY_IMPLEMENTED` | FastAPI router and device endpoints exist. | Add utility inventory and policy schemas in `device.py` and sync endpoints in `devices.py`. |
| **2B.9** | Exam Lifecycle Integration | `PARTIALLY_IMPLEMENTED` | Lifecycle pre-flight check in `lifecycle.rs`. | Hook utility policy verification into pre-exam readiness checks and post-exam restoration. |
| **2B.10** | Security & Recovery | `READY_FOR_INTEGRATION` | Change journal and restoration coordinator exist. | Implement automatic rollback on verification failure, backup of original registry keys, and fail-safe restoration. |

---

## 4. Windows Native Mechanisms & Safety Evaluation

### 4.1 Native Enforcement Mechanisms
1. **Windows Task Manager:**
   - Registry path: `Software\Microsoft\Windows\CurrentVersion\Policies\System`
   - Value: `DisableTaskMgr` (DWORD: 1)
   - Scope: Target candidate user SID under `HKEY_USERS\<CandidateSID>` or current user when running under candidate context.
2. **Windows Command Prompt:**
   - Registry path: `Software\Policies\Microsoft\Windows\System`
   - Value: `DisableCMD` (DWORD: 1 blocks interactive prompt, DWORD: 2 blocks prompt and batch scripts)
   - Scope: Target candidate user SID under `HKEY_USERS\<CandidateSID>` or current user.
3. **Windows PowerShell:**
   - Registry path: `Software\Policies\Microsoft\Windows\PowerShell`
   - Policy: ExecutionPolicy `Restricted` / ConstrainedLanguage mode via `__PSLockdownPolicy = 4` environment variable or AppLocker/WDAC script rules.
   - Fallback: Application-control allowlist / process supervisor marks `powershell.exe` and `pwsh.exe` as `DENIED`.
4. **Registry Editor & Administrative Consoles:**
   - Registry path: `Software\Microsoft\Windows\CurrentVersion\Policies\System`
   - Value: `DisableRegistryTools` (DWORD: 1)
   - DisallowRun / AppLocker / WDAC for `mmc.exe`, `regedit.exe`, `resmon.exe`.

### 4.2 Non-Destructive Development Boundaries
- **Default Mode:** `AUDIT_MODE` / `DETECTION_ONLY`.
- **Administrative Protection:** Policies targeting `DisableTaskMgr`, `DisableCMD`, and `DisableRegistryTools` must check user SID or candidate account context so administrators maintaining the PC are never locked out of Task Manager or command terminals.
- **Verification Guarantee:** A policy is only marked `ACTIVE` after an independent verification read verifies the effective configuration. If verification fails, the state transitions to `VERIFICATION_FAILED` and automatic rollback is triggered.

---

## 5. Technical Module Architecture for Phase 2B

```
apps/desktop/src-tauri/src/
├── system_utility/                  # New Phase 2B Rust module
│   ├── mod.rs                       # Subsystem coordinator & Tauri commands
│   ├── inventory.rs                 # Categorized system utility catalog (Categories A–F)
│   ├── powershell.rs                # PowerShell discovery, versioning & restriction
│   ├── cmd.rs                       # CMD discovery, path resolution & DisableCMD policy
│   ├── task_manager.rs              # Task Manager discovery & DisableTaskMgr policy
│   ├── registry_policy.rs           # Account-scoped Windows registry policy modifier
│   ├── policy.rs                    # Utility policy engine, lifecycle & conflict validator
│   └── detector.rs                  # Real-time utility execution monitor & event classifier
```

---

## 6. Staged Implementation Plan

- **Stage 0:** Repository Audit & Architecture Plan (`docs/phases/PHASE-2B-AUDIT.md`) — *Current Stage*
- **Stage 1:** System Utility Inventory & Categorization (Categories A to F, criticality rules)
- **Stage 2:** Windows Registry Policy Engine & Candidate Account Scoping (`registry_policy.rs`)
- **Stage 3:** PowerShell Restriction Module (`powershell.rs`)
- **Stage 4:** Command Prompt Restriction Module (`cmd.rs`)
- **Stage 5:** Task Manager Restriction Module (`task_manager.rs`)
- **Stage 6:** Centralized Utility Policy Manager & Conflict Detector (`policy.rs`, `detector.rs`)
- **Stage 7:** Security Agent IPC & Event Protocol Integration
- **Stage 8:** Administrator Dashboard UI (`SystemUtilityCard.tsx` & `SettingsPage.tsx`)
- **Stage 9:** Backend API & Database Schemas (`device.py` & `devices.py`)
- **Stage 10:** Comprehensive Verification, Regression Testing & Final Implementation Report

