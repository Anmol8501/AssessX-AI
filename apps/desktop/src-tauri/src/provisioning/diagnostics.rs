//! Installation Diagnostics Report (Module 9, Phase 1A).
//!
//! Compiles a consolidated, scrubbed diagnostic report uniting OS specifications,
//! hardware readiness, security controls, candidate account state, and configuration validation.
//! Strictly redacts passwords, tokens, and PII.

use serde::Serialize;
use super::accounts::{inspect_candidate_account, CandidateAccountStatus};
use super::device_id::{get_or_create_device_identity, DeviceIdentity};
use super::hardware::{scan_hardware_readiness, HardwareReadinessReport};
use super::security::{scan_security_readiness, WindowsSecurityReport};
use super::validation::{validate_configuration, ConfigurationValidationReport};
use super::windows_info::{detect_windows_compatibility, WindowsCompatibilityReport};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationDiagnosticReport {
    pub diagnostic_id: String,
    pub timestamp: String,
    pub device_identity: DeviceIdentity,
    pub compatibility: WindowsCompatibilityReport,
    pub hardware: HardwareReadinessReport,
    pub security: WindowsSecurityReport,
    pub account: CandidateAccountStatus,
    pub validation: ConfigurationValidationReport,
    pub overall_status: &'static str, // "PASS" | "WARNING" | "FAIL"
    pub summary: String,
    pub warnings: Vec<String>,
    pub failures: Vec<String>,
}

pub fn generate_diagnostic_report(candidate_account_name: &str) -> InstallationDiagnosticReport {
    let device_identity = get_or_create_device_identity();
    let compatibility = detect_windows_compatibility();
    let hardware = scan_hardware_readiness();
    let security = scan_security_readiness();
    let account = inspect_candidate_account(candidate_account_name);
    let validation = validate_configuration();

    let mut warnings = Vec::new();
    let mut failures = Vec::new();

    // Collect warnings and failures from all modules
    warnings.extend(compatibility.warnings.clone());

    if hardware.overall_status == "FAIL" {
        failures.push("Hardware resources do not meet minimum requirements (RAM or disk space critical).".to_string());
    } else if hardware.overall_status == "WARNING" {
        warnings.push("Hardware resources meet minimums with warnings (e.g. low free disk buffer or multiple displays).".to_string());
    }

    if security.overall_status == "FAIL" {
        failures.push("Windows security mechanisms are missing or disabled.".to_string());
    } else if security.overall_status == "WARNING" {
        warnings.push("One or more security mechanisms (Secure Boot / TPM) reported an advisory state.".to_string());
    }

    if account.status == "WARNING_IS_ADMIN" {
        failures.push(format!("Account '{}' possesses Administrator rights. Must be Standard User.", account.account_name));
    } else if account.status == "NEEDS_PROVISIONING" {
        warnings.push(format!("Candidate account '{}' has not been created yet.", account.account_name));
    }

    if validation.overall_status == "NOT_READY" {
        failures.push("Configuration validation failed on local permissions or binaries.".to_string());
    } else if validation.overall_status == "READY_WITH_WARNINGS" {
        warnings.push("Configuration validation noted setup advisories.".to_string());
    }

    let overall_status = if !failures.is_empty() {
        "FAIL"
    } else if !warnings.is_empty() {
        "WARNING"
    } else {
        "PASS"
    };

    let summary = match overall_status {
        "PASS" => "This Windows workstation is fully provisioned and ready for AssessX Secure Exam Mode.".to_string(),
        "WARNING" => "This workstation is compatible with minor advisories. Review warnings before high-stakes exams.".to_string(),
        _ => "This workstation requires configuration adjustments before running secure proctored exams.".to_string(),
    };

    let diagnostic_id = format!("DIAG-{}", &device_identity.device_id[..8].to_uppercase());

    InstallationDiagnosticReport {
        diagnostic_id,
        timestamp: super::chrono_or_fallback_timestamp(),
        device_identity,
        compatibility,
        hardware,
        security,
        account,
        validation,
        overall_status,
        summary,
        warnings,
        failures,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_diagnostic_report_generation() {
        let rep = generate_diagnostic_report("assessx-test");
        assert!(rep.diagnostic_id.starts_with("DIAG-"));
        assert!(!rep.timestamp.is_empty());
        assert!(rep.overall_status == "PASS" || rep.overall_status == "WARNING" || rep.overall_status == "FAIL");
    }
}

