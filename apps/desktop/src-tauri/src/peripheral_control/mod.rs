//! Peripheral, Display & Remote-Access Control Subsystem (Phase 2D).
//!
//! Exposes Tauri commands for USB storage restriction, display topology inspection,
//! remote-access detection, policy lifecycle management, and violation scanning.

pub mod detector;
pub mod display;
pub mod policy;
pub mod remote_access;
pub mod storage;

use detector::{PeripheralDetector, PeripheralScanSummary};
use display::{DisplayManager, DisplayTopologyReport};
use policy::{
    PeripheralPolicyConfig, PeripheralPolicyEngine, PeripheralPolicyLifecycleState,
    PeripheralPolicyPreviewReport,
};
use remote_access::{RemoteAccessManager, RemoteAccessStatusReport};
use storage::{StorageManager, StorageStatusReport};

#[tauri::command]
pub fn inspect_storage_status() -> StorageStatusReport {
    let policy = PeripheralPolicyEngine::get_policy();
    StorageManager::inspect_storage(policy.storage_mode)
}

#[tauri::command]
pub fn inspect_display_topology() -> DisplayTopologyReport {
    let policy = PeripheralPolicyEngine::get_policy();
    DisplayManager::inspect_display_topology(policy.max_monitors)
}

#[tauri::command]
pub fn inspect_remote_access_status() -> RemoteAccessStatusReport {
    RemoteAccessManager::inspect_remote_access()
}

#[tauri::command]
pub fn get_peripheral_policy() -> PeripheralPolicyConfig {
    PeripheralPolicyEngine::get_policy()
}

#[tauri::command]
pub fn preview_peripheral_policy(
    policy: PeripheralPolicyConfig,
) -> PeripheralPolicyPreviewReport {
    PeripheralPolicyEngine::preview_policy(&policy)
}

#[tauri::command]
pub fn validate_and_save_peripheral_policy(
    mut policy: PeripheralPolicyConfig,
) -> Result<serde_json::Value, String> {
    policy.state = PeripheralPolicyLifecycleState::Validated;
    let saved = PeripheralPolicyEngine::set_policy(policy)?;
    Ok(serde_json::json!({
        "success": true,
        "state": format!("{:?}", saved.state),
        "policy": saved
    }))
}

#[tauri::command]
pub fn apply_peripheral_policy(
    admin_approval_signature: String,
) -> Result<serde_json::Value, String> {
    let applied = PeripheralPolicyEngine::apply_policy(&admin_approval_signature)?;
    Ok(serde_json::json!({
        "success": true,
        "state": format!("{:?}", applied.state),
        "policy": applied
    }))
}

#[tauri::command]
pub fn rollback_peripheral_policy() -> Result<serde_json::Value, String> {
    let rolled = PeripheralPolicyEngine::rollback_policy()?;
    Ok(serde_json::json!({
        "success": true,
        "state": format!("{:?}", rolled.state),
        "policy": rolled
    }))
}

#[tauri::command]
pub fn scan_peripheral_violations() -> PeripheralScanSummary {
    PeripheralDetector::scan_and_classify()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        let storage = inspect_storage_status();
        assert!(storage.connected_removable_drives_count == 0 || storage.connected_removable_drives_count > 0);

        let disp = inspect_display_topology();
        assert!(disp.monitor_count >= 1);

        let rem = inspect_remote_access_status();
        assert!(rem.last_inspected_at.len() > 0);

        let pol = get_peripheral_policy();
        assert!(pol.version >= 1);
    }
}
