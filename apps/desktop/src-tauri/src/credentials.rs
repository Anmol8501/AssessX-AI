//! The "keep me signed in" session token, kept in the Windows Credential Manager (Phase 8 final, CX-09).
//!
//! Before this the token lived in the WebView's `localStorage`, which is a file in the app's WebView2
//! profile. The Credential Manager stores it encrypted for the signed-in Windows user (DPAPI), outside the
//! web content's storage. A session-only sign-in never reaches here: it stays in `sessionStorage`, in
//! memory, and is gone when the window closes.
//!
//! Three narrow commands, one fixed credential name (`AssessX/session`); the value is checked to look like
//! an AssessX token before it is stored, and it is never logged.

const TARGET: &str = "AssessX/session";
const MAX_TOKEN: usize = 512;

fn valid(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= MAX_TOKEN
        && token.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::ptr;
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn write(target: &str, secret: &str) -> Result<(), String> {
        let mut name = wide(target);
        let mut user = wide("AssessX");
        let mut blob = secret.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: name.as_mut_ptr(),
            Comment: ptr::null_mut(),
            LastWritten: FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 },
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            // Per-user (local machine persistence means "this computer, this Windows account").
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: ptr::null_mut(),
            TargetAlias: ptr::null_mut(),
            UserName: user.as_mut_ptr(),
        };
        let ok = unsafe { CredWriteW(&credential, 0) };
        blob.iter_mut().for_each(|b| *b = 0);
        if ok == 0 { Err("credential store unavailable".into()) } else { Ok(()) }
    }

    pub fn read(target: &str) -> Result<Option<String>, String> {
        let name = wide(target);
        let mut found: *mut CREDENTIALW = ptr::null_mut();
        let ok = unsafe { CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut found) };
        if ok == 0 || found.is_null() {
            return Ok(None); // not stored (or not readable): signed out
        }
        let value = unsafe {
            let credential = &*found;
            let bytes = std::slice::from_raw_parts(credential.CredentialBlob, credential.CredentialBlobSize as usize);
            String::from_utf8(bytes.to_vec()).ok()
        };
        unsafe { CredFree(found as *const c_void) };
        Ok(value)
    }

    pub fn delete(target: &str) -> Result<(), String> {
        let name = wide(target);
        unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) };
        Ok(()) // deleting what is not there is not an error
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn write(_: &str, _: &str) -> Result<(), String> {
        Err("credential store not supported on this platform".into())
    }
    pub fn read(_: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
    pub fn delete(_: &str) -> Result<(), String> {
        Ok(())
    }
}

#[tauri::command]
pub fn session_token_store(token: String) -> Result<(), String> {
    if !valid(&token) {
        return Err("refused: not a session token".into());
    }
    platform::write(TARGET, &token)
}

#[tauri::command]
pub fn session_token_load() -> Result<Option<String>, String> {
    Ok(platform::read(TARGET)?.filter(|t| valid(t)))
}

#[tauri::command]
pub fn session_token_clear() -> Result<(), String> {
    platform::delete(TARGET)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_token_shaped_values_are_accepted() {
        assert!(valid("abcDEF123-_."));
        assert!(!valid(""));
        assert!(!valid("has space"));
        assert!(!valid("quote\""));
        assert!(!valid(&"a".repeat(MAX_TOKEN + 1)));
        assert!(session_token_store("bad value\n".into()).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn a_token_round_trips_through_the_credential_manager() {
        // CI runners may have no usable credential store; this runs on a developer's Windows account.
        if std::env::var_os("CI").is_some() {
            return;
        }
        let target = "AssessX/test-only-session";
        platform::write(target, "test-token_123").expect("write");
        assert_eq!(platform::read(target).expect("read").as_deref(), Some("test-token_123"));
        platform::delete(target).expect("delete");
        assert_eq!(platform::read(target).expect("read again"), None);
    }
}
