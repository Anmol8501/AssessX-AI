//! Windows Environment & Device Provisioning (Phase 1A).
//!
//! Submodules:
//! - `windows_info`: Windows edition, version, build number, UBR, and architecture compatibility (Module 1).
//! - `hardware`: CPU, RAM, storage, and display topology inspection (Module 2).
//! - `security`: Secure Boot, TPM, Windows Firewall, and Defender protection status (Module 3).
//! - `privileges`: Process token elevation and administrator privilege verification (Module 4).
//! - `accounts`: Candidate account existence, privilege separation, and provisioning plan generation (Module 5).
//! - `device_id`: Persistent cryptographic AssessX Device Identity generation and management (Module 6).
//! - `validation`: Local installation integrity, binary existence, and data write access check (Module 8).
//! - `diagnostics`: Scrubbed, comprehensive installation diagnostics report (Module 9).
//! - `journal`: Safe rollback planning and change journal audit logging (Module 10).

pub mod accounts;
pub mod device_id;
pub mod diagnostics;
pub mod hardware;
pub mod journal;
pub mod policy_snapshot;
pub mod privileges;
pub mod security;
pub mod validation;
pub mod windows_info;

use serde::Serialize;
pub use accounts::{CandidateAccountStatus, ProvisioningPlan};
pub use device_id::DeviceIdentity;
pub use diagnostics::InstallationDiagnosticReport;
pub use hardware::HardwareReadinessReport;
pub use journal::{ChangeJournal, JournalEntry};
pub use privileges::PrivilegeStatusReport;
pub use security::WindowsSecurityReport;
pub use validation::ConfigurationValidationReport;
pub use windows_info::WindowsCompatibilityReport;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullDeviceReadinessScan {
    pub compatibility: WindowsCompatibilityReport,
    pub hardware: HardwareReadinessReport,
    pub security: WindowsSecurityReport,
    pub privileges: PrivilegeStatusReport,
    pub identity: DeviceIdentity,
    pub overall_readiness: &'static str, // "READY" | "READY_WITH_WARNINGS" | "NOT_READY"
    pub timestamp: String,
}

#[tauri::command]
pub fn provisioning_get_compatibility() -> WindowsCompatibilityReport {
    windows_info::detect_windows_compatibility()
}

#[tauri::command]
pub fn provisioning_get_hardware() -> HardwareReadinessReport {
    hardware::scan_hardware_readiness()
}

#[tauri::command]
pub fn provisioning_get_security() -> WindowsSecurityReport {
    security::scan_security_readiness()
}

#[tauri::command]
pub fn provisioning_get_privileges() -> PrivilegeStatusReport {
    privileges::check_privileges()
}

#[tauri::command]
pub fn provisioning_get_device_identity() -> DeviceIdentity {
    device_id::get_or_create_device_identity()
}

#[tauri::command]
pub fn provisioning_re_enroll_device_identity() -> DeviceIdentity {
    device_id::re_enroll_device_identity()
}

#[tauri::command]
pub fn provisioning_inspect_account(account_name: String) -> CandidateAccountStatus {
    accounts::inspect_candidate_account(&account_name)
}

#[tauri::command]
pub fn provisioning_get_plan(account_name: String, app_path: String) -> ProvisioningPlan {
    accounts::generate_provisioning_plan(&account_name, &app_path)
}

#[tauri::command]
pub fn provisioning_validate_configuration() -> ConfigurationValidationReport {
    validation::validate_configuration()
}

#[tauri::command]
pub fn provisioning_get_diagnostic_report(candidate_account_name: String) -> InstallationDiagnosticReport {
    diagnostics::generate_diagnostic_report(&candidate_account_name)
}

#[tauri::command]
pub fn provisioning_get_journal() -> ChangeJournal {
    journal::load_journal()
}

#[tauri::command]
pub fn provisioning_record_plan(
    operation: String,
    target_resource: String,
    previous_state: String,
    new_state: String,
    rollback_command: Option<String>,
) -> JournalEntry {
    journal::record_planned_change(&operation, &target_resource, &previous_state, &new_state, rollback_command)
}

#[tauri::command]
pub fn provisioning_run_full_scan() -> FullDeviceReadinessScan {
    let compatibility = windows_info::detect_windows_compatibility();
    let hardware = hardware::scan_hardware_readiness();
    let security = security::scan_security_readiness();
    let privileges = privileges::check_privileges();
    let identity = device_id::get_or_create_device_identity();

    let overall_readiness = if compatibility.compatibility == "UNSUPPORTED"
        || hardware.overall_status == "FAIL"
        || security.overall_status == "FAIL"
    {
        "NOT_READY"
    } else if compatibility.compatibility == "WARNING"
        || hardware.overall_status == "WARNING"
        || security.overall_status == "WARNING"
    {
        "READY_WITH_WARNINGS"
    } else {
        "READY"
    };

    FullDeviceReadinessScan {
        compatibility,
        hardware,
        security,
        privileges,
        identity,
        overall_readiness,
        timestamp: chrono_or_fallback_timestamp(),
    }
}

pub fn chrono_or_fallback_timestamp() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", duration.as_secs(), duration.subsec_millis())
}
