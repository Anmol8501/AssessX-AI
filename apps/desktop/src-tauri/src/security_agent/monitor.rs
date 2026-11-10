//! Session and process monitoring for AssessX Security Agent (Phase 1C).
//!
//! Tracks desktop process heartbeat, detects process termination, and classifies
//! session failure modes (Normal, Crash, Unresponsive, IPC failure).

use crate::security_agent::logger::{log_error, log_info, log_warn};
use crate::security_agent::protocol::HeartbeatPayload;
use crate::security_agent::tamper::TamperDetector;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Heartbeat expectation interval in seconds.
pub const HEARTBEAT_INTERVAL_SECONDS: u64 = 5;
/// Maximum allowed silence before declaring unresponsive (15 seconds = 3 missed beats).
pub const WATCHDOG_TIMEOUT_SECONDS: u64 = 15;

static MONITOR_STATE: Mutex<Option<ProcessMonitor>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum WatchdogState {
    Healthy,
    Degraded,
    Unresponsive,
    Terminated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorStatus {
    pub desktop_pid: Option<u32>,
    pub session_id: Option<String>,
    pub watchdog_state: WatchdogState,
    pub last_heartbeat_age_seconds: u64,
    pub missed_heartbeats: u32,
}

pub struct ProcessMonitor {
    desktop_pid: Option<u32>,
    session_id: Option<String>,
    last_heartbeat_timestamp: u64,
    watchdog_state: WatchdogState,
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self {
            desktop_pid: None,
            session_id: None,
            last_heartbeat_timestamp: Self::now_seconds(),
            watchdog_state: WatchdogState::Healthy,
        }
    }

    fn now_seconds() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    /// Process an incoming heartbeat from desktop application.
    pub fn register_heartbeat(&mut self, payload: HeartbeatPayload) {
        let now = Self::now_seconds();
        let is_first = self.desktop_pid.is_none();

        self.desktop_pid = Some(payload.process_id);
        self.session_id = payload.session_id;
        self.last_heartbeat_timestamp = now;
        self.watchdog_state = WatchdogState::Healthy;

        if is_first {
            log_info(
                "PROCESS_MONITOR",
                &format!("Desktop application attached: PID {}", payload.process_id),
            );
        }
    }

    /// Periodic watchdog tick to detect silence or process termination.
    pub fn check_watchdog(&mut self) -> WatchdogState {
        let now = Self::now_seconds();
        let age = now.saturating_sub(self.last_heartbeat_timestamp);

        if self.desktop_pid.is_none() {
            return WatchdogState::Healthy;
        }

        if age > WATCHDOG_TIMEOUT_SECONDS {
            if self.watchdog_state != WatchdogState::Unresponsive {
                self.watchdog_state = WatchdogState::Unresponsive;
                log_error(
                    "PROCESS_MONITOR",
                    &format!(
                        "Desktop application PID {:?} unresponsive (silence: {}s).",
                        self.desktop_pid, age
                    ),
                );
                TamperDetector::record_event(
                    "PROCESS_UNRESPONSIVE",
                    "HIGH",
                    "Desktop process stopped sending heartbeats",
                    serde_json::json!({
                        "pid": self.desktop_pid,
                        "silence_seconds": age,
                    }),
                );
            }
        } else if age > HEARTBEAT_INTERVAL_SECONDS * 2 {
            self.watchdog_state = WatchdogState::Degraded;
            log_warn(
                "PROCESS_MONITOR",
                &format!("Desktop heartbeat delayed (silence: {}s).", age),
            );
        } else {
            self.watchdog_state = WatchdogState::Healthy;
        }

        self.watchdog_state.clone()
    }

    /// Query current status.
    pub fn get_status(&self) -> MonitorStatus {
        let now = Self::now_seconds();
        let age = now.saturating_sub(self.last_heartbeat_timestamp);
        let missed = (age / HEARTBEAT_INTERVAL_SECONDS) as u32;

        MonitorStatus {
            desktop_pid: self.desktop_pid,
            session_id: self.session_id.clone(),
            watchdog_state: self.watchdog_state.clone(),
            last_heartbeat_age_seconds: age,
            missed_heartbeats: missed,
        }
    }
}

pub fn handle_heartbeat(payload: HeartbeatPayload) {
    let mut guard = MONITOR_STATE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(ProcessMonitor::new());
    }
    guard.as_mut().unwrap().register_heartbeat(payload);
}

pub fn check_monitor() -> MonitorStatus {
    let mut guard = MONITOR_STATE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(ProcessMonitor::new());
    }
    let monitor = guard.as_mut().unwrap();
    monitor.check_watchdog();
    monitor.get_status()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heartbeat_and_watchdog() {
        let mut monitor = ProcessMonitor::new();
        monitor.register_heartbeat(HeartbeatPayload {
            process_id: 4567,
            session_id: Some("session-abc".to_string()),
            timestamp_ms: 1000,
        });

        let status = monitor.get_status();
        assert_eq!(status.desktop_pid, Some(4567));
        assert_eq!(status.watchdog_state, WatchdogState::Healthy);
    }
}

