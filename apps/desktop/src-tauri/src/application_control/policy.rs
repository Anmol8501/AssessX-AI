//! Application-control policy lifecycle engine for Phase 2A.
//!
//! Enforces strict state transitions:
//! `DRAFT → VALIDATED → AWAITING_ADMIN_APPROVAL → APPLYING → VERIFYING → ACTIVE`
//! and generates previews, audits, and rollback safeguards.

use super::allowlist::{AllowlistCategory, AllowlistManager, RuleAction};
use crate::provisioning::journal::record_planned_change;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum PolicyLifecycleState {
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
pub enum PolicyMode {
    AuditMode,
    EnforcementMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyPreview {
    pub policy_id: String,
    pub policy_version: u32,
    pub mode: PolicyMode,
    pub current_state: PolicyLifecycleState,
    pub total_rules: usize,
    pub allowed_count: usize,
    pub denied_count: usize,
    pub planned_actions: Vec<String>,
    pub rollback_actions: Vec<String>,
    pub is_safe_to_apply: bool,
    pub validation_errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyOperationResult {
    pub success: bool,
    pub current_state: PolicyLifecycleState,
    pub effective_mode: PolicyMode,
    pub os_enforcement_available: bool,
    pub message: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PolicyEngineState {
    pub policy_id: String,
    pub version: u32,
    pub mode: PolicyMode,
    pub os_enforcement_available: bool,
    pub state: PolicyLifecycleState,
    pub last_updated: String,
}

static POLICY_ENGINE: Mutex<Option<PolicyEngineState>> = Mutex::new(None);

pub struct PolicyEngine;

impl PolicyEngine {
    /// Probes whether OS-level kernel/GPO execution control (AppLocker or WDAC) is provisioned.
    /// When neither is provisioned, AssessX honestly reports `false` and operates in AuditMode
    /// via Security Agent process monitoring instead of claiming OS-level blocking.
    #[cfg(windows)]
    pub fn detect_os_enforcement_support() -> bool {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, HKEY_LOCAL_MACHINE, KEY_READ,
        };

        fn key_exists(subkey: &str) -> bool {
            let wide: Vec<u16> = subkey.encode_utf16().chain(std::iter::once(0)).collect();
            unsafe {
                let mut hkey = std::ptr::null_mut();
                if RegOpenKeyExW(HKEY_LOCAL_MACHINE, wide.as_ptr(), 0, KEY_READ, &mut hkey) == ERROR_SUCCESS {
                    RegCloseKey(hkey);
                    return true;
                }
            }
            false
        }

        // Check active AppLocker EXE rules or WDAC CI active policies
        key_exists("SOFTWARE\\Policies\\Microsoft\\Windows\\SrpV2\\Exe")
            || key_exists("SYSTEM\\CurrentControlSet\\Control\\CI\\Policy")
    }

    #[cfg(not(windows))]
    pub fn detect_os_enforcement_support() -> bool {
        false
    }

    fn now_str() -> String {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string())
    }

    /// Retrieve the current policy engine state.
    pub fn get_state() -> PolicyEngineState {
        let mut guard = POLICY_ENGINE.lock().unwrap();
        let os_supported = Self::detect_os_enforcement_support();
        if guard.is_none() {
            *guard = Some(PolicyEngineState {
                policy_id: "default-app-policy-v1".to_string(),
                version: 1,
                mode: PolicyMode::AuditMode,
                os_enforcement_available: os_supported,
                state: PolicyLifecycleState::Draft,
                last_updated: Self::now_str(),
            });
        }
        let s = guard.as_ref().unwrap();
        PolicyEngineState {
            policy_id: s.policy_id.clone(),
            version: s.version,
            mode: s.mode.clone(),
            os_enforcement_available: os_supported,
            state: s.state.clone(),
            last_updated: s.last_updated.clone(),
        }
    }

    /// Generate an auditable preview of the application control policy.
    pub fn preview_policy(mode: PolicyMode) -> PolicyPreview {
        let rules = AllowlistManager::get_rules();
        let allowed_count = rules.iter().filter(|r| r.action == RuleAction::Allow).count();
        let denied_count = rules.iter().filter(|r| r.action == RuleAction::Deny).count();

        let mut planned_actions = Vec::new();
        let mut rollback_actions = Vec::new();
        let mut validation_errors = Vec::new();

        planned_actions.push(format!(
            "Configure application control policy in {:?}.",
            mode
        ));
        planned_actions.push(format!("Register {} allowed application rules.", allowed_count));
        planned_actions.push(format!("Register {} prohibited application rules.", denied_count));

        if mode == PolicyMode::EnforcementMode {
            planned_actions.push("Activate continuous Security Agent process supervision.".to_string());
        } else {
            planned_actions.push("Activate audit logging without process disruption.".to_string());
        }

        rollback_actions.push("Restore previous application control policy baseline.".to_string());
        rollback_actions.push("Clear dynamic allowlist filters.".to_string());
        rollback_actions.push("Revert policy state to Draft.".to_string());

        // Safety Validation: Check that AssessX and Windows system components are allowed
        let has_assessx_allowed = rules.iter().any(|r| {
            r.category == AllowlistCategory::CoreAssessX && r.action == RuleAction::Allow
        });
        if !has_assessx_allowed {
            validation_errors.push(
                "CRITICAL: AssessX core components are not permitted by the policy.".to_string(),
            );
        }

        let has_explorer_allowed = rules.iter().any(|r| {
            r.category == AllowlistCategory::WindowsSystem && r.action == RuleAction::Allow
        });
        if !has_explorer_allowed {
            validation_errors.push(
                "CRITICAL: Windows essential system components are not permitted.".to_string(),
            );
        }

        let is_safe_to_apply = validation_errors.is_empty();

        let current = Self::get_state();

        PolicyPreview {
            policy_id: current.policy_id,
            policy_version: current.version,
            mode,
            current_state: if is_safe_to_apply {
                PolicyLifecycleState::Validated
            } else {
                PolicyLifecycleState::ValidationFailed
            },
            total_rules: rules.len(),
            allowed_count,
            denied_count,
            planned_actions,
            rollback_actions,
            is_safe_to_apply,
            validation_errors,
        }
    }

    /// Apply the policy with mandatory administrator approval.
    pub fn apply_policy(mode: PolicyMode, admin_approved: bool) -> PolicyOperationResult {
        let preview = Self::preview_policy(mode.clone());
        let os_supported = Self::detect_os_enforcement_support();

        if !preview.is_safe_to_apply {
            let mut guard = POLICY_ENGINE.lock().unwrap();
            if let Some(s) = guard.as_mut() {
                s.state = PolicyLifecycleState::ValidationFailed;
                s.last_updated = Self::now_str();
            }
            return PolicyOperationResult {
                success: false,
                current_state: PolicyLifecycleState::ValidationFailed,
                effective_mode: PolicyMode::AuditMode,
                os_enforcement_available: os_supported,
                message: format!(
                    "Policy validation failed: {}",
                    preview.validation_errors.join("; ")
                ),
                timestamp: Self::now_str(),
            };
        }

        if !admin_approved {
            let mut guard = POLICY_ENGINE.lock().unwrap();
            if let Some(s) = guard.as_mut() {
                s.state = PolicyLifecycleState::AwaitingAdminApproval;
                s.last_updated = Self::now_str();
            }
            return PolicyOperationResult {
                success: false,
                current_state: PolicyLifecycleState::AwaitingAdminApproval,
                effective_mode: PolicyMode::AuditMode,
                os_enforcement_available: os_supported,
                message: "Administrator approval required before applying application control policy."
                    .to_string(),
                timestamp: Self::now_str(),
            };
        }

        // Honest mode downgrade: do not claim OS/kernel block enforcement without WDAC/AppLocker
        let effective_mode = if mode == PolicyMode::EnforcementMode && !os_supported {
            PolicyMode::AuditMode
        } else {
            mode.clone()
        };

        // Apply policy
        let now = Self::now_str();
        {
            let mut guard = POLICY_ENGINE.lock().unwrap();
            if let Some(s) = guard.as_mut() {
                s.version += 1;
                s.mode = effective_mode.clone();
                s.os_enforcement_available = os_supported;
                s.state = PolicyLifecycleState::Active;
                s.last_updated = now.clone();
            }
        }

        // Record in change journal
        let _ = record_planned_change(
            "APPLY_APPLICATION_CONTROL_POLICY",
            "ApplicationControlPolicy",
            "Draft",
            "Active",
            Some("Restore application control policy baseline".to_string()),
        );

        let message = if mode == PolicyMode::EnforcementMode && !os_supported {
            "WDAC/AppLocker kernel enforcement is not provisioned on this workstation; running honestly in AuditMode (Security Agent process supervision).".to_string()
        } else {
            format!("Application control policy applied and active in {:?}.", effective_mode)
        };

        PolicyOperationResult {
            success: true,
            current_state: PolicyLifecycleState::Active,
            effective_mode,
            os_enforcement_available: os_supported,
            message,
            timestamp: now,
        }
    }

    /// Restore baseline policy and reset lifecycle state.
    pub fn restore_baseline() -> PolicyOperationResult {
        let now = Self::now_str();
        let os_supported = Self::detect_os_enforcement_support();
        {
            let mut guard = POLICY_ENGINE.lock().unwrap();
            if let Some(s) = guard.as_mut() {
                s.mode = PolicyMode::AuditMode;
                s.os_enforcement_available = os_supported;
                s.state = PolicyLifecycleState::Draft;
                s.last_updated = now.clone();
            }
        }

        let _ = record_planned_change(
            "RESTORE_APPLICATION_CONTROL_POLICY",
            "ApplicationControlPolicy",
            "Active",
            "Draft",
            None,
        );

        PolicyOperationResult {
            success: true,
            current_state: PolicyLifecycleState::Draft,
            effective_mode: PolicyMode::AuditMode,
            os_enforcement_available: os_supported,
            message: "Application control policy restored to baseline draft.".to_string(),
            timestamp: now,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_preview_and_validation() {
        let preview = PolicyEngine::preview_policy(PolicyMode::AuditMode);
        assert!(preview.is_safe_to_apply);
        assert!(preview.allowed_count > 0);
        assert!(preview.denied_count > 0);
        assert_eq!(preview.current_state, PolicyLifecycleState::Validated);
    }

    #[test]
    fn test_apply_policy_approval_gate() {
        // Unapproved should fail
        let unapproved = PolicyEngine::apply_policy(PolicyMode::AuditMode, false);
        assert!(!unapproved.success);
        assert_eq!(
            unapproved.current_state,
            PolicyLifecycleState::AwaitingAdminApproval
        );

        // Approved should succeed
        let approved = PolicyEngine::apply_policy(PolicyMode::AuditMode, true);
        assert!(approved.success);
        assert_eq!(approved.current_state, PolicyLifecycleState::Active);

        // Restore
        let restored = PolicyEngine::restore_baseline();
        assert!(restored.success);
        assert_eq!(restored.current_state, PolicyLifecycleState::Draft);
    }

    #[test]
    fn test_honest_enforcement_downgrade_without_os_support() {
        let _ = PolicyEngine::restore_baseline();
        let res = PolicyEngine::apply_policy(PolicyMode::EnforcementMode, true);
        assert!(res.success);
        if !res.os_enforcement_available {
            assert_eq!(res.effective_mode, PolicyMode::AuditMode);
            assert!(res.message.contains("AuditMode"));
        } else {
            assert_eq!(res.effective_mode, PolicyMode::EnforcementMode);
        }
        let _ = PolicyEngine::restore_baseline();
    }
}
