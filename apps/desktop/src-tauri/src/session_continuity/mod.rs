//! Examination Session Continuity & Encrypted Local Persistence (Phase 3B).
//!
//! Provides encrypted local buffering of candidate answers, atomic on-disk writes,
//! monotonic revision tracking, and crash-recovery state queries.

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::provisioning::device_id::get_or_create_device_identity;
use crate::secure_shell::crash_recovery::{CrashRecoveryController, ExaminationRecoveryState};

/// Record of an answer stored in the local buffer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAnswerRecord {
    pub question_id: String,
    pub selected_option_ids: Vec<String>,
    pub client_revision: u64,
    pub idempotency_key: String,
    pub client_timestamp: String,
    pub is_synced: bool,
    pub synced_at: Option<String>,
}

/// Buffer containing all candidate answers for an examination attempt.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionAnswerBuffer {
    pub attempt_id: String,
    pub last_saved: String,
    pub answers: HashMap<String, LocalAnswerRecord>,
}

static BUFFER_LOCK: Mutex<()> = Mutex::new(());

fn current_timestamp_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{now}")
}

fn get_session_dir(attempt_id: &str) -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let path = PathBuf::from(appdata).join("AssessX").join("sessions").join(attempt_id);
        if fs::create_dir_all(&path).is_ok() {
            return path;
        }
    }
    let fallback = std::env::temp_dir().join("AssessX").join("sessions").join(attempt_id);
    let _ = fs::create_dir_all(&fallback);
    fallback
}

const V2_MAGIC: &[u8; 4] = b"AXV2";

fn derive_legacy_v1_key(attempt_id: &str) -> Vec<u8> {
    let device_id = get_or_create_device_identity().device_id;
    let mut hasher = Sha256::new();
    hasher.update(b"AssessX-Local-Answer-Key-v1:");
    hasher.update(device_id.as_bytes());
    hasher.update(b":");
    hasher.update(attempt_id.as_bytes());
    hasher.finalize().to_vec()
}

#[cfg(windows)]
mod dpapi {
    use std::ptr;

    #[repr(C)]
    struct CryptBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const CryptBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const CryptBlob,
            pv_reserved: *mut core::ffi::c_void,
            p_prompt_struct: *mut core::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut CryptBlob,
        ) -> i32;

        fn CryptUnprotectData(
            p_data_in: *const CryptBlob,
            ppsz_data_descr: *mut *mut u16,
            p_optional_entropy: *const CryptBlob,
            pv_reserved: *mut core::ffi::c_void,
            p_prompt_struct: *mut core::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut CryptBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(hmem: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
    }

    pub fn protect(plaintext: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        let mut data_in = CryptBlob {
            cb_data: plaintext.len() as u32,
            pb_data: plaintext.as_ptr() as *mut u8,
        };
        let entropy_blob = CryptBlob {
            cb_data: entropy.len() as u32,
            pb_data: entropy.as_ptr() as *mut u8,
        };
        let mut data_out = CryptBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        let ok = unsafe {
            CryptProtectData(
                &mut data_in,
                ptr::null(),
                &entropy_blob,
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
        };
        if ok == 0 || data_out.pb_data.is_null() {
            return Err("Windows DPAPI CryptProtectData failed".to_string());
        }

        let protected = unsafe {
            let slice = std::slice::from_raw_parts(data_out.pb_data, data_out.cb_data as usize);
            let out = slice.to_vec();
            LocalFree(data_out.pb_data as *mut core::ffi::c_void);
            out
        };
        Ok(protected)
    }

    pub fn unprotect(protected: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
        let data_in = CryptBlob {
            cb_data: protected.len() as u32,
            pb_data: protected.as_ptr() as *mut u8,
        };
        let entropy_blob = CryptBlob {
            cb_data: entropy.len() as u32,
            pb_data: entropy.as_ptr() as *mut u8,
        };
        let mut data_out = CryptBlob {
            cb_data: 0,
            pb_data: ptr::null_mut(),
        };

        let ok = unsafe {
            CryptUnprotectData(
                &data_in,
                ptr::null_mut(),
                &entropy_blob,
                ptr::null_mut(),
                ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut data_out,
            )
        };
        if ok == 0 || data_out.pb_data.is_null() {
            return Err("Windows DPAPI CryptUnprotectData failed".to_string());
        }

        let plain = unsafe {
            let slice = std::slice::from_raw_parts(data_out.pb_data, data_out.cb_data as usize);
            let out = slice.to_vec();
            LocalFree(data_out.pb_data as *mut core::ffi::c_void);
            out
        };
        Ok(plain)
    }
}

fn generate_random_key_32() -> Result<[u8; 32], String> {
    let rng = SystemRandom::new();
    let mut key = [0u8; 32];
    rng.fill(&mut key)
        .map_err(|_| "CSPRNG key generation failed".to_string())?;
    Ok(key)
}

fn get_or_create_v2_key_in_dir(dir: &std::path::Path, attempt_id: &str) -> Result<[u8; 32], String> {
    let key_file = dir.join("answers_v2.key");
    let entropy = format!("AssessX-DPAPI-Key-v2:{}", attempt_id);

    if key_file.exists() {
        let stored = fs::read(&key_file).map_err(|e| format!("Failed reading v2 key file: {e}"))?;
        #[cfg(windows)]
        let raw = dpapi::unprotect(&stored, entropy.as_bytes())?;
        #[cfg(not(windows))]
        let raw = stored;

        if raw.len() != 32 {
            return Err("Corrupted v2 key length".to_string());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&raw);
        return Ok(key);
    }

    let key = generate_random_key_32()?;
    #[cfg(windows)]
    let protected = dpapi::protect(&key, entropy.as_bytes())?;
    #[cfg(not(windows))]
    let protected = key.to_vec();

    let tmp_key = dir.join("answers_v2.key.tmp");
    fs::write(&tmp_key, &protected).map_err(|e| format!("Failed writing v2 key tmp: {e}"))?;
    fs::rename(&tmp_key, &key_file).map_err(|e| format!("Failed renaming v2 key file: {e}"))?;
    Ok(key)
}

/// Encrypts payload with AES-256-GCM + random 96-bit nonce + attempt AAD binding.
fn encrypt_payload_v2(data: &[u8], key: &[u8; 32], aad_context: &str) -> Result<Vec<u8>, String> {
    let unbound = UnboundKey::new(&AES_256_GCM, key)
        .map_err(|_| "Invalid AES-256-GCM key".to_string())?;
    let aead_key = LessSafeKey::new(unbound);

    let rng = SystemRandom::new();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "Nonce generation failed".to_string())?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);

    let mut in_out = data.to_vec();
    aead_key
        .seal_in_place_append_tag(nonce, Aad::from(aad_context.as_bytes()), &mut in_out)
        .map_err(|_| "AES-256-GCM seal failed".to_string())?;

    let mut out = Vec::with_capacity(V2_MAGIC.len() + nonce_bytes.len() + in_out.len());
    out.extend_from_slice(V2_MAGIC);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&in_out);
    Ok(out)
}

/// Decrypts AES-256-GCM `AXV2` payload verifying tag and AAD context.
fn decrypt_payload_v2(encrypted: &[u8], key: &[u8; 32], aad_context: &str) -> Result<Vec<u8>, String> {
    let min_len = V2_MAGIC.len() + 12 + AES_256_GCM.tag_len();
    if encrypted.len() < min_len {
        return Err("Encrypted answer buffer v2 too small".to_string());
    }
    if &encrypted[..V2_MAGIC.len()] != V2_MAGIC {
        return Err("Invalid answer buffer v2 magic header".to_string());
    }

    let nonce_start = V2_MAGIC.len();
    let ct_start = nonce_start + 12;
    let mut nonce_bytes = [0u8; 12];
    nonce_bytes.copy_from_slice(&encrypted[nonce_start..ct_start]);

    let unbound = UnboundKey::new(&AES_256_GCM, key)
        .map_err(|_| "Invalid AES-256-GCM key".to_string())?;
    let aead_key = LessSafeKey::new(unbound);

    let mut buf = encrypted[ct_start..].to_vec();
    let plain = aead_key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(aad_context.as_bytes()),
            &mut buf,
        )
        .map_err(|_| "AES-256-GCM authentication verification failed".to_string())?;

    Ok(plain.to_vec())
}

fn decrypt_legacy_v1_payload(encrypted: &[u8], key: &[u8]) -> Result<Vec<u8>, String> {
    if encrypted.len() < 32 {
        return Err("Encrypted answer buffer too small".to_string());
    }

    let (tag, ciphertext) = encrypted.split_at(32);

    let mut tag_hasher = Sha256::new();
    tag_hasher.update(key);
    tag_hasher.update(ciphertext);
    let expected_tag = tag_hasher.finalize();

    if tag != expected_tag.as_slice() {
        return Err("Integrity verification failed for answer buffer".to_string());
    }

    let mut plaintext = Vec::with_capacity(ciphertext.len());
    let mut counter: u32 = 0;

    for chunk in ciphertext.chunks(32) {
        let mut hasher = Sha256::new();
        hasher.update(key);
        hasher.update(&counter.to_le_bytes());
        let stream_block = hasher.finalize();

        for (i, byte) in chunk.iter().enumerate() {
            plaintext.push(byte ^ stream_block[i]);
        }
        counter = counter.wrapping_add(1);
    }

    Ok(plaintext)
}

fn load_buffer_internal(attempt_id: &str) -> LocalSessionAnswerBuffer {
    let dir = get_session_dir(attempt_id);
    let v2_file = dir.join("answers_v2.enc");
    if v2_file.exists() {
        if let (Ok(raw), Ok(key)) = (fs::read(&v2_file), get_or_create_v2_key_in_dir(&dir, attempt_id)) {
            if let Ok(decrypted) = decrypt_payload_v2(&raw, &key, attempt_id) {
                if let Ok(buf) = serde_json::from_slice(&decrypted) {
                    return buf;
                }
            }
        }
        return LocalSessionAnswerBuffer {
            attempt_id: attempt_id.to_string(),
            last_saved: current_timestamp_iso(),
            answers: HashMap::new(),
        };
    }

    // Backward-compatibility migration from legacy answers_v1.enc if present
    let v1_file = dir.join("answers_v1.enc");
    if v1_file.exists() {
        if let Ok(raw) = fs::read(&v1_file) {
            let key = derive_legacy_v1_key(attempt_id);
            if let Ok(decrypted) = decrypt_legacy_v1_payload(&raw, &key) {
                if let Ok(buf) = serde_json::from_slice::<LocalSessionAnswerBuffer>(&decrypted) {
                    return buf;
                }
            }
        }
    }

    LocalSessionAnswerBuffer {
        attempt_id: attempt_id.to_string(),
        last_saved: current_timestamp_iso(),
        answers: HashMap::new(),
    }
}

fn save_buffer_internal(buffer: &LocalSessionAnswerBuffer) -> Result<(), String> {
    let dir = get_session_dir(&buffer.attempt_id);
    let temp_file = dir.join("answers_v2.tmp");
    let target_file = dir.join("answers_v2.enc");

    let serialized = serde_json::to_vec(buffer)
        .map_err(|e| format!("Serialization error: {e}"))?;
    let key = get_or_create_v2_key_in_dir(&dir, &buffer.attempt_id)?;
    let encrypted = encrypt_payload_v2(&serialized, &key, &buffer.attempt_id)?;

    fs::write(&temp_file, &encrypted)
        .map_err(|e| format!("Failed to write temporary answers file: {e}"))?;
    fs::rename(&temp_file, &target_file)
        .map_err(|e| format!("Failed to atomic rename answers file: {e}"))?;

    // Clean up legacy v1 cache once safely upgraded to v2
    let v1_file = dir.join("answers_v1.enc");
    if v1_file.exists() {
        let _ = fs::remove_file(v1_file);
    }

    Ok(())
}

/// Stores an answer in the local encrypted buffer.
#[tauri::command]
pub fn save_answer_local(
    attempt_id: String,
    question_id: String,
    selected_option_ids: Vec<String>,
    client_revision: u64,
    idempotency_key: String,
    client_timestamp: String,
) -> Result<LocalAnswerRecord, String> {
    let _guard = BUFFER_LOCK.lock().unwrap_or_else(|e| e.into_inner());

    let mut buffer = load_buffer_internal(&attempt_id);
    buffer.attempt_id = attempt_id.clone();
    buffer.last_saved = current_timestamp_iso();

    let record = LocalAnswerRecord {
        question_id: question_id.clone(),
        selected_option_ids,
        client_revision,
        idempotency_key,
        client_timestamp,
        is_synced: false,
        synced_at: None,
    };

    buffer.answers.insert(question_id, record.clone());
    save_buffer_internal(&buffer)?;

    Ok(record)
}

/// Retrieves all stored answers for the specified attempt.
#[tauri::command]
pub fn get_all_local_answers(attempt_id: String) -> Result<Vec<LocalAnswerRecord>, String> {
    let _guard = BUFFER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let buffer = load_buffer_internal(&attempt_id);
    Ok(buffer.answers.into_values().collect())
}

/// Marks specific questions as successfully synchronized with the backend.
#[tauri::command]
pub fn mark_local_answers_synced(
    attempt_id: String,
    question_ids: Vec<String>,
    _synced_revision: u64,
) -> Result<(), String> {
    let _guard = BUFFER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut buffer = load_buffer_internal(&attempt_id);
    let now = current_timestamp_iso();

    for qid in question_ids {
        if let Some(record) = buffer.answers.get_mut(&qid) {
            record.is_synced = true;
            record.synced_at = Some(now.clone());
        }
    }

    save_buffer_internal(&buffer)?;
    Ok(())
}

/// Clears the local answer buffer upon successful examination submission.
#[tauri::command]
pub fn clear_local_answers(attempt_id: String) -> Result<(), String> {
    let _guard = BUFFER_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = get_session_dir(&attempt_id);
    for name in ["answers_v2.enc", "answers_v2.key", "answers_v1.enc"] {
        let file = dir.join(name);
        if file.exists() {
            let _ = fs::remove_file(file);
        }
    }
    Ok(())
}

/// Inspects whether an incomplete examination crashed or terminated abnormally.
#[tauri::command]
pub fn get_recovery_session_state() -> Result<Option<ExaminationRecoveryState>, String> {
    let controller = CrashRecoveryController::default();
    let state = controller.inspect_on_startup();
    if state.crash_detected && state.attempt_id.is_some() {
        Ok(Some(state))
    } else {
        Ok(None)
    }
}

/// Updates the local recovery heartbeat timestamp.
#[tauri::command]
pub fn record_continuity_heartbeat(_attempt_id: String) -> Result<(), String> {
    let controller = CrashRecoveryController::default();
    controller.record_heartbeat();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_roundtrip() {
        let key: [u8; 32] = *b"01234567890123456789012345678901";
        let payload = b"Hello, AssessX Session Continuity!";

        let encrypted = encrypt_payload_v2(payload, &key, "attempt-123").expect("encrypt");
        assert_ne!(encrypted.as_slice(), payload.as_slice());

        let decrypted = decrypt_payload_v2(&encrypted, &key, "attempt-123")
            .expect("Decryption should succeed");
        assert_eq!(decrypted, payload);

        // Wrong AAD must fail authentication
        let wrong_aad = decrypt_payload_v2(&encrypted, &key, "attempt-other");
        assert!(wrong_aad.is_err());
    }

    #[test]
    fn test_corrupted_payload_fails_verification() {
        let key: [u8; 32] = *b"01234567890123456789012345678901";
        let payload = b"Secret candidate answers";

        let mut encrypted = encrypt_payload_v2(payload, &key, "attempt-123").expect("encrypt");
        // Corrupt one byte of ciphertext/tag
        if let Some(last) = encrypted.last_mut() {
            *last ^= 0xFF;
        }

        let res = decrypt_payload_v2(&encrypted, &key, "attempt-123");
        assert!(res.is_err(), "Corrupted payload must fail AEAD tag");
    }

    #[cfg(windows)]
    #[test]
    fn test_dpapi_and_aes_gcm_roundtrip_on_disk() {
        let attempt_id = format!("test-dpapi-{}", std::process::id());
        let dir = get_session_dir(&attempt_id);
        let key = get_or_create_v2_key_in_dir(&dir, &attempt_id).expect("dpapi key create");
        let reloaded_key = get_or_create_v2_key_in_dir(&dir, &attempt_id).expect("dpapi key reload");
        assert_eq!(key, reloaded_key);
        let _ = clear_local_answers(attempt_id);
    }
}
