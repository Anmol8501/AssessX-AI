//! Windows Compatibility Detection (Module 1, Phase 1A).
//!
//! Inspects the current operating system configuration, edition, build number, and architecture
//! via supported Win32 registry and system APIs without mutating any OS state.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsCompatibilityReport {
    pub platform: &'static str,
    pub edition: String,
    pub display_version: String,
    pub build_number: String,
    pub ubr: u32,
    pub architecture: String,
    pub compatibility: &'static str, // "SUPPORTED" | "WARNING" | "UNSUPPORTED"
    pub kiosk_supported: bool,
    pub summary: String,
    pub warnings: Vec<String>,
}

#[cfg(windows)]
pub fn read_reg_string(subkey: &str, value_name: &str) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let sub = wide(subkey);
    let val = wide(value_name);
    let mut buf = [0u16; 256];
    let mut size = (buf.len() * 2) as u32;

    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            sub.as_ptr(),
            val.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buf.as_mut_ptr() as *mut _,
            &mut size,
        )
    };

    if rc == ERROR_SUCCESS {
        let len = (size as usize / 2).saturating_sub(1);
        let s = String::from_utf16_lossy(&buf[..len]);
        let trimmed = s.trim_matches('\0').trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    } else {
        None
    }
}

#[cfg(windows)]
pub fn read_reg_dword(subkey: &str, value_name: &str) -> Option<u32> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let sub = wide(subkey);
    let val = wide(value_name);
    let mut val_dword: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;

    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            sub.as_ptr(),
            val.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut val_dword as *mut u32 as *mut _,
            &mut size,
        )
    };

    if rc == ERROR_SUCCESS {
        Some(val_dword)
    } else {
        None
    }
}

#[cfg(windows)]
pub fn detect_architecture() -> String {
    use windows_sys::Win32::System::SystemInformation::{
        GetNativeSystemInfo, PROCESSOR_ARCHITECTURE_AMD64, PROCESSOR_ARCHITECTURE_ARM64,
        PROCESSOR_ARCHITECTURE_INTEL, SYSTEM_INFO,
    };

    let mut sys_info: SYSTEM_INFO = unsafe { std::mem::zeroed() };
    unsafe { GetNativeSystemInfo(&mut sys_info) };

    // Inspect the processor architecture union safely
    let arch = unsafe { sys_info.Anonymous.Anonymous.wProcessorArchitecture };
    match arch {
        PROCESSOR_ARCHITECTURE_AMD64 => "x64".to_string(),
        PROCESSOR_ARCHITECTURE_ARM64 => "arm64".to_string(),
        PROCESSOR_ARCHITECTURE_INTEL => "x86".to_string(),
        _ => "Unknown".to_string(),
    }
}

pub fn detect_windows_compatibility() -> WindowsCompatibilityReport {
    #[cfg(windows)]
    {
        const CURR_VER: &str = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";

        let edition = read_reg_string(CURR_VER, "ProductName")
            .unwrap_or_else(|| "Windows (Unknown Edition)".to_string());
        let display_version = read_reg_string(CURR_VER, "DisplayVersion")
            .or_else(|| read_reg_string(CURR_VER, "ReleaseId"))
            .unwrap_or_else(|| "Unknown".to_string());
        let build_number = read_reg_string(CURR_VER, "CurrentBuildNumber")
            .unwrap_or_else(|| "0".to_string());
        let ubr = read_reg_dword(CURR_VER, "UBR").unwrap_or(0);
        let architecture = detect_architecture();

        let e_lower = edition.to_ascii_lowercase();
        let kiosk_supported = (e_lower.contains("pro")
            || e_lower.contains("enterprise")
            || e_lower.contains("education")
            || e_lower.contains("iot"))
            && !e_lower.contains("home");

        let mut warnings = Vec::new();
        let compatibility: &'static str;
        let summary: String;

        let build_num: u32 = build_number.parse().unwrap_or(0);

        if build_num < 10240 && build_num > 0 {
            // Older than Windows 10
            compatibility = "UNSUPPORTED";
            summary = format!(
                "Unsupported operating system: {}. AssessX requires Windows 10 or Windows 11.",
                edition
            );
            warnings.push("Operating system is older than Windows 10 minimum requirement.".to_string());
        } else if !kiosk_supported {
            // Windows Home or other edition without single-app Assigned Access kiosk mode
            compatibility = "WARNING";
            summary = format!(
                "Compatible: {} (Build {}.{}). Note: Single-app Secure Kiosk mode requires Pro, Enterprise, or Education.",
                edition, build_number, ubr
            );
            warnings.push(
                "Windows Home edition detected. Standard Secure Exam Mode is available, but Assigned Access Kiosk provisioning is unavailable."
                    .to_string(),
            );
        } else {
            compatibility = "SUPPORTED";
            summary = format!(
                "Fully compatible: {} (Version {}, Build {}.{}, {}).",
                edition, display_version, build_number, ubr, architecture
            );
        }

        WindowsCompatibilityReport {
            platform: "windows",
            edition,
            display_version,
            build_number,
            ubr,
            architecture,
            compatibility,
            kiosk_supported,
            summary,
            warnings,
        }
    }

    #[cfg(not(windows))]
    {
        WindowsCompatibilityReport {
            platform: "non-windows",
            edition: "Not Windows".to_string(),
            display_version: "N/A".to_string(),
            build_number: "0".to_string(),
            ubr: 0,
            architecture: "Unknown".to_string(),
            compatibility: "UNSUPPORTED",
            kiosk_supported: false,
            summary: "AssessX Secure Exam Mode requires Windows 10 or Windows 11.".to_string(),
            warnings: vec!["Current operating system is not Windows.".to_string()],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_report_generation() {
        let report = detect_windows_compatibility();
        assert!(!report.platform.is_empty());
        assert!(!report.edition.is_empty());
        assert!(
            report.compatibility == "SUPPORTED"
                || report.compatibility == "WARNING"
                || report.compatibility == "UNSUPPORTED"
        );
    }
}

