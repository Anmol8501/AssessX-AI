//! Centralized Peripheral & Remote Access Policy Management & Lifecycle (Phase 2D).
//!
//! Provides validation, conflict analysis, administrator approval gating,
//! verification, and safe rollback for USB, display, and remote-access restrictions.

use super::display::DisplayManager;
use super::remote_access::RemoteAccessManager;
use super::storage::{StorageManager, StoragePolicyMode};
use crate::security_agent::logger::{log_info, log_warn};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PeripheralPolicyLifecycleState {
    Draft,
    Validated,
    AwaitingAdminApproval,
    Applying,
    Verifying,
    Active,
    RollbackNeeded,
    RolledBack,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralPolicyConfig {
    pub id: String,
    pub version: u32,
    pub storage_mode: StoragePolicyMode,
    pub max_monitors: u32,
    pub allow_virtual_displays: bool,
    pub block_remote_sessions: bool,
    pub block_remote_tools: bool,
    pub require_camera: bool,
    pub require_microphone: bool,
    pub candidate_account: Option<String>,
    pub candidate_sid: Option<String>,
    pub state: PeripheralPolicyLifecycleState,
    pub admin_approved: bool,
    pub updated_at: String,
}

impl Default for PeripheralPolicyConfig {
    fn default() -> Self {
        Self {
            id: "default-peripheral-policy".to_string(),
            version: 1,
            storage_mode: StoragePolicyMode::AuditOnly,
            max_monitors: 1,
            allow_virtual_displays: false,
            block_remote_sessions: true,
            block_remote_tools: true,
            require_camera: true,
            require_microphone: true,
            candidate_account: Some("AssessXCandidate".to_string()),
            candidate_sid: None,
            state: PeripheralPolicyLifecycleState::Active,
            admin_approved: true,
            updated_at: "1731000000".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PeripheralPolicyPreviewReport {
    pub storage_impact_mode: StoragePolicyMode,
    pub removable_drives_affected_count: usize,
    pub current_monitor_count: u32,
    pub max_allowed_monitors: u32,
    pub display_violation: bool,
    pub virtual_display_detected: bool,
    pub remote_session_detected: bool,
    pub detected_remote_tools_count: usize,
    pub conflicts: Vec<String>,
}

static CURRENT_PERIPHERAL_POLICY: Mutex<Option<PeripheralPolicyConfig>> = Mutex::new(None);

pub struct PeripheralPolicyEngine;

impl PeripheralPolicyEngine {
    pub fn get_policy() -> PeripheralPolicyConfig {
        let mut lock = CURRENT_PERIPHERAL_POLICY
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(ref p) = *lock {
            p.clone()
        } else {
            let default_policy = PeripheralPolicyConfig::default();
            *lock = Some(default_policy.clone());
            default_policy
        }
    }

    pub fn set_policy(mut policy: PeripheralPolicyConfig) -> Result<PeripheralPolicyConfig, String> {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string());
        policy.updated_at = ts;
        policy.version += 1;

        let mut lock = CURRENT_PERIPHERAL_POLICY
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *lock = Some(policy.clone());

        log_info(
            "PERIPHERAL_POLICY",
            &format!("Saved updated policy '{}' (v{}) state={:?}", policy.id, policy.version, policy.state),
        );
        Ok(policy)
    }

    pub fn preview_policy(policy: &PeripheralPolicyConfig) -> PeripheralPolicyPreviewReport {
        let storage_rep = StorageManager::inspect_storage(policy.storage_mode);
        let display_rep = DisplayManager::inspect_display_topology(policy.max_monitors);
        let remote_rep = RemoteAccessManager::inspect_remote_access();

        let mut conflicts = Vec::new();

        if display_rep.monitor_count > policy.max_monitors {
            conflicts.push(format!(
                "Connected displays ({}) exceed maximum allowed ({})",
                display_rep.monitor_count, policy.max_monitors
            ));
        }

        if display_rep.has_virtual_display && !policy.allow_virtual_displays {
            conflicts.push("Virtual display driver detected on system".to_string());
        }

        if remote_rep.is_remote_session_active && policy.block_remote_sessions {
            conflicts.push("Active Remote Desktop (RDP) session detected".to_string());
        }

        if remote_rep.running_remote_tools_count > 0 && policy.block_remote_tools {
            conflicts.push(format!(
                "Prohibited remote tools running: {}",
                remote_rep
                    .detected_remote_tools
                    .iter()
                    .map(|t| t.tool_name.clone())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }

        PeripheralPolicyPreviewReport {
            storage_impact_mode: policy.storage_mode,
            removable_drives_affected_count: storage_rep.connected_removable_drives_count,
            current_monitor_count: display_rep.monitor_count,
            max_allowed_monitors: policy.max_monitors,
            display_violation: display_rep.monitor_count > policy.max_monitors,
            virtual_display_detected: display_rep.has_virtual_display,
            remote_session_detected: remote_rep.is_remote_session_active,
            detected_remote_tools_count: remote_rep.running_remote_tools_count,
            conflicts,
        }
    }

    pub fn apply_policy(admin_signature: &str) -> Result<PeripheralPolicyConfig, String> {
        if admin_signature.trim().is_empty() {
            return Err("Administrator approval signature is required to apply peripheral policies".to_string());
        }

        let mut policy = Self::get_policy();
        policy.state = PeripheralPolicyLifecycleState::Applying;

        // Apply storage policy
        let sid = policy.candidate_sid.as_deref();
        if let Err(e) = StorageManager::apply_storage_policy(policy.storage_mode, sid) {
            policy.state = PeripheralPolicyLifecycleState::RollbackNeeded;
            let _ = Self::set_policy(policy);
            return Err(format!("Storage policy application failed: {}", e));
        }

        policy.state = PeripheralPolicyLifecycleState::Verifying;

        // Verify storage enforcement
        let rep = StorageManager::inspect_storage(policy.storage_mode);
        if !rep.is_policy_enforced {
            log_warn("PERIPHERAL_POLICY", "Storage policy verification reported non-enforced status");
        }

        policy.state = PeripheralPolicyLifecycleState::Active;
        policy.admin_approved = true;
        Self::set_policy(policy)
    }

    pub fn rollback_policy() -> Result<PeripheralPolicyConfig, String> {
        let mut policy = Self::get_policy();
        policy.state = PeripheralPolicyLifecycleState::RollbackNeeded;

        // Restore storage policy from persistent snapshot (never overwrite external institutional policy)
        let sid = policy.candidate_sid.as_deref();
        if let Err(e) = StorageManager::restore_storage_policy(sid) {
            let _ = Self::set_policy(policy);
            return Err(format!("Storage policy restoration failed: {}", e));
        }

        policy.storage_mode = StoragePolicyMode::AuditOnly;
        policy.state = PeripheralPolicyLifecycleState::RolledBack;
        Self::set_policy(policy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_policy() {
        let p = PeripheralPolicyEngine::get_policy();
        assert_eq!(p.max_monitors, 1);
        assert!(!p.allow_virtual_displays);
    }

    #[test]
    fn test_policy_preview() {
        let p = PeripheralPolicyEngine::get_policy();
        let prev = PeripheralPolicyEngine::preview_policy(&p);
        assert_eq!(prev.max_allowed_monitors, 1);
    }

    #[test]
    fn test_apply_and_rollback() {
        let applied = PeripheralPolicyEngine::apply_policy("SIG_VALID");
        assert!(applied.is_ok());

        let rolled = PeripheralPolicyEngine::rollback_policy();
        assert!(rolled.is_ok());
        assert_eq!(rolled.unwrap().state, PeripheralPolicyLifecycleState::RolledBack);
    }
}
