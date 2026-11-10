//! Real-time System Utility Execution Monitoring & Event Classification (Phase 2B).
//!
//! Evaluates active processes against the system utility restriction policy,
//! categorizes violations, and dispatches structured security events to the Security Agent.

use super::cmd::CmdRestrictionMode;
use super::inventory::UtilityPolicyAction;
use super::policy::SystemUtilityPolicyEngine;
use super::powershell::PowerShellRestrictionMode;
use super::task_manager::TaskManagerRestrictionMode;
use crate::application_control::inventory::ApplicationInventory;
use crate::security_agent::backend_client::{BackendClient, QueuedSecurityEvent};
use crate::security_agent::logger::log_warn;
use crate::security_agent::tamper::TamperDetector;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum UtilityEventClassification {
    PowerShellExecutionDetected,
    PowerShellExecutionBlocked,
    CmdExecutionDetected,
    CmdExecutionBlocked,
    TaskManagerAccessDetected,
    TaskManagerAccessBlocked,
    SystemUtilityAccessDetected,
    SystemUtilityAccessBlocked,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UtilityViolation {
    pub executable_name: String,
    pub executable_path: Option<String>,
    pub process_id: u32,
    pub classification: UtilityEventClassification,
    pub action_taken: String,
    pub policy_rule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemUtilityScanSummary {
    pub total_processes_checked: usize,
    pub violations_count: usize,
    pub has_violations: bool,
    pub violations: Vec<UtilityViolation>,
}

pub struct SystemUtilityDetector;

impl SystemUtilityDetector {
    /// Scan active processes and classify against active utility policy.
    pub fn scan_and_classify() -> SystemUtilityScanSummary {
        let running_apps = ApplicationInventory::scan_running_applications();
        let policy = SystemUtilityPolicyEngine::get_policy();

        let mut violations = Vec::new();

        for app in &running_apps {
            let exe_lower = app.executable_name.to_ascii_lowercase();
            let pid = app.process_ids.first().copied().unwrap_or(0);

            // 1. Check PowerShell
            if exe_lower == "powershell.exe" || exe_lower == "pwsh.exe" {
                match policy.powershell_mode {
                    PowerShellRestrictionMode::Block => {
                        violations.push(UtilityViolation {
                            executable_name: app.executable_name.clone(),
                            executable_path: Some(app.executable_path.clone()),
                            process_id: pid,
                            classification: UtilityEventClassification::PowerShellExecutionBlocked,
                            action_taken: "BLOCKED_BY_POLICY".to_string(),
                            policy_rule: "PowerShellRestrictionMode::Block".to_string(),
                        });
                        Self::dispatch_event(
                            "POWERSHELL_EXECUTION_BLOCKED",
                            &format!("Blocked unauthorized execution of {} (PID: {})", app.executable_name, pid),
                            &app.executable_name,
                            pid,
                        );
                    }
                    PowerShellRestrictionMode::Restrict | PowerShellRestrictionMode::DetectionOnly => {
                        violations.push(UtilityViolation {
                            executable_name: app.executable_name.clone(),
                            executable_path: Some(app.executable_path.clone()),
                            process_id: pid,
                            classification: UtilityEventClassification::PowerShellExecutionDetected,
                            action_taken: "MONITORED".to_string(),
                            policy_rule: "PowerShellRestrictionMode::DetectionOnly".to_string(),
                        });
                        Self::dispatch_event(
                            "POWERSHELL_EXECUTION_DETECTED",
                            &format!("Detected running instance of {} (PID: {})", app.executable_name, pid),
                            &app.executable_name,
                            pid,
                        );
                    }
                    PowerShellRestrictionMode::Allow => {}
                }
            }

            // 2. Check Command Prompt
            if exe_lower == "cmd.exe" {
                match policy.cmd_mode {
                    CmdRestrictionMode::Block => {
                        violations.push(UtilityViolation {
                            executable_name: app.executable_name.clone(),
                            executable_path: Some(app.executable_path.clone()),
                            process_id: pid,
                            classification: UtilityEventClassification::CmdExecutionBlocked,
                            action_taken: "BLOCKED_BY_POLICY".to_string(),
                            policy_rule: "CmdRestrictionMode::Block".to_string(),
                        });
                        Self::dispatch_event(
                            "CMD_EXECUTION_BLOCKED",
                            &format!("Blocked unauthorized execution of cmd.exe (PID: {})", pid),
                            &app.executable_name,
                            pid,
                        );
                    }
                    CmdRestrictionMode::Restrict | CmdRestrictionMode::DetectionOnly => {
                        violations.push(UtilityViolation {
                            executable_name: app.executable_name.clone(),
                            executable_path: Some(app.executable_path.clone()),
                            process_id: pid,
                            classification: UtilityEventClassification::CmdExecutionDetected,
                            action_taken: "MONITORED".to_string(),
                            policy_rule: "CmdRestrictionMode::DetectionOnly".to_string(),
                        });
                        Self::dispatch_event(
                            "CMD_EXECUTION_DETECTED",
                            &format!("Detected running instance of cmd.exe (PID: {})", pid),
                            &app.executable_name,
                            pid,
                        );
                    }
                    CmdRestrictionMode::Allow => {}
                }
            }

            // 3. Check Task Manager
            if exe_lower == "taskmgr.exe" {
                match policy.task_manager_mode {
                    TaskManagerRestrictionMode::Block => {
                        violations.push(UtilityViolation {
                            executable_name: app.executable_name.clone(),
                            executable_path: Some(app.executable_path.clone()),
                            process_id: pid,
                            classification: UtilityEventClassification::TaskManagerAccessBlocked,
                            action_taken: "BLOCKED_BY_POLICY".to_string(),
                            policy_rule: "TaskManagerRestrictionMode::Block".to_string(),
                        });
                        Self::dispatch_event(
                            "TASK_MANAGER_ACCESS_BLOCKED",
                            &format!("Blocked unauthorized access to Task Manager (PID: {})", pid),
                            &app.executable_name,
                            pid,
                        );
                    }
                    TaskManagerRestrictionMode::DetectionOnly => {
                        violations.push(UtilityViolation {
                            executable_name: app.executable_name.clone(),
                            executable_path: Some(app.executable_path.clone()),
                            process_id: pid,
                            classification: UtilityEventClassification::TaskManagerAccessDetected,
                            action_taken: "MONITORED".to_string(),
                            policy_rule: "TaskManagerRestrictionMode::DetectionOnly".to_string(),
                        });
                        Self::dispatch_event(
                            "TASK_MANAGER_ACCESS_DETECTED",
                            &format!("Detected Task Manager launch (PID: {})", pid),
                            &app.executable_name,
                            pid,
                        );
                    }
                    TaskManagerRestrictionMode::Allow => {}
                }
            }

            // 4. Check Registry Editor & MMC
            if exe_lower == "regedit.exe" || exe_lower == "mmc.exe" {
                if policy.registry_tools_blocked {
                    violations.push(UtilityViolation {
                        executable_name: app.executable_name.clone(),
                        executable_path: Some(app.executable_path.clone()),
                        process_id: pid,
                        classification: UtilityEventClassification::SystemUtilityAccessBlocked,
                        action_taken: "BLOCKED_BY_POLICY".to_string(),
                        policy_rule: "registry_tools_blocked: true".to_string(),
                    });
                    Self::dispatch_event(
                        "SYSTEM_UTILITY_ACCESS_BLOCKED",
                        &format!("Blocked access to administrative utility {} (PID: {})", app.executable_name, pid),
                        &app.executable_name,
                        pid,
                    );
                }
            }

            // 5. Check other configured utility rules
            for rule in &policy.utility_rules {
                if rule.executable_name.to_ascii_lowercase() == exe_lower {
                    if rule.action == UtilityPolicyAction::Block {
                        violations.push(UtilityViolation {
                            executable_name: app.executable_name.clone(),
                            executable_path: Some(app.executable_path.clone()),
                            process_id: pid,
                            classification: UtilityEventClassification::SystemUtilityAccessBlocked,
                            action_taken: "BLOCKED_BY_POLICY".to_string(),
                            policy_rule: rule.reason.clone(),
                        });
                    }
                }
            }
        }

        let violations_count = violations.len();
        SystemUtilityScanSummary {
            total_processes_checked: running_apps.len(),
            violations_count,
            has_violations: violations_count > 0,
            violations,
        }
    }

    fn dispatch_event(event_type: &str, description: &str, executable: &str, pid: u32) {
        log_warn("SystemUtilityDetector", &format!("{}: {}", event_type, description));

        let details = serde_json::json!({
            "executable_name": executable,
            "pid": pid,
            "description": description,
        });

        // Dispatch to Phase 1C TamperDetector
        TamperDetector::record_event(
            event_type,
            "HIGH",
            description,
            details.clone(),
        );

        // Queue in Phase 1C BackendClient for synchronization
        BackendClient::enqueue(QueuedSecurityEvent {
            event_type: event_type.to_string(),
            severity: "HIGH".to_string(),
            category: "system_utility_restriction".to_string(),
            details,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detector_scan() {
        let summary = SystemUtilityDetector::scan_and_classify();
        assert!(summary.total_processes_checked > 0);
    }
}
