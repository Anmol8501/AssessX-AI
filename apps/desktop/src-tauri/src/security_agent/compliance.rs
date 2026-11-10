//! Device compliance evaluation engine for AssessX Security Agent (Phase 1C).
//!
//! Evaluates workstation posture against policy v1.0 and generates structured
//! reports for pre-flight examination gates and backend audits.

use crate::provisioning::accounts::inspect_candidate_account;
use crate::provisioning::security::scan_security_readiness;
use crate::provisioning::windows_info::detect_windows_compatibility;
use crate::secure_shell::kiosk_capability::detect_kiosk_capabilities;
use crate::security_agent::protocol::{ComplianceReportResponse, ComplianceRuleResult};
use std::time::{SystemTime, UNIX_EPOCH};

pub const COMPLIANCE_POLICY_VERSION: &str = "1.0.0";

pub struct ComplianceEngine;

impl ComplianceEngine {
    /// Evaluate all compliance rules against the local host.
    pub fn evaluate() -> ComplianceReportResponse {
        let mut results = Vec::new();

        // Rule 1: OS Version & Supported Build
        let win_info = detect_windows_compatibility();
        let os_compliant = win_info.compatibility != "UNSUPPORTED";
        results.push(ComplianceRuleResult {
            rule_id: "RULE_OS_COMPATIBILITY".to_string(),
            title: "Windows OS Version & Build Compatibility".to_string(),
            category: "OPERATING_SYSTEM".to_string(),
            status: if os_compliant { "PASS".to_string() } else { "FAIL".to_string() },
            severity: "HIGH".to_string(),
            observed_value: format!("{} (Build {})", win_info.edition, win_info.build_number),
            expected_value: "Windows 10 (>= 19041) or Windows 11 (Pro/Enterprise/Education)".to_string(),
            remediation: if !os_compliant {
                Some("Update Windows to a supported Windows 10/11 version.".to_string())
            } else {
                None
            },
        });

        // Rule 2: Secure Boot Status
        let sec_report = scan_security_readiness();
        let secure_boot_pass = sec_report.secure_boot.status == "PASS";
        results.push(ComplianceRuleResult {
            rule_id: "RULE_SECURE_BOOT".to_string(),
            title: "UEFI Secure Boot Enforcement".to_string(),
            category: "FIRMWARE".to_string(),
            status: if secure_boot_pass { "PASS".to_string() } else { "WARNING".to_string() },
            severity: "MEDIUM".to_string(),
            observed_value: sec_report.secure_boot.value,
            expected_value: "Enabled".to_string(),
            remediation: if !secure_boot_pass {
                Some("Enable UEFI Secure Boot in system BIOS/UEFI firmware settings.".to_string())
            } else {
                None
            },
        });

        // Rule 3: Virtualization / Hypervisor Posture
        let vm_detected = Self::check_virtual_machine();
        results.push(ComplianceRuleResult {
            rule_id: "RULE_HYPERVISOR_RESTRICTION".to_string(),
            title: "Physical Bare-Metal Execution".to_string(),
            category: "ENVIRONMENT".to_string(),
            status: if !vm_detected { "PASS".to_string() } else { "WARNING".to_string() },
            severity: "MEDIUM".to_string(),
            observed_value: if vm_detected {
                "Virtual machine environment detected".to_string()
            } else {
                "Bare-metal physical hardware".to_string()
            },
            expected_value: "Physical Hardware (Non-virtualized)".to_string(),
            remediation: if vm_detected {
                Some("Run AssessX on physical hardware unless in approved testing mode.".to_string())
            } else {
                None
            },
        });

        // Rule 4: Developer Mode / Testsigning Detection
        let test_signing_active = Self::check_testsigning_mode();
        results.push(ComplianceRuleResult {
            rule_id: "RULE_INTEGRITY_TESTSIGNING".to_string(),
            title: "Driver Signature Enforcement & Testsigning".to_string(),
            category: "SECURITY_INTEGRITY".to_string(),
            status: if !test_signing_active { "PASS".to_string() } else { "FAIL".to_string() },
            severity: "CRITICAL".to_string(),
            observed_value: if test_signing_active { "Testsigning Mode Active".to_string() } else { "Driver Enforcement Active".to_string() },
            expected_value: "Testsigning Disabled".to_string(),
            remediation: if test_signing_active {
                Some("Disable Windows Testsigning mode (bcdedit /set testsigning off).".to_string())
            } else {
                None
            },
        });

        // Rule 5: Candidate Dedicated Account Status
        let candidate_status = inspect_candidate_account("AssessXCandidate");
        let candidate_account_exists = candidate_status.exists;
        results.push(ComplianceRuleResult {
            rule_id: "RULE_CANDIDATE_ACCOUNT".to_string(),
            title: "Dedicated Candidate Examination Account".to_string(),
            category: "ACCESS_CONTROL".to_string(),
            status: if candidate_account_exists { "PASS".to_string() } else { "WARNING".to_string() },
            severity: "LOW".to_string(),
            observed_value: if candidate_account_exists { "Configured (AssessXCandidate)".to_string() } else { "Not Provisioned".to_string() },
            expected_value: "Configured (AssessXCandidate)".to_string(),
            remediation: if !candidate_account_exists {
                Some("Provision the candidate account via Phase 1A Provisioning screen.".to_string())
            } else {
                None
            },
        });

        // Rule 6: Kiosk Shell Capability
        let kiosk_caps = detect_kiosk_capabilities();
        let kiosk_supported = kiosk_caps.overall_status != "UNSUPPORTED";
        results.push(ComplianceRuleResult {
            rule_id: "RULE_KIOSK_SHELL_CAPABILITY".to_string(),
            title: "Supported Kiosk Shell Mechanism".to_string(),
            category: "SHELL_SECURITY".to_string(),
            status: if kiosk_supported { "PASS".to_string() } else { "FAIL".to_string() },
            severity: "HIGH".to_string(),
            observed_value: if kiosk_supported {
                kiosk_caps.recommended_mechanism.to_string()
            } else {
                "Unsupported Windows Edition".to_string()
            },
            expected_value: "Shell Launcher or Assigned Access Available".to_string(),
            remediation: if !kiosk_supported {
                Some("Upgrade Windows edition to Pro/Enterprise or enable Shell Launcher.".to_string())
            } else {
                None
            },
        });

        // Rule 7: Display Topology Compliance
        let monitor_count = Self::get_system_monitor_count();
        let single_display = monitor_count <= 1;
        results.push(ComplianceRuleResult {
            rule_id: "RULE_SINGLE_DISPLAY".to_string(),
            title: "Single Active Examination Display".to_string(),
            category: "PERIPHERAL".to_string(),
            status: if single_display { "PASS".to_string() } else { "WARNING".to_string() },
            severity: "MEDIUM".to_string(),
            observed_value: format!("{} display(s) active", monitor_count),
            expected_value: "1 active display".to_string(),
            remediation: if !single_display {
                Some("Disconnect secondary monitors before starting examination.".to_string())
            } else {
                None
            },
        });

        let total_rules = results.len();
        let passed_rules = results.iter().filter(|r| r.status == "PASS").count();
        let failed_rules = results.iter().filter(|r| r.status == "FAIL").count();
        let warning_rules = results.iter().filter(|r| r.status == "WARNING").count();

        let overall_status = if failed_rules > 0 {
            "NON_COMPLIANT".to_string()
        } else if warning_rules > 0 {
            "WARNING".to_string()
        } else {
            "COMPLIANT".to_string()
        };

        let evaluated_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "0".to_string());

        ComplianceReportResponse {
            evaluated_at,
            policy_version: COMPLIANCE_POLICY_VERSION.to_string(),
            overall_status,
            total_rules,
            passed_rules,
            failed_rules,
            warning_rules,
            results,
        }
    }

    /// Check monitor count via Win32 API
    fn get_system_monitor_count() -> i32 {
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CMONITORS};
            let count = unsafe { GetSystemMetrics(SM_CMONITORS) };
            if count > 0 {
                return count;
            }
        }
        1
    }

    /// Check if testsigning is enabled in Windows BCD.
    fn check_testsigning_mode() -> bool {
        #[cfg(windows)]
        {
            use std::process::Command;
            if let Ok(output) = Command::new("bcdedit.exe").arg("/enum").output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.to_lowercase().contains("testsigning             yes") {
                    return true;
                }
            }
        }
        false
    }

    /// Check if the system is running inside a known Virtual Machine.
    fn check_virtual_machine() -> bool {
        #[cfg(windows)]
        {
            use crate::provisioning::windows_info::read_reg_string;
            const BIOS_KEY: &str = "HARDWARE\\Description\\System\\BIOS";
            if let Some(mfg) = read_reg_string(BIOS_KEY, "SystemManufacturer") {
                let lower = mfg.to_lowercase();
                if lower.contains("vmware")
                    || lower.contains("virtualbox")
                    || lower.contains("qemu")
                    || lower.contains("innotek")
                {
                    return true;
                }
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compliance_evaluation() {
        let report = ComplianceEngine::evaluate();
        assert_eq!(report.policy_version, COMPLIANCE_POLICY_VERSION);
        assert_eq!(report.total_rules, 7);
        assert_eq!(report.total_rules, report.passed_rules + report.failed_rules + report.warning_rules);
        assert!(!report.results.is_empty());
    }
}
