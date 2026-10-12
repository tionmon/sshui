//! sing-box config files the user picks: open, validate with `sing-box check`, and save
//! with a backup. The editing itself happens in the frontend on the parsed JSON.
//!
//! SSHUI's own notes about a file (hidden and disabled nodes) live in
//! ~/.ssh-at/singbox.json, since sing-box rejects unknown fields in its config.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::devtools::{find_in_path, home, write_file};
use super::proc::{blocking, command, run_with_timeout, stdout_text};

const RECENT_LIMIT: usize = 10;
/// sing-box configs are small; anything bigger is almost certainly the wrong file
const MAX_SIZE: u64 = 8 * 1024 * 1024;

#[derive(Default, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    recent: Vec<String>,
    /// A sing-box binary chosen by the user
    #[serde(default)]
    binary: Option<String>,
    /// Per-file notes, keyed by `file_key`
    #[serde(default)]
    files: BTreeMap<String, Value>,
}

fn store_path() -> Result<PathBuf, String> {
    Ok(home()?.join(".ssh-at").join("singbox.json"))
}

fn load_store() -> Store {
    store_path()
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_store(store: &Store) -> Result<(), String> {
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    write_file(&store_path()?, &json)
}

/// Paths compare case-insensitively on Windows, with either slash.
fn file_key(path: &str) -> String {
    if cfg!(windows) {
        path.replace('/', "\\").to_lowercase()
    } else {
        path.to_string()
    }
}

fn remember(store: &mut Store, path: &str) {
    let key = file_key(path);
    store.recent.retain(|p| file_key(p) != key);
    store.recent.insert(0, path.to_string());
    store.recent.truncate(RECENT_LIMIT);
}

/// Identifies file contents, to notice edits made outside SSHUI before overwriting them.
fn revision(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}-{}", hasher.finish(), bytes.len())
}

// ── Binary ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SingboxBinary {
    pub path: String,
    pub version: Option<String>,
}

/// Graphical clients (the official sing-box app is Electron) ship an executable that is
/// also called sing-box.exe; running it with arguments would open the app instead.
fn is_gui_app(bin: &Path) -> bool {
    bin.parent().is_some_and(|dir| {
        ["resources.pak", "chrome_100_percent.pak", "icudtl.dat", "resources/app.asar"]
            .iter()
            .any(|f| dir.join(f).exists())
    })
}

/// The version of a sing-box command-line program, or None for anything else.
fn binary_version(bin: &Path) -> Option<String> {
    if is_gui_app(bin) {
        return None;
    }
    let mut cmd = command(bin);
    cmd.arg("version");
    let output = run_with_timeout(cmd, Duration::from_secs(10)).ok().filter(|o| o.status.success())?;
    let first = stdout_text(&output)?.lines().next()?.trim().to_string();
    first.strip_prefix("sing-box version").map(|v| v.trim().to_string())
}

/// The user's choice, then a sing-box next to the config (GUI clients bundle one), then PATH.
/// Graphical apps that happen to be named sing-box are skipped.
fn locate_binary(store: &Store, config: Option<&Path>) -> Option<PathBuf> {
    let usable = |p: &PathBuf| p.is_file() && !is_gui_app(p);
    if let Some(custom) = store.binary.as_deref().map(PathBuf::from).filter(usable) {
        return Some(custom);
    }
    if let Some(dir) = config.and_then(Path::parent) {
        for name in ["sing-box.exe", "sing-box"] {
            let candidate = dir.join(name);
            if usable(&candidate) {
                return Some(candidate);
            }
        }
    }
    find_in_path(&["sing-box"]).filter(usable)
}

fn binary_info(store: &Store, config: Option<&Path>) -> Option<SingboxBinary> {
    locate_binary(store, config).map(|p| SingboxBinary { version: binary_version(&p), path: p.display().to_string() })
}

// ── Files ────────────────────────────────────────────────────────────────────

fn read_config(path: &Path) -> Result<(String, String), String> {
    let meta = fs::metadata(path).map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
    if !meta.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if meta.len() > MAX_SIZE {
        return Err(format!("{} is too large to be a sing-box config", path.display()));
    }
    let bytes = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let rev = revision(&bytes);
    let text = String::from_utf8(bytes).map_err(|_| format!("{} is not a UTF-8 text file", path.display()))?;
    Ok((text.trim_start_matches('\u{feff}').to_string(), rev))
}

#[derive(Debug, PartialEq, Eq)]
enum WriteOutcome {
    Saved(String),
    /// The file changed since it was opened; carries its current revision
    Conflict(String),
}

/// Write the config unless it changed on disk since `expected` (unless `force`),
/// keeping the previous version as `<file>.sshui-bak`. Written through a temporary
/// file so a failure never leaves a half-written config.
fn write_config(path: &Path, text: &str, expected: Option<&str>, force: bool) -> Result<WriteOutcome, String> {
    if path.is_file() {
        let current = fs::read(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
        let current_rev = revision(&current);
        if !force && expected.is_some_and(|e| e != current_rev) {
            return Ok(WriteOutcome::Conflict(current_rev));
        }
        let mut backup = path.as_os_str().to_owned();
        backup.push(".sshui-bak");
        fs::write(PathBuf::from(backup), &current).map_err(|e| format!("Failed to back up {}: {}", path.display(), e))?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".sshui-tmp");
    let tmp = PathBuf::from(tmp);
    write_file(&tmp, text)?;
    if fs::rename(&tmp, path).is_err() {
        // Some sync tools hold the file open; fall back to writing in place
        let _ = fs::remove_file(&tmp);
        write_file(path, text)?;
    }
    Ok(WriteOutcome::Saved(revision(text.as_bytes())))
}

fn absolute(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path.trim());
    if !p.is_absolute() {
        return Err(format!("{} is not an absolute path", path));
    }
    Ok(p)
}

fn has_notes(meta: &Value) -> bool {
    match meta {
        Value::Null => false,
        Value::Object(map) => map.values().any(|v| match v {
            Value::Object(m) => !m.is_empty(),
            Value::Array(a) => !a.is_empty(),
            Value::Null => false,
            _ => true,
        }),
        _ => true,
    }
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct RecentFile {
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SingboxState {
    pub recent: Vec<RecentFile>,
    pub binary: Option<SingboxBinary>,
    pub custom_binary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SingboxFile {
    pub path: String,
    pub text: String,
    pub revision: String,
    /// SSHUI's notes about this file, or null
    pub meta: Value,
    pub binary: Option<SingboxBinary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SingboxCheck {
    /// Whether a sing-box binary was found to check with
    pub available: bool,
    pub ok: bool,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SingboxSaveResult {
    /// "saved" or "conflict"
    pub status: String,
    pub revision: String,
}

#[tauri::command]
pub async fn singbox_state() -> Result<SingboxState, String> {
    blocking(|| {
        let store = load_store();
        SingboxState {
            recent: store.recent.iter().map(|p| RecentFile { path: p.clone(), exists: Path::new(p).is_file() }).collect(),
            binary: binary_info(&store, None),
            custom_binary: store.binary.clone(),
        }
    })
    .await
}

fn open_blocking(path: &Path) -> Result<SingboxFile, String> {
    let (text, rev) = read_config(path)?;
    let mut store = load_store();
    let display = path.display().to_string();
    remember(&mut store, &display);
    save_store(&store)?;
    Ok(SingboxFile {
        meta: store.files.get(&file_key(&display)).cloned().unwrap_or(Value::Null),
        binary: binary_info(&store, Some(path)),
        path: display,
        text,
        revision: rev,
    })
}

#[tauri::command]
pub async fn singbox_open(path: String) -> Result<SingboxFile, String> {
    let path = absolute(&path)?;
    blocking(move || open_blocking(&path)).await?
}

/// Create a new config file (refusing to overwrite one) and open it.
#[tauri::command]
pub async fn singbox_create(path: String, text: String) -> Result<SingboxFile, String> {
    let path = absolute(&path)?;
    blocking(move || {
        if path.exists() {
            return Err(format!("{} already exists", path.display()));
        }
        write_file(&path, &text)?;
        open_blocking(&path)
    })
    .await?
}

/// Run `sing-box check` on unsaved text, from the config's folder so relative paths resolve.
#[tauri::command]
pub async fn singbox_check(path: String, text: String) -> Result<SingboxCheck, String> {
    let path = absolute(&path)?;
    blocking(move || {
        let store = load_store();
        let Some(bin) = locate_binary(&store, Some(&path)) else {
            return Ok(SingboxCheck { available: false, ok: false, output: String::new() });
        };
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        let tmp = std::env::temp_dir().join(format!("sshui-singbox-check-{}-{}.json", std::process::id(), nanos));
        fs::write(&tmp, &text).map_err(|e| e.to_string())?;
        let mut cmd = command(&bin);
        cmd.arg("check").arg("-c").arg(&tmp).arg("--disable-color");
        if let Some(dir) = path.parent().filter(|d| d.is_dir()) {
            cmd.current_dir(dir);
        }
        let result = run_with_timeout(cmd, Duration::from_secs(30));
        let _ = fs::remove_file(&tmp);
        let output = result?;
        let mut text = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&stdout);
        }
        // Report errors against the real file, not the temporary copy
        let text = text.replace(&tmp.display().to_string(), &path.display().to_string());
        Ok(SingboxCheck { available: true, ok: output.status.success(), output: text })
    })
    .await?
}

#[tauri::command]
pub async fn singbox_save(
    path: String,
    text: String,
    meta: Value,
    revision: Option<String>,
    force: bool,
) -> Result<SingboxSaveResult, String> {
    let path = absolute(&path)?;
    blocking(move || {
        match write_config(&path, &text, revision.as_deref(), force)? {
            WriteOutcome::Conflict(current) => Ok(SingboxSaveResult { status: "conflict".into(), revision: current }),
            WriteOutcome::Saved(rev) => {
                let mut store = load_store();
                let display = path.display().to_string();
                let key = file_key(&display);
                if has_notes(&meta) {
                    store.files.insert(key, meta);
                } else {
                    store.files.remove(&key);
                }
                remember(&mut store, &display);
                save_store(&store)?;
                Ok(SingboxSaveResult { status: "saved".into(), revision: rev })
            }
        }
    })
    .await?
}

/// The current revision of a file (None when it's gone), to notice outside edits.
#[tauri::command]
pub async fn singbox_revision(path: String) -> Result<Option<String>, String> {
    let path = absolute(&path)?;
    blocking(move || fs::read(&path).ok().map(|bytes| revision(&bytes))).await
}

#[tauri::command]
pub async fn singbox_forget(path: String) -> Result<(), String> {
    blocking(move || {
        let mut store = load_store();
        let key = file_key(&path);
        store.recent.retain(|p| file_key(p) != key);
        save_store(&store)
    })
    .await?
}

/// Use a specific sing-box binary for checks (None goes back to automatic detection).
#[tauri::command]
pub async fn singbox_set_binary(path: Option<String>) -> Result<Option<SingboxBinary>, String> {
    blocking(move || {
        let mut store = load_store();
        match path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty()) {
            Some(p) => {
                let bin = PathBuf::from(&p);
                if !bin.is_file() {
                    return Err(format!("{} doesn't exist", p));
                }
                if is_gui_app(&bin) {
                    return Err(format!(
                        "{} is a graphical sing-box app. Choose the sing-box command-line program (from the sing-box releases on GitHub) instead.",
                        p
                    ));
                }
                let version = binary_version(&bin).ok_or_else(|| format!("{} doesn't look like the sing-box command-line program", p))?;
                store.binary = Some(p.clone());
                save_store(&store)?;
                Ok(Some(SingboxBinary { path: p, version: Some(version) }))
            }
            None => {
                store.binary = None;
                save_store(&store)?;
                Ok(binary_info(&store, None))
            }
        }
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sshui-singbox-test-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn electron_apps_are_not_run() {
        let dir = temp_dir("gui");
        let exe = dir.join("sing-box.exe");
        fs::write(&exe, b"not really").unwrap();
        assert!(!is_gui_app(&exe));
        fs::write(dir.join("resources.pak"), b"").unwrap();
        assert!(is_gui_app(&exe));
        assert_eq!(binary_version(&exe), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn revision_tracks_content() {
        assert_eq!(revision(b"{}"), revision(b"{}"));
        assert_ne!(revision(b"{}"), revision(b"{ }"));
    }

    #[test]
    fn write_refuses_when_changed_elsewhere() {
        let dir = temp_dir("conflict");
        let file = dir.join("config.json");
        fs::write(&file, "{\"a\":1}").unwrap();
        let (_, rev) = read_config(&file).unwrap();

        // Someone else edits the file
        fs::write(&file, "{\"a\":2}").unwrap();
        let outcome = write_config(&file, "{\"a\":3}", Some(&rev), false).unwrap();
        assert!(matches!(outcome, WriteOutcome::Conflict(_)));
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"a\":2}");

        // Forcing overwrites and keeps a backup of what was there
        let outcome = write_config(&file, "{\"a\":3}", Some(&rev), true).unwrap();
        assert_eq!(outcome, WriteOutcome::Saved(revision(b"{\"a\":3}")));
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\"a\":3}");
        assert_eq!(fs::read_to_string(dir.join("config.json.sshui-bak")).unwrap(), "{\"a\":2}");
        assert!(!dir.join("config.json.sshui-tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_saves_when_unchanged() {
        let dir = temp_dir("save");
        let file = dir.join("config.json");
        fs::write(&file, "\u{feff}{}").unwrap();
        let (text, rev) = read_config(&file).unwrap();
        assert_eq!(text, "{}");
        let outcome = write_config(&file, "{\n  \"log\": {}\n}\n", Some(&rev), false).unwrap();
        assert!(matches!(outcome, WriteOutcome::Saved(_)));
        assert_eq!(fs::read_to_string(&file).unwrap(), "{\n  \"log\": {}\n}\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn keys_ignore_case_and_slashes_on_windows() {
        if cfg!(windows) {
            assert_eq!(file_key("C:/Users/A/config.json"), file_key("c:\\users\\a\\CONFIG.json"));
        }
    }

    #[test]
    fn empty_notes_are_not_kept() {
        assert!(!has_notes(&Value::Null));
        assert!(!has_notes(&serde_json::json!({ "hidden": {}, "disabled": [] })));
        assert!(has_notes(&serde_json::json!({ "hidden": { "a": [] }, "disabled": [] })));
    }

    #[test]
    fn recent_list_is_deduplicated_and_capped() {
        let mut store = Store::default();
        for i in 0..12 {
            remember(&mut store, &format!("/cfg/{}.json", i));
        }
        remember(&mut store, "/cfg/5.json");
        assert_eq!(store.recent.len(), RECENT_LIMIT);
        assert_eq!(store.recent[0], "/cfg/5.json");
        assert_eq!(store.recent.iter().filter(|p| p.as_str() == "/cfg/5.json").count(), 1);
    }
}
