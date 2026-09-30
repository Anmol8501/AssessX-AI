//! A Windows low-level keyboard hook that swallows system shortcuts during a proctored exam.
//!
//! A low-level hook is the only mechanism a normal (non-administrator) desktop application has for
//! Alt+Tab, the Windows key or Print Screen: those never reach the web page.
//!
//! **Verification status: not proven effective.** The hook installs and is called for keys typed
//! while *another* application is in front, but in automated testing (keystrokes injected with
//! `keybd_event`) it was not called at all while the AssessX window was in the foreground, so Alt+Tab
//! and the Windows key were not blocked. The cause is not established, and whether a physical
//! keyboard behaves differently is untested. The lockdown therefore reports this guard as
//! `BEST_EFFORT`, never `ACTIVE`; leaving the exam window is still recorded as a focus loss.
//! See docs/PHASE-4-PLAN.md.
//!
//! The hook:
//!
//! * acts **only while the AssessX exam window is the foreground window** — keys pressed in any
//!   other application pass straight through;
//! * looks at nothing but the virtual-key code and the modifier state of each key, decides via
//!   `shortcuts::classify`, and never records, buffers or forwards keystrokes — only the *name* of a
//!   restricted combination that was swallowed (e.g. `ALT+TAB`) is sent on;
//! * runs on its own thread with its own message loop (a low-level hook is called on the thread
//!   that installed it), and is removed when the exam releases the lockdown or the app exits.
//!
//! What it cannot do, by Windows design: intercept Ctrl+Alt+Delete or Win+L (the secure attention
//! sequence and the workstation lock are handled by Winlogon, below any application hook), or
//! stop an administrator or another process with a higher-priority hook. Windows also removes a
//! hook whose callback is too slow, which is why the callback does no I/O of its own.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::mpsc::Sender;
use std::thread::JoinHandle;

use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetForegroundWindow, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_ALTDOWN, MSG, WH_KEYBOARD_LL,
    WM_KEYDOWN, WM_QUIT, WM_SYSKEYDOWN,
};

use super::shortcuts::{classify, Modifiers, Restricted};

// A hook procedure is a plain `extern "system" fn`, so what it needs is reachable only through
// statics. They hold nothing but the window to guard and whether guarding is on.
static GUARDING: AtomicBool = AtomicBool::new(false);
static TARGET_HWND: AtomicIsize = AtomicIsize::new(0);
/// The key whose press was last reported, so auto-repeat of a held key is reported once.
static LAST_REPORTED_VK: AtomicU32 = AtomicU32::new(0);

thread_local! {
    // Set on the hook thread before the hook is installed; the callback runs on that same thread.
    static REPORT: RefCell<Option<Sender<Restricted>>> = const { RefCell::new(None) };
}

pub struct KeyboardHook {
    thread_id: u32,
    thread: Option<JoinHandle<()>>,
}

impl KeyboardHook {
    /// Installs the hook for `hwnd`. Returns `None` if Windows refused it — the caller reports the
    /// system-shortcut guard as unavailable rather than pretending it is on.
    pub fn install(hwnd: isize, report: Sender<Restricted>) -> Option<KeyboardHook> {
        TARGET_HWND.store(hwnd, Ordering::SeqCst);
        LAST_REPORTED_VK.store(0, Ordering::SeqCst);
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Option<u32>>();

        let thread = std::thread::Builder::new()
            .name("assessx-keyboard-guard".into())
            .spawn(move || unsafe {
                REPORT.with(|r| *r.borrow_mut() = Some(report));
                let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), GetModuleHandleW(std::ptr::null()), 0);
                if hook.is_null() {
                    let _ = ready_tx.send(None);
                    return;
                }
                GUARDING.store(true, Ordering::SeqCst);
                let _ = ready_tx.send(Some(GetCurrentThreadId()));

                let mut msg: MSG = std::mem::zeroed();
                // Pumps messages so Windows can call the hook; returns 0 on WM_QUIT, -1 on error.
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {}

                GUARDING.store(false, Ordering::SeqCst);
                UnhookWindowsHookEx(hook);
                REPORT.with(|r| *r.borrow_mut() = None);
            })
            .ok()?;

        match ready_rx.recv() {
            Ok(Some(thread_id)) => Some(KeyboardHook { thread_id, thread: Some(thread) }),
            _ => {
                let _ = thread.join();
                None
            }
        }
    }

    /// Stops guarding and removes the hook. Blocks until the hook thread has exited.
    pub fn uninstall(mut self) {
        self.stop();
    }

    fn stop(&mut self) {
        GUARDING.store(false, Ordering::SeqCst);
        TARGET_HWND.store(0, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            unsafe {
                PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0);
            }
            let _ = thread.join();
        }
    }
}

impl Drop for KeyboardHook {
    fn drop(&mut self) {
        self.stop();
    }
}

fn key_down(vk: u16) -> bool {
    // The high bit is set while the key is held.
    unsafe { (GetAsyncKeyState(vk as i32) as u16 & 0x8000) != 0 }
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && GUARDING.load(Ordering::Relaxed) {
        let target = TARGET_HWND.load(Ordering::Relaxed);
        // Only the exam window is guarded: every other application's keys pass through untouched.
        if target != 0 && GetForegroundWindow() as isize == target {
            let key = &*(lparam as *const KBDLLHOOKSTRUCT);
            let modifiers = Modifiers {
                ctrl: key_down(VK_CONTROL),
                shift: key_down(VK_SHIFT),
                // The event's own flag is not set for every input source (injected input, some
                // keyboards and remapping tools), so the live Alt state is read as well.
                alt: key.flags & LLKHF_ALTDOWN != 0 || key_down(VK_MENU),
            };
            if let Some(restricted) = classify(key.vkCode, modifiers) {
                let pressed = wparam as u32 == WM_KEYDOWN || wparam as u32 == WM_SYSKEYDOWN;
                if pressed {
                    // Report the first press only; a held key auto-repeats key-downs.
                    if LAST_REPORTED_VK.swap(key.vkCode, Ordering::Relaxed) != key.vkCode {
                        REPORT.with(|r| {
                            if let Some(tx) = r.borrow().as_ref() {
                                let _ = tx.send(restricted);
                            }
                        });
                    }
                } else {
                    LAST_REPORTED_VK.store(0, Ordering::Relaxed);
                }
                return 1; // swallowed: neither Windows nor the exam window receives it
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}
