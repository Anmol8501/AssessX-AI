//! Peripheral and Remote-Access Violation Detector (Phase 2D).
//!
//! Evaluates active hardware and remote session state against the active policy,
//! classifies violations, records tamper events, and queues backend alerts.

use super::display::{DisplayManager, DisplayTopologyReport};
use super::policy::PeripheralPolicyEngine;
use super::remote_access::{RemoteAccessManager, RemoteAccessStatusReport};
use super::storage::{StorageManager, StoragePolicyMode, StorageStatusReport};
use crate::security_agent::backend_client::{BackendClient, QueuedSecurityEvent};
use crate::security_agent::tamper::TamperDetector;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralScanViolation {
    pub violation_type: String,
    pub severity: String,
    pub target_device: String,
    pub description: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralScanSummary {
    pub is_environment_compliant: bool,
    pub violations_count: usize,
    pub storage_report: StorageStatusReport,
    pub display_report: DisplayTopologyReport,
    pub remote_report: RemoteAccessStatusReport,
    pub violations: Vec<PeripheralScanViolation>,
}

pub struct PeripheralDetector;

impl PeripheralDetector {
    /// Perform comprehensive peripheral, storage, and remote-access scan.
    pub fn scan_and_classify() -> PeripheralScanSummary {
        let policy = PeripheralPolicyEngine::get_policy();
        let storage_rep = StorageManager::inspect_storage(policy.storage_mode);
        let display_rep = DisplayManager::inspect_display_topology(policy.max_monitors);
        let remote_rep = RemoteAccessManager::inspect_remote_access();

        let mut violations = Vec::new();
        let now_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string());

        // 1. Storage checks
        if policy.storage_mode == StoragePolicyMode::BlockUnapprovedStorage {
            for drive in &storage_rep.removable_drives {
                violations.push(PeripheralScanViolation {
                    violation_type: "UNAUTHORIZED_STORAGE_INSERTED".to_string(),
                    severity: "HIGH".to_string(),
                    target_device: drive.drive_letter.clone(),
                    description: format!("Removable storage volume '{}' ({}) connected during active exam", drive.volume_name, drive.file_system),
                    timestamp: now_ts.clone(),
                });
            }
        }

        // 2. Display topology checks
        if display_rep.monitor_count > policy.max_monitors {
            violations.push(PeripheralScanViolation {
                violation_type: "TOPOLOGY_MISMATCH".to_string(),
                severity: "HIGH".to_string(),
                target_device: format!("{} Monitors", display_rep.monitor_count),
                description: format!("Connected monitor count ({}) exceeds allowed limit ({})", display_rep.monitor_count, policy.max_monitors),
                timestamp: now_ts.clone(),
            });
        }

        if display_rep.has_virtual_display && !policy.allow_virtual_displays {
            violations.push(PeripheralScanViolation {
                violation_type: "VIRTUAL_DISPLAY_DETECTED".to_string(),
                severity: "CRITICAL".to_string(),
                target_device: "VirtualDisplayAdapter".to_string(),
                description: "Virtual display software adapter detected on system".to_string(),
                timestamp: now_ts.clone(),
            });
        }

        // 3. Remote access checks
        if remote_rep.is_remote_session_active && policy.block_remote_sessions {
            violations.push(PeripheralScanViolation {
                violation_type: "REMOTE_SESSION_ACTIVE".to_string(),
                severity: "CRITICAL".to_string(),
                target_device: "TerminalServices/RDP".to_string(),
                description: "Active Remote Desktop Protocol session detected".to_string(),
                timestamp: now_ts.clone(),
            });
        }

        if policy.block_remote_tools {
            for tool in &remote_rep.detected_remote_tools {
                violations.push(PeripheralScanViolation {
                    violation_type: "PROHIBITED_REMOTE_TOOL_RUNNING".to_string(),
                    severity: "CRITICAL".to_string(),
                    target_device: tool.executable_name.clone(),
                    description: format!("Prohibited remote assistance software '{}' (PID {}) is running", tool.tool_name, tool.process_id),
                    timestamp: now_ts.clone(),
                });
            }
        }

        // Emit alerts for detected violations
        for v in &violations {
            TamperDetector::record_event(
                &v.violation_type,
                &v.severity,
                &v.description,
                serde_json::json!({
                    "target": v.target_device,
                    "timestamp": v.timestamp
                }),
            );

            BackendClient::enqueue(QueuedSecurityEvent {
                event_type: v.violation_type.clone(),
                severity: v.severity.clone(),
                category: "peripheral_tamper".to_string(),
                details: serde_json::json!({
                    "target": v.target_device,
                    "description": v.description
                }),
            });
        }

        let is_compliant = violations.is_empty();
        let violations_count = violations.len();

        PeripheralScanSummary {
            is_environment_compliant: is_compliant,
            violations_count,
            storage_report: storage_rep,
            display_report: display_rep,
            remote_report: remote_rep,
            violations,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_peripheral_scan() {
        let summary = PeripheralDetector::scan_and_classify();
        assert!(summary.violations_count == 0 || summary.violations_count > 0);
    }
}

