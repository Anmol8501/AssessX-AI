//! System Utility Inventory and Categorization for Phase 2B.
//!
//! Provides discovery, categorization (Categories A through F), criticality metadata,
//! and non-overridable protections for essential operating system components.

use crate::application_control::identity::ApplicationIdentity;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SystemUtilityCategory {
    /// Category A: Shell and scripting runtimes (PowerShell, CMD, WScript, CScript, MSHTA)
    CommandAndScripting,
    /// Category B: Task and process supervisors (Task Manager, Resource Monitor, Process Explorer)
    ProcessAndTaskManagement,
    /// Category C: Management consoles and editors (Registry Editor, MMC, Services, Group Policy)
    AdministrativeInterfaces,
    /// Category D: System configuration tools (MSConfig, Control Panel, Settings)
    SystemConfiguration,
    /// Category E: System navigation and launch hosts (File Explorer, Windows Terminal, RunDLL32)
    FileAndNavigation,
    /// Category F: Custom institutional administrator utilities
    CustomUtility,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum UtilityPolicyAction {
    Allow,
    Restrict,
    Block,
    Monitor,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum CriticalityLevel {
    /// Core OS components (e.g. explorer.exe shell, dwm.exe) that must NEVER be blocked
    CriticalProtected,
    /// High-risk examination bypass tools (cmd.exe, powershell.exe, taskmgr.exe, regedit.exe)
    HighRisk,
    /// Medium-risk inspection tools (resmon.exe, mmc.exe, control.exe)
    MediumRisk,
    /// Low-risk utilities
    LowRisk,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemUtilityItem {
    pub utility_id: String,
    pub display_name: String,
    pub executable_name: String,
    pub known_paths: Vec<String>,
    pub resolved_path: Option<String>,
    pub category: SystemUtilityCategory,
    pub publisher: Option<String>,
    pub file_hash: Option<String>,
    pub default_action: UtilityPolicyAction,
    pub criticality: CriticalityLevel,
    pub is_critical_protected: bool,
    pub is_installed: bool,
}

pub struct SystemUtilityInventory;

impl SystemUtilityInventory {
    /// Return the static standard catalog of Windows system utilities evaluated in Phase 2B.
    pub fn get_standard_catalog() -> Vec<SystemUtilityItem> {
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let sys32 = format!("{}\\System32", system_root);
        let syswow64 = format!("{}\\SysWOW64", system_root);
        let prog_files = std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".to_string());

        vec![
            // Category A: Command and Scripting Interfaces
            SystemUtilityItem {
                utility_id: "util-win-powershell".to_string(),
                display_name: "Windows PowerShell".to_string(),
                executable_name: "powershell.exe".to_string(),
                known_paths: vec![
                    format!("{}\\WindowsPowerShell\\v1.0\\powershell.exe", sys32),
                    format!("{}\\WindowsPowerShell\\v1.0\\powershell.exe", syswow64),
                ],
                resolved_path: None,
                category: SystemUtilityCategory::CommandAndScripting,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-pwsh-core".to_string(),
                display_name: "PowerShell 7 (Core)".to_string(),
                executable_name: "pwsh.exe".to_string(),
                known_paths: vec![
                    format!("{}\\PowerShell\\7\\pwsh.exe", prog_files),
                    format!("{}\\PowerShell\\7-preview\\pwsh.exe", prog_files),
                ],
                resolved_path: None,
                category: SystemUtilityCategory::CommandAndScripting,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-cmd".to_string(),
                display_name: "Windows Command Prompt".to_string(),
                executable_name: "cmd.exe".to_string(),
                known_paths: vec![
                    format!("{}\\cmd.exe", sys32),
                    format!("{}\\cmd.exe", syswow64),
                ],
                resolved_path: None,
                category: SystemUtilityCategory::CommandAndScripting,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-wscript".to_string(),
                display_name: "Windows Script Host (GUI)".to_string(),
                executable_name: "wscript.exe".to_string(),
                known_paths: vec![format!("{}\\wscript.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::CommandAndScripting,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-cscript".to_string(),
                display_name: "Windows Script Host (Console)".to_string(),
                executable_name: "cscript.exe".to_string(),
                known_paths: vec![format!("{}\\cscript.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::CommandAndScripting,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-mshta".to_string(),
                display_name: "Microsoft HTML Application Host".to_string(),
                executable_name: "mshta.exe".to_string(),
                known_paths: vec![format!("{}\\mshta.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::CommandAndScripting,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },

            // Category B: Process and Task Management
            SystemUtilityItem {
                utility_id: "util-taskmgr".to_string(),
                display_name: "Windows Task Manager".to_string(),
                executable_name: "taskmgr.exe".to_string(),
                known_paths: vec![format!("{}\\taskmgr.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::ProcessAndTaskManagement,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-resmon".to_string(),
                display_name: "Resource Monitor".to_string(),
                executable_name: "resmon.exe".to_string(),
                known_paths: vec![format!("{}\\resmon.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::ProcessAndTaskManagement,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::MediumRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-perfmon".to_string(),
                display_name: "Performance Monitor".to_string(),
                executable_name: "perfmon.exe".to_string(),
                known_paths: vec![format!("{}\\perfmon.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::ProcessAndTaskManagement,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Restrict,
                criticality: CriticalityLevel::MediumRisk,
                is_critical_protected: false,
                is_installed: false,
            },

            // Category C: Administrative Interfaces
            SystemUtilityItem {
                utility_id: "util-regedit".to_string(),
                display_name: "Registry Editor".to_string(),
                executable_name: "regedit.exe".to_string(),
                known_paths: vec![
                    format!("{}\\regedit.exe", system_root),
                    format!("{}\\regedit.exe", sys32),
                ],
                resolved_path: None,
                category: SystemUtilityCategory::AdministrativeInterfaces,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-mmc".to_string(),
                display_name: "Microsoft Management Console (MMC)".to_string(),
                executable_name: "mmc.exe".to_string(),
                known_paths: vec![format!("{}\\mmc.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::AdministrativeInterfaces,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },

            // Category D: System Configuration Interfaces
            SystemUtilityItem {
                utility_id: "util-msconfig".to_string(),
                display_name: "System Configuration (MSConfig)".to_string(),
                executable_name: "msconfig.exe".to_string(),
                known_paths: vec![format!("{}\\msconfig.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::SystemConfiguration,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::MediumRisk,
                is_critical_protected: false,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-control".to_string(),
                display_name: "Windows Control Panel".to_string(),
                executable_name: "control.exe".to_string(),
                known_paths: vec![format!("{}\\control.exe", sys32)],
                resolved_path: None,
                category: SystemUtilityCategory::SystemConfiguration,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Restrict,
                criticality: CriticalityLevel::MediumRisk,
                is_critical_protected: false,
                is_installed: false,
            },

            // Category E: File & System Navigation Tools
            SystemUtilityItem {
                utility_id: "util-explorer".to_string(),
                display_name: "Windows Explorer (Shell)".to_string(),
                executable_name: "explorer.exe".to_string(),
                known_paths: vec![format!("{}\\explorer.exe", system_root)],
                resolved_path: None,
                category: SystemUtilityCategory::FileAndNavigation,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Allow,
                criticality: CriticalityLevel::CriticalProtected,
                is_critical_protected: true,
                is_installed: false,
            },
            SystemUtilityItem {
                utility_id: "util-winterminal".to_string(),
                display_name: "Windows Terminal".to_string(),
                executable_name: "WindowsTerminal.exe".to_string(),
                known_paths: vec![
                    format!("{}\\WindowsApps\\Microsoft.WindowsTerminal_*\\WindowsTerminal.exe", prog_files),
                ],
                resolved_path: None,
                category: SystemUtilityCategory::FileAndNavigation,
                publisher: Some("Microsoft Corporation".to_string()),
                file_hash: None,
                default_action: UtilityPolicyAction::Block,
                criticality: CriticalityLevel::HighRisk,
                is_critical_protected: false,
                is_installed: false,
            },
        ]
    }

    /// Discover which utilities actually exist on disk and resolve their cryptographic identity.
    pub fn discover_installed_utilities() -> Vec<SystemUtilityItem> {
        let mut catalog = Self::get_standard_catalog();

        for item in &mut catalog {
            for path_str in &item.known_paths {
                let path = Path::new(path_str);
                if path.is_file() {
                    item.is_installed = true;
                    item.resolved_path = Some(path_str.clone());

                    // Use Phase 2A ApplicationIdentity to compute SHA-256 and publisher
                    if let Ok(identity) = ApplicationIdentity::from_path(path, Vec::new()) {
                        item.file_hash = Some(identity.file_hash);
                        if let Some(pub_name) = identity.publisher {
                            item.publisher = Some(pub_name);
                        }
                    }
                    break;
                }
            }
        }

        catalog
    }

    /// Check if an executable is critically protected and must never be blocked.
    pub fn is_protected_system_utility(executable_name: &str) -> bool {
        let lower = executable_name.to_ascii_lowercase();
        lower == "explorer.exe"
            || lower == "dwm.exe"
            || lower == "csrss.exe"
            || lower == "lsass.exe"
            || lower == "services.exe"
            || lower == "smss.exe"
            || lower == "ctfmon.exe"
            || lower == "textinputhost.exe"
            || lower == "assessx.exe"
            || lower == "assessxsecurityagent.exe"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_standard_catalog_completeness() {
        let catalog = SystemUtilityInventory::get_standard_catalog();
        assert!(catalog.len() >= 12);

        let powershell = catalog.iter().find(|i| i.executable_name == "powershell.exe");
        assert!(powershell.is_some());
        assert_eq!(powershell.unwrap().category, SystemUtilityCategory::CommandAndScripting);

        let taskmgr = catalog.iter().find(|i| i.executable_name == "taskmgr.exe");
        assert!(taskmgr.is_some());
        assert_eq!(taskmgr.unwrap().category, SystemUtilityCategory::ProcessAndTaskManagement);

        let explorer = catalog.iter().find(|i| i.executable_name == "explorer.exe");
        assert!(explorer.is_some());
        assert!(explorer.unwrap().is_critical_protected);
    }

    #[test]
    fn test_critical_protection_guard() {
        assert!(SystemUtilityInventory::is_protected_system_utility("explorer.exe"));
        assert!(SystemUtilityInventory::is_protected_system_utility("AssessX.exe"));
        assert!(SystemUtilityInventory::is_protected_system_utility("dwm.exe"));
        assert!(!SystemUtilityInventory::is_protected_system_utility("powershell.exe"));
        assert!(!SystemUtilityInventory::is_protected_system_utility("cmd.exe"));
        assert!(!SystemUtilityInventory::is_protected_system_utility("taskmgr.exe"));
    }

    #[test]
    fn test_discover_installed_utilities() {
        let discovered = SystemUtilityInventory::discover_installed_utilities();
        assert!(!discovered.is_empty());
        let cmd = discovered.iter().find(|i| i.executable_name == "cmd.exe");
        if let Some(cmd_item) = cmd {
            assert!(cmd_item.is_installed);
            assert!(cmd_item.file_hash.is_some());
        }
    }
}
