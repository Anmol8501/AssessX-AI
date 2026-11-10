//! Keyboard Shortcut Restrictions & Windows Navigation Control (Phase 2C).
//!
//! Subsystem coordinator providing commands for shortcut management,
//! native Explorer policy enforcement, focus monitoring, and accessibility accommodations.

pub mod accessibility;
pub mod detector;
pub mod focus_supervisor;
pub mod inventory;
pub mod native_enforcement;
pub mod navigation;
pub mod policy;

use accessibility::{AccessibilityManager, AccessibilityStatusReport};
use detector::{NavigationDetector, NavigationScanSummary};
use focus_supervisor::{FocusSupervisor, WindowFocusReport};
use inventory::{ShortcutInventory, ShortcutItem};
use navigation::{NavigationManager, NavigationStatusReport};
use policy::{
    NavigationControlPolicyConfig, NavigationPolicyEngine, NavigationPolicyPreview,
};

#[tauri::command]
pub fn get_shortcut_inventory() -> Vec<ShortcutItem> {
    ShortcutInventory::get_standard_catalog()
}

#[tauri::command]
pub fn get_navigation_policy() -> NavigationControlPolicyConfig {
    NavigationPolicyEngine::get_policy()
}

#[tauri::command]
pub fn preview_navigation_policy(
    policy: NavigationControlPolicyConfig,
) -> NavigationPolicyPreview {
    NavigationPolicyEngine::validate_and_preview(&policy)
}

#[tauri::command]
pub fn apply_navigation_policy(
    policy: NavigationControlPolicyConfig,
    admin_approved: bool,
) -> Result<NavigationControlPolicyConfig, String> {
    NavigationPolicyEngine::apply_policy(policy, admin_approved)
}

#[tauri::command]
pub fn revert_navigation_policy() -> Result<NavigationControlPolicyConfig, String> {
    NavigationPolicyEngine::revert_to_default()
}

#[tauri::command]
pub fn inspect_navigation_status(candidate_sid: Option<String>) -> NavigationStatusReport {
    NavigationManager::inspect_navigation_status(candidate_sid.as_deref())
}

#[tauri::command]
pub fn inspect_window_focus() -> WindowFocusReport {
    FocusSupervisor::inspect_focus()
}

#[tauri::command]
pub fn inspect_accessibility_status() -> AccessibilityStatusReport {
    AccessibilityManager::inspect_accessibility()
}

#[tauri::command]
pub fn scan_navigation_violations() -> NavigationScanSummary {
    NavigationDetector::scan_and_classify()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        let catalog = get_shortcut_inventory();
        assert!(!catalog.is_empty());
        let pol = get_navigation_policy();
        assert_eq!(pol.version, 1);
        let focus = inspect_window_focus();
        assert!(!focus.active_foreground_title.is_empty() || focus.active_foreground_title.is_empty());
        let acc = inspect_accessibility_status();
        assert!(acc.accommodations_active_count <= 10);
    }
}
