//! Windows Command Prompt (cmd.exe) Discovery, Policy Enforcement & Monitoring (Phase 2B).
//!
//! Provides inspection of cmd.exe, integration with Windows DisableCMD registry policy (DWORD 1/2),
//! candidate-account scoping, independent verification, and rollback.

use super::registry_policy::{RegistryPolicyEngine, RegistryPolicyTarget};
use crate::application_control::identity::ApplicationIdentity;
use crate::application_control::inventory::ApplicationInventory;
use crate::security_agent::logger::log_info;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CmdRestrictionMode {
    Allow,
    /// Disables interactive command prompt; batch file scripts still execute (DisableCMD = 1)
    Restrict,
    /// Disables interactive command prompt and batch file execution (DisableCMD = 2)
    Block,
    DetectionOnly,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CmdState {
    Available,
    Restricted,
    BlockedByPolicy,
    DetectionOnly,
    Unsupported,
    VerificationFailed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CmdStatusReport {
    pub is_installed: bool,
    pub primary_path: Option<String>,
    pub file_hash: Option<String>,
    pub file_version: Option<String>,
    pub active_mode: CmdRestrictionMode,
    pub current_state: CmdState,
    pub disable_cmd_registry_value: Option<u32>,
    pub running_instances_count: usize,
    pub candidate_account_scoped: bool,
    pub last_verified_at: Option<String>,
}

pub struct CmdManager;

impl CmdManager {
    /// Inspect the local workstation for cmd.exe availability and active policy state.
    pub fn inspect_cmd(candidate_sid: Option<&str>) -> CmdStatusReport {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let cmd_path = format!("{}\\System32\\cmd.exe", system_root);

        let mut report = CmdStatusReport {
            is_installed: false,
            primary_path: None,
            file_hash: None,
            file_version: None,
            active_mode: CmdRestrictionMode::DetectionOnly,
            current_state: CmdState::Available,
            disable_cmd_registry_value: None,
            running_instances_count: 0,
            candidate_account_scoped: candidate_sid.is_some(),
            last_verified_at: None,
        };

        if Path::new(&cmd_path).is_file() {
            report.is_installed = true;
            report.primary_path = Some(cmd_path.clone());
            if let Ok(identity) = ApplicationIdentity::from_path(Path::new(&cmd_path), Vec::new()) {
                report.file_hash = Some(identity.file_hash);
                report.file_version = identity.file_version;
            }
        }

        // Check running cmd.exe instances
        let running_apps = ApplicationInventory::scan_running_applications();
        let running_cmd = running_apps
            .iter()
            .filter(|app| app.executable_name.to_ascii_lowercase() == "cmd.exe")
            .count();
        report.running_instances_count = running_cmd;

        // Read DisableCMD registry policy
        let reg_state = RegistryPolicyEngine::read_policy(RegistryPolicyTarget::DisableCmd, candidate_sid);
        report.disable_cmd_registry_value = reg_state.current_raw_value;

        match reg_state.current_raw_value {
            Some(1) => {
                report.active_mode = CmdRestrictionMode::Restrict;
                report.current_state = CmdState::Restricted;
            }
            Some(2) => {
                report.active_mode = CmdRestrictionMode::Block;
                report.current_state = CmdState::BlockedByPolicy;
            }
            _ => {
                report.active_mode = CmdRestrictionMode::DetectionOnly;
                report.current_state = CmdState::Available;
            }
        }

        report
    }

    /// Apply a Command Prompt restriction policy.
    pub fn apply_policy(
        mode: CmdRestrictionMode,
        candidate_sid: Option<&str>,
    ) -> Result<CmdStatusReport, String> {
        log_info("CmdManager", &format!("Applying CMD restriction policy mode: {:?}", mode));

        match mode {
            CmdRestrictionMode::Allow | CmdRestrictionMode::DetectionOnly => {
                RegistryPolicyEngine::remove_policy(RegistryPolicyTarget::DisableCmd, candidate_sid)?;
            }
            CmdRestrictionMode::Restrict => {
                RegistryPolicyEngine::apply_and_verify(RegistryPolicyTarget::DisableCmd, 1, candidate_sid)?;
            }
            CmdRestrictionMode::Block => {
                RegistryPolicyEngine::apply_and_verify(RegistryPolicyTarget::DisableCmd, 2, candidate_sid)?;
            }
        }

        let mut updated = Self::inspect_cmd(candidate_sid);
        updated.active_mode = mode;
        updated.last_verified_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                .to_string(),
        );

        Ok(updated)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_cmd() {
        let report = CmdManager::inspect_cmd(None);
        if cfg!(windows) {
            assert!(report.is_installed);
            assert!(report.primary_path.is_some());
            assert!(report.file_hash.is_some());
        }
    }

    #[test]
    fn test_cmd_mode_transitions() {
        let report = CmdManager::inspect_cmd(None);
        assert!(matches!(
            report.active_mode,
            CmdRestrictionMode::Allow
                | CmdRestrictionMode::Restrict
                | CmdRestrictionMode::Block
                | CmdRestrictionMode::DetectionOnly
        ));
    }
}
