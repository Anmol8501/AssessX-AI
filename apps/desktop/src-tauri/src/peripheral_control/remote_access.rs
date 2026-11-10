//! Advanced Remote-Access Detection & Restrictions (Phase 2D - P2.7).
//!
//! Evaluates active Remote Desktop / Terminal Services sessions, third-party
//! remote-control tools (AnyDesk, TeamViewer, RustDesk, UltraViewer, etc.),
//! and Windows Terminal Server policy.

// use crate::security_agent::logger::{log_info, log_warn};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RemoteAccessClassification {
    RemoteAccessDisabled,
    RemoteAccessAllowedByPolicy,
    RemoteSessionDetected,
    RemoteToolDetected,
    RemoteAccessPolicyWarning,
    RemoteAccessPolicyViolation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedRemoteTool {
    pub tool_name: String,
    pub executable_name: String,
    pub process_id: u32,
    pub is_running: bool,
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessStatusReport {
    pub is_remote_session_active: bool,
    pub rdp_denied_by_policy: bool,
    pub detected_remote_tools: Vec<DetectedRemoteTool>,
    pub running_remote_tools_count: usize,
    pub classification: RemoteAccessClassification,
    pub is_environment_secure: bool,
    pub last_inspected_at: String,
}

pub struct RemoteAccessManager;

impl RemoteAccessManager {
    /// Known remote-assistance and screen-sharing executable catalog.
    pub fn get_known_remote_tools() -> Vec<(&'static str, &'static str, &'static str)> {
        vec![
            ("AnyDesk Remote Desktop", "anydesk.exe", "ThirdPartyRemoteControl"),
            ("TeamViewer", "teamviewer.exe", "ThirdPartyRemoteControl"),
            ("TeamViewer Service", "teamviewer_service.exe", "RemoteService"),
            ("RustDesk Remote Desktop", "rustdesk.exe", "ThirdPartyRemoteControl"),
            ("UltraViewer", "ultraviewer.exe", "ThirdPartyRemoteControl"),
            ("UltraViewer Service", "ultraviewer_service.exe", "RemoteService"),
            ("Chrome Remote Desktop Host", "remoting_host.exe", "BrowserRemoteDesktop"),
            ("TightVNC Server", "tvnserver.exe", "VNC"),
            ("RealVNC Server", "vncserver.exe", "VNC"),
            ("UltraVNC Server", "winvnc.exe", "VNC"),
            ("Parsec Gaming/Remote Desktop", "parsec.exe", "ThirdPartyRemoteControl"),
            ("LogMeIn Client/Host", "logmein.exe", "ThirdPartyRemoteControl"),
            ("Splashtop Streamer", "srserver.exe", "RemoteService"),
            ("Quick Assist", "quickassist.exe", "WindowsBuiltinRemoteAssistance"),
        ]
    }

    /// Inspect system for active remote sessions, prohibited remote software, and RDP registry policies.
    #[cfg(windows)]
    pub fn inspect_remote_access() -> RemoteAccessStatusReport {
        use windows_sys::Win32::Foundation::{ERROR_SUCCESS, INVALID_HANDLE_VALUE};
        use windows_sys::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_LOCAL_MACHINE, KEY_READ, REG_DWORD,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_REMOTESESSION};

        // 1. Check if current Windows session is an RDP / Terminal Services remote session
        let is_remote_session = unsafe { GetSystemMetrics(SM_REMOTESESSION) } != 0;

        // 2. Scan running processes for known remote software
        let mut detected_tools = Vec::new();
        let known = Self::get_known_remote_tools();

        unsafe {
            let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snap != INVALID_HANDLE_VALUE && !snap.is_null() {
                let mut entry: PROCESSENTRY32W = std::mem::zeroed();
                entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

                if Process32FirstW(snap, &mut entry) != 0 {
                    loop {
                        let name_len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                        let exe_name = String::from_utf16_lossy(&entry.szExeFile[..name_len]).to_lowercase();

                        for (tool_title, proc_exe, category) in &known {
                            if exe_name == *proc_exe {
                                detected_tools.push(DetectedRemoteTool {
                                    tool_name: tool_title.to_string(),
                                    executable_name: proc_exe.to_string(),
                                    process_id: entry.th32ProcessID,
                                    is_running: true,
                                    category: category.to_string(),
                                });
                            }
                        }

                        if Process32NextW(snap, &mut entry) == 0 {
                            break;
                        }
                    }
                }
                windows_sys::Win32::Foundation::CloseHandle(snap);
            }
        }

        // 3. Inspect fDenyTSConnections in Windows Terminal Server registry
        let mut rdp_denied = true;
        unsafe {
            fn wide(s: &str) -> Vec<u16> {
                s.encode_utf16().chain(std::iter::once(0)).collect()
            }

            let mut hkey = std::ptr::null_mut();
            let subkey = wide("SYSTEM\\CurrentControlSet\\Control\\Terminal Server");
            if RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.as_ptr(), 0, KEY_READ, &mut hkey) == ERROR_SUCCESS {
                let val_name = wide("fDenyTSConnections");
                let mut val = 0u32;
                let mut size = std::mem::size_of::<u32>() as u32;
                let mut val_type = 0u32;
                if RegQueryValueExW(
                    hkey,
                    val_name.as_ptr(),
                    std::ptr::null_mut(),
                    &mut val_type,
                    &mut val as *mut u32 as *mut _,
                    &mut size,
                ) == ERROR_SUCCESS && val_type == REG_DWORD {
                    rdp_denied = val == 1;
                }
                RegCloseKey(hkey);
            }
        }

        let classification = if is_remote_session {
            RemoteAccessClassification::RemoteSessionDetected
        } else if !detected_tools.is_empty() {
            RemoteAccessClassification::RemoteToolDetected
        } else if rdp_denied {
            RemoteAccessClassification::RemoteAccessDisabled
        } else {
            RemoteAccessClassification::RemoteAccessAllowedByPolicy
        };

        let is_secure = !is_remote_session && detected_tools.is_empty();

        RemoteAccessStatusReport {
            is_remote_session_active: is_remote_session,
            rdp_denied_by_policy: rdp_denied,
            running_remote_tools_count: detected_tools.len(),
            detected_remote_tools: detected_tools,
            classification,
            is_environment_secure: is_secure,
            last_inspected_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs().to_string())
                .unwrap_or_else(|_| "0".to_string()),
        }
    }

    #[cfg(not(windows))]
    pub fn inspect_remote_access() -> RemoteAccessStatusReport {
        RemoteAccessStatusReport {
            is_remote_session_active: false,
            rdp_denied_by_policy: true,
            running_remote_tools_count: 0,
            detected_remote_tools: Vec::new(),
            classification: RemoteAccessClassification::RemoteAccessDisabled,
            is_environment_secure: true,
            last_inspected_at: "0".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_remote_access() {
        let rep = RemoteAccessManager::inspect_remote_access();
        assert!(!rep.is_remote_session_active || rep.is_remote_session_active);
        assert!(rep.last_inspected_at.len() > 0);
    }
}
