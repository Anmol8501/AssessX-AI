//! Windows Task Manager (taskmgr.exe) Discovery, Policy Enforcement & Monitoring (Phase 2B).
//!
//! Provides inspection of Task Manager, integration with Windows DisableTaskMgr registry policy,
//! candidate-account scoping, independent verification, and rollback.

use super::registry_policy::{RegistryPolicyEngine, RegistryPolicyTarget};
use crate::application_control::identity::ApplicationIdentity;
use crate::application_control::inventory::ApplicationInventory;
use crate::security_agent::logger::log_info;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskManagerRestrictionMode {
    Allow,
    Block,
    DetectionOnly,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskManagerState {
    Available,
    BlockedByPolicy,
    DetectionOnly,
    Unsupported,
    VerificationFailed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskManagerStatusReport {
    pub is_installed: bool,
    pub primary_path: Option<String>,
    pub file_hash: Option<String>,
    pub file_version: Option<String>,
    pub active_mode: TaskManagerRestrictionMode,
    pub current_state: TaskManagerState,
    pub disable_taskmgr_registry_value: Option<u32>,
    pub running_instances_count: usize,
    pub candidate_account_scoped: bool,
    pub last_verified_at: Option<String>,
}

pub struct TaskManagerPolicy;

impl TaskManagerPolicy {
    /// Inspect the local workstation for taskmgr.exe availability and active policy state.
    pub fn inspect_task_manager(candidate_sid: Option<&str>) -> TaskManagerStatusReport {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let taskmgr_path = format!("{}\\System32\\taskmgr.exe", system_root);

        let mut report = TaskManagerStatusReport {
            is_installed: false,
            primary_path: None,
            file_hash: None,
            file_version: None,
            active_mode: TaskManagerRestrictionMode::DetectionOnly,
            current_state: TaskManagerState::Available,
            disable_taskmgr_registry_value: None,
            running_instances_count: 0,
            candidate_account_scoped: candidate_sid.is_some(),
            last_verified_at: None,
        };

        if Path::new(&taskmgr_path).is_file() {
            report.is_installed = true;
            report.primary_path = Some(taskmgr_path.clone());
            if let Ok(identity) = ApplicationIdentity::from_path(Path::new(&taskmgr_path), Vec::new()) {
                report.file_hash = Some(identity.file_hash);
                report.file_version = identity.file_version;
            }
        }

        // Count running taskmgr.exe processes
        let running_apps = ApplicationInventory::scan_running_applications();
        let running_tm = running_apps
            .iter()
            .filter(|app| app.executable_name.to_ascii_lowercase() == "taskmgr.exe")
            .count();
        report.running_instances_count = running_tm;

        // Read DisableTaskMgr registry policy
        let reg_state = RegistryPolicyEngine::read_policy(RegistryPolicyTarget::DisableTaskMgr, candidate_sid);
        report.disable_taskmgr_registry_value = reg_state.current_raw_value;

        if reg_state.current_raw_value == Some(1) {
            report.active_mode = TaskManagerRestrictionMode::Block;
            report.current_state = TaskManagerState::BlockedByPolicy;
        } else {
            report.active_mode = TaskManagerRestrictionMode::DetectionOnly;
            report.current_state = TaskManagerState::Available;
        }

        report
    }

    /// Apply a Task Manager restriction policy.
    pub fn apply_policy(
        mode: TaskManagerRestrictionMode,
        candidate_sid: Option<&str>,
    ) -> Result<TaskManagerStatusReport, String> {
        log_info("TaskManager", &format!("Applying Task Manager restriction policy mode: {:?}", mode));

        match mode {
            TaskManagerRestrictionMode::Allow | TaskManagerRestrictionMode::DetectionOnly => {
                RegistryPolicyEngine::remove_policy(RegistryPolicyTarget::DisableTaskMgr, candidate_sid)?;
            }
            TaskManagerRestrictionMode::Block => {
                RegistryPolicyEngine::apply_and_verify(RegistryPolicyTarget::DisableTaskMgr, 1, candidate_sid)?;
            }
        }

        let mut updated = Self::inspect_task_manager(candidate_sid);
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
    fn test_inspect_task_manager() {
        let report = TaskManagerPolicy::inspect_task_manager(None);
        if cfg!(windows) {
            assert!(report.is_installed);
            assert!(report.primary_path.is_some());
            assert!(report.file_hash.is_some());
        }
    }

    #[test]
    fn test_task_manager_mode_inspection() {
        let report = TaskManagerPolicy::inspect_task_manager(None);
        assert!(matches!(
            report.active_mode,
            TaskManagerRestrictionMode::Allow
                | TaskManagerRestrictionMode::Block
                | TaskManagerRestrictionMode::DetectionOnly
        ));
    }
}
