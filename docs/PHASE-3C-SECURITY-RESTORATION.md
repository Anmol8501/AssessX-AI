# ASSESSX — PHASE 3C WINDOWS SECURITY RESTORATION SPECIFICATION
## Subsystem Rollback & Change Journal Execution

**Version:** 1.0.0  
**Phase:** 3C  

---

## 1. Restoration Order of Operations

To prevent race conditions or temporary privilege lockouts, native security restoration must execute in the following exact sequence:

1. **Verify Exit Authorization:**
   Validate HMAC-SHA256 signature and timestamp of `ExitAuthorizationToken`. Reject expired (>15 min) or invalid signatures.
2. **Release Lockdown Windows & Keyboard Hooks:**
   - Unhook Windows low-level keyboard hook (`UnhookWindowsHookEx(g_hook)`).
   - Release full-screen kiosk window guard.
3. **Rollback Navigation Policies:**
   - Restore Explorer policies for Start Menu, Task View, and shortcut interceptors using `navigation_control::revert_navigation_policy()`.
4. **Rollback System Utility Policies:**
   - Revert registry keys for `DisableTaskMgr`, `DisableCMD`, and PowerShell execution policies using `system_utility::revert_system_utility_policy()`.
   - Restore to pristine pre-exam state from Change Journal (`journal.rs`).
5. **Restore Application Allowlisting Baseline:**
   - Revert AppLocker / Software Restriction rules using `application_control::application_control_restore_baseline()`.
6. **Rollback Peripheral Restrictions:**
   - Re-enable USB removable storage policies if blocked using `peripheral_control::rollback_peripheral_policy()`.
7. **Clean Exit Declaration:**
   - Call `CrashRecoveryController.mark_clean_exit()`, resetting restart counts and crash flags.
8. **Purge Ephemeral Local Answer Cache:**
   - Delete `%APPDATA%\AssessX\sessions\<attempt_id>\answers_v1.enc`.

