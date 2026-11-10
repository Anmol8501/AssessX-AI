//! Application Crash Detection and Bounded Recovery Controller (Stage 6, Phase 1B).
//!
//! Tracks unexpected termination, enforces bounded restart limits, and preserves examination
//! session context to permit safe recovery without infinite restart loops.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use crate::provisioning::chrono_or_fallback_timestamp;

const MAX_RESTART_ATTEMPTS: u32 = 3;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExaminationRecoveryState {
    pub assessment_id: Option<String>,
    pub attempt_id: Option<String>,
    pub candidate_account: String,
    pub session_token: Option<String>,
    pub last_heartbeat: String,
    pub restart_count: u32,
    pub is_clean_exit: bool,
    pub crash_detected: bool,
    pub escalation_required: bool,
}

impl Default for ExaminationRecoveryState {
    fn default() -> Self {
        Self {
            assessment_id: None,
            attempt_id: None,
            candidate_account: "AssessXCandidate".to_string(),
            session_token: None,
            last_heartbeat: chrono_or_fallback_timestamp(),
            restart_count: 0,
            is_clean_exit: true,
            crash_detected: false,
            escalation_required: false,
        }
    }
}

pub struct CrashRecoveryController {
    storage_path: PathBuf,
    state: Mutex<ExaminationRecoveryState>,
}

impl Default for CrashRecoveryController {
    fn default() -> Self {
        let base = std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir());
        let dir = base.join("AssessX");
        let _ = fs::create_dir_all(&dir);
        let storage_path = dir.join("exam_recovery_state.json");

        let loaded_state = if let Ok(content) = fs::read_to_string(&storage_path) {
            serde_json::from_str::<ExaminationRecoveryState>(&content).unwrap_or_default()
        } else {
            ExaminationRecoveryState::default()
        };

        Self {
            storage_path,
            state: Mutex::new(loaded_state),
        }
    }
}

impl CrashRecoveryController {
    fn persist_state(&self, state: &ExaminationRecoveryState) {
        if let Ok(json) = serde_json::to_string_pretty(state) {
            let _ = fs::write(&self.storage_path, json);
        }
    }

    pub fn mark_session_active(
        &self,
        assessment_id: &str,
        attempt_id: &str,
        candidate_account: &str,
        token: Option<String>,
    ) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.assessment_id = Some(assessment_id.to_string());
        state.attempt_id = Some(attempt_id.to_string());
        state.candidate_account = candidate_account.to_string();
        state.session_token = token;
        state.last_heartbeat = chrono_or_fallback_timestamp();
        state.is_clean_exit = false;
        state.crash_detected = false;
        self.persist_state(&state);
    }

    pub fn record_heartbeat(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.last_heartbeat = chrono_or_fallback_timestamp();
        self.persist_state(&state);
    }

    pub fn mark_clean_exit(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.is_clean_exit = true;
        state.restart_count = 0;
        state.crash_detected = false;
        state.escalation_required = false;
        self.persist_state(&state);
    }

    pub fn inspect_on_startup(&self) -> ExaminationRecoveryState {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        
        if !state.is_clean_exit && (state.assessment_id.is_some() || state.attempt_id.is_some()) {
            state.crash_detected = true;
            state.restart_count += 1;

            if state.restart_count > MAX_RESTART_ATTEMPTS {
                state.escalation_required = true;
            }
            self.persist_state(&state);
        }

        state.clone()
    }

    pub fn reset_recovery_state(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        *state = ExaminationRecoveryState::default();
        self.persist_state(&state);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashRecoveryReport {
    pub crash_detected: bool,
    pub restart_count: u32,
    pub max_restarts_allowed: u32,
    pub escalation_required: bool,
    pub preserved_assessment_id: Option<String>,
    pub preserved_attempt_id: Option<String>,
    pub message: String,
}

pub fn check_crash_recovery(controller: &CrashRecoveryController) -> CrashRecoveryReport {
    let state = controller.inspect_on_startup();
    let message = if state.escalation_required {
        format!(
            "Examination terminal exceeded restart limit ({} crashes). Administrator recovery required.",
            state.restart_count
        )
    } else if state.crash_detected {
        format!(
            "Unexpected exit detected during exam attempt. Bounded recovery attempt {} of {}.",
            state.restart_count, MAX_RESTART_ATTEMPTS
        )
    } else {
        "Previous session shut down cleanly. Normal operation.".to_string()
    };

    CrashRecoveryReport {
        crash_detected: state.crash_detected,
        restart_count: state.restart_count,
        max_restarts_allowed: MAX_RESTART_ATTEMPTS,
        escalation_required: state.escalation_required,
        preserved_assessment_id: state.assessment_id,
        preserved_attempt_id: state.attempt_id,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_crash_recovery_cycle() {
        let controller = CrashRecoveryController::default();
        controller.reset_recovery_state();

        // 1. Mark exam active (unclean exit)
        controller.mark_session_active("exam-123", "attempt-456", "AssessXCandidate", None);
        
        // 2. Simulate startup after crash
        let report = check_crash_recovery(&controller);
        assert!(report.crash_detected);
        assert_eq!(report.restart_count, 1);
        assert_eq!(report.preserved_assessment_id.as_deref(), Some("exam-123"));

        // 3. Mark clean exit
        controller.mark_clean_exit();
        let report_clean = check_crash_recovery(&controller);
        assert!(!report_clean.crash_detected);
        assert_eq!(report_clean.restart_count, 0);
    }
}
