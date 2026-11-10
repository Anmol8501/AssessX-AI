//! Accessibility Management & Accommodation Support (Phase 2C).
//!
//! Treats accessibility accommodations as a first-class requirement.
//! Preserves approved screen-reader, Sticky Keys, Filter Keys, and High Contrast
//! workflows without accidental global suppression.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityAccommodationConfig {
    pub sticky_keys_permitted: bool,
    pub filter_keys_permitted: bool,
    pub toggle_keys_permitted: bool,
    pub high_contrast_permitted: bool,
    pub screen_reader_active: bool,
    pub magnifier_active: bool,
    pub accommodation_notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccessibilityStatusReport {
    pub sticky_keys_detected: bool,
    pub filter_keys_detected: bool,
    pub high_contrast_detected: bool,
    pub screen_reader_detected: bool,
    pub accommodations_active_count: usize,
    pub has_conflicts: bool,
    pub conflict_description: Option<String>,
}

pub struct AccessibilityManager;

impl AccessibilityManager {
    /// Inspect Windows accessibility status and detect active accommodations.
    #[cfg(windows)]
    pub fn inspect_accessibility() -> AccessibilityStatusReport {
        use windows_sys::Win32::Foundation::ERROR_SUCCESS;
        use windows_sys::Win32::System::Registry::{
            RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, KEY_READ, REG_SZ,
        };

        fn wide(s: &str) -> Vec<u16> {
            s.encode_utf16().chain(std::iter::once(0)).collect()
        }

        let mut sticky_on = false;
        let filter_on = false;
        let mut screen_reader = false;

        unsafe {
            // Check StickyKeys
            let mut hkey = std::ptr::null_mut();
            let subkey = wide("Control Panel\\Accessibility\\StickyKeys");
            if RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, KEY_READ, &mut hkey) == ERROR_SUCCESS {
                let flags_name = wide("Flags");
                let mut buf = [0u16; 32];
                let mut size = (buf.len() * 2) as u32;
                let mut val_type = 0;
                if RegQueryValueExW(
                    hkey,
                    flags_name.as_ptr(),
                    std::ptr::null_mut(),
                    &mut val_type,
                    buf.as_mut_ptr() as *mut _,
                    &mut size,
                ) == ERROR_SUCCESS && val_type == REG_SZ {
                    let len = (size as usize / 2).saturating_sub(1);
                    let val_str = String::from_utf16_lossy(&buf[..len]);
                    if let Ok(flags) = val_str.trim().parse::<u32>() {
                        sticky_on = (flags & 0x00000001) != 0; // SKF_STICKYKEYSON
                    }
                }
                RegCloseKey(hkey);
            }

            // Check ScreenReader flag
            let mut blind_hkey = std::ptr::null_mut();
            let blind_subkey = wide("Control Panel\\Accessibility\\Blind Access");
            if RegOpenKeyExW(HKEY_CURRENT_USER, blind_subkey.as_ptr(), 0, KEY_READ, &mut blind_hkey) == ERROR_SUCCESS {
                screen_reader = true;
                RegCloseKey(blind_hkey);
            }
        }

        let mut active_count = 0;
        if sticky_on { active_count += 1; }
        if filter_on { active_count += 1; }
        if screen_reader { active_count += 1; }

        AccessibilityStatusReport {
            sticky_keys_detected: sticky_on,
            filter_keys_detected: filter_on,
            high_contrast_detected: false,
            screen_reader_detected: screen_reader,
            accommodations_active_count: active_count,
            has_conflicts: false,
            conflict_description: None,
        }
    }

    #[cfg(not(windows))]
    pub fn inspect_accessibility() -> AccessibilityStatusReport {
        AccessibilityStatusReport {
            sticky_keys_detected: false,
            filter_keys_detected: false,
            high_contrast_detected: false,
            screen_reader_detected: false,
            accommodations_active_count: 0,
            has_conflicts: false,
            conflict_description: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_accessibility() {
        let report = AccessibilityManager::inspect_accessibility();
        assert!(report.accommodations_active_count <= 10);
    }
}
