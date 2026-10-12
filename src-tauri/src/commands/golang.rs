//! Go: module proxy, checksum database, private modules and toolchain policy, kept in
//! Go's own env file (what `go env -w` writes: %APPDATA%\go\env, ~/.config/go/env, …).
//! The file is edited directly, so changes work even while an environment variable
//! overrides them (the page warns about that case).

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use super::devtools::{env_overrides, find_in_path, ini_get, ini_read, ini_set, validate_url, write_file};
use super::proc::{blocking, command, run_with_timeout};
use super::userenv;

pub fn go_bin() -> Option<PathBuf> {
    find_in_path(&["go"])
}

/// GOENV, or os.UserConfigDir()/go/env.
fn go_env_path() -> Result<PathBuf, String> {
    if let Some(p) = userenv::effective_var("GOENV").filter(|p| p != "off") {
        return Ok(PathBuf::from(p));
    }
    #[cfg(target_os = "macos")]
    let base = dirs::home_dir().map(|h| h.join("Library/Application Support"));
    #[cfg(not(target_os = "macos"))]
    let base = dirs::config_dir();
    Ok(base.ok_or("Failed to find the user config directory")?.join("go").join("env"))
}

#[derive(Debug, Clone, Serialize)]
pub struct GoInfo {
    pub version: Option<String>,
    pub gopath: Option<String>,
    pub goroot: Option<String>,
    pub gomodcache: Option<String>,
    pub config_path: String,
    pub config_exists: bool,
    pub goproxy: Option<String>,
    pub gosumdb: Option<String>,
    pub goprivate: Option<String>,
    pub gotoolchain: Option<String>,
    pub env_overrides: BTreeMap<String, String>,
}

const KEYS: [&str; 4] = ["GOPROXY", "GOSUMDB", "GOPRIVATE", "GOTOOLCHAIN"];

#[tauri::command]
pub async fn go_info() -> Result<GoInfo, String> {
    blocking(|| {
        let bin = go_bin().ok_or("Go is not installed")?;
        let path = go_env_path()?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        let entries = ini_read(&content, None);
        // One spawn for the version and paths
        let mut cmd = command(bin);
        cmd.args(["env", "-json", "GOVERSION", "GOPATH", "GOROOT", "GOMODCACHE"]);
        let env: BTreeMap<String, String> = run_with_timeout(cmd, Duration::from_secs(15))
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| serde_json::from_slice(&o.stdout).ok())
            .unwrap_or_default();
        let field = |k: &str| env.get(k).cloned().filter(|v| !v.is_empty());
        Ok(GoInfo {
            version: field("GOVERSION"),
            gopath: field("GOPATH"),
            goroot: field("GOROOT"),
            gomodcache: field("GOMODCACHE"),
            config_exists: path.exists(),
            config_path: path.display().to_string(),
            goproxy: ini_get(&entries, "GOPROXY"),
            gosumdb: ini_get(&entries, "GOSUMDB"),
            goprivate: ini_get(&entries, "GOPRIVATE"),
            gotoolchain: ini_get(&entries, "GOTOOLCHAIN"),
            env_overrides: env_overrides(&KEYS),
        })
    })
    .await?
}

fn validate(key: &str, v: &str) -> Result<(), String> {
    if v.contains(char::is_whitespace) {
        return Err(format!("{} must not contain spaces", key));
    }
    match key {
        // Comma (fall through on 404/410) or pipe (on any error) separated
        "GOPROXY" => v.split([',', '|']).try_for_each(|p| match p {
            "direct" | "off" => Ok(()),
            url => validate_url(url, &["http", "https", "file"]),
        }),
        "GOTOOLCHAIN" => {
            let base = v.split('+').next().unwrap_or_default();
            let ok = ["auto", "local", "path"].contains(&v)
                || (base.starts_with("go1") && v.split('+').skip(1).all(|s| s == "auto" || s == "path"));
            ok.then_some(()).ok_or_else(|| "Use auto, local, path or a version such as go1.23.4+auto".to_string())
        }
        "GOSUMDB" | "GOPRIVATE" => Ok(()),
        _ => Err(format!("Unsupported Go setting \"{}\"", key)),
    }
}

/// Set or remove one setting in Go's env file.
#[tauri::command]
pub async fn go_set_env(key: String, value: Option<String>) -> Result<(), String> {
    blocking(move || {
        let value = value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        if !KEYS.contains(&key.as_str()) {
            return Err(format!("Unsupported Go setting \"{}\"", key));
        }
        if let Some(v) = &value {
            validate(&key, v)?;
        }
        let path = go_env_path()?;
        let content = fs::read_to_string(&path).unwrap_or_default();
        write_file(&path, &ini_set(&content, None, &key, value.as_deref(), "="))
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_go_settings() {
        assert!(validate("GOPROXY", "https://goproxy.cn,direct").is_ok());
        assert!(validate("GOPROXY", "https://a|https://b,off").is_ok());
        assert!(validate("GOPROXY", "goproxy.cn").is_err());
        assert!(validate("GOTOOLCHAIN", "local").is_ok());
        assert!(validate("GOTOOLCHAIN", "go1.23.4+auto").is_ok());
        assert!(validate("GOTOOLCHAIN", "newest").is_err());
        assert!(validate("GOPRIVATE", "github.com/corp/*, x").is_err());
    }

    #[test]
    fn edits_env_file() {
        let file = "GOPROXY=https://proxy.golang.org,direct\nGOFLAGS=-mod=mod\n";
        let out = ini_set(file, None, "GOPROXY", Some("https://goproxy.cn,direct"), "=");
        assert_eq!(out, "GOPROXY=https://goproxy.cn,direct\nGOFLAGS=-mod=mod\n");
        let entries = ini_read(&out, None);
        assert_eq!(ini_get(&entries, "GOFLAGS").as_deref(), Some("-mod=mod"));
    }
}
