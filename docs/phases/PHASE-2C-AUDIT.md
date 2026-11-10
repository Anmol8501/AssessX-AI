# STAGE 0 REPOSITORY AUDIT & ARCHITECTURE PLAN
## AssessX — Phase 2C: Keyboard Shortcut Restrictions, Windows Navigation Control & System Access Prevention

**Audit Date:** November 8, 2026  
**Status:** Audit Completed — Ready for Staged Implementation  

---

## 1. Executive Summary

AssessX aims to transform Windows workstations into secure, controlled examination environments. 
- In **Phase 1 (1A, 1B, 1C)**, AssessX established hardware provisioning, cryptographic device identity, secure kiosk/shell foundations, and the Native Security Agent daemon with Named Pipe IPC.
- In **Phase 2A**, the platform established **Application Allowlisting & Execution Control** with cryptographic process identity (SHA-256) and capability detection (WDAC / AppLocker / process supervision).
- In **Phase 2B**, the platform implemented **System Utility & Shell Restrictions** targeting Windows PowerShell, Command Prompt, Task Manager, and administrative consoles via native Windows registry policies (`DisableCMD`, `DisableTaskMgr`, `DisableRegistryTools`).

**Phase 2C (Keyboard Shortcut Restrictions, Windows Navigation Control & System Access Prevention)** extends this architecture to prevent candidates from using keyboard shortcuts, application-switching mechanisms, and Windows navigation interfaces (Start Menu, Taskbar, Search, Run dialog, File Explorer, Virtual Desktops, and Task View) to escape the examination window or access unauthorized resources.

---

## 2. Existing Repository State & Reusability Matrix

| Existing Component | Location | Phase 2C Reuse Role |
|---|---|---|
| **Keyboard Hook Foundation** | `src-tauri/src/lockdown/keyboard_hook.rs` | Uses `SetWindowsHookExW(WH_KEYBOARD_LL, ...)`. Reused and enhanced for low-level userland shortcut interception without blocking OS recovery or administrator maintenance. |
| **Shortcut Classifier** | `src-tauri/src/lockdown/shortcuts.rs` | Classifies virtual-key codes (`Alt+Tab`, `Win`, `Alt+F4`, `Ctrl+Shift+Esc`, `PrintScreen`). Extended into an extensible, structured inventory supporting Categories A through G. |
| **Focus & Reclaim Manager** | `src-tauri/src/lockdown/focus.rs` | Classifies window departures (`LeftTo::App`, `LeftTo::Desktop`, `LeftTo::System`) and provides bounded foreground reclaims. Reused to coordinate window monitoring with Security Agent event dispatch. |
| **Windows Registry Policy Engine** | `src-tauri/src/system_utility/registry_policy.rs` | Reused to apply and verify Windows Explorer native policy keys (`NoWinKeys`, `NoRun`, `NoFind`, `NoTrayContextMenu`, `NoSetTaskbar`, `NoDesktop`) scoped to candidate user hive. |
| **Change Journal** | `src-tauri/src/provisioning/journal.rs` | Reused to log all planned registry and navigation policy modifications before application for verified rollback. |
| **Security Agent IPC Protocol** | `src-tauri/src/security_agent/protocol.rs`, `ipc.rs` | Extended with Phase 2C request discriminants and shortcut/navigation violation events. |
| **Tamper & Backend Client** | `src-tauri/src/security_agent/tamper.rs`, `backend_client.rs` | Ingests navigation violation events (`KEYBOARD_SHORTCUT_DETECTED`, `APPLICATION_SWITCH_ATTEMPT`, `WINDOWS_SHELL_NAVIGATION_DETECTED`, `FOCUS_LOSS_DETECTED`). |
| **Settings Admin Page** | `apps/desktop/src/features/admin/pages/SettingsPage.tsx` | Reused to mount the new `NavigationControlCard.tsx`. |
| **Backend Device & Event Models** | `backend/app/schemas/device.py`, `backend/app/api/v1/devices.py` | Extended with shortcut inventory, navigation policy schemas, and restriction sync endpoints. |

---

## 3. Detailed Audit of Phase 2C Requirements

| Requirement | Status | Existing Foundation | Action for Phase 2C |
|---|---|---|---|
| **2C.1 Shortcut Inventory** | `PARTIALLY_IMPLEMENTED` | Basic virtual keys in `lockdown/shortcuts.rs` | Build configurable catalog (Categories A–G: App Switching, Shell/Desktop, Task/Session, Browser/App, Clipboard, Print/Capture, Accessibility) with risk levels and enforcement classifications. |
| **2C.2 Shortcut Policy Engine** | `PARTIALLY_IMPLEMENTED` | Phase 2A/2B policy engine pattern | Implement versioned lifecycle (`DRAFT` → `VALIDATED` → `AWAITING_ADMIN_APPROVAL` → `APPLYING` → `VERIFYING` → `ACTIVE`), conflict checks, and rollback. |
| **2C.3 Windows Navigation Restrictions** | `PARTIALLY_IMPLEMENTED` | Phase 1B kiosk / Phase 2B registry policy | Enforce native Windows Explorer registry policies (`NoWinKeys`, `NoRun`, `NoFind`, `NoTrayContextMenu`, `NoDesktop`) scoped to candidate account. |
| **2C.4 Window & Focus Monitoring** | `PARTIALLY_IMPLEMENTED` | `lockdown/focus.rs` | Extend focus tracking with structured event dispatch to Security Agent, minimization detection, and bounded recovery without foreground loops. |
| **2C.5 Native Windows Enforcement** | `PARTIALLY_IMPLEMENTED` | Windows Registry and low-level hook | Distinguish frontend vs native enforcement. Honestly document Windows secure attention sequence limitations (`Ctrl+Alt+Del`, `Win+L`). |
| **2C.6 Security Agent Integration** | `READY_FOR_INTEGRATION` | IPC protocol & tamper module | Add navigation IPC discriminants and structured event classifications (`APPLICATION_SWITCH_ATTEMPT`, `FOCUS_LOSS_DETECTED`, etc.). |
| **2C.7 Accessibility Management** | `MISSING` | None | Implement accessibility exception manager (Sticky Keys, Filter Keys, High Contrast, Screen Readers) with conflict warnings. |
| **2C.8 Administrator Dashboard** | `MISSING` | UI card pattern established in Phase 1 & 2A/B | Build `NavigationControlCard.tsx` with Shortcuts, Navigation, Accessibility Accommodations, Policy Preview, and Security Events tabs. |
| **2C.9 Backend & Database Sync** | `PARTIALLY_IMPLEMENTED` | Device endpoints in `devices.py` | Add shortcut and navigation policy schemas in `device.py` and sync endpoints in `devices.py`. |
| **2C.10 Exam Lifecycle Integration** | `PARTIALLY_IMPLEMENTED` | Lifecycle pre-flight check in `lifecycle.rs` | Hook shortcut/navigation policy verification into pre-exam readiness checks and post-exam restoration. |
| **2C.11 Security, Recovery & Safety** | `READY_FOR_INTEGRATION` | Change journal and restoration coordinator | Implement fail-safe baseline restoration, non-destructive defaults (`AUDIT_MODE`), and administrator recovery protection. |

---

## 4. Native Windows Mechanisms & Technical Architecture

### 4.1 Native Enforcement Mechanisms
1. **Windows Explorer Hotkeys (`NoWinKeys`):**
   - Registry path: `Software\Microsoft\Windows\CurrentVersion\Policies\Explorer`
   - Value: `NoWinKeys` (DWORD: 1)
   - Scope: Candidate user SID under `HKEY_USERS\<CandidateSID>` or current user session.
   - Effect: Natively suppresses Windows hotkeys (`Win+D`, `Win+E`, `Win+R`, `Win+S`, `Win+A`, `Win+I`, etc.) at the Windows Explorer shell level.
2. **Run Dialog Suppression (`NoRun`):**
   - Registry path: `Software\Microsoft\Windows\CurrentVersion\Policies\Explorer`
   - Value: `NoRun` (DWORD: 1)
   - Effect: Removes Run command from Start menu, disables `Win+R` launch route.
3. **Windows Search Suppression (`NoFind`):**
   - Registry path: `Software\Microsoft\Windows\CurrentVersion\Policies\Explorer`
   - Value: `NoFind` (DWORD: 1)
   - Effect: Suppresses shell search interfaces.
4. **Taskbar Context Menu & Settings (`NoTrayContextMenu`, `NoSetTaskbar`):**
   - Registry path: `Software\Microsoft\Windows\CurrentVersion\Policies\Explorer`
   - Values: `NoTrayContextMenu` (DWORD: 1), `NoSetTaskbar` (DWORD: 1)
   - Effect: Blocks right-click context menus on taskbar, system tray, and start button.
5. **Desktop Surface Access (`NoDesktop`):**
   - Registry path: `Software\Microsoft\Windows\CurrentVersion\Policies\Explorer`
   - Value: `NoDesktop` (DWORD: 1)
   - Effect: Hides desktop icons and prevents context menu interaction on the bare desktop.
6. **Low-Level Keyboard Hook (`WH_KEYBOARD_LL`):**
   - Intercepts userland key combinations (`Alt+Tab`, `Alt+Shift+Tab`, `Alt+Esc`, `Alt+F4`, `Ctrl+Shift+Esc`, `Print Screen`) during an active exam session while AssessX is in the foreground.
   - Emits structured shortcut classification without keylogging.

### 4.2 Secure-Attention Sequence Honest Limitations
- **Windows Architecture Boundary:** `Ctrl+Alt+Del` (Secure Attention Sequence) and `Win+L` (Workstation Lock) are handled at the kernel/Winlogon boundary and cannot be intercepted by any user-mode application or hook.
- **AssessX Handling:** Documented explicitly in the dashboard and policy preview. Where Assigned Access or single-app kiosk is active (Phase 1B), the Windows lock screen and user switching are disabled by Windows itself. When running in supervised mode, `Ctrl+Alt+Del` cannot be swallowed, but any resulting focus departure is immediately logged and tracked.

---

## 5. Module Structure for Phase 2C

```
apps/desktop/src-tauri/src/
├── navigation_control/              # New Phase 2C Rust module
│   ├── mod.rs                       # Subsystem coordinator & Tauri commands
│   ├── inventory.rs                 # Structured shortcut inventory (Categories A–G)
│   ├── policy.rs                    # Centralized shortcut & navigation policy engine
│   ├── native_enforcement.rs        # Explorer registry policy modifier (NoWinKeys, NoRun, etc.)
│   ├── navigation.rs                # Windows navigation interface manager (Start, Taskbar, Desktops)
│   ├── focus_supervisor.rs          # Window focus monitoring & bounded recovery
│   ├── accessibility.rs             # Accessibility accommodation & conflict validator
│   └── detector.rs                  # Real-time event classifier & Security Agent dispatcher
```

---

## 6. Staged Implementation Plan

- **Stage 0:** Repository Audit & Architecture Plan (`docs/phases/PHASE-2C-AUDIT.md`) — *Current Stage*
- **Stage 1:** Shortcut Inventory (Categories A to G, risk levels, enforcement types)
- **Stage 2:** Shortcut & Navigation Policy Engine (`policy.rs`)
- **Stage 3:** Native Windows Keyboard Restrictions (`native_enforcement.rs`)
- **Stage 4:** Windows Navigation Restrictions (`navigation.rs`)
- **Stage 5:** Window & Focus Supervisor (`focus_supervisor.rs`)
- **Stage 6:** Accessibility Accommodation Management (`accessibility.rs`)
- **Stage 7:** Security Agent IPC Integration & Event Dispatcher (`detector.rs`)
- **Stage 8:** Administrator Dashboard UI (`NavigationControlCard.tsx`)
- **Stage 9:** Backend API & Database Schemas (`device.py` & `devices.py`)
- **Stage 10:** Comprehensive Verification, Regression Testing & Final Implementation Report

