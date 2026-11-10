//! Candidate Account Provisioning Foundation (Module 5, Phase 1A).
//!
//! Provides non-destructive inspection of local Windows candidate accounts,
//! evaluates privilege separation, and generates a structured provisioning plan.
//! Never creates, alters, or deletes accounts automatically without explicit administrator execution.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateAccountStatus {
    pub account_name: String,
    pub exists: bool,
    pub is_standard_user: bool,
    pub is_administrator: bool,
    pub status: &'static str, // "READY" | "NEEDS_PROVISIONING" | "WARNING_IS_ADMIN" | "NOT_FOUND"
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisioningStep {
    pub step_number: u32,
    pub title: String,
    pub description: String,
    pub command: Option<String>,
    pub requires_elevation: bool,
    pub is_reversible: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisioningPlan {
    pub target_account: String,
    pub current_status: CandidateAccountStatus,
    pub recommended_action: String,
    pub steps: Vec<ProvisioningStep>,
    pub requires_admin_approval: bool,
    pub generated_at: String,
}

#[cfg(windows)]
fn check_local_user_exists(account: &str) -> (bool, bool, bool) {
    // Non-destructive read using net user or registry ProfileList
    use std::process::Command;

    let output = Command::new("net")
        .args(["user", account])
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            let stdout = String::from_utf8_lossy(&out.stdout).to_lowercase();
            let is_admin = stdout.contains("*administrators") || stdout.contains("administrator");
            let is_standard = !is_admin;
            return (true, is_standard, is_admin);
        }
    }
    (false, false, false)
}

pub fn inspect_candidate_account(account_name: &str) -> CandidateAccountStatus {
    let clean_name = account_name.trim();
    if clean_name.is_empty() {
        return CandidateAccountStatus {
            account_name: "assessx-candidate".to_string(),
            exists: false,
            is_standard_user: false,
            is_administrator: false,
            status: "NOT_FOUND",
            message: "No account name specified.".to_string(),
        };
    }

    #[cfg(windows)]
    {
        let (exists, _is_standard, is_admin) = check_local_user_exists(clean_name);

        if !exists {
            CandidateAccountStatus {
                account_name: clean_name.to_string(),
                exists: false,
                is_standard_user: false,
                is_administrator: false,
                status: "NEEDS_PROVISIONING",
                message: format!(
                    "Candidate account '{}' does not exist yet. Run provisioning script to create it.",
                    clean_name
                ),
            }
        } else if is_admin {
            CandidateAccountStatus {
                account_name: clean_name.to_string(),
                exists: true,
                is_standard_user: false,
                is_administrator: true,
                status: "WARNING_IS_ADMIN",
                message: format!(
                    "Security warning: Account '{}' has Administrator privileges. Candidate exam accounts must be Standard User only.",
                    clean_name
                ),
            }
        } else {
            CandidateAccountStatus {
                account_name: clean_name.to_string(),
                exists: true,
                is_standard_user: true,
                is_administrator: false,
                status: "READY",
                message: format!(
                    "Account '{}' exists and is correctly configured as a Standard User.",
                    clean_name
                ),
            }
        }
    }

    #[cfg(not(windows))]
    {
        CandidateAccountStatus {
            account_name: clean_name.to_string(),
            exists: false,
            is_standard_user: false,
            is_administrator: false,
            status: "NEEDS_PROVISIONING",
            message: "Candidate account inspection requires a Windows host.".to_string(),
        }
    }
}

pub fn generate_provisioning_plan(account_name: &str, app_path: &str) -> ProvisioningPlan {
    let current_status = inspect_candidate_account(account_name);
    let target = current_status.account_name.clone();
    let exe = if app_path.trim().is_empty() {
        std::env::current_exe()
            .ok()
            .and_then(|p| p.to_str().map(String::from))
            .unwrap_or_else(|| "C:\\Program Files\\AssessX\\AssessX.exe".to_string())
    } else {
        app_path.to_string()
    };

    let mut steps = Vec::new();

    if !current_status.exists {
        steps.push(ProvisioningStep {
            step_number: 1,
            title: "Create Dedicated Standard Candidate Account".to_string(),
            description: format!(
                "Creates a standard local Windows user named '{}' with a secure initial password.",
                target
            ),
            command: Some(format!(
                "net user {} [PASSWORD] /add /comment:\"AssessX Secure Exam Candidate Account\" /passwordchg:no",
                target
            )),
            requires_elevation: true,
            is_reversible: true,
        });
    }

    steps.push(ProvisioningStep {
        step_number: if current_status.exists { 1 } else { 2 },
        title: "Verify Privilege Separation".to_string(),
        description: format!(
            "Ensures '{}' is not a member of the local Administrators group.",
            target
        ),
        command: Some(format!(
            "net localgroup Administrators {} /delete",
            target
        )),
        requires_elevation: true,
        is_reversible: true,
    });

    steps.push(ProvisioningStep {
        step_number: if current_status.exists { 2 } else { 3 },
        title: "Configure Application Access".to_string(),
        description: format!(
            "Sets read and execute permissions on AssessX binary for '{}'.",
            target
        ),
        command: Some(format!(
            "icacls \"{}\" /grant {}:(RX)",
            exe, target
        )),
        requires_elevation: true,
        is_reversible: true,
    });

    ProvisioningPlan {
        target_account: target,
        current_status,
        recommended_action: "Review the proposed commands before executing them in an elevated PowerShell prompt.".to_string(),
        steps,
        requires_admin_approval: true,
        generated_at: super::chrono_or_fallback_timestamp(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_candidate_account_inspection() {
        let status = inspect_candidate_account("test-candidate");
        assert_eq!(status.account_name, "test-candidate");
        assert!(status.status == "NEEDS_PROVISIONING" || status.status == "READY" || status.status == "NOT_FOUND" || status.status == "WARNING_IS_ADMIN");
    }

    #[test]
    fn test_provisioning_plan_generation() {
        let plan = generate_provisioning_plan("assessx-exam", "C:\\AssessX.exe");
        assert_eq!(plan.target_account, "assessx-exam");
        assert!(plan.requires_admin_approval);
        assert!(!plan.steps.is_empty());
    }
}
