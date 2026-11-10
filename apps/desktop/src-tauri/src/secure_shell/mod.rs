//! AssessX Secure Shell & Examination Startup (Phase 1B).
//!
//! Submodules:
//! - `kiosk_capability`: Windows Assigned Access & Shell Launcher capability detector (Stage 1).
//! - `kiosk_manager`: Kiosk configuration preview, administrator approval, apply & verify (Stage 2).
//! - `startup`: Automatic examination startup manager & validator (Stage 3).
//! - `display`: Fullscreen & multi-monitor display manager (Stage 4).
//! - `lifecycle`: Examination session lifecycle state machine & startup validation engine (Stage 5).
//! - `crash_recovery`: Application crash detection, bounded restart policy & session preservation (Stage 6).
//! - `restoration`: Administrator-authorized normal-mode restoration engine (Stage 7).
//! - `health`: Shell heartbeat & health monitor.

pub mod crash_recovery;
pub mod display;
pub mod health;
pub mod kiosk_capability;
pub mod kiosk_manager;
pub mod lifecycle;
pub mod restoration;
pub mod startup;

use tauri::{Runtime, State, WebviewWindow};

pub use crash_recovery::{check_crash_recovery, CrashRecoveryController, CrashRecoveryReport};
pub use display::{enforce_secure_shell_window, get_display_topology, release_secure_shell_window, DisplayTopologyReport};
pub use health::{ShellHealthMonitor, ShellHealthReport};
pub use kiosk_capability::{detect_kiosk_capabilities, KioskCapabilityReport};
pub use kiosk_manager::{apply_kiosk_configuration, preview_kiosk_configuration, KioskConfigPreview, KioskOperationResult};
pub use lifecycle::{run_startup_validation, ExaminationStartupValidationReport, LifecycleManager, SessionLifecycleState};
pub use restoration::{execute_normal_mode_restoration, preview_restoration, RestorationOperationResult, RestorationPreview};
pub use startup::{inspect_startup_configuration, register_automatic_startup, StartupConfigurationReport, StartupOperationResult};

pub struct SecureShellState {
    pub lifecycle: LifecycleManager,
    pub crash_recovery: CrashRecoveryController,
    pub health: ShellHealthMonitor,
}

impl Default for SecureShellState {
    fn default() -> Self {
        Self {
            lifecycle: LifecycleManager::default(),
            crash_recovery: CrashRecoveryController::default(),
            health: ShellHealthMonitor::default(),
        }
    }
}

#[tauri::command]
pub fn secure_shell_get_kiosk_capabilities() -> KioskCapabilityReport {
    detect_kiosk_capabilities()
}

#[tauri::command]
pub fn secure_shell_preview_kiosk_config(
    target_account: String,
    mechanism: String,
    executable_path: String,
) -> KioskConfigPreview {
    preview_kiosk_configuration(&target_account, &mechanism, &executable_path)
}

#[tauri::command]
pub fn secure_shell_apply_kiosk_config(
    target_account: String,
    mechanism: String,
    executable_path: String,
    admin_approved: bool,
) -> KioskOperationResult {
    apply_kiosk_configuration(&target_account, &mechanism, &executable_path, admin_approved)
}

#[tauri::command]
pub fn secure_shell_inspect_startup(target_account: String) -> StartupConfigurationReport {
    inspect_startup_configuration(&target_account)
}

#[tauri::command]
pub fn secure_shell_register_startup(target_account: String, enable: bool) -> StartupOperationResult {
    register_automatic_startup(&target_account, enable)
}

#[tauri::command]
pub fn secure_shell_get_display_topology<R: Runtime>(window: WebviewWindow<R>) -> DisplayTopologyReport {
    get_display_topology(&window)
}

#[tauri::command]
pub fn secure_shell_enforce_fullscreen<R: Runtime>(window: WebviewWindow<R>) -> bool {
    enforce_secure_shell_window(&window)
}

#[tauri::command]
pub fn secure_shell_release_fullscreen<R: Runtime>(window: WebviewWindow<R>) -> bool {
    release_secure_shell_window(&window)
}

#[tauri::command]
pub fn secure_shell_get_lifecycle_state(state: State<'_, SecureShellState>) -> String {
    state.lifecycle.get_state().as_str().to_string()
}

#[tauri::command]
pub fn secure_shell_run_startup_validation(candidate_account_name: String) -> ExaminationStartupValidationReport {
    run_startup_validation(&candidate_account_name)
}

#[tauri::command]
pub fn secure_shell_check_crash_recovery(state: State<'_, SecureShellState>) -> CrashRecoveryReport {
    check_crash_recovery(&state.crash_recovery)
}

#[tauri::command]
pub fn secure_shell_mark_clean_exit(state: State<'_, SecureShellState>) {
    state.crash_recovery.mark_clean_exit();
}

#[tauri::command]
pub fn secure_shell_preview_restoration(target_account: String) -> RestorationPreview {
    preview_restoration(&target_account)
}

#[tauri::command]
pub fn secure_shell_execute_restoration(
    target_account: String,
    admin_confirmed: bool,
) -> RestorationOperationResult {
    execute_normal_mode_restoration(&target_account, admin_confirmed)
}

#[tauri::command]
pub fn secure_shell_get_health(state: State<'_, SecureShellState>) -> ShellHealthReport {
    let lifecycle_state = state.lifecycle.get_state();
    state.health.inspect_health(lifecycle_state)
}

#[tauri::command]
pub fn secure_shell_heartbeat(state: State<'_, SecureShellState>) {
    state.health.record_heartbeat();
    state.crash_recovery.record_heartbeat();
}
