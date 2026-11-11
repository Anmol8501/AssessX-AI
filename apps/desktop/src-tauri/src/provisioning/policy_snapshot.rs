//! Persistent Registry Policy Baseline Snapshots (Stage 3 / AUD-03).
//!
//! Before AssessX modifies any Windows Registry policy DWORD, it snapshots the
//! pre-existing value (or records that the value did not exist) to disk under
//! `%APPDATA%\AssessX\policy_snapshots_v1.json`.
//!
//! Key guarantees:
//! - Re-applying a policy or recovering from an ungraceful crash never
//!   overwrites an already-captured pre-exam baseline.
//! - Restoration restores pre-existing institutional DWORD values instead of
//!   deleting them or hardcoding `0`.
//! - Values are deleted ONLY if AssessX originally created them (`owned_by_assessx = true`).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

static SNAPSHOT_STORE_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
static TEST_POLICY_MUTATION_LOCK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub fn test_registry_and_policy_lock() -> std::sync::MutexGuard<'static, ()> {
    TEST_POLICY_MUTATION_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySnapshotRecord {
    pub hive_scope: String,
    pub subkey: String,
    pub value_name: String,
    pub existed_before: bool,
    pub original_dword: Option<u32>,
    pub applied_value: u32,
    pub owned_by_assessx: bool,
    pub captured_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotRestoreAction {
    /// Restore the pre-existing DWORD that was present before AssessX modified it.
    RestoreDword(u32),
    /// Delete the value because AssessX created it (`!existed_before && owned_by_assessx`).
    DeleteOwnedValue,
    /// No AssessX snapshot exists (do not delete or overwrite external/admin policies).
    NoOpUntracked,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct SnapshotStore {
    #[serde(default = "default_schema_version")]
    schema_version: u32,
    #[serde(default)]
    records: BTreeMap<String, RegistrySnapshotRecord>,
}

fn default_schema_version() -> u32 {
    1
}

pub fn default_snapshot_path() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let mut dir = PathBuf::from(appdata);
        dir.push("AssessX");
        if fs::create_dir_all(&dir).is_ok() {
            let probe = dir.join(".write_probe");
            if fs::write(&probe, b"").is_ok() {
                let _ = fs::remove_file(&probe);
                dir.push("policy_snapshots_v1.json");
                return dir;
            }
        }
    }
    let mut fallback = std::env::temp_dir();
    fallback.push("AssessX");
    let _ = fs::create_dir_all(&fallback);
    fallback.push("policy_snapshots_v1.json");
    fallback
}

pub fn snapshot_key(hive_scope: &str, subkey: &str, value_name: &str) -> String {
    format!(
        "{}|{}|{}",
        hive_scope.to_ascii_uppercase(),
        subkey.to_ascii_lowercase(),
        value_name.to_ascii_lowercase()
    )
}

fn load_store_unlocked(path: &Path) -> SnapshotStore {
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(store) = serde_json::from_str::<SnapshotStore>(&content) {
            return store;
        }
    }
    SnapshotStore {
        schema_version: 1,
        records: BTreeMap::new(),
    }
}

fn write_store_unlocked(path: &Path, store: &SnapshotStore) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed creating snapshot dir: {}", e))?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let encoded = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed serializing snapshot store: {}", e))?;
    fs::write(&tmp_path, encoded).map_err(|e| format!("Failed writing snapshot tmp: {}", e))?;
    if let Err(e) = fs::rename(&tmp_path, path) {
        fs::copy(&tmp_path, path).map_err(|copy_err| {
            let _ = fs::remove_file(&tmp_path);
            format!("Failed committing snapshot file: {} / {}", e, copy_err)
        })?;
        let _ = fs::remove_file(&tmp_path);
    }
    Ok(())
}

/// Records the baseline state for `(hive_scope, subkey, value_name)` only if no active snapshot
/// exists yet, so crash restarts or repeated applies preserve the true pre-exam OS baseline.
pub fn capture_snapshot_if_absent_at(
    path: &Path,
    hive_scope: &str,
    subkey: &str,
    value_name: &str,
    original_dword: Option<u32>,
    applied_value: u32,
) -> Result<RegistrySnapshotRecord, String> {
    let _guard = SNAPSHOT_STORE_LOCK.lock().map_err(|_| "Snapshot lock poisoned".to_string())?;
    let mut store = load_store_unlocked(path);
    let key = snapshot_key(hive_scope, subkey, value_name);

    let record = if let Some(existing) = store.records.get_mut(&key) {
        existing.applied_value = applied_value;
        existing.clone()
    } else {
        let rec = RegistrySnapshotRecord {
            hive_scope: hive_scope.to_string(),
            subkey: subkey.to_string(),
            value_name: value_name.to_string(),
            existed_before: original_dword.is_some(),
            original_dword,
            applied_value,
            owned_by_assessx: original_dword.is_none(),
            captured_at: super::chrono_or_fallback_timestamp(),
        };
        store.records.insert(key, rec.clone());
        rec
    };

    write_store_unlocked(path, &store)?;
    Ok(record)
}

pub fn capture_snapshot_if_absent(
    hive_scope: &str,
    subkey: &str,
    value_name: &str,
    original_dword: Option<u32>,
    applied_value: u32,
) -> Result<RegistrySnapshotRecord, String> {
    capture_snapshot_if_absent_at(
        &default_snapshot_path(),
        hive_scope,
        subkey,
        value_name,
        original_dword,
        applied_value,
    )
}

pub fn resolve_restore_action_at(
    path: &Path,
    hive_scope: &str,
    subkey: &str,
    value_name: &str,
) -> Result<SnapshotRestoreAction, String> {
    let _guard = SNAPSHOT_STORE_LOCK.lock().map_err(|_| "Snapshot lock poisoned".to_string())?;
    let store = load_store_unlocked(path);
    let key = snapshot_key(hive_scope, subkey, value_name);

    match store.records.get(&key) {
        Some(rec) => {
            if rec.existed_before {
                Ok(SnapshotRestoreAction::RestoreDword(
                    rec.original_dword.unwrap_or(0),
                ))
            } else if rec.owned_by_assessx {
                Ok(SnapshotRestoreAction::DeleteOwnedValue)
            } else {
                Ok(SnapshotRestoreAction::NoOpUntracked)
            }
        }
        None => Ok(SnapshotRestoreAction::NoOpUntracked),
    }
}

pub fn resolve_restore_action(
    hive_scope: &str,
    subkey: &str,
    value_name: &str,
) -> Result<SnapshotRestoreAction, String> {
    resolve_restore_action_at(&default_snapshot_path(), hive_scope, subkey, value_name)
}

pub fn commit_snapshot_restored_at(
    path: &Path,
    hive_scope: &str,
    subkey: &str,
    value_name: &str,
) -> Result<(), String> {
    let _guard = SNAPSHOT_STORE_LOCK.lock().map_err(|_| "Snapshot lock poisoned".to_string())?;
    let mut store = load_store_unlocked(path);
    let key = snapshot_key(hive_scope, subkey, value_name);
    if store.records.remove(&key).is_some() {
        write_store_unlocked(path, &store)?;
    }
    Ok(())
}

pub fn commit_snapshot_restored(
    hive_scope: &str,
    subkey: &str,
    value_name: &str,
) -> Result<(), String> {
    commit_snapshot_restored_at(&default_snapshot_path(), hive_scope, subkey, value_name)
}

/// Shared Win32 DWORD registry restoration helper driven exclusively by `policy_snapshot`.
/// Never deletes external policies without an active AssessX snapshot.
#[cfg(windows)]
pub fn restore_registry_dword_safely(
    hive_scope: &str,
    root_key: windows_sys::Win32::System::Registry::HKEY,
    effective_subkey: &str,
    value_name: &str,
) -> Result<(), String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY,
        KEY_ALL_ACCESS, KEY_SET_VALUE, REG_DWORD, REG_OPTION_NON_VOLATILE,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let action = resolve_restore_action(hive_scope, effective_subkey, value_name)?;
    match action {
        SnapshotRestoreAction::NoOpUntracked => return Ok(()),
        SnapshotRestoreAction::DeleteOwnedValue => unsafe {
            let mut hkey: HKEY = std::mem::zeroed();
            let subkey_w = wide(effective_subkey);
            let open_rc = RegOpenKeyExW(root_key, subkey_w.as_ptr(), 0, KEY_SET_VALUE, &mut hkey);
            if open_rc == ERROR_SUCCESS {
                let value_name_w = wide(value_name);
                let del_rc = RegDeleteValueW(hkey, value_name_w.as_ptr());
                RegCloseKey(hkey);
                // ERROR_FILE_NOT_FOUND (2) is fine — value is already absent.
                if del_rc != ERROR_SUCCESS && del_rc != 2 {
                    return Err(format!(
                        "Failed deleting AssessX registry value {}\\{} (Win32 error: {})",
                        effective_subkey, value_name, del_rc
                    ));
                }
            }
        },
        SnapshotRestoreAction::RestoreDword(original_val) => unsafe {
            let mut hkey: HKEY = std::mem::zeroed();
            let mut disposition: u32 = 0;
            let subkey_w = wide(effective_subkey);
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
                return Err(format!(
                    "Failed opening registry key {} to restore {} (Win32 error: {})",
                    effective_subkey, value_name, rc
                ));
            }
            let value_name_w = wide(value_name);
            let set_rc = RegSetValueExW(
                hkey,
                value_name_w.as_ptr(),
                0,
                REG_DWORD,
                &original_val as *const u32 as *const _,
                std::mem::size_of::<u32>() as u32,
            );
            RegCloseKey(hkey);
            if set_rc != ERROR_SUCCESS {
                return Err(format!(
                    "Failed restoring DWORD {} on {}\\{} (Win32 error: {})",
                    original_val, effective_subkey, value_name, set_rc
                ));
            }
        },
    }

    commit_snapshot_restored(hive_scope, effective_subkey, value_name)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_snapshot_file(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("assessx_snapshot_test_{}_{}.json", name, std::process::id()));
        let _ = fs::remove_file(&p);
        p
    }

    #[test]
    fn test_snapshot_preserves_existing_baseline_across_reapply() {
        let path = temp_snapshot_file("reapply");

        // Pre-existing institutional setting had Deny_All = 1
        let rec1 = capture_snapshot_if_absent_at(
            &path,
            "HKCU",
            "Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices",
            "Deny_All",
            Some(1),
            1,
        )
        .unwrap();
        assert!(rec1.existed_before);
        assert_eq!(rec1.original_dword, Some(1));
        assert!(!rec1.owned_by_assessx);

        // Simulate crash + second apply reading current OS value as None/changed: must NOT clobber original!
        let rec2 = capture_snapshot_if_absent_at(
            &path,
            "HKCU",
            "Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices",
            "Deny_All",
            None,
            0,
        )
        .unwrap();
        assert!(rec2.existed_before);
        assert_eq!(rec2.original_dword, Some(1));
        assert_eq!(rec2.applied_value, 0);

        let action = resolve_restore_action_at(
            &path,
            "HKCU",
            "Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices",
            "Deny_All",
        )
        .unwrap();
        assert_eq!(action, SnapshotRestoreAction::RestoreDword(1));

        commit_snapshot_restored_at(
            &path,
            "HKCU",
            "Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices",
            "Deny_All",
        )
        .unwrap();
        let after = resolve_restore_action_at(
            &path,
            "HKCU",
            "Software\\Policies\\Microsoft\\Windows\\RemovableStorageDevices",
            "Deny_All",
        )
        .unwrap();
        assert_eq!(after, SnapshotRestoreAction::NoOpUntracked);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_snapshot_deletes_only_assessx_owned_entries() {
        let path = temp_snapshot_file("owned");

        let rec = capture_snapshot_if_absent_at(
            &path,
            "HKCU",
            "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer",
            "NoWinKeys",
            None,
            1,
        )
        .unwrap();
        assert!(!rec.existed_before);
        assert!(rec.owned_by_assessx);

        let action = resolve_restore_action_at(
            &path,
            "HKCU",
            "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer",
            "NoWinKeys",
        )
        .unwrap();
        assert_eq!(action, SnapshotRestoreAction::DeleteOwnedValue);

        // Untracked value should always be NoOp
        let untracked = resolve_restore_action_at(
            &path,
            "HKCU",
            "Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer",
            "NoRun",
        )
        .unwrap();
        assert_eq!(untracked, SnapshotRestoreAction::NoOpUntracked);
        let _ = fs::remove_file(&path);
    }
}
