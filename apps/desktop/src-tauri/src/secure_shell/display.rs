//! Secure Shell and Display Manager (Stage 4, Phase 1B).
//!
//! Manages fullscreen examination window state, primary display resolution,
//! scaling awareness, and multi-monitor connection/disconnection topology.

use serde::Serialize;
use tauri::{Runtime, WebviewWindow};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub display_id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayTopologyReport {
    pub monitor_count: usize,
    pub primary_display: Option<DisplayInfo>,
    pub displays: Vec<DisplayInfo>,
    pub is_multi_monitor: bool,
    pub is_fullscreen: bool,
    pub is_focused: bool,
    pub status: &'static str, // "PASS" | "VIOLATION_MULTI_MONITOR" | "NOT_FULLSCREEN"
    pub message: String,
}

pub fn get_display_topology<R: Runtime>(window: &WebviewWindow<R>) -> DisplayTopologyReport {
    let monitors = window.available_monitors().unwrap_or_default();
    let primary_monitor = window.primary_monitor().ok().flatten();

    let mut display_list = Vec::new();
    let mut primary_info = None;

    for (idx, mon) in monitors.iter().enumerate() {
        let size = mon.size();
        let scale = mon.scale_factor();
        let is_primary = if let Some(ref p) = primary_monitor {
            p.name() == mon.name() && p.position() == mon.position()
        } else {
            idx == 0
        };

        let info = DisplayInfo {
            display_id: format!("display-{}", idx + 1),
            name: mon.name().cloned().unwrap_or_else(|| format!("Display {}", idx + 1)),
            width: size.width,
            height: size.height,
            scale_factor: scale,
            is_primary,
        };

        if is_primary && primary_info.is_none() {
            primary_info = Some(info.clone());
        }
        display_list.push(info);
    }

    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    let is_focused = window.is_focused().unwrap_or(true);
    let monitor_count = display_list.len();
    let is_multi_monitor = monitor_count > 1;

    let (status, message) = if is_multi_monitor {
        (
            "VIOLATION_MULTI_MONITOR",
            format!("{} displays detected. Institutional exam policy requires a single display.", monitor_count),
        )
    } else if !is_fullscreen {
        (
            "NOT_FULLSCREEN",
            "Examination window is not currently in exclusive fullscreen mode.".to_string(),
        )
    } else {
        (
            "PASS",
            "Single display detected in exclusive fullscreen mode.".to_string(),
        )
    };

    DisplayTopologyReport {
        monitor_count,
        primary_display: primary_info,
        displays: display_list,
        is_multi_monitor,
        is_fullscreen,
        is_focused,
        status,
        message,
    }
}

pub fn enforce_secure_shell_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let _ = window.unminimize();
    let _ = window.set_fullscreen(true);
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    window.is_fullscreen().unwrap_or(false)
}

pub fn release_secure_shell_window<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    let _ = window.set_always_on_top(false);
    let _ = window.set_fullscreen(false);
    !window.is_fullscreen().unwrap_or(true)
}
