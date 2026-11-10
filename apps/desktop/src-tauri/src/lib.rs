//! AssessX desktop shell.
//!
//! Hosts the React UI inside a native window. Native capabilities are added as narrow Tauri
//! commands registered here: Phase 4B's proctored-exam lockdown lives in `lockdown`, the pre-exam
//! device-readiness check in `readiness`, and the read-only Secure Kiosk foundation in `kiosk`.
//!
//! In-app updates use the official updater plugin: the app checks the latest GitHub Release's
//! `latest.json`, and installs an update only if its signature matches the public key in
//! `tauri.conf.json` (see docs/RELEASING.md). `process` provides the relaunch after an update.

pub mod application_control;
mod credentials;
mod kiosk;
mod lockdown;
pub mod provisioning;
mod readiness;
pub mod secure_shell;
pub mod security_agent;
pub mod system_utility;
pub mod navigation_control;
pub mod peripheral_control;
pub mod session_activation;
pub mod session_continuity;
pub mod submission_closure;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(lockdown::Lockdown::default())
        .manage(secure_shell::SecureShellState::default())
        .invoke_handler(tauri::generate_handler![
            lockdown::lockdown_engage,
            lockdown::lockdown_release,
            lockdown::lockdown_restore_fullscreen,
            lockdown::environment_snapshot,
            lockdown::exam_close_guard,
            readiness::readiness_scan,
            readiness::readiness_close_apps,
            kiosk::kiosk_status,
            kiosk::kiosk_generate_config,
            credentials::session_token_store,
            credentials::session_token_load,
            credentials::session_token_clear,
            provisioning::provisioning_get_compatibility,
            provisioning::provisioning_get_hardware,
            provisioning::provisioning_get_security,
            provisioning::provisioning_get_privileges,
            provisioning::provisioning_get_device_identity,
            provisioning::provisioning_re_enroll_device_identity,
            provisioning::provisioning_inspect_account,
            provisioning::provisioning_get_plan,
            provisioning::provisioning_validate_configuration,
            provisioning::provisioning_get_diagnostic_report,
            provisioning::provisioning_get_journal,
            provisioning::provisioning_record_plan,
            provisioning::provisioning_run_full_scan,
            secure_shell::secure_shell_get_kiosk_capabilities,
            secure_shell::secure_shell_preview_kiosk_config,
            secure_shell::secure_shell_apply_kiosk_config,
            secure_shell::secure_shell_inspect_startup,
            secure_shell::secure_shell_register_startup,
            secure_shell::secure_shell_get_display_topology,
            secure_shell::secure_shell_enforce_fullscreen,
            secure_shell::secure_shell_release_fullscreen,
            secure_shell::secure_shell_get_lifecycle_state,
            secure_shell::secure_shell_run_startup_validation,
            secure_shell::secure_shell_check_crash_recovery,
            secure_shell::secure_shell_mark_clean_exit,
            secure_shell::secure_shell_preview_restoration,
            secure_shell::secure_shell_execute_restoration,
            secure_shell::secure_shell_get_health,
            secure_shell::secure_shell_heartbeat,
            security_agent::get_security_agent_status,
            security_agent::start_security_agent_daemon,
            security_agent::stop_security_agent_daemon,
            security_agent::install_security_agent_service,
            security_agent::uninstall_security_agent_service,
            security_agent::get_device_compliance_report,
            security_agent::verify_component_integrity,
            security_agent::get_agent_tamper_events,
            security_agent::send_agent_heartbeat,
            security_agent::report_agent_security_event,
            security_agent::flush_security_agent_events,
            security_agent::get_agent_recovery_status,
            security_agent::reset_agent_recovery,
            application_control::application_control_get_inventory,
            application_control::application_control_get_allowlist,
            application_control::application_control_add_rule,
            application_control::application_control_remove_rule,
            application_control::application_control_get_capabilities,
            application_control::application_control_get_policy_state,
            application_control::application_control_preview_policy,
            application_control::application_control_apply_policy,
            application_control::application_control_restore_baseline,
            application_control::application_control_scan_violations,
            system_utility::get_system_utility_inventory,
            system_utility::inspect_powershell_status,
            system_utility::apply_powershell_policy,
            system_utility::inspect_cmd_status,
            system_utility::apply_cmd_policy,
            system_utility::inspect_task_manager_status,
            system_utility::apply_task_manager_policy,
            system_utility::get_system_utility_policy,
            system_utility::preview_system_utility_policy,
            system_utility::apply_system_utility_policy,
            system_utility::scan_system_utility_violations,
            system_utility::revert_system_utility_policy,
            navigation_control::get_shortcut_inventory,
            navigation_control::get_navigation_policy,
            navigation_control::preview_navigation_policy,
            navigation_control::apply_navigation_policy,
            navigation_control::revert_navigation_policy,
            navigation_control::inspect_navigation_status,
            navigation_control::inspect_window_focus,
            navigation_control::inspect_accessibility_status,
            navigation_control::scan_navigation_violations,
            peripheral_control::inspect_storage_status,
            peripheral_control::inspect_display_topology,
            peripheral_control::inspect_remote_access_status,
            peripheral_control::get_peripheral_policy,
            peripheral_control::preview_peripheral_policy,
            peripheral_control::validate_and_save_peripheral_policy,
            peripheral_control::apply_peripheral_policy,
            peripheral_control::rollback_peripheral_policy,
            peripheral_control::scan_peripheral_violations,
            session_activation::run_examination_readiness,
            session_activation::bind_session_policy,
            session_continuity::save_answer_local,
            session_continuity::get_all_local_answers,
            session_continuity::mark_local_answers_synced,
            session_continuity::clear_local_answers,
            session_continuity::get_recovery_session_state,
            session_continuity::record_continuity_heartbeat,
            submission_closure::authorize_secure_examination_exit,
        ])
        .on_window_event(lockdown::on_window_event)
        .on_page_load(|webview, _payload| lockdown::release_on_page_load(&webview.window()))
        .run(tauri::generate_context!())
        .expect("error while running AssessX");
}
