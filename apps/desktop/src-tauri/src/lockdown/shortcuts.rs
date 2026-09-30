//! Which system-level key combinations the exam environment swallows, and what each one is.
//!
//! Pure and platform-independent so it can be unit tested anywhere: the Windows keyboard hook
//! (`keyboard_hook.rs`) feeds it a virtual-key code and the modifier state and acts on the answer.
//!
//! Only combinations the web page itself can never see or stop are listed here — application
//! switching, the Windows key, the Start menu, the system menu, Print Screen. In-page shortcuts
//! (Ctrl+C, Ctrl+P, F12, …) are handled by the exam page, which can see and stop them.

/// Virtual-key codes used below (winuser.h). Kept local so this module has no platform dependency.
pub mod vk {
    pub const TAB: u32 = 0x09;
    pub const ESCAPE: u32 = 0x1B;
    pub const SPACE: u32 = 0x20;
    pub const SNAPSHOT: u32 = 0x2C; // Print Screen
    pub const LWIN: u32 = 0x5B;
    pub const RWIN: u32 = 0x5C;
    pub const F4: u32 = 0x73;
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Modifiers {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

/// The proctoring event a swallowed combination is reported as. Mirrors the backend taxonomy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestrictedKind {
    KeyboardRestriction,
    ScreenCapture,
}

impl RestrictedKind {
    pub fn event_type(self) -> &'static str {
        match self {
            RestrictedKind::KeyboardRestriction => "KEYBOARD_RESTRICTION_ATTEMPT",
            RestrictedKind::ScreenCapture => "SCREEN_CAPTURE_ATTEMPT",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Restricted {
    pub kind: RestrictedKind,
    /// A stable, upper-case name such as `ALT+TAB`. This — never the raw key stream — is what
    /// leaves the hook.
    pub shortcut: &'static str,
}

const fn keyboard(shortcut: &'static str) -> Option<Restricted> {
    Some(Restricted { kind: RestrictedKind::KeyboardRestriction, shortcut })
}

const fn capture(shortcut: &'static str) -> Option<Restricted> {
    Some(Restricted { kind: RestrictedKind::ScreenCapture, shortcut })
}

/// Whether the exam environment swallows this key, and what to call it if so.
///
/// Swallowing the Windows key itself is what disables every `Win+…` shortcut (Win+R, Win+D,
/// Win+Tab, Win+Shift+S, Win+V …): with its key-down never delivered, Windows never sees the
/// combination. Win+L and Ctrl+Alt+Delete are handled below the level any application hook
/// reaches and are deliberately not listed — they cannot be blocked, and nothing claims they are.
pub fn classify(vk_code: u32, m: Modifiers) -> Option<Restricted> {
    match vk_code {
        vk::LWIN | vk::RWIN => keyboard("WIN"),
        vk::SNAPSHOT if m.alt => capture("ALT+PRINTSCREEN"),
        vk::SNAPSHOT => capture("PRINTSCREEN"),
        vk::TAB if m.alt && m.shift => keyboard("ALT+SHIFT+TAB"),
        vk::TAB if m.alt => keyboard("ALT+TAB"),
        vk::ESCAPE if m.alt => keyboard("ALT+ESC"),
        vk::ESCAPE if m.ctrl && m.shift => keyboard("CTRL+SHIFT+ESC"),
        vk::ESCAPE if m.ctrl => keyboard("CTRL+ESC"),
        vk::F4 if m.alt => keyboard("ALT+F4"),
        vk::SPACE if m.alt => keyboard("ALT+SPACE"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NONE: Modifiers = Modifiers { ctrl: false, shift: false, alt: false };
    const ALT: Modifiers = Modifiers { ctrl: false, shift: false, alt: true };
    const CTRL: Modifiers = Modifiers { ctrl: true, shift: false, alt: false };

    fn name(vk: u32, m: Modifiers) -> Option<&'static str> {
        classify(vk, m).map(|r| r.shortcut)
    }

    #[test]
    fn application_switching_is_restricted() {
        assert_eq!(name(vk::TAB, ALT), Some("ALT+TAB"));
        assert_eq!(name(vk::TAB, Modifiers { shift: true, ..ALT }), Some("ALT+SHIFT+TAB"));
        assert_eq!(name(vk::ESCAPE, ALT), Some("ALT+ESC"));
        assert_eq!(name(vk::F4, ALT), Some("ALT+F4"));
        assert_eq!(name(vk::SPACE, ALT), Some("ALT+SPACE"));
    }

    #[test]
    fn the_windows_key_is_restricted_with_or_without_modifiers() {
        for m in [NONE, ALT, CTRL] {
            assert_eq!(name(vk::LWIN, m), Some("WIN"));
            assert_eq!(name(vk::RWIN, m), Some("WIN"));
        }
    }

    #[test]
    fn start_menu_and_task_manager_shortcuts_are_restricted() {
        assert_eq!(name(vk::ESCAPE, CTRL), Some("CTRL+ESC"));
        assert_eq!(name(vk::ESCAPE, Modifiers { shift: true, ..CTRL }), Some("CTRL+SHIFT+ESC"));
    }

    #[test]
    fn print_screen_is_a_screen_capture_attempt() {
        let plain = classify(vk::SNAPSHOT, NONE).unwrap();
        assert_eq!(plain.kind, RestrictedKind::ScreenCapture);
        assert_eq!(plain.kind.event_type(), "SCREEN_CAPTURE_ATTEMPT");
        assert_eq!(plain.shortcut, "PRINTSCREEN");
        assert_eq!(name(vk::SNAPSHOT, ALT), Some("ALT+PRINTSCREEN"));
    }

    #[test]
    fn ordinary_typing_passes_through() {
        assert_eq!(classify(vk::TAB, NONE), None); // plain Tab moves focus inside the exam
        assert_eq!(classify(vk::ESCAPE, NONE), None);
        assert_eq!(classify(vk::SPACE, NONE), None);
        assert_eq!(classify(vk::F4, NONE), None);
        assert_eq!(classify(0x41, CTRL), None); // Ctrl+A: in-page, handled by the exam page
        assert_eq!(classify(0x43, CTRL), None); // Ctrl+C: in-page, handled by the exam page
    }

    #[test]
    fn every_restricted_shortcut_name_fits_the_backend_vocabulary() {
        // Mirrors `_SHORTCUT` in backend/app/services/proctoring_events.py.
        let all = [
            (vk::LWIN, NONE),
            (vk::SNAPSHOT, NONE),
            (vk::SNAPSHOT, ALT),
            (vk::TAB, ALT),
            (vk::TAB, Modifiers { shift: true, ..ALT }),
            (vk::ESCAPE, ALT),
            (vk::ESCAPE, CTRL),
            (vk::ESCAPE, Modifiers { shift: true, ..CTRL }),
            (vk::F4, ALT),
            (vk::SPACE, ALT),
        ];
        for (code, m) in all {
            let shortcut = classify(code, m).unwrap().shortcut;
            assert!(shortcut
                .split('+')
                .all(|part| !part.is_empty() && part.len() <= 12 && part.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())));
        }
    }
}
