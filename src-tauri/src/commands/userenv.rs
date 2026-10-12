//! Environment variables.
//!
//! On Windows, user variables live in HKCU\Environment and can be edited here; machine
//! variables (HKLM\...\Session Manager\Environment) are shown read-only. After a change
//! Windows is notified (WM_SETTINGCHANGE) so programs started afterwards see it, and this
//! app's own environment is updated so the tools it runs use the new values.
//!
//! The registry is also the source of truth for "what will a new terminal see": PATH
//! lookups for tool detection use it, so a tool installed while the app is running is
//! found without restarting.

use serde::Serialize;
use std::ffi::OsString;

#[derive(Debug, Clone, Serialize)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
    /// REG_EXPAND_SZ: %VAR% references are expanded when the variable is used
    pub expand: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PathEntry {
    pub value: String,
    pub expanded: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnvState {
    pub user: Vec<EnvVar>,
    pub system: Vec<EnvVar>,
    pub user_path: Vec<PathEntry>,
    pub system_path: Vec<PathEntry>,
    pub backup_dir: String,
}

/// The value a newly started program would get for `name`.
pub fn effective_var(name: &str) -> Option<String> {
    #[cfg(windows)]
    let value = win::effective(name);
    #[cfg(not(windows))]
    let value = std::env::var(name).ok();
    value.filter(|v| !v.is_empty())
}

/// PATH as a newly started program would see it (falls back to this process's PATH).
pub fn current_path() -> Option<OsString> {
    #[cfg(windows)]
    if let Some(path) = win::effective("Path") {
        return Some(path.into());
    }
    std::env::var_os("PATH")
}

/// Set or remove a user environment variable. Windows only.
pub fn set_user_var(name: &str, value: Option<&str>) -> Result<(), String> {
    validate_name(name)?;
    if value.is_some_and(|v| v.contains('\0') || v.len() > 32_767) {
        return Err(format!("The value of {} is too long or contains invalid characters", name));
    }
    #[cfg(windows)]
    {
        backup()?;
        win::set_user(name, value.filter(|v| !v.is_empty()))?;
        win::sync_process(name);
        win::broadcast_change();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Environment variables can only be edited here on Windows".into())
    }
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 255 || name.contains(['=', '\0']) || name.trim() != name {
        Err(format!("\"{}\" is not a valid variable name", name))
    } else {
        Ok(())
    }
}

fn path_entries(value: &str) -> Vec<PathEntry> {
    value
        .split(';')
        .filter(|e| !e.trim().is_empty())
        .map(|entry| {
            let expanded = expand(entry);
            PathEntry { exists: std::path::Path::new(&expanded).is_dir(), value: entry.to_string(), expanded }
        })
        .collect()
}

fn expand(value: &str) -> String {
    #[cfg(windows)]
    {
        win::expand(value)
    }
    #[cfg(not(windows))]
    {
        value.to_string()
    }
}

fn backup_dir() -> Result<std::path::PathBuf, String> {
    Ok(dirs::home_dir().ok_or("Failed to get home directory")?.join(".ssh-at").join("env-backups"))
}

/// Snapshot the user variables before changing them; the newest 20 are kept.
#[cfg(windows)]
fn backup() -> Result<(), String> {
    let dir = backup_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let json = serde_json::to_string_pretty(&win::list(win::Scope::User)).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("user-env-{}.json", stamp)), json).map_err(|e| e.to_string())?;
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("user-env-")))
        .collect();
    files.sort();
    let excess = files.len().saturating_sub(20);
    for old in &files[..excess] {
        let _ = std::fs::remove_file(old);
    }
    Ok(())
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn env_state() -> Result<EnvState, String> {
    super::proc::blocking(|| {
        #[cfg(windows)]
        {
            let is_path = |v: &EnvVar| v.name.eq_ignore_ascii_case("path");
            let (user_path, user): (Vec<_>, Vec<_>) = win::list(win::Scope::User).into_iter().partition(is_path);
            let (system_path, system): (Vec<_>, Vec<_>) = win::list(win::Scope::System).into_iter().partition(is_path);
            Ok(EnvState {
                user,
                system,
                user_path: user_path.first().map(|v| path_entries(&v.value)).unwrap_or_default(),
                system_path: system_path.first().map(|v| path_entries(&v.value)).unwrap_or_default(),
                backup_dir: backup_dir()?.display().to_string(),
            })
        }
        #[cfg(not(windows))]
        {
            Err::<EnvState, String>("Environment variables can only be edited here on Windows".into())
        }
    })
    .await?
}

#[tauri::command]
pub async fn env_set_var(name: String, value: Option<String>) -> Result<(), String> {
    super::proc::blocking(move || {
        if name.eq_ignore_ascii_case("path") {
            return Err("Edit PATH with the PATH editor".to_string());
        }
        set_user_var(name.trim(), value.as_deref())
    })
    .await?
}

/// Replace the user PATH with `entries` (in order). Empty and duplicate entries are dropped.
#[tauri::command]
pub async fn env_set_user_path(entries: Vec<String>) -> Result<(), String> {
    super::proc::blocking(move || {
        let mut seen = std::collections::HashSet::new();
        let cleaned: Vec<String> = entries
            .iter()
            .map(|e| e.trim().trim_end_matches(['\\', '/']).to_string())
            .map(|e| if e.ends_with(':') { format!("{}\\", e) } else { e })
            .filter(|e| !e.is_empty() && seen.insert(e.to_lowercase()))
            .collect();
        if cleaned.iter().any(|e| e.contains(';') || e.contains('"')) {
            return Err("PATH entries cannot contain ; or \"".into());
        }
        set_user_var("Path", Some(&cleaned.join(";")))
    })
    .await?
}

/// Open Windows' own "Environment Variables" dialog.
#[tauri::command]
pub async fn env_open_dialog() -> Result<(), String> {
    #[cfg(windows)]
    {
        super::proc::command("rundll32.exe")
            .args(["sysdm.cpl,EditEnvironmentVariables"])
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Err("Only available on Windows".into())
    }
}

#[cfg(windows)]
pub(crate) mod win {
    use super::EnvVar;
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WRITE, REG_EXPAND_SZ, REG_SZ};
    use winreg::{RegKey, RegValue};

    const USER_KEY: &str = "Environment";
    const SYSTEM_KEY: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

    #[derive(Clone, Copy)]
    pub enum Scope {
        User,
        System,
    }

    fn open(scope: Scope, write: bool) -> std::io::Result<RegKey> {
        let flags = if write { KEY_READ | KEY_WRITE } else { KEY_READ };
        match scope {
            Scope::User => RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(USER_KEY, flags),
            Scope::System => RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey_with_flags(SYSTEM_KEY, flags),
        }
    }

    pub fn decode(value: &RegValue) -> Option<String> {
        if value.vtype != REG_SZ && value.vtype != REG_EXPAND_SZ {
            return None;
        }
        let wide: Vec<u16> = value.bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
        Some(String::from_utf16_lossy(&wide[..end]))
    }

    pub fn encode(text: &str, expand: bool) -> RegValue {
        RegValue {
            bytes: text.encode_utf16().chain(Some(0)).flat_map(u16::to_le_bytes).collect(),
            vtype: if expand { REG_EXPAND_SZ } else { REG_SZ },
        }
    }

    pub fn list(scope: Scope) -> Vec<EnvVar> {
        let Ok(key) = open(scope, false) else { return Vec::new() };
        let mut vars: Vec<EnvVar> = key
            .enum_values()
            .filter_map(Result::ok)
            .filter_map(|(name, raw)| {
                decode(&raw).map(|value| EnvVar { name, value, expand: raw.vtype == REG_EXPAND_SZ })
            })
            .collect();
        vars.sort_by_key(|v| v.name.to_lowercase());
        vars
    }

    fn get(scope: Scope, name: &str) -> Option<(String, bool)> {
        let raw = open(scope, false).ok()?.get_raw_value(name).ok()?;
        decode(&raw).map(|v| (v, raw.vtype == REG_EXPAND_SZ))
    }

    pub fn set_user(name: &str, value: Option<&str>) -> Result<(), String> {
        let key = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(USER_KEY)
            .map_err(|e| format!("Failed to open the user environment: {}", e))?
            .0;
        match value {
            Some(v) => {
                // Keep REG_EXPAND_SZ when the variable already had it or references %VARS%
                let expand = get(Scope::User, name).is_some_and(|(_, e)| e) || v.contains('%');
                key.set_raw_value(name, &encode(v, expand))
            }
            None => match key.delete_value(name) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                r => r,
            },
        }
        .map_err(|e| format!("Failed to save {}: {}", name, e))
    }

    pub fn expand(value: &str) -> String {
        use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
        if !value.contains('%') {
            return value.to_string();
        }
        let src: Vec<u16> = value.encode_utf16().chain(Some(0)).collect();
        let mut buf = vec![0u16; 4096];
        loop {
            let n = unsafe { ExpandEnvironmentStringsW(src.as_ptr(), buf.as_mut_ptr(), buf.len() as u32) } as usize;
            if n == 0 {
                return value.to_string();
            }
            if n <= buf.len() {
                return String::from_utf16_lossy(&buf[..n - 1]);
            }
            buf.resize(n, 0);
        }
    }

    /// What a new process gets: the user value wins, except PATH which is system;user.
    pub fn effective(name: &str) -> Option<String> {
        let user = get(Scope::User, name).map(|(v, _)| expand(&v));
        let system = get(Scope::System, name).map(|(v, _)| expand(&v));
        if name.eq_ignore_ascii_case("path") {
            let joined: Vec<String> = system.into_iter().chain(user).filter(|p| !p.is_empty()).collect();
            return (!joined.is_empty()).then(|| joined.join(";"));
        }
        user.or(system)
    }

    /// Mirror a change into this process so tools started by the app see it.
    pub fn sync_process(name: &str) {
        match effective(name) {
            Some(v) => std::env::set_var(name, v),
            None => std::env::remove_var(name),
        }
    }

    /// Tell Explorer and other top-level windows that the environment changed. Runs on a
    /// background thread: a hung window can hold a broadcast for seconds.
    pub fn broadcast_change() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
        };
        std::thread::spawn(|| {
            let param: Vec<u16> = "Environment".encode_utf16().chain(Some(0)).collect();
            let mut result = 0usize;
            unsafe {
                SendMessageTimeoutW(
                    HWND_BROADCAST,
                    WM_SETTINGCHANGE,
                    0,
                    param.as_ptr() as isize,
                    SMTO_ABORTIFHUNG,
                    3000,
                    &mut result,
                );
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_names() {
        assert!(validate_name("HTTP_PROXY").is_ok());
        assert!(validate_name("A=B").is_err());
        assert!(validate_name("").is_err());
        assert!(validate_name(" X").is_err());
    }

    #[test]
    fn splits_path_entries() {
        let entries = path_entries(r"C:\Windows;;C:\does-not-exist-sshui;");
        assert_eq!(entries.len(), 2);
        assert!(!entries[1].exists);
    }

    #[cfg(windows)]
    #[test]
    fn registry_strings_round_trip() {
        let raw = win::encode("%USERPROFILE%\\bin;中文", true);
        assert_eq!(win::decode(&raw).as_deref(), Some("%USERPROFILE%\\bin;中文"));
        assert!(!win::expand("%USERPROFILE%").contains('%'));
        assert_eq!(win::expand("plain"), "plain");
    }
}
