# ASSESSX — PHASE 2D AUDIT & IMPLEMENTATION SPECIFICATION
## USB Storage Control, Display and Peripheral Restrictions & Remote Access Prevention

**Project:** AssessX  
**Phase:** 2D of 4 (Final subphase of Phase 2: Advanced Windows Security Enforcement)  
**Status:** AUDITED & PLANNED  
**Target Platform:** Windows 10 / 11 (Tauri + React + Rust + FastAPI)

---

## 1. Scope & Objective

Phase 2D completes Phase 2 by establishing robust operating-system-level controls and hardware inspection across three critical attack surfaces during an active examination:
1. **USB Storage Access (P2.5):** Detecting and restricting USB mass storage devices, flash drives, and external disks while strictly preserving HID input devices (keyboards, mice, accessibility controllers).
2. **Display & Peripheral Topology (P2.6):** Enforcing single-monitor policies or approved multi-display topologies, detecting virtual display adapters, and monitoring peripheral connection health (webcam, microphone, audio devices).
3. **Remote-Access Detection & Restrictions (P2.7):** Detecting active Windows Terminal Services/RDP sessions (`SM_REMOTESESSION`), third-party remote assistance and screen-sharing tools (TeamViewer, AnyDesk, RustDesk, UltraViewer, Chrome Remote Desktop), and virtual desktop sharing hooks.
4. **Central Policy Lifecycle & Rollback (P2.8 & P2.11):** Administrator approval-gated lifecycle state machine (`Draft` → `Validated` → `AwaitingAdminApproval` → `Applying` → `Verifying` → `Active` → `RollbackNeeded` → `RolledBack`).
5. **Security Agent Named Pipe IPC Integration (P2.9 & P2.10):** IPC commands and tamper event dispatching for device insertion, topology changes, and unauthorized remote sessions.
6. **Administrator Dashboard UI & Backend Schemas:** Full administrative monitoring in React frontend and FastAPI backend endpoints.

---

## 2. Technical Mechanisms & Safety Safeguards

### 2.1 USB Storage Control
- **Detection:** `GetLogicalDrives()` combined with `GetDriveTypeW()` (`DRIVE_REMOVABLE = 2`, `DRIVE_FIXED = 3`, `DRIVE_CDROM = 5`).
- **Registry Policies:**
  - `HKLM\SYSTEM\CurrentControlSet\Services\USBSTOR` `Start` DWORD (3 = Manual/Allowed, 4 = Disabled).
  - `HKCU\Software\Policies\Microsoft\Windows\RemovableStorageDevices` `Deny_All` DWORD (1 = Block all removable storage access).
- **Safety Rule:** Keyboard and mouse HID devices use `HIDClass` / `USB\Class_03` and are strictly excluded from storage restrictions.

### 2.2 Display Topology & Peripheral Monitoring
- **Detection:** `GetSystemMetrics(SM_CMONITORS)` and `EnumDisplayMonitors`.
- **Display Topology:** Tracks monitor count, primary monitor resolution, virtual screens (`SM_CXVIRTUALSCREEN`, `SM_CYVIRTUALSCREEN`), and virtual display drivers (e.g. spacedesk, Duet, IddSampleDriver).
- **Peripheral Health:** Queries system audio, video capture devices, and reports disconnects without falsely penalizing transient hardware glitches.

### 2.3 Remote-Access Detection
- **Windows APIs:** `GetSystemMetrics(SM_REMOTESESSION)` returns nonzero if the current process is running in a Remote Desktop / Terminal Services session.
- **Process & Service Catalog:** Inspects running processes for known remote-control agents (`anydesk.exe`, `teamviewer.exe`, `rustdesk.exe`, `ultraviewer.exe`, `remoting_host.exe`, `vncserver.exe`).
- **Network Ports & Registry:** Evaluates `fDenyTSConnections` under `HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server`.

---

## 3. Implementation Plan
- `apps/desktop/src-tauri/src/peripheral_control/`
  - `storage.rs`: Removable storage detection and policy enforcement.
  - `display.rs`: Display topology and virtual display detection.
  - `remote_access.rs`: Remote session and remote tool detection.
  - `policy.rs`: Unified PeripheralPolicyConfig lifecycle state machine.
  - `detector.rs`: Integrated violation scanner and security event emitter.
  - `mod.rs`: Tauri command bindings.
- `apps/desktop/src-tauri/src/security_agent/`
  - `protocol.rs`: IPC request discriminants & response models.
  - `ipc.rs`: Named pipe request handler dispatch.
- `apps/desktop/src/features/admin/peripheral-control/`
  - `types.ts`, `peripheralControl.ts`, `PeripheralControlCard.tsx`, unit tests.
- `backend/app/schemas/device.py` & `backend/app/api/v1/devices.py`
  - Peripheral report schemas and policy endpoints.

