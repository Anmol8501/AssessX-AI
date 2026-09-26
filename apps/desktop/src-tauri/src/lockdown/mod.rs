//! The proctored-exam lockdown (Phase 4B): the native half of exam environment enforcement.
//!
//! Four narrow commands, and nothing generic — no shell, no process access, no arbitrary window
//! control:
//!
//! * `lockdown_engage` — fullscreen, always-on-top, exclusion from screen capture, and the
//!   system-shortcut guard; returns what *actually* took effect.
//! * `lockdown_release` — undoes all of it. Idempotent.
//! * `lockdown_restore_fullscreen` — brings the exam window back to fullscreen and to the front.
//! * `environment_snapshot` — window state, display count and whether this is a remote session.
//!
//! Two events go to the exam page while engaged: `lockdown://shortcut` (a system shortcut was
//! swallowed — its name only) and `lockdown://window` (focus / fullscreen / minimized changed).
//!
//! Every capability is verified after it is requested and reported as `ACTIVE` or `UNAVAILABLE`;
//! nothing is reported on because it was merely asked for. The page reloading or navigating
//! releases everything (`release_on_page_load`), so a crashed or reloaded exam page can never leave
//! Windows locked.

pub mod shortcuts;

#[cfg(windows)]
mod keyboard_hook;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow, Window};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Capability {
    Active,
    Unavailable,
}

impl Capability {
    fn from(on: bool) -> Self {
        if on {
            Capability::Active
        } else {
            Capability::Unavailable
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockdownStatus {
    pub fullscreen: Capability,
    pub always_on_top: Capability,
    pub capture_protection: Capability,
    pub system_shortcut_guard: Capability,
    pub display_count: usize,
    pub remote_session: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSnapshot {
    pub fullscreen: bool,
    pub minimized: bool,
    pub focused: bool,
    pub display_count: usize,
    pub remote_session: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShortcutPayload {
    event_type: &'static str,
    shortcut: &'static str,
}

/// Lockdown state, managed by Tauri. The keyboard hook, when installed, lives here.
#[derive(Default)]
pub struct Lockdown {
    engaged: Mutex<bool>,
    #[cfg(windows)]
    hook: Mutex<Option<keyboard_hook::KeyboardHook>>,
}

impl Lockdown {
    fn is_engaged(&self) -> bool {
        self.engaged.lock().map(|g| *g).unwrap_or(false)
    }
}

fn snapshot<R: Runtime>(window: &Window<R>) -> EnvironmentSnapshot {
    EnvironmentSnapshot {
        fullscreen: window.is_fullscreen().unwrap_or(false),
        minimized: window.is_minimized().unwrap_or(false),
        focused: window.is_focused().unwrap_or(false),
        display_count: window.available_monitors().map(|m| m.len()).unwrap_or(0),
        remote_session: system::is_remote_session(),
    }
}

#[tauri::command]
pub fn lockdown_engage<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, state: tauri::State<'_, Lockdown>) -> LockdownStatus {
    let fullscreen = window.set_fullscreen(true).is_ok() && window.is_fullscreen().unwrap_or(false);
    let always_on_top = window.set_always_on_top(true).is_ok();
    let _ = window.set_content_protected(true);
    let _ = window.set_focus();

    #[cfg(windows)]
    let (capture_protection, system_shortcut_guard) = {
        let hwnd = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
        // Tauri ignores whether SetWindowDisplayAffinity succeeded (it needs Windows 10 2004+), so
        // read the affinity back rather than assuming.
        let protected = hwnd != 0 && system::excluded_from_capture(hwnd);
        // The low-level keyboard hook is still installed (it swallows a restricted key on the rare
        // path where one reaches it), but it is reported **UNAVAILABLE**, never active or
        // best-effort. Physical-keyboard testing on the real app (2026-09-25) confirmed it does not
        // receive Alt+Tab, the Windows key, Win+Tab or Win+D while AssessX is the foreground window,
        // so those cannot be blocked from a normal desktop application. Leaving the window is still
        // detected as a focus loss, and Secure Kiosk Mode (Assigned Access) is the supported way to
        // block them at the OS level — see docs/security/WINDOWS-SECURE-KIOSK.md.
        let _ = install_guard(&app, &state, hwnd);
        (Capability::from(protected), Capability::Unavailable)
    };
    #[cfg(not(windows))]
    let (capture_protection, system_shortcut_guard) = {
        let _ = &app;
        (Capability::Unavailable, Capability::Unavailable)
    };

    if let Ok(mut engaged) = state.engaged.lock() {
        *engaged = true;
    }
    LockdownStatus {
        fullscreen: Capability::from(fullscreen),
        always_on_top: Capability::from(always_on_top),
        capture_protection,
        system_shortcut_guard,
        display_count: window.available_monitors().map(|m| m.len()).unwrap_or(0),
        remote_session: system::is_remote_session(),
    }
}

#[tauri::command]
pub fn lockdown_release<R: Runtime>(window: WebviewWindow<R>, state: tauri::State<'_, Lockdown>) {
    release(window.as_ref().window(), &state);
}

#[tauri::command]
pub fn lockdown_restore_fullscreen<R: Runtime>(window: WebviewWindow<R>, state: tauri::State<'_, Lockdown>) -> bool {
    if !state.is_engaged() {
        return false; // never re-enters fullscreen outside an exam
    }
    let _ = window.unminimize();
    let _ = window.set_fullscreen(true);
    let _ = window.set_focus();
    window.is_fullscreen().unwrap_or(false)
}

#[tauri::command]
pub fn environment_snapshot<R: Runtime>(window: WebviewWindow<R>) -> EnvironmentSnapshot {
    snapshot(&window.as_ref().window())
}

/// Installs the system-shortcut guard for `hwnd` unless it is already installed.
#[cfg(windows)]
fn install_guard<R: Runtime>(app: &AppHandle<R>, state: &Lockdown, hwnd: isize) -> bool {
    let mut hook = state.hook.lock().unwrap_or_else(|e| e.into_inner());
    if hook.is_none() && hwnd != 0 {
        let (tx, rx) = std::sync::mpsc::channel::<shortcuts::Restricted>();
        if let Some(installed) = keyboard_hook::KeyboardHook::install(hwnd, tx) {
            *hook = Some(installed);
            // Forward swallowed shortcuts to the page from a thread of our own, so the hook
            // callback never waits on IPC. Ends when the hook (and its sender) goes away.
            let emitter = app.clone();
            std::thread::spawn(move || {
                for restricted in rx {
                    let _ = emitter.emit(
                        "lockdown://shortcut",
                        ShortcutPayload { event_type: restricted.kind.event_type(), shortcut: restricted.shortcut },
                    );
                }
            });
        }
    }
    hook.is_some()
}

/// Undoes everything `lockdown_engage` did. Safe to call when nothing is engaged.
pub fn release<R: Runtime>(window: Window<R>, state: &Lockdown) {
    #[cfg(windows)]
    if let Some(hook) = state.hook.lock().unwrap_or_else(|e| e.into_inner()).take() {
        hook.uninstall();
    }
    let was_engaged = state.engaged.lock().map(|mut g| std::mem::replace(&mut *g, false)).unwrap_or(false);
    if was_engaged {
        let _ = window.set_content_protected(false);
        let _ = window.set_always_on_top(false);
        let _ = window.set_fullscreen(false);
    }
}

/// Window changes the exam page needs to see while the lockdown is engaged.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &tauri::WindowEvent) {
    let Some(state) = window.try_state::<Lockdown>() else { return };
    if !state.is_engaged() {
        return;
    }
    if matches!(event, tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_)) {
        let _ = window.emit("lockdown://window", snapshot(window));
    }
}

/// Any page load drops the lockdown: the exam page re-engages it if an exam is really running.
pub fn release_on_page_load<R: Runtime>(window: &Window<R>) {
    if let Some(state) = window.try_state::<Lockdown>() {
        release(window.clone(), &state);
    }
}

mod system {
    //! Read-only facts about the machine. Nothing here changes anything.

    /// True when this Windows session is a Remote Desktop (RDP) session. Other remote-control
    /// tools (AnyDesk, TeamViewer, VNC, Chrome Remote Desktop) share the local console session and
    /// are *not* detected by this — see docs/PHASE-4-PLAN.md.
    #[cfg(windows)]
    pub fn is_remote_session() -> bool {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_REMOTESESSION};
        unsafe { GetSystemMetrics(SM_REMOTESESSION) != 0 }
    }

    #[cfg(not(windows))]
    pub fn is_remote_session() -> bool {
        false
    }

    /// Whether the window really is excluded from screen capture (WDA_EXCLUDEFROMCAPTURE).
    #[cfg(windows)]
    pub fn excluded_from_capture(hwnd: isize) -> bool {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE};
        let mut affinity: u32 = 0;
        unsafe { GetWindowDisplayAffinity(hwnd as _, &mut affinity) != 0 && affinity == WDA_EXCLUDEFROMCAPTURE }
    }
}
