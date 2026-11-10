//! Configuration Validation (Module 8, Phase 1A).
//!
//! Validates local installation integrity, application binary existence,
//! writable data directory permissions, and device identity setup.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigValidationCheck {
    pub name: &'static str,
    pub status: &'static str, // "PASS" | "WARNING" | "FAIL"
    pub details: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigurationValidationReport {
    pub checks: Vec<ConfigValidationCheck>,
    pub overall_status: &'static str, // "READY" | "READY_WITH_WARNINGS" | "NOT_READY"
    pub summary: String,
}

pub fn validate_configuration() -> ConfigurationValidationReport {
    let mut checks = Vec::new();

    // 1. Binary existence
    let exe_path = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("AssessX.exe"));
    let exe_exists = exe_path.exists();
    checks.push(ConfigValidationCheck {
        name: "Application Binary Integrity",
        status: if exe_exists { "PASS" } else { "WARNING" },
        details: format!("Executable located at: {}", exe_path.display()),
    });

    // 2. Data directory write access
    let data_dir = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("AssessX")
    } else {
        std::env::temp_dir().join("AssessX")
    };
    let dir_writable = match std::fs::create_dir_all(&data_dir) {
        Ok(_) => {
            let test_file = data_dir.join(".write_test");
            if std::fs::write(&test_file, b"ok").is_ok() {
                let _ = std::fs::remove_file(test_file);
                true
            } else {
                false
            }
        }
        Err(_) => false,
    };
    checks.push(ConfigValidationCheck {
        name: "Application Data Storage Permissions",
        status: if dir_writable { "PASS" } else { "FAIL" },
        details: format!(
            "Directory '{}' is {}",
            data_dir.display(),
            if dir_writable { "accessible and writable" } else { "not writable (access denied)" }
        ),
    });

    // 3. Device Identity Status
    let identity = super::device_id::get_or_create_device_identity();
    checks.push(ConfigValidationCheck {
        name: "Device Identity Enrollment",
        status: if identity.device_id.len() == 36 { "PASS" } else { "WARNING" },
        details: format!("Device UUID: {}", identity.device_id),
    });

    // 4. Candidate Account Status
    let account = super::accounts::inspect_candidate_account("assessx-candidate");
    checks.push(ConfigValidationCheck {
        name: "Candidate Account Readiness",
        status: if account.exists && account.is_standard_user {
            "PASS"
        } else if account.is_administrator {
            "FAIL"
        } else {
            "WARNING"
        },
        details: account.message,
    });

    let overall_status = if checks.iter().any(|c| c.status == "FAIL") {
        "NOT_READY"
    } else if checks.iter().any(|c| c.status == "WARNING") {
        "READY_WITH_WARNINGS"
    } else {
        "READY"
    };

    let summary = match overall_status {
        "READY" => "All configuration validation checks passed cleanly.".to_string(),
        "READY_WITH_WARNINGS" => "Configuration validated with non-blocking warnings (e.g. dedicated candidate account not yet provisioned).".to_string(),
        _ => "Configuration validation failed on one or more mandatory requirements.".to_string(),
    };

    ConfigurationValidationReport {
        checks,
        overall_status,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validation() {
        let report = validate_configuration();
        assert!(!report.checks.is_empty());
        assert!(report.overall_status == "READY" || report.overall_status == "READY_WITH_WARNINGS" || report.overall_status == "NOT_READY");
    }
}

