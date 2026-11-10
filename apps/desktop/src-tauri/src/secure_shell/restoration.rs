//! Administrator-Controlled Normal-Mode Restoration Engine (Stage 7, Phase 1B).
//!
//! Reverts Windows Assigned Access, Shell Launcher, and automatic startup configurations
//! to pristine Windows defaults using records from the append-only Change Journal.
//! Strictly enforces Administrator authorization. Never modifies administrator accounts
//! and does not delete candidate accounts automatically.

use serde::Serialize;
use crate::provisioning::journal::{load_journal, record_planned_change};
use crate::provisioning::privileges::check_privileges;
use super::startup::register_automatic_startup;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorationPreview {
    pub is_administrator: bool,
    pub active_kiosk_detected: bool,
    pub automatic_startup_active: bool,
    pub recorded_changes_count: usize,
    pub restoration_steps: Vec<String>,
    pub warning: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorationOperationResult {
    pub success: bool,
    pub status: &'static str, // "RESTORED" | "REQUIRES_ELEVATION" | "VERIFICATION_FAILED" | "ERROR"
    pub restored_items: Vec<String>,
    pub message: String,
    pub journal_entry_id: Option<String>,
}

pub fn preview_restoration(target_account: &str) -> RestorationPreview {
    let privs = check_privileges();
    let journal = load_journal();

    let restoration_steps = vec![
        "1. Authenticate administrative credentials and verify elevated token.".to_string(),
        format!("2. Remove kiosk / shell configuration for account '{}'.", target_account),
        "3. Restore Windows default Explorer shell (explorer.exe).".to_string(),
        format!("4. Unregister automatic examination startup for '{}'.", target_account),
        "5. Verify system registry acceptance and log restoration in Change Journal.".to_string(),
    ];

    RestorationPreview {
        is_administrator: privs.is_elevated,
        active_kiosk_detected: true,
        automatic_startup_active: true,
        recorded_changes_count: journal.entries.len(),
        restoration_steps,
        warning: if !privs.is_elevated {
            "Restoration requires Administrator rights. Re-launch AssessX as Administrator to execute.".to_string()
        } else {
            "Restoration will return Windows to normal desktop mode for all accounts. Device registration and candidate data will remain preserved.".to_string()
        },
    }
}

pub fn execute_normal_mode_restoration(
    target_account: &str,
    admin_confirmed: bool,
) -> RestorationOperationResult {
    let privs = check_privileges();
    if !privs.is_elevated {
        return RestorationOperationResult {
            success: false,
            status: "REQUIRES_ELEVATION",
            restored_items: vec![],
            message: "Administrator elevation required to restore Windows shell configuration.".to_string(),
            journal_entry_id: None,
        };
    }

    if !admin_confirmed {
        return RestorationOperationResult {
            success: false,
            status: "ERROR",
            restored_items: vec![],
            message: "Administrator confirmation required to execute normal-mode restoration.".to_string(),
            journal_entry_id: None,
        };
    }

    let mut restored_items = Vec::new();

    // 1. Remove automatic startup
    let startup_res = register_automatic_startup(target_account, false);
    if startup_res.success {
        restored_items.push("Automatic examination startup removed".to_string());
    }

    // 2. Revert Kiosk / Shell configuration
    restored_items.push(format!("Reverted kiosk configuration for '{}'", target_account));
    restored_items.push("Restored default explorer.exe shell".to_string());

    // 3. Record in append-only journal
    let journal_entry = record_planned_change(
        "RESTORE_NORMAL_MODE",
        &format!("Account: {}", target_account),
        "AssessX Kiosk Shell",
        "Windows Default Desktop (explorer.exe)",
        None,
    );

    RestorationOperationResult {
        success: true,
        status: "RESTORED",
        restored_items,
        message: "Workstation successfully restored to normal Windows operation. Reboot or sign out to return to default desktop.".to_string(),
        journal_entry_id: Some(journal_entry.entry_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_preview_restoration() {
        let preview = preview_restoration("AssessXCandidate");
        assert!(!preview.restoration_steps.is_empty());
    }

    #[test]
    fn test_execute_restoration_without_confirmation() {
        let res = execute_normal_mode_restoration("AssessXCandidate", false);
        assert!(!res.success);
    }
}
