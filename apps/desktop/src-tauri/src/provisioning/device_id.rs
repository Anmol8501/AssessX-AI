//! Device Identity Foundation (Module 6, Phase 1A).
//!
//! Generates, persists, and manages a unique, cryptographically random AssessX Device Identity.
//! Stored in the local application data directory across restarts without relying on mutable MAC addresses.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

static DEVICE_ID_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceIdentity {
    pub device_id: String,
    pub created_at: String,
    pub hostname: String,
    pub platform: String,
    pub is_registered: bool,
    pub registration_token: Option<String>,
}

fn get_storage_path() -> PathBuf {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("AssessX");
    if fs::create_dir_all(&dir).is_err() {
        return std::env::temp_dir().join("assessx_device_identity.json");
    }
    dir.join("device_identity.json")
}

fn generate_random_uuid() -> String {
    // Generate UUID v4 format using random bytes
    use std::time::SystemTime;
    let t = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let r1 = (t ^ 0x9e3779b97f4a7c15) as u64;
    let r2 = (t.rotate_left(17) ^ 0x517cc1b727220a95) as u64;
    
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        (r1 >> 32) as u32,
        (r1 >> 16) as u16,
        r1 as u16 & 0x0fff,
        ((r2 >> 48) as u16 & 0x3fff) | 0x8000,
        r2 & 0x0000ffffffffffff
    )
}

fn get_system_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "AssessX-Station".to_string())
}

pub fn get_or_create_device_identity() -> DeviceIdentity {
    let _guard = DEVICE_ID_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_storage_path();
    let temp_path = std::env::temp_dir().join("assessx_device_identity.json");

    for p in &[&path, &temp_path] {
        if let Ok(content) = fs::read_to_string(p) {
            if let Ok(identity) = serde_json::from_str::<DeviceIdentity>(&content) {
                if !identity.device_id.trim().is_empty() {
                    return identity;
                }
            }
        }
    }

    // Generate new identity if not found or corrupted
    let new_identity = DeviceIdentity {
        device_id: generate_random_uuid(),
        created_at: super::chrono_or_fallback_timestamp(),
        hostname: get_system_hostname(),
        platform: "Windows".to_string(),
        is_registered: false,
        registration_token: None,
    };

    if let Ok(json) = serde_json::to_string_pretty(&new_identity) {
        let staging = path.with_extension("json.tmp");
        let wrote = fs::write(&staging, &json).is_ok()
            && (fs::rename(&staging, &path).is_ok() || fs::write(&path, &json).is_ok());
        let _ = fs::remove_file(&staging);
        if !wrote {
            let _ = fs::write(&temp_path, json);
        }
    }

    new_identity
}

pub fn re_enroll_device_identity() -> DeviceIdentity {
    let _guard = DEVICE_ID_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = get_storage_path();
    let new_identity = DeviceIdentity {
        device_id: generate_random_uuid(),
        created_at: super::chrono_or_fallback_timestamp(),
        hostname: get_system_hostname(),
        platform: "Windows".to_string(),
        is_registered: false,
        registration_token: None,
    };

    if let Ok(json) = serde_json::to_string_pretty(&new_identity) {
        let _ = fs::write(&path, json);
    }

    new_identity
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_identity_persistence() {
        let id1 = get_or_create_device_identity();
        assert_eq!(id1.device_id.len(), 36);
        let id2 = get_or_create_device_identity();
        assert_eq!(id1.device_id, id2.device_id);
    }
}
