//! Leaving the exam window, and coming back to it (exam integrity, 2026-10-05).
//!
//! A normal desktop application cannot disable Windows' own ways of switching away — touchpad
//! gestures (three- and four-finger swipes), Task View, the Windows key, Alt+Tab. Only an OS-managed
//! kiosk (Assigned Access) can. What the exam window *can* do while the lockdown is engaged:
//!
//! * **Say where focus went** (`classify`): another application or Task View (`app`), the bare desktop
//!   or another virtual desktop (`desktop`), or Windows' own surfaces — Start, search, the taskbar, the
//!   notification centre (`system`). The page reports it with the return, and the server counts an `app`
//!   or `desktop` departure as a tab switch however short it was (a system popup keeps the grace period).
//! * **Come straight back** (`reclaim`): bring the exam window to the front again, onto the virtual
//!   desktop the candidate switched to if needed, so a swipe to another app or desktop shows it for only a
//!   moment. Bounded retries, never a loop; stops as soon as the lockdown is released.
//!
//! Read-only queries plus window placement of AssessX's own window. No other window is changed.

/// Where focus went when the exam window lost it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeftTo {
    App,
    Desktop,
    System,
}

impl LeftTo {
    pub fn as_str(self) -> &'static str {
        match self {
            LeftTo::App => "app",
            LeftTo::Desktop => "desktop",
            LeftTo::System => "system",
        }
    }
}

/// Windows' own shell surfaces: Start, search, the notification/quick-settings panels.
const SYSTEM_PROCESSES: &[&str] = &[
    "startmenuexperiencehost.exe",
    "searchhost.exe",
    "searchapp.exe",
    "shellexperiencehost.exe",
    "shellhost.exe",
    "lockapp.exe",
];

/// Explorer windows that are the taskbar or its overflow — Windows' own, not a place to work in.
const SYSTEM_EXPLORER_CLASSES: &[&str] = &[
    "shell_traywnd",
    "shell_secondarytraywnd",
    "notifyiconoverflowwindow",
    "toplevelwindowforoverflowxamlisland",
];

/// The desktop itself (also what is focused on an empty virtual desktop).
const DESKTOP_CLASSES: &[&str] = &["progman", "workerw"];

/// Classifies the window that took focus from its process image name and window class.
///
/// Anything that is not recognisably Windows' own surface counts as an application, including Task
/// View and Alt+Tab (explorer windows whose only purpose is switching to another app) and File Explorer.
pub fn classify(exe_name: &str, class_name: &str) -> LeftTo {
    let exe = exe_name.trim().to_ascii_lowercase();
    let class = class_name.trim().to_ascii_lowercase();
    if DESKTOP_CLASSES.contains(&class.as_str()) {
        return LeftTo::Desktop;
    }
    if SYSTEM_PROCESSES.contains(&exe.as_str()) {
        return LeftTo::System;
    }
    if exe == "explorer.exe" && SYSTEM_EXPLORER_CLASSES.contains(&class.as_str()) {
        return LeftTo::System;
    }
    LeftTo::App
}

#[cfg(windows)]
pub mod native {
    use super::{classify, LeftTo};
    use windows_sys::Win32::Foundation::{CloseHandle, HWND, MAX_PATH};
    use windows_sys::Win32::System::Threading::{
        AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetClassNameW, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
        SetForegroundWindow, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        SW_RESTORE,
    };

    fn process_name(pid: u32) -> String {
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return String::new();
            }
            let mut buf = [0u16; MAX_PATH as usize];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
            CloseHandle(handle);
            if ok == 0 || size == 0 {
                return String::new();
            }
            let full = String::from_utf16_lossy(&buf[..size as usize]);
            full.rsplit(['\\', '/']).next().unwrap_or(&full).to_string()
        }
    }

    fn class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }

    /// Where focus is now, or None when it is still inside AssessX (or nothing has it yet).
    pub fn current_target() -> Option<LeftTo> {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                return None;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(fg, &mut pid);
            if pid == 0 || pid == std::process::id() {
                return None;
            }
            Some(classify(&process_name(pid), &class_name(fg)))
        }
    }

    /// True when `hwnd` is the foreground window.
    pub fn is_foreground(hwnd: isize) -> bool {
        unsafe { GetForegroundWindow() as isize == hwnd }
    }

    /// Puts AssessX's own window back in front of everything, on the current virtual desktop.
    pub fn reclaim(hwnd: isize) {
        let hwnd = hwnd as HWND;
        move_to_current_desktop(hwnd as isize);
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
            // Windows refuses SetForegroundWindow to a background process unless its input is attached
            // to the foreground thread's: attach for the duration of the call, then detach.
            let fg = GetForegroundWindow();
            let fg_thread = if fg.is_null() { 0 } else { GetWindowThreadProcessId(fg, std::ptr::null_mut()) };
            let me = GetCurrentThreadId();
            let attached = fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, 1) != 0;
            BringWindowToTop(hwnd);
            SetForegroundWindow(hwnd);
            if attached {
                AttachThreadInput(me, fg_thread, 0);
            }
        }
    }

    /// When the candidate switched virtual desktops (four-finger swipe, Win+Ctrl+Arrow), moves the exam
    /// window onto the desktop they are now on. Uses the documented IVirtualDesktopManager; does nothing
    /// if it is unavailable or the target desktop cannot be determined (e.g. an empty desktop).
    fn move_to_current_desktop(hwnd: isize) {
        use windows::Win32::Foundation::HWND as WHWND;
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{IVirtualDesktopManager, VirtualDesktopManager};

        unsafe {
            let initialised = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let result = (|| -> windows::core::Result<()> {
                let manager: IVirtualDesktopManager = CoCreateInstance(&VirtualDesktopManager, None, CLSCTX_ALL)?;
                let ours = WHWND(hwnd as *mut core::ffi::c_void);
                if manager.IsWindowOnCurrentVirtualDesktop(ours)?.as_bool() {
                    return Ok(());
                }
                let fg = GetForegroundWindow();
                if fg.is_null() {
                    return Ok(());
                }
                let target = manager.GetWindowDesktopId(WHWND(fg as *mut core::ffi::c_void))?;
                if target != windows::core::GUID::zeroed() {
                    manager.MoveWindowToDesktop(ours, &target)?;
                }
                Ok(())
            })();
            let _ = result; // best effort: the departure is still recorded and counted
            if initialised {
                CoUninitialize();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn another_application_counts_as_leaving() {
        assert_eq!(classify("chrome.exe", "Chrome_WidgetWin_1"), LeftTo::App);
        assert_eq!(classify("WhatsApp.exe", "ApplicationFrameWindow"), LeftTo::App);
        assert_eq!(classify("explorer.exe", "CabinetWClass"), LeftTo::App); // File Explorer
    }

    #[test]
    fn task_view_and_alt_tab_count_as_switching_apps() {
        // Three-finger swipe up / Win+Tab and Alt+Tab are explorer windows whose purpose is switching.
        assert_eq!(classify("explorer.exe", "XamlExplorerHostIslandWindow"), LeftTo::App);
        assert_eq!(classify("explorer.exe", "MultitaskingViewFrame"), LeftTo::App);
    }

    #[test]
    fn the_desktop_and_an_empty_virtual_desktop_count_as_desktop() {
        assert_eq!(classify("explorer.exe", "Progman"), LeftTo::Desktop);
        assert_eq!(classify("explorer.exe", "WorkerW"), LeftTo::Desktop);
    }

    #[test]
    fn windows_own_surfaces_are_system() {
        assert_eq!(classify("StartMenuExperienceHost.exe", "Windows.UI.Core.CoreWindow"), LeftTo::System);
        assert_eq!(classify("SearchHost.exe", "Windows.UI.Core.CoreWindow"), LeftTo::System);
        assert_eq!(classify("ShellExperienceHost.exe", "Windows.UI.Core.CoreWindow"), LeftTo::System);
        assert_eq!(classify("explorer.exe", "Shell_TrayWnd"), LeftTo::System);
        assert_eq!(classify("explorer.exe", "Shell_SecondaryTrayWnd"), LeftTo::System);
    }

    #[test]
    fn names_are_compared_case_insensitively() {
        assert_eq!(classify("  EXPLORER.EXE ", "PROGMAN"), LeftTo::Desktop);
        assert_eq!(LeftTo::App.as_str(), "app");
    }
}
