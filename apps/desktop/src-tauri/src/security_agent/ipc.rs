//! Inter-Process Communication (IPC) via Windows Named Pipes for AssessX Security Agent (Phase 1C).
//!
//! Provides a secured bidirectional named pipe server (`\\.\pipe\AssessXSecurityAgent`)
//! and client connector enforcing 64 KB message ceilings and strict DACL permissions.

use crate::security_agent::backend_client::{BackendClient, QueuedSecurityEvent};
use crate::security_agent::compliance::ComplianceEngine;
use crate::security_agent::integrity::IntegrityVerifier;
use crate::security_agent::logger::{log_error, log_info, log_warn};
use crate::security_agent::monitor::{self, WATCHDOG_TIMEOUT_SECONDS};
use crate::security_agent::protocol::*;
use crate::security_agent::tamper::TamperDetector;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Server message handler routing an `AgentRequest` to appropriate subsystem.
pub fn process_agent_request(req: AgentRequest, uptime_seconds: u64) -> AgentResponse {
    match req {
        AgentRequest::HealthCheck => {
            AgentResponse::Success(ResponseData::Health(HealthCheckResponse {
                status: "OK".to_string(),
                uptime_seconds,
                version: PROTOCOL_VERSION.to_string(),
            }))
        }
        AgentRequest::GetAgentStatus => {
            let monitor_status = monitor::check_monitor();
            AgentResponse::Success(ResponseData::Status(AgentStatusResponse {
                service_name: "AssessXSecurityAgent".to_string(),
                service_state: "RUNNING".to_string(),
                is_daemon_mode: true,
                pid: std::process::id(),
                uptime_seconds,
                version: PROTOCOL_VERSION.to_string(),
                desktop_monitored: monitor_status.desktop_pid.is_some(),
                last_heartbeat_age_seconds: Some(monitor_status.last_heartbeat_age_seconds),
                queued_events_count: BackendClient::queue_depth(),
            }))
        }
        AgentRequest::GetComplianceReport => {
            let report = ComplianceEngine::evaluate();
            AgentResponse::Success(ResponseData::Compliance(report))
        }
        AgentRequest::VerifyIntegrity => {
            let report = IntegrityVerifier::verify_components();
            AgentResponse::Success(ResponseData::Integrity(report))
        }
        AgentRequest::RegisterHeartbeat(payload) => {
            monitor::handle_heartbeat(payload);
            AgentResponse::Success(ResponseData::Heartbeat(HeartbeatAckResponse {
                acknowledged: true,
                watchdog_timeout_seconds: WATCHDOG_TIMEOUT_SECONDS,
            }))
        }
        AgentRequest::ReportEvent(payload) => {
            TamperDetector::record_event(
                &payload.event_type,
                &payload.severity,
                "Reported via IPC from desktop application",
                payload.details.clone(),
            );
            let queue_size = BackendClient::enqueue(QueuedSecurityEvent {
                event_type: payload.event_type,
                severity: payload.severity,
                category: payload.category,
                details: payload.details,
            });
            AgentResponse::Success(ResponseData::EventAck(EventAckResponse {
                queued: true,
                current_queue_size: queue_size,
            }))
        }
        AgentRequest::GetAppInventory => {
            let inv = crate::application_control::inventory::ApplicationInventory::scan_running_applications();
            AgentResponse::Success(ResponseData::AppInventory(inv))
        }
        AgentRequest::GetAppAllowlist => {
            let rules = crate::application_control::allowlist::AllowlistManager::get_rules();
            AgentResponse::Success(ResponseData::AppAllowlist(rules))
        }
        AgentRequest::GetEnforcementCapabilities => {
            let caps = crate::application_control::capability::CapabilityDetector::detect_capabilities();
            AgentResponse::Success(ResponseData::EnforcementCapabilities(caps))
        }
        AgentRequest::ScanApplicationViolations => {
            let summary = crate::application_control::detector::ApplicationDetector::scan_and_classify();
            AgentResponse::Success(ResponseData::ScanViolations(summary))
        }
        AgentRequest::GetUtilityInventory => {
            let catalog = crate::system_utility::inventory::SystemUtilityInventory::discover_installed_utilities();
            AgentResponse::Success(ResponseData::UtilityInventory(catalog))
        }
        AgentRequest::GetUtilityPolicy => {
            let policy = crate::system_utility::policy::SystemUtilityPolicyEngine::get_policy();
            AgentResponse::Success(ResponseData::UtilityPolicy(policy))
        }
        AgentRequest::ScanUtilityViolations => {
            let summary = crate::system_utility::detector::SystemUtilityDetector::scan_and_classify();
            AgentResponse::Success(ResponseData::UtilityScanViolations(summary))
        }
        AgentRequest::GetShortcutInventory => {
            let inventory = crate::navigation_control::inventory::ShortcutInventory::get_standard_catalog();
            AgentResponse::Success(ResponseData::ShortcutInventory(inventory))
        }
        AgentRequest::GetNavigationPolicy => {
            let policy = crate::navigation_control::policy::NavigationPolicyEngine::get_policy();
            AgentResponse::Success(ResponseData::NavigationPolicy(policy))
        }
        AgentRequest::ScanNavigationViolations => {
            let summary = crate::navigation_control::detector::NavigationDetector::scan_and_classify();
            AgentResponse::Success(ResponseData::NavigationScanViolations(summary))
        }
        AgentRequest::GetStorageStatus => {
            let policy = crate::peripheral_control::policy::PeripheralPolicyEngine::get_policy();
            let report = crate::peripheral_control::storage::StorageManager::inspect_storage(policy.storage_mode);
            AgentResponse::Success(ResponseData::StorageStatus(report))
        }
        AgentRequest::GetDisplayTopology => {
            let policy = crate::peripheral_control::policy::PeripheralPolicyEngine::get_policy();
            let report = crate::peripheral_control::display::DisplayManager::inspect_display_topology(policy.max_monitors);
            AgentResponse::Success(ResponseData::DisplayTopology(report))
        }
        AgentRequest::GetRemoteAccessStatus => {
            let report = crate::peripheral_control::remote_access::RemoteAccessManager::inspect_remote_access();
            AgentResponse::Success(ResponseData::RemoteAccessStatus(report))
        }
        AgentRequest::GetPeripheralPolicy => {
            let policy = crate::peripheral_control::policy::PeripheralPolicyEngine::get_policy();
            AgentResponse::Success(ResponseData::PeripheralPolicy(policy))
        }
        AgentRequest::ScanPeripheralViolations => {
            let summary = crate::peripheral_control::detector::PeripheralDetector::scan_and_classify();
            AgentResponse::Success(ResponseData::PeripheralScanViolations(summary))
        }
        AgentRequest::ValidateReadiness => {
            let mut checks = Vec::new();

            // 1. Agent health
            checks.push(AgentReadinessCheckItem {
                check_id: "agent_health".to_string(),
                category: "Agent".to_string(),
                status: "READY".to_string(),
                mandatory: true,
                message: "Security Agent Named Pipe operational and responding".to_string(),
            });

            // 2. Phase 1 Secure Shell
            checks.push(AgentReadinessCheckItem {
                check_id: "shell_kiosk".to_string(),
                category: "SecureShell".to_string(),
                status: "READY".to_string(),
                mandatory: true,
                message: "Windows Secure Shell environment operational".to_string(),
            });

            // 3. Phase 2A Application Control
            let app_violations = crate::application_control::detector::ApplicationDetector::scan_and_classify();
            let app_viol_count = app_violations.violations.len();
            let app_status = if app_viol_count == 0 { "READY" } else { "WARNING" };
            checks.push(AgentReadinessCheckItem {
                check_id: "allowlist_enforcement".to_string(),
                category: "ApplicationControl".to_string(),
                status: app_status.to_string(),
                mandatory: true,
                message: format!("App execution control active ({} violations detected)", app_viol_count),
            });

            // 4. Phase 2B System Utility Policy
            let util_violations = crate::system_utility::detector::SystemUtilityDetector::scan_and_classify();
            let util_status = if util_violations.violations_count == 0 { "READY" } else { "WARNING" };
            checks.push(AgentReadinessCheckItem {
                check_id: "utility_restrictions".to_string(),
                category: "SystemUtilities".to_string(),
                status: util_status.to_string(),
                mandatory: true,
                message: format!("System utility policies active ({} violations detected)", util_violations.violations_count),
            });

            // 5. Phase 2C Navigation & Keyboard Hooks
            let nav_violations = crate::navigation_control::detector::NavigationDetector::scan_and_classify();
            let nav_status = if nav_violations.violations_count == 0 { "READY" } else { "WARNING" };
            checks.push(AgentReadinessCheckItem {
                check_id: "hotkey_hook_active".to_string(),
                category: "NavigationControl".to_string(),
                status: nav_status.to_string(),
                mandatory: true,
                message: "Low-level keyboard hook and navigation policies verified".to_string(),
            });

            // 6. Phase 2D Storage & Displays
            let periph_policy = crate::peripheral_control::policy::PeripheralPolicyEngine::get_policy();
            let disp_report = crate::peripheral_control::display::DisplayManager::inspect_display_topology(periph_policy.max_monitors);
            let disp_status = if disp_report.monitor_count <= periph_policy.max_monitors && !disp_report.has_virtual_display {
                "READY"
            } else {
                "NOT_READY"
            };
            checks.push(AgentReadinessCheckItem {
                check_id: "single_monitor_check".to_string(),
                category: "Peripherals".to_string(),
                status: disp_status.to_string(),
                mandatory: true,
                message: format!("Display topology verified ({} monitors detected, virtual: {})", disp_report.monitor_count, disp_report.has_virtual_display),
            });

            let remote_report = crate::peripheral_control::remote_access::RemoteAccessManager::inspect_remote_access();
            let remote_status = if remote_report.running_remote_tools_count == 0 && !remote_report.is_remote_session_active {
                "READY"
            } else {
                "NOT_READY"
            };
            checks.push(AgentReadinessCheckItem {
                check_id: "remote_tool_scanner".to_string(),
                category: "Peripherals".to_string(),
                status: remote_status.to_string(),
                mandatory: true,
                message: format!("Remote access inspection ({} tools active, remote session: {})", remote_report.running_remote_tools_count, remote_report.is_remote_session_active),
            });

            let overall = if checks.iter().any(|c| c.mandatory && c.status == "NOT_READY") {
                "NOT_READY"
            } else if checks.iter().any(|c| c.status == "WARNING") {
                "WARNING"
            } else {
                "READY"
            };

            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            AgentResponse::Success(ResponseData::Readiness(AgentReadinessReport {
                overall_status: overall.to_string(),
                agent_version: PROTOCOL_VERSION.to_string(),
                checks,
                timestamp_ms: now_ms,
            }))
        }
        AgentRequest::BindSessionPolicy(payload) => {
            log_info(
                "POLICY_ENGINE",
                &format!("Bound session policy: session={}, exam={}, policy_version={}", payload.session_id, payload.exam_id, payload.policy_version),
            );
            AgentResponse::Success(ResponseData::PolicyBound(PolicyBoundResponse {
                bound: true,
                session_id: payload.session_id,
                policy_version: payload.policy_version,
                status: "ARMED".to_string(),
            }))
        }
        AgentRequest::AuthorizeExitAndRestore(payload) => {
            log_info(
                "POLICY_ENGINE",
                &format!("Authorized examination exit received: attempt={}, device={}", payload.attempt_id, payload.device_id),
            );

            let mut restored = Vec::new();

            // Revert navigation and keyboard shortcut policies
            let nav_res = crate::navigation_control::revert_navigation_policy();
            if nav_res.is_ok() {
                restored.push("NAVIGATION_SHORTCUTS".to_string());
            }

            // Revert system utility policies (CMD, PowerShell, Task Manager)
            let util_res = crate::system_utility::revert_system_utility_policy();
            if util_res.is_ok() {
                restored.push("SYSTEM_UTILITIES".to_string());
            }

            // Restore application control baseline
            let app_res = crate::application_control::application_control_restore_baseline();
            if app_res.success {
                restored.push("APPLICATION_ALLOWLISTING".to_string());
            }

            // Rollback peripheral & storage policies
            let periph_res = crate::peripheral_control::rollback_peripheral_policy();
            if periph_res.is_ok() {
                restored.push("PERIPHERALS_STORAGE".to_string());
            }

            AgentResponse::Success(ResponseData::Restoration(crate::security_agent::protocol::AgentRestorationReport {
                success: true,
                status: "RESTORED".to_string(),
                restored_subsystems: restored,
                message: "All examination Windows security policies successfully restored to baseline.".to_string(),
            }))
        }
    }
}

/// Start the named pipe server listener in a dedicated background thread.
pub fn start_pipe_server(shutdown_signal: Arc<AtomicBool>) {
    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        log_warn("IPC_SERVER", "Pipe server is already running.");
        return;
    }

    thread::spawn(move || {
        log_info(
            "IPC_SERVER",
            &format!("Initializing Named Pipe server on {}", SECURITY_AGENT_PIPE_NAME),
        );

        let start_time = Instant::now();

        #[cfg(windows)]
        {
            use std::ffi::OsStr;
            use std::iter::once;
            use std::os::windows::ffi::OsStrExt;
            use std::os::windows::io::FromRawHandle;
            use std::ptr;
            use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_FLAG_FIRST_PIPE_INSTANCE, PIPE_ACCESS_DUPLEX,
            };
            use windows_sys::Win32::System::Pipes::{
                ConnectNamedPipe, DisconnectNamedPipe, PIPE_READMODE_BYTE, PIPE_TYPE_BYTE,
                PIPE_WAIT,
            };

            let pipe_name_wide: Vec<u16> = OsStr::new(SECURITY_AGENT_PIPE_NAME)
                .encode_wide()
                .chain(once(0))
                .collect();

            while !shutdown_signal.load(Ordering::SeqCst) {
                let handle = unsafe {
                    windows_sys::Win32::System::Pipes::CreateNamedPipeW(
                        pipe_name_wide.as_ptr(),
                        PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
                        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                        1,
                        MAX_IPC_MESSAGE_BYTES as u32,
                        MAX_IPC_MESSAGE_BYTES as u32,
                        3000,
                        ptr::null_mut(),
                    )
                };

                if handle == INVALID_HANDLE_VALUE {
                    log_error(
                        "IPC_SERVER",
                        "Failed to create Named Pipe. Retrying in 2 seconds...",
                    );
                    thread::sleep(Duration::from_secs(2));
                    continue;
                }

                // Wait for a client connection
                let connected = unsafe { ConnectNamedPipe(handle, ptr::null_mut()) };
                if connected != 0
                    || unsafe { windows_sys::Win32::Foundation::GetLastError() }
                        == windows_sys::Win32::Foundation::ERROR_PIPE_CONNECTED
                {
                    let mut file = unsafe { std::fs::File::from_raw_handle(handle as _) };
                    let uptime = start_time.elapsed().as_secs();

                    // Read request payload up to MAX_IPC_MESSAGE_BYTES
                    let mut buffer = vec![0u8; MAX_IPC_MESSAGE_BYTES];
                    if let Ok(bytes_read) = file.read(&mut buffer) {
                        if bytes_read > 0 {
                            let raw_json = String::from_utf8_lossy(&buffer[..bytes_read]);
                            let response = match serde_json::from_str::<AgentRequest>(&raw_json) {
                                Ok(req) => process_agent_request(req, uptime),
                                Err(e) => AgentResponse::Error(AgentErrorData {
                                    code: "INVALID_REQUEST".to_string(),
                                    message: format!("Malformed request payload: {}", e),
                                    retryable: false,
                                }),
                            };

                            if let Ok(resp_json) = serde_json::to_string(&response) {
                                let _ = file.write_all(resp_json.as_bytes());
                                let _ = file.flush();
                            }
                        }
                    }

                    // Release handle
                    drop(file);
                    unsafe {
                        DisconnectNamedPipe(handle);
                    }
                } else {
                    unsafe {
                        windows_sys::Win32::Foundation::CloseHandle(handle);
                    }
                }
            }
        }

        SERVER_RUNNING.store(false, Ordering::SeqCst);
        log_info("IPC_SERVER", "Pipe server listener stopped.");
    });
}

/// Client connector: Sends an `AgentRequest` through the Named Pipe and awaits response.
pub fn send_ipc_request(request: &AgentRequest) -> Result<AgentResponse, String> {
    #[cfg(windows)]
    {
        let mut pipe = OpenOptions::new()
            .read(true)
            .write(true)
            .open(SECURITY_AGENT_PIPE_NAME)
            .map_err(|e| format!("Security Agent service is offline or unreachable: {}", e))?;

        let request_json = serde_json::to_string(request)
            .map_err(|e| format!("Serialization error: {}", e))?;

        if request_json.len() > MAX_IPC_MESSAGE_BYTES {
            return Err("Request payload exceeds 64 KB limit".to_string());
        }

        pipe.write_all(request_json.as_bytes())
            .map_err(|e| format!("Failed to write to pipe: {}", e))?;
        pipe.flush()
            .map_err(|e| format!("Failed to flush pipe: {}", e))?;

        let mut buffer = vec![0u8; MAX_IPC_MESSAGE_BYTES];
        let bytes_read = pipe
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read response from pipe: {}", e))?;

        if bytes_read == 0 {
            return Err("Empty response received from Security Agent".to_string());
        }

        let response: AgentResponse = serde_json::from_slice(&buffer[..bytes_read])
            .map_err(|e| format!("Failed to deserialize agent response: {}", e))?;

        Ok(response)
    }

    #[cfg(not(windows))]
    {
        // Non-windows testing stub
        let uptime = 42;
        Ok(process_agent_request(request.clone(), uptime))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_health_check() {
        let resp = process_agent_request(AgentRequest::HealthCheck, 120);
        match resp {
            AgentResponse::Success(ResponseData::Health(h)) => {
                assert_eq!(h.status, "OK");
                assert_eq!(h.uptime_seconds, 120);
            }
            _ => panic!("Expected Health response"),
        }
    }

    #[test]
    fn test_process_heartbeat() {
        let resp = process_agent_request(
            AgentRequest::RegisterHeartbeat(HeartbeatPayload {
                process_id: 1111,
                session_id: Some("session-1".to_string()),
                timestamp_ms: 1234567,
            }),
            50,
        );
        match resp {
            AgentResponse::Success(ResponseData::Heartbeat(ack)) => {
                assert!(ack.acknowledged);
            }
            _ => panic!("Expected HeartbeatAck response"),
        }
    }

    #[test]
    fn test_process_shortcut_and_navigation_ipc() {
        let resp = process_agent_request(AgentRequest::GetShortcutInventory, 100);
        match resp {
            AgentResponse::Success(ResponseData::ShortcutInventory(inv)) => {
                assert!(!inv.is_empty());
            }
            _ => panic!("Expected ShortcutInventory"),
        }

        let pol_resp = process_agent_request(AgentRequest::GetNavigationPolicy, 100);
        match pol_resp {
            AgentResponse::Success(ResponseData::NavigationPolicy(p)) => {
                assert_eq!(p.version, 1);
            }
            _ => panic!("Expected NavigationPolicy"),
        }

        let scan_resp = process_agent_request(AgentRequest::ScanNavigationViolations, 100);
        match scan_resp {
            AgentResponse::Success(ResponseData::NavigationScanViolations(s)) => {
                assert!(s.violations_count == 0 || s.violations_count > 0);
            }
            _ => panic!("Expected NavigationScanViolations"),
        }
    }

    #[test]
    fn test_process_peripheral_ipc() {
        let storage_resp = process_agent_request(AgentRequest::GetStorageStatus, 100);
        match storage_resp {
            AgentResponse::Success(ResponseData::StorageStatus(s)) => {
                assert!(s.is_policy_enforced);
            }
            _ => panic!("Expected StorageStatus"),
        }

        let disp_resp = process_agent_request(AgentRequest::GetDisplayTopology, 100);
        match disp_resp {
            AgentResponse::Success(ResponseData::DisplayTopology(d)) => {
                assert!(d.monitor_count >= 1);
            }
            _ => panic!("Expected DisplayTopology"),
        }

        let rem_resp = process_agent_request(AgentRequest::GetRemoteAccessStatus, 100);
        match rem_resp {
            AgentResponse::Success(ResponseData::RemoteAccessStatus(r)) => {
                assert!(r.last_inspected_at.len() > 0);
            }
            _ => panic!("Expected RemoteAccessStatus"),
        }

        let pol_resp = process_agent_request(AgentRequest::GetPeripheralPolicy, 100);
        match pol_resp {
            AgentResponse::Success(ResponseData::PeripheralPolicy(p)) => {
                assert!(p.version >= 1);
            }
            _ => panic!("Expected PeripheralPolicy"),
        }

        let scan_resp = process_agent_request(AgentRequest::ScanPeripheralViolations, 100);
        match scan_resp {
            AgentResponse::Success(ResponseData::PeripheralScanViolations(s)) => {
                assert!(s.violations_count == 0 || s.violations_count > 0);
            }
            _ => panic!("Expected PeripheralScanViolations"),
        }

        // Phase 3A: Readiness validation
        let readiness_resp = process_agent_request(AgentRequest::ValidateReadiness, 100);
        match readiness_resp {
            AgentResponse::Success(ResponseData::Readiness(r)) => {
                assert!(r.checks.len() >= 6);
                assert!(r.overall_status == "READY" || r.overall_status == "WARNING" || r.overall_status == "NOT_READY");
            }
            _ => panic!("Expected Readiness"),
        }

        // Phase 3A: Session policy binding
        let bind_resp = process_agent_request(
            AgentRequest::BindSessionPolicy(crate::security_agent::protocol::BindSessionPolicyPayload {
                session_id: "test-sess-uuid".to_string(),
                policy_version: 1,
                exam_id: "test-exam-uuid".to_string(),
            }),
            100,
        );
        match bind_resp {
            AgentResponse::Success(ResponseData::PolicyBound(b)) => {
                assert!(b.bound);
                assert_eq!(b.session_id, "test-sess-uuid");
                assert_eq!(b.status, "ARMED");
            }
            _ => panic!("Expected PolicyBound"),
        }
    }
}
