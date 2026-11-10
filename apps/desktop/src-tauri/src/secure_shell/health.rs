//! Secure Shell Health Monitor (Stage 4 & 5, Phase 1B).
//!
//! Provides lightweight health metrics and heartbeat tracking for the active
//! examination shell without excessive CPU consumption or false positives.

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use super::lifecycle::SessionLifecycleState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellHealthReport {
    pub status: &'static str, // "HEALTHY" | "DEGRADED" | "UNRESPONSIVE" | "RECOVERING" | "FAILED"
    pub current_lifecycle_state: String,
    pub heartbeat_age_seconds: u64,
    pub is_responsive: bool,
    pub summary: String,
}

pub struct ShellHealthMonitor {
    last_heartbeat_timestamp: AtomicU64,
    status_override: Mutex<Option<&'static str>>,
}

impl Default for ShellHealthMonitor {
    fn default() -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            last_heartbeat_timestamp: AtomicU64::new(now),
            status_override: Mutex::new(None),
        }
    }
}

impl ShellHealthMonitor {
    pub fn record_heartbeat(&self) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.last_heartbeat_timestamp.store(now, Ordering::SeqCst);
    }

    pub fn inspect_health(&self, lifecycle_state: SessionLifecycleState) -> ShellHealthReport {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let last = self.last_heartbeat_timestamp.load(Ordering::SeqCst);
        let age = now.saturating_sub(last);

        let is_responsive = age < 30; // 30-second heartbeat window
        let status = if let Some(ov) = *self.status_override.lock().unwrap_or_else(|e| e.into_inner()) {
            ov
        } else if !is_responsive {
            "UNRESPONSIVE"
        } else if lifecycle_state == SessionLifecycleState::ExaminationInterrupted {
            "DEGRADED"
        } else if lifecycle_state == SessionLifecycleState::RecoveryInProgress {
            "RECOVERING"
        } else if lifecycle_state == SessionLifecycleState::Error || lifecycle_state == SessionLifecycleState::AdminRecoveryRequired {
            "FAILED"
        } else {
            "HEALTHY"
        };

        let summary = format!(
            "Shell status: {}. State: {}. Last heartbeat: {}s ago.",
            status,
            lifecycle_state.as_str(),
            age
        );

        ShellHealthReport {
            status,
            current_lifecycle_state: lifecycle_state.as_str().to_string(),
            heartbeat_age_seconds: age,
            is_responsive,
            summary,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shell_health_heartbeat() {
        let monitor = ShellHealthMonitor::default();
        monitor.record_heartbeat();
        let report = monitor.inspect_health(SessionLifecycleState::SessionReady);
        assert_eq!(report.status, "HEALTHY");
        assert!(report.is_responsive);
        assert!(report.heartbeat_age_seconds < 5);
    }
}

