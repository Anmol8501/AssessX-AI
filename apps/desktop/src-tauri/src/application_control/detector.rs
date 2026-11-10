//! Unauthorized application detection and classification for Phase 2A.
//!
//! Compares active running processes against the allowlist policy and emits
//! security alerts when unauthorized or explicitly denied software executes.

use super::allowlist::{AllowlistManager, RuleAction};
use super::identity::ApplicationIdentity;
use super::inventory::ApplicationInventory;
use super::policy::{PolicyEngine, PolicyMode};
use crate::security_agent::backend_client::{BackendClient, QueuedSecurityEvent};
use crate::security_agent::logger::{log_info, log_warn};
use crate::security_agent::tamper::TamperDetector;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ApplicationClassification {
    ApprovedApplication,
    UnknownApplication,
    UnapprovedApplication,
    DeniedApplication,
    IdentityVerificationFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationScanSummary {
    pub total_scanned: usize,
    pub approved_count: usize,
    pub denied_count: usize,
    pub unapproved_count: usize,
    pub has_violations: bool,
    pub violations: Vec<ApplicationViolation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationViolation {
    pub application: ApplicationIdentity,
    pub classification: ApplicationClassification,
    pub reason: String,
    pub action_taken: String,
}

pub struct ApplicationDetector;

impl ApplicationDetector {
    /// Perform a full scan of running processes and classify against active policy.
    pub fn scan_and_classify() -> ApplicationScanSummary {
        let running_apps = ApplicationInventory::scan_running_applications();
        let policy_state = PolicyEngine::get_state();

        let mut approved_count = 0;
        let mut denied_count = 0;
        let mut unapproved_count = 0;
        let mut violations = Vec::new();

        for app in running_apps {
            let rule_action = AllowlistManager::evaluate_identity(&app);

            match rule_action {
                RuleAction::Allow => {
                    approved_count += 1;
                }
                RuleAction::Deny => {
                    denied_count += 1;
                    let action_taken = if policy_state.mode == PolicyMode::EnforcementMode {
                        "BLOCKED_REPORTED".to_string()
                    } else {
                        "AUDITED".to_string()
                    };

                    violations.push(ApplicationViolation {
                        application: app.clone(),
                        classification: ApplicationClassification::DeniedApplication,
                        reason: "Explicitly prohibited by examination policy.".to_string(),
                        action_taken,
                    });

                    // Emit Security Event
                    Self::report_violation(&app, "DENIED_APPLICATION_DETECTED", "CRITICAL");
                }
                RuleAction::Audit => {
                    unapproved_count += 1;
                    if policy_state.mode == PolicyMode::EnforcementMode {
                        violations.push(ApplicationViolation {
                            application: app.clone(),
                            classification: ApplicationClassification::UnapprovedApplication,
                            reason: "Unapproved application detected in enforcement mode."
                                .to_string(),
                            action_taken: "AUDITED_FLAGGED".to_string(),
                        });

                        Self::report_violation(&app, "UNAPPROVED_APPLICATION_RUNNING", "HIGH");
                    }
                }
            }
        }

        let has_violations = !violations.is_empty();

        if has_violations {
            log_warn(
                "APPLICATION_DETECTOR",
                &format!(
                    "Application policy scan completed with {} violation(s).",
                    violations.len()
                ),
            );
        } else {
            log_info(
                "APPLICATION_DETECTOR",
                &format!(
                    "Application scan clean: {} approved processes running.",
                    approved_count
                ),
            );
        }

        ApplicationScanSummary {
            total_scanned: approved_count + denied_count + unapproved_count,
            approved_count,
            denied_count,
            unapproved_count,
            has_violations,
            violations,
        }
    }

    /// Helper to record tamper and backend security events.
    fn report_violation(app: &ApplicationIdentity, event_type: &str, severity: &str) {
        let details = serde_json::json!({
            "executable_name": app.executable_name,
            "executable_path": app.executable_path,
            "file_hash": app.file_hash,
            "publisher": app.publisher,
            "pids": app.process_ids,
        });

        TamperDetector::record_event(
            event_type,
            severity,
            &format!(
                "Application policy violation: {} (PIDs: {:?})",
                app.executable_name, app.process_ids
            ),
            details.clone(),
        );

        BackendClient::enqueue(QueuedSecurityEvent {
            event_type: event_type.to_string(),
            severity: severity.to_string(),
            category: "application_control".to_string(),
            details,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_and_classify() {
        let summary = ApplicationDetector::scan_and_classify();
        assert!(summary.total_scanned > 0);
        assert_eq!(
            summary.total_scanned,
            summary.approved_count + summary.denied_count + summary.unapproved_count
        );
    }
}
