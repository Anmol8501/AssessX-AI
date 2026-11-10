//! Keyboard Shortcut Inventory and Categorization for Phase 2C.
//!
//! Provides a structured, configurable inventory of keyboard shortcuts (Categories A through G),
//! distinguishing between frontend interception, native Windows policy enforcement, and kernel-reserved sequences.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ShortcutCategory {
    /// Category A: Application switching (Alt+Tab, Alt+Shift+Tab, Win+Tab)
    AppSwitching,
    /// Category B: Windows shell and desktop navigation (Win, Win+D, Win+E, Win+R, Win+X, Win+I, Win+S, Win+A, Win+N)
    ShellAndDesktop,
    /// Category C: Task and session management (Ctrl+Shift+Esc, Alt+F4, Ctrl+Alt+Del, Win+L)
    TaskAndSession,
    /// Category D: Browser and application navigation (Alt+Left/Right, Ctrl+T, Ctrl+W, Ctrl+N, F11)
    BrowserAndNav,
    /// Category E: Clipboard and content transfer (Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A, Insert combinations)
    ClipboardTransfer,
    /// Category F: Print and screen capture (Ctrl+P, PrintScreen, Alt+PrintScreen, Win+Shift+S)
    PrintAndCapture,
    /// Category G: Accessibility combinations (StickyKeys, ToggleKeys, FilterKeys, HighContrast)
    Accessibility,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ShortcutRiskLevel {
    Critical,
    High,
    Medium,
    Low,
    AccessibilityAccommodation,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ShortcutAction {
    Allow,
    Restrict,
    Block,
    Monitor,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ShortcutEnforcementType {
    /// Intercepted via React/Tauri webview event handlers
    FrontendInterception,
    /// Intercepted via low-level user-mode Windows keyboard hook (WH_KEYBOARD_LL)
    LowLevelHook,
    /// Enforced via Windows Explorer / Group Policy registry settings (e.g. NoWinKeys)
    WindowsNativePolicy,
    /// Enforced via Windows Assigned Access / Shell Launcher kiosk environment
    KioskRestriction,
    /// Reserved by Windows kernel/Winlogon (Ctrl+Alt+Del, Win+L) - cannot be swallowed by normal hook
    KernelRestricted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutItem {
    pub shortcut_id: String,
    pub display_name: String,
    pub key_combination: String,
    pub category: ShortcutCategory,
    pub description: String,
    pub risk_level: ShortcutRiskLevel,
    pub default_action: ShortcutAction,
    pub current_action: ShortcutAction,
    pub enforcement_type: ShortcutEnforcementType,
    pub is_accessibility_key: bool,
    pub is_system_reserved: bool,
}

pub struct ShortcutInventory;

impl ShortcutInventory {
    /// Return the standard comprehensive catalog of keyboard shortcuts evaluated in Phase 2C.
    pub fn get_standard_catalog() -> Vec<ShortcutItem> {
        vec![
            // Category A: Application Switching
            ShortcutItem {
                shortcut_id: "sc-alt-tab".to_string(),
                display_name: "Application Switcher (Forward)".to_string(),
                key_combination: "Alt + Tab".to_string(),
                category: ShortcutCategory::AppSwitching,
                description: "Switches between running windows and applications.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::LowLevelHook,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-alt-shift-tab".to_string(),
                display_name: "Application Switcher (Reverse)".to_string(),
                key_combination: "Alt + Shift + Tab".to_string(),
                category: ShortcutCategory::AppSwitching,
                description: "Switches between running applications in reverse order.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::LowLevelHook,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-alt-esc".to_string(),
                display_name: "Cycle Open Applications".to_string(),
                key_combination: "Alt + Esc".to_string(),
                category: ShortcutCategory::AppSwitching,
                description: "Cycles through open windows in the order they were opened.".to_string(),
                risk_level: ShortcutRiskLevel::High,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::LowLevelHook,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-win-tab".to_string(),
                display_name: "Task View & Virtual Desktops".to_string(),
                key_combination: "Win + Tab".to_string(),
                category: ShortcutCategory::AppSwitching,
                description: "Opens Task View and virtual desktop overview.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },

            // Category B: Windows Shell & Desktop Navigation
            ShortcutItem {
                shortcut_id: "sc-win-key".to_string(),
                display_name: "Start Menu (Windows Key)".to_string(),
                key_combination: "Win".to_string(),
                category: ShortcutCategory::ShellAndDesktop,
                description: "Opens Windows Start menu search and launcher.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-win-d".to_string(),
                display_name: "Show Desktop".to_string(),
                key_combination: "Win + D".to_string(),
                category: ShortcutCategory::ShellAndDesktop,
                description: "Minimizes all windows to display the Windows desktop.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-win-e".to_string(),
                display_name: "File Explorer Launch".to_string(),
                key_combination: "Win + E".to_string(),
                category: ShortcutCategory::ShellAndDesktop,
                description: "Launches File Explorer to browse local files and storage.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-win-r".to_string(),
                display_name: "Run Dialog".to_string(),
                key_combination: "Win + R".to_string(),
                category: ShortcutCategory::ShellAndDesktop,
                description: "Opens Windows Run dialog to execute arbitrary commands.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-win-x".to_string(),
                display_name: "Quick Link Administrative Menu".to_string(),
                key_combination: "Win + X".to_string(),
                category: ShortcutCategory::ShellAndDesktop,
                description: "Opens power user menu with administrative tool shortcuts.".to_string(),
                risk_level: ShortcutRiskLevel::High,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-win-i".to_string(),
                display_name: "Windows Settings".to_string(),
                key_combination: "Win + I".to_string(),
                category: ShortcutCategory::ShellAndDesktop,
                description: "Opens Windows Settings interface.".to_string(),
                risk_level: ShortcutRiskLevel::High,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-win-s".to_string(),
                display_name: "Windows Search".to_string(),
                key_combination: "Win + S".to_string(),
                category: ShortcutCategory::ShellAndDesktop,
                description: "Opens Windows system search bar.".to_string(),
                risk_level: ShortcutRiskLevel::High,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },

            // Category C: Task & Session Management
            ShortcutItem {
                shortcut_id: "sc-ctrl-shift-esc".to_string(),
                display_name: "Direct Task Manager Shortcut".to_string(),
                key_combination: "Ctrl + Shift + Esc".to_string(),
                category: ShortcutCategory::TaskAndSession,
                description: "Direct shortcut to launch Windows Task Manager.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::LowLevelHook,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-alt-f4".to_string(),
                display_name: "Close Window".to_string(),
                key_combination: "Alt + F4".to_string(),
                category: ShortcutCategory::TaskAndSession,
                description: "Attempts to terminate or close the active foreground window.".to_string(),
                risk_level: ShortcutRiskLevel::High,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::LowLevelHook,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-ctrl-alt-del".to_string(),
                display_name: "Secure Attention Sequence".to_string(),
                key_combination: "Ctrl + Alt + Del".to_string(),
                category: ShortcutCategory::TaskAndSession,
                description: "Hardware/kernel interrupt handled by Winlogon. Cannot be intercepted by userland hooks.".to_string(),
                risk_level: ShortcutRiskLevel::Critical,
                default_action: ShortcutAction::Monitor,
                current_action: ShortcutAction::Monitor,
                enforcement_type: ShortcutEnforcementType::KernelRestricted,
                is_accessibility_key: false,
                is_system_reserved: true,
            },
            ShortcutItem {
                shortcut_id: "sc-win-l".to_string(),
                display_name: "Lock Workstation".to_string(),
                key_combination: "Win + L".to_string(),
                category: ShortcutCategory::TaskAndSession,
                description: "Locks current user session. Handled by kernel/Winlogon.".to_string(),
                risk_level: ShortcutRiskLevel::Medium,
                default_action: ShortcutAction::Monitor,
                current_action: ShortcutAction::Monitor,
                enforcement_type: ShortcutEnforcementType::KernelRestricted,
                is_accessibility_key: false,
                is_system_reserved: true,
            },

            // Category D: Browser and Navigation
            ShortcutItem {
                shortcut_id: "sc-alt-arrows".to_string(),
                display_name: "History Back / Forward".to_string(),
                key_combination: "Alt + Left / Right".to_string(),
                category: ShortcutCategory::BrowserAndNav,
                description: "Navigates browser history backward or forward.".to_string(),
                risk_level: ShortcutRiskLevel::Low,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::FrontendInterception,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-ctrl-n-t".to_string(),
                display_name: "New Window or Tab".to_string(),
                key_combination: "Ctrl + N / Ctrl + T".to_string(),
                category: ShortcutCategory::BrowserAndNav,
                description: "Opens new browser window or tab.".to_string(),
                risk_level: ShortcutRiskLevel::Medium,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::FrontendInterception,
                is_accessibility_key: false,
                is_system_reserved: false,
            },

            // Category E: Clipboard Combinations
            ShortcutItem {
                shortcut_id: "sc-clipboard-ops".to_string(),
                display_name: "Clipboard Copy / Cut / Paste".to_string(),
                key_combination: "Ctrl + C / V / X".to_string(),
                category: ShortcutCategory::ClipboardTransfer,
                description: "Standard clipboard data transfer operations.".to_string(),
                risk_level: ShortcutRiskLevel::Medium,
                default_action: ShortcutAction::Restrict,
                current_action: ShortcutAction::Restrict,
                enforcement_type: ShortcutEnforcementType::FrontendInterception,
                is_accessibility_key: false,
                is_system_reserved: false,
            },

            // Category F: Print & Screen Capture
            ShortcutItem {
                shortcut_id: "sc-printscreen".to_string(),
                display_name: "Print Screen Capture".to_string(),
                key_combination: "Print Screen".to_string(),
                category: ShortcutCategory::PrintAndCapture,
                description: "Captures full desktop bitmap to clipboard.".to_string(),
                risk_level: ShortcutRiskLevel::High,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::LowLevelHook,
                is_accessibility_key: false,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-win-shift-s".to_string(),
                display_name: "Snipping Tool Snippet".to_string(),
                key_combination: "Win + Shift + S".to_string(),
                category: ShortcutCategory::PrintAndCapture,
                description: "Launches Windows Snipping Tool screen clipper.".to_string(),
                risk_level: ShortcutRiskLevel::High,
                default_action: ShortcutAction::Block,
                current_action: ShortcutAction::Block,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: false,
                is_system_reserved: false,
            },

            // Category G: Accessibility Combinations
            ShortcutItem {
                shortcut_id: "sc-sticky-keys".to_string(),
                display_name: "Sticky Keys Activation".to_string(),
                key_combination: "Shift (5 consecutive presses)".to_string(),
                category: ShortcutCategory::Accessibility,
                description: "Toggles Windows Sticky Keys for physical motor accommodations.".to_string(),
                risk_level: ShortcutRiskLevel::AccessibilityAccommodation,
                default_action: ShortcutAction::Allow,
                current_action: ShortcutAction::Allow,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: true,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-filter-keys".to_string(),
                display_name: "Filter Keys Activation".to_string(),
                key_combination: "Right Shift (Hold for 8 seconds)".to_string(),
                category: ShortcutCategory::Accessibility,
                description: "Toggles Windows Filter Keys for keyboard repeat rate adjustments.".to_string(),
                risk_level: ShortcutRiskLevel::AccessibilityAccommodation,
                default_action: ShortcutAction::Allow,
                current_action: ShortcutAction::Allow,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: true,
                is_system_reserved: false,
            },
            ShortcutItem {
                shortcut_id: "sc-high-contrast".to_string(),
                display_name: "High Contrast Mode".to_string(),
                key_combination: "Left Alt + Left Shift + PrintScreen".to_string(),
                category: ShortcutCategory::Accessibility,
                description: "Toggles high contrast color palette for vision accommodation.".to_string(),
                risk_level: ShortcutRiskLevel::AccessibilityAccommodation,
                default_action: ShortcutAction::Allow,
                current_action: ShortcutAction::Allow,
                enforcement_type: ShortcutEnforcementType::WindowsNativePolicy,
                is_accessibility_key: true,
                is_system_reserved: false,
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_standard_catalog_categories() {
        let catalog = ShortcutInventory::get_standard_catalog();
        assert!(catalog.len() >= 15);

        let app_switch = catalog.iter().filter(|i| i.category == ShortcutCategory::AppSwitching).count();
        assert!(app_switch >= 3);

        let shell = catalog.iter().filter(|i| i.category == ShortcutCategory::ShellAndDesktop).count();
        assert!(shell >= 5);

        let accessibility = catalog.iter().filter(|i| i.is_accessibility_key).count();
        assert!(accessibility >= 3);
    }

    #[test]
    fn test_kernel_restricted_honesty() {
        let catalog = ShortcutInventory::get_standard_catalog();
        let cad = catalog.iter().find(|i| i.shortcut_id == "sc-ctrl-alt-del").unwrap();
        assert_eq!(cad.enforcement_type, ShortcutEnforcementType::KernelRestricted);
        assert!(cad.is_system_reserved);

        let win_l = catalog.iter().find(|i| i.shortcut_id == "sc-win-l").unwrap();
        assert_eq!(win_l.enforcement_type, ShortcutEnforcementType::KernelRestricted);
        assert!(win_l.is_system_reserved);
    }
}

