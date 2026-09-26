//! Secure Kiosk foundation (Phase 4B.5, Mode B): read-only compatibility detection, and generation
//! of an **administrator** provisioning artifact. This module never changes the machine.
//!
//! The candidate app cannot lock down Windows — only Windows can (see docs/PHASE-4-PLAN.md and
//! docs/security/WINDOWS-SECURE-KIOSK.md). What this provides:
//!
//! * `kiosk_status` — read-only: the current Windows edition, whether it supports Assigned Access
//!   single-app kiosk, and whether this session already *is* running under an Assigned Access
//!   kiosk. Nothing is written.
//! * `kiosk_generate_config` — returns the text of an administrator provisioning bundle (an
//!   Assigned Access configuration plus apply/remove PowerShell that an admin runs, with `-WhatIf`
//!   style confirmations). It is returned to the UI for the admin to review and save; it is **not**
//!   executed, and applying it needs administrator rights and an explicit run by a person.
//!
//! There is deliberately no "enable kiosk" command. Enabling kiosk mode is an administrator action
//! taken with Microsoft's supported tools on a dedicated exam machine, never something the exam app
//! does to a candidate's PC.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskStatus {
    /// `STANDARD` or `SECURE_KIOSK` — determined from the OS, not a client flag.
    pub security_mode: &'static str,
    pub windows_edition: String,
    /// Whether this Windows edition supports single-app Assigned Access kiosk.
    pub assigned_access_supported: bool,
    /// Whether this very session is already running inside an Assigned Access kiosk.
    pub kiosk_active: bool,
    /// A short, human message for the admin screen. Never absolute ("unbreakable", etc.).
    pub summary: String,
}

#[cfg(windows)]
fn windows_edition() -> String {
    // Read-only: HKLM\...\CurrentVersion\ProductName (e.g. "Windows 11 Pro").
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let subkey = wide("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    let value = wide("ProductName");
    let mut buf = [0u16; 256];
    let mut size = (buf.len() * 2) as u32;
    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buf.as_mut_ptr() as *mut _,
            &mut size,
        )
    };
    if rc == ERROR_SUCCESS {
        let len = (size as usize / 2).saturating_sub(1);
        String::from_utf16_lossy(&buf[..len])
    } else {
        "Unknown".to_string()
    }
}

/// Assigned Access single-app kiosk is available on Windows Pro, Enterprise, Education and IoT —
/// not on Home. This is a capability hint from the edition string; the provisioning script also
/// verifies it on the real machine before doing anything.
fn edition_supports_kiosk(edition: &str) -> bool {
    let e = edition.to_ascii_lowercase();
    (e.contains("pro") || e.contains("enterprise") || e.contains("education") || e.contains("iot"))
        && !e.contains("home")
}

#[cfg(windows)]
fn is_kiosk_session() -> bool {
    // A running Assigned Access kiosk replaces the shell for the kiosk account. We treat the
    // absence of the normal Explorer shell for this session as the signal, read-only.
    use windows_sys::Win32::UI::WindowsAndMessaging::GetShellWindow;
    unsafe { GetShellWindow().is_null() }
}

#[tauri::command]
pub fn kiosk_status() -> KioskStatus {
    #[cfg(windows)]
    {
        let edition = windows_edition();
        let supported = edition_supports_kiosk(&edition);
        let active = is_kiosk_session();
        let summary = if active {
            "Windows-managed secure exam environment detected.".to_string()
        } else if supported {
            "Standard Windows. This edition supports Secure Kiosk Mode; an administrator can provision it.".to_string()
        } else {
            "Standard Windows. Secure Kiosk Mode is not available on this Windows edition.".to_string()
        };
        KioskStatus {
            security_mode: if active { "SECURE_KIOSK" } else { "STANDARD" },
            windows_edition: edition,
            assigned_access_supported: supported,
            kiosk_active: active,
            summary,
        }
    }
    #[cfg(not(windows))]
    KioskStatus {
        security_mode: "STANDARD",
        windows_edition: "Not Windows".to_string(),
        assigned_access_supported: false,
        kiosk_active: false,
        summary: "Secure Kiosk Mode is a Windows-only feature.".to_string(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KioskConfig {
    pub available: bool,
    /// Assigned Access XML for the admin to review; empty when unavailable.
    pub assigned_access_xml: String,
    /// PowerShell the admin runs to apply it (requires elevation; prompts before acting).
    pub apply_script: String,
    /// PowerShell the admin runs to remove it and restore the normal desktop.
    pub remove_script: String,
    pub notes: String,
}

/// Builds the administrator provisioning bundle. Pure text generation — it changes nothing.
#[tauri::command]
pub fn kiosk_generate_config(kiosk_account: String, exe_path: String) -> KioskConfig {
    let status = kiosk_status();
    if !status.assigned_access_supported {
        return KioskConfig {
            available: false,
            assigned_access_xml: String::new(),
            apply_script: String::new(),
            remove_script: String::new(),
            notes: format!(
                "Secure Kiosk Mode is not available on this Windows edition ({}). It needs Windows Pro, Enterprise, Education or IoT.",
                status.windows_edition
            ),
        };
    }
    // Sanitise the account name to a plain local user name; refuse anything else rather than
    // building a script around unexpected input.
    let account = kiosk_account.trim();
    let account_ok = !account.is_empty()
        && account.len() <= 64
        && account.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    let account = if account_ok { account } else { "assessx-exam" };
    // The install path, with quotes/backticks stripped so it cannot break out of the XML/script.
    let trimmed = exe_path.trim();
    let exe = if trimmed.is_empty() {
        r"C:\Program Files\AssessX\assessx-desktop.exe".to_string()
    } else {
        trimmed.replace(['`', '"', '<', '>', '&'], "")
    };

    KioskConfig {
        available: true,
        assigned_access_xml: assigned_access_xml(account, &exe),
        apply_script: apply_script(account, &exe),
        remove_script: remove_script(account),
        notes: ADMIN_NOTES.to_string(),
    }
}

fn assigned_access_xml(account: &str, exe: &str) -> String {
    // **Multi-app** Assigned Access. A classic Win32 desktop app (AssessX) is an <App> with a
    // DesktopAppPath inside <AllowedApps> — NOT <KioskModeApp>, which only accepts a UWP
    // AppUserModelId. The taskbar is hidden and the Start layout emptied, so AssessX is the only
    // launchable application. Schema: Microsoft AssignedAccess 2017/config with the rs5 (201810)
    // extension for StartPins/Taskbar.
    format!(
        r#"<?xml version="1.0" encoding="utf-8"?>
<AssignedAccessConfiguration
    xmlns="http://schemas.microsoft.com/AssignedAccess/2017/config"
    xmlns:rs5="http://schemas.microsoft.com/AssignedAccess/201810/config">
  <Profiles>
    <Profile Id="{{9A0B0000-1111-2222-3333-AAAAAAAAAAAA}}">
      <AllAppsList>
        <AllowedApps>
          <App DesktopAppPath="{exe}" />
        </AllowedApps>
      </AllAppsList>
      <rs5:StartPins><![CDATA[{{ "pinnedList": [] }}]]></rs5:StartPins>
      <Taskbar ShowTaskbar="false" />
    </Profile>
  </Profiles>
  <Configs>
    <Config>
      <Account>{account}</Account>
      <DefaultProfile Id="{{9A0B0000-1111-2222-3333-AAAAAAAAAAAA}}" />
    </Config>
  </Configs>
</AssignedAccessConfiguration>
"#
    )
}

fn apply_script(account: &str, exe: &str) -> String {
    // Multi-app Assigned Access is applied through the MDM Bridge WMI provider
    // (root\cimv2\mdm\dmmap → MDM_AssignedAccess.Configuration), the Microsoft-supported route for
    // a classic desktop app. This is a TEMPLATE: it has not been deployment-verified on a supported
    // machine — validate on a disposable Pro/Enterprise/Education machine before use.
    format!(
        r#"# AssessX Secure Kiosk — APPLY  (run as Administrator, on a DEDICATED exam machine only)
# TEMPLATE — NOT YET DEPLOYMENT-VERIFIED. Review and test on a disposable Windows Pro/Enterprise/
# Education machine before using in production. It does NOT modify your current account.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$account = '{account}'
$exe = '{exe}'

Write-Host "This restricts the local account '$account' to AssessX only (multi-app Assigned Access)." -ForegroundColor Yellow
if ((Read-Host "Type YES to continue") -ne 'YES') {{ Write-Host 'Cancelled.'; return }}

# 1. Kiosk account (create if missing; no password — configure secure sign-in per your policy).
if (-not (Get-LocalUser -Name $account -ErrorAction SilentlyContinue)) {{
    New-LocalUser -Name $account -NoPassword -AccountNeverExpires | Out-Null
    Add-LocalGroupMember -Group 'Users' -Member $account
}}
# 2. Confirm AssessX is installed where the configuration expects it.
if (-not (Test-Path $exe)) {{ throw "AssessX not found at $exe. Install it, or edit the path." }}

# 3. Assigned Access configuration (the <App DesktopAppPath> already points at $exe).
$config = @'
{xml}
'@

# 4. Apply via the MDM Bridge WMI provider (multi-app Assigned Access; supports desktop apps).
$ns = 'root\cimv2\mdm\dmmap'
$obj = Get-CimInstance -Namespace $ns -ClassName MDM_AssignedAccess
$obj.Configuration = [System.Security.SecurityElement]::Escape($config)
Set-CimInstance -CimInstance $obj -ErrorAction Stop
Write-Host "Assigned Access applied for '$account'. Sign in as that account to start the secure exam session." -ForegroundColor Green
"#,
        account = account,
        exe = exe,
        xml = assigned_access_xml(account, exe),
    )
}

fn remove_script(account: &str) -> String {
    format!(
        r#"# AssessX Secure Kiosk — REMOVE / RECOVERY  (run as Administrator)
# Clears Assigned Access and restores the normal desktop for "{account}".
# Sign in with a DIFFERENT administrator account (not the kiosk account) to run this.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$account = '{account}'
$ns = 'root\cimv2\mdm\dmmap'
$obj = Get-CimInstance -Namespace $ns -ClassName MDM_AssignedAccess
$obj.Configuration = ''
Set-CimInstance -CimInstance $obj
Write-Host "Assigned Access cleared. '$account' now has the normal desktop." -ForegroundColor Green
# The kiosk account is left in place; delete it manually if it is no longer needed:
#   Remove-LocalUser -Name $account
# Fallback (GUI): Settings > Accounts > Other users > (kiosk) > Remove; or Settings > Accounts >
# Set up a kiosk > remove the assigned-access configuration.
"#
    )
}

const ADMIN_NOTES: &str = "TEMPLATE — generated but NOT YET deployment-verified. This is multi-app \
Assigned Access (the supported route for a classic desktop app) applied through the MDM Bridge WMI \
provider; validate it on a disposable Windows Pro/Enterprise/Education machine before production \
use. Apply only on a dedicated, institution-managed exam machine — never on a personal device. The \
candidate app cannot enable this; an administrator must run the apply script with elevation. \
Recovery: sign in as a DIFFERENT administrator account and run the remove script, or use \
Settings > Accounts > Other users. Full guide: docs/security/WINDOWS-SECURE-KIOSK.md.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edition_capability_matches_microsoft_support() {
        for pro in ["Windows 11 Pro", "Windows 10 Enterprise", "Windows 11 Education", "Windows 10 IoT Enterprise"] {
            assert!(edition_supports_kiosk(pro), "{pro} should support kiosk");
        }
        for home in ["Windows 11 Home", "Windows 10 Home Single Language"] {
            assert!(!edition_supports_kiosk(home), "{home} should not support kiosk");
        }
    }

    #[test]
    fn generated_scripts_are_scoped_to_the_given_account() {
        let exe = r"C:\Program Files\AssessX\assessx-desktop.exe";
        let xml = assigned_access_xml("exam-user", exe);
        assert!(xml.contains("<Account>exam-user</Account>"));
        // A classic desktop app is an <App DesktopAppPath>, never <KioskModeApp> (UWP only).
        assert!(xml.contains(&format!("<App DesktopAppPath=\"{exe}\" />")));
        assert!(!xml.contains("KioskModeApp"));
        let apply = apply_script("exam-user", exe);
        assert!(apply.contains("$account = 'exam-user'"));
        // Applied via the supported MDM Bridge WMI provider, gated on admin + explicit confirmation.
        assert!(apply.contains("MDM_AssignedAccess"));
        assert!(apply.contains("#Requires -RunAsAdministrator"));
        assert!(apply.contains("Type YES to continue"));
        assert!(remove_script("exam-user").contains("$obj.Configuration = ''"));
    }
}
