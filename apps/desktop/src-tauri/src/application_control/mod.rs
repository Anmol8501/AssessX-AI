//! AssessX Application Allowlisting & Execution Control (Phase 2A).
//!
//! Provides application inventory and identity verification, allowlist management,
//! Windows enforcement capability evaluation, policy lifecycle management, and unauthorized
//! process classification.

pub mod allowlist;
pub mod capability;
pub mod detector;
pub mod identity;
pub mod inventory;
pub mod policy;

use allowlist::{AllowlistCategory, AllowlistEntry, AllowlistManager, RuleAction, RuleType};
use capability::{CapabilityDetector, EnforcementCapabilityReport};
use detector::{ApplicationDetector, ApplicationScanSummary};
use identity::ApplicationIdentity;
use policy::{PolicyEngine, PolicyEngineState, PolicyMode, PolicyOperationResult, PolicyPreview};

/// Query full application inventory from running processes.
#[tauri::command]
pub fn application_control_get_inventory() -> Vec<ApplicationIdentity> {
    inventory::ApplicationInventory::scan_running_applications()
}

/// Retrieve all active allowlist rules (baseline + custom).
#[tauri::command]
pub fn application_control_get_allowlist() -> Vec<AllowlistEntry> {
    AllowlistManager::get_rules()
}

/// Add an administrator-authorized allowlist rule.
#[tauri::command]
pub fn application_control_add_rule(
    name: String,
    category: AllowlistCategory,
    rule_type: RuleType,
    rule_value: String,
    action: RuleAction,
    reason: String,
) -> Result<AllowlistEntry, String> {
    AllowlistManager::add_rule(name, category, rule_type, rule_value, action, reason)
}

/// Remove a custom rule (system baseline rules are protected).
#[tauri::command]
pub fn application_control_remove_rule(rule_id: String) -> Result<bool, String> {
    AllowlistManager::remove_rule(&rule_id)
}

/// Query Windows application control capabilities (WDAC, AppLocker, AppIDSvc).
#[tauri::command]
pub fn application_control_get_capabilities() -> EnforcementCapabilityReport {
    CapabilityDetector::detect_capabilities()
}

/// Query current application policy state and version.
#[tauri::command]
pub fn application_control_get_policy_state() -> PolicyEngineState {
    PolicyEngine::get_state()
}

/// Generate a policy preview before applying changes.
#[tauri::command]
pub fn application_control_preview_policy(mode: PolicyMode) -> PolicyPreview {
    PolicyEngine::preview_policy(mode)
}

/// Apply application policy with explicit administrator approval.
#[tauri::command]
pub fn application_control_apply_policy(
    mode: PolicyMode,
    admin_approved: bool,
) -> PolicyOperationResult {
    PolicyEngine::apply_policy(mode, admin_approved)
}

/// Restore application policy to default baseline.
#[tauri::command]
pub fn application_control_restore_baseline() -> PolicyOperationResult {
    PolicyEngine::restore_baseline()
}

/// Scan running applications and detect policy violations.
#[tauri::command]
pub fn application_control_scan_violations() -> ApplicationScanSummary {
    ApplicationDetector::scan_and_classify()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_exports() {
        let rules = application_control_get_allowlist();
        assert!(!rules.is_empty());

        let caps = application_control_get_capabilities();
        assert!(!caps.windows_edition.is_empty());

        let preview = application_control_preview_policy(PolicyMode::AuditMode);
        assert!(preview.is_safe_to_apply);
    }
}

