//! Tamper detection foundation and event classification for AssessX Security Agent (Phase 1C).
//!
//! Identifies unauthorized configuration modifications, service stop attempts,
//! IPC authentication anomalies, and policy drift during examination sessions.

use crate::security_agent::logger::log_warn;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TAMPER_HISTORY: usize = 500;

static TAMPER_STORE: Mutex<Option<VecDeque<TamperEvent>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TamperEvent {
    pub event_id: String,
    pub tamper_type: String,
    pub severity: String, // "LOW", "MEDIUM", "HIGH", "CRITICAL"
    pub description: String,
    pub timestamp_ms: u64,
    pub details: serde_json::Value,
}

pub struct TamperDetector;

impl TamperDetector {
    /// Initialize global tamper event store.
    pub fn init() {
        let mut guard = TAMPER_STORE.lock().unwrap();
        if guard.is_none() {
            *guard = Some(VecDeque::with_capacity(MAX_TAMPER_HISTORY));
        }
    }

    /// Record a detected tampering event.
    pub fn record_event(
        tamper_type: &str,
        severity: &str,
        description: &str,
        details: serde_json::Value,
    ) -> TamperEvent {
        Self::init();

        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let event = TamperEvent {
            event_id: format!("tamper-{}", timestamp_ms),
            tamper_type: tamper_type.to_string(),
            severity: severity.to_string(),
            description: description.to_string(),
            timestamp_ms,
            details,
        };

        log_warn(
            "TAMPER_DETECTED",
            &format!(
                "Tamper event [{}]: {} ({})",
                severity, tamper_type, description
            ),
        );

        let mut guard = TAMPER_STORE.lock().unwrap();
        if let Some(store) = guard.as_mut() {
            if store.len() >= MAX_TAMPER_HISTORY {
                store.pop_front();
            }
            store.push_back(event.clone());
        }

        event
    }

    /// Retrieve all recorded tamper events.
    pub fn get_events() -> Vec<TamperEvent> {
        Self::init();
        let guard = TAMPER_STORE.lock().unwrap();
        guard
            .as_ref()
            .map(|store| store.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Clear tamper history (authorized admin reset).
    pub fn clear_history() {
        Self::init();
        let mut guard = TAMPER_STORE.lock().unwrap();
        if let Some(store) = guard.as_mut() {
            store.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_record_and_get_tamper_events() {
        TamperDetector::clear_history();

        let ev = TamperDetector::record_event(
            "SERVICE_STOP_ATTEMPT",
            "CRITICAL",
            "User attempted to kill background service",
            serde_json::json!({ "pid": 9999 }),
        );

        assert_eq!(ev.tamper_type, "SERVICE_STOP_ATTEMPT");
        assert_eq!(ev.severity, "CRITICAL");

        let events = TamperDetector::get_events();
        assert!(!events.is_empty());
        assert_eq!(events.last().unwrap().tamper_type, "SERVICE_STOP_ATTEMPT");
    }
}

