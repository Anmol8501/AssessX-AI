//! AssessX desktop shell.
//!
//! Phase 1A only hosts the React UI inside a native window. Native capabilities
//! (system checks, secure exam mode, capture) arrive in later phases as Tauri
//! commands and plugins registered here.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running AssessX");
}
