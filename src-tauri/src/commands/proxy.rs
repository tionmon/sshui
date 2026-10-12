//! Proxy profiles: one switch that sets (or clears) the proxy for git, npm, pip, Cargo,
//! the user environment variables and the Windows system proxy at once.
//!
//! Profiles live in ~/.ssh-at/proxy-profiles.json. Applying one only touches the
//! targets the user included and that are installed; each target reports its own
//! result, so one failure doesn't stop the rest.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

use super::devtools::{find_in_path, ini_get, ini_read, ini_set, npm_bin, npmrc_path, pip_config_path, python_bin, read_npmrc, validate_url, write_file};
use super::proc::blocking;
use super::{agents, github, rust, userenv};

pub const STATE_CHANGED_EVENT: &str = "proxy-state-changed";
/// The built-in "no proxy" profile
pub const DIRECT_ID: &str = "direct";

const TARGETS: [&str; 7] = ["git", "npm", "pip", "cargo", "claude", "env", "system"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyProfile {
    pub id: String,
    pub name: String,
    /// http://host:port, https://… or socks5(h)://…
    pub url: String,
    /// Comma-separated hosts that bypass the proxy
    #[serde(default)]
    pub no_proxy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Store {
    profiles: Vec<ProxyProfile>,
    active_id: Option<String>,
    /// Targets included when a profile is applied
    targets: Vec<String>,
}

impl Default for Store {
    fn default() -> Self {
        Store { profiles: Vec::new(), active_id: None, targets: TARGETS.iter().map(|t| t.to_string()).collect() }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetStatus {
    pub id: String,
    /// The tool is installed (or the platform supports this target)
    pub available: bool,
    pub included: bool,
    /// The proxy currently configured there
    pub current: Option<String>,
    pub location: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyState {
    pub profiles: Vec<ProxyProfile>,
    pub active_id: Option<String>,
    pub targets: Vec<TargetStatus>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyResult {
    pub target: String,
    pub ok: bool,
    pub message: String,
}

fn store_path() -> Result<PathBuf, String> {
    let dir = dirs::home_dir().ok_or("Failed to get home directory")?.join(".ssh-at");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("proxy-profiles.json"))
}

fn load_store() -> Result<Store, String> {
    match fs::read_to_string(store_path()?) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Failed to read proxy profiles: {}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(e) => Err(e.to_string()),
    }
}

fn save_store(store: &Store) -> Result<(), String> {
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    write_file(&store_path()?, &json)
}

fn validate_profile(name: &str, url: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("The profile needs a name".into());
    }
    validate_url(url, &["http", "https", "socks5", "socks5h"])?;
    github::proxy_address(url).map(|_| ())
}

// ── Targets ───────────────────────────────────────────────────────────────────

fn available(target: &str) -> bool {
    match target {
        "git" => find_in_path(&["git"]).is_some(),
        "npm" => npm_bin().is_some(),
        "pip" => python_bin().is_some(),
        "cargo" => rust::cargo_bin().is_some(),
        "claude" => agents::claude_bin().is_some(),
        "env" | "system" => cfg!(windows),
        _ => false,
    }
}

fn location(target: &str) -> String {
    let path = |p: Result<PathBuf, String>| p.map(|p| p.display().to_string()).unwrap_or_default();
    match target {
        "git" => "git config --global http(s).proxy".into(),
        "npm" => path(npmrc_path()),
        "pip" => path(pip_config_path()),
        "cargo" => "~/.cargo/config.toml [http] proxy".into(),
        "claude" => "~/.claude/settings.json env".into(),
        "env" => "HTTP_PROXY, HTTPS_PROXY, NO_PROXY".into(),
        "system" => "Windows Settings → Network → Proxy".into(),
        _ => String::new(),
    }
}

fn current(target: &str) -> Option<String> {
    match target {
        "git" => github::git_config("https.proxy").or_else(|| github::git_config("http.proxy")),
        "npm" => {
            let entries = ini_read(&read_npmrc().ok()?.1, None);
            ini_get(&entries, "https-proxy").or_else(|| ini_get(&entries, "proxy"))
        }
        "pip" => {
            let content = fs::read_to_string(pip_config_path().ok()?).ok()?;
            ini_get(&ini_read(&content, Some("global")), "proxy")
        }
        "cargo" => rust::cargo_proxy(),
        "claude" => agents::claude_proxy(),
        "env" => userenv::effective_var("HTTPS_PROXY").or_else(|| userenv::effective_var("HTTP_PROXY")),
        #[cfg(windows)]
        "system" => sysproxy::current(),
        _ => None,
    }
}

/// Point one target at `profile`, or clear its proxy with `None`.
fn apply_target(target: &str, profile: Option<&ProxyProfile>) -> Result<(), String> {
    let url = profile.map(|p| p.url.as_str());
    let no_proxy = profile.map(|p| p.no_proxy.trim()).filter(|n| !n.is_empty());
    match target {
        "git" => {
            github::git_set("http.proxy", url)?;
            github::git_set("https.proxy", url)
        }
        "npm" => {
            let (path, mut content) = read_npmrc()?;
            for key in ["proxy", "https-proxy"] {
                content = ini_set(&content, None, key, url, "=");
            }
            content = ini_set(&content, None, "noproxy", no_proxy, "=");
            write_file(&path, &content)
        }
        "pip" => {
            let path = pip_config_path()?;
            let content = fs::read_to_string(&path).unwrap_or_default();
            write_file(&path, &ini_set(&content, Some("global"), "proxy", url, " = "))
        }
        "cargo" => rust::set_cargo_proxy(url),
        "claude" => agents::set_claude_proxy(url, no_proxy),
        "env" => {
            userenv::set_user_var("HTTP_PROXY", url)?;
            userenv::set_user_var("HTTPS_PROXY", url)?;
            userenv::set_user_var("NO_PROXY", no_proxy)
        }
        #[cfg(windows)]
        "system" => match profile {
            Some(p) => sysproxy::set(Some((&p.url, &p.no_proxy))),
            None => sysproxy::set(None),
        },
        _ => Err("This target isn't supported on this system".into()),
    }
}

fn state(store: &Store) -> ProxyState {
    let targets = TARGETS
        .iter()
        .filter(|t| cfg!(windows) || !["env", "system"].contains(t))
        .map(|&t| {
            let available = available(t);
            TargetStatus {
                id: t.to_string(),
                available,
                included: store.targets.iter().any(|x| x == t),
                // Only read what is installed
                current: if available { current(t) } else { None },
                location: location(t),
            }
        })
        .collect();
    ProxyState { profiles: store.profiles.clone(), active_id: store.active_id.clone(), targets }
}

pub fn load_state() -> Result<ProxyState, String> {
    Ok(state(&load_store()?))
}

/// Apply a profile (or `DIRECT_ID`) to every included, installed target.
pub fn apply_blocking(id: &str) -> Result<Vec<ApplyResult>, String> {
    let mut store = load_store()?;
    let profile = if id == DIRECT_ID {
        None
    } else {
        Some(store.profiles.iter().find(|p| p.id == id).cloned().ok_or("This proxy profile no longer exists")?)
    };
    let results: Vec<ApplyResult> = TARGETS
        .iter()
        .filter(|t| store.targets.iter().any(|x| x == *t))
        .filter(|t| available(t))
        .map(|&t| match apply_target(t, profile.as_ref()) {
            Ok(()) => ApplyResult { target: t.to_string(), ok: true, message: String::new() },
            Err(e) => ApplyResult { target: t.to_string(), ok: false, message: e },
        })
        .collect();
    store.active_id = Some(id.to_string());
    save_store(&store)?;
    Ok(results)
}

fn notify(app: &AppHandle) {
    crate::tray::refresh_menu(app);
    let _ = app.emit(STATE_CHANGED_EVENT, ());
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn proxy_state() -> Result<ProxyState, String> {
    blocking(load_state).await?
}

#[tauri::command]
pub async fn proxy_save_profile(
    app: AppHandle,
    id: Option<String>,
    name: String,
    url: String,
    no_proxy: String,
) -> Result<ProxyProfile, String> {
    let saved = blocking(move || {
        let (name, url) = (name.trim().to_string(), url.trim().to_string());
        validate_profile(&name, &url)?;
        let no_proxy = no_proxy.split([',', ';', ' ', '\n']).map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(",");
        let mut store = load_store()?;
        if store.profiles.iter().any(|p| p.name.eq_ignore_ascii_case(&name) && Some(&p.id) != id.as_ref()) {
            return Err(format!("A profile named \"{}\" already exists", name));
        }
        let profile = match id.and_then(|id| store.profiles.iter_mut().find(|p| p.id == id)) {
            Some(existing) => {
                existing.name = name;
                existing.url = url;
                existing.no_proxy = no_proxy;
                existing.clone()
            }
            None => {
                let id = format!(
                    "p{:x}",
                    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
                );
                let profile = ProxyProfile { id, name, url, no_proxy };
                store.profiles.push(profile.clone());
                profile
            }
        };
        save_store(&store)?;
        Ok::<_, String>(profile)
    })
    .await??;
    notify(&app);
    Ok(saved)
}

#[tauri::command]
pub async fn proxy_delete_profile(app: AppHandle, id: String) -> Result<(), String> {
    blocking(move || {
        let mut store = load_store()?;
        store.profiles.retain(|p| p.id != id);
        if store.active_id.as_deref() == Some(id.as_str()) {
            store.active_id = None;
        }
        save_store(&store)
    })
    .await??;
    notify(&app);
    Ok(())
}

#[tauri::command]
pub async fn proxy_set_targets(targets: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let mut store = load_store()?;
        store.targets = TARGETS.iter().filter(|t| targets.iter().any(|x| x == *t)).map(|t| t.to_string()).collect();
        save_store(&store)
    })
    .await?
}

#[tauri::command]
pub async fn proxy_apply(app: AppHandle, id: String) -> Result<Vec<ApplyResult>, String> {
    let results = blocking(move || apply_blocking(&id)).await??;
    notify(&app);
    Ok(results)
}

// ── Windows system proxy ──────────────────────────────────────────────────────

#[cfg(windows)]
mod sysproxy {
    use std::mem::size_of;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Networking::WinInet::{
        InternetQueryOptionW, InternetSetOptionW, INTERNET_OPTION_PER_CONNECTION_OPTION, INTERNET_OPTION_REFRESH,
        INTERNET_OPTION_SETTINGS_CHANGED, INTERNET_PER_CONN_FLAGS, INTERNET_PER_CONN_FLAGS_UI,
        INTERNET_PER_CONN_OPTIONW, INTERNET_PER_CONN_OPTIONW_0, INTERNET_PER_CONN_OPTION_LISTW,
        INTERNET_PER_CONN_PROXY_BYPASS, INTERNET_PER_CONN_PROXY_SERVER, PROXY_TYPE_DIRECT, PROXY_TYPE_PROXY,
    };
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    /// The enabled manual proxy, as a URL ("socks5://…" for a SOCKS-only setting).
    pub fn current() -> Option<String> {
        let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey(KEY).ok()?;
        let enabled: u32 = key.get_value("ProxyEnable").ok()?;
        let server: String = key.get_value("ProxyServer").ok()?;
        (enabled == 1 && !server.trim().is_empty()).then(|| to_url(&server))
    }

    /// "127.0.0.1:7890" → "http://127.0.0.1:7890"; "http=a:1;https=b:2" → "http://b:2"
    pub fn to_url(server: &str) -> String {
        if !server.contains('=') {
            return if server.contains("://") { server.to_string() } else { format!("http://{}", server) };
        }
        let part = |name: &str| {
            server.split(';').find_map(|p| p.split_once('=').filter(|(k, _)| k.trim().eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_string()))
        };
        part("https")
            .or_else(|| part("http"))
            .map(|v| format!("http://{}", v))
            .or_else(|| part("socks").map(|v| format!("socks5://{}", v)))
            .unwrap_or_else(|| server.to_string())
    }

    /// WinINet's form of a proxy URL: "host:port", or "socks=host:port".
    pub fn server_string(url: &str) -> String {
        let rest = url.split("://").nth(1).unwrap_or(url);
        let host_port = rest.split('/').next().unwrap_or(rest);
        let host_port = host_port.rsplit('@').next().unwrap_or(host_port);
        if url.starts_with("socks") {
            format!("socks={}", host_port)
        } else {
            host_port.to_string()
        }
    }

    /// "localhost,.corp.com" → "localhost;*.corp.com;<local>"
    pub fn bypass_string(no_proxy: &str) -> String {
        let mut parts: Vec<String> = no_proxy
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| if s.starts_with('.') { format!("*{}", s) } else { s.to_string() })
            .collect();
        parts.push("<local>".into());
        parts.join(";")
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    fn query_flags() -> Option<u32> {
        for option in [INTERNET_PER_CONN_FLAGS_UI, INTERNET_PER_CONN_FLAGS] {
            let mut opt = INTERNET_PER_CONN_OPTIONW { dwOption: option, Value: INTERNET_PER_CONN_OPTIONW_0 { dwValue: 0 } };
            let mut list = INTERNET_PER_CONN_OPTION_LISTW {
                dwSize: size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32,
                pszConnection: null_mut(),
                dwOptionCount: 1,
                dwOptionError: 0,
                pOptions: &mut opt,
            };
            let mut size = list.dwSize;
            let ok = unsafe {
                InternetQueryOptionW(null(), INTERNET_OPTION_PER_CONNECTION_OPTION, &mut list as *mut _ as *mut _, &mut size)
            };
            if ok != 0 {
                return Some(unsafe { opt.Value.dwValue });
            }
        }
        None
    }

    /// Turn the manual proxy on with `(url, no_proxy)`, or off with `None`. Automatic
    /// detection and setup-script settings are left as they were.
    pub fn set(proxy: Option<(&str, &str)>) -> Result<(), String> {
        let flags = query_flags().unwrap_or(PROXY_TYPE_DIRECT);
        let flags = match proxy {
            Some(_) => flags | PROXY_TYPE_PROXY | PROXY_TYPE_DIRECT,
            None => (flags & !PROXY_TYPE_PROXY) | PROXY_TYPE_DIRECT,
        };
        let mut server = wide(&proxy.map(|(u, _)| server_string(u)).unwrap_or_default());
        let mut bypass = wide(&proxy.map(|(_, n)| bypass_string(n)).unwrap_or_default());

        let mut options = vec![INTERNET_PER_CONN_OPTIONW {
            dwOption: INTERNET_PER_CONN_FLAGS_UI,
            Value: INTERNET_PER_CONN_OPTIONW_0 { dwValue: flags },
        }];
        // Turning the proxy off keeps the saved address, like the Settings app does
        if proxy.is_some() {
            options.push(INTERNET_PER_CONN_OPTIONW {
                dwOption: INTERNET_PER_CONN_PROXY_SERVER,
                Value: INTERNET_PER_CONN_OPTIONW_0 { pszValue: server.as_mut_ptr() },
            });
            options.push(INTERNET_PER_CONN_OPTIONW {
                dwOption: INTERNET_PER_CONN_PROXY_BYPASS,
                Value: INTERNET_PER_CONN_OPTIONW_0 { pszValue: bypass.as_mut_ptr() },
            });
        }
        let mut set_with = |flag_option: u32| {
            options[0].dwOption = flag_option;
            let list = INTERNET_PER_CONN_OPTION_LISTW {
                dwSize: size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32,
                pszConnection: null_mut(),
                dwOptionCount: options.len() as u32,
                dwOptionError: 0,
                pOptions: options.as_mut_ptr(),
            };
            unsafe {
                InternetSetOptionW(
                    null(),
                    INTERNET_OPTION_PER_CONNECTION_OPTION,
                    &list as *const _ as *const _,
                    size_of::<INTERNET_PER_CONN_OPTION_LISTW>() as u32,
                ) != 0
            }
        };
        if !set_with(INTERNET_PER_CONN_FLAGS_UI) && !set_with(INTERNET_PER_CONN_FLAGS) {
            return Err(format!("Windows refused the proxy settings ({})", std::io::Error::last_os_error()));
        }
        unsafe {
            InternetSetOptionW(null(), INTERNET_OPTION_SETTINGS_CHANGED, null(), 0);
            InternetSetOptionW(null(), INTERNET_OPTION_REFRESH, null(), 0);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_profiles() {
        assert!(validate_profile("Home", "http://127.0.0.1:7890").is_ok());
        assert!(validate_profile("Socks", "socks5://127.0.0.1:1080").is_ok());
        assert!(validate_profile("", "http://127.0.0.1:7890").is_err());
        assert!(validate_profile("Bad", "127.0.0.1:7890").is_err());
        assert!(validate_profile("Bad port", "http://127.0.0.1:99999").is_err());
    }

    #[test]
    fn store_defaults_include_every_target() {
        let store: Store = serde_json::from_str(r#"{"profiles":[],"active_id":null,"targets":["git"]}"#).unwrap();
        assert_eq!(store.targets, vec!["git"]);
        assert_eq!(Store::default().targets.len(), TARGETS.len());
    }

    #[cfg(windows)]
    #[test]
    fn converts_windows_proxy_strings() {
        use sysproxy::*;
        assert_eq!(server_string("http://user:pw@127.0.0.1:7890/"), "127.0.0.1:7890");
        assert_eq!(server_string("socks5://127.0.0.1:1080"), "socks=127.0.0.1:1080");
        assert_eq!(bypass_string("localhost, .corp.com"), "localhost;*.corp.com;<local>");
        assert_eq!(to_url("127.0.0.1:7890"), "http://127.0.0.1:7890");
        assert_eq!(to_url("http=a:1;https=b:2"), "http://b:2");
        assert_eq!(to_url("socks=c:3"), "socks5://c:3");
    }
}
