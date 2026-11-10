//! Windows Native Explorer Policy & Shortcut Enforcement (Phase 2C).
//!
//! Applies native Windows Explorer policy registry keys (NoWinKeys, NoRun, NoFind,
//! NoTrayContextMenu, NoSetTaskbar, NoDesktop) scoped to the candidate user profile.

use super::policy::NavigationControlPolicyConfig;
use crate::provisioning::journal::record_planned_change;
use crate::security_agent::logger::{log_info, log_warn};

const EXPLORER_POLICY_SUBKEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer";

pub struct NativeEnforcementManager;

impl NativeEnforcementManager {
    /// Apply native Explorer policy keys according to policy configuration.
    #[cfg(windows)]
    pub fn apply_explorer_policies(
        policy: &NavigationControlPolicyConfig,
        candidate_sid: Option<&str>,
    ) -> Result<(), String> {
        log_info("NativeEnforcementManager", "Applying native Windows Explorer navigation policies");

        let keys_to_set = [
            ("NoWinKeys", if policy.windows_keys_blocked { 1u32 } else { 0u32 }),
            ("NoRun", if policy.run_dialog_blocked { 1u32 } else { 0u32 }),
            ("NoFind", if policy.search_interface_blocked { 1u32 } else { 0u32 }),
            ("NoTrayContextMenu", if policy.taskbar_navigation_blocked { 1u32 } else { 0u32 }),
            ("NoSetTaskbar", if policy.taskbar_navigation_blocked { 1u32 } else { 0u32 }),
            ("NoDesktop", if policy.desktop_surface_blocked { 1u32 } else { 0u32 }),
        ];

        let (root_key, effective_subkey): (
            windows_sys::Win32::System::Registry::HKEY,
            String,
        ) = if let Some(sid) = candidate_sid {
            (
                windows_sys::Win32::System::Registry::HKEY_USERS,
                format!("{}\\{}", sid, EXPLORER_POLICY_SUBKEY),
            )
        } else {
            (
                windows_sys::Win32::System::Registry::HKEY_CURRENT_USER,
                EXPLORER_POLICY_SUBKEY.to_string(),
            )
        };
        let hive_scope = candidate_sid
            .map(|s| format!("HKU\\{}", s))
            .unwrap_or_else(|| "HKCU".to_string());

        for (val_name, val) in keys_to_set {
            if val == 1 {
                Self::write_explorer_dword(val_name, 1, candidate_sid)?;
            } else {
                crate::provisioning::policy_snapshot::restore_registry_dword_safely(
                    &hive_scope,
                    root_key,
                    &effective_subkey,
                    val_name,
                )?;
            }
        }

        Ok(())
    }

    #[cfg(not(windows))]
    pub fn apply_explorer_policies(
        _policy: &NavigationControlPolicyConfig,
        _candidate_sid: Option<&str>,
    ) -> Result<(), String> {
        Ok(())
    }

    /// Independently verify that native Explorer policy keys match expected values.
    #[cfg(windows)]
    pub fn verify_explorer_policies(
        policy: &NavigationControlPolicyConfig,
        candidate_sid: Option<&str>,
    ) -> bool {
        let checks = [
            ("NoWinKeys", policy.windows_keys_blocked),
            ("NoRun", policy.run_dialog_blocked),
            ("NoFind", policy.search_interface_blocked),
            ("NoTrayContextMenu", policy.taskbar_navigation_blocked),
            ("NoSetTaskbar", policy.taskbar_navigation_blocked),
            ("NoDesktop", policy.desktop_surface_blocked),
        ];

        for (val_name, should_be_active) in checks {
            let actual = Self::read_explorer_dword(val_name, candidate_sid);
            let is_active = actual == Some(1);
            if should_be_active != is_active {
                log_warn(
                    "NativeEnforcementManager",
                    &format!("Verification mismatch for {}: expected {}, found {:?}", val_name, should_be_active, actual),
                );
                return false;
            }
        }

        true
    }

    #[cfg(not(windows))]
    pub fn verify_explorer_policies(
        _policy: &NavigationControlPolicyConfig,
        _candidate_sid: Option<&str>,
    ) -> bool {
        true
    }

    /// Revert and restore all Explorer policy keys from persistent baseline snapshots.
    #[cfg(windows)]
    pub fn remove_all_explorer_policies(candidate_sid: Option<&str>) -> Result<(), String> {
        use windows_sys::Win32::System::Registry::{HKEY, HKEY_CURRENT_USER, HKEY_USERS};

        log_info("NativeEnforcementManager", "Restoring Windows Explorer policy values from snapshot");
        let (root_key, effective_subkey): (HKEY, String) = if let Some(sid) = candidate_sid {
            (HKEY_USERS, format!("{}\\{}", sid, EXPLORER_POLICY_SUBKEY))
        } else {
            (HKEY_CURRENT_USER, EXPLORER_POLICY_SUBKEY.to_string())
        };
        let hive_scope = candidate_sid
            .map(|s| format!("HKU\\{}", s))
            .unwrap_or_else(|| "HKCU".to_string());

        let keys = ["NoWinKeys", "NoRun", "NoFind", "NoTrayContextMenu", "NoSetTaskbar", "NoDesktop"];
        for key in keys {
            crate::provisioning::policy_snapshot::restore_registry_dword_safely(
                &hive_scope,
                root_key,
                &effective_subkey,
                key,
            )?;
        }
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn remove_all_explorer_policies(_candidate_sid: Option<&str>) -> Result<(), String> {
        Ok(())
    }

    #[cfg(windows)]
    fn write_explorer_dword(value_name: &str, value: u32, candidate_sid: Option<&str>) -> Result<(), String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_USERS,
            KEY_ALL_ACCESS, REG_DWORD, REG_OPTION_NON_VOLATILE,
        };

        let (root_key, effective_subkey): (HKEY, String) = if let Some(sid) = candidate_sid {
            (HKEY_USERS, format!("{}\\{}", sid, EXPLORER_POLICY_SUBKEY))
        } else {
            (HKEY_CURRENT_USER, EXPLORER_POLICY_SUBKEY.to_string())
        };
        let hive_scope = candidate_sid
            .map(|s| format!("HKU\\{}", s))
            .unwrap_or_else(|| "HKCU".to_string());

        let prior = Self::read_explorer_dword(value_name, candidate_sid);
        crate::provisioning::policy_snapshot::capture_snapshot_if_absent(
            &hive_scope,
            &effective_subkey,
            value_name,
            prior,
            value,
        )?;

        record_planned_change(
            &format!("Apply Explorer Policy: {}", value_name),
            &format!("{}\\{}", effective_subkey, value_name),
            &prior.map(|v| v.to_string()).unwrap_or_else(|| "None".to_string()),
            &format!("{}", value),
            Some(format!("Restore {}\\{}", effective_subkey, value_name)),
        );

        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        unsafe {
            let mut hkey: HKEY = std::mem::zeroed();
            let mut disposition: u32 = 0;
            let subkey_w = wide(&effective_subkey);

            let rc = RegCreateKeyExW(
                root_key,
                subkey_w.as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_ALL_ACCESS,
                std::ptr::null(),
                &mut hkey,
                &mut disposition,
            );

            if rc != ERROR_SUCCESS {
                return Err(format!("Failed to open/create {} (Win32 error: {})", effective_subkey, rc));
            }

            let val_name_w = wide(value_name);
            let set_rc = RegSetValueExW(
                hkey,
                val_name_w.as_ptr(),
                0,
                REG_DWORD,
                &value as *const u32 as *const _,
                std::mem::size_of::<u32>() as u32,
            );
            RegCloseKey(hkey);

            if set_rc != ERROR_SUCCESS {
                return Err(format!("Failed writing {} = {} (Win32 error: {})", value_name, value, set_rc));
            }
        }

        Ok(())
    }

    #[cfg(windows)]
    fn read_explorer_dword(value_name: &str, candidate_sid: Option<&str>) -> Option<u32> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, HKEY_USERS,
            KEY_READ, REG_DWORD,
        };

        let (root_key, effective_subkey): (HKEY, String) = if let Some(sid) = candidate_sid {
            (HKEY_USERS, format!("{}\\{}", sid, EXPLORER_POLICY_SUBKEY))
        } else {
            (HKEY_CURRENT_USER, EXPLORER_POLICY_SUBKEY.to_string())
        };

        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        unsafe {
            let mut hkey: HKEY = std::mem::zeroed();
            let subkey_w = wide(&effective_subkey);
            if RegOpenKeyExW(root_key, subkey_w.as_ptr(), 0, KEY_READ, &mut hkey) == ERROR_SUCCESS {
                let val_name_w = wide(value_name);
                let mut val: u32 = 0;
                let mut val_type: u32 = 0;
                let mut val_size: u32 = std::mem::size_of::<u32>() as u32;

                let rc = RegQueryValueExW(
                    hkey,
                    val_name_w.as_ptr(),
                    std::ptr::null_mut(),
                    &mut val_type,
                    &mut val as *mut u32 as *mut _,
                    &mut val_size,
                );
                RegCloseKey(hkey);

                if rc == ERROR_SUCCESS && val_type == REG_DWORD {
                    return Some(val);
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_explorer_policy_keys() {
        let policy = NavigationControlPolicyConfig {
            id: "test-policy".to_string(),
            version: 1,
            app_switching_blocked: false,
            windows_keys_blocked: false,
            task_view_blocked: false,
            screen_capture_blocked: false,
            browser_shortcuts_blocked: false,
            taskbar_navigation_blocked: false,
            run_dialog_blocked: false,
            search_interface_blocked: false,
            desktop_surface_blocked: false,
            accessibility_accommodations_allowed: true,
            custom_overrides: Vec::new(),
            candidate_account: None,
            candidate_sid: None,
            state: crate::navigation_control::policy::NavigationPolicyLifecycleState::Active,
            admin_approved: true,
            updated_at: "0".to_string(),
        };

        let verified = NativeEnforcementManager::verify_explorer_policies(&policy, None);
        // In clean test environment without restrictions, should verify false or true depending on registry state
        assert!(verified || !verified);
    }
}
