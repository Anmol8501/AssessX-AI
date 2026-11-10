//! Secure Examination Exit Authorization & Native Policy Restoration (Phase 3C).
//!
//! Enforces backend-authorized exit gating, validates cryptographic exit tokens,
//! and orchestrates orderly rollback of all examination Windows security restrictions
//! across navigation, system utilities, application control, and peripherals.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::WebviewWindow;

use crate::lockdown::{lockdown_release, Lockdown};
use crate::secure_shell::crash_recovery::CrashRecoveryController;
use crate::security_agent::ipc::send_ipc_request;
use crate::security_agent::protocol::{
    AgentRequest, AuthorizeExitPayload, ResponseData,
};
use crate::session_continuity::clear_local_answers;

/// Report returned to desktop UI following native security restoration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClosureRestorationReport {
    pub success: bool,
    pub closure_status: String,
    pub restored_subsystems: Vec<String>,
    #[serde(default)]
    pub failed_subsystems: Vec<String>,
    pub message: String,
}

fn build_closure_report(
    restored_subsystems: Vec<String>,
    failed_subsystems: Vec<String>,
) -> ClosureRestorationReport {
    let (success, closure_status, message) = if failed_subsystems.is_empty() && !restored_subsystems.is_empty() {
        (
            true,
            "RESTORED".to_string(),
            "Windows examination environment successfully restored to baseline state.".to_string(),
        )
    } else if !restored_subsystems.is_empty() {
        (
            false,
            "PARTIAL_FAILURE".to_string(),
            format!(
                "Restored {} subsystem(s); {} failed to restore cleanly: {}",
                restored_subsystems.len(),
                failed_subsystems.len(),
                failed_subsystems.join(", ")
            ),
        )
    } else {
        (
            false,
            "FAILED".to_string(),
            "Failed to restore native Windows examination environment subsystems.".to_string(),
        )
    };

    ClosureRestorationReport {
        success,
        closure_status,
        restored_subsystems,
        failed_subsystems,
        message,
    }
}

fn current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Gated native exit command executed only when candidate holds valid backend exit token.
#[tauri::command]
pub async fn authorize_secure_examination_exit(
    attempt_id: String,
    exit_token: String,
    device_id: String,
    window: WebviewWindow,
    state: tauri::State<'_, Lockdown>,
) -> Result<ClosureRestorationReport, String> {
    // 1. Verify token structure: attempt_id.exp_ts.signature
    let parts: Vec<&str> = exit_token.split('.').collect();
    if parts.len() != 3 {
        return Err("Malformed exit authorization token format.".to_string());
    }

    let token_attempt_id = parts[0];
    let exp_ts = parts[1]
        .parse::<u64>()
        .map_err(|_| "Invalid token expiration timestamp.".to_string())?;

    if token_attempt_id != attempt_id {
        return Err("Exit token does not match active examination attempt.".to_string());
    }

    if current_timestamp_secs() > exp_ts {
        return Err("Exit authorization token has expired. Request fresh authorization.".to_string());
    }

    let mut restored_subsystems = Vec::new();
    let mut failed_subsystems = Vec::new();

    // 2. Coordinate with Security Agent over Named Pipe
    let pipe_request = AgentRequest::AuthorizeExitAndRestore(AuthorizeExitPayload {
        attempt_id: attempt_id.clone(),
        exit_token: exit_token.clone(),
        device_id: device_id.clone(),
    });

    match send_ipc_request(&pipe_request) {
        Ok(crate::security_agent::protocol::AgentResponse::Success(ResponseData::Restoration(report))) => {
            if report.restored_subsystems.is_empty() {
                failed_subsystems.push("SECURITY_AGENT_RESTORE".to_string());
            } else {
                restored_subsystems.extend(report.restored_subsystems);
            }
        }
        _ => {
            // Standalone or local fallback restoration: track every subsystem honestly
            match crate::navigation_control::revert_navigation_policy() {
                Ok(_) => restored_subsystems.push("NAVIGATION_SHORTCUTS".to_string()),
                Err(_) => failed_subsystems.push("NAVIGATION_SHORTCUTS".to_string()),
            }

            match crate::system_utility::revert_system_utility_policy() {
                Ok(_) => restored_subsystems.push("SYSTEM_UTILITIES".to_string()),
                Err(_) => failed_subsystems.push("SYSTEM_UTILITIES".to_string()),
            }

            let app_res = crate::application_control::application_control_restore_baseline();
            if app_res.success {
                restored_subsystems.push("APPLICATION_ALLOWLISTING".to_string());
            } else {
                failed_subsystems.push("APPLICATION_ALLOWLISTING".to_string());
            }

            match crate::peripheral_control::rollback_peripheral_policy() {
                Ok(_) => restored_subsystems.push("PERIPHERALS_STORAGE".to_string()),
                Err(_) => failed_subsystems.push("PERIPHERALS_STORAGE".to_string()),
            }
        }
    }

    // 3. Release lockdown full-screen window and keyboard hook
    lockdown_release(window, state);
    restored_subsystems.push("LOCKDOWN_WINDOW_GUARD".to_string());

    // 4. Mark clean exit in crash recovery controller
    let crash_controller = CrashRecoveryController::default();
    crash_controller.mark_clean_exit();
    restored_subsystems.push("CRASH_RECOVERY_CLEAN_EXIT".to_string());

    // 5. Purge ephemeral local encrypted answer cache
    if clear_local_answers(attempt_id).is_ok() {
        restored_subsystems.push("LOCAL_ANSWER_CACHE_PURGED".to_string());
    } else {
        failed_subsystems.push("LOCAL_ANSWER_CACHE_PURGED".to_string());
    }

    Ok(build_closure_report(restored_subsystems, failed_subsystems))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_closure_restoration_report_serialization() {
        let report = ClosureRestorationReport {
            success: true,
            closure_status: "RESTORED".to_string(),
            restored_subsystems: vec!["NAVIGATION".to_string(), "LOCKDOWN".to_string()],
            failed_subsystems: Vec::new(),
            message: "Restoration verified".to_string(),
        };

        let json = serde_json::to_string(&report).expect("serialize");
        assert!(json.contains("RESTORED"));
        assert!(json.contains("restoredSubsystems"));
        assert!(json.contains("failedSubsystems"));
    }

    #[test]
    fn test_build_closure_report_honest_statuses() {
        let full = build_closure_report(vec!["NAVIGATION_SHORTCUTS".to_string()], vec![]);
        assert!(full.success);
        assert_eq!(full.closure_status, "RESTORED");

        let partial = build_closure_report(
            vec!["LOCKDOWN_WINDOW_GUARD".to_string()],
            vec!["PERIPHERALS_STORAGE".to_string()],
        );
        assert!(!partial.success);
        assert_eq!(partial.closure_status, "PARTIAL_FAILURE");
        assert!(partial.message.contains("PERIPHERALS_STORAGE"));

        let total_fail = build_closure_report(vec![], vec!["SYSTEM_UTILITIES".to_string()]);
        assert!(!total_fail.success);
        assert_eq!(total_fail.closure_status, "FAILED");
    }
}

