//! Windows Kiosk Capability Detection (Stage 1, Phase 1B).
//!
//! Evaluates operating system support for Windows Assigned Access and Windows Shell Launcher.
//! Distinguishes capabilities across Windows Home, Pro, Enterprise, Education, and IoT Enterprise.
//! Never assumes all Windows editions have interchangeable capabilities.

use serde::Serialize;
use crate::provisioning::windows_info::{detect_windows_compatibility, WindowsCompatibilityReport};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskMechanismCapability {
    pub mechanism_name: &'static str,
    pub is_supported: bool,
    pub is_configured: bool,
    pub status: &'static str, // "SUPPORTED" | "CONFIGURED" | "UNSUPPORTED_EDITION" | "FEATURE_DISABLED" | "REQUIRES_ELEVATION"
    pub missing_features: Vec<String>,
    pub required_permissions: &'static str,
    pub details: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskCapabilityReport {
    pub windows_compatibility: WindowsCompatibilityReport,
    pub assigned_access: KioskMechanismCapability,
    pub shell_launcher: KioskMechanismCapability,
    pub recommended_mechanism: &'static str, // "ASSIGNED_ACCESS" | "SHELL_LAUNCHER" | "UNSUPPORTED"
    pub overall_status: &'static str,        // "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "REQUIRES_ADMINISTRATOR"
    pub limitations: Vec<String>,
    pub summary: String,
}

#[cfg(windows)]
fn is_shell_launcher_feature_enabled() -> bool {
    // Check if the Client-EmbeddedShellLauncher feature or registry is present
    use crate::provisioning::windows_info::read_reg_string;
    
    // Check Shell Launcher policy or service registration
    if read_reg_string(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\EmbeddedMode",
        "ShellLauncherEnabled",
    ).is_some() {
        return true;
    }

    // Secondary check: embedded shell launcher WMI provider registration
    read_reg_string(
        r"SOFTWARE\Classes\CLSID\{7365A20C-41A7-4402-997E-D4F469818FEF}",
        "",
    ).is_some()
}

#[cfg(not(windows))]
fn is_shell_launcher_feature_enabled() -> bool {
    false
}

#[cfg(windows)]
fn is_assigned_access_active() -> bool {
    use crate::provisioning::windows_info::read_reg_string;
    
    // Check if current user shell or Assigned Access registry indicates active kiosk session
    if let Some(shell) = read_reg_string(
        r"Software\Microsoft\Windows\CurrentVersion\Policies\System",
        "Shell",
    ) {
        if !shell.eq_ignore_ascii_case("explorer.exe") {
            return true;
        }
    }
    false
}

#[cfg(not(windows))]
fn is_assigned_access_active() -> bool {
    false
}

pub fn detect_kiosk_capabilities() -> KioskCapabilityReport {
    let win_info = detect_windows_compatibility();
    let edition = win_info.edition.to_lowercase();

    let is_home = edition.contains("home") || edition.contains("starter");
    let is_enterprise_or_edu = edition.contains("enterprise")
        || edition.contains("education")
        || edition.contains("iot")
        || edition.contains("server");
    let is_pro = edition.contains("pro") && !is_enterprise_or_edu;

    let mut limitations = Vec::new();

    // 1. Evaluate Assigned Access
    let assigned_access_supported = !is_home && (is_pro || is_enterprise_or_edu);
    let assigned_access_active = is_assigned_access_active();
    
    let mut aa_missing = Vec::new();
    let aa_status = if is_home {
        limitations.push("Windows Home editions do not support Assigned Access kiosk configuration.".to_string());
        aa_missing.push("Windows Pro, Enterprise, or Education edition required".to_string());
        "UNSUPPORTED_EDITION"
    } else if assigned_access_active {
        "CONFIGURED"
    } else if assigned_access_supported {
        "SUPPORTED"
    } else {
        "UNSUPPORTED_EDITION"
    };

    let assigned_access = KioskMechanismCapability {
        mechanism_name: "Windows Assigned Access",
        is_supported: assigned_access_supported,
        is_configured: assigned_access_active,
        status: aa_status,
        missing_features: aa_missing,
        required_permissions: "Administrator privileges required to apply Assigned Access configuration.",
        details: if assigned_access_supported {
            "Assigned Access single-app and multi-app kiosk is officially supported by this Windows edition.".to_string()
        } else {
            "Assigned Access is unavailable on this edition of Windows.".to_string()
        },
    };

    // 2. Evaluate Shell Launcher
    let shell_launcher_edition_supported = is_enterprise_or_edu;
    let shell_launcher_feature_active = is_shell_launcher_feature_enabled();
    let mut sl_missing = Vec::new();

    let sl_status = if is_home {
        sl_missing.push("Windows Enterprise, Education, or IoT Enterprise edition required".to_string());
        "UNSUPPORTED_EDITION"
    } else if is_pro {
        limitations.push("Windows Shell Launcher (WESL_UserShell) requires Enterprise, Education, or IoT Enterprise edition.".to_string());
        sl_missing.push("Windows Enterprise / Education edition required for Shell Launcher".to_string());
        "UNSUPPORTED_EDITION"
    } else if shell_launcher_edition_supported {
        if shell_launcher_feature_active {
            "CONFIGURED"
        } else {
            "SUPPORTED"
        }
    } else {
        "UNSUPPORTED_EDITION"
    };

    let shell_launcher = KioskMechanismCapability {
        mechanism_name: "Windows Shell Launcher",
        is_supported: shell_launcher_edition_supported,
        is_configured: shell_launcher_feature_active,
        status: sl_status,
        missing_features: sl_missing,
        required_permissions: "Administrator privileges required to configure Shell Launcher WMI.",
        details: if shell_launcher_edition_supported {
            "Shell Launcher is supported on this Enterprise/Education Windows edition.".to_string()
        } else {
            "Shell Launcher requires Windows Enterprise, Education, or IoT Enterprise.".to_string()
        },
    };

    // 3. Overall Determination
    let (overall_status, recommended_mechanism, summary) = if is_enterprise_or_edu {
        (
            "SUPPORTED",
            "SHELL_LAUNCHER",
            "This workstation supports both Windows Shell Launcher and Assigned Access. Shell Launcher is recommended for dedicated examination environments."
        )
    } else if is_pro {
        (
            "SUPPORTED",
            "ASSIGNED_ACCESS",
            "Windows Pro edition detected. Windows Assigned Access single-app kiosk is supported and recommended for this device."
        )
    } else {
        (
            "UNSUPPORTED",
            "UNSUPPORTED",
            "Windows Home edition detected. OS-boot Assigned Access / Shell Launcher requires Windows Pro or Enterprise, while AssessX Automatic In-App Exam Lockdown protects candidates automatically during active exams."
        )
    };

    KioskCapabilityReport {
        windows_compatibility: win_info,
        assigned_access,
        shell_launcher,
        recommended_mechanism,
        overall_status,
        limitations,
        summary: summary.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kiosk_capability_detection() {
        let report = detect_kiosk_capabilities();
        assert!(
            ["SUPPORTED", "PARTIALLY_SUPPORTED", "UNSUPPORTED"].contains(&report.overall_status),
            "Unexpected overall status: {}",
            report.overall_status
        );
        assert!(
            ["ASSIGNED_ACCESS", "SHELL_LAUNCHER", "UNSUPPORTED"].contains(&report.recommended_mechanism),
            "Unexpected recommended mechanism: {}",
            report.recommended_mechanism
        );
        assert_eq!(report.assigned_access.mechanism_name, "Windows Assigned Access");
        assert_eq!(report.shell_launcher.mechanism_name, "Windows Shell Launcher");
    }
}

