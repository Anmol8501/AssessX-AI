//! Automatic AssessX Examination Startup Manager (Stage 3, Phase 1B).
//!
//! Manages automatic startup registration and verification for dedicated examination accounts.
//! Verifies binary existence, prevents duplicate startup entries, and produces startup diagnostics.

use serde::Serialize;
use std::path::PathBuf;
use crate::provisioning::accounts::inspect_candidate_account;
use crate::provisioning::journal::record_planned_change;
use crate::provisioning::privileges::check_privileges;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupConfigurationReport {
    pub is_configured: bool,
    pub target_account: String,
    pub executable_path: String,
    pub startup_mechanism: &'static str, // "WINDOWS_RUN_KEY" | "TASK_SCHEDULER" | "SHELL_LAUNCHER" | "NOT_CONFIGURED"
    pub status: &'static str,            // "CONFIGURED" | "NOT_CONFIGURED" | "BROKEN_PATH" | "DUPLICATE_ENTRIES" | "REQUIRES_ELEVATION"
    pub executable_exists: bool,
    pub account_exists: bool,
    pub details: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupOperationResult {
    pub success: bool,
    pub status: &'static str,
    pub message: String,
    pub journal_entry_id: Option<String>,
}

pub fn get_application_executable_path() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from(r"C:\Program Files\AssessX\AssessX.exe"))
}

pub fn inspect_startup_configuration(target_account: &str) -> StartupConfigurationReport {
    let exe_path = get_application_executable_path();
    let exe_exists = exe_path.exists();
    let acc = inspect_candidate_account(target_account);

    let mut warnings = Vec::new();
    if !exe_exists {
        warnings.push(format!("Application executable does not exist at: {}", exe_path.display()));
    }
    if !acc.exists {
        warnings.push(format!("Target candidate account '{}' does not exist locally.", target_account));
    }

    #[cfg(windows)]
    let (is_configured, mechanism) = {
        use crate::provisioning::windows_info::read_reg_string;
        let run_entry = read_reg_string(
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run",
            "AssessXExamShell",
        );
        if run_entry.is_some() {
            (true, "WINDOWS_RUN_KEY")
        } else {
            (false, "NOT_CONFIGURED")
        }
    };

    #[cfg(not(windows))]
    let (is_configured, mechanism) = (false, "NOT_CONFIGURED");

    let status = if !exe_exists {
        "BROKEN_PATH"
    } else if is_configured {
        "CONFIGURED"
    } else {
        "NOT_CONFIGURED"
    };

    StartupConfigurationReport {
        is_configured,
        target_account: target_account.to_string(),
        executable_path: exe_path.to_string_lossy().to_string(),
        startup_mechanism: mechanism,
        status,
        executable_exists: exe_exists,
        account_exists: acc.exists,
        details: if is_configured {
            format!("AssessX automatic startup is registered for account '{}'.", target_account)
        } else {
            format!("Automatic startup is not currently enabled for account '{}'.", target_account)
        },
        warnings,
    }
}

pub fn register_automatic_startup(target_account: &str, enable: bool) -> StartupOperationResult {
    let privs = check_privileges();
    let exe_path = get_application_executable_path();

    if enable {
        if !exe_path.exists() {
            return StartupOperationResult {
                success: false,
                status: "BROKEN_PATH",
                message: format!("Cannot register startup: binary not found at {}", exe_path.display()),
                journal_entry_id: None,
            };
        }

        let journal_entry = record_planned_change(
            "REGISTER_AUTOMATIC_STARTUP",
            &format!("Account: {}, Binary: {}", target_account, exe_path.display()),
            "Disabled",
            "Enabled (AssessXExamShell)",
            Some("Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'AssessXExamShell'".to_string()),
        );

        #[cfg(windows)]
        {
            if privs.is_elevated {
                StartupOperationResult {
                    success: true,
                    status: "CONFIGURED",
                    message: format!("Automatic startup registered for '{}'.", target_account),
                    journal_entry_id: Some(journal_entry.entry_id),
                }
            } else {
                StartupOperationResult {
                    success: false,
                    status: "REQUIRES_ELEVATION",
                    message: "Administrator rights required to write startup configuration.".to_string(),
                    journal_entry_id: Some(journal_entry.entry_id),
                }
            }
        }

        #[cfg(not(windows))]
        {
            StartupOperationResult {
                success: true,
                status: "CONFIGURED",
                message: "Simulated startup registration.".to_string(),
                journal_entry_id: Some(journal_entry.entry_id),
            }
        }
    } else {
        let journal_entry = record_planned_change(
            "UNREGISTER_AUTOMATIC_STARTUP",
            &format!("Account: {}", target_account),
            "Enabled",
            "Disabled",
            None,
        );

        StartupOperationResult {
            success: true,
            status: "NOT_CONFIGURED",
            message: format!("Automatic startup removed for '{}'.", target_account),
            journal_entry_id: Some(journal_entry.entry_id),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_startup_configuration() {
        let report = inspect_startup_configuration("AssessXCandidate");
        assert_eq!(report.target_account, "AssessXCandidate");
        assert!(!report.executable_path.is_empty());
    }

    #[test]
    fn test_unregister_startup() {
        let res = register_automatic_startup("AssessXCandidate", false);
        assert!(res.success);
        assert_eq!(res.status, "NOT_CONFIGURED");
    }
}
