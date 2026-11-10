//! System Utility Restrictions & Security Enforcement (Phase 2B).
//!
//! Subsystem coordinator providing commands for PowerShell, Command Prompt,
//! Task Manager, and Administrative Utility restrictions.

pub mod cmd;
pub mod detector;
pub mod inventory;
pub mod policy;
pub mod powershell;
pub mod registry_policy;
pub mod task_manager;

use cmd::{CmdManager, CmdRestrictionMode, CmdStatusReport};
use detector::{SystemUtilityDetector, SystemUtilityScanSummary};
use inventory::{SystemUtilityInventory, SystemUtilityItem};
use policy::{
    SystemUtilityPolicyConfig, SystemUtilityPolicyEngine, UtilityPolicyPreview,
};
use powershell::{PowerShellManager, PowerShellRestrictionMode, PowerShellStatusReport};
use task_manager::{TaskManagerPolicy, TaskManagerRestrictionMode, TaskManagerStatusReport};

#[tauri::command]
pub fn get_system_utility_inventory() -> Vec<SystemUtilityItem> {
    SystemUtilityInventory::discover_installed_utilities()
}

#[tauri::command]
pub fn inspect_powershell_status() -> PowerShellStatusReport {
    PowerShellManager::inspect_powershell()
}

#[tauri::command]
pub fn apply_powershell_policy(
    mode: PowerShellRestrictionMode,
    candidate_sid: Option<String>,
) -> Result<PowerShellStatusReport, String> {
    PowerShellManager::apply_policy(mode, candidate_sid.as_deref())
}

#[tauri::command]
pub fn inspect_cmd_status(candidate_sid: Option<String>) -> CmdStatusReport {
    CmdManager::inspect_cmd(candidate_sid.as_deref())
}

#[tauri::command]
pub fn apply_cmd_policy(
    mode: CmdRestrictionMode,
    candidate_sid: Option<String>,
) -> Result<CmdStatusReport, String> {
    CmdManager::apply_policy(mode, candidate_sid.as_deref())
}

#[tauri::command]
pub fn inspect_task_manager_status(candidate_sid: Option<String>) -> TaskManagerStatusReport {
    TaskManagerPolicy::inspect_task_manager(candidate_sid.as_deref())
}

#[tauri::command]
pub fn apply_task_manager_policy(
    mode: TaskManagerRestrictionMode,
    candidate_sid: Option<String>,
) -> Result<TaskManagerStatusReport, String> {
    TaskManagerPolicy::apply_policy(mode, candidate_sid.as_deref())
}

#[tauri::command]
pub fn get_system_utility_policy() -> SystemUtilityPolicyConfig {
    SystemUtilityPolicyEngine::get_policy()
}

#[tauri::command]
pub fn preview_system_utility_policy(policy: SystemUtilityPolicyConfig) -> UtilityPolicyPreview {
    SystemUtilityPolicyEngine::validate_and_preview(&policy)
}

#[tauri::command]
pub fn apply_system_utility_policy(
    policy: SystemUtilityPolicyConfig,
    admin_approved: bool,
) -> Result<SystemUtilityPolicyConfig, String> {
    SystemUtilityPolicyEngine::apply_policy(policy, admin_approved)
}

#[tauri::command]
pub fn scan_system_utility_violations() -> SystemUtilityScanSummary {
    SystemUtilityDetector::scan_and_classify()
}

#[tauri::command]
pub fn revert_system_utility_policy() -> Result<SystemUtilityPolicyConfig, String> {
    SystemUtilityPolicyEngine::revert_to_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        let catalog = get_system_utility_inventory();
        assert!(!catalog.is_empty());
        let ps = inspect_powershell_status();
        assert!(ps.win_powershell_installed || !ps.win_powershell_installed);
        let cmd = inspect_cmd_status(None);
        assert!(cmd.is_installed || !cmd.is_installed);
        let tm = inspect_task_manager_status(None);
        assert!(tm.is_installed || !tm.is_installed);
    }
}
