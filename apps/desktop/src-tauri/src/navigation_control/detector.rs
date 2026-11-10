//! Real-time Navigation & Shortcut Event Classifier & Dispatcher (Phase 2C).
//!
//! Evaluates active window state and shell interactions against the active navigation policy,
//! categorizing violations and dispatching events to the Security Agent.

use super::focus_supervisor::{FocusSupervisor, FocusTargetClass};
use super::policy::NavigationPolicyEngine;
use crate::security_agent::backend_client::{BackendClient, QueuedSecurityEvent};
use crate::security_agent::logger::log_warn;
use crate::security_agent::tamper::TamperDetector;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum NavigationEventClassification {
    ApplicationSwitchAttempt,
    WindowsShellNavigationDetected,
    UnexpectedWindowActivated,
    AssessXWindowMinimized,
    KeyboardShortcutDetected,
    FocusLossDetected,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationViolation {
    pub target_window_title: String,
    pub target_process_name: String,
    pub classification: NavigationEventClassification,
    pub action_taken: String,
    pub policy_rule: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationScanSummary {
    pub is_environment_compliant: bool,
    pub violations_count: usize,
    pub focus_state: String,
    pub violations: Vec<NavigationViolation>,
}

pub struct NavigationDetector;

impl NavigationDetector {
    /// Scan current foreground window and navigation state for policy violations.
    pub fn scan_and_classify() -> NavigationScanSummary {
        let focus_report = FocusSupervisor::inspect_focus();
        let policy = NavigationPolicyEngine::get_policy();

        let mut violations = Vec::new();

        // 1. Check minimization
        if focus_report.is_minimized {
            violations.push(NavigationViolation {
                target_window_title: focus_report.active_foreground_title.clone(),
                target_process_name: focus_report.active_foreground_process.clone(),
                classification: NavigationEventClassification::AssessXWindowMinimized,
                action_taken: "MONITORED".to_string(),
                policy_rule: "ExamWindowMinimizationGuard".to_string(),
            });
            Self::dispatch_event(
                "ASSESSX_WINDOW_MINIMIZED",
                "AssessX examination window was minimized.",
                &focus_report.active_foreground_process,
            );
        }

        // 2. Check focus departure
        match focus_report.focus_classification {
            FocusTargetClass::ForeignApplication => {
                if policy.app_switching_blocked {
                    violations.push(NavigationViolation {
                        target_window_title: focus_report.active_foreground_title.clone(),
                        target_process_name: focus_report.active_foreground_process.clone(),
                        classification: NavigationEventClassification::ApplicationSwitchAttempt,
                        action_taken: "RECLAIM_TRIGGERED".to_string(),
                        policy_rule: "app_switching_blocked: true".to_string(),
                    });
                    Self::dispatch_event(
                        "APPLICATION_SWITCH_ATTEMPT",
                        &format!("Focus moved to unauthorized application: {} ({})", focus_report.active_foreground_title, focus_report.active_foreground_process),
                        &focus_report.active_foreground_process,
                    );
                }
            }
            FocusTargetClass::SystemSurface => {
                if policy.windows_keys_blocked || policy.search_interface_blocked {
                    violations.push(NavigationViolation {
                        target_window_title: focus_report.active_foreground_title.clone(),
                        target_process_name: focus_report.active_foreground_process.clone(),
                        classification: NavigationEventClassification::WindowsShellNavigationDetected,
                        action_taken: "MONITORED".to_string(),
                        policy_rule: "windows_keys_blocked: true".to_string(),
                    });
                    Self::dispatch_event(
                        "WINDOWS_SHELL_NAVIGATION_DETECTED",
                        &format!("Candidate accessed Windows shell surface: {}", focus_report.active_foreground_process),
                        &focus_report.active_foreground_process,
                    );
                }
            }
            FocusTargetClass::BareDesktop => {
                if policy.desktop_surface_blocked {
                    violations.push(NavigationViolation {
                        target_window_title: "Desktop Surface".to_string(),
                        target_process_name: "explorer.exe".to_string(),
                        classification: NavigationEventClassification::FocusLossDetected,
                        action_taken: "MONITORED".to_string(),
                        policy_rule: "desktop_surface_blocked: true".to_string(),
                    });
                }
            }
            FocusTargetClass::AssessXExamWindow | FocusTargetClass::Unknown => {}
        }

        let violations_count = violations.len();
        NavigationScanSummary {
            is_environment_compliant: violations_count == 0,
            violations_count,
            focus_state: format!("{:?}", focus_report.focus_classification),
            violations,
        }
    }

    fn dispatch_event(event_type: &str, description: &str, process_name: &str) {
        log_warn("NavigationDetector", &format!("{}: {}", event_type, description));

        let details = serde_json::json!({
            "process_name": process_name,
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
            category: "navigation_control".to_string(),
            details,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detector_scan() {
        let summary = NavigationDetector::scan_and_classify();
        assert!(!summary.focus_state.is_empty());
    }
}

