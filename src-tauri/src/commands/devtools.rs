//! npm, Docker and pip configuration.
//!
//! Detection only scans PATH — no process is started — so an uninstalled tool costs
//! nothing. Settings are read from and written to each tool's own config file
//! (~/.npmrc, pip.ini/pip.conf, ~/.docker/*.json). A tool's binary only runs for its
//! version string or an explicit action such as a test or a registry login.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::proc::{blocking, command, error_line, run_with_input, run_with_timeout, stdout_text};

// ── Detection ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ToolPresence {
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DevTools {
    pub npm: ToolPresence,
    pub docker: ToolPresence,
    pub python: ToolPresence,
}

#[cfg(windows)]
fn executable_names(name: &str) -> Vec<String> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    exts.split(';')
        .filter(|e| !e.is_empty())
        .map(|e| format!("{}{}", name, e.to_lowercase()))
        .collect()
}

#[cfg(not(windows))]
fn executable_names(name: &str) -> Vec<String> {
    vec![name.to_string()]
}

#[cfg(windows)]
fn is_store_alias(path: &Path) -> bool {
    // App execution aliases (e.g. the Microsoft Store "python" stub) live here
    path.to_string_lossy().to_lowercase().contains("\\microsoft\\windowsapps\\")
}

#[cfg(not(windows))]
fn is_store_alias(_: &Path) -> bool {
    false
}

/// First match for any of `names` on PATH, preferring real installs over Windows
/// app execution aliases.
fn find_in_path(names: &[&str]) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    let mut alias = None;
    for name in names {
        for dir in &dirs {
            for file in executable_names(name) {
                let candidate = dir.join(&file);
                if candidate.is_file() {
                    if is_store_alias(&candidate) {
                        alias.get_or_insert(candidate);
                    } else {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    alias
}

fn presence(path: Option<PathBuf>) -> ToolPresence {
    ToolPresence { installed: path.is_some(), path: path.map(|p| p.display().to_string()) }
}

fn npm_bin() -> Option<PathBuf> {
    find_in_path(&["npm"])
}

fn docker_bin() -> Option<PathBuf> {
    find_in_path(&["docker"])
}

fn python_bin() -> Option<PathBuf> {
    find_in_path(&["python", "python3", "py"])
}

#[tauri::command]
pub async fn detect_dev_tools() -> Result<DevTools, String> {
    blocking(|| DevTools {
        npm: presence(npm_bin()),
        docker: presence(docker_bin()),
        python: presence(python_bin()),
    })
    .await
}

fn tool_version(program: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = command(program);
    cmd.args(args);
    run_with_timeout(cmd, Duration::from_secs(15))
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| stdout_text(&o))
        .and_then(|s| s.lines().next().map(str::to_string))
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())
}

fn write_file(path: &Path, content: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(path, content).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!("No permission to write {}", path.display())
        } else {
            format!("Failed to write {}: {}", path.display(), e)
        }
    })
}

fn env_overrides(names: &[&str]) -> BTreeMap<String, String> {
    names
        .iter()
        .filter_map(|name| {
            std::env::var(name)
                .or_else(|_| std::env::var(name.to_uppercase()))
                .ok()
                .filter(|v| !v.is_empty())
                .map(|v| (name.to_string(), v))
        })
        .collect()
}

fn validate_url(value: &str, schemes: &[&str]) -> Result<(), String> {
    let ok = schemes.iter().any(|s| value.starts_with(&format!("{}://", s)))
        && value.split("://").nth(1).is_some_and(|rest| !rest.is_empty() && !rest.contains(char::is_whitespace));
    if ok {
        Ok(())
    } else {
        Err(format!("\"{}\" is not a valid {} URL", value, schemes.join("/")))
    }
}

// ── INI editing (npmrc has no sections; pip uses [global]) ───────────────────

fn is_comment(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with('#') || t.starts_with(';')
}

/// The key of a `key = value` line. pip (configparser) also accepts `key: value`;
/// npmrc keys such as `//registry/:_authToken` contain ':' so only '=' separates them.
fn parse_key(line: &str, allow_colon: bool) -> Option<&str> {
    if line.starts_with(char::is_whitespace) || is_comment(line) {
        return None;
    }
    let end = if allow_colon { line.find(['=', ':']) } else { line.find('=') }?;
    let key = line[..end].trim();
    (!key.is_empty()).then_some(key)
}

fn section_name(line: &str) -> Option<&str> {
    let t = line.trim();
    t.strip_prefix('[')?.strip_suffix(']').map(str::trim)
}

/// Read `key = value` pairs of one section (`None` = before any section). Indented
/// continuation lines are joined with '\n'. Keys keep their original spelling.
fn ini_read(content: &str, section: Option<&str>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut current: Option<String> = None;
    let mut last_in_section = false;
    for line in content.lines() {
        if let Some(name) = section_name(line) {
            current = Some(name.to_lowercase());
            last_in_section = false;
            continue;
        }
        let in_section = current.as_deref() == section.map(str::to_lowercase).as_deref();
        if !in_section || line.trim().is_empty() || is_comment(line) {
            last_in_section = in_section && !line.trim().is_empty() && last_in_section;
            continue;
        }
        if line.starts_with(char::is_whitespace) && last_in_section {
            if let Some((_, value)) = out.last_mut() {
                value.push('\n');
                value.push_str(line.trim());
            }
            continue;
        }
        if let Some(key) = parse_key(line, section.is_some()) {
            let value = line[line.find(key).unwrap() + key.len()..].trim_start();
            let value = value.strip_prefix(['=', ':']).unwrap_or(value).trim();
            out.push((key.to_string(), value.to_string()));
            last_in_section = true;
        }
    }
    out
}

fn ini_get(entries: &[(String, String)], key: &str) -> Option<String> {
    entries
        .iter()
        .rev()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.clone())
        .filter(|v| !v.is_empty())
}

/// Set (or remove, with `None`) a key in one section, keeping every other line,
/// comment and the key's position. Duplicates and continuation lines are removed.
fn ini_set(content: &str, section: Option<&str>, key: &str, value: Option<&str>, sep: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 2);
    let mut current: Option<String> = None;
    let target = section.map(str::to_lowercase);
    let mut written = false;
    let mut skipping_continuation = false;
    let mut section_end: Option<usize> = if target.is_none() { Some(0) } else { None };
    let mut section_found = target.is_none();

    for line in &lines {
        if let Some(name) = section_name(line) {
            current = Some(name.to_lowercase());
            skipping_continuation = false;
            out.push(line.to_string());
            if current == target {
                section_found = true;
                section_end = Some(out.len());
            }
            continue;
        }
        let in_section = current == target;
        if skipping_continuation && line.starts_with(char::is_whitespace) && !line.trim().is_empty() {
            continue;
        }
        skipping_continuation = false;
        if in_section && parse_key(line, section.is_some()).is_some_and(|k| k.eq_ignore_ascii_case(key)) {
            skipping_continuation = true;
            if let (Some(v), false) = (value, written) {
                out.push(format!("{}{}{}", key, sep, v));
                written = true;
            }
            section_end = Some(out.len());
            continue;
        }
        out.push(line.to_string());
        if in_section && !line.trim().is_empty() {
            section_end = Some(out.len());
        }
    }

    if let (Some(v), false) = (value, written) {
        let new_line = format!("{}{}{}", key, sep, v);
        match (section_found, section_end) {
            (true, Some(end)) if target.is_some() => out.insert(end, new_line),
            (true, _) => out.push(new_line),
            _ => {
                if out.last().is_some_and(|l| !l.trim().is_empty()) {
                    out.push(String::new());
                }
                out.push(format!("[{}]", section.unwrap_or("global")));
                out.push(new_line);
            }
        }
    }
    let mut text = out.join("\n");
    if !text.is_empty() {
        text.push('\n');
    }
    text
}

fn mask(secret: &str) -> String {
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() <= 12 {
        "••••••".to_string()
    } else {
        format!("{}…{}", chars[..4].iter().collect::<String>(), chars[chars.len() - 4..].iter().collect::<String>())
    }
}

// ── npm ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct NpmAuth {
    /// The registry prefix the credential applies to, e.g. "//registry.npmjs.org/"
    pub registry: String,
    /// "token", "basic" (_auth), "password" or "username"
    pub kind: String,
    pub masked: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NpmScope {
    pub scope: String,
    pub registry: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NpmInfo {
    pub version: Option<String>,
    pub config_path: String,
    pub config_exists: bool,
    pub registry: Option<String>,
    pub proxy: Option<String>,
    pub https_proxy: Option<String>,
    pub noproxy: Option<String>,
    pub strict_ssl: Option<String>,
    pub scopes: Vec<NpmScope>,
    pub auths: Vec<NpmAuth>,
    /// Environment variables that override the file (npm_config_*)
    pub env_overrides: BTreeMap<String, String>,
}

fn npmrc_path() -> Result<PathBuf, String> {
    match std::env::var_os("NPM_CONFIG_USERCONFIG").or_else(|| std::env::var_os("npm_config_userconfig")) {
        Some(p) if !p.is_empty() => Ok(PathBuf::from(p)),
        _ => Ok(home()?.join(".npmrc")),
    }
}

fn npm_auths(entries: &[(String, String)]) -> Vec<NpmAuth> {
    const KINDS: [(&str, &str); 4] =
        [(":_authToken", "token"), (":_auth", "basic"), (":_password", "password"), (":username", "username")];
    let mut out = Vec::new();
    for (key, value) in entries {
        let found = KINDS.iter().find_map(|(suffix, kind)| {
            if key == &suffix[1..] {
                Some(("(default registry)".to_string(), *kind))
            } else {
                key.strip_suffix(suffix).filter(|r| r.starts_with("//")).map(|r| (r.to_string(), *kind))
            }
        });
        if let Some((registry, kind)) = found {
            let masked = if kind == "username" { value.clone() } else { mask(value) };
            out.push(NpmAuth { registry, kind: kind.to_string(), masked });
        }
    }
    out
}

fn read_npmrc() -> Result<(PathBuf, String), String> {
    let path = npmrc_path()?;
    let content = fs::read_to_string(&path).unwrap_or_default();
    Ok((path, content))
}

#[tauri::command]
pub async fn npm_info() -> Result<NpmInfo, String> {
    blocking(|| {
        let bin = npm_bin().ok_or("npm is not installed")?;
        let (path, content) = read_npmrc()?;
        let entries = ini_read(&content, None);
        let scopes = entries
            .iter()
            .filter_map(|(k, v)| {
                k.strip_suffix(":registry")
                    .filter(|s| s.starts_with('@'))
                    .map(|s| NpmScope { scope: s.to_string(), registry: v.clone() })
            })
            .collect();
        Ok(NpmInfo {
            version: tool_version(&bin, &["--version"]),
            config_exists: path.exists(),
            config_path: path.display().to_string(),
            registry: ini_get(&entries, "registry"),
            proxy: ini_get(&entries, "proxy"),
            https_proxy: ini_get(&entries, "https-proxy"),
            noproxy: ini_get(&entries, "noproxy"),
            strict_ssl: ini_get(&entries, "strict-ssl"),
            scopes,
            auths: npm_auths(&entries),
            env_overrides: env_overrides(&[
                "npm_config_registry",
                "npm_config_proxy",
                "npm_config_https_proxy",
                "npm_config_noproxy",
            ]),
        })
    })
    .await?
}

fn is_scope_registry_key(key: &str) -> bool {
    key.strip_prefix('@')
        .and_then(|k| k.strip_suffix(":registry"))
        .is_some_and(|scope| {
            !scope.is_empty() && scope.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        })
}

/// Set or remove one of the supported ~/.npmrc keys.
#[tauri::command]
pub async fn npm_set_config(key: String, value: Option<String>) -> Result<(), String> {
    blocking(move || {
        let value = value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        match key.as_str() {
            "registry" | "proxy" | "https-proxy" => {
                if let Some(v) = &value {
                    validate_url(v, &["http", "https"])?;
                }
            }
            "noproxy" => {}
            "strict-ssl" => {
                if value.as_deref().is_some_and(|v| v != "true" && v != "false") {
                    return Err("strict-ssl must be true or false".into());
                }
            }
            k if is_scope_registry_key(k) => {
                if let Some(v) = &value {
                    validate_url(v, &["http", "https"])?;
                }
            }
            // Legacy credentials for the default registry may only be removed
            "_authToken" | "_auth" | "_password" | "username" if value.is_none() => {}
            _ => return Err(format!("Unsupported npm setting \"{}\"", key)),
        }
        let (path, content) = read_npmrc()?;
        write_file(&path, &ini_set(&content, None, &key, value.as_deref(), "="))
    })
    .await?
}

/// "https://registry.npmjs.org" → "//registry.npmjs.org/" (npm's credential key prefix).
fn npm_registry_prefix(url: &str) -> Result<String, String> {
    validate_url(url, &["http", "https"])?;
    let rest = url.split("://").nth(1).unwrap_or_default();
    Ok(format!("//{}/", rest.trim_end_matches('/')))
}

/// Store (or remove) an auth token for a registry: `//host/path/:_authToken=...`.
#[tauri::command]
pub async fn npm_set_token(registry: String, token: Option<String>) -> Result<(), String> {
    blocking(move || {
        let prefix = npm_registry_prefix(registry.trim())?;
        let token = token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        if token.as_deref().is_some_and(|t| t.contains(char::is_whitespace)) {
            return Err("The token must not contain spaces".into());
        }
        let (path, content) = read_npmrc()?;
        let mut updated = ini_set(&content, None, &format!("{}:_authToken", prefix), token.as_deref(), "=");
        if token.is_none() {
            // Signing out removes every credential stored for this registry
            for suffix in [":_auth", ":_password", ":username"] {
                updated = ini_set(&updated, None, &format!("{}{}", prefix, suffix), None, "=");
            }
        }
        write_file(&path, &updated)
    })
    .await?
}

/// `npm whoami` against a registry: which account the stored credentials belong to.
#[tauri::command]
pub async fn npm_whoami(registry: Option<String>) -> Result<String, String> {
    blocking(move || {
        let bin = npm_bin().ok_or("npm is not installed")?;
        let mut cmd = command(bin);
        cmd.arg("whoami");
        if let Some(r) = registry.filter(|r| !r.trim().is_empty()) {
            validate_url(r.trim(), &["http", "https"])?;
            cmd.arg("--registry").arg(r.trim());
        }
        let output = run_with_timeout(cmd, Duration::from_secs(20))?;
        if output.status.success() {
            stdout_text(&output).ok_or_else(|| "npm returned no user".to_string())
        } else {
            Err(error_line(&output).trim_start_matches("npm error ").to_string())
        }
    })
    .await?
}

// ── pip ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct PipInfo {
    pub python_path: String,
    /// `pip --version` output, e.g. "pip 26.1.2 from … (python 3.14)"; None if pip is missing
    pub pip_version: Option<String>,
    pub config_path: String,
    pub config_exists: bool,
    pub index_url: Option<String>,
    pub extra_index_urls: Vec<String>,
    pub trusted_hosts: Vec<String>,
    pub proxy: Option<String>,
    pub timeout: Option<String>,
    /// PIP_* environment variables, which override the file
    pub env_overrides: BTreeMap<String, String>,
}

/// The per-user pip config file. An existing file wins; otherwise the current
/// recommended location is used.
fn pip_config_path() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("PIP_CONFIG_FILE").filter(|p| !p.is_empty() && p != "os.devnull") {
        return Ok(PathBuf::from(p));
    }
    let home = home()?;
    #[cfg(windows)]
    let candidates = vec![
        dirs::config_dir().map(|d| d.join("pip").join("pip.ini")), // %APPDATA%\pip\pip.ini
        Some(home.join("pip").join("pip.ini")),                    // legacy
    ];
    #[cfg(target_os = "macos")]
    let candidates = vec![
        Some(home.join("Library/Application Support/pip/pip.conf")),
        Some(home.join(".config/pip/pip.conf")),
        Some(home.join(".pip/pip.conf")),
    ];
    #[cfg(all(unix, not(target_os = "macos")))]
    let candidates = vec![
        Some(
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
                .join("pip/pip.conf"),
        ),
        Some(home.join(".pip/pip.conf")),
    ];
    let candidates: Vec<PathBuf> = candidates.into_iter().flatten().collect();
    Ok(candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| candidates[0].clone()))
}

fn split_list(value: Option<String>) -> Vec<String> {
    value
        .map(|v| v.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn pip_info() -> Result<PipInfo, String> {
    blocking(|| {
        let python = python_bin().ok_or("Python is not installed")?;
        let path = pip_config_path()?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        let entries = ini_read(&content, Some("global"));
        Ok(PipInfo {
            pip_version: tool_version(&python, &["-m", "pip", "--version"]),
            python_path: python.display().to_string(),
            config_exists: path.exists(),
            config_path: path.display().to_string(),
            index_url: ini_get(&entries, "index-url"),
            extra_index_urls: split_list(ini_get(&entries, "extra-index-url")),
            trusted_hosts: split_list(ini_get(&entries, "trusted-host")),
            proxy: ini_get(&entries, "proxy"),
            timeout: ini_get(&entries, "timeout"),
            env_overrides: env_overrides(&[
                "PIP_INDEX_URL",
                "PIP_EXTRA_INDEX_URL",
                "PIP_TRUSTED_HOST",
                "PIP_PROXY",
                "PIP_CONFIG_FILE",
            ]),
        })
    })
    .await?
}

/// Set or remove a key in the [global] section of the user's pip config.
/// List values (extra-index-url, trusted-host) are whitespace separated.
#[tauri::command]
pub async fn pip_set_config(key: String, value: Option<String>) -> Result<(), String> {
    blocking(move || {
        let value = value
            .map(|v| v.split_whitespace().collect::<Vec<_>>().join(" "))
            .filter(|v| !v.is_empty());
        if let Some(v) = &value {
            match key.as_str() {
                "index-url" => validate_url(v, &["http", "https"])?,
                "extra-index-url" => v.split(' ').try_for_each(|u| validate_url(u, &["http", "https"]))?,
                "proxy" => validate_url(v, &["http", "https", "socks5", "socks5h"])?,
                "timeout" => {
                    v.parse::<u32>().map_err(|_| "timeout must be a whole number of seconds".to_string())?;
                }
                "trusted-host" => {}
                _ => return Err(format!("Unsupported pip setting \"{}\"", key)),
            }
        } else if !["index-url", "extra-index-url", "trusted-host", "proxy", "timeout"].contains(&key.as_str()) {
            return Err(format!("Unsupported pip setting \"{}\"", key));
        }
        let path = pip_config_path()?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        write_file(&path, &ini_set(&content, Some("global"), &key, value.as_deref(), " = "))
    })
    .await?
}

// ── Docker ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct DockerRegistry {
    pub server: String,
    pub username: Option<String>,
    /// Where the credential lives: "config.json" or the credential helper's name
    pub store: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DockerInfo {
    pub version: Option<String>,
    pub config_path: String,
    pub config_exists: bool,
    pub current_context: Option<String>,
    pub creds_store: Option<String>,
    pub registries: Vec<DockerRegistry>,
    pub daemon_path: String,
    pub daemon_exists: bool,
    pub registry_mirrors: Vec<String>,
}

fn docker_config_dir() -> Result<PathBuf, String> {
    match std::env::var_os("DOCKER_CONFIG").filter(|p| !p.is_empty()) {
        Some(p) => Ok(PathBuf::from(p)),
        None => Ok(home()?.join(".docker")),
    }
}

/// daemon.json: Docker Desktop keeps it in ~/.docker; Docker Engine on Linux in /etc/docker.
fn docker_daemon_path() -> Result<PathBuf, String> {
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let desktop = home()?.join(".docker/daemon.json");
        if desktop.exists() {
            return Ok(desktop);
        }
        Ok(PathBuf::from("/etc/docker/daemon.json"))
    }
    #[cfg(not(all(unix, not(target_os = "macos"))))]
    {
        Ok(home()?.join(".docker").join("daemon.json"))
    }
}

fn read_json(path: &Path) -> Result<Map<String, Value>, String> {
    match fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(Map::new()),
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(Value::Object(map)) => Ok(map),
            _ => Err(format!("{} is not valid JSON", path.display())),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
    }
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for c in input.trim().bytes().filter(|&c| c != b'=') {
        let v = ALPHABET.iter().position(|&a| a == c)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// Username from a config.json "auth" value (base64 "user:password").
fn auth_username(auth: &str) -> Option<String> {
    let decoded = String::from_utf8(base64_decode(auth)?).ok()?;
    decoded.split_once(':').map(|(u, _)| u.to_string()).filter(|u| !u.is_empty())
}

/// `docker-credential-<helper> list` → { server: username }
fn helper_list(helper: &str) -> BTreeMap<String, String> {
    let name = format!("docker-credential-{}", helper);
    let Some(bin) = find_in_path(&[name.as_str()]) else {
        return BTreeMap::new();
    };
    let mut cmd = command(bin);
    cmd.arg("list");
    run_with_timeout(cmd, Duration::from_secs(10))
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| serde_json::from_slice::<BTreeMap<String, String>>(&o.stdout).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn docker_info() -> Result<DockerInfo, String> {
    blocking(|| {
        let bin = docker_bin().ok_or("Docker is not installed")?;
        let config_path = docker_config_dir()?.join("config.json");
        let config = read_json(&config_path)?;
        let creds_store = config.get("credsStore").and_then(Value::as_str).map(str::to_string);
        let cred_helpers: BTreeMap<String, String> = config
            .get("credHelpers")
            .and_then(Value::as_object)
            .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string()))).collect())
            .unwrap_or_default();

        let mut registries: BTreeMap<String, DockerRegistry> = BTreeMap::new();
        if let Some(auths) = config.get("auths").and_then(Value::as_object) {
            for (server, entry) in auths {
                let username = entry.get("auth").and_then(Value::as_str).and_then(auth_username);
                let store = match (&username, cred_helpers.get(server), &creds_store) {
                    (Some(_), _, _) => "config.json".to_string(),
                    (None, Some(helper), _) | (None, None, Some(helper)) => helper.clone(),
                    _ => "config.json".to_string(),
                };
                registries.insert(server.clone(), DockerRegistry { server: server.clone(), username, store });
            }
        }
        // Credentials kept by a helper only show their username through the helper itself
        let mut helpers: Vec<&String> = cred_helpers.values().collect();
        helpers.extend(creds_store.iter());
        helpers.sort();
        helpers.dedup();
        for helper in helpers {
            for (server, username) in helper_list(helper) {
                let entry = registries.entry(server.clone()).or_insert_with(|| DockerRegistry {
                    server: server.clone(),
                    username: None,
                    store: helper.clone(),
                });
                if entry.username.is_none() && !username.is_empty() {
                    entry.username = Some(username);
                }
            }
        }

        let daemon_path = docker_daemon_path()?;
        let daemon = read_json(&daemon_path).unwrap_or_default();
        let registry_mirrors = daemon
            .get("registry-mirrors")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
            .unwrap_or_default();

        Ok(DockerInfo {
            version: tool_version(&bin, &["--version"]),
            config_exists: config_path.exists(),
            config_path: config_path.display().to_string(),
            current_context: config.get("currentContext").and_then(Value::as_str).map(str::to_string),
            creds_store,
            registries: registries.into_values().collect(),
            daemon_exists: daemon_path.exists(),
            daemon_path: daemon_path.display().to_string(),
            registry_mirrors,
        })
    })
    .await?
}

/// `docker login` with the password passed on stdin (never on the command line).
#[tauri::command]
pub async fn docker_login(server: String, username: String, password: String) -> Result<(), String> {
    blocking(move || {
        let bin = docker_bin().ok_or("Docker is not installed")?;
        if username.trim().is_empty() || password.is_empty() {
            return Err("Username and password are required".into());
        }
        let mut cmd = command(bin);
        cmd.args(["login", "--username", username.trim(), "--password-stdin"]);
        if !server.trim().is_empty() {
            cmd.arg(server.trim());
        }
        let output = run_with_input(cmd, Some(password.as_bytes()), Duration::from_secs(60))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(error_line(&output))
        }
    })
    .await?
}

#[tauri::command]
pub async fn docker_logout(server: String) -> Result<(), String> {
    blocking(move || {
        let bin = docker_bin().ok_or("Docker is not installed")?;
        let mut cmd = command(bin);
        cmd.arg("logout");
        if !server.trim().is_empty() {
            cmd.arg(server.trim());
        }
        let output = run_with_timeout(cmd, Duration::from_secs(30))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(error_line(&output))
        }
    })
    .await?
}

/// Replace `registry-mirrors` in daemon.json, keeping every other daemon setting.
#[tauri::command]
pub async fn docker_set_mirrors(mirrors: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let mirrors: Vec<String> = mirrors.iter().map(|m| m.trim().to_string()).filter(|m| !m.is_empty()).collect();
        for m in &mirrors {
            validate_url(m, &["http", "https"])?;
        }
        let path = docker_daemon_path()?;
        let mut daemon = read_json(&path)?;
        if mirrors.is_empty() {
            daemon.remove("registry-mirrors");
        } else {
            daemon.insert("registry-mirrors".into(), Value::from(mirrors));
        }
        let text = serde_json::to_string_pretty(&Value::Object(daemon)).map_err(|e| e.to_string())?;
        write_file(&path, &(text + "\n"))
    })
    .await?
}

// ── Network test ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct UrlTestResult {
    /// Any HTTP response (even 401/404) means the server is reachable
    pub ok: bool,
    pub status: Option<u16>,
    pub elapsed_ms: u64,
    pub message: String,
}

/// Time one request to `url` with curl (optionally through `proxy`), without
/// keeping the body. Used to compare mirror latency.
#[tauri::command]
pub async fn test_url(url: String, proxy: Option<String>) -> Result<UrlTestResult, String> {
    blocking(move || {
        validate_url(&url, &["http", "https"])?;
        let curl = find_in_path(&["curl"]).ok_or("curl was not found on this system")?;
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let mut cmd = command(curl);
        cmd.args(["-sS", "-o", null, "-w", "%{http_code} %{time_total}", "--max-time", "10", "--max-filesize", "2000000"]);
        if let Some(p) = proxy.filter(|p| !p.trim().is_empty()) {
            cmd.arg("-x").arg(p.trim());
        }
        cmd.arg(&url);
        let output = run_with_timeout(cmd, Duration::from_secs(15))?;
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        let mut parts = text.split_whitespace();
        let status = parts.next().and_then(|s| s.parse::<u16>().ok()).filter(|&s| s > 0);
        let elapsed_ms = parts.next().and_then(|s| s.parse::<f64>().ok()).map(|s| (s * 1000.0) as u64).unwrap_or(0);
        Ok(UrlTestResult {
            ok: status.is_some_and(|s| s < 500),
            status,
            elapsed_ms,
            message: if status.is_some() { String::new() } else { error_line(&output) },
        })
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ini_set_updates_in_place_and_keeps_comments() {
        let npmrc = "; my settings\nregistry=https://old/\n//r/:_authToken=abc\nregistry=https://dup/\n";
        let out = ini_set(npmrc, None, "registry", Some("https://registry.npmmirror.com/"), "=");
        assert_eq!(out, "; my settings\nregistry=https://registry.npmmirror.com/\n//r/:_authToken=abc\n");
        let removed = ini_set(&out, None, "registry", None, "=");
        assert_eq!(removed, "; my settings\n//r/:_authToken=abc\n");
        assert_eq!(ini_set("", None, "proxy", Some("http://p:1"), "="), "proxy=http://p:1\n");
    }

    #[test]
    fn ini_set_handles_sections_and_continuations() {
        let pip = "[install]\nuser = true\n\n[global]\ntimeout = 60\nextra-index-url =\n    https://a/simple\n    https://b/simple\n";
        let out = ini_set(pip, Some("global"), "extra-index-url", Some("https://c/simple"), " = ");
        assert_eq!(out, "[install]\nuser = true\n\n[global]\ntimeout = 60\nextra-index-url = https://c/simple\n");
        let added = ini_set(&out, Some("global"), "index-url", Some("https://m/simple"), " = ");
        assert!(added.ends_with("extra-index-url = https://c/simple\nindex-url = https://m/simple\n"));
        // New section when missing; other sections untouched
        let created = ini_set("[install]\nuser = true\n", Some("global"), "proxy", Some("http://p:8"), " = ");
        assert_eq!(created, "[install]\nuser = true\n\n[global]\nproxy = http://p:8\n");
        // Section header added before other keys appear after it
        let mid = ini_set("[global]\na = 1\n\n[install]\nb = 2\n", Some("global"), "c", Some("3"), " = ");
        assert_eq!(mid, "[global]\na = 1\nc = 3\n\n[install]\nb = 2\n");
    }

    #[test]
    fn ini_read_parses_npmrc_and_pip() {
        let npmrc = "registry = https://r/\n//registry.npmjs.org/:_authToken=npm_abcdefghijklmnop\n@corp:registry=https://npm.corp/\n# comment\n";
        let entries = ini_read(npmrc, None);
        assert_eq!(ini_get(&entries, "registry").as_deref(), Some("https://r/"));
        let auths = npm_auths(&entries);
        assert_eq!(auths.len(), 1);
        assert_eq!(auths[0].registry, "//registry.npmjs.org/");
        assert_eq!(auths[0].masked, "npm_…mnop");
        assert!(entries.iter().any(|(k, v)| k == "@corp:registry" && v == "https://npm.corp/"));

        let pip = "[global]\nindex-url: https://m/simple\nextra-index-url =\n  https://a/simple\n  https://b/simple\n[install]\nindex-url = https://ignored/\n";
        let g = ini_read(pip, Some("global"));
        assert_eq!(ini_get(&g, "index-url").as_deref(), Some("https://m/simple"));
        assert_eq!(split_list(ini_get(&g, "extra-index-url")), vec!["https://a/simple", "https://b/simple"]);
    }

    #[test]
    fn npm_helpers() {
        assert_eq!(npm_registry_prefix("https://registry.npmjs.org").unwrap(), "//registry.npmjs.org/");
        assert_eq!(npm_registry_prefix("https://npm.corp/api/npm/").unwrap(), "//npm.corp/api/npm/");
        assert!(npm_registry_prefix("registry.npmjs.org").is_err());
        assert!(is_scope_registry_key("@my-org:registry"));
        assert!(!is_scope_registry_key("@:registry"));
        assert!(!is_scope_registry_key("registry"));
    }

    #[test]
    fn docker_auth_username() {
        // "octo:secret"
        assert_eq!(auth_username("b2N0bzpzZWNyZXQ=").as_deref(), Some("octo"));
        assert_eq!(auth_username("not base64!"), None);
    }

    #[test]
    fn validates_urls() {
        assert!(validate_url("https://registry.npmmirror.com/", &["http", "https"]).is_ok());
        assert!(validate_url("socks5://127.0.0.1:1080", &["socks5"]).is_ok());
        assert!(validate_url("ftp://x", &["http", "https"]).is_err());
        assert!(validate_url("https://", &["https"]).is_err());
        assert!(validate_url("https://a b", &["https"]).is_err());
    }
}
