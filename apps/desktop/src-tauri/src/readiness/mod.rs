//! Pre-exam device readiness (Phase 4B.5): the native half of the "prepare your device" check.
//!
//! Two narrow, read-mostly commands, and nothing generic:
//!
//! * `readiness_scan` — lists the **prohibited user applications that have a visible window** on
//!   this desktop, each by its policy id / display name / category. Nothing else is returned: no
//!   full process list, no paths, no command lines, no window titles.
//! * `readiness_close_apps` — asks the windows of the given policy ids to close **gracefully**
//!   (`WM_CLOSE`, the same as clicking the ✕), waits briefly, then re-scans and reports what
//!   remains. It never force-terminates anything, and never touches a protected process.
//!
//! All matching goes through `policy`, which is an allow-list guarded by a hard protected set. A
//! process without a visible top-level window is ignored, so background helpers of an allowed
//! program are never considered.

pub mod policy;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedApp {
    /// Stable policy id (e.g. `chrome`) — safe to send to the backend event log.
    pub id: String,
    pub display_name: String,
    pub category: String,
}

/// One prohibited process with a visible window. `pid` stays inside the native layer.
#[cfg(windows)]
struct Found {
    pid: u32,
    id: &'static str,
    display_name: &'static str,
    category: &'static str,
}

#[cfg(windows)]
fn enumerate() -> Vec<Found> {
    use std::collections::BTreeMap;

    use windows_sys::Win32::Foundation::{HWND, LPARAM, MAX_PATH};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowThreadProcessId, IsWindowVisible, GW_OWNER,
    };

    // One entry per prohibited pid that owns a top-level, un-owned, visible window.
    let mut found: BTreeMap<u32, &'static policy::Prohibited> = BTreeMap::new();

    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> i32 {
        unsafe {
            // Only real top-level windows: visible, and not owned by another window (which would
            // make it a tool/dialog of an app already counted).
            if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
                return 1;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return 1;
            }
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return 1; // a process we may not query (system) — never our concern
            }
            // QueryFullProcessImageNameW works with PROCESS_QUERY_LIMITED_INFORMATION across
            // integrity levels; GetModuleBaseNameW would need PROCESS_VM_READ (which browsers and
            // other apps deny), so it returned nothing and the scan always looked empty.
            let mut buf = [0u16; MAX_PATH as usize];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
            windows_sys::Win32::Foundation::CloseHandle(handle);
            if ok == 0 || size == 0 {
                return 1;
            }
            let full = String::from_utf16_lossy(&buf[..size as usize]);
            let exe = full.rsplit(['\\', '/']).next().unwrap_or(&full);
            if let Some(entry) = policy::classify(exe) {
                let map = &mut *(lparam as *mut BTreeMap<u32, &'static policy::Prohibited>);
                map.entry(pid).or_insert(entry);
            }
            1
        }
    }

    unsafe {
        EnumWindows(Some(cb), &mut found as *mut _ as LPARAM);
    }
    found
        .into_iter()
        .map(|(pid, e)| Found { pid, id: e.id, display_name: e.display_name, category: e.category.as_str() })
        .collect()
}

#[cfg(not(windows))]
fn enumerate() -> Vec<(u32, &'static str, &'static str, &'static str)> {
    Vec::new()
}

/// De-duplicates found processes to one row per application (a browser may have several windows).
fn detected() -> Vec<DetectedApp> {
    #[cfg(windows)]
    {
        let mut seen = std::collections::BTreeSet::new();
        enumerate()
            .into_iter()
            .filter(|f| seen.insert(f.id))
            .map(|f| DetectedApp {
                id: f.id.to_string(),
                display_name: f.display_name.to_string(),
                category: f.category.to_string(),
            })
            .collect()
    }
    #[cfg(not(windows))]
    Vec::new()
}

#[tauri::command]
pub fn readiness_scan() -> Vec<DetectedApp> {
    detected()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseResult {
    /// Prohibited apps still open after the graceful-close attempt and a short wait.
    pub remaining: Vec<DetectedApp>,
}

/// Politely asks the windows of the named prohibited apps to close, then re-scans.
///
/// `ids` are policy ids from a prior scan; anything not currently detected as prohibited (or that
/// is protected) is ignored, so this cannot be turned into a way to close an arbitrary window.
#[tauri::command]
pub fn readiness_close_apps(ids: Vec<String>) -> CloseResult {
    #[cfg(windows)]
    {
        request_close(&ids);
        // A short grace period for apps to process WM_CLOSE (and show any "save?" prompt).
        std::thread::sleep(std::time::Duration::from_millis(1500));
    }
    #[cfg(not(windows))]
    let _ = ids;
    CloseResult { remaining: detected() }
}

#[cfg(windows)]
fn request_close(ids: &[String]) {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, GW_OWNER, WM_CLOSE,
    };

    let wanted: std::collections::BTreeSet<u32> = enumerate()
        .into_iter()
        .filter(|f| ids.iter().any(|id| id == f.id))
        .map(|f| f.pid)
        .collect();
    if wanted.is_empty() {
        return;
    }

    unsafe extern "system" fn cb(hwnd: HWND, lparam: LPARAM) -> i32 {
        unsafe {
            if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
                return 1;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            let wanted = &*(lparam as *const std::collections::BTreeSet<u32>);
            if wanted.contains(&pid) {
                // WM_CLOSE is a request, exactly like the window's ✕. The app may prompt or refuse;
                // it is never forced. (No process is ever terminated in this module.)
                PostMessageW(hwnd, WM_CLOSE, 0, 0);
            }
            1
        }
    }

    unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::EnumWindows(Some(cb), &wanted as *const _ as LPARAM);
    }
}
