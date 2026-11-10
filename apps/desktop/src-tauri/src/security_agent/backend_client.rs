//! Authenticated backend client and offline bounded event queue for AssessX Security Agent (Phase 1C).
//!
//! Maintains an in-memory ring buffer (up to 1,000 events) for offline resilience
//! and delivers event batches to `POST /api/v1/devices/{device_id}/events`.

use crate::provisioning::device_id::get_or_create_device_identity;
use crate::security_agent::logger::{log_error, log_info, log_warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::process::Command;
use std::sync::Mutex;

const MAX_OFFLINE_QUEUE: usize = 1000;
const BATCH_SIZE: usize = 50;

static EVENT_QUEUE: Mutex<Option<VecDeque<QueuedSecurityEvent>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QueuedSecurityEvent {
    pub event_type: String,
    pub severity: String,
    pub category: String,
    pub details: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct BatchPayload<'a> {
    events: &'a [QueuedSecurityEvent],
}

pub struct BackendClient;

impl BackendClient {
    /// Initialize offline queue.
    pub fn init() {
        let mut guard = EVENT_QUEUE.lock().unwrap();
        if guard.is_none() {
            *guard = Some(VecDeque::with_capacity(MAX_OFFLINE_QUEUE));
        }
    }

    /// Enqueue a security event into the offline ring buffer.
    pub fn enqueue(event: QueuedSecurityEvent) -> usize {
        Self::init();
        let mut guard = EVENT_QUEUE.lock().unwrap();
        if let Some(queue) = guard.as_mut() {
            if queue.len() >= MAX_OFFLINE_QUEUE {
                // Drop oldest when bounded capacity reached
                queue.pop_front();
                log_warn(
                    "BACKEND_CLIENT",
                    "Offline event queue full (1,000 events); oldest event discarded.",
                );
            }
            queue.push_back(event);
            queue.len()
        } else {
            0
        }
    }

    /// Query current offline queue depth.
    pub fn queue_depth() -> usize {
        Self::init();
        let guard = EVENT_QUEUE.lock().unwrap();
        guard.as_ref().map(|q| q.len()).unwrap_or(0)
    }

    /// Attempt to flush queued events to the FastAPI backend.
    pub fn flush(backend_url: &str, auth_token: Option<&str>) -> Result<usize, String> {
        Self::init();

        let events_to_send: Vec<QueuedSecurityEvent> = {
            let guard = EVENT_QUEUE.lock().unwrap();
            if let Some(queue) = guard.as_ref() {
                if queue.is_empty() {
                    return Ok(0);
                }
                queue.iter().take(BATCH_SIZE).cloned().collect()
            } else {
                return Ok(0);
            }
        };

        let count = events_to_send.len();
        if count == 0 {
            return Ok(0);
        }

        let device_identity = get_or_create_device_identity();
        let device_id = device_identity.device_id;

        let endpoint = format!("{}/api/v1/devices/{}/events", backend_url.trim_end_matches('/'), device_id);
        let payload = BatchPayload {
            events: &events_to_send,
        };

        let payload_json = serde_json::to_string(&payload)
            .map_err(|e| format!("Serialization error: {}", e))?;

        // Dispatch via system curl on Windows for zero-overhead synchronous execution
        let mut cmd = Command::new("curl.exe");
        cmd.arg("-s")
            .arg("-X")
            .arg("POST")
            .arg(&endpoint)
            .arg("-H")
            .arg("Content-Type: application/json");

        if let Some(token) = auth_token {
            cmd.arg("-H").arg(format!("Authorization: Bearer {}", token));
        }

        cmd.arg("-d").arg(&payload_json);

        match cmd.output() {
            Ok(output) => {
                if output.status.success() {
                    // Remove sent batch from the front of queue
                    let mut guard = EVENT_QUEUE.lock().unwrap();
                    if let Some(queue) = guard.as_mut() {
                        for _ in 0..count {
                            queue.pop_front();
                        }
                    }
                    log_info(
                        "BACKEND_CLIENT",
                        &format!("Flushed {} security events to backend successfully.", count),
                    );
                    Ok(count)
                } else {
                    let err = String::from_utf8_lossy(&output.stderr);
                    log_warn(
                        "BACKEND_CLIENT",
                        &format!("Failed to flush events to backend: {}", err),
                    );
                    Err(format!("HTTP request failed: {}", err))
                }
            }
            Err(e) => {
                log_error(
                    "BACKEND_CLIENT",
                    &format!("Failed to execute HTTP request: {}", e),
                );
                Err(format!("Execution error: {}", e))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enqueue_and_queue_depth() {
        let initial = BackendClient::queue_depth();
        let depth = BackendClient::enqueue(QueuedSecurityEvent {
            event_type: "TEST_EVENT".to_string(),
            severity: "LOW".to_string(),
            category: "TEST".to_string(),
            details: serde_json::json!({ "test": true }),
        });
        assert_eq!(depth, initial + 1);
        assert_eq!(BackendClient::queue_depth(), initial + 1);
    }
}
