//! Windows Native Registry Policy Engine and Candidate Account Scoping (Phase 2B).
//!
//! Provides account-scoped registry policy inspection, application, verification,
//! and rollback for Windows Task Manager, Command Prompt, Registry Tools, and PowerShell.

use crate::provisioning::journal::record_planned_change;
use crate::security_agent::logger::{log_info, log_warn};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RegistryPolicyTarget {
    DisableTaskMgr,
    DisableCmd,
    DisableRegistryTools,
    PowerShellLockdown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPolicyState {
    pub target: RegistryPolicyTarget,
    pub subkey: String,
    pub value_name: String,
    pub is_enabled: bool,
    pub current_raw_value: Option<u32>,
    pub candidate_account: Option<String>,
    pub candidate_sid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPolicyChangePreview {
    pub target: RegistryPolicyTarget,
    pub subkey: String,
    pub value_name: String,
    pub current_value: Option<u32>,
    pub proposed_value: u32,
    pub target_scope: String,
    pub is_reversible: bool,
}

// Stores previously active values for automatic rollback
static BACKUP_REGISTRY_STATE: Mutex<Option<Vec<RegistryPolicyState>>> = Mutex::new(None);

pub struct RegistryPolicyEngine;

impl RegistryPolicyEngine {
    /// Return the canonical registry subkey and value name for a given policy target.
    pub fn get_key_definition(target: RegistryPolicyTarget) -> (&'static str, &'static str) {
        match target {
            RegistryPolicyTarget::DisableTaskMgr => (
                "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
                "DisableTaskMgr",
            ),
            RegistryPolicyTarget::DisableCmd => (
                "Software\\Policies\\Microsoft\\Windows\\System",
                "DisableCMD",
            ),
            RegistryPolicyTarget::DisableRegistryTools => (
                "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System",
                "DisableRegistryTools",
            ),
            RegistryPolicyTarget::PowerShellLockdown => (
                "Software\\Policies\\Microsoft\\Windows\\PowerShell",
                "EnableScripts",
            ),
        }
    }

    /// Read the current registry policy state.
    #[cfg(windows)]
    pub fn read_policy(target: RegistryPolicyTarget, candidate_sid: Option<&str>) -> RegistryPolicyState {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, HKEY_USERS,
            KEY_READ, REG_DWORD,
        };

        let (base_subkey, value_name) = Self::get_key_definition(target);

        let (root_key, effective_subkey): (HKEY, String) = if let Some(sid) = candidate_sid {
            (HKEY_USERS, format!("{}\\{}", sid, base_subkey))
        } else {
            (HKEY_CURRENT_USER, base_subkey.to_string())
        };

        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        let mut current_val = None;
        let mut is_active = false;

        unsafe {
            let mut hkey: HKEY = std::mem::zeroed();
            let subkey_w = wide(&effective_subkey);
            if RegOpenKeyExW(root_key, subkey_w.as_ptr(), 0, KEY_READ, &mut hkey) == ERROR_SUCCESS {
                let value_name_w = wide(value_name);
                let mut val: u32 = 0;
                let mut val_type: u32 = 0;
                let mut val_size: u32 = std::mem::size_of::<u32>() as u32;

                if RegQueryValueExW(
                    hkey,
                    value_name_w.as_ptr(),
                    std::ptr::null_mut(),
                    &mut val_type,
                    &mut val as *mut u32 as *mut _,
                    &mut val_size,
                ) == ERROR_SUCCESS && val_type == REG_DWORD {
                    current_val = Some(val);
                    is_active = val > 0;
                }
                RegCloseKey(hkey);
            }
        }

        RegistryPolicyState {
            target,
            subkey: effective_subkey,
            value_name: value_name.to_string(),
            is_enabled: is_active,
            current_raw_value: current_val,
            candidate_account: None,
            candidate_sid: candidate_sid.map(|s| s.to_string()),
        }
    }

    #[cfg(not(windows))]
    pub fn read_policy(target: RegistryPolicyTarget, candidate_sid: Option<&str>) -> RegistryPolicyState {
        let (base_subkey, value_name) = Self::get_key_definition(target);
        RegistryPolicyState {
            target,
            subkey: base_subkey.to_string(),
            value_name: value_name.to_string(),
            is_enabled: false,
            current_raw_value: None,
            candidate_account: None,
            candidate_sid: candidate_sid.map(|s| s.to_string()),
        }
    }

    /// Preview what registry policy changes will be made.
    pub fn preview_change(
        target: RegistryPolicyTarget,
        proposed_value: u32,
        candidate_sid: Option<&str>,
    ) -> RegistryPolicyChangePreview {
        let current = Self::read_policy(target, candidate_sid);
        let scope = if let Some(sid) = candidate_sid {
            format!("Candidate User Account (SID: {})", sid)
        } else {
            "Current User Session".to_string()
        };

        RegistryPolicyChangePreview {
            target,
            subkey: current.subkey,
            value_name: current.value_name,
            current_value: current.current_raw_value,
            proposed_value,
            target_scope: scope,
            is_reversible: true,
        }
    }

    /// Apply a registry policy change and verify the new value.
    #[cfg(windows)]
    pub fn apply_and_verify(
        target: RegistryPolicyTarget,
        value: u32,
        candidate_sid: Option<&str>,
    ) -> Result<RegistryPolicyState, String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_USERS,
            KEY_ALL_ACCESS, REG_DWORD, REG_OPTION_NON_VOLATILE,
        };

        // Snapshot baseline on disk (preserves pre-existing value across crash/re-apply)
        let current = Self::read_policy(target, candidate_sid);
        {
            let mut backup_guard = BACKUP_REGISTRY_STATE.lock().unwrap();
            let backups = backup_guard.get_or_insert_with(Vec::new);
            backups.push(current.clone());
        }

        let (base_subkey, value_name) = Self::get_key_definition(target);

        let (root_key, effective_subkey): (HKEY, String) = if let Some(sid) = candidate_sid {
            (HKEY_USERS, format!("{}\\{}", sid, base_subkey))
        } else {
            (HKEY_CURRENT_USER, base_subkey.to_string())
        };
        let hive_scope = candidate_sid
            .map(|s| format!("HKU\\{}", s))
            .unwrap_or_else(|| "HKCU".to_string());

        crate::provisioning::policy_snapshot::capture_snapshot_if_absent(
            &hive_scope,
            &effective_subkey,
            value_name,
            current.current_raw_value,
            value,
        )?;

        // Record in Phase 1A Change Journal
        record_planned_change(
            &format!("Apply Registry Policy: {}", value_name),
            &format!("{}\\{}", effective_subkey, value_name),
            &format!("{:?}", current.current_raw_value),
            &format!("{}", value),
            Some(format!("Remove or restore {}\\{}", effective_subkey, value_name)),
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
                let err = format!("Failed to open/create registry key {} (Win32 error: {})", effective_subkey, rc);
                log_warn("RegistryPolicy", &err);
                return Err(err);
            }

            let value_name_w = wide(value_name);
            let set_rc = RegSetValueExW(
                hkey,
                value_name_w.as_ptr(),
                0,
                REG_DWORD,
                &value as *const u32 as *const _,
                std::mem::size_of::<u32>() as u32,
            );
            RegCloseKey(hkey);

            if set_rc != ERROR_SUCCESS {
                let err = format!("Failed to write DWORD {} to {} (Win32 error: {})", value, value_name, set_rc);
                log_warn("RegistryPolicy", &err);
                return Err(err);
            }
        }

        // Post-application verification read
        let verified = Self::read_policy(target, candidate_sid);
        if verified.current_raw_value != Some(value) {
            let err = format!(
                "Policy verification failed for {}: expected {}, found {:?}",
                value_name, value, verified.current_raw_value
            );
            log_warn("RegistryPolicy", &err);
            return Err(err);
        }

        log_info("RegistryPolicy", &format!("Successfully applied and verified registry policy {} = {}", value_name, value));
        Ok(verified)
    }

    #[cfg(not(windows))]
    pub fn apply_and_verify(
        target: RegistryPolicyTarget,
        value: u32,
        candidate_sid: Option<&str>,
    ) -> Result<RegistryPolicyState, String> {
        let (base_subkey, value_name) = Self::get_key_definition(target);
        Ok(RegistryPolicyState {
            target,
            subkey: base_subkey.to_string(),
            value_name: value_name.to_string(),
            is_enabled: value > 0,
            current_raw_value: Some(value),
            candidate_account: None,
            candidate_sid: candidate_sid.map(|s| s.to_string()),
        })
    }

    /// Safely restore an applied registry policy value from persistent disk snapshot.
    /// Restores pre-existing institutional DWORD values; deletes only keys created by AssessX.
    #[cfg(windows)]
    pub fn remove_policy(target: RegistryPolicyTarget, candidate_sid: Option<&str>) -> Result<(), String> {
        use windows_sys::Win32::System::Registry::{HKEY, HKEY_CURRENT_USER, HKEY_USERS};

        let (base_subkey, value_name) = Self::get_key_definition(target);

        let (root_key, effective_subkey): (HKEY, String) = if let Some(sid) = candidate_sid {
            (HKEY_USERS, format!("{}\\{}", sid, base_subkey))
        } else {
            (HKEY_CURRENT_USER, base_subkey.to_string())
        };
        let hive_scope = candidate_sid
            .map(|s| format!("HKU\\{}", s))
            .unwrap_or_else(|| "HKCU".to_string());

        crate::provisioning::policy_snapshot::restore_registry_dword_safely(
            &hive_scope,
            root_key,
            &effective_subkey,
            value_name,
        )?;

        log_info("RegistryPolicy", &format!("Safely restored registry policy for {}", value_name));
        Ok(())
    }

    #[cfg(not(windows))]
    pub fn remove_policy(_target: RegistryPolicyTarget, _candidate_sid: Option<&str>) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_key_definitions() {
        let (k1, v1) = RegistryPolicyEngine::get_key_definition(RegistryPolicyTarget::DisableTaskMgr);
        assert_eq!(v1, "DisableTaskMgr");
        assert!(k1.contains("Policies\\System"));

        let (k2, v2) = RegistryPolicyEngine::get_key_definition(RegistryPolicyTarget::DisableCmd);
        assert_eq!(v2, "DisableCMD");
        assert!(k2.contains("Policies\\Microsoft\\Windows\\System"));
    }

    #[test]
    fn test_preview_generation() {
        let preview = RegistryPolicyEngine::preview_change(
            RegistryPolicyTarget::DisableTaskMgr,
            1,
            Some("S-1-5-21-12345-6789"),
        );
        assert_eq!(preview.proposed_value, 1);
        assert!(preview.target_scope.contains("S-1-5-21-12345-6789"));
        assert_eq!(preview.value_name, "DisableTaskMgr");
        assert!(preview.is_reversible);
    }

    #[test]
    fn test_read_policy_safe() {
        let state = RegistryPolicyEngine::read_policy(RegistryPolicyTarget::DisableCmd, None);
        assert_eq!(state.value_name, "DisableCMD");
    }
}
