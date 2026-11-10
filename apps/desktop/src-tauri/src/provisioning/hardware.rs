//! Hardware Readiness Scanner (Module 2, Phase 1A).
//!
//! Inspects CPU, physical memory, available storage, and display configuration
//! via supported Win32 system query APIs without altering any hardware or OS settings.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub model: String,
    pub logical_cores: u32,
    pub status: &'static str, // "PASS" | "WARNING" | "FAIL"
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_gb: f64,
    pub available_gb: f64,
    pub percent_used: u32,
    pub status: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub system_drive: String,
    pub total_gb: f64,
    pub free_gb: f64,
    pub status: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub monitor_count: u32,
    pub primary_resolution: String,
    pub status: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareReadinessReport {
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub storage: StorageInfo,
    pub display: DisplayInfo,
    pub overall_status: &'static str, // "PASS" | "WARNING" | "FAIL"
    pub summary: String,
}

#[cfg(windows)]
fn get_cpu_info() -> CpuInfo {
    use super::windows_info::read_reg_string;
    use windows_sys::Win32::System::SystemInformation::{GetSystemInfo, SYSTEM_INFO};

    let model = read_reg_string(
        "HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0",
        "ProcessorNameString",
    )
    .unwrap_or_else(|| "Unknown Processor".to_string());

    let mut sys_info: SYSTEM_INFO = unsafe { std::mem::zeroed() };
    unsafe { GetSystemInfo(&mut sys_info) };
    let logical_cores = sys_info.dwNumberOfProcessors;

    let (status, message) = if logical_cores >= 4 {
        ("PASS", format!("{} ({} logical cores)", model, logical_cores))
    } else if logical_cores >= 2 {
        ("PASS", format!("{} ({} cores — meets minimum)", model, logical_cores))
    } else {
        (
            "WARNING",
            format!("{} (Single core detected — performance may be degraded)", model),
        )
    };

    CpuInfo {
        model,
        logical_cores,
        status,
        message,
    }
}

#[cfg(windows)]
fn get_memory_info() -> MemoryInfo {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut mem: MEMORYSTATUSEX = unsafe { std::mem::zeroed() };
    mem.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;

    let success = unsafe { GlobalMemoryStatusEx(&mut mem) };
    if success != 0 {
        let total_gb = (mem.ullTotalPhys as f64) / (1024.0 * 1024.0 * 1024.0);
        let avail_gb = (mem.ullAvailPhys as f64) / (1024.0 * 1024.0 * 1024.0);
        let percent_used = mem.dwMemoryLoad;

        let total_gb_rounded = (total_gb * 10.0).round() / 10.0;
        let avail_gb_rounded = (avail_gb * 10.0).round() / 10.0;

        let (status, message) = if total_gb >= 4.0 {
            (
                "PASS",
                format!("{:.1} GB Total, {:.1} GB Available ({}% in use)", total_gb_rounded, avail_gb_rounded, percent_used),
            )
        } else if total_gb >= 2.0 {
            (
                "WARNING",
                format!("{:.1} GB Total (AssessX recommends at least 4 GB RAM for video proctoring)", total_gb_rounded),
            )
        } else {
            (
                "FAIL",
                format!("{:.1} GB Total (Insufficient RAM: minimum 2 GB required)", total_gb_rounded),
            )
        };

        MemoryInfo {
            total_gb: total_gb_rounded,
            available_gb: avail_gb_rounded,
            percent_used,
            status,
            message,
        }
    } else {
        MemoryInfo {
            total_gb: 0.0,
            available_gb: 0.0,
            percent_used: 0,
            status: "WARNING",
            message: "Unable to query system memory metrics.".to_string(),
        }
    }
}

#[cfg(windows)]
fn get_storage_info() -> StorageInfo {
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;

    let system_drive = "C:\\".to_string();
    let wide_path: Vec<u16> = system_drive.encode_utf16().chain(std::iter::once(0)).collect();

    let mut free_bytes_available: u64 = 0;
    let mut total_bytes: u64 = 0;
    let mut total_free_bytes: u64 = 0;

    let success = unsafe {
        GetDiskFreeSpaceExW(
            wide_path.as_ptr(),
            &mut free_bytes_available,
            &mut total_bytes,
            &mut total_free_bytes,
        )
    };

    if success != 0 {
        let total_gb = (total_bytes as f64) / (1024.0 * 1024.0 * 1024.0);
        let free_gb = (total_free_bytes as f64) / (1024.0 * 1024.0 * 1024.0);

        let total_gb_rounded = (total_gb * 10.0).round() / 10.0;
        let free_gb_rounded = (free_gb * 10.0).round() / 10.0;

        let (status, message) = if free_gb >= 5.0 {
            (
                "PASS",
                format!("{:.1} GB free on {} (out of {:.1} GB)", free_gb_rounded, system_drive, total_gb_rounded),
            )
        } else if free_gb >= 1.5 {
            (
                "WARNING",
                format!("{:.1} GB free (Low disk space: recommend at least 5 GB for evidence buffer)", free_gb_rounded),
            )
        } else {
            (
                "FAIL",
                format!("{:.1} GB free (Critically low disk space: minimum 1.5 GB required)", free_gb_rounded),
            )
        };

        StorageInfo {
            system_drive,
            total_gb: total_gb_rounded,
            free_gb: free_gb_rounded,
            status,
            message,
        }
    } else {
        StorageInfo {
            system_drive,
            total_gb: 0.0,
            free_gb: 0.0,
            status: "WARNING",
            message: "Unable to query disk space on system drive.".to_string(),
        }
    }
}

#[cfg(windows)]
fn get_display_info() -> DisplayInfo {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CMONITORS, SM_CXSCREEN, SM_CYSCREEN,
    };

    let monitor_count = unsafe { GetSystemMetrics(SM_CMONITORS) } as u32;
    let cx = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let cy = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    let primary_resolution = format!("{}x{}", cx, cy);

    let (status, message) = if monitor_count <= 1 {
        ("PASS", format!("1 display active ({})", primary_resolution))
    } else {
        (
            "WARNING",
            format!(
                "{} displays detected (Primary: {}). Proctored exams prohibit secondary monitors.",
                monitor_count, primary_resolution
            ),
        )
    };

    DisplayInfo {
        monitor_count: monitor_count.max(1),
        primary_resolution,
        status,
        message,
    }
}

pub fn scan_hardware_readiness() -> HardwareReadinessReport {
    #[cfg(windows)]
    {
        let cpu = get_cpu_info();
        let memory = get_memory_info();
        let storage = get_storage_info();
        let display = get_display_info();

        let overall_status = if memory.status == "FAIL" || storage.status == "FAIL" {
            "FAIL"
        } else if cpu.status == "WARNING"
            || memory.status == "WARNING"
            || storage.status == "WARNING"
            || display.status == "WARNING"
        {
            "WARNING"
        } else {
            "PASS"
        };

        let summary = match overall_status {
            "PASS" => "Hardware meets all requirements for AssessX Secure Exam Mode.".to_string(),
            "WARNING" => "Hardware meets minimum requirements with warnings (e.g. low space or multi-monitor).".to_string(),
            _ => "Hardware fails minimum requirements for AssessX exam execution.".to_string(),
        };

        HardwareReadinessReport {
            cpu,
            memory,
            storage,
            display,
            overall_status,
            summary,
        }
    }

    #[cfg(not(windows))]
    {
        HardwareReadinessReport {
            cpu: CpuInfo {
                model: "Simulated CPU".to_string(),
                logical_cores: 4,
                status: "PASS",
                message: "Non-Windows environment".to_string(),
            },
            memory: MemoryInfo {
                total_gb: 8.0,
                available_gb: 4.0,
                percent_used: 50,
                status: "PASS",
                message: "Non-Windows environment".to_string(),
            },
            storage: StorageInfo {
                system_drive: "/".to_string(),
                total_gb: 256.0,
                free_gb: 120.0,
                status: "PASS",
                message: "Non-Windows environment".to_string(),
            },
            display: DisplayInfo {
                monitor_count: 1,
                primary_resolution: "1920x1080".to_string(),
                status: "PASS",
                message: "1 display".to_string(),
            },
            overall_status: "PASS",
            summary: "Simulated hardware report for non-Windows environment.".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hardware_scan() {
        let report = scan_hardware_readiness();
        assert!(!report.cpu.model.is_empty());
        assert!(report.cpu.logical_cores >= 1);
        assert!(report.overall_status == "PASS" || report.overall_status == "WARNING" || report.overall_status == "FAIL");
    }
}

