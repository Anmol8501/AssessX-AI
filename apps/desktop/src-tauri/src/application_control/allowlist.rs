//! Allowlist manager and category-based rule matching for Phase 2A.
//!
//! Provides administrator-controlled application authorization rules,
//! hard-coded critical system baselines, and file-based persistence.

use super::identity::ApplicationIdentity;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AllowlistCategory {
    CoreAssessX,
    WindowsSystem,
    ApprovedSupport,
    ApprovedAccessibility,
    ApprovedInput,
    BlockedApplication,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuleType {
    Publisher,
    Hash,
    Path,
    ExecutableName,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RuleAction {
    Allow,
    Deny,
    Audit,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AllowlistEntry {
    pub id: String,
    pub name: String,
    pub category: AllowlistCategory,
    pub rule_type: RuleType,
    pub rule_value: String,
    pub action: RuleAction,
    pub reason: String,
    pub is_system_rule: bool,
    pub created_at: String,
}

static ALLOWLIST_STORE: Mutex<Option<Vec<AllowlistEntry>>> = Mutex::new(None);

pub struct AllowlistManager;

impl AllowlistManager {
    /// Return the storage path for allowlist configuration.
    fn storage_path() -> PathBuf {
        let base = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir());
        let dir = base.join("AssessX");
        let _ = fs::create_dir_all(&dir);
        dir.join("application_allowlist.json")
    }

    /// System baseline rules that can NEVER be deleted or overridden.
    pub fn get_baseline_rules() -> Vec<AllowlistEntry> {
        vec![
            AllowlistEntry {
                id: "baseline-assessx-core".to_string(),
                name: "AssessX Core Desktop Client".to_string(),
                category: AllowlistCategory::CoreAssessX,
                rule_type: RuleType::ExecutableName,
                rule_value: "AssessX.exe".to_string(),
                action: RuleAction::Allow,
                reason: "Primary examination platform runtime".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-assessx-agent".to_string(),
                name: "AssessX Native Security Agent".to_string(),
                category: AllowlistCategory::CoreAssessX,
                rule_type: RuleType::ExecutableName,
                rule_value: "AssessXSecurityAgent.exe".to_string(),
                action: RuleAction::Allow,
                reason: "Background security monitoring service".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-win-explorer".to_string(),
                name: "Windows Explorer Shell".to_string(),
                category: AllowlistCategory::WindowsSystem,
                rule_type: RuleType::ExecutableName,
                rule_value: "explorer.exe".to_string(),
                action: RuleAction::Allow,
                reason: "Required Windows user session shell".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-win-dwm".to_string(),
                name: "Desktop Window Manager".to_string(),
                category: AllowlistCategory::WindowsSystem,
                rule_type: RuleType::ExecutableName,
                rule_value: "dwm.exe".to_string(),
                action: RuleAction::Allow,
                reason: "Windows compositor subsystem".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-win-ctfmon".to_string(),
                name: "Text Input Processor (CTFMON)".to_string(),
                category: AllowlistCategory::WindowsSystem,
                rule_type: RuleType::ExecutableName,
                rule_value: "ctfmon.exe".to_string(),
                action: RuleAction::Allow,
                reason: "Keyboard language and text input processor".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-win-textinput".to_string(),
                name: "Windows Text Input Host".to_string(),
                category: AllowlistCategory::WindowsSystem,
                rule_type: RuleType::ExecutableName,
                rule_value: "TextInputHost.exe".to_string(),
                action: RuleAction::Allow,
                reason: "Virtual and hardware keyboard integration".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-blocked-chrome".to_string(),
                name: "Google Chrome Browser".to_string(),
                category: AllowlistCategory::BlockedApplication,
                rule_type: RuleType::ExecutableName,
                rule_value: "chrome.exe".to_string(),
                action: RuleAction::Deny,
                reason: "External browser prohibited during exam".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-blocked-edge".to_string(),
                name: "Microsoft Edge Browser".to_string(),
                category: AllowlistCategory::BlockedApplication,
                rule_type: RuleType::ExecutableName,
                rule_value: "msedge.exe".to_string(),
                action: RuleAction::Deny,
                reason: "External browser prohibited during exam".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-blocked-discord".to_string(),
                name: "Discord Communication Client".to_string(),
                category: AllowlistCategory::BlockedApplication,
                rule_type: RuleType::ExecutableName,
                rule_value: "discord.exe".to_string(),
                action: RuleAction::Deny,
                reason: "Unauthorized communication software".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-blocked-powershell".to_string(),
                name: "Windows PowerShell".to_string(),
                category: AllowlistCategory::BlockedApplication,
                rule_type: RuleType::ExecutableName,
                rule_value: "powershell.exe".to_string(),
                action: RuleAction::Deny,
                reason: "Command line shell interpreter prohibited".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
            AllowlistEntry {
                id: "baseline-blocked-cmd".to_string(),
                name: "Command Prompt".to_string(),
                category: AllowlistCategory::BlockedApplication,
                rule_type: RuleType::ExecutableName,
                rule_value: "cmd.exe".to_string(),
                action: RuleAction::Deny,
                reason: "Command line interpreter prohibited".to_string(),
                is_system_rule: true,
                created_at: "0".to_string(),
            },
        ]
    }

    /// Load all rules (combining baseline rules + persisted administrator rules).
    pub fn get_rules() -> Vec<AllowlistEntry> {
        let mut guard = ALLOWLIST_STORE.lock().unwrap();
        if guard.is_none() {
            let mut all_rules = Self::get_baseline_rules();
            let path = Self::storage_path();

            if path.exists() {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(saved_rules) = serde_json::from_str::<Vec<AllowlistEntry>>(&content)
                    {
                        for r in saved_rules {
                            if !r.is_system_rule
                                && !all_rules.iter().any(|existing| existing.id == r.id)
                            {
                                all_rules.push(r);
                            }
                        }
                    }
                }
            }

            *guard = Some(all_rules);
        }

        guard.as_ref().unwrap().clone()
    }

    /// Add an administrator-approved rule.
    pub fn add_rule(
        name: String,
        category: AllowlistCategory,
        rule_type: RuleType,
        rule_value: String,
        action: RuleAction,
        reason: String,
    ) -> Result<AllowlistEntry, String> {
        let mut rules = Self::get_rules();

        // Check for duplicates
        if rules
            .iter()
            .any(|r| r.rule_type == rule_type && r.rule_value.eq_ignore_ascii_case(&rule_value))
        {
            return Err(format!(
                "Rule already exists for {:?} with value '{}'",
                rule_type, rule_value
            ));
        }

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string());

        let new_entry = AllowlistEntry {
            id: format!("custom-rule-{}", timestamp),
            name,
            category,
            rule_type,
            rule_value,
            action,
            reason,
            is_system_rule: false,
            created_at: timestamp,
        };

        rules.push(new_entry.clone());
        Self::persist(&rules)?;

        let mut guard = ALLOWLIST_STORE.lock().unwrap();
        *guard = Some(rules);

        Ok(new_entry)
    }

    /// Remove a custom rule (system baseline rules cannot be removed).
    pub fn remove_rule(rule_id: &str) -> Result<bool, String> {
        let mut rules = Self::get_rules();

        if let Some(pos) = rules.iter().position(|r| r.id == rule_id) {
            if rules[pos].is_system_rule {
                return Err("Cannot remove critical system baseline rule.".to_string());
            }

            rules.remove(pos);
            Self::persist(&rules)?;

            let mut guard = ALLOWLIST_STORE.lock().unwrap();
            *guard = Some(rules);

            Ok(true)
        } else {
            Err(format!("Rule ID '{}' not found", rule_id))
        }
    }

    /// Check an `ApplicationIdentity` against the active rules.
    pub fn evaluate_identity(identity: &ApplicationIdentity) -> RuleAction {
        let rules = Self::get_rules();

        // 1. Check exact Hash match first (highest fidelity)
        for r in rules.iter().filter(|r| r.rule_type == RuleType::Hash) {
            if r.rule_value.eq_ignore_ascii_case(&identity.file_hash) {
                return r.action.clone();
            }
        }

        // 2. Check Publisher match
        if let Some(pub_name) = &identity.publisher {
            for r in rules.iter().filter(|r| r.rule_type == RuleType::Publisher) {
                if pub_name.eq_ignore_ascii_case(&r.rule_value) {
                    return r.action.clone();
                }
            }
        }

        // 3. Check Executable Name match
        for r in rules
            .iter()
            .filter(|r| r.rule_type == RuleType::ExecutableName)
        {
            if r.rule_value
                .eq_ignore_ascii_case(&identity.executable_name)
            {
                return r.action.clone();
            }
        }

        // 4. Check Path match
        for r in rules.iter().filter(|r| r.rule_type == RuleType::Path) {
            if identity
                .executable_path
                .to_lowercase()
                .starts_with(&r.rule_value.to_lowercase())
            {
                return r.action.clone();
            }
        }

        // Default: If not explicitly allowed or denied, treat as Audit
        RuleAction::Audit
    }

    /// Persist rules to disk.
    fn persist(rules: &[AllowlistEntry]) -> Result<(), String> {
        let path = Self::storage_path();
        let custom_rules: Vec<_> = rules.iter().filter(|r| !r.is_system_rule).collect();
        let json = serde_json::to_string_pretty(&custom_rules)
            .map_err(|e| format!("Serialization error: {}", e))?;

        let mut file =
            File::create(&path).map_err(|e| format!("Failed to create allowlist file: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write allowlist file: {}", e))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_baseline_rules() {
        let baseline = AllowlistManager::get_baseline_rules();
        assert!(baseline.len() >= 8);
        assert!(baseline.iter().any(|r| r.rule_value == "AssessX.exe" && r.action == RuleAction::Allow));
        assert!(baseline.iter().any(|r| r.rule_value == "chrome.exe" && r.action == RuleAction::Deny));
    }

    #[test]
    fn test_evaluate_identity() {
        let mut id = ApplicationIdentity {
            application_id: "chrome".to_string(),
            display_name: "Google Chrome".to_string(),
            executable_name: "chrome.exe".to_string(),
            executable_path: "C:\\Program Files\\Google\\Chrome\\chrome.exe".to_string(),
            publisher: Some("Google LLC".to_string()),
            file_hash: "123456".to_string(),
            file_version: None,
            signature_status: super::super::identity::SignatureStatus::SignedTrusted,
            is_running: true,
            process_ids: vec![100],
            verified_at: "0".to_string(),
        };

        assert_eq!(AllowlistManager::evaluate_identity(&id), RuleAction::Deny);

        id.executable_name = "AssessX.exe".to_string();
        assert_eq!(AllowlistManager::evaluate_identity(&id), RuleAction::Allow);

        id.executable_name = "unknown_tool.exe".to_string();
        id.publisher = None;
        assert_eq!(AllowlistManager::evaluate_identity(&id), RuleAction::Audit);
    }
}

