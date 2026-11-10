//! Windows Service lifecycle management and in-process daemon runner for AssessX Security Agent (Phase 1C).
//!
//! Supports both standard Windows Service Control Manager (SCM) operations (`sc.exe`)
//! and safe in-process daemon mode for non-elevated testing and local development.

use crate::security_agent::ipc;
use crate::security_agent::logger::log_info;
use crate::security_agent::monitor;
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const SERVICE_NAME: &str = "AssessXSecurityAgent";
pub const SERVICE_DISPLAY_NAME: &str = "AssessX Native Security Agent";

static DAEMON_RUNNING: AtomicBool = AtomicBool::new(false);
static DAEMON_SHUTDOWN: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);
static DAEMON_THREAD: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
static DAEMON_START_TIME: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ServiceLifecycleState {
    NotInstalled,
    Stopped,
    Starting,
    Running,
    Degraded,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub service_name: String,
    pub display_name: String,
    pub state: ServiceLifecycleState,
    pub is_daemon_mode: bool,
    pub pid: Option<u32>,
    pub uptime_seconds: u64,
    pub message: String,
}

pub struct ServiceManager;

impl ServiceManager {
    /// Queries the current status of the service (checking in-process daemon first, then SCM).
    pub fn query_status() -> ServiceStatus {
        // 1. Check in-process daemon mode first
        if DAEMON_RUNNING.load(Ordering::SeqCst) {
            let uptime = DAEMON_START_TIME
                .lock()
                .unwrap()
                .map(|t| t.elapsed().as_secs())
                .unwrap_or(0);

            return ServiceStatus {
                service_name: SERVICE_NAME.to_string(),
                display_name: SERVICE_DISPLAY_NAME.to_string(),
                state: ServiceLifecycleState::Running,
                is_daemon_mode: true,
                pid: Some(std::process::id()),
                uptime_seconds: uptime,
                message: "Security Agent is running in active background daemon mode.".to_string(),
            };
        }

        // 2. Query Windows Service Control Manager via sc.exe
        #[cfg(windows)]
        {
            if let Ok(output) = Command::new("sc.exe")
                .args(["query", SERVICE_NAME])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if stdout.contains("FAILED 1060") || stdout.contains("does not exist") {
                    return ServiceStatus {
                        service_name: SERVICE_NAME.to_string(),
                        display_name: SERVICE_DISPLAY_NAME.to_string(),
                        state: ServiceLifecycleState::NotInstalled,
                        is_daemon_mode: false,
                        pid: None,
                        uptime_seconds: 0,
                        message: "Windows Service is not installed. You can install it or run in daemon mode.".to_string(),
                    };
                }

                if stdout.contains("STATE              : 4  RUNNING") {
                    return ServiceStatus {
                        service_name: SERVICE_NAME.to_string(),
                        display_name: SERVICE_DISPLAY_NAME.to_string(),
                        state: ServiceLifecycleState::Running,
                        is_daemon_mode: false,
                        pid: None,
                        uptime_seconds: 0,
                        message: "Windows Service is RUNNING under SCM.".to_string(),
                    };
                } else if stdout.contains("STATE              : 1  STOPPED") {
                    return ServiceStatus {
                        service_name: SERVICE_NAME.to_string(),
                        display_name: SERVICE_DISPLAY_NAME.to_string(),
                        state: ServiceLifecycleState::Stopped,
                        is_daemon_mode: false,
                        pid: None,
                        uptime_seconds: 0,
                        message: "Windows Service is installed but STOPPED.".to_string(),
                    };
                }
            }
        }

        ServiceStatus {
            service_name: SERVICE_NAME.to_string(),
            display_name: SERVICE_DISPLAY_NAME.to_string(),
            state: ServiceLifecycleState::NotInstalled,
            is_daemon_mode: false,
            pid: None,
            uptime_seconds: 0,
            message: "Security Agent service is not active.".to_string(),
        }
    }

    /// Start the Security Agent in safe in-process daemon mode.
    pub fn start_daemon() -> Result<ServiceStatus, String> {
        if DAEMON_RUNNING.load(Ordering::SeqCst) {
            return Ok(Self::query_status());
        }

        let shutdown_flag = Arc::new(AtomicBool::new(false));
        let flag_clone = Arc::clone(&shutdown_flag);

        // Start Named Pipe server
        ipc::start_pipe_server(Arc::clone(&shutdown_flag));

        // Start background worker thread (watchdog & periodic tasks)
        let handle = thread::spawn(move || {
            log_info("DAEMON", "Security Agent daemon background loop started.");
            while !flag_clone.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_secs(3));
                // Tick watchdog
                monitor::check_monitor();
            }
            log_info("DAEMON", "Security Agent daemon background loop exiting.");
        });

        DAEMON_RUNNING.store(true, Ordering::SeqCst);
        *DAEMON_SHUTDOWN.lock().unwrap() = Some(shutdown_flag);
        *DAEMON_THREAD.lock().unwrap() = Some(handle);
        *DAEMON_START_TIME.lock().unwrap() = Some(Instant::now());

        log_info("SERVICE_MANAGER", "Security Agent daemon started successfully.");
        Ok(Self::query_status())
    }

    /// Stop the in-process daemon.
    pub fn stop_daemon() -> Result<ServiceStatus, String> {
        if !DAEMON_RUNNING.load(Ordering::SeqCst) {
            return Ok(Self::query_status());
        }

        if let Some(flag) = DAEMON_SHUTDOWN.lock().unwrap().take() {
            flag.store(true, Ordering::SeqCst);
        }

        if let Some(handle) = DAEMON_THREAD.lock().unwrap().take() {
            let _ = handle.join();
        }

        DAEMON_RUNNING.store(false, Ordering::SeqCst);
        *DAEMON_START_TIME.lock().unwrap() = None;

        log_info("SERVICE_MANAGER", "Security Agent daemon stopped successfully.");
        Ok(Self::query_status())
    }

    /// Install Windows Service via SCM (requires elevated admin privileges).
    pub fn install_service() -> Result<String, String> {
        #[cfg(windows)]
        {
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("Cannot locate current executable: {}", e))?;
            let bin_path = format!("\"{}\" --security-agent-service", exe_path.to_string_lossy());

            let output = Command::new("sc.exe")
                .args([
                    "create",
                    SERVICE_NAME,
                    &format!("binPath={}", bin_path),
                    &format!("DisplayName={}", SERVICE_DISPLAY_NAME),
                    "start=auto",
                    "obj=NT AUTHORITY\\LocalService",
                ])
                .output()
                .map_err(|e| format!("Failed to invoke sc.exe: {}", e))?;

            if output.status.success() {
                log_info("SERVICE_MANAGER", "Windows Service installed successfully.");
                Ok("AssessX Security Agent Windows Service registered with SCM (auto-start, LocalService).".to_string())
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                Err(format!("Service installation failed: {} {}", stdout, err))
            }
        }

        #[cfg(not(windows))]
        {
            Err("Windows Service installation is only supported on Windows.".to_string())
        }
    }

    /// Uninstall Windows Service from SCM.
    pub fn uninstall_service() -> Result<String, String> {
        #[cfg(windows)]
        {
            let output = Command::new("sc.exe")
                .args(["delete", SERVICE_NAME])
                .output()
                .map_err(|e| format!("Failed to invoke sc.exe: {}", e))?;

            if output.status.success() {
                log_info("SERVICE_MANAGER", "Windows Service deleted successfully.");
                Ok("AssessX Security Agent Windows Service removed from SCM.".to_string())
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                Err(format!("Service deletion failed: {} {}", stdout, err))
            }
        }

        #[cfg(not(windows))]
        {
            Err("Windows Service deletion is only supported on Windows.".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_daemon_lifecycle() {
        let status = ServiceManager::start_daemon().expect("start daemon");
        assert!(status.is_daemon_mode);
        assert_eq!(status.state, ServiceLifecycleState::Running);

        let queried = ServiceManager::query_status();
        assert_eq!(queried.state, ServiceLifecycleState::Running);

        let stopped = ServiceManager::stop_daemon().expect("stop daemon");
        assert_ne!(stopped.state, ServiceLifecycleState::Running);
    }
}
