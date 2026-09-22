// Prevents an additional console window on Windows in release builds. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    assessx_desktop_lib::run()
}
