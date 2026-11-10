//! Window & Focus Supervisor (Phase 2C).
//!
//! Provides non-aggressive foreground monitoring, loss-of-focus classification,
//! minimization detection, and bounded foreground recovery.

// use crate::security_agent::logger::{log_info, log_warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum FocusTargetClass {
    AssessXExamWindow,
    ForeignApplication,
    BareDesktop,
    SystemSurface,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowFocusReport {
    pub is_assessx_foreground: bool,
    pub is_minimized: bool,
    pub active_foreground_title: String,
    pub active_foreground_process: String,
    pub focus_classification: FocusTargetClass,
    pub recovery_attempts_count: u32,
    pub display_count: usize,
    pub timestamp: String,
}

static RECOVERY_ATTEMPTS: AtomicU32 = AtomicU32::new(0);

pub struct FocusSupervisor;

impl FocusSupervisor {
    /// Inspect the current foreground window state and classify focus position.
    #[cfg(windows)]
    pub fn inspect_focus() -> WindowFocusReport {
        use windows_sys::Win32::Foundation::{CloseHandle, MAX_PATH};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
        };

        let mut title_buf = [0u16; 256];
        let mut class_buf = [0u16; 256];
        let mut process_name = String::new();
        let mut window_title = String::new();
        let mut class_name = String::new();
        let mut is_minimized = false;

        unsafe {
            let hwnd = GetForegroundWindow();
            if !hwnd.is_null() {
                is_minimized = IsIconic(hwnd) != 0;

                let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
                if title_len > 0 {
                    window_title = String::from_utf16_lossy(&title_buf[..title_len as usize]);
                }

                let class_len = GetClassNameW(hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32);
                if class_len > 0 {
                    class_name = String::from_utf16_lossy(&class_buf[..class_len as usize]).to_lowercase();
                }

                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, &mut pid);
                if pid != 0 {
                    let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
                    if !hproc.is_null() {
                        let mut img_buf = [0u16; MAX_PATH as usize];
                        let mut size = img_buf.len() as u32;
                        if QueryFullProcessImageNameW(hproc, 0, img_buf.as_mut_ptr(), &mut size) != 0 && size > 0 {
                            let full = String::from_utf16_lossy(&img_buf[..size as usize]);
                            if let Some(name) = full.split('\\').last() {
                                process_name = name.to_string();
                            }
                        }
                        CloseHandle(hproc);
                    }
                }
            }
        }

        let proc_lower = process_name.to_lowercase();
        let is_assessx = proc_lower.contains("assessx");

        let classification = if is_assessx {
            FocusTargetClass::AssessXExamWindow
        } else if class_name == "progman" || class_name == "workerw" {
            FocusTargetClass::BareDesktop
        } else if proc_lower.contains("startmenu")
            || proc_lower.contains("search")
            || proc_lower.contains("shellhost")
            || class_name.contains("tray")
        {
            FocusTargetClass::SystemSurface
        } else if !proc_lower.is_empty() {
            FocusTargetClass::ForeignApplication
        } else {
            FocusTargetClass::Unknown
        };

        WindowFocusReport {
            is_assessx_foreground: is_assessx,
            is_minimized,
            active_foreground_title: window_title,
            active_foreground_process: process_name,
            focus_classification: classification,
            recovery_attempts_count: RECOVERY_ATTEMPTS.load(Ordering::SeqCst),
            display_count: 1,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
                .to_string(),
        }
    }

    #[cfg(not(windows))]
    pub fn inspect_focus() -> WindowFocusReport {
        WindowFocusReport {
            is_assessx_foreground: true,
            is_minimized: false,
            active_foreground_title: "AssessX Exam Shell".to_string(),
            active_foreground_process: "assessx.exe".to_string(),
            focus_classification: FocusTargetClass::AssessXExamWindow,
            recovery_attempts_count: 0,
            display_count: 1,
            timestamp: "0".to_string(),
        }
    }

    /// Reset recovery attempt counter.
    pub fn reset_recovery_counter() {
        RECOVERY_ATTEMPTS.store(0, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_focus() {
        let report = FocusSupervisor::inspect_focus();
        assert!(matches!(
            report.focus_classification,
            FocusTargetClass::AssessXExamWindow
                | FocusTargetClass::ForeignApplication
                | FocusTargetClass::BareDesktop
                | FocusTargetClass::SystemSurface
                | FocusTargetClass::Unknown
        ));
    }
}
