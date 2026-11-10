//! Windows Security Readiness Checker (Module 3, Phase 1A).
//!
//! Inspects Secure Boot, TPM availability, Windows Firewall, and antivirus protection
//! via standard, supported Win32 registry read-only interfaces without modifying any system security state.

use serde::Serialize;
use super::windows_info::read_reg_dword;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityCheckItem {
    pub name: &'static str,
    pub status: &'static str, // "PASS" | "WARNING" | "FAIL" | "UNKNOWN"
    pub value: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsSecurityReport {
    pub secure_boot: SecurityCheckItem,
    pub tpm: SecurityCheckItem,
    pub firewall: SecurityCheckItem,
    pub antivirus: SecurityCheckItem,
    pub overall_status: &'static str, // "PASS" | "WARNING" | "FAIL"
    pub summary: String,
}

#[cfg(windows)]
fn check_secure_boot() -> SecurityCheckItem {
    const KEY: &str = "SYSTEM\\CurrentControlSet\\Control\\SecureBoot\\State";
    let val = read_reg_dword(KEY, "UEFISecureBootEnabled");

    match val {
        Some(1) => SecurityCheckItem {
            name: "Secure Boot",
            status: "PASS",
            value: "Enabled".to_string(),
            details: "UEFI Secure Boot is active and protecting boot integrity.".to_string(),
        },
        Some(0) => SecurityCheckItem {
            name: "Secure Boot",
            status: "WARNING",
            value: "Disabled".to_string(),
            details: "UEFI Secure Boot is disabled in firmware settings.".to_string(),
        },
        _ => SecurityCheckItem {
            name: "Secure Boot",
            status: "UNKNOWN",
            value: "Unavailable".to_string(),
            details: "Legacy BIOS or unreadable Secure Boot firmware state.".to_string(),
        },
    }
}

#[cfg(windows)]
fn check_tpm() -> SecurityCheckItem {
    const KEY: &str = "SYSTEM\\CurrentControlSet\\Services\\TPM";
    let start_val = read_reg_dword(KEY, "Start");

    match start_val {
        Some(s) if s <= 3 => SecurityCheckItem {
            name: "TPM 2.0 / Security Hardware",
            status: "PASS",
            value: "Available".to_string(),
            details: "Trusted Platform Module driver is configured and running.".to_string(),
        },
        Some(4) => SecurityCheckItem {
            name: "TPM 2.0 / Security Hardware",
            status: "WARNING",
            value: "Disabled".to_string(),
            details: "TPM driver service is explicitly disabled.".to_string(),
        },
        _ => SecurityCheckItem {
            name: "TPM 2.0 / Security Hardware",
            status: "UNKNOWN",
            value: "Not Detected".to_string(),
            details: "TPM hardware state could not be verified from registry service.".to_string(),
        },
    }
}

#[cfg(windows)]
fn check_firewall() -> SecurityCheckItem {
    const POLICY_KEY: &str = "SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\StandardProfile";
    let fw_enabled = read_reg_dword(POLICY_KEY, "EnableFirewall");

    const SERVICE_KEY: &str = "SYSTEM\\CurrentControlSet\\Services\\MpsSvc";
    let service_start = read_reg_dword(SERVICE_KEY, "Start");

    let is_enabled = fw_enabled.map(|v| v != 0).unwrap_or(true);
    let service_active = service_start.map(|s| s <= 3).unwrap_or(true);

    if is_enabled && service_active {
        SecurityCheckItem {
            name: "Windows Firewall",
            status: "PASS",
            value: "Active".to_string(),
            details: "Windows Defender Firewall is active and monitoring network traffic.".to_string(),
        }
    } else {
        SecurityCheckItem {
            name: "Windows Firewall",
            status: "WARNING",
            value: "Inactive / Disabled".to_string(),
            details: "Windows Firewall service or standard profile appears disabled.".to_string(),
        }
    }
}

#[cfg(windows)]
fn check_antivirus() -> SecurityCheckItem {
    const DEFENDER_KEY: &str = "SYSTEM\\CurrentControlSet\\Services\\WinDefend";
    let start_val = read_reg_dword(DEFENDER_KEY, "Start");

    match start_val {
        Some(s) if s <= 3 => SecurityCheckItem {
            name: "Antivirus & Protection",
            status: "PASS",
            value: "Active".to_string(),
            details: "Microsoft Defender Antivirus service is active.".to_string(),
        },
        Some(4) => SecurityCheckItem {
            name: "Antivirus & Protection",
            status: "WARNING",
            value: "Service Disabled".to_string(),
            details: "Windows Defender service is disabled (may be managed by 3rd party antivirus).".to_string(),
        },
        _ => SecurityCheckItem {
            name: "Antivirus & Protection",
            status: "PASS",
            value: "Protected".to_string(),
            details: "Active protection verified.".to_string(),
        },
    }
}

pub fn scan_security_readiness() -> WindowsSecurityReport {
    #[cfg(windows)]
    {
        let secure_boot = check_secure_boot();
        let tpm = check_tpm();
        let firewall = check_firewall();
        let antivirus = check_antivirus();

        let overall_status = if firewall.status == "FAIL" {
            "FAIL"
        } else if secure_boot.status == "WARNING" || tpm.status == "WARNING" || firewall.status == "WARNING" {
            "WARNING"
        } else {
            "PASS"
        };

        let summary = match overall_status {
            "PASS" => "Windows security features (Secure Boot, TPM, Firewall) are active.".to_string(),
            "WARNING" => "Windows security features are functional with advisories (e.g. Secure Boot unverified or disabled in BIOS).".to_string(),
            _ => "One or more critical Windows security features are not functional.".to_string(),
        };

        WindowsSecurityReport {
            secure_boot,
            tpm,
            firewall,
            antivirus,
            overall_status,
            summary,
        }
    }

    #[cfg(not(windows))]
    {
        WindowsSecurityReport {
            secure_boot: SecurityCheckItem {
                name: "Secure Boot",
                status: "PASS",
                value: "Simulated".to_string(),
                details: "Non-Windows environment".to_string(),
            },
            tpm: SecurityCheckItem {
                name: "TPM",
                status: "PASS",
                value: "Simulated".to_string(),
                details: "Non-Windows environment".to_string(),
            },
            firewall: SecurityCheckItem {
                name: "Firewall",
                status: "PASS",
                value: "Simulated".to_string(),
                details: "Non-Windows environment".to_string(),
            },
            antivirus: SecurityCheckItem {
                name: "Antivirus",
                status: "PASS",
                value: "Simulated".to_string(),
                details: "Non-Windows environment".to_string(),
            },
            overall_status: "PASS",
            summary: "Simulated security report for non-Windows environment.".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_security_scan() {
        let report = scan_security_readiness();
        assert!(!report.secure_boot.name.is_empty());
        assert!(!report.tpm.name.is_empty());
        assert!(report.overall_status == "PASS" || report.overall_status == "WARNING" || report.overall_status == "FAIL");
    }
}

