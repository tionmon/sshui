//! WSL: global VM settings in %USERPROFILE%\.wslconfig and the installed distributions.
//!
//! Detection and the distribution list come from the registry (Lxss key), so nothing is
//! started to read them. wsl.exe only runs for its version and explicit actions
//! (shut down, set default).

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use super::devtools::{home, ini_read, ini_set, write_file};
use super::proc::{blocking, command, error_line, run_with_timeout};

#[derive(Debug, Clone, Serialize)]
pub struct WslDistro {
    pub name: String,
    /// 1 or 2
    pub version: u32,
    pub default: bool,
    pub base_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WslInfo {
    pub version: Option<String>,
    pub distros: Vec<WslDistro>,
    pub config_path: String,
    pub config_exists: bool,
    /// "section.key" → value, e.g. "wsl2.memory" → "8GB"
    pub settings: BTreeMap<String, String>,
}

/// wsl.exe, when WSL is actually set up: the Store package is installed or at least
/// one distribution is registered. (Windows ships a wsl.exe stub either way.)
pub fn wsl_bin() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let store = std::env::var_os("ProgramFiles").map(|p| PathBuf::from(p).join("WSL").join("wsl.exe"));
        if let Some(store) = store.filter(|p| p.is_file()) {
            return Some(store);
        }
        let system = std::env::var_os("SystemRoot").map(|r| PathBuf::from(r).join("System32").join("wsl.exe"))?;
        (system.is_file() && !win::distros().is_empty()).then_some(system)
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn wslconfig_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".wslconfig"))
}

/// wsl.exe prints UTF-16 unless WSL_UTF8 is honoured (older builds ignore it).
fn decode_output(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes.iter().skip(1).step_by(2).take(16).all(|&b| b == 0) {
        let wide: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        String::from_utf16_lossy(&wide)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

fn wsl(args: &[&str], timeout: Duration) -> Result<String, String> {
    let bin = wsl_bin().ok_or("WSL is not installed")?;
    let mut cmd = command(bin);
    cmd.env("WSL_UTF8", "1").args(args);
    let output = run_with_timeout(cmd, timeout)?;
    let text = decode_output(&output.stdout).replace('\0', "");
    if output.status.success() {
        Ok(text)
    } else {
        let err = decode_output(&output.stderr).replace('\0', "");
        let line = err.lines().chain(text.lines()).map(str::trim).rfind(|l| !l.is_empty());
        Err(line.map(str::to_string).unwrap_or_else(|| error_line(&output)))
    }
}

/// "WSL version: 2.3.26.0" (localized label) → "2.3.26.0"
fn parse_version(text: &str) -> Option<String> {
    let first = text.lines().find(|l| !l.trim().is_empty())?;
    first
        .split(|c: char| c.is_whitespace() || c == ':' || c == '：')
        .find(|t| t.chars().next().is_some_and(|c| c.is_ascii_digit()) && t.contains('.'))
        .map(str::to_string)
}

// Settings that can be edited, with how they are validated
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Size,
    Count,
    Bool,
    Path,
    Choice(&'static [&'static str]),
}

const SETTINGS: &[(&str, &str, Kind)] = &[
    ("wsl2", "memory", Kind::Size),
    ("wsl2", "processors", Kind::Count),
    ("wsl2", "swap", Kind::Size),
    ("wsl2", "swapFile", Kind::Path),
    ("wsl2", "localhostForwarding", Kind::Bool),
    ("wsl2", "networkingMode", Kind::Choice(&["NAT", "mirrored"])),
    ("wsl2", "dnsTunneling", Kind::Bool),
    ("wsl2", "firewall", Kind::Bool),
    ("wsl2", "autoProxy", Kind::Bool),
    ("wsl2", "guiApplications", Kind::Bool),
    ("wsl2", "nestedVirtualization", Kind::Bool),
    ("wsl2", "vmIdleTimeout", Kind::Count),
    ("experimental", "autoMemoryReclaim", Kind::Choice(&["disabled", "gradual", "dropCache"])),
    ("experimental", "sparseVhd", Kind::Bool),
    ("experimental", "hostAddressLoopback", Kind::Bool),
];

fn validate(kind: Kind, key: &str, v: &str) -> Result<(), String> {
    let ok = match kind {
        Kind::Size => {
            let upper = v.to_ascii_uppercase();
            let digits = upper.trim_end_matches(|c: char| c.is_ascii_alphabetic());
            let unit = &upper[digits.len()..];
            digits.parse::<f64>().is_ok_and(|n| n >= 0.0) && ["", "B", "KB", "MB", "GB", "TB"].contains(&unit)
        }
        Kind::Count => v.parse::<u64>().is_ok(),
        Kind::Bool => v == "true" || v == "false",
        Kind::Path => !v.contains(['\n', '\r']),
        Kind::Choice(options) => options.iter().any(|o| o.eq_ignore_ascii_case(v)),
    };
    ok.then_some(()).ok_or_else(|| format!("\"{}\" is not a valid value for {}", v, key))
}

#[tauri::command]
pub async fn wsl_info() -> Result<WslInfo, String> {
    blocking(|| {
        wsl_bin().ok_or("WSL is not installed")?;
        let path = wslconfig_path()?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        let mut settings = BTreeMap::new();
        for section in ["wsl2", "experimental"] {
            for (key, value) in ini_read(&content, Some(section)) {
                // Report keys with the documented spelling so the page can find them
                let key = SETTINGS
                    .iter()
                    .find(|(s, k, _)| *s == section && k.eq_ignore_ascii_case(&key))
                    .map(|(_, k, _)| k.to_string())
                    .unwrap_or(key);
                settings.insert(format!("{}.{}", section, key), value);
            }
        }
        Ok(WslInfo {
            version: wsl(&["--version"], Duration::from_secs(15)).ok().as_deref().and_then(parse_version),
            #[cfg(windows)]
            distros: win::distros(),
            #[cfg(not(windows))]
            distros: Vec::new(),
            config_exists: path.exists(),
            config_path: path.display().to_string(),
            settings,
        })
    })
    .await?
}

/// Set or remove one .wslconfig setting. Takes effect after `wsl --shutdown`.
#[tauri::command]
pub async fn wsl_set_config(section: String, key: String, value: Option<String>) -> Result<(), String> {
    blocking(move || {
        let (_, _, kind) = SETTINGS
            .iter()
            .find(|(s, k, _)| *s == section && *k == key)
            .ok_or_else(|| format!("Unsupported WSL setting \"{}.{}\"", section, key))?;
        let value = value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        if let Some(v) = &value {
            validate(*kind, &key, v)?;
        }
        let path = wslconfig_path()?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        write_file(&path, &ini_set(&content, Some(&section), &key, value.as_deref(), "="))
    })
    .await?
}

/// Stop every distribution and the WSL VM so .wslconfig changes apply.
#[tauri::command]
pub async fn wsl_shutdown() -> Result<(), String> {
    blocking(|| wsl(&["--shutdown"], Duration::from_secs(60)).map(|_| ())).await?
}

#[tauri::command]
pub async fn wsl_set_default(name: String) -> Result<(), String> {
    blocking(move || {
        #[cfg(windows)]
        if !win::distros().iter().any(|d| d.name == name) {
            return Err(format!("No distribution named \"{}\"", name));
        }
        wsl(&["--set-default", &name], Duration::from_secs(30)).map(|_| ())
    })
    .await?
}

#[cfg(windows)]
mod win {
    use super::WslDistro;
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const LXSS: &str = r"Software\Microsoft\Windows\CurrentVersion\Lxss";

    pub fn distros() -> Vec<WslDistro> {
        let Ok(lxss) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(LXSS) else { return Vec::new() };
        let default: Option<String> = lxss.get_value("DefaultDistribution").ok();
        let mut out: Vec<WslDistro> = lxss
            .enum_keys()
            .filter_map(Result::ok)
            .filter_map(|id| {
                let key = lxss.open_subkey(&id).ok()?;
                let name: String = key.get_value("DistributionName").ok()?;
                Some(WslDistro {
                    name,
                    version: key.get_value::<u32, _>("Version").unwrap_or(2),
                    default: default.as_deref().is_some_and(|d| d.eq_ignore_ascii_case(&id)),
                    base_path: key.get_value::<String, _>("BasePath").ok(),
                })
            })
            .collect();
        out.sort_by(|a, b| b.default.cmp(&a.default).then_with(|| a.name.cmp(&b.name)));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_settings() {
        assert!(validate(Kind::Size, "memory", "8GB").is_ok());
        assert!(validate(Kind::Size, "memory", "0.5gb").is_ok());
        assert!(validate(Kind::Size, "swap", "0").is_ok());
        assert!(validate(Kind::Size, "memory", "8 GB").is_err());
        assert!(validate(Kind::Size, "memory", "lots").is_err());
        assert!(validate(Kind::Choice(&["NAT", "mirrored"]), "networkingMode", "Mirrored").is_ok());
        assert!(validate(Kind::Bool, "firewall", "yes").is_err());
    }

    #[test]
    fn parses_wsl_version_and_utf16() {
        assert_eq!(parse_version("WSL version: 2.3.26.0\nKernel version: 5.15").as_deref(), Some("2.3.26.0"));
        assert_eq!(parse_version("WSL 版本： 2.4.11.0\n").as_deref(), Some("2.4.11.0"));
        let utf16: Vec<u8> = "WSL version: 2.0.9.0".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_output(&utf16), "WSL version: 2.0.9.0");
        assert_eq!(decode_output(b"plain"), "plain");
    }

    #[test]
    fn edits_wslconfig_sections() {
        let file = "# my settings\n[wsl2]\nmemory=4GB\n";
        let out = ini_set(file, Some("wsl2"), "processors", Some("4"), "=");
        assert_eq!(out, "# my settings\n[wsl2]\nmemory=4GB\nprocessors=4\n");
        let out = ini_set(&out, Some("experimental"), "sparseVhd", Some("true"), "=");
        assert!(out.ends_with("\n[experimental]\nsparseVhd=true\n"));
    }
}
