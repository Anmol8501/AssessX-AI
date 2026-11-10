# STAGE 0 REPOSITORY AUDIT & ARCHITECTURE PLAN
## AssessX — Phase 2A: Application Allowlisting & Execution Control
**Audit Date:** November 8, 2026  
**Status:** Audit Completed — Ready for Staged Implementation  

---

## 1. Executive Summary

Phase 2 of the AssessX Windows Secure Environment Foundation builds directly on top of Phase 1:
- **Phase 1A (Windows Environment & Device Provisioning):** Hardware detection, OS compatibility, cryptographic device identity (`device_identity.json`), candidate account provisioning foundation (`AssessXCandidate`), and change journal.
- **Phase 1B (Secure Shell & Examination Startup):** Kiosk capability detection (Assigned Access / Shell Launcher), startup registration, display topology, 12-state session lifecycle, crash recovery, and restoration.
- **Phase 1C (Native Security Agent & System Integration):** Windows background service and in-process daemon, Windows Named Pipe IPC (`\\.\pipe\AssessXSecurityAgent`), watchdog monitoring, compliance policy v1.0, SHA-256 component integrity, tamper detection, and offline event queueing for FastAPI backend reporting.

**Phase 2A (Application Allowlisting & Execution Control)** introduces operating-system-level and supervisory application execution control. It establishes:
1. Windows Application Inventory & Identity Normalization (`ApplicationIdentity` with SHA-256, publisher, signature status, and path).
2. Administrator-Controlled Allowlist Management (core AssessX, essential Windows system, approved exam apps, denied apps).
3. Windows Enforcement Capability Detection (App Control for Business / WDAC, AppLocker, process supervision).
4. Application Control Policy Engine with an explicit lifecycle (`DRAFT` → `VALIDATED` → `AWAITING_ADMIN_APPROVAL` → `APPLYING` → `VERIFYING` → `ACTIVE`).
5. Unauthorized Application Detection and Event Classification.
6. Security Agent Integration via Named Pipe IPC.
7. Admin Dashboard UI (`ApplicationControlCard.tsx`).
8. Backend API & Event Ingestion (`/api/v1/devices/{device_id}/applications/...`).
9. Safe Rollback and Recovery Coordinator.

---

## 2. Existing Repository State & Reusability Matrix

| Existing Component | Location | Phase 2A Reuse Role |
|---|---|---|
| **Process Enumeration Foundation** | `src-tauri/src/readiness/mod.rs` | Uses `QueryFullProcessImageNameW` and `EnumWindows` with `PROCESS_QUERY_LIMITED_INFORMATION`. Extended to extract full binary identity without requiring elevated `PROCESS_VM_READ`. |
| **Protected Applications List** | `src-tauri/src/readiness/policy.rs` | Hard-coded protected list (`AssessX`, Windows shell, security tools) reused to construct the mandatory baseline that must never be blocked. |
| **Registry & OS Detection** | `src-tauri/src/provisioning/windows_info.rs` | Reused for Windows edition check, build number, and registry reading (`read_reg_dword`, `read_reg_string`). |
| **Security Agent IPC** | `src-tauri/src/security_agent/ipc.rs` & `protocol.rs` | Reused directly. New IPC message discriminants added to `protocol.rs` (`GET_APPLICATION_INVENTORY`, `GET_APPLICATION_POLICY`, `APPLY_APPLICATION_POLICY`). |
| **Offline Event Queue** | `src-tauri/src/security_agent/backend_client.rs` | Ingests application violation events (`APPLICATION_VIOLATION_DETECTED`, `UNAUTHORIZED_EXECUTION_ATTEMPT`) for reliable backend reporting. |
| **Diagnostic Logger** | `src-tauri/src/security_agent/logger.rs` | Logs all application policy evaluation and enforcement decisions with sensitive-data scrubbing. |
| **Change Journal** | `src-tauri/src/provisioning/journal.rs` | Records policy application steps and rollback checkpoints. |
| **Pre-Flight Validation Engine** | `src-tauri/src/secure_shell/lifecycle.rs` | Startup check #6 hooks into application control policy status. |
| **Backend SecurityEvent Model** | `backend/app/models/security_event.py` | Stores application violations in the database table without schema changes. |
| **Backend Device Service** | `backend/app/services/device.py` | Associates application inventory and allowlist policies with registered workstations. |

---

## 3. Detailed Audit of Phase 2A Modules

| Module | Status | Existing Foundation | Action for Phase 2A |
|---|---|---|---|
| **2A.1 Application Inventory** | PARTIALLY_IMPLEMENTED | Basic window enumeration in `readiness/mod.rs` | Implement full `ApplicationIdentity` extractor (SHA-256 hash, publisher/digital signature, file version, running processes). |
| **2A.2 Allowlist Manager** | MISSING | Hardcoded prohibited list in `readiness/policy.rs` | Implement dynamic, categorized allowlist engine (Core, Windows System, Approved Support, Denied). |
| **2A.3 Enforcement Capability** | MISSING | Kiosk capabilities only in `secure_shell/kiosk_capability.rs` | Implement WDAC / AppLocker / Software Restriction capability detector. |
| **2A.4 Policy Engine** | MISSING | None | Implement versioned policy lifecycle with validation, preview, approval gate, and verification. |
| **2A.5 Unauthorized Detection** | PARTIALLY_IMPLEMENTED | Pre-exam window check only | Implement continuous background classification (`APPROVED`, `UNAPPROVED`, `DENIED`, `UNKNOWN`). |
| **2A.6 Security Agent Integration** | READY_FOR_INTEGRATION | Phase 1C `security_agent` module | Add application control subsystem and IPC request handlers to existing service. |
| **2A.7 Admin Management UI** | MISSING | None | Build `ApplicationControlCard.tsx` with Inventory, Allowlist, Capabilities, Policy Preview, and Approval. |
| **2A.8 Backend & Database** | PARTIALLY_IMPLEMENTED | Device and SecurityEvent models exist | Add FastAPI endpoints in `backend/app/api/v1/devices.py` (or router) for inventory and allowlist management. |
| **2A.9 Safety & Recovery** | READY_FOR_INTEGRATION | Change journal and recovery coordinator exist | Add application policy rollback mechanism and ensure audit mode is default for dev safety. |

---

## 4. Technical Architecture for Phase 2A

```
apps/desktop/src-tauri/src/
├── application_control/             # New Phase 2A Rust module
│   ├── mod.rs                       # Entry point, state container, and Tauri command bindings
│   ├── identity.rs                  # ApplicationIdentity extraction, SHA-256, Win32 signature check
│   ├── inventory.rs                 # Running process and system application enumerator
│   ├── allowlist.rs                 # Dynamic allowlist repository & category matcher
│   ├── capability.rs                # Windows enforcement capability detector (WDAC / AppLocker)
│   ├── policy.rs                    # Application-control policy lifecycle state machine
│   ├── detector.rs                  # Process monitor & unauthorized application classifier
│   └── recovery.rs                  # Policy rollback and baseline restorer
```

### Protocol & IPC Integration
The Phase 1C Security Agent (`security_agent/protocol.rs`) will be extended with:
- `AgentRequest::GetApplicationInventory`
- `AgentRequest::GetApplicationAllowlist`
- `AgentRequest::UpdateApplicationAllowlist(AllowlistPayload)`
- `AgentRequest::GetEnforcementCapabilities`
- `AgentRequest::ApplyApplicationPolicy(PolicyApplyPayload)`
- `AgentRequest::VerifyApplicationPolicy`

---

## 5. Safety & Environment Boundaries

1. **Development Safety**:
   - The developer machine must never be locked down or have arbitrary processes killed.
   - Default policy mode is strictly `AUDIT_MODE`.
   - `ENFORCEMENT_MODE` requires explicit administrator approval and a verified rollback journal.
2. **System Preservation**:
   - Critical system executables (`explorer.exe`, `dwm.exe`, `ctfmon.exe`, `TextInputHost.exe`, `conhost.exe`, antivirus, graphics drivers) are protected by a hard-coded bypass list that cannot be overridden by user configuration.
3. **No Uncommitted Git Changes Lost**:
   - All changes remain local and unstaged. No git commits or pushes will be made.

---

## 6. Phased Implementation Roadmap

- **Stage 1**: Application Inventory & Identity Normalization (`identity.rs`, `inventory.rs`).
- **Stage 2**: Allowlist Management & Categories (`allowlist.rs`).
- **Stage 3**: Windows Enforcement Capability Detection (`capability.rs`).
- **Stage 4**: Application Control Policy Engine (`policy.rs`, `recovery.rs`).
- **Stage 5**: Unauthorized Application Detection & Classifier (`detector.rs`).
- **Stage 6**: Security Agent Integration & IPC Protocol Extension (`protocol.rs`, `ipc.rs`).
- **Stage 7**: Backend API & Schema Integration (`backend/app/api/v1/devices.py`).
- **Stage 8**: Admin Dashboard UI (`ApplicationControlCard.tsx`, TypeScript types, bridge).
- **Stage 9**: Testing, Verification & Final Report (Rust tests, Vitest tests, typecheck, linting).

