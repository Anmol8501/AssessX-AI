//! Centralized Shortcut & Navigation Policy Engine & Lifecycle (Phase 2C).
//!
//! Provides validation, conflict analysis, administrator approval gating,
//! verification, and safe rollback for keyboard and navigation restrictions.

use super::inventory::{ShortcutAction, ShortcutCategory, ShortcutInventory};
use crate::security_agent::logger::{log_info, log_warn};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum NavigationPolicyLifecycleState {
    Draft,
    Validated,
    AwaitingAdminApproval,
    Applying,
    Verifying,
    Active,
    ValidationFailed,
    ApprovalDenied,
    ApplyFailed,
    VerificationFailed,
    RestorationRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutRuleOverride {
    pub shortcut_id: String,
    pub action: ShortcutAction,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationControlPolicyConfig {
    pub id: String,
    pub version: u32,
    pub app_switching_blocked: bool,
    pub windows_keys_blocked: bool,
    pub task_view_blocked: bool,
    pub screen_capture_blocked: bool,
    pub browser_shortcuts_blocked: bool,
    pub taskbar_navigation_blocked: bool,
    pub run_dialog_blocked: bool,
    pub search_interface_blocked: bool,
    pub desktop_surface_blocked: bool,
    pub accessibility_accommodations_allowed: bool,
    pub custom_overrides: Vec<ShortcutRuleOverride>,
    pub candidate_account: Option<String>,
    pub candidate_sid: Option<String>,
    pub state: NavigationPolicyLifecycleState,
    pub admin_approved: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationConflictItem {
    pub shortcut_id: String,
    pub conflict_type: String,
    pub severity: String,
    pub description: String,
    pub recommended_resolution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NavigationPolicyPreview {
    pub total_shortcuts_configured: usize,
    pub total_blocked: usize,
    pub total_monitored: usize,
    pub accessibility_exceptions_active: usize,
    pub conflicts: Vec<NavigationConflictItem>,
    pub is_valid: bool,
    pub affected_registry_keys: Vec<String>,
    pub safety_summary: String,
}

static ACTIVE_NAV_POLICY: Mutex<Option<NavigationControlPolicyConfig>> = Mutex::new(None);

pub struct NavigationPolicyEngine;

impl NavigationPolicyEngine {
    /// Return the active policy or default audit/baseline configuration.
    pub fn get_policy() -> NavigationControlPolicyConfig {
        let mut guard = ACTIVE_NAV_POLICY.lock().unwrap();
        if let Some(ref policy) = *guard {
            policy.clone()
        } else {
            let default_policy = NavigationControlPolicyConfig {
                id: "default-nav-control-policy".to_string(),
                version: 1,
                app_switching_blocked: false,
                windows_keys_blocked: false,
                task_view_blocked: false,
                screen_capture_blocked: false,
                browser_shortcuts_blocked: false,
                taskbar_navigation_blocked: false,
                run_dialog_blocked: false,
                search_interface_blocked: false,
                desktop_surface_blocked: false,
                accessibility_accommodations_allowed: true,
                custom_overrides: Vec::new(),
                candidate_account: Some("AssessXCandidate".to_string()),
                candidate_sid: None,
                state: NavigationPolicyLifecycleState::Active,
                admin_approved: true,
                updated_at: Self::timestamp_str(),
            };
            *guard = Some(default_policy.clone());
            default_policy
        }
    }

    /// Validate and store a proposed navigation policy before administrator application.
    pub fn set_policy(mut policy: NavigationControlPolicyConfig) -> Result<NavigationControlPolicyConfig, String> {
        let preview = Self::validate_and_preview(&policy);
        if !preview.is_valid {
            return Err(preview.safety_summary);
        }
        policy.state = NavigationPolicyLifecycleState::Validated;
        policy.updated_at = Self::timestamp_str();
        *ACTIVE_NAV_POLICY.lock().unwrap() = Some(policy.clone());
        Ok(policy)
    }

    /// Validate a proposed navigation policy for accessibility conflicts and structural safety.
    pub fn validate_and_preview(policy: &NavigationControlPolicyConfig) -> NavigationPolicyPreview {
        let catalog = ShortcutInventory::get_standard_catalog();
        let mut conflicts = Vec::new();
        let mut total_blocked = 0;
        let mut total_monitored = 0;
        let mut accessibility_exceptions = 0;

        for item in &catalog {
            let mut effective_action = item.default_action;

            // Apply category flags
            match item.category {
                ShortcutCategory::AppSwitching => {
                    if policy.app_switching_blocked {
                        effective_action = ShortcutAction::Block;
                    }
                }
                ShortcutCategory::ShellAndDesktop => {
                    if policy.windows_keys_blocked {
                        effective_action = ShortcutAction::Block;
                    }
                }
                ShortcutCategory::PrintAndCapture => {
                    if policy.screen_capture_blocked {
                        effective_action = ShortcutAction::Block;
                    }
                }
                ShortcutCategory::BrowserAndNav => {
                    if policy.browser_shortcuts_blocked {
                        effective_action = ShortcutAction::Block;
                    }
                }
                ShortcutCategory::Accessibility => {
                    if policy.accessibility_accommodations_allowed {
                        effective_action = ShortcutAction::Allow;
                        accessibility_exceptions += 1;
                    }
                }
                _ => {}
            }

            // Check custom overrides
            if let Some(rule) = policy.custom_overrides.iter().find(|r| r.shortcut_id == item.shortcut_id) {
                effective_action = rule.action;
            }

            // Check Accessibility Conflicts
            if item.is_accessibility_key && effective_action == ShortcutAction::Block {
                if policy.accessibility_accommodations_allowed {
                    conflicts.push(NavigationConflictItem {
                        shortcut_id: item.shortcut_id.clone(),
                        conflict_type: "ACCESSIBILITY_OVERRIDE_CONFLICT".to_string(),
                        severity: "WARNING".to_string(),
                        description: format!(
                            "Shortcut '{}' ({}) is an accessibility tool but is configured as Blocked.",
                            item.display_name, item.key_combination
                        ),
                        recommended_resolution: "Allow accessibility accommodation or configure an institutional waiver.".to_string(),
                    });
                }
            }

            // Check Kernel-restricted Sequences honesty
            if item.is_system_reserved && effective_action == ShortcutAction::Block {
                conflicts.push(NavigationConflictItem {
                    shortcut_id: item.shortcut_id.clone(),
                    conflict_type: "KERNEL_RESTRICTION_UNAVAILABLE".to_string(),
                    severity: "INFO".to_string(),
                    description: format!(
                        "'{}' is handled below userland hooks by Winlogon. It cannot be swallowed; focus loss monitoring will track activation.",
                        item.key_combination
                    ),
                    recommended_resolution: "Rely on Assigned Access kiosk or candidate account isolation.".to_string(),
                });
            }

            match effective_action {
                ShortcutAction::Block => total_blocked += 1,
                ShortcutAction::Monitor => total_monitored += 1,
                _ => {}
            }
        }

        let is_valid = conflicts.iter().all(|c| c.severity != "CRITICAL_ERROR");

        let mut affected_keys = Vec::new();
        if policy.windows_keys_blocked {
            affected_keys.push("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoWinKeys".to_string());
        }
        if policy.run_dialog_blocked {
            affected_keys.push("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoRun".to_string());
        }
        if policy.search_interface_blocked {
            affected_keys.push("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoFind".to_string());
        }
        if policy.taskbar_navigation_blocked {
            affected_keys.push("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoTrayContextMenu".to_string());
            affected_keys.push("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoSetTaskbar".to_string());
        }
        if policy.desktop_surface_blocked {
            affected_keys.push("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoDesktop".to_string());
        }

        let safety_summary = if is_valid {
            format!(
                "Policy valid: {} shortcuts blocked, {} monitored. {} accessibility accommodation(s) active.",
                total_blocked, total_monitored, accessibility_exceptions
            )
        } else {
            "Policy rejected: Violates mandatory safety or accessibility boundaries.".to_string()
        };

        NavigationPolicyPreview {
            total_shortcuts_configured: catalog.len(),
            total_blocked,
            total_monitored,
            accessibility_exceptions_active: accessibility_exceptions,
            conflicts,
            is_valid,
            affected_registry_keys: affected_keys,
            safety_summary,
        }
    }

    /// Apply an administrator-approved navigation policy with verification and change logging.
    pub fn apply_policy(
        mut policy: NavigationControlPolicyConfig,
        admin_approval_confirmed: bool,
    ) -> Result<NavigationControlPolicyConfig, String> {
        if !admin_approval_confirmed {
            policy.state = NavigationPolicyLifecycleState::ApprovalDenied;
            return Err("Administrator approval gate: Explicit confirmation required to apply keyboard and navigation restrictions.".to_string());
        }

        let preview = Self::validate_and_preview(&policy);
        if !preview.is_valid {
            policy.state = NavigationPolicyLifecycleState::ValidationFailed;
            return Err("Policy validation failed: Cannot apply conflicting or unsafe navigation policy.".to_string());
        }

        policy.state = NavigationPolicyLifecycleState::Applying;
        let candidate_sid = policy.candidate_sid.as_deref();

        // 1. Apply native Windows Explorer registry policies
        if let Err(e) = super::native_enforcement::NativeEnforcementManager::apply_explorer_policies(
            &policy,
            candidate_sid,
        ) {
            policy.state = NavigationPolicyLifecycleState::ApplyFailed;
            return Err(format!("Failed applying native Explorer navigation policies: {}", e));
        }

        // 2. Verification stage
        policy.state = NavigationPolicyLifecycleState::Verifying;
        let verified = super::native_enforcement::NativeEnforcementManager::verify_explorer_policies(
            &policy,
            candidate_sid,
        );

        if !verified {
            policy.state = NavigationPolicyLifecycleState::VerificationFailed;
            log_warn("NavigationPolicyEngine", "Policy verification mismatch after application. Reverting to safe baseline.");
            let _ = Self::revert_to_default();
            return Err("Verification failed: Windows registry did not reflect expected policy values. Reverted to baseline.".to_string());
        }

        policy.state = NavigationPolicyLifecycleState::Active;
        policy.admin_approved = true;
        policy.updated_at = Self::timestamp_str();

        log_info("NavigationPolicyEngine", &format!("Successfully applied and verified navigation policy v{}", policy.version));
        *ACTIVE_NAV_POLICY.lock().unwrap() = Some(policy.clone());

        Ok(policy)
    }

    /// Revert all navigation policies back to default detection-only baseline.
    pub fn revert_to_default() -> Result<NavigationControlPolicyConfig, String> {
        log_info("NavigationPolicyEngine", "Reverting all navigation restrictions to safe default baseline");
        let candidate_sid: Option<&str> = None;

        let _ = super::native_enforcement::NativeEnforcementManager::remove_all_explorer_policies(candidate_sid);

        let default_policy = NavigationControlPolicyConfig {
            id: "default-nav-control-policy".to_string(),
            version: 1,
            app_switching_blocked: false,
            windows_keys_blocked: false,
            task_view_blocked: false,
            screen_capture_blocked: false,
            browser_shortcuts_blocked: false,
            taskbar_navigation_blocked: false,
            run_dialog_blocked: false,
            search_interface_blocked: false,
            desktop_surface_blocked: false,
            accessibility_accommodations_allowed: true,
            custom_overrides: Vec::new(),
            candidate_account: Some("AssessXCandidate".to_string()),
            candidate_sid: None,
            state: NavigationPolicyLifecycleState::Active,
            admin_approved: true,
            updated_at: Self::timestamp_str(),
        };

        *ACTIVE_NAV_POLICY.lock().unwrap() = Some(default_policy.clone());
        Ok(default_policy)
    }

    fn timestamp_str() -> String {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_policy() {
        let policy = NavigationPolicyEngine::get_policy();
        assert!(!policy.app_switching_blocked);
        assert!(!policy.windows_keys_blocked);
        assert!(policy.accessibility_accommodations_allowed);
        assert_eq!(policy.state, NavigationPolicyLifecycleState::Active);
    }

    #[test]
    fn test_preview_generation_with_accommodations() {
        let mut policy = NavigationPolicyEngine::get_policy();
        policy.app_switching_blocked = true;
        policy.windows_keys_blocked = true;
        policy.run_dialog_blocked = true;

        let preview = NavigationPolicyEngine::validate_and_preview(&policy);
        assert!(preview.is_valid);
        assert!(preview.total_blocked > 5);
        assert!(preview.affected_registry_keys.contains(&"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoWinKeys".to_string()));
        assert!(preview.affected_registry_keys.contains(&"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer\\NoRun".to_string()));
    }

    #[test]
    fn test_approval_gate() {
        let policy = NavigationPolicyEngine::get_policy();
        let result = NavigationPolicyEngine::apply_policy(policy, false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Administrator approval gate"));
    }
}
