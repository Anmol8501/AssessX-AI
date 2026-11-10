//! Structured diagnostic logger for AssessX Security Agent (Phase 1C).
//!
//! Features:
//! - Append-only writing to `%APPDATA%\AssessX\logs\security_agent.log`.
//! - File rotation when file size exceeds 10 MB (keeps up to 3 archives).
//! - Automatic scrubbing of sensitive information (passwords, tokens, HMACs, auth headers).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Maximum log file size before rotation (10 MB).
const MAX_LOG_SIZE_BYTES: u64 = 10 * 1024 * 1024;
/// Number of rotated log archives to retain.
const MAX_ARCHIVES: usize = 3;

static LOGGER_INSTANCE: Mutex<Option<AgentLogger>> = Mutex::new(None);

pub struct AgentLogger {
    log_path: PathBuf,
}

impl AgentLogger {
    pub fn new(log_path: PathBuf) -> Self {
        if let Some(parent) = log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        Self { log_path }
    }

    /// Default log path in `%APPDATA%\AssessX\logs\security_agent.log` or fallback to relative.
    pub fn default_path() -> PathBuf {
        if let Ok(appdata) = std::env::var("APPDATA") {
            PathBuf::from(appdata)
                .join("AssessX")
                .join("logs")
                .join("security_agent.log")
        } else if let Ok(temp) = std::env::var("TEMP") {
            PathBuf::from(temp)
                .join("AssessX")
                .join("logs")
                .join("security_agent.log")
        } else {
            PathBuf::from("security_agent.log")
        }
    }

    /// Rotate logs if current file exceeds 10 MB.
    fn check_rotate(&self) {
        if let Ok(metadata) = fs::metadata(&self.log_path) {
            if metadata.len() >= MAX_LOG_SIZE_BYTES {
                for i in (1..MAX_ARCHIVES).rev() {
                    let from = self.log_path.with_extension(format!("log.{}", i));
                    let to = self.log_path.with_extension(format!("log.{}", i + 1));
                    if from.exists() {
                        let _ = fs::rename(from, to);
                    }
                }
                let first_archive = self.log_path.with_extension("log.1");
                let _ = fs::rename(&self.log_path, first_archive);
            }
        }
    }

    /// Redact sensitive patterns (passwords, tokens, bearer auth).
    pub fn sanitize(message: &str) -> String {
        let mut cleaned = message.to_string();

        // Redact bearer tokens
        if let Some(pos) = cleaned.find("Bearer ") {
            let start = pos + 7;
            let end = cleaned[start..]
                .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                .map(|p| start + p)
                .unwrap_or(cleaned.len());
            cleaned.replace_range(start..end, "[REDACTED_TOKEN]");
        }

        // Redact password fields in JSON or key-value pairs
        for pattern in &["\"password\":", "\"token\":", "\"secret\":", "\"api_key\":"] {
            if let Some(pos) = cleaned.find(pattern) {
                let start = pos + pattern.len();
                let rest = &cleaned[start..];
                if let Some(quote_start) = rest.find('"') {
                    let val_start = start + quote_start + 1;
                    if let Some(quote_end) = cleaned[val_start..].find('"') {
                        let val_end = val_start + quote_end;
                        cleaned.replace_range(val_start..val_end, "[REDACTED]");
                    }
                }
            }
        }

        cleaned
    }

    /// Write structured entry to file.
    pub fn write_entry(&self, level: &str, component: &str, message: &str) {
        self.check_rotate();

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let sanitized_msg = Self::sanitize(message);
        let log_line = format!("[{timestamp}] [{level}] [{component}] {sanitized_msg}\n");

        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_path)
        {
            let _ = file.write_all(log_line.as_bytes());
        }
    }
}

/// Initialize global logger.
pub fn init_logger(custom_path: Option<PathBuf>) {
    let path = custom_path.unwrap_or_else(AgentLogger::default_path);
    let mut guard = LOGGER_INSTANCE.lock().unwrap();
    *guard = Some(AgentLogger::new(path));
}

/// Log an INFO entry.
pub fn log_info(component: &str, message: &str) {
    if let Ok(guard) = LOGGER_INSTANCE.lock() {
        if let Some(logger) = guard.as_ref() {
            logger.write_entry("INFO", component, message);
            return;
        }
    }
    // Fallback if not initialized
    let fallback = AgentLogger::new(AgentLogger::default_path());
    fallback.write_entry("INFO", component, message);
}

/// Log a WARN entry.
pub fn log_warn(component: &str, message: &str) {
    if let Ok(guard) = LOGGER_INSTANCE.lock() {
        if let Some(logger) = guard.as_ref() {
            logger.write_entry("WARN", component, message);
            return;
        }
    }
    let fallback = AgentLogger::new(AgentLogger::default_path());
    fallback.write_entry("WARN", component, message);
}

/// Log an ERROR entry.
pub fn log_error(component: &str, message: &str) {
    if let Ok(guard) = LOGGER_INSTANCE.lock() {
        if let Some(logger) = guard.as_ref() {
            logger.write_entry("ERROR", component, message);
            return;
        }
    }
    let fallback = AgentLogger::new(AgentLogger::default_path());
    fallback.write_entry("ERROR", component, message);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitization() {
        let raw = "User auth failed: Bearer secret_token_12345 received";
        let cleaned = AgentLogger::sanitize(raw);
        assert!(!cleaned.contains("secret_token_12345"));
        assert!(cleaned.contains("[REDACTED_TOKEN]"));

        let raw_json = r#"{"user": "student1", "password": "supersecretpassword", "status": "ok"}"#;
        let cleaned_json = AgentLogger::sanitize(raw_json);
        assert!(!cleaned_json.contains("supersecretpassword"));
        assert!(cleaned_json.contains("[REDACTED]"));
    }

    #[test]
    fn test_logger_writing() {
        let temp_dir = std::env::temp_dir().join("assessx_test_log");
        let log_file = temp_dir.join("test_agent.log");

        let logger = AgentLogger::new(log_file.clone());
        logger.write_entry("INFO", "TEST", "Testing logger message");

        assert!(log_file.exists());
        let contents = fs::read_to_string(&log_file).expect("read test log");
        assert!(contents.contains("[INFO]"));
        assert!(contents.contains("[TEST]"));
        assert!(contents.contains("Testing logger message"));

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
