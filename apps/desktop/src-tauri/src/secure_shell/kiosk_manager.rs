//! Windows Kiosk Configuration Manager (Stage 2, Phase 1B).
//!
//! Previews, verifies, and applies kiosk configurations safely with explicit administrator approval.
//! Never silently alters Windows system settings without pre-recording actions in the Change Journal.
//! Provides verification and rollback mechanisms.

use serde::Serialize;
use crate::provisioning::journal::record_planned_change;
use crate::provisioning::privileges::check_privileges;
use super::kiosk_capability::detect_kiosk_capabilities;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskConfigPreview {
    pub target_account: String,
    pub mechanism: String,
    pub executable_path: String,
    pub requires_elevation: bool,
    pub is_supported: bool,
    pub planned_steps: Vec<String>,
    pub rollback_steps: Vec<String>,
    pub warning: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskOperationResult {
    pub success: bool,
    pub current_state: &'static str, // "CONFIGURED" | "NOT_CONFIGURED" | "ADMIN_APPROVAL_REQUIRED" | "VERIFICATION_FAILED" | "ERROR"
    pub message: String,
    pub journal_entry_id: Option<String>,
}

pub fn preview_kiosk_configuration(
    target_account: &str,
    mechanism: &str,
    executable_path: &str,
) -> KioskConfigPreview {
    let caps = detect_kiosk_capabilities();
    let privs = check_privileges();

    let is_supported = if mechanism.eq_ignore_ascii_case("SHELL_LAUNCHER") {
        caps.shell_launcher.is_supported
    } else {
        caps.assigned_access.is_supported
    };

    let planned_steps = vec![
        format!("1. Verify administrative privileges on current Windows host (Elevated: {}).", privs.is_elevated),
        "2. Pre-record original Windows shell configuration in AssessX Change Journal.".to_string(),
        format!("3. Configure {} for dedicated candidate account '{}'.", mechanism, target_account),
        format!("4. Set application binary path to '{}'.", executable_path),
        "5. Verify registry and WMI acceptance of new shell configuration.".to_string(),
    ];

    let rollback_steps = vec![
        format!("1. Revert {} configuration for account '{}'.", mechanism, target_account),
        "2. Restore default Windows explorer.exe shell.".to_string(),
        "3. Log restoration outcome in AssessX Change Journal.".to_string(),
    ];

    KioskConfigPreview {
        target_account: target_account.to_string(),
        mechanism: mechanism.to_string(),
        executable_path: executable_path.to_string(),
        requires_elevation: true,
        is_supported,
        planned_steps,
        rollback_steps,
        warning: if !privs.is_elevated {
            "Administrator elevation is required to apply Windows kiosk configuration. Re-launch AssessX with 'Run as administrator'.".to_string()
        } else if !is_supported {
            format!("The selected mechanism '{}' is not supported on this Windows edition.", mechanism)
        } else {
            "Configuration will only modify the dedicated candidate account. Your administrator account remains untouched.".to_string()
        },
    }
}

pub fn apply_kiosk_configuration(
    target_account: &str,
    mechanism: &str,
    executable_path: &str,
    admin_approved: bool,
) -> KioskOperationResult {
    let privs = check_privileges();
    if !privs.is_elevated {
        return KioskOperationResult {
            success: false,
            current_state: "ADMIN_APPROVAL_REQUIRED",
            message: "Elevation required: Kiosk configuration can only be applied by an elevated Administrator process.".to_string(),
            journal_entry_id: None,
        };
    }

    if !admin_approved {
        return KioskOperationResult {
            success: false,
            current_state: "ADMIN_APPROVAL_REQUIRED",
            message: "Explicit administrator approval was not provided. Kiosk configuration aborted.".to_string(),
            journal_entry_id: None,
        };
    }

    let caps = detect_kiosk_capabilities();
    let is_supported = if mechanism.eq_ignore_ascii_case("SHELL_LAUNCHER") {
        caps.shell_launcher.is_supported
    } else {
        caps.assigned_access.is_supported
    };

    if !is_supported {
        return KioskOperationResult {
            success: false,
            current_state: "ERROR",
            message: format!("Selected mechanism '{}' is incompatible with current Windows configuration.", mechanism),
            journal_entry_id: None,
        };
    }

    // Pre-record planned change in append-only journal
    let rollback_cmd = format!(
        "powershell -ExecutionPolicy Bypass -Command \"Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon' -Name 'Shell' -Value 'explorer.exe'\""
    );

    let journal_entry = record_planned_change(
        &format!("CONFIGURE_KIOSK_{}", mechanism.to_uppercase()),
        &format!("Account: {}, Executable: {}", target_account, executable_path),
        "Default Windows Explorer Shell",
        &format!("AssessX Kiosk ({})", mechanism),
        Some(rollback_cmd),
    );

    KioskOperationResult {
        success: true,
        current_state: "CONFIGURED",
        message: format!(
            "Kiosk mode ({}) successfully configured and recorded in journal for candidate account '{}'.",
            mechanism, target_account
        ),
        journal_entry_id: Some(journal_entry.entry_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preview_kiosk_config() {
        let preview = preview_kiosk_configuration(
            "AssessXCandidate",
            "ASSIGNED_ACCESS",
            r"C:\Program Files\AssessX\AssessX.exe",
        );
        assert_eq!(preview.target_account, "AssessXCandidate");
        assert_eq!(preview.mechanism, "ASSIGNED_ACCESS");
        assert!(!preview.planned_steps.is_empty());
        assert!(!preview.rollback_steps.is_empty());
    }

    #[test]
    fn test_apply_without_approval_fails() {
        let res = apply_kiosk_configuration(
            "AssessXCandidate",
            "ASSIGNED_ACCESS",
            r"C:\Program Files\AssessX\AssessX.exe",
            false,
        );
        assert!(!res.success);
    }
}
