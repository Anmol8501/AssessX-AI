//! The application policy for the pre-exam device-readiness check (Phase 4B.5).
//!
//! Pure and platform-independent, so it is fully unit-tested. It answers one question about a
//! process: given its executable name, is it a **user application the exam policy prohibits**, and
//! if so, in which category and under what display name.
//!
//! Two rules keep this safe:
//!
//! * **Allow-list, not deny-list.** Only executables that appear in `PROHIBITED` are ever reported.
//!   Everything else — Windows components, services, drivers, security software, and any program
//!   not on the list — is left alone. There is no "terminate everything unknown" path anywhere.
//! * **A hard protected set on top.** `is_protected` names things that must never be touched even
//!   if a future edit mistakenly added them to the prohibited list (AssessX itself, the shell,
//!   Windows-critical processes, common antivirus). `classify` returns `None` for anything
//!   protected, so the two lists can never disagree in a dangerous direction.
//!
//! The caller only ever acts on processes that have a *visible top-level window* (see
//! `enumerate` in `mod.rs`), so background helpers of an allowed program are not considered.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Browser,
    Communication,
    RemoteControl,
    ScreenRecording,
    AiAssistant,
    DeveloperTool,
    Terminal,
    Virtualization,
    Other,
}

impl Category {
    /// The identifier sent to the backend event log (`app_category`).
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Browser => "browser",
            Category::Communication => "communication",
            Category::RemoteControl => "remote-control",
            Category::ScreenRecording => "screen-recording",
            Category::AiAssistant => "ai-assistant",
            Category::DeveloperTool => "developer-tool",
            Category::Terminal => "terminal",
            Category::Virtualization => "virtualization",
            Category::Other => "other",
        }
    }
}

pub struct Prohibited {
    /// Lower-case executable name without `.exe` — matched exactly.
    pub exe: &'static str,
    /// Stable policy id sent to the backend (`app`): `^[a-z0-9][a-z0-9._-]{0,39}$`.
    pub id: &'static str,
    /// What the candidate sees.
    pub display_name: &'static str,
    pub category: Category,
}

use Category::*;

/// The prohibited **user applications**. Expandable; deliberately not exhaustive. Matched on the
/// executable name only, so no window title or path is needed to classify a process.
pub const PROHIBITED: &[Prohibited] = &[
    // browsers
    p("chrome", "chrome", "Google Chrome", Browser),
    p("msedge", "msedge", "Microsoft Edge", Browser),
    p("firefox", "firefox", "Mozilla Firefox", Browser),
    p("brave", "brave", "Brave", Browser),
    p("opera", "opera", "Opera", Browser),
    p("vivaldi", "vivaldi", "Vivaldi", Browser),
    // communication
    p("discord", "discord", "Discord", Communication),
    p("slack", "slack", "Slack", Communication),
    p("teams", "teams", "Microsoft Teams", Communication),
    p("ms-teams", "ms-teams", "Microsoft Teams", Communication),
    p("whatsapp", "whatsapp", "WhatsApp", Communication),
    p("telegram", "telegram", "Telegram", Communication),
    p("skype", "skype", "Skype", Communication),
    p("zoom", "zoom", "Zoom", Communication),
    // remote control
    p("anydesk", "anydesk", "AnyDesk", RemoteControl),
    p("teamviewer", "teamviewer", "TeamViewer", RemoteControl),
    p("rustdesk", "rustdesk", "RustDesk", RemoteControl),
    p("mstsc", "mstsc", "Remote Desktop", RemoteControl),
    p("vncviewer", "vncviewer", "VNC Viewer", RemoteControl),
    // screen recording / sharing
    p("obs64", "obs", "OBS Studio", ScreenRecording),
    p("obs32", "obs", "OBS Studio", ScreenRecording),
    p("obs", "obs", "OBS Studio", ScreenRecording),
    p("snippingtool", "snippingtool", "Snipping Tool", ScreenRecording),
    p("screenrec", "screenrec", "ScreenRec", ScreenRecording),
    p("sharex", "sharex", "ShareX", ScreenRecording),
    // AI assistants
    p("chatgpt", "chatgpt", "ChatGPT", AiAssistant),
    p("copilot", "copilot", "Copilot", AiAssistant),
    // developer tools
    p("code", "vscode", "Visual Studio Code", DeveloperTool),
    p("devenv", "visualstudio", "Visual Studio", DeveloperTool),
    p("idea64", "intellij", "IntelliJ IDEA", DeveloperTool),
    p("pycharm64", "pycharm", "PyCharm", DeveloperTool),
    p("sublime_text", "sublimetext", "Sublime Text", DeveloperTool),
    p("notepad++", "notepad-plus-plus", "Notepad++", DeveloperTool),
    p("postman", "postman", "Postman", DeveloperTool),
    // terminals
    p("cmd", "cmd", "Command Prompt", Terminal),
    p("powershell", "powershell", "PowerShell", Terminal),
    p("pwsh", "pwsh", "PowerShell", Terminal),
    p("windowsterminal", "windows-terminal", "Windows Terminal", Terminal),
    p("wt", "windows-terminal", "Windows Terminal", Terminal),
    p("conhost", "conhost", "Console Window Host", Terminal),
    // virtualization
    p("vmware", "vmware", "VMware", Virtualization),
    p("virtualbox", "virtualbox", "VirtualBox", Virtualization),
    p("vmconnect", "hyper-v", "Hyper-V", Virtualization),
    // common user apps that can hold notes/answers
    p("notepad", "notepad", "Notepad", Other),
    p("wordpad", "wordpad", "WordPad", Other),
    p("winword", "word", "Microsoft Word", Other),
    p("onenote", "onenote", "OneNote", Other),
    p("acrobat", "acrobat", "Adobe Acrobat", Other),
];

const fn p(exe: &'static str, id: &'static str, display_name: &'static str, category: Category) -> Prohibited {
    Prohibited { exe, id, display_name, category }
}

/// Executables that must never be reported or closed, whatever the prohibited list says. Kept as a
/// second, independent guard: AssessX itself, the Windows shell and session-critical processes, and
/// common security software (matched by prefix).
const PROTECTED_EXACT: &[&str] = &[
    "assessx-desktop",
    "explorer",
    "dwm",
    "winlogon",
    "csrss",
    "services",
    "lsass",
    "smss",
    "wininit",
    "svchost",
    "sihost",
    "taskhostw",
    "ctfmon",
    "fontdrvhost",
    "system",
    "registry",
    "searchhost",
    "startmenuexperiencehost",
    "shellexperiencehost",
    "textinputhost",
    "msedgewebview2", // AssessX's own web view
];

const PROTECTED_PREFIX: &[&str] = &[
    "msmpeng",
    "nissrv",
    "securityhealth",
    "windowsdefender",
    "avp",       // Kaspersky
    "avguard",   // Avira
    "avgnt",     // Avira
    "mcshield",  // McAfee
    "mbam",      // Malwarebytes
    "ekrn",      // ESET
    "bdagent",   // Bitdefender
    "avastsvc",  // Avast
    "avgsvc",    // AVG
    "sophos",
    "cb",        // Carbon Black
    "crowdstrike",
    "sentinel",  // SentinelOne
];

fn normalise(exe_name: &str) -> String {
    let lower = exe_name.trim().to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

/// True when the executable must never be reported or closed.
pub fn is_protected(exe_name: &str) -> bool {
    let name = normalise(exe_name);
    PROTECTED_EXACT.contains(&name.as_str()) || PROTECTED_PREFIX.iter().any(|p| name.starts_with(p))
}

/// The prohibited-app entry for this executable, or `None` when it is allowed or protected.
///
/// Matches the exact executable stem, or that stem followed by a dotted suffix — packaged Store
/// apps often run under a name like `WhatsApp.Root.exe`, so `whatsapp` also matches
/// `whatsapp.root`. The match stays anchored at a `.` boundary, so it never matches an unrelated
/// name such as `whatsappfoo`, and `is_protected` is still checked first so a protected process can
/// never be caught by a suffix.
pub fn classify(exe_name: &str) -> Option<&'static Prohibited> {
    if is_protected(exe_name) {
        return None; // protected always wins
    }
    let name = normalise(exe_name);
    PROHIBITED
        .iter()
        .find(|entry| name.strip_prefix(entry.exe).is_some_and(|rest| rest.is_empty() || rest.starts_with('.')))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_store_apps_match_by_dotted_suffix() {
        // The Microsoft Store WhatsApp runs as WhatsApp.Root.exe.
        assert_eq!(classify("WhatsApp.Root.exe").unwrap().id, "whatsapp");
        assert_eq!(classify("whatsapp.exe").unwrap().id, "whatsapp");
        // The suffix must be at a dot boundary — an unrelated longer name is not caught.
        assert!(classify("whatsappfoo.exe").is_none());
        assert!(classify("chromedriver.exe").is_none());
    }

    #[test]
    fn prohibited_apps_are_classified_with_a_category() {
        let chrome = classify("chrome.exe").unwrap();
        assert_eq!(chrome.id, "chrome");
        assert_eq!(chrome.category, Browser);
        assert_eq!(classify("Discord.EXE").unwrap().category, Communication); // case-insensitive
        assert_eq!(classify("anydesk").unwrap().category, RemoteControl); // suffix optional
    }

    #[test]
    fn allowed_applications_are_not_reported() {
        for allowed in ["spotify.exe", "calc.exe", "randomgame.exe", "myapp.exe"] {
            assert!(classify(allowed).is_none(), "{allowed} should be allowed");
        }
    }

    #[test]
    fn assessx_and_its_webview_are_protected() {
        assert!(is_protected("assessx-desktop.exe"));
        assert!(is_protected("msedgewebview2.exe"));
        assert!(classify("assessx-desktop.exe").is_none());
    }

    #[test]
    fn system_and_shell_processes_are_protected() {
        for name in ["explorer.exe", "dwm.exe", "winlogon.exe", "csrss.exe", "lsass.exe", "svchost.exe"] {
            assert!(is_protected(name), "{name} must be protected");
            assert!(classify(name).is_none());
        }
    }

    #[test]
    fn security_software_is_protected_by_prefix() {
        for name in ["MsMpEng.exe", "avastsvc.exe", "ekrn.exe", "SentinelAgent.exe", "mbamservice.exe"] {
            assert!(is_protected(name), "{name} must be protected");
        }
    }

    #[test]
    fn every_policy_id_fits_the_backend_vocabulary() {
        // Mirrors `_APP_ID` in backend/app/services/proctoring_events.py.
        for entry in PROHIBITED {
            let id = entry.id;
            assert!(id.len() <= 40 && !id.is_empty());
            assert!(id.chars().next().unwrap().is_ascii_alphanumeric());
            assert!(id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')));
            assert!(!entry.category.as_str().is_empty());
        }
    }

    #[test]
    fn a_protected_name_added_to_prohibited_would_still_be_skipped() {
        // classify() consults is_protected() first, so protection cannot be undone by the list.
        assert!(is_protected("explorer"));
        assert!(classify("explorer.exe").is_none());
    }
}
