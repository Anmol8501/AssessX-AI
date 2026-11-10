//! PowerShell Discovery, Versioning, Policy Enforcement & Monitoring (Phase 2B).
//!
//! Provides inspection of Windows PowerShell (v5.1) and PowerShell 7 (Core),
//! Constrained Language Mode enforcement, candidate-account scoping, and verification.

use crate::application_control::identity::ApplicationIdentity;
use crate::application_control::inventory::ApplicationInventory;
use crate::security_agent::logger::{log_info, log_warn};
use crate::system_utility::registry_policy::{RegistryPolicyEngine, RegistryPolicyTarget};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PowerShellRestrictionMode {
    Allow,
    Restrict,
    Block,
    DetectionOnly,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PowerShellState {
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
pub struct PowerShellStatusReport {
    pub win_powershell_installed: bool,
    pub win_powershell_path: Option<String>,
    pub win_powershell_version: Option<String>,
    pub win_powershell_hash: Option<String>,
    pub pwsh_7_installed: bool,
    pub pwsh_7_path: Option<String>,
    pub pwsh_7_version: Option<String>,
    pub pwsh_7_hash: Option<String>,
    pub active_mode: PowerShellRestrictionMode,
    pub current_state: PowerShellState,
    pub running_instances_count: usize,
    pub candidate_account_scoped: bool,
    pub last_verified_at: Option<String>,
}

pub struct PowerShellManager;

impl PowerShellManager {
    /// Inspect the local workstation for Windows PowerShell and PowerShell 7 availability.
    pub fn inspect_powershell() -> PowerShellStatusReport {
        Self::inspect_powershell_for_sid(None)
    }

    /// Inspect PowerShell availability and OS Registry policy for an optional candidate SID.
    pub fn inspect_powershell_for_sid(candidate_sid: Option<&str>) -> PowerShellStatusReport {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let win_ps_path = format!("{}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", system_root);
        let prog_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());
        let pwsh_7_path = format!("{}\\PowerShell\\7\\pwsh.exe", prog_files);

        let mut report = PowerShellStatusReport {
            win_powershell_installed: false,
            win_powershell_path: None,
            win_powershell_version: None,
            win_powershell_hash: None,
            pwsh_7_installed: false,
            pwsh_7_path: None,
            pwsh_7_version: None,
            pwsh_7_hash: None,
            active_mode: PowerShellRestrictionMode::DetectionOnly,
            current_state: PowerShellState::Available,
            running_instances_count: 0,
            candidate_account_scoped: true,
            last_verified_at: None,
        };

        // Inspect Windows PowerShell
        if Path::new(&win_ps_path).is_file() {
            report.win_powershell_installed = true;
            report.win_powershell_path = Some(win_ps_path.clone());
            if let Ok(identity) = ApplicationIdentity::from_path(Path::new(&win_ps_path), Vec::new()) {
                report.win_powershell_hash = Some(identity.file_hash);
                report.win_powershell_version = identity.file_version;
            }
        }

        // Inspect PowerShell 7 Core
        if Path::new(&pwsh_7_path).is_file() {
            report.pwsh_7_installed = true;
            report.pwsh_7_path = Some(pwsh_7_path.clone());
            if let Ok(identity) = ApplicationIdentity::from_path(Path::new(&pwsh_7_path), Vec::new()) {
                report.pwsh_7_hash = Some(identity.file_hash);
                report.pwsh_7_version = identity.file_version;
            }
        }

        // Count running processes
        let running_apps = ApplicationInventory::scan_running_applications();
        let running_ps = running_apps
            .iter()
            .filter(|app| {
                let name = app.executable_name.to_ascii_lowercase();
                name == "powershell.exe" || name == "pwsh.exe"
            })
            .count();
        report.running_instances_count = running_ps;

        // Inspect persistent Windows Registry PowerShell GPO state first, then process env fallback
        let reg_policy = RegistryPolicyEngine::read_policy(
            RegistryPolicyTarget::PowerShellLockdown,
            candidate_sid,
        );
        if reg_policy.current_raw_value == Some(0) {
            report.active_mode = PowerShellRestrictionMode::Block;
            report.current_state = PowerShellState::BlockedByPolicy;
        } else if std::env::var("__PSLockdownPolicy").unwrap_or_default() == "4" {
            report.active_mode = PowerShellRestrictionMode::Restrict;
            report.current_state = PowerShellState::Restricted;
        }

        report
    }

    /// Apply a PowerShell restriction policy using persistent snapshot-backed Registry GPO
    /// (`Software\Policies\Microsoft\Windows\PowerShell\EnableScripts`) plus process env lockdown.
    pub fn apply_policy(
        mode: PowerShellRestrictionMode,
        candidate_sid: Option<&str>,
    ) -> Result<PowerShellStatusReport, String> {
        log_info("PowerShell", &format!("Applying PowerShell restriction policy mode: {:?}", mode));

        match mode {
            PowerShellRestrictionMode::Allow | PowerShellRestrictionMode::DetectionOnly => {
                std::env::remove_var("__PSLockdownPolicy");
                if let Err(err) = RegistryPolicyEngine::remove_policy(
                    RegistryPolicyTarget::PowerShellLockdown,
                    candidate_sid,
                ) {
                    log_warn(
                        "PowerShell",
                        &format!("Could not revert PowerShell Registry policy: {}", err),
                    );
                    return Err(err);
                }
            }
            PowerShellRestrictionMode::Restrict | PowerShellRestrictionMode::Block => {
                std::env::set_var("__PSLockdownPolicy", "4");
                RegistryPolicyEngine::apply_and_verify(
                    RegistryPolicyTarget::PowerShellLockdown,
                    0,
                    candidate_sid,
                )?;
            }
        }

        let mut updated = Self::inspect_powershell_for_sid(candidate_sid);
        updated.active_mode = mode;
        updated.current_state = match mode {
            PowerShellRestrictionMode::Allow => PowerShellState::Available,
            PowerShellRestrictionMode::Restrict => PowerShellState::Restricted,
            PowerShellRestrictionMode::Block => PowerShellState::BlockedByPolicy,
            PowerShellRestrictionMode::DetectionOnly => PowerShellState::DetectionOnly,
        };
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
    fn test_inspect_powershell_discovery() {
        let report = PowerShellManager::inspect_powershell();
        if cfg!(windows) {
            assert!(report.win_powershell_installed);
            assert!(report.win_powershell_path.is_some());
            assert!(report.win_powershell_hash.is_some());
        }
    }

    #[test]
    fn test_powershell_apply_policy() {
        let result = PowerShellManager::apply_policy(PowerShellRestrictionMode::DetectionOnly, None);
        assert!(result.is_ok());
        let report = result.unwrap();
        assert_eq!(report.active_mode, PowerShellRestrictionMode::DetectionOnly);
        assert_eq!(report.current_state, PowerShellState::DetectionOnly);
    }
}
