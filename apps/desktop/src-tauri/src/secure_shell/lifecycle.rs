//! Examination Session Lifecycle & Startup Validation Engine (Stage 5, Phase 1B).
//!
//! Enforces a formal state machine for examination terminal startup and transitions.
//! Executes pre-flight validation rules before permitting access to active examinations.
//! Maintains compatibility with the future Phase 1C Native Security Agent.

use serde::Serialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use crate::provisioning::accounts::inspect_candidate_account;
use crate::provisioning::chrono_or_fallback_timestamp;
use crate::provisioning::device_id::get_or_create_device_identity;
use crate::provisioning::hardware::scan_hardware_readiness;
use crate::provisioning::validation::validate_configuration;
use super::kiosk_capability::detect_kiosk_capabilities;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SessionLifecycleState {
    DeviceStartup,
    WindowsUserSession,
    SecureShellStarting,
    SecureShellReady,
    SecurityValidation,
    SessionReady,
    ExaminationActive,
    ExaminationInterrupted,
    RecoveryInProgress,
    AuthorisedExitPending,
    RestorationInProgress,
    NormalMode,
    Error,
    AdminRecoveryRequired,
}

impl SessionLifecycleState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::DeviceStartup => "DEVICE_STARTUP",
            Self::WindowsUserSession => "WINDOWS_USER_SESSION",
            Self::SecureShellStarting => "SECURE_SHELL_STARTING",
            Self::SecureShellReady => "SECURE_SHELL_READY",
            Self::SecurityValidation => "SECURITY_VALIDATION",
            Self::SessionReady => "SESSION_READY",
            Self::ExaminationActive => "EXAMINATION_ACTIVE",
            Self::ExaminationInterrupted => "EXAMINATION_INTERRUPTED",
            Self::RecoveryInProgress => "RECOVERY_IN_PROGRESS",
            Self::AuthorisedExitPending => "AUTHORISED_EXIT_PENDING",
            Self::RestorationInProgress => "RESTORATION_IN_PROGRESS",
            Self::NormalMode => "NORMAL_MODE",
            Self::Error => "ERROR",
            Self::AdminRecoveryRequired => "ADMIN_RECOVERY_REQUIRED",
        }
    }
}

pub struct LifecycleManager {
    current_state: Mutex<SessionLifecycleState>,
    active_assessment_id: Mutex<Option<String>>,
    active_attempt_id: Mutex<Option<String>>,
    interruption_count: AtomicUsize,
}

impl Default for LifecycleManager {
    fn default() -> Self {
        Self {
            current_state: Mutex::new(SessionLifecycleState::NormalMode),
            active_assessment_id: Mutex::new(None),
            active_attempt_id: Mutex::new(None),
            interruption_count: AtomicUsize::new(0),
        }
    }
}

impl LifecycleManager {
    pub fn get_state(&self) -> SessionLifecycleState {
        *self.current_state.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn transition_to(&self, next_state: SessionLifecycleState) -> Result<SessionLifecycleState, String> {
        let mut state = self.current_state.lock().unwrap_or_else(|e| e.into_inner());
        let from = *state;

        let valid = match (from, next_state) {
            (_, SessionLifecycleState::AdminRecoveryRequired) => true,
            (_, SessionLifecycleState::Error) => true,
            (SessionLifecycleState::NormalMode, SessionLifecycleState::DeviceStartup) => true,
            (SessionLifecycleState::NormalMode, SessionLifecycleState::SecureShellStarting) => true,
            (SessionLifecycleState::DeviceStartup, SessionLifecycleState::WindowsUserSession) => true,
            (SessionLifecycleState::WindowsUserSession, SessionLifecycleState::SecureShellStarting) => true,
            (SessionLifecycleState::SecureShellStarting, SessionLifecycleState::SecureShellReady) => true,
            (SessionLifecycleState::SecureShellReady, SessionLifecycleState::SecurityValidation) => true,
            (SessionLifecycleState::SecurityValidation, SessionLifecycleState::SessionReady) => true,
            (SessionLifecycleState::SessionReady, SessionLifecycleState::ExaminationActive) => true,
            (SessionLifecycleState::ExaminationActive, SessionLifecycleState::ExaminationInterrupted) => true,
            (SessionLifecycleState::ExaminationActive, SessionLifecycleState::AuthorisedExitPending) => true,
            (SessionLifecycleState::ExaminationInterrupted, SessionLifecycleState::RecoveryInProgress) => true,
            (SessionLifecycleState::RecoveryInProgress, SessionLifecycleState::SecurityValidation) => true,
            (SessionLifecycleState::AuthorisedExitPending, SessionLifecycleState::RestorationInProgress) => true,
            (SessionLifecycleState::RestorationInProgress, SessionLifecycleState::NormalMode) => true,
            (current, target) if current == target => true,
            _ => false,
        };

        if valid {
            *state = next_state;
            Ok(next_state)
        } else {
            Err(format!(
                "Invalid lifecycle state transition: {} -> {}",
                from.as_str(),
                next_state.as_str()
            ))
        }
    }

    pub fn set_active_exam(&self, assessment_id: Option<String>, attempt_id: Option<String>) {
        *self.active_assessment_id.lock().unwrap_or_else(|e| e.into_inner()) = assessment_id;
        *self.active_attempt_id.lock().unwrap_or_else(|e| e.into_inner()) = attempt_id;
    }

    pub fn record_interruption(&self) -> usize {
        let count = self.interruption_count.fetch_add(1, Ordering::SeqCst) + 1;
        let _ = self.transition_to(SessionLifecycleState::ExaminationInterrupted);
        count
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupValidationCheck {
    pub name: &'static str,
    pub status: &'static str, // "PASS" | "WARNING" | "BLOCKED"
    pub explanation: String,
    pub severity: &'static str, // "INFO" | "WARNING" | "CRITICAL"
    pub blocks_startup: bool,
    pub resolution: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExaminationStartupValidationReport {
    pub overall_result: &'static str, // "READY" | "READY_WITH_WARNINGS" | "BLOCKED" | "ERROR"
    pub checks: Vec<StartupValidationCheck>,
    pub timestamp: String,
    pub can_proceed: bool,
}

pub fn run_startup_validation(candidate_account_name: &str) -> ExaminationStartupValidationReport {
    let mut checks = Vec::new();
    let mut blocked = false;

    // 1. Application Binary & Config Integrity
    let config_report = validate_configuration();
    let binary_check = config_report.checks.iter().find(|c| c.name.contains("Binary"));
    let binary_pass = binary_check.map(|c| c.status == "PASS").unwrap_or(false);
    if !binary_pass {
        blocked = true;
        checks.push(StartupValidationCheck {
            name: "Application Binary Integrity",
            status: "BLOCKED",
            explanation: "AssessX executable integrity check failed or path is unverified.".to_string(),
            severity: "CRITICAL",
            blocks_startup: true,
            resolution: "Reinstall AssessX using the official institutional installer.",
        });
    } else {
        checks.push(StartupValidationCheck {
            name: "Application Binary Integrity",
            status: "PASS",
            explanation: "AssessX executable integrity verified.".to_string(),
            severity: "INFO",
            blocks_startup: false,
            resolution: "None required.",
        });
    }

    // 2. Device Identity Foundation
    let device_identity = get_or_create_device_identity();
    if device_identity.device_id.is_empty() {
        blocked = true;
        checks.push(StartupValidationCheck {
            name: "Device Registration",
            status: "BLOCKED",
            explanation: "Cryptographic device identity is missing or uninitialized.".to_string(),
            severity: "CRITICAL",
            blocks_startup: true,
            resolution: "Initialize device identity in Admin Settings -> Device Readiness.",
        });
    } else {
        checks.push(StartupValidationCheck {
            name: "Device Registration",
            status: "PASS",
            explanation: format!("Device Identity active ({})", device_identity.device_id),
            severity: "INFO",
            blocks_startup: false,
            resolution: "None required.",
        });
    }

    // 3. Candidate Account Status
    let acc = inspect_candidate_account(candidate_account_name);
    if acc.is_administrator {
        checks.push(StartupValidationCheck {
            name: "Candidate Account Isolation",
            status: "WARNING",
            explanation: format!("Account '{}' possesses Administrator privileges. Security policies advise standard user isolation.", candidate_account_name),
            severity: "WARNING",
            blocks_startup: false,
            resolution: "Demote candidate account to Standard User in Windows Settings.",
        });
    } else {
        checks.push(StartupValidationCheck {
            name: "Candidate Account Isolation",
            status: "PASS",
            explanation: "Candidate account isolation confirmed (Standard User).".to_string(),
            severity: "INFO",
            blocks_startup: false,
            resolution: "None required.",
        });
    }

    // 4. Windows Kiosk Configuration
    let kiosk_caps = detect_kiosk_capabilities();
    if kiosk_caps.overall_status == "UNSUPPORTED" {
        checks.push(StartupValidationCheck {
            name: "Windows Kiosk Environment",
            status: "WARNING",
            explanation: "Operating system does not support native Windows Kiosk mode. Running in standard secure window mode.".to_string(),
            severity: "WARNING",
            blocks_startup: false,
            resolution: "Upgrade Windows to Pro or Enterprise for hardware-enforced kiosk mode.",
        });
    } else {
        checks.push(StartupValidationCheck {
            name: "Windows Kiosk Environment",
            status: "PASS",
            explanation: format!("Kiosk capabilities ready ({})", kiosk_caps.recommended_mechanism),
            severity: "INFO",
            blocks_startup: false,
            resolution: "None required.",
        });
    }

    // 5. Hardware Readiness
    let hw = scan_hardware_readiness();
    if hw.overall_status == "FAIL" {
        blocked = true;
        checks.push(StartupValidationCheck {
            name: "Hardware Readiness",
            status: "BLOCKED",
            explanation: "Host machine does not meet minimum RAM or storage space requirements.".to_string(),
            severity: "CRITICAL",
            blocks_startup: true,
            resolution: "Free up disk space or allocate more RAM.",
        });
    } else if hw.overall_status == "WARNING" {
        checks.push(StartupValidationCheck {
            name: "Hardware Readiness",
            status: "WARNING",
            explanation: hw.summary,
            severity: "WARNING",
            blocks_startup: false,
            resolution: "Review hardware warnings in Admin Dashboard.",
        });
    } else {
        checks.push(StartupValidationCheck {
            name: "Hardware Readiness",
            status: "PASS",
            explanation: "CPU, RAM, storage, and display satisfy requirements.".to_string(),
            severity: "INFO",
            blocks_startup: false,
            resolution: "None required.",
        });
    }

    // 6. Native Security Agent Integration (Phase 1C compatibility interface)
    let agent_status = crate::security_agent::service::ServiceManager::query_status();
    if agent_status.state == crate::security_agent::service::ServiceLifecycleState::Running {
        checks.push(StartupValidationCheck {
            name: "Native Security Agent",
            status: "PASS",
            explanation: format!(
                "Native Security Agent is ACTIVE ({})",
                if agent_status.is_daemon_mode { "Daemon Mode" } else { "Windows SCM Service" }
            ),
            severity: "INFO",
            blocks_startup: false,
            resolution: "None required.",
        });
    } else {
        checks.push(StartupValidationCheck {
            name: "Native Security Agent",
            status: "WARNING",
            explanation: format!(
                "Native background security agent is {:?}. Operating in application-level lockdown mode.",
                agent_status.state
            ),
            severity: "WARNING",
            blocks_startup: false,
            resolution: "Start Security Agent daemon or register Windows service in Admin Settings.",
        });
    }

    let has_warnings = checks.iter().any(|c| c.status == "WARNING");
    let overall_result = if blocked {
        "BLOCKED"
    } else if has_warnings {
        "READY_WITH_WARNINGS"
    } else {
        "READY"
    };

    ExaminationStartupValidationReport {
        overall_result,
        checks,
        timestamp: chrono_or_fallback_timestamp(),
        can_proceed: !blocked,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lifecycle_state_transitions() {
        let mgr = LifecycleManager::default();
        assert_eq!(mgr.get_state(), SessionLifecycleState::NormalMode);

        assert!(mgr.transition_to(SessionLifecycleState::SecureShellStarting).is_ok());
        assert!(mgr.transition_to(SessionLifecycleState::SecureShellReady).is_ok());
        assert!(mgr.transition_to(SessionLifecycleState::SecurityValidation).is_ok());
        assert!(mgr.transition_to(SessionLifecycleState::SessionReady).is_ok());
        assert!(mgr.transition_to(SessionLifecycleState::ExaminationActive).is_ok());
        assert_eq!(mgr.get_state(), SessionLifecycleState::ExaminationActive);

        let count = mgr.record_interruption();
        assert_eq!(count, 1);
        assert_eq!(mgr.get_state(), SessionLifecycleState::ExaminationInterrupted);
    }

    #[test]
    fn test_startup_validation() {
        let report = run_startup_validation("AssessXCandidate");
        assert!(["READY", "READY_WITH_WARNINGS", "BLOCKED"].contains(&report.overall_result));
        assert!(!report.checks.is_empty());
    }
}
