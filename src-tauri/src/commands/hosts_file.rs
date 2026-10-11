//! System hosts file editing and switchable hosts "schemes".
//!
//! Schemes are named, complete hosts files stored in `~/.ssh-at/hosts-schemes.json`.
//! Applying a scheme writes its content to the system hosts file, asking the OS for
//! administrator rights when a direct write is denied. The previous hosts file is
//! backed up to `~/.ssh-at/hosts-backups/` before every write.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

/// Emitted to the frontend whenever schemes or the hosts file change outside the page
/// (e.g. a switch from the tray menu).
pub const STATE_CHANGED_EVENT: &str = "hosts-state-changed";

const STORE_FILE: &str = "hosts-schemes.json";
const BACKUP_DIR: &str = "hosts-backups";

// Serializes read-modify-write cycles on the scheme store and the hosts file.
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HostsScheme {
    pub id: String,
    pub name: String,
    pub content: String,
    /// Unix timestamp in milliseconds
    pub updated_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SchemeStore {
    active_id: Option<String>,
    schemes: Vec<HostsScheme>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostsState {
    pub hosts_path: String,
    pub system_content: String,
    pub active_id: Option<String>,
    pub schemes: Vec<HostsScheme>,
}

// ── Paths ─────────────────────────────────────────────────────────────────────

pub fn system_hosts_path() -> PathBuf {
    #[cfg(windows)]
    {
        let root = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        root.join("System32").join("drivers").join("etc").join("hosts")
    }
    #[cfg(not(windows))]
    {
        PathBuf::from("/etc/hosts")
    }
}

fn data_dir() -> Result<PathBuf, String> {
    let dir = dirs::home_dir()
        .ok_or("Failed to get home directory")?
        .join(".ssh-at");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// ── Text helpers ──────────────────────────────────────────────────────────────

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn new_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{:x}", nanos)
}

/// Normalize to LF line endings and strip a UTF-8 BOM.
fn normalize(content: &str) -> String {
    content
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

/// Content as written to disk: trailing newline, CRLF on Windows.
fn to_platform_bytes(content: &str) -> Vec<u8> {
    let mut text = normalize(content);
    if !text.ends_with('\n') {
        text.push('\n');
    }
    if cfg!(windows) {
        text = text.replace('\n', "\r\n");
    }
    text.into_bytes()
}

fn same_content(a: &str, b: &str) -> bool {
    normalize(a).trim_end() == normalize(b).trim_end()
}

// ── Scheme store ──────────────────────────────────────────────────────────────

/// Load the scheme store. On first use it is seeded with a "Default" scheme holding
/// the current system hosts file, so the original can always be switched back to.
fn load_store(dir: &Path, system_content: &str) -> Result<SchemeStore, String> {
    let path = dir.join(STORE_FILE);
    if path.exists() {
        let raw = fs::read_to_string(&path).map_err(|e| format!("Failed to read hosts schemes: {}", e))?;
        return serde_json::from_str(&raw).map_err(|e| format!("Failed to parse hosts schemes: {}", e));
    }

    let default = HostsScheme {
        id: new_id(),
        name: "Default".to_string(),
        content: normalize(system_content),
        updated_at: now_millis(),
    };
    let store = SchemeStore {
        active_id: Some(default.id.clone()),
        schemes: vec![default],
    };
    save_store(dir, &store)?;
    Ok(store)
}

fn save_store(dir: &Path, store: &SchemeStore) -> Result<(), String> {
    let path = dir.join(STORE_FILE);
    let tmp = dir.join(format!("{}.tmp", STORE_FILE));
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| format!("Failed to write hosts schemes: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Failed to write hosts schemes: {}", e))
}

fn upsert_scheme(
    store: &mut SchemeStore,
    id: Option<String>,
    name: &str,
    content: &str,
) -> Result<HostsScheme, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Scheme name is required".to_string());
    }
    if store
        .schemes
        .iter()
        .any(|s| s.name.eq_ignore_ascii_case(name) && Some(&s.id) != id.as_ref())
    {
        return Err(format!("A scheme named \"{}\" already exists", name));
    }

    let content = normalize(content);
    match id {
        Some(id) => {
            let scheme = store
                .schemes
                .iter_mut()
                .find(|s| s.id == id)
                .ok_or("Scheme not found")?;
            scheme.name = name.to_string();
            scheme.content = content;
            scheme.updated_at = now_millis();
            Ok(scheme.clone())
        }
        None => {
            let scheme = HostsScheme {
                id: new_id(),
                name: name.to_string(),
                content,
                updated_at: now_millis(),
            };
            store.schemes.push(scheme.clone());
            Ok(scheme)
        }
    }
}

fn remove_scheme(store: &mut SchemeStore, id: &str) -> Result<(), String> {
    let before = store.schemes.len();
    store.schemes.retain(|s| s.id != id);
    if store.schemes.len() == before {
        return Err("Scheme not found".to_string());
    }
    if store.active_id.as_deref() == Some(id) {
        store.active_id = None;
    }
    Ok(())
}

// ── System hosts file ─────────────────────────────────────────────────────────

fn read_system_hosts(path: &Path) -> Result<String, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(normalize(&String::from_utf8_lossy(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
    }
}

fn backup_system_hosts(dir: &Path, hosts_path: &Path, keep: usize) -> Result<(), String> {
    let Ok(current) = fs::read(hosts_path) else {
        return Ok(()); // nothing to back up
    };
    let backup_dir = dir.join(BACKUP_DIR);
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    fs::write(backup_dir.join(format!("hosts_{}.bak", now_millis())), current)
        .map_err(|e| format!("Failed to back up hosts file: {}", e))?;

    // Prune oldest backups (names sort chronologically)
    let mut backups: Vec<PathBuf> = fs::read_dir(&backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("hosts_")))
        .collect();
    backups.sort();
    let excess = backups.len().saturating_sub(keep.max(1));
    for old in backups.into_iter().take(excess) {
        let _ = fs::remove_file(old);
    }
    Ok(())
}

fn is_permission_error(e: &std::io::Error) -> bool {
    // 5 = ERROR_ACCESS_DENIED on Windows (also raised for read-only files)
    e.kind() == std::io::ErrorKind::PermissionDenied || (cfg!(windows) && e.raw_os_error() == Some(5))
}

/// Write `content` to the system hosts file, elevating if needed, then verify it landed.
fn write_system_hosts(hosts_path: &Path, content: &str) -> Result<(), String> {
    let bytes = to_platform_bytes(content);
    match fs::write(hosts_path, &bytes) {
        Ok(()) => flush_dns(),
        Err(e) if is_permission_error(&e) => elevated::write(hosts_path, &bytes)?,
        Err(e) => return Err(format!("Failed to write {}: {}", hosts_path.display(), e)),
    }

    let written = read_system_hosts(hosts_path)?;
    if !same_content(&written, content) {
        return Err(
            "The hosts file was not updated. It may be locked by security software.".to_string(),
        );
    }
    Ok(())
}

#[cfg(windows)]
fn hidden(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

#[cfg(not(windows))]
fn hidden(cmd: &mut Command) -> &mut Command {
    cmd
}

/// Best-effort DNS cache flush after a direct (non-elevated) write.
#[cfg(test)]
fn flush_dns() {}

/// Best-effort DNS cache flush after a direct (non-elevated) write.
#[cfg(not(test))]
fn flush_dns() {
    #[cfg(windows)]
    let _ = hidden(Command::new("ipconfig").arg("/flushdns")).status();
    #[cfg(target_os = "macos")]
    let _ = Command::new("dscacheutil").arg("-flushcache").status();
    #[cfg(target_os = "linux")]
    let _ = Command::new("resolvectl").arg("flush-caches").status();
}

fn temp_file(ext: &str) -> PathBuf {
    std::env::temp_dir().join(format!("sshui-hosts-{}.{}", new_id(), ext))
}

const CANCELLED: &str = "Administrator permission was not granted. The hosts file was not changed.";

#[cfg(windows)]
mod elevated {
    use super::{hidden, temp_file, CANCELLED};
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    fn ps_quote(p: &Path) -> String {
        format!("'{}'", p.display().to_string().replace('\'', "''"))
    }

    // Windows PowerShell 5.1 reads BOM-less scripts as ANSI; the BOM keeps non-ASCII
    // paths (e.g. a Chinese user name) intact.
    pub(super) fn write_script(path: &Path, body: &str) -> std::io::Result<()> {
        fs::write(path, format!("\u{feff}{}", body))
    }

    /// Script run with administrator rights: copies `data` over `target`, clearing a
    /// read-only attribute first, then flushes the DNS cache.
    pub(super) fn inner_script(target: &Path, data: &Path) -> String {
        format!(
            "$ErrorActionPreference = 'Stop'\n\
             try {{\n\
               $dst = {dst}\n\
               $item = Get-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue\n\
               if ($item -and $item.IsReadOnly) {{ $item.IsReadOnly = $false }}\n\
               [System.IO.File]::WriteAllBytes($dst, [System.IO.File]::ReadAllBytes({src}))\n\
               ipconfig /flushdns | Out-Null\n\
               exit 0\n\
             }} catch {{ exit 1 }}\n",
            dst = ps_quote(target),
            src = ps_quote(data),
        )
    }

    /// Unelevated launcher: shows the UAC prompt and runs `inner` as administrator.
    /// UAC denial throws from Start-Process; it is reported as ERROR_CANCELLED (1223).
    pub(super) fn outer_script(inner: &Path) -> String {
        format!(
            "$inner = {inner}\n\
             try {{\n\
               $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden \
             -ArgumentList ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"' + $inner + '\"')\n\
               exit $p.ExitCode\n\
             }} catch {{ exit 1223 }}\n",
            inner = ps_quote(inner),
        )
    }

    pub fn write(target: &Path, bytes: &[u8]) -> Result<(), String> {
        let data = temp_file("txt");
        let inner = temp_file("ps1");
        let outer = temp_file("ps1");
        let cleanup = || {
            for p in [&data, &inner, &outer] {
                let _ = fs::remove_file(p);
            }
        };

        let result = (|| {
            fs::write(&data, bytes).map_err(|e| e.to_string())?;
            write_script(&inner, &inner_script(target, &data)).map_err(|e| e.to_string())?;
            write_script(&outer, &outer_script(&inner)).map_err(|e| e.to_string())?;

            let status = hidden(
                Command::new("powershell.exe")
                    .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                    .arg(&outer),
            )
            .status()
            .map_err(|e| format!("Failed to request administrator rights: {}", e))?;

            match status.code() {
                Some(0) => Ok(()),
                Some(1223) => Err(CANCELLED.to_string()),
                code => Err(format!(
                    "Failed to write the hosts file with administrator rights (exit code {})",
                    code.map(|c| c.to_string()).unwrap_or_else(|| "unknown".into())
                )),
            }
        })();

        cleanup();
        result
    }
}

#[cfg(target_os = "macos")]
mod elevated {
    use super::{temp_file, CANCELLED};
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    fn sh_quote(p: &Path) -> String {
        format!("'{}'", p.display().to_string().replace('\'', "'\\''"))
    }

    pub fn write(target: &Path, bytes: &[u8]) -> Result<(), String> {
        let data = temp_file("txt");
        fs::write(&data, bytes).map_err(|e| e.to_string())?;

        let shell = format!(
            "/bin/cp {} {} && {{ /usr/bin/dscacheutil -flushcache; /usr/bin/killall -HUP mDNSResponder; true; }}",
            sh_quote(&data),
            sh_quote(target)
        );
        let script = format!(
            "do shell script \"{}\" with administrator privileges with prompt \"SSHUI needs to update the hosts file.\"",
            shell.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let output = Command::new("osascript").arg("-e").arg(script).output();
        let _ = fs::remove_file(&data);

        let output = output.map_err(|e| format!("Failed to request administrator rights: {}", e))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("-128") {
            return Err(CANCELLED.to_string());
        }
        Err(format!("Failed to write the hosts file: {}", stderr.trim()))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod elevated {
    use super::{temp_file, CANCELLED};
    use std::fs;
    use std::path::Path;
    use std::process::Command;

    pub fn write(target: &Path, bytes: &[u8]) -> Result<(), String> {
        let data = temp_file("txt");
        fs::write(&data, bytes).map_err(|e| e.to_string())?;
        let status = Command::new("pkexec").arg("/bin/cp").arg(&data).arg(target).status();
        let _ = fs::remove_file(&data);

        match status.map_err(|e| format!("Failed to run pkexec: {}", e))?.code() {
            Some(0) => {
                let _ = Command::new("resolvectl").arg("flush-caches").status();
                Ok(())
            }
            // 126: authorization dismissed, 127: not authorized
            Some(126) | Some(127) => Err(CANCELLED.to_string()),
            code => Err(format!("Failed to write the hosts file (pkexec exit code {:?})", code)),
        }
    }
}

// ── Operations shared by commands and the tray ───────────────────────────────

async fn backup_limit() -> usize {
    super::settings::load_settings()
        .await
        .map(|s| s.backup_limit as usize)
        .unwrap_or(10)
}

fn state_in(dir: &Path, hosts_path: &Path) -> Result<HostsState, String> {
    let system_content = read_system_hosts(hosts_path)?;
    let store = load_store(dir, &system_content)?;
    Ok(HostsState {
        hosts_path: hosts_path.display().to_string(),
        system_content,
        active_id: store.active_id,
        schemes: store.schemes,
    })
}

pub fn load_state() -> Result<HostsState, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    state_in(&data_dir()?, &system_hosts_path())
}

/// Write a scheme to the system hosts file and mark it active. Blocks while the
/// OS elevation prompt is shown, so call it off the async runtime.
pub fn apply_scheme_blocking(id: &str, keep_backups: usize) -> Result<HostsState, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let dir = data_dir()?;
    let hosts_path = system_hosts_path();
    let system_content = read_system_hosts(&hosts_path)?;
    let mut store = load_store(&dir, &system_content)?;
    let scheme = store
        .schemes
        .iter()
        .find(|s| s.id == id)
        .cloned()
        .ok_or("Scheme not found")?;

    if !same_content(&system_content, &scheme.content) {
        backup_system_hosts(&dir, &hosts_path, keep_backups)?;
        write_system_hosts(&hosts_path, &scheme.content)?;
    }
    store.active_id = Some(scheme.id);
    save_store(&dir, &store)?;
    state_in(&dir, &hosts_path)
}

pub async fn apply_scheme(id: String) -> Result<HostsState, String> {
    let keep = backup_limit().await;
    tauri::async_runtime::spawn_blocking(move || apply_scheme_blocking(&id, keep))
        .await
        .map_err(|e| e.to_string())?
}

fn notify_changed(app: &AppHandle) {
    crate::tray::refresh_menu(app);
    let _ = app.emit(STATE_CHANGED_EVENT, ());
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn load_hosts_state() -> Result<HostsState, String> {
    load_state()
}

#[tauri::command]
pub async fn save_hosts_scheme(
    app: AppHandle,
    id: Option<String>,
    name: String,
    content: String,
) -> Result<HostsScheme, String> {
    let scheme = {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let dir = data_dir()?;
        let system_content = read_system_hosts(&system_hosts_path())?;
        let mut store = load_store(&dir, &system_content)?;
        let scheme = upsert_scheme(&mut store, id, &name, &content)?;
        save_store(&dir, &store)?;
        scheme
    };
    crate::tray::refresh_menu(&app);
    Ok(scheme)
}

#[tauri::command]
pub async fn delete_hosts_scheme(app: AppHandle, id: String) -> Result<(), String> {
    {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let dir = data_dir()?;
        let system_content = read_system_hosts(&system_hosts_path())?;
        let mut store = load_store(&dir, &system_content)?;
        remove_scheme(&mut store, &id)?;
        save_store(&dir, &store)?;
    }
    crate::tray::refresh_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn apply_hosts_scheme(app: AppHandle, id: String) -> Result<HostsState, String> {
    let result = apply_scheme(id).await;
    // Refresh even on failure so the tray check marks match reality again
    notify_changed(&app);
    result
}

/// Edit the system hosts file directly (not through a scheme).
#[tauri::command]
pub async fn save_system_hosts(app: AppHandle, content: String) -> Result<HostsState, String> {
    let keep = backup_limit().await;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        let dir = data_dir()?;
        let hosts_path = system_hosts_path();
        backup_system_hosts(&dir, &hosts_path, keep)?;
        write_system_hosts(&hosts_path, &content)?;
        state_in(&dir, &hosts_path)
    })
    .await
    .map_err(|e| e.to_string())?;
    notify_changed(&app);
    result
}

#[tauri::command]
pub async fn open_hosts_backup_dir() -> Result<(), String> {
    let dir = data_dir()?.join(BACKUP_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    super::system::open_path(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sshui-hosts-test-{}", new_id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn normalizes_line_endings_and_bom() {
        assert_eq!(normalize("\u{feff}a\r\nb\rc\n"), "a\nb\nc\n");
        assert!(same_content("127.0.0.1 a\r\n\r\n", "127.0.0.1 a"));
        assert!(!same_content("127.0.0.1 a", "127.0.0.1 b"));
    }

    #[test]
    fn platform_bytes_end_with_newline() {
        let bytes = to_platform_bytes("127.0.0.1 a");
        let expected: &[u8] = if cfg!(windows) { b"127.0.0.1 a\r\n" } else { b"127.0.0.1 a\n" };
        assert_eq!(bytes, expected);
    }

    #[test]
    fn first_load_seeds_default_scheme_from_system_hosts() {
        let dir = temp_dir();
        let store = load_store(&dir, "127.0.0.1 localhost\r\n").unwrap();
        assert_eq!(store.schemes.len(), 1);
        assert_eq!(store.schemes[0].name, "Default");
        assert_eq!(store.schemes[0].content, "127.0.0.1 localhost\n");
        assert_eq!(store.active_id.as_ref(), Some(&store.schemes[0].id));

        // Second load reads the saved store instead of reseeding
        let again = load_store(&dir, "something else").unwrap();
        assert_eq!(again.schemes, store.schemes);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn upsert_creates_updates_and_rejects_duplicates() {
        let mut store = SchemeStore::default();
        let dev = upsert_scheme(&mut store, None, " Dev ", "1.1.1.1 a").unwrap();
        assert_eq!(dev.name, "Dev");
        assert!(upsert_scheme(&mut store, None, "dev", "").is_err());
        assert!(upsert_scheme(&mut store, None, "   ", "").is_err());

        let renamed = upsert_scheme(&mut store, Some(dev.id.clone()), "Dev", "2.2.2.2 a\r\n").unwrap();
        assert_eq!(renamed.content, "2.2.2.2 a\n");
        assert_eq!(store.schemes.len(), 1);
        assert!(upsert_scheme(&mut store, Some("missing".into()), "X", "").is_err());
    }

    #[test]
    fn removing_active_scheme_clears_active() {
        let mut store = SchemeStore::default();
        let a = upsert_scheme(&mut store, None, "A", "").unwrap();
        store.active_id = Some(a.id.clone());
        remove_scheme(&mut store, &a.id).unwrap();
        assert!(store.schemes.is_empty());
        assert!(store.active_id.is_none());
        assert!(remove_scheme(&mut store, &a.id).is_err());
    }

    #[test]
    fn backups_are_pruned_to_limit() {
        let dir = temp_dir();
        let hosts = dir.join("hosts");
        fs::write(&hosts, "x").unwrap();
        for _ in 0..4 {
            backup_system_hosts(&dir, &hosts, 2).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        assert_eq!(fs::read_dir(dir.join(BACKUP_DIR)).unwrap().count(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    /// Runs the elevated-write script without elevation against a read-only file in a
    /// directory whose name contains a space, a quote and non-ASCII characters.
    #[cfg(windows)]
    #[test]
    fn elevated_script_overwrites_read_only_file() {
        let dir = std::env::temp_dir().join(format!("sshui test '主机' {}", new_id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("hosts");
        let data = dir.join("data.txt");
        let script = dir.join("inner.ps1");
        fs::write(&target, "old\r\n").unwrap();
        let mut perms = fs::metadata(&target).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&target, perms).unwrap();
        fs::write(&data, to_platform_bytes("10.0.0.2 elevated.test")).unwrap();
        elevated::write_script(&script, &elevated::inner_script(&target, &data)).unwrap();

        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script)
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(0));
        assert!(same_content(&read_system_hosts(&target).unwrap(), "10.0.0.2 elevated.test"));
        fs::remove_dir_all(dir).unwrap();
    }

    /// The UAC launcher can't run unattended; check that PowerShell parses it cleanly.
    #[cfg(windows)]
    #[test]
    fn elevation_launcher_script_parses() {
        let dir = std::env::temp_dir().join(format!("sshui test '主机' {}", new_id()));
        fs::create_dir_all(&dir).unwrap();
        let script = dir.join("outer.ps1");
        elevated::write_script(&script, &elevated::outer_script(&dir.join("inner.ps1"))).unwrap();

        let check = format!(
            "$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('{}', [ref]$null, [ref]$e); exit $e.Count",
            script.display().to_string().replace('\'', "''")
        );
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &check])
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(0));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writes_directly_when_permitted() {
        let dir = temp_dir();
        let hosts = dir.join("hosts");
        write_system_hosts(&hosts, "10.0.0.1 example.test").unwrap();
        assert!(same_content(&read_system_hosts(&hosts).unwrap(), "10.0.0.1 example.test"));
        fs::remove_dir_all(dir).unwrap();
    }
}
