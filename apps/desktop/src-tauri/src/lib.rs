//! AssessX desktop shell.
//!
//! Hosts the React UI inside a native window. Native capabilities are added as narrow Tauri
//! commands registered here: Phase 4B's proctored-exam lockdown lives in `lockdown`, the pre-exam
//! device-readiness check in `readiness`, and the read-only Secure Kiosk foundation in `kiosk`.

mod kiosk;
mod lockdown;
mod readiness;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(lockdown::Lockdown::default())
        .invoke_handler(tauri::generate_handler![
            lockdown::lockdown_engage,
            lockdown::lockdown_release,
            lockdown::lockdown_restore_fullscreen,
            lockdown::environment_snapshot,
            readiness::readiness_scan,
            readiness::readiness_close_apps,
            kiosk::kiosk_status,
            kiosk::kiosk_generate_config,
        ])
        .on_window_event(lockdown::on_window_event)
        .on_page_load(|webview, _payload| lockdown::release_on_page_load(&webview.window()))
        .run(tauri::generate_context!())
        .expect("error while running AssessX");
}
