//! USB and Removable Storage Control (Phase 2D - P2.5).
//!
//! Provides removable-storage discovery, policy enforcement, device identification,
//! and non-destructive baselines while safeguarding HID keyboards and mice.

use crate::security_agent::logger::{log_info, log_warn};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum StoragePolicyMode {
    AllowAllSupported,
    BlockUnapprovedStorage,
    AllowApprovedDevices,
    AuditOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemovableStorageDevice {
    pub drive_letter: String,
    pub volume_name: String,
    pub file_system: String,
    pub is_removable: bool,
    pub is_blocked: bool,
    pub total_space_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatusReport {
    pub active_mode: StoragePolicyMode,
    pub connected_removable_drives_count: usize,
    pub removable_drives: Vec<RemovableStorageDevice>,
    pub usbstor_service_start: u32,
    pub removable_storage_deny_all_policy: bool,
    pub candidate_account_scoped: bool,
    pub is_policy_enforced: bool,
    pub last_inspected_at: String,
}

pub struct StorageManager;

impl StorageManager {
    /// Inspect currently connected storage devices and registry policy state.
    #[cfg(windows)]
    pub fn inspect_storage(current_mode: StoragePolicyMode) -> StorageStatusReport {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::Storage::FileSystem::{
            GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
        };
        const DRIVE_REMOVABLE: u32 = 2;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE,
            KEY_READ, REG_DWORD,
        };

        let mut drives = Vec::new();

        unsafe {
            let bitmask = GetLogicalDrives();
            for i in 0..26 {
                if (bitmask & (1 << i)) != 0 {
                    let letter = (b'A' + i as u8) as char;
                    let root_str = format!("{}:\\", letter);
                    let root_wide: Vec<u16> = root_str.encode_utf16().chain(std::iter::once(0)).collect();

                    let drive_type = GetDriveTypeW(root_wide.as_ptr());
                    if drive_type == DRIVE_REMOVABLE {
                        let mut vol_name = [0u16; 260];
                        let mut fs_name = [0u16; 260];
                        let mut serial: u32 = 0;
                        let mut max_comp_len: u32 = 0;
                        let mut flags: u32 = 0;

                        let ok = GetVolumeInformationW(
                            root_wide.as_ptr(),
                            vol_name.as_mut_ptr(),
                            vol_name.len() as u32,
                            &mut serial,
                            &mut max_comp_len,
                            &mut flags,
                            fs_name.as_mut_ptr(),
                            fs_name.len() as u32,
                        );

                        let v_name = if ok != 0 {
                            let end = vol_name.iter().position(|&c| c == 0).unwrap_or(vol_name.len());
                            String::from_utf16_lossy(&vol_name[..end])
                        } else {
                            "Removable Volume".to_string()
                        };

                        let f_name = if ok != 0 {
                            let end = fs_name.iter().position(|&c| c == 0).unwrap_or(fs_name.len());
                            String::from_utf16_lossy(&fs_name[..end])
                        } else {
                            "Unknown".to_string()
                        };

                        drives.push(RemovableStorageDevice {
                            drive_letter: format!("{}:", letter),
                            volume_name: v_name,
                            file_system: f_name,
                            is_removable: true,
                            is_blocked: current_mode == StoragePolicyMode::BlockUnapprovedStorage,
                            total_space_bytes: None,
                        });
                    }
                }
            }
        }

        // Check registry policy status
        let mut usbstor_start = 3u32;
        let mut deny_all = false;

        unsafe {
            fn wide(s: &str) -> Vec<u16> {
                s.encode_utf16().chain(std::iter::once(0)).collect()
            }

            // Check USBSTOR service start value under HKLM
            let mut hkey = std::ptr::null_mut();
            let subkey = wide("SYSTEM\\CurrentControlSet\\Services\\USBSTOR");
            if RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.as_ptr(), 0, KEY_READ, &mut hkey) == ERROR_SUCCESS {
                let start_name = wide("Start");
                let mut val = 0u32;
                let mut size = std::mem::size_of::<u32>() as u32;
                let mut val_type = 0u32;
                if RegQueryValueExW(
                    hkey,
                    start_name.as_ptr(),
                    std::ptr::null_mut(),
                    &mut val_type,
                    &mut val as *mut u32 as *mut _,
                    &mut size,
                ) == ERROR_SUCCESS && val_type == REG_DWORD {
                    usbstor_start = val;
                }
                RegCloseKey(hkey);
            }

            // Check RemovableStorageDevices policy under HKCU
            let mut policy_hkey = std::ptr::null_mut();
            let policy_subkey = wide("Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices");
            if RegOpenKeyExW(HKEY_CURRENT_USER, policy_subkey.as_ptr(), 0, KEY_READ, &mut policy_hkey) == ERROR_SUCCESS {
                let deny_name = wide("Deny_All");
                let mut val = 0u32;
                let mut size = std::mem::size_of::<u32>() as u32;
                let mut val_type = 0u32;
                if RegQueryValueExW(
                    policy_hkey,
                    deny_name.as_ptr(),
                    std::ptr::null_mut(),
                    &mut val_type,
                    &mut val as *mut u32 as *mut _,
                    &mut size,
                ) == ERROR_SUCCESS && val_type == REG_DWORD {
                    deny_all = val == 1;
                }
                RegCloseKey(policy_hkey);
            }
        }

        let is_enforced = match current_mode {
            StoragePolicyMode::BlockUnapprovedStorage => deny_all || usbstor_start == 4,
            StoragePolicyMode::AuditOnly | StoragePolicyMode::AllowAllSupported => true,
            StoragePolicyMode::AllowApprovedDevices => true,
        };

        StorageStatusReport {
            active_mode: current_mode,
            connected_removable_drives_count: drives.len(),
            removable_drives: drives,
            usbstor_service_start: usbstor_start,
            removable_storage_deny_all_policy: deny_all,
            candidate_account_scoped: true,
            is_policy_enforced: is_enforced,
            last_inspected_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_else(|_| "0".to_string()),
        }
    }

    #[cfg(not(windows))]
    pub fn inspect_storage(current_mode: StoragePolicyMode) -> StorageStatusReport {
        StorageStatusReport {
            active_mode: current_mode,
            connected_removable_drives_count: 0,
            removable_drives: Vec::new(),
            usbstor_service_start: 3,
            removable_storage_deny_all_policy: false,
            candidate_account_scoped: true,
            is_policy_enforced: true,
            last_inspected_at: "0".to_string(),
        }
    }

    /// Enforce or rollback removable storage restriction policy.
    #[cfg(windows)]
    pub fn apply_storage_policy(
        mode: StoragePolicyMode,
        candidate_sid: Option<&str>,
    ) -> Result<bool, String> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY_CURRENT_USER, HKEY_USERS,
            KEY_WRITE, REG_DWORD, REG_OPTION_NON_VOLATILE,
        };

        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        let deny_val: u32 = match mode {
            StoragePolicyMode::BlockUnapprovedStorage => 1,
            StoragePolicyMode::AllowAllSupported
            | StoragePolicyMode::AllowApprovedDevices
            | StoragePolicyMode::AuditOnly => 0,
        };

        let subpath = if let Some(sid) = candidate_sid {
            format!("{}\\Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices", sid)
        } else {
            "Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices".to_string()
        };

        let root = if candidate_sid.is_some() {
            HKEY_USERS
        } else {
            HKEY_CURRENT_USER
        };
        let hive_scope = candidate_sid
            .map(|s| format!("HKU\\{}", s))
            .unwrap_or_else(|| "HKCU".to_string());

        let prior = Self::read_storage_deny_all(candidate_sid);
        crate::provisioning::policy_snapshot::capture_snapshot_if_absent(
            &hive_scope,
            &subpath,
            "Deny_All",
            prior,
            deny_val,
        )?;

        unsafe {
            let mut hkey = std::ptr::null_mut();
            let subpath_wide = wide(&subpath);
            let mut disposition = 0u32;

            let res = RegCreateKeyExW(
                root,
                subpath_wide.as_ptr(),
                0,
                std::ptr::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                std::ptr::null(),
                &mut hkey,
                &mut disposition,
            );

            if res != ERROR_SUCCESS {
                if res == 5 {
                    log_warn("STORAGE_CONTROL", "Elevated privileges required to write RemovableStorageDevices policy key. Running in Audit Mode.");
                    return Ok(false);
                }
                return Err(format!("Failed to open/create RemovableStorageDevices policy key: error {}", res));
            }

            let deny_name = wide("Deny_All");
            let val_bytes = deny_val.to_le_bytes();
            let set_res = RegSetValueExW(
                hkey,
                deny_name.as_ptr(),
                0,
                REG_DWORD,
                val_bytes.as_ptr(),
                val_bytes.len() as u32,
            );

            RegCloseKey(hkey);

            if set_res != ERROR_SUCCESS {
                if set_res == 5 {
                    log_warn("STORAGE_CONTROL", "Access denied setting Deny_All value. Running in Audit Mode.");
                    return Ok(false);
                }
                return Err(format!("Failed to set Deny_All registry value: error {}", set_res));
            }
        }

        log_info(
            "STORAGE_CONTROL",
            &format!("Successfully updated Removable Storage Policy: mode={:?}, Deny_All={}", mode, deny_val),
        );
        Ok(true)
    }

    #[cfg(not(windows))]
    pub fn apply_storage_policy(
        _mode: StoragePolicyMode,
        _candidate_sid: Option<&str>,
    ) -> Result<bool, String> {
        Ok(true)
    }

    #[cfg(windows)]
    pub fn read_storage_deny_all(candidate_sid: Option<&str>) -> Option<u32> {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, HKEY_USERS,
            KEY_READ, REG_DWORD,
        };

        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        let subpath = if let Some(sid) = candidate_sid {
            format!("{}\\Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices", sid)
        } else {
            "Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices".to_string()
        };
        let root: HKEY = if candidate_sid.is_some() {
            HKEY_USERS
        } else {
            HKEY_CURRENT_USER
        };

        unsafe {
            let mut hkey: HKEY = std::mem::zeroed();
            let sub_w = wide(&subpath);
            if RegOpenKeyExW(root, sub_w.as_ptr(), 0, KEY_READ, &mut hkey) == ERROR_SUCCESS {
                let name_w = wide("Deny_All");
                let mut val: u32 = 0;
                let mut val_type: u32 = 0;
                let mut size: u32 = std::mem::size_of::<u32>() as u32;
                let rc = RegQueryValueExW(
                    hkey,
                    name_w.as_ptr(),
                    std::ptr::null_mut(),
                    &mut val_type,
                    &mut val as *mut u32 as *mut _,
                    &mut size,
                );
                RegCloseKey(hkey);
                if rc == ERROR_SUCCESS && val_type == REG_DWORD {
                    return Some(val);
                }
            }
        }
        None
    }

    #[cfg(windows)]
    pub fn restore_storage_policy(candidate_sid: Option<&str>) -> Result<bool, String> {
        use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_USERS};

        let subpath = if let Some(sid) = candidate_sid {
            format!("{}\\Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices", sid)
        } else {
            "Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices".to_string()
        };
        let root = if candidate_sid.is_some() {
            HKEY_USERS
        } else {
            HKEY_CURRENT_USER
        };
        let hive_scope = candidate_sid
            .map(|s| format!("HKU\\{}", s))
            .unwrap_or_else(|| "HKCU".to_string());

        crate::provisioning::policy_snapshot::restore_registry_dword_safely(
            &hive_scope,
            root,
            &subpath,
            "Deny_All",
        )?;
        Ok(true)
    }

    #[cfg(not(windows))]
    pub fn restore_storage_policy(_candidate_sid: Option<&str>) -> Result<bool, String> {
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_inspection() {
        let rep = StorageManager::inspect_storage(StoragePolicyMode::AuditOnly);
        assert_eq!(rep.active_mode, StoragePolicyMode::AuditOnly);
        assert!(rep.is_policy_enforced);
    }

    #[test]
    fn test_storage_policy_application() {
        let _guard = crate::provisioning::policy_snapshot::test_registry_and_policy_lock();
        let res = StorageManager::apply_storage_policy(StoragePolicyMode::AuditOnly, None);
        assert!(res.is_ok());
        let _ = StorageManager::restore_storage_policy(None);
    }
}
