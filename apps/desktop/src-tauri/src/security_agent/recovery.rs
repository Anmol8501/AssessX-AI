//! Cross-process recovery coordination for AssessX Security Agent (Phase 1C).
//!
//! Enforces bounded restart limits (maximum 3 attempts per 10 minutes) to avoid
//! infinite restart loops, and coordinates administrative lockout upon threshold breach.

use crate::security_agent::logger::{log_error, log_info, log_warn};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Maximum allowed automatic restarts within the cooldown window.
const MAX_RESTARTS: usize = 3;
/// Cooldown duration in seconds (10 minutes).
const COOLDOWN_SECONDS: u64 = 600;

static RECOVERY_STATE: Mutex<Option<RecoveryCoordinator>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecoveryStatus {
    pub restart_count: usize,
    pub max_restarts: usize,
    pub cooldown_seconds: u64,
    pub lockout_active: bool,
    pub last_restart_timestamp: Option<u64>,
}

pub struct RecoveryCoordinator {
    restart_timestamps: Vec<u64>,
    lockout_active: bool,
}

impl RecoveryCoordinator {
    pub fn new() -> Self {
        Self {
            restart_timestamps: Vec::new(),
            lockout_active: false,
        }
    }

    /// Prune restarts older than the cooldown window.
    fn prune_old_restarts(&mut self, now: u64) {
        let threshold = now.saturating_sub(COOLDOWN_SECONDS);
        self.restart_timestamps.retain(|&ts| ts >= threshold);
    }

    /// Record a process restart and check if bounded limit is exceeded.
    pub fn record_restart_attempt(&mut self) -> Result<(), String> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        self.prune_old_restarts(now);

        if self.restart_timestamps.len() >= MAX_RESTARTS {
            self.lockout_active = true;
            log_error(
                "RECOVERY_COORDINATOR",
                &format!(
                    "Restart limit of {} attempts within {} seconds exceeded. Administrator escalation triggered.",
                    MAX_RESTARTS, COOLDOWN_SECONDS
                ),
            );
            return Err("RESTART_LIMIT_EXCEEDED: Administrator intervention required.".to_string());
        }

        self.restart_timestamps.push(now);
        log_warn(
            "RECOVERY_COORDINATOR",
            &format!(
                "Application restart recorded ({}/{} in window).",
                self.restart_timestamps.len(),
                MAX_RESTARTS
            ),
        );

        Ok(())
    }

    /// Query current recovery status.
    pub fn get_status(&mut self) -> RecoveryStatus {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        self.prune_old_restarts(now);

        RecoveryStatus {
            restart_count: self.restart_timestamps.len(),
            max_restarts: MAX_RESTARTS,
            cooldown_seconds: COOLDOWN_SECONDS,
            lockout_active: self.lockout_active,
            last_restart_timestamp: self.restart_timestamps.last().copied(),
        }
    }

    /// Reset lockout state (requires administrator authorization).
    pub fn reset_lockout(&mut self) {
        self.restart_timestamps.clear();
        self.lockout_active = false;
        log_info(
            "RECOVERY_COORDINATOR",
            "Recovery state cleared by administrator.",
        );
    }
}

pub fn get_recovery_status() -> RecoveryStatus {
    let mut guard = RECOVERY_STATE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(RecoveryCoordinator::new());
    }
    guard.as_mut().unwrap().get_status()
}

pub fn record_restart() -> Result<(), String> {
    let mut guard = RECOVERY_STATE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(RecoveryCoordinator::new());
    }
    guard.as_mut().unwrap().record_restart_attempt()
}

pub fn reset_recovery() {
    let mut guard = RECOVERY_STATE.lock().unwrap();
    if guard.is_none() {
        *guard = Some(RecoveryCoordinator::new());
    }
    guard.as_mut().unwrap().reset_lockout();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recovery_bounded_restarts() {
        let mut coord = RecoveryCoordinator::new();

        assert!(coord.record_restart_attempt().is_ok());
        assert!(coord.record_restart_attempt().is_ok());
        assert!(coord.record_restart_attempt().is_ok());

        // 4th restart exceeds limit
        let res = coord.record_restart_attempt();
        assert!(res.is_err());
        assert!(coord.get_status().lockout_active);

        // Reset
        coord.reset_lockout();
        assert!(!coord.get_status().lockout_active);
        assert_eq!(coord.get_status().restart_count, 0);
    }
}

