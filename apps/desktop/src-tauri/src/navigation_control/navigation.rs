//! Windows Navigation Interface Controls (Phase 2C).
//!
//! Provides inspection and state reporting for Windows Start Menu, Taskbar,
//! Windows Search, Run Dialog, File Explorer, and Virtual Desktops.

use super::native_enforcement::NativeEnforcementManager;
use super::policy::NavigationPolicyEngine;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationStatusReport {
    pub windows_keys_disabled: bool,
    pub run_dialog_disabled: bool,
    pub search_interface_disabled: bool,
    pub taskbar_context_menu_disabled: bool,
    pub taskbar_settings_disabled: bool,
    pub desktop_surface_disabled: bool,
    pub active_policy_version: u32,
    pub candidate_account_scoped: bool,
    pub last_verified_at: Option<String>,
}

pub struct NavigationManager;

impl NavigationManager {
    /// Inspect current navigation restrictions from the Windows environment.
    pub fn inspect_navigation_status(candidate_sid: Option<&str>) -> NavigationStatusReport {
        let policy = NavigationPolicyEngine::get_policy();
        let verified = NativeEnforcementManager::verify_explorer_policies(&policy, candidate_sid);

        NavigationStatusReport {
            windows_keys_disabled: policy.windows_keys_blocked && verified,
            run_dialog_disabled: policy.run_dialog_blocked && verified,
            search_interface_disabled: policy.search_interface_blocked && verified,
            taskbar_context_menu_disabled: policy.taskbar_navigation_blocked && verified,
            taskbar_settings_disabled: policy.taskbar_navigation_blocked && verified,
            desktop_surface_disabled: policy.desktop_surface_blocked && verified,
            active_policy_version: policy.version,
            candidate_account_scoped: candidate_sid.is_some(),
            last_verified_at: Some(policy.updated_at),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_navigation_status() {
        let status = NavigationManager::inspect_navigation_status(None);
        assert_eq!(status.active_policy_version, 1);
    }
}
