//! Administrator Privilege Verification (Module 4, Phase 1A).
//!
//! Evaluates the current Windows process token elevation state via standard Win32 security APIs.
//! Determines whether the current execution context can perform provisioning operations without
//! requiring the entire application to run as Administrator.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivilegeStatusReport {
    pub is_elevated: bool,
    pub user_name: String,
    pub privilege_level: &'static str, // "ADMINISTRATOR" | "STANDARD_USER"
    pub can_provision_kiosk: bool,
    pub summary: String,
}

#[cfg(windows)]
fn check_token_elevation() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token: HANDLE = std::ptr::null_mut();
    let current_process = unsafe { GetCurrentProcess() };

    let success = unsafe { OpenProcessToken(current_process, TOKEN_QUERY, &mut token) };
    if success == 0 || token.is_null() {
        return false;
    }

    let mut elevation: TOKEN_ELEVATION = unsafe { std::mem::zeroed() };
    let mut return_length: u32 = 0;

    let get_info = unsafe {
        GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut _,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut return_length,
        )
    };

    unsafe { CloseHandle(token) };

    if get_info != 0 {
        elevation.TokenIsElevated != 0
    } else {
        false
    }
}

#[cfg(windows)]
fn get_current_username() -> String {
    std::env::var("USERNAME").unwrap_or_else(|_| "Current User".to_string())
}

pub fn check_privileges() -> PrivilegeStatusReport {
    #[cfg(windows)]
    {
        let is_elevated = check_token_elevation();
        let user_name = get_current_username();
        let privilege_level = if is_elevated {
            "ADMINISTRATOR"
        } else {
            "STANDARD_USER"
        };

        let summary = if is_elevated {
            format!(
                "Process is running with elevated Administrator privileges as '{}'. All provisioning operations are available.",
                user_name
            )
        } else {
            format!(
                "Process is running as Standard User '{}'. Device readiness inspection is available; machine provisioning requires UAC elevation.",
                user_name
            )
        };

        PrivilegeStatusReport {
            is_elevated,
            user_name,
            privilege_level,
            can_provision_kiosk: is_elevated,
            summary,
        }
    }

    #[cfg(not(windows))]
    {
        PrivilegeStatusReport {
            is_elevated: false,
            user_name: "non-windows-user".to_string(),
            privilege_level: "STANDARD_USER",
            can_provision_kiosk: false,
            summary: "Privilege verification is running in a simulated non-Windows environment.".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_privilege_check() {
        let status = check_privileges();
        assert!(!status.user_name.is_empty());
        assert!(status.privilege_level == "ADMINISTRATOR" || status.privilege_level == "STANDARD_USER");
    }
}

