//! AssessX Native Security Agent & System Integration (Phase 1C).
//!
//! Provides background service lifecycle control, secure Windows Named Pipe IPC,
//! session & process monitoring, device compliance policy evaluation, SHA-256 integrity
//! verification, tamper detection, and offline event queueing for backend reporting.

pub mod backend_client;
pub mod compliance;
pub mod integrity;
pub mod ipc;
pub mod logger;
pub mod monitor;
pub mod protocol;
pub mod recovery;
pub mod service;
pub mod tamper;

use backend_client::{BackendClient, QueuedSecurityEvent};
use compliance::ComplianceEngine;
use integrity::IntegrityVerifier;
use protocol::{ComplianceReportResponse, IntegrityReportResponse};
use recovery::{get_recovery_status, reset_recovery, RecoveryStatus};
use service::{ServiceManager, ServiceStatus};
use tamper::{TamperDetector, TamperEvent};

/// Query status of the Security Agent (service or daemon).
#[tauri::command]
pub fn get_security_agent_status() -> ServiceStatus {
    ServiceManager::query_status()
}

/// Start Security Agent in safe in-process daemon mode.
#[tauri::command]
pub fn start_security_agent_daemon() -> Result<ServiceStatus, String> {
    ServiceManager::start_daemon()
}

/// Stop the in-process daemon.
#[tauri::command]
pub fn stop_security_agent_daemon() -> Result<ServiceStatus, String> {
    ServiceManager::stop_daemon()
}

/// Install Windows Service in SCM (requires elevation).
#[tauri::command]
pub fn install_security_agent_service() -> Result<String, String> {
    ServiceManager::install_service()
}

/// Uninstall Windows Service from SCM (requires elevation).
#[tauri::command]
pub fn uninstall_security_agent_service() -> Result<String, String> {
    ServiceManager::uninstall_service()
}

/// Evaluate device compliance against policy v1.0.
#[tauri::command]
pub fn get_device_compliance_report() -> ComplianceReportResponse {
    ComplianceEngine::evaluate()
}

/// Compute cryptographic SHA-256 hashes of critical files.
#[tauri::command]
pub fn verify_component_integrity() -> IntegrityReportResponse {
    IntegrityVerifier::verify_components()
}

/// Get recorded tamper detection events.
#[tauri::command]
pub fn get_agent_tamper_events() -> Vec<TamperEvent> {
    TamperDetector::get_events()
}

/// Record a heartbeat from desktop frontend.
#[tauri::command]
pub fn send_agent_heartbeat(session_id: Option<String>) -> bool {
    monitor::handle_heartbeat(protocol::HeartbeatPayload {
        process_id: std::process::id(),
        session_id,
        timestamp_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    });
    true
}

/// Forward an application security event to the agent's offline queue.
#[tauri::command]
pub fn report_agent_security_event(
    event_type: String,
    severity: String,
    category: String,
    details: serde_json::Value,
) -> usize {
    TamperDetector::record_event(
        &event_type,
        &severity,
        "Forwarded from desktop application",
        details.clone(),
    );
    BackendClient::enqueue(QueuedSecurityEvent {
        event_type,
        severity,
        category,
        details,
    })
}

/// Flush queued security events to backend.
#[tauri::command]
pub fn flush_security_agent_events(
    backend_url: String,
    auth_token: Option<String>,
) -> Result<usize, String> {
    BackendClient::flush(&backend_url, auth_token.as_deref())
}

/// Query recovery status and restart history.
#[tauri::command]
pub fn get_agent_recovery_status() -> RecoveryStatus {
    get_recovery_status()
}

/// Reset recovery lockout state (Admin action).
#[tauri::command]
pub fn reset_agent_recovery() -> bool {
    reset_recovery();
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_security_agent_module_exports() {
        let status = get_security_agent_status();
        assert_eq!(status.service_name, "AssessXSecurityAgent");

        let compliance = get_device_compliance_report();
        assert!(!compliance.results.is_empty());

        let integrity = verify_component_integrity();
        assert!(!integrity.components.is_empty());
    }
}

