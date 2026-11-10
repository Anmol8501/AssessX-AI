//! Application inventory and running process discovery for Phase 2A.
//!
//! Enumerates currently running processes on Windows, resolves full executable paths,
//! groups process IDs, and builds normalized `ApplicationIdentity` records with caching.

use super::identity::ApplicationIdentity;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::SystemTime;

static IDENTITY_CACHE: Mutex<Option<HashMap<String, (SystemTime, ApplicationIdentity)>>> =
    Mutex::new(None);

pub struct ApplicationInventory;

impl ApplicationInventory {
    /// Discovers all currently running applications and returns normalized identities.
    pub fn scan_running_applications() -> Vec<ApplicationIdentity> {
        let process_map = Self::enumerate_process_paths();
        let mut results = Vec::new();

        let mut cache_guard = IDENTITY_CACHE.lock().unwrap();
        if cache_guard.is_none() {
            *cache_guard = Some(HashMap::new());
        }
        let cache = cache_guard.as_mut().unwrap();

        for (path_str, pids) in process_map {
            let path = PathBuf::from(&path_str);
            if !path.exists() {
                continue;
            }

            let mtime = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);

            if let Some((cached_mtime, cached_id)) = cache.get(&path_str) {
                if *cached_mtime == mtime {
                    let mut updated = cached_id.clone();
                    updated.process_ids = pids;
                    updated.is_running = true;
                    results.push(updated);
                    continue;
                }
            }

            if let Ok(identity) = ApplicationIdentity::from_path(&path, pids) {
                cache.insert(path_str.clone(), (mtime, identity.clone()));
                results.push(identity);
            }
        }

        // Sort by display name
        results.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        results
    }

    /// Enumerates all active process executable paths and their associated PIDs.
    fn enumerate_process_paths() -> HashMap<String, Vec<u32>> {
        let mut map: HashMap<String, Vec<u32>> = HashMap::new();

        #[cfg(windows)]
        {
            use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, MAX_PATH};
            use windows_sys::Win32::System::Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            };
            use windows_sys::Win32::System::Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            };

            let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
            if snapshot != INVALID_HANDLE_VALUE {
                let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
                entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

                if unsafe { Process32FirstW(snapshot, &mut entry) } != 0 {
                    loop {
                        let pid = entry.th32ProcessID;
                        if pid > 4 {
                            // Skip System (PID 4) and Idle (PID 0)
                            let h_proc =
                                unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
                            if !h_proc.is_null() {
                                let mut buf = [0u16; MAX_PATH as usize];
                                let mut size = buf.len() as u32;
                                let ok = unsafe {
                                    QueryFullProcessImageNameW(
                                        h_proc,
                                        0,
                                        buf.as_mut_ptr(),
                                        &mut size,
                                    )
                                };
                                unsafe { CloseHandle(h_proc) };

                                if ok != 0 && size > 0 {
                                    let full_path = String::from_utf16_lossy(&buf[..size as usize]);
                                    map.entry(full_path).or_default().push(pid);
                                }
                            }
                        }

                        if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                            break;
                        }
                    }
                }
                unsafe { CloseHandle(snapshot) };
            }
        }

        #[cfg(not(windows))]
        {
            // Testing fallback
            if let Ok(current_exe) = std::env::current_exe() {
                map.insert(
                    current_exe.to_string_lossy().to_string(),
                    vec![std::process::id()],
                );
            }
        }

        map
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_running_applications() {
        let apps = ApplicationInventory::scan_running_applications();
        // There should be at least one running app (the current process running this test)
        assert!(!apps.is_empty());
        assert!(apps.iter().any(|a| a.is_running));
    }
}
