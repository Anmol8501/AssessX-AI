//! Protocol and message schemas for AssessX Native Security Agent (Phase 1C).
//!
//! Defines strongly-typed JSON message formats, command discriminants, and
//! error codes for communication over Windows Named Pipes (`\\.\pipe\AssessXSecurityAgent`).

use crate::application_control::allowlist::AllowlistEntry;
use crate::application_control::capability::EnforcementCapabilityReport;
use crate::application_control::detector::ApplicationScanSummary;
use crate::application_control::identity::ApplicationIdentity;
use crate::navigation_control::detector::NavigationScanSummary;
use crate::navigation_control::inventory::ShortcutItem;
use crate::navigation_control::policy::NavigationControlPolicyConfig;
use crate::peripheral_control::detector::PeripheralScanSummary;
use crate::peripheral_control::display::DisplayTopologyReport;
use crate::peripheral_control::policy::PeripheralPolicyConfig;
use crate::peripheral_control::remote_access::RemoteAccessStatusReport;
use crate::peripheral_control::storage::StorageStatusReport;
use crate::system_utility::detector::SystemUtilityScanSummary;
use crate::system_utility::inventory::SystemUtilityItem;
use crate::system_utility::policy::SystemUtilityPolicyConfig;
use serde::{Deserialize, Serialize};

/// Windows Named Pipe endpoint for AssessX Security Agent.
pub const SECURITY_AGENT_PIPE_NAME: &str = r"\\.\pipe\AssessXSecurityAgent";

/// Maximum allowed message payload size (64 KB) to protect against buffer exhaustion attacks.
pub const MAX_IPC_MESSAGE_BYTES: usize = 65536;

/// Protocol version identifier.
pub const PROTOCOL_VERSION: &str = "1.0.0";

/// Discriminant for client requests to the Security Agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "action", content = "payload")]
pub enum AgentRequest {
    /// Immediate ping/pong and service uptime check.
    #[serde(rename = "HEALTH_CHECK")]
    HealthCheck,

    /// Query service state, uptime, and worker health.
    #[serde(rename = "GET_AGENT_STATUS")]
    GetAgentStatus,

    /// Trigger evaluation of device compliance policy v1.0.
    #[serde(rename = "GET_COMPLIANCE_REPORT")]
    GetComplianceReport,

    /// Trigger SHA-256 verification of binaries and manifests.
    #[serde(rename = "VERIFY_INTEGRITY")]
    VerifyIntegrity,

    /// Heartbeat signal emitted by the desktop UI process.
    #[serde(rename = "REGISTER_HEARTBEAT")]
    RegisterHeartbeat(HeartbeatPayload),

    /// Forward a security or tamper event to the agent's reporting queue.
    #[serde(rename = "REPORT_EVENT")]
    ReportEvent(ReportEventPayload),

    /// Query running application inventory.
    #[serde(rename = "GET_APP_INVENTORY")]
    GetAppInventory,

    /// Query active application allowlist rules.
    #[serde(rename = "GET_APP_ALLOWLIST")]
    GetAppAllowlist,

    /// Query Windows application enforcement capabilities.
    #[serde(rename = "GET_ENFORCEMENT_CAPABILITIES")]
    GetEnforcementCapabilities,

    /// Scan running applications for policy violations.
    #[serde(rename = "SCAN_APPLICATION_VIOLATIONS")]
    ScanApplicationViolations,

    /// Query system utility inventory (Phase 2B).
    #[serde(rename = "GET_UTILITY_INVENTORY")]
    GetUtilityInventory,

    /// Query active system utility policy (Phase 2B).
    #[serde(rename = "GET_UTILITY_POLICY")]
    GetUtilityPolicy,

    /// Scan running utilities for violations (Phase 2B).
    #[serde(rename = "SCAN_UTILITY_VIOLATIONS")]
    ScanUtilityViolations,

    /// Query shortcut inventory (Phase 2C).
    #[serde(rename = "GET_SHORTCUT_INVENTORY")]
    GetShortcutInventory,

    /// Query active navigation policy (Phase 2C).
    #[serde(rename = "GET_NAVIGATION_POLICY")]
    GetNavigationPolicy,

    /// Scan navigation violations (Phase 2C).
    #[serde(rename = "SCAN_NAVIGATION_VIOLATIONS")]
    ScanNavigationViolations,

    /// Query removable storage status (Phase 2D).
    #[serde(rename = "GET_STORAGE_STATUS")]
    GetStorageStatus,

    /// Query display topology (Phase 2D).
    #[serde(rename = "GET_DISPLAY_TOPOLOGY")]
    GetDisplayTopology,

    /// Query remote-access status (Phase 2D).
    #[serde(rename = "GET_REMOTE_ACCESS_STATUS")]
    GetRemoteAccessStatus,

    /// Query peripheral policy (Phase 2D).
    #[serde(rename = "GET_PERIPHERAL_POLICY")]
    GetPeripheralPolicy,

    /// Scan peripheral violations (Phase 2D).
    #[serde(rename = "SCAN_PERIPHERAL_VIOLATIONS")]
    ScanPeripheralViolations,

    /// Trigger aggregate pre-flight readiness scan (Phase 3A).
    #[serde(rename = "VALIDATE_READINESS")]
    ValidateReadiness,

    /// Bind active session ID and policy version to agent runtime (Phase 3A).
    #[serde(rename = "BIND_SESSION_POLICY")]
    BindSessionPolicy(BindSessionPolicyPayload),

    /// Authorize examination exit and execute native security policy restoration (Phase 3C).
    #[serde(rename = "AUTHORIZE_EXIT_AND_RESTORE")]
    AuthorizeExitAndRestore(AuthorizeExitPayload),
}

/// Payload sent to authorize examination closure and native OS policy restoration (Phase 3C).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthorizeExitPayload {
    pub attempt_id: String,
    pub exit_token: String,
    pub device_id: String,
}

/// Result of native security restoration returned by agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentRestorationReport {
    pub success: bool,
    pub status: String,
    pub restored_subsystems: Vec<String>,
    pub message: String,
}

/// Payload sent to bind session context to the security agent (Phase 3A).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BindSessionPolicyPayload {
    pub session_id: String,
    pub policy_version: u32,
    pub exam_id: String,
}

/// A single readiness check item reported by the agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentReadinessCheckItem {
    pub check_id: String,
    pub category: String,
    pub status: String,
    pub mandatory: bool,
    pub message: String,
}

/// Aggregate readiness report from the agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentReadinessReport {
    pub overall_status: String,
    pub agent_version: String,
    pub checks: Vec<AgentReadinessCheckItem>,
    pub timestamp_ms: u64,
}

/// Confirmation of bound session policy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyBoundResponse {
    pub bound: bool,
    pub session_id: String,
    pub policy_version: u32,
    pub status: String,
}

/// Payload sent with desktop process heartbeat.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeartbeatPayload {
    pub process_id: u32,
    pub session_id: Option<String>,
    pub timestamp_ms: u64,
}

/// Payload sent when an event is reported from the desktop app.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReportEventPayload {
    pub event_type: String,
    pub severity: String,
    pub category: String,
    pub details: serde_json::Value,
}

/// Typed responses sent back by the Security Agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", content = "data")]
pub enum AgentResponse {
    #[serde(rename = "SUCCESS")]
    Success(ResponseData),

    #[serde(rename = "ERROR")]
    Error(AgentErrorData),
}

/// Successful payload variants.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum ResponseData {
    Health(HealthCheckResponse),
    Status(AgentStatusResponse),
    Compliance(ComplianceReportResponse),
    Integrity(IntegrityReportResponse),
    Heartbeat(HeartbeatAckResponse),
    EventAck(EventAckResponse),
    AppInventory(Vec<ApplicationIdentity>),
    AppAllowlist(Vec<AllowlistEntry>),
    EnforcementCapabilities(EnforcementCapabilityReport),
    ScanViolations(ApplicationScanSummary),
    UtilityInventory(Vec<SystemUtilityItem>),
    UtilityPolicy(SystemUtilityPolicyConfig),
    UtilityScanViolations(SystemUtilityScanSummary),
    ShortcutInventory(Vec<ShortcutItem>),
    NavigationPolicy(NavigationControlPolicyConfig),
    NavigationScanViolations(NavigationScanSummary),
    StorageStatus(StorageStatusReport),
    DisplayTopology(DisplayTopologyReport),
    RemoteAccessStatus(RemoteAccessStatusReport),
    PeripheralPolicy(PeripheralPolicyConfig),
    PeripheralScanViolations(PeripheralScanSummary),
    Readiness(AgentReadinessReport),
    PolicyBound(PolicyBoundResponse),
    Restoration(AgentRestorationReport),
}

/// Error details returned when an IPC request fails.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentErrorData {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

/// Health check response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthCheckResponse {
    pub status: String,
    pub uptime_seconds: u64,
    pub version: String,
}

/// Service status details.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentStatusResponse {
    pub service_name: String,
    pub service_state: String,
    pub is_daemon_mode: bool,
    pub pid: u32,
    pub uptime_seconds: u64,
    pub version: String,
    pub desktop_monitored: bool,
    pub last_heartbeat_age_seconds: Option<u64>,
    pub queued_events_count: usize,
}

/// Device compliance evaluation summary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ComplianceReportResponse {
    pub evaluated_at: String,
    pub policy_version: String,
    pub overall_status: String, // "COMPLIANT", "NON_COMPLIANT", "WARNING", "UNKNOWN"
    pub total_rules: usize,
    pub passed_rules: usize,
    pub failed_rules: usize,
    pub warning_rules: usize,
    pub results: Vec<ComplianceRuleResult>,
}

/// Individual compliance rule result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ComplianceRuleResult {
    pub rule_id: String,
    pub title: String,
    pub category: String,
    pub status: String, // "PASS", "FAIL", "WARNING"
    pub severity: String, // "LOW", "MEDIUM", "HIGH", "CRITICAL"
    pub observed_value: String,
    pub expected_value: String,
    pub remediation: Option<String>,
}

/// Integrity check result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IntegrityReportResponse {
    pub evaluated_at: String,
    pub overall_valid: bool,
    pub components: Vec<ComponentIntegrityResult>,
}

/// Individual component verification result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ComponentIntegrityResult {
    pub component_name: String,
    pub file_path: String,
    pub expected_sha256: Option<String>,
    pub actual_sha256: Option<String>,
    pub status: String, // "VALID", "MISMATCH", "FILE_NOT_FOUND", "UNREADABLE"
}

/// Heartbeat acknowledgement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HeartbeatAckResponse {
    pub acknowledged: bool,
    pub watchdog_timeout_seconds: u64,
}

/// Event ingestion acknowledgement.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventAckResponse {
    pub queued: bool,
    pub current_queue_size: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_deserialize_health_check() {
        let req = AgentRequest::HealthCheck;
        let json = serde_json::to_string(&req).expect("serialize");
        assert!(json.contains("HEALTH_CHECK"));

        let deserialized: AgentRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized, req);
    }

    #[test]
    fn test_serialize_deserialize_heartbeat() {
        let req = AgentRequest::RegisterHeartbeat(HeartbeatPayload {
            process_id: 1234,
            session_id: Some("session-123".to_string()),
            timestamp_ms: 1731000000000,
        });
        let json = serde_json::to_string(&req).expect("serialize");
        let deserialized: AgentRequest = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized, req);
    }

    #[test]
    fn test_serialize_deserialize_error_response() {
        let err = AgentResponse::Error(AgentErrorData {
            code: "UNAUTHORIZED".to_string(),
            message: "Access denied".to_string(),
            retryable: false,
        });
        let json = serde_json::to_string(&err).expect("serialize");
        assert!(json.contains("UNAUTHORIZED"));
    }
}
