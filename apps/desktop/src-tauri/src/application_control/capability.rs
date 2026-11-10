//! Windows Application Enforcement Capability Detection for Phase 2A.
//!
//! Evaluates whether the host Windows machine supports App Control for Business (WDAC),
//! AppLocker policies, Application Identity Service (AppIDSvc), or Process Supervision.

use crate::provisioning::windows_info::detect_windows_compatibility;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EnforcementMechanism {
    Wdac,
    AppLocker,
    ProcessSupervision,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CapabilityStatus {
    Supported,
    PartiallySupported,
    RequiresAdmin,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EnforcementCapabilityReport {
    pub primary_mechanism: EnforcementMechanism,
    pub status: CapabilityStatus,
    pub windows_edition: String,
    pub windows_build: String,
    pub wdac_supported: bool,
    pub applocker_supported: bool,
    pub appidsvc_running: bool,
    pub process_supervision_active: bool,
    pub is_enforcement_capable: bool,
    pub summary: String,
    pub recommendations: Vec<String>,
}

pub struct CapabilityDetector;

impl CapabilityDetector {
    /// Detects Windows application control capabilities on current device.
    pub fn detect_capabilities() -> EnforcementCapabilityReport {
        let win_info = detect_windows_compatibility();
        let edition_lower = win_info.edition.to_lowercase();

        let is_enterprise_or_edu =
            edition_lower.contains("enterprise") || edition_lower.contains("education");
        let is_pro = edition_lower.contains("pro");
        let is_home = edition_lower.contains("home");

        let wdac_supported = is_enterprise_or_edu || is_pro;
        let applocker_supported = is_enterprise_or_edu;
        let appidsvc_running = Self::check_appidsvc_running();
        let process_supervision_active = true; // Native AssessX Security Agent supervisor

        let mut recommendations = Vec::new();

        let (primary_mechanism, status, is_enforcement_capable, summary) = if is_enterprise_or_edu {
            if !appidsvc_running {
                recommendations.push(
                    "Start Application Identity Service ('sc start AppIDSvc') to enable AppLocker rule enforcement."
                        .to_string(),
                );
            }
            (
                EnforcementMechanism::AppLocker,
                CapabilityStatus::Supported,
                true,
                "Windows Enterprise/Education supports full native AppLocker and WDAC application control."
                    .to_string(),
            )
        } else if is_pro {
            recommendations.push(
                "Windows Pro supports WDAC policies and Process Supervision. For hardware-enforced AppLocker, Enterprise edition is recommended."
                    .to_string(),
            );
            (
                EnforcementMechanism::Wdac,
                CapabilityStatus::PartiallySupported,
                true,
                "Windows Pro supports App Control for Business (WDAC) and Security Agent Process Supervision."
                    .to_string(),
            )
        } else if is_home {
            recommendations.push(
                "Windows Home edition lacks Group Policy and AppLocker enforcement. Operating in Security Agent Process Supervision mode."
                    .to_string(),
            );
            (
                EnforcementMechanism::ProcessSupervision,
                CapabilityStatus::PartiallySupported,
                false,
                "Windows Home edition does not support native WDAC/AppLocker. Application control operates via Security Agent Process Supervision."
                    .to_string(),
            )
        } else {
            (
                EnforcementMechanism::ProcessSupervision,
                CapabilityStatus::Unsupported,
                false,
                "Unrecognized Windows edition. Defaulting to process supervision.".to_string(),
            )
        };

        EnforcementCapabilityReport {
            primary_mechanism,
            status,
            windows_edition: win_info.edition,
            windows_build: win_info.build_number,
            wdac_supported,
            applocker_supported,
            appidsvc_running,
            process_supervision_active,
            is_enforcement_capable,
            summary,
            recommendations,
        }
    }

    /// Check if Application Identity service (AppIDSvc) is running.
    fn check_appidsvc_running() -> bool {
        #[cfg(windows)]
        {
            use std::process::Command;
            if let Ok(output) = Command::new("sc.exe").args(["query", "AppIDSvc"]).output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                return stdout.contains("STATE              : 4  RUNNING");
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_capabilities() {
        let caps = CapabilityDetector::detect_capabilities();
        assert!(!caps.windows_edition.is_empty());
        assert!(!caps.windows_build.is_empty());
        assert!(caps.process_supervision_active);
    }
}
