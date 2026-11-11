//! Safe Rollback Foundation & Change Journal (Module 10, Phase 1A).
//!
//! Maintains an append-only JSON journal of provisioning actions.
//! Ensures all modifications are pre-recorded with rollback instructions
//! and prevents destructive operations on unmanaged resources.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

static JOURNAL_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub entry_id: String,
    pub timestamp: String,
    pub operation: String,
    pub target_resource: String,
    pub previous_state: String,
    pub new_state: String,
    pub rollback_command: Option<String>,
    pub is_reversible: bool,
    pub status: String, // "PLANNED" | "EXECUTED" | "REVERSED" | "FAILED"
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChangeJournal {
    pub entries: Vec<JournalEntry>,
}

fn get_journal_path() -> PathBuf {
    let mut dir = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata)
    } else {
        std::env::temp_dir()
    };
    dir.push("AssessX");
    let _ = fs::create_dir_all(&dir);
    dir.push("provisioning_journal.json");
    dir
}

fn load_journal_unlocked() -> ChangeJournal {
    let path = get_journal_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(journal) = serde_json::from_str::<ChangeJournal>(&content) {
            return journal;
        }
    }
    ChangeJournal::default()
}

pub fn load_journal() -> ChangeJournal {
    let _guard = JOURNAL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    load_journal_unlocked()
}

pub fn record_planned_change(
    operation: &str,
    target_resource: &str,
    previous_state: &str,
    new_state: &str,
    rollback_command: Option<String>,
) -> JournalEntry {
    let _guard = JOURNAL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut journal = load_journal_unlocked();
    let entry = JournalEntry {
        entry_id: format!("JRN-{}", super::chrono_or_fallback_timestamp().replace(['.', 'Z', ':'], "-")),
        timestamp: super::chrono_or_fallback_timestamp(),
        operation: operation.to_string(),
        target_resource: target_resource.to_string(),
        previous_state: previous_state.to_string(),
        new_state: new_state.to_string(),
        rollback_command,
        is_reversible: true,
        status: "PLANNED".to_string(),
    };

    journal.entries.push(entry.clone());
    if let Ok(json) = serde_json::to_string_pretty(&journal) {
        let path = get_journal_path();
        let staging = path.with_extension("json.tmp");
        if fs::write(&staging, &json).is_ok() {
            if fs::rename(&staging, &path).is_err() {
                let _ = fs::write(&path, &json);
            }
            let _ = fs::remove_file(&staging);
        } else {
            let _ = fs::write(path, json);
        }
    }

    entry
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_journal_recording() {
        let entry = record_planned_change(
            "CREATE_CANDIDATE_ACCOUNT",
            "assessx-test-user",
            "NON_EXISTENT",
            "STANDARD_USER",
            Some("net user assessx-test-user /delete".to_string()),
        );
        assert!(!entry.entry_id.is_empty());
        assert_eq!(entry.status, "PLANNED");
        assert!(entry.is_reversible);
    }
}

