//! Rust: crates.io mirror, proxy and registry token in Cargo's config files, and
//! rustup's download mirror (RUSTUP_DIST_SERVER / RUSTUP_UPDATE_ROOT).
//!
//! Cargo's TOML files are edited with toml_edit so comments and layout survive.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use toml_edit::{value, Document, Item, Table};

use super::devtools::{env_overrides, find_in_path, home, mask, tool_version, validate_url, write_file};
use super::proc::{blocking, command, run_with_timeout, stdout_text};
use super::userenv;

/// Cargo's home: CARGO_HOME or ~/.cargo.
fn cargo_home() -> Result<PathBuf, String> {
    match userenv::effective_var("CARGO_HOME") {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => Ok(home()?.join(".cargo")),
    }
}

/// A binary from PATH, or from Cargo's bin directory (rustup installs there).
fn rust_tool(name: &str) -> Option<PathBuf> {
    find_in_path(&[name]).or_else(|| {
        let bin = cargo_home().ok()?.join("bin").join(if cfg!(windows) { format!("{}.exe", name) } else { name.into() });
        bin.is_file().then_some(bin)
    })
}

pub fn cargo_bin() -> Option<PathBuf> {
    rust_tool("cargo")
}

pub fn rustup_bin() -> Option<PathBuf> {
    rust_tool("rustup")
}

/// config.toml, or the extension-less legacy `config` when only that exists.
fn cargo_config_path() -> Result<PathBuf, String> {
    let dir = cargo_home()?;
    let legacy = dir.join("config");
    if legacy.is_file() && !dir.join("config.toml").exists() {
        return Ok(legacy);
    }
    Ok(dir.join("config.toml"))
}

fn credentials_path() -> Result<PathBuf, String> {
    let dir = cargo_home()?;
    let legacy = dir.join("credentials");
    if legacy.is_file() && !dir.join("credentials.toml").exists() {
        return Ok(legacy);
    }
    Ok(dir.join("credentials.toml"))
}

fn read_toml(path: &Path) -> Result<Document, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("Failed to read {}: {}", path.display(), e)),
    };
    text.parse::<Document>()
        .map_err(|e| format!("{} is not valid TOML: {}", path.display(), e.to_string().lines().next().unwrap_or("")))
}

fn get<'a>(doc: &'a Document, path: &[&str]) -> Option<&'a Item> {
    let mut item = doc.as_item();
    for key in path {
        item = item.get(key)?;
    }
    Some(item)
}

/// The table at `path`, created (without an empty header of its own) when missing.
fn table_mut<'a>(doc: &'a mut Document, path: &[&str]) -> Result<&'a mut Table, String> {
    let mut table = doc.as_table_mut();
    for key in path {
        let item = table.entry(key).or_insert_with(|| {
            let mut t = Table::new();
            t.set_implicit(true);
            Item::Table(t)
        });
        table = item.as_table_mut().ok_or_else(|| format!("\"{}\" in the Cargo config is not a table", key))?;
    }
    Ok(table)
}

/// Remove `key` from the table at `path`, then any tables left empty along the way.
fn remove(doc: &mut Document, path: &[&str], key: &str) {
    fn walk(table: &mut Table, path: &[&str], key: &str) {
        match path.split_first() {
            None => {
                table.remove(key);
            }
            Some((first, rest)) => {
                if let Some(child) = table.get_mut(first).and_then(Item::as_table_mut) {
                    walk(child, rest, key);
                    if child.is_empty() {
                        table.remove(first);
                    }
                }
            }
        }
    }
    walk(doc.as_table_mut(), path, key);
}

fn save_toml(path: &Path, doc: &Document) -> Result<(), String> {
    let mut text = doc.to_string();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    write_file(path, &text)
}

// ── Info ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct Toolchain {
    pub name: String,
    pub default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RustInfo {
    pub cargo_version: Option<String>,
    pub rustup_version: Option<String>,
    pub toolchains: Vec<Toolchain>,
    pub config_path: String,
    pub config_exists: bool,
    /// Index URL of the source replacing crates.io, e.g. "sparse+https://rsproxy.cn/index/"
    pub registry_mirror: Option<String>,
    /// crates.io is replaced by something that isn't a registry (e.g. vendored sources)
    pub replaced_with: Option<String>,
    pub http_proxy: Option<String>,
    pub check_revoke: Option<bool>,
    pub git_fetch_with_cli: Option<bool>,
    /// Masked crates.io token from credentials.toml
    pub token: Option<String>,
    pub credentials_path: String,
    pub rustup_dist_server: Option<String>,
    pub rustup_update_root: Option<String>,
    pub env_overrides: BTreeMap<String, String>,
}

fn parse_toolchains(text: &str) -> Vec<Toolchain> {
    text.lines()
        .filter_map(|line| {
            // "no installed toolchains" when there are none
            let name = line.split_whitespace().next().filter(|n| *n != "no")?;
            Some(Toolchain { name: name.to_string(), default: line.contains("default)") })
        })
        .collect()
}

fn mirror_of(doc: &Document) -> (Option<String>, Option<String>) {
    let Some(name) = get(doc, &["source", "crates-io", "replace-with"]).and_then(Item::as_str) else {
        return (None, None);
    };
    match get(doc, &["source", name, "registry"]).and_then(Item::as_str) {
        Some(url) => (Some(url.to_string()), None),
        None => (None, Some(name.to_string())),
    }
}

pub(super) fn cargo_proxy() -> Option<String> {
    let doc = read_toml(&cargo_config_path().ok()?).ok()?;
    get(&doc, &["http", "proxy"]).and_then(Item::as_str).map(str::to_string).filter(|s| !s.is_empty())
}

#[tauri::command]
pub async fn rust_info() -> Result<RustInfo, String> {
    blocking(|| {
        let cargo = cargo_bin();
        let rustup = rustup_bin();
        if cargo.is_none() && rustup.is_none() {
            return Err("Rust is not installed".to_string());
        }
        let config_path = cargo_config_path()?;
        let doc = read_toml(&config_path)?;
        let (registry_mirror, replaced_with) = mirror_of(&doc);
        let creds_path = credentials_path()?;
        let token = read_toml(&creds_path)
            .ok()
            .and_then(|d| get(&d, &["registry", "token"]).and_then(Item::as_str).map(mask));
        let toolchains = rustup
            .as_ref()
            .and_then(|bin| {
                let mut cmd = command(bin);
                cmd.args(["toolchain", "list"]);
                run_with_timeout(cmd, Duration::from_secs(15)).ok()
            })
            .and_then(|o| stdout_text(&o))
            .map(|t| parse_toolchains(&t))
            .unwrap_or_default();
        Ok(RustInfo {
            cargo_version: cargo.as_ref().and_then(|b| tool_version(b, &["--version"])),
            rustup_version: rustup.as_ref().and_then(|b| tool_version(b, &["--version"])),
            toolchains,
            config_exists: config_path.exists(),
            config_path: config_path.display().to_string(),
            registry_mirror,
            replaced_with,
            http_proxy: get(&doc, &["http", "proxy"]).and_then(Item::as_str).map(str::to_string),
            check_revoke: get(&doc, &["http", "check-revoke"]).and_then(Item::as_bool),
            git_fetch_with_cli: get(&doc, &["net", "git-fetch-with-cli"]).and_then(Item::as_bool),
            token,
            credentials_path: creds_path.display().to_string(),
            rustup_dist_server: userenv::effective_var("RUSTUP_DIST_SERVER"),
            rustup_update_root: userenv::effective_var("RUSTUP_UPDATE_ROOT"),
            env_overrides: env_overrides(&[
                "CARGO_HTTP_PROXY",
                "CARGO_HTTP_CHECK_REVOKE",
                "CARGO_NET_GIT_FETCH_WITH_CLI",
                "CARGO_REGISTRY_TOKEN",
                "CARGO_HOME",
            ]),
        })
    })
    .await?
}

// ── Settings ──────────────────────────────────────────────────────────────────

const MIRROR_SOURCE: &str = "mirror";

fn validate_index_url(url: &str) -> Result<(), String> {
    validate_url(url.strip_prefix("sparse+").unwrap_or(url), &["http", "https"])
}

fn set_mirror(doc: &mut Document, url: Option<&str>) -> Result<(), String> {
    let current = get(doc, &["source", "crates-io", "replace-with"]).and_then(Item::as_str).map(str::to_string);
    match url {
        Some(url) => {
            validate_index_url(url)?;
            // Reuse the user's own source name when it is a registry
            let name = current
                .filter(|n| n != "crates-io" && get(doc, &["source", n, "registry"]).is_some())
                .unwrap_or_else(|| MIRROR_SOURCE.to_string());
            table_mut(doc, &["source", "crates-io"])?.insert("replace-with", value(name.as_str()));
            table_mut(doc, &["source", &name])?.insert("registry", value(url));
        }
        None => {
            remove(doc, &["source", "crates-io"], "replace-with");
            // Drop the replacement source if it was only a mirror definition
            if let Some(name) = current {
                let only_registry = get(doc, &["source", &name])
                    .and_then(Item::as_table)
                    .is_some_and(|t| t.iter().all(|(k, _)| k == "registry"));
                if only_registry {
                    remove(doc, &["source", &name], "registry");
                }
            }
        }
    }
    Ok(())
}

/// Replace crates.io with a mirror index, or restore crates.io with `None`.
#[tauri::command]
pub async fn rust_set_mirror(url: Option<String>) -> Result<(), String> {
    blocking(move || {
        let path = cargo_config_path()?;
        let mut doc = read_toml(&path)?;
        set_mirror(&mut doc, url.as_deref().map(str::trim).filter(|u| !u.is_empty()))?;
        save_toml(&path, &doc)
    })
    .await?
}

fn set_value(doc: &mut Document, key: &str, raw: Option<&str>) -> Result<(), String> {
    let (table, name) = key.split_once('.').ok_or("Unsupported Cargo setting")?;
    let parsed = match (key, raw) {
        (_, None) => None,
        ("http.proxy", Some(v)) => {
            // libcurl also accepts a bare host:port
            if v.contains("://") {
                validate_url(v, &["http", "https", "socks5", "socks5h"])?;
            }
            Some(value(v))
        }
        ("http.check-revoke" | "net.git-fetch-with-cli", Some(v)) => {
            Some(value(v.parse::<bool>().map_err(|_| format!("{} must be true or false", key))?))
        }
        _ => return Err(format!("Unsupported Cargo setting \"{}\"", key)),
    };
    if !["http.proxy", "http.check-revoke", "net.git-fetch-with-cli"].contains(&key) {
        return Err(format!("Unsupported Cargo setting \"{}\"", key));
    }
    match parsed {
        Some(item) => {
            table_mut(doc, &[table])?.insert(name, item);
        }
        None => remove(doc, &[table], name),
    }
    Ok(())
}

pub(super) fn set_cargo_proxy(proxy: Option<&str>) -> Result<(), String> {
    let path = cargo_config_path()?;
    let mut doc = read_toml(&path)?;
    set_value(&mut doc, "http.proxy", proxy)?;
    save_toml(&path, &doc)
}

/// Set or remove `http.proxy`, `http.check-revoke` or `net.git-fetch-with-cli`.
#[tauri::command]
pub async fn rust_set_config(key: String, value: Option<String>) -> Result<(), String> {
    blocking(move || {
        let path = cargo_config_path()?;
        let mut doc = read_toml(&path)?;
        set_value(&mut doc, &key, value.as_deref().map(str::trim).filter(|v| !v.is_empty()))?;
        save_toml(&path, &doc)
    })
    .await?
}

/// Save (or remove) the crates.io token in credentials.toml.
#[tauri::command]
pub async fn rust_set_token(token: Option<String>) -> Result<(), String> {
    blocking(move || {
        let token = token.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        if token.as_deref().is_some_and(|t| t.contains(char::is_whitespace)) {
            return Err("The token must not contain spaces".into());
        }
        let path = credentials_path()?;
        let mut doc = read_toml(&path)?;
        match token {
            Some(t) => {
                table_mut(&mut doc, &["registry"])?.insert("token", value(t));
            }
            None => remove(&mut doc, &["registry"], "token"),
        }
        save_toml(&path, &doc)
    })
    .await?
}

/// Set rustup's mirror as user environment variables (both, or neither).
#[tauri::command]
pub async fn rust_set_rustup_mirror(dist_server: Option<String>, update_root: Option<String>) -> Result<(), String> {
    blocking(move || {
        let clean = |v: Option<String>| v.map(|s| s.trim().trim_end_matches('/').to_string()).filter(|s| !s.is_empty());
        let (dist, root) = (clean(dist_server), clean(update_root));
        for v in dist.iter().chain(root.iter()) {
            validate_url(v, &["http", "https"])?;
        }
        userenv::set_user_var("RUSTUP_DIST_SERVER", dist.as_deref())?;
        userenv::set_user_var("RUSTUP_UPDATE_ROOT", root.as_deref())
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mirror_round_trip_keeps_comments() {
        let mut doc = "# my cargo config\n[build]\njobs = 4\n".parse::<Document>().unwrap();
        set_mirror(&mut doc, Some("sparse+https://rsproxy.cn/index/")).unwrap();
        let text = doc.to_string();
        assert!(text.starts_with("# my cargo config\n[build]\njobs = 4\n"));
        assert!(text.contains("[source.crates-io]\nreplace-with = \"mirror\""));
        assert!(text.contains("[source.mirror]\nregistry = \"sparse+https://rsproxy.cn/index/\""));
        assert!(!text.contains("[source]\n"));
        assert_eq!(mirror_of(&doc).0.as_deref(), Some("sparse+https://rsproxy.cn/index/"));

        set_mirror(&mut doc, None).unwrap();
        assert_eq!(doc.to_string(), "# my cargo config\n[build]\njobs = 4\n");
    }

    #[test]
    fn mirror_reuses_existing_source_name() {
        let mut doc = "[source.crates-io]\nreplace-with = 'tuna'\n\n[source.tuna]\nregistry = \"https://old\"\n"
            .parse::<Document>()
            .unwrap();
        set_mirror(&mut doc, Some("sparse+https://mirrors.ustc.edu.cn/crates.io-index/")).unwrap();
        assert_eq!(mirror_of(&doc).0.as_deref(), Some("sparse+https://mirrors.ustc.edu.cn/crates.io-index/"));
        assert!(get(&doc, &["source", "mirror"]).is_none());
        // Vendored sources are reported, not treated as a mirror
        let vendored = "[source.crates-io]\nreplace-with = \"vendored\"\n[source.vendored]\ndirectory = \"vendor\"\n"
            .parse::<Document>()
            .unwrap();
        assert_eq!(mirror_of(&vendored), (None, Some("vendored".into())));
        assert!(set_mirror(&mut doc, Some("not a url")).is_err());
    }

    #[test]
    fn sets_and_clears_values() {
        let mut doc = Document::new();
        set_value(&mut doc, "http.proxy", Some("http://127.0.0.1:7890")).unwrap();
        set_value(&mut doc, "net.git-fetch-with-cli", Some("true")).unwrap();
        assert_eq!(doc.to_string(), "[http]\nproxy = \"http://127.0.0.1:7890\"\n\n[net]\ngit-fetch-with-cli = true\n");
        set_value(&mut doc, "http.proxy", None).unwrap();
        set_value(&mut doc, "net.git-fetch-with-cli", None).unwrap();
        assert_eq!(doc.to_string(), "");
        assert!(set_value(&mut doc, "build.jobs", Some("4")).is_err());
        assert!(set_value(&mut doc, "http.check-revoke", Some("maybe")).is_err());
    }

    #[test]
    fn parses_toolchain_list() {
        let list = "stable-x86_64-pc-windows-msvc (active, default)\nnightly-x86_64-pc-windows-msvc\n";
        let t = parse_toolchains(list);
        assert_eq!(t.len(), 2);
        assert!(t[0].default && !t[1].default);
        assert!(parse_toolchains("stable-x86_64-unknown-linux-gnu (default)\n")[0].default);
    }
}
