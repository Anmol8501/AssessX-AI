//! Centralized System Utility Policy Manager, Conflict Detection & Lifecycle (Phase 2B).
//!
//! Provides validation, conflict analysis, administrator approval gating,
//! verification, and safe rollback for system utility restrictions.

use super::cmd::{CmdManager, CmdRestrictionMode};
use super::inventory::{SystemUtilityInventory, UtilityPolicyAction};
use super::powershell::{PowerShellManager, PowerShellRestrictionMode};
use super::registry_policy::{RegistryPolicyEngine, RegistryPolicyTarget};
use super::task_manager::{TaskManagerPolicy, TaskManagerRestrictionMode};
use crate::security_agent::logger::{log_info, log_warn};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum UtilityPolicyLifecycleState {
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
pub struct UtilityPolicyRule {
    pub utility_id: String,
    pub executable_name: String,
    pub action: UtilityPolicyAction,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemUtilityPolicyConfig {
    pub id: String,
    pub version: u32,
    pub powershell_mode: PowerShellRestrictionMode,
    pub cmd_mode: CmdRestrictionMode,
    pub task_manager_mode: TaskManagerRestrictionMode,
    pub registry_tools_blocked: bool,
    pub utility_rules: Vec<UtilityPolicyRule>,
    pub candidate_account: Option<String>,
    pub candidate_sid: Option<String>,
    pub state: UtilityPolicyLifecycleState,
    pub admin_approved: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UtilityConflictItem {
    pub executable_name: String,
    pub conflict_type: String,
    pub severity: String,
    pub description: String,
    pub recommended_resolution: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UtilityPolicyPreview {
    pub total_rules: usize,
    pub blocked_utilities_count: usize,
    pub restricted_utilities_count: usize,
    pub conflicts: Vec<UtilityConflictItem>,
    pub is_valid: bool,
    pub affected_registry_keys: Vec<String>,
    pub safety_summary: String,
}

static ACTIVE_UTILITY_POLICY: Mutex<Option<SystemUtilityPolicyConfig>> = Mutex::new(None);

pub struct SystemUtilityPolicyEngine;

impl SystemUtilityPolicyEngine {
    /// Return the active policy or default detection-only configuration.
    pub fn get_policy() -> SystemUtilityPolicyConfig {
        let mut guard = ACTIVE_UTILITY_POLICY.lock().unwrap();
        if let Some(ref policy) = *guard {
            policy.clone()
        } else {
            let default_policy = SystemUtilityPolicyConfig {
                id: "default-system-utility-policy".to_string(),
                version: 1,
                powershell_mode: PowerShellRestrictionMode::DetectionOnly,
                cmd_mode: CmdRestrictionMode::DetectionOnly,
                task_manager_mode: TaskManagerRestrictionMode::DetectionOnly,
                registry_tools_blocked: false,
                utility_rules: Vec::new(),
                candidate_account: Some("AssessXCandidate".to_string()),
                candidate_sid: None,
                state: UtilityPolicyLifecycleState::Active,
                admin_approved: true,
                updated_at: Self::timestamp_str(),
            };
            *guard = Some(default_policy.clone());
            default_policy
        }
    }

    /// Validate a proposed utility policy for safety, structural integrity, and component conflicts.
    pub fn validate_and_preview(policy: &SystemUtilityPolicyConfig) -> UtilityPolicyPreview {
        let mut conflicts = Vec::new();
        let mut blocked_count = 0;
        let mut restricted_count = 0;

        if policy.powershell_mode == PowerShellRestrictionMode::Block {
            blocked_count += 1;
        } else if policy.powershell_mode == PowerShellRestrictionMode::Restrict {
            restricted_count += 1;
        }

        if policy.cmd_mode == CmdRestrictionMode::Block {
            blocked_count += 1;
        } else if policy.cmd_mode == CmdRestrictionMode::Restrict {
            restricted_count += 1;
        }

        if policy.task_manager_mode == TaskManagerRestrictionMode::Block {
            blocked_count += 1;
        }

        if policy.registry_tools_blocked {
            blocked_count += 1;
        }

        // Check utility-specific rules for critical component conflicts
        for rule in &policy.utility_rules {
            if SystemUtilityInventory::is_protected_system_utility(&rule.executable_name) {
                if rule.action == UtilityPolicyAction::Block || rule.action == UtilityPolicyAction::Restrict {
                    conflicts.push(UtilityConflictItem {
                        executable_name: rule.executable_name.clone(),
                        conflict_type: "CRITICAL_COMPONENT_PROTECTION".to_string(),
                        severity: "CRITICAL_ERROR".to_string(),
                        description: format!(
                            "Attempting to block or restrict core OS component '{}'. This would cause desktop instability.",
                            rule.executable_name
                        ),
                        recommended_resolution: "Remove rule or set action to Allow.".to_string(),
                    });
                }
            }

            match rule.action {
                UtilityPolicyAction::Block => blocked_count += 1,
                UtilityPolicyAction::Restrict => restricted_count += 1,
                _ => {}
            }
        }

        // Check account scoping safety
        if policy.candidate_sid.is_none() && policy.candidate_account.is_none() {
            if blocked_count > 0 {
                conflicts.push(UtilityConflictItem {
                    executable_name: "ALL".to_string(),
                    conflict_type: "MACHINE_WIDE_SCOPE_WARNING".to_string(),
                    severity: "WARNING".to_string(),
                    description: "No candidate account specified. Policy would apply to current user session.".to_string(),
                    recommended_resolution: "Scope policy to AssessXCandidate user account.".to_string(),
                });
            }
        }

        let is_valid = conflicts.iter().all(|c| c.severity != "CRITICAL_ERROR");

        let mut affected_keys = Vec::new();
        if policy.task_manager_mode == TaskManagerRestrictionMode::Block {
            affected_keys.push("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\DisableTaskMgr".to_string());
        }
        if policy.cmd_mode != CmdRestrictionMode::Allow && policy.cmd_mode != CmdRestrictionMode::DetectionOnly {
            affected_keys.push("HKCU\\Software\\Policies\\Microsoft\\Windows\\System\\DisableCMD".to_string());
        }
        if policy.registry_tools_blocked {
            affected_keys.push("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System\\DisableRegistryTools".to_string());
        }

        let safety_summary = if is_valid {
            format!("Policy valid: {} utilities blocked, {} restricted. Safety boundaries satisfied.", blocked_count, restricted_count)
        } else {
            "Policy rejected: Violates core operating system protection boundaries.".to_string()
        };

        UtilityPolicyPreview {
            total_rules: policy.utility_rules.len(),
            blocked_utilities_count: blocked_count,
            restricted_utilities_count: restricted_count,
            conflicts,
            is_valid,
            affected_registry_keys: affected_keys,
            safety_summary,
        }
    }

    /// Apply an administrator-approved utility policy with journal logging and verification.
    pub fn apply_policy(
        mut policy: SystemUtilityPolicyConfig,
        admin_approval_confirmed: bool,
    ) -> Result<SystemUtilityPolicyConfig, String> {
        if !admin_approval_confirmed {
            policy.state = UtilityPolicyLifecycleState::ApprovalDenied;
            return Err("Administrator approval gate: Explicit confirmation required to apply system utility restrictions.".to_string());
        }

        let preview = Self::validate_and_preview(&policy);
        if !preview.is_valid {
            policy.state = UtilityPolicyLifecycleState::ValidationFailed;
            return Err("Policy validation failed: Cannot apply conflicting or unsafe policy.".to_string());
        }

        policy.state = UtilityPolicyLifecycleState::Applying;
        let candidate_sid = policy.candidate_sid.as_deref();

        // 1. Apply PowerShell policy
        if let Err(e) = PowerShellManager::apply_policy(policy.powershell_mode, candidate_sid) {
            policy.state = UtilityPolicyLifecycleState::ApplyFailed;
            return Err(format!("Failed applying PowerShell policy: {}", e));
        }

        // 2. Apply CMD policy
        if let Err(e) = CmdManager::apply_policy(policy.cmd_mode, candidate_sid) {
            policy.state = UtilityPolicyLifecycleState::ApplyFailed;
            return Err(format!("Failed applying CMD policy: {}", e));
        }

        // 3. Apply Task Manager policy
        if let Err(e) = TaskManagerPolicy::apply_policy(policy.task_manager_mode, candidate_sid) {
            policy.state = UtilityPolicyLifecycleState::ApplyFailed;
            return Err(format!("Failed applying Task Manager policy: {}", e));
        }

        // 4. Apply Registry Tools policy if specified
        if policy.registry_tools_blocked {
            if let Err(e) = RegistryPolicyEngine::apply_and_verify(
                RegistryPolicyTarget::DisableRegistryTools,
                1,
                candidate_sid,
            ) {
                policy.state = UtilityPolicyLifecycleState::ApplyFailed;
                return Err(format!("Failed applying Registry Tools policy: {}", e));
            }
        } else {
            let _ = RegistryPolicyEngine::remove_policy(RegistryPolicyTarget::DisableRegistryTools, candidate_sid);
        }

        // 5. Verification stage
        policy.state = UtilityPolicyLifecycleState::Verifying;
        let verified_cmd = CmdManager::inspect_cmd(candidate_sid);
        let verified_tm = TaskManagerPolicy::inspect_task_manager(candidate_sid);

        let cmd_ok = match policy.cmd_mode {
            CmdRestrictionMode::Block => verified_cmd.disable_cmd_registry_value == Some(2),
            CmdRestrictionMode::Restrict => verified_cmd.disable_cmd_registry_value == Some(1),
            _ => true,
        };

        let tm_ok = match policy.task_manager_mode {
            TaskManagerRestrictionMode::Block => verified_tm.disable_taskmgr_registry_value == Some(1),
            _ => true,
        };

        if !cmd_ok || !tm_ok {
            policy.state = UtilityPolicyLifecycleState::VerificationFailed;
            log_warn("SystemUtilityPolicy", "Policy verification mismatch after application. Reverting to safe baseline.");
            let _ = Self::revert_to_default();
            return Err("Verification failed: Windows registry did not reflect expected policy values. Reverted to baseline.".to_string());
        }

        policy.state = UtilityPolicyLifecycleState::Active;
        policy.admin_approved = true;
        policy.updated_at = Self::timestamp_str();

        log_info("SystemUtilityPolicy", &format!("Successfully applied and verified system utility policy v{}", policy.version));
        *ACTIVE_UTILITY_POLICY.lock().unwrap() = Some(policy.clone());

        Ok(policy)
    }

    /// Revert all system utility policies back to default detection-only baseline.
    pub fn revert_to_default() -> Result<SystemUtilityPolicyConfig, String> {
        log_info("SystemUtilityPolicy", "Reverting all system utility restrictions to safe default baseline");
        let candidate_sid: Option<&str> = None;

        let _ = PowerShellManager::apply_policy(PowerShellRestrictionMode::DetectionOnly, candidate_sid);
        let _ = CmdManager::apply_policy(CmdRestrictionMode::DetectionOnly, candidate_sid);
        let _ = TaskManagerPolicy::apply_policy(TaskManagerRestrictionMode::DetectionOnly, candidate_sid);
        let _ = RegistryPolicyEngine::remove_policy(RegistryPolicyTarget::DisableRegistryTools, candidate_sid);

        let default_policy = SystemUtilityPolicyConfig {
            id: "default-system-utility-policy".to_string(),
            version: 1,
            powershell_mode: PowerShellRestrictionMode::DetectionOnly,
            cmd_mode: CmdRestrictionMode::DetectionOnly,
            task_manager_mode: TaskManagerRestrictionMode::DetectionOnly,
            registry_tools_blocked: false,
            utility_rules: Vec::new(),
            candidate_account: Some("AssessXCandidate".to_string()),
            candidate_sid: None,
            state: UtilityPolicyLifecycleState::Active,
            admin_approved: true,
            updated_at: Self::timestamp_str(),
        };

        *ACTIVE_UTILITY_POLICY.lock().unwrap() = Some(default_policy.clone());
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
        let policy = SystemUtilityPolicyEngine::get_policy();
        assert_eq!(policy.powershell_mode, PowerShellRestrictionMode::DetectionOnly);
        assert_eq!(policy.cmd_mode, CmdRestrictionMode::DetectionOnly);
        assert_eq!(policy.task_manager_mode, TaskManagerRestrictionMode::DetectionOnly);
        assert_eq!(policy.state, UtilityPolicyLifecycleState::Active);
    }

    #[test]
    fn test_conflict_detection_for_critical_components() {
        let mut policy = SystemUtilityPolicyEngine::get_policy();
        policy.utility_rules.push(UtilityPolicyRule {
            utility_id: "util-explorer".to_string(),
            executable_name: "explorer.exe".to_string(),
            action: UtilityPolicyAction::Block,
            reason: "Testing conflict detection".to_string(),
        });

        let preview = SystemUtilityPolicyEngine::validate_and_preview(&policy);
        assert!(!preview.is_valid);
        assert!(!preview.conflicts.is_empty());
        assert_eq!(preview.conflicts[0].executable_name, "explorer.exe");
        assert_eq!(preview.conflicts[0].conflict_type, "CRITICAL_COMPONENT_PROTECTION");
    }

    #[test]
    fn test_approval_gate_enforcement() {
        let policy = SystemUtilityPolicyEngine::get_policy();
        let result = SystemUtilityPolicyEngine::apply_policy(policy, false);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Administrator approval gate"));
    }
}
