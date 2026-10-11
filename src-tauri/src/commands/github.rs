//! GitHub integration: GitHub CLI login, SSH access to github.com, git identity and
//! git's global proxy. Everything goes through the user's own `gh`, `git` and `ssh`
//! binaries, so the app never stores a token itself.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Emitted during `github_login` with `{ code, url }` once gh prints the device code.
pub const LOGIN_CODE_EVENT: &str = "github-login-code";

const DEVICE_URL: &str = "https://github.com/login/device";

static LOGIN_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    // Never let git/gh/ssh wait on a prompt nobody can see
    cmd.env("GIT_TERMINAL_PROMPT", "0").env("GH_PROMPT_DISABLED", "1").stdin(Stdio::null());
    cmd
}

fn run(program: &str, args: &[&str]) -> Option<Output> {
    command(program).args(args).output().ok()
}

fn stdout_line(output: &Output) -> Option<String> {
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// Run with a deadline; the process is killed when it overruns.
fn run_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, String> {
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_) => return child.wait_with_output().map_err(|e| e.to_string()),
            None if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("timeout".to_string());
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

// ── Status ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct GhAccount {
    pub login: String,
    pub active: bool,
    pub state: String,
    pub token_source: String,
    pub scopes: Vec<String>,
    pub git_protocol: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GhStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub accounts: Vec<GhAccount>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub user_name: Option<String>,
    pub user_email: Option<String>,
    pub http_proxy: Option<String>,
    pub https_proxy: Option<String>,
    /// Credential helper git uses for https://github.com
    pub credential_helper: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GithubStatus {
    pub gh: GhStatus,
    pub git: GitStatus,
    /// Proxy environment variables seen by the app (and so by gh/git it runs)
    pub env_proxy: HashMap<String, String>,
    pub known_host: bool,
}

#[derive(Deserialize)]
struct GhAuthJson {
    hosts: HashMap<String, Vec<GhAuthEntry>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GhAuthEntry {
    #[serde(default)]
    login: String,
    #[serde(default)]
    active: bool,
    #[serde(default)]
    state: String,
    #[serde(default)]
    token_source: String,
    #[serde(default)]
    scopes: String,
    #[serde(default)]
    git_protocol: String,
}

fn parse_gh_accounts(json: &str) -> Vec<GhAccount> {
    let Ok(parsed) = serde_json::from_str::<GhAuthJson>(json) else {
        return Vec::new();
    };
    parsed
        .hosts
        .get("github.com")
        .into_iter()
        .flatten()
        .filter(|e| !e.login.is_empty())
        .map(|e| GhAccount {
            login: e.login.clone(),
            active: e.active,
            state: e.state.clone(),
            token_source: e.token_source.clone(),
            scopes: e
                .scopes
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            git_protocol: e.git_protocol.clone(),
        })
        .collect()
}

fn gh_status() -> GhStatus {
    let version = run("gh", &["--version"]).filter(|o| o.status.success()).and_then(|o| {
        stdout_line(&o).and_then(|s| s.lines().next().map(|l| l.trim_start_matches("gh version ").to_string()))
    });
    if version.is_none() {
        return GhStatus { installed: false, version: None, accounts: Vec::new() };
    }
    // Exits non-zero when logged out but still prints JSON
    let accounts = run("gh", &["auth", "status", "--hostname", "github.com", "--json", "hosts"])
        .map(|o| parse_gh_accounts(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default();
    GhStatus { installed: true, version, accounts }
}

fn git_config(key: &str) -> Option<String> {
    run("git", &["config", "--global", "--get", key]).and_then(|o| stdout_line(&o))
}

fn git_status() -> GitStatus {
    let version = run("git", &["--version"])
        .filter(|o| o.status.success())
        .and_then(|o| stdout_line(&o))
        .map(|s| s.trim_start_matches("git version ").to_string());
    let credential_helper = run("git", &["config", "--get-urlmatch", "credential.helper", "https://github.com"])
        .and_then(|o| stdout_line(&o))
        .and_then(|s| s.lines().last().map(str::to_string));
    GitStatus {
        installed: version.is_some(),
        version,
        user_name: git_config("user.name"),
        user_email: git_config("user.email"),
        http_proxy: git_config("http.proxy"),
        https_proxy: git_config("https.proxy"),
        credential_helper,
    }
}

fn env_proxy() -> HashMap<String, String> {
    ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"]
        .iter()
        .filter_map(|name| {
            std::env::var(name)
                .or_else(|_| std::env::var(name.to_lowercase()))
                .ok()
                .filter(|v| !v.is_empty())
                .map(|v| (name.to_string(), v))
        })
        .collect()
}

#[tauri::command]
pub async fn github_status() -> Result<GithubStatus, String> {
    blocking(|| GithubStatus {
        gh: gh_status(),
        git: git_status(),
        env_proxy: env_proxy(),
        known_host: github_is_known_host(),
    })
    .await
}

// ── Login ─────────────────────────────────────────────────────────────────────

fn open_url(url: &str) {
    #[cfg(windows)]
    let _ = command("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = Command::new("xdg-open").arg(url).spawn();
}

/// Remove ANSI colour sequences (ESC [ ... letter).
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Extract the device code from gh's "! First copy your one-time code: ABCD-1234" line.
fn parse_device_code(line: &str) -> Option<String> {
    let line = strip_ansi(line);
    let code = line.split("one-time code:").nth(1)?.split_whitespace().next()?;
    (code.len() >= 8 && code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then(|| code.to_string())
}

/// Browser (device-flow) login through the GitHub CLI. Emits LOGIN_CODE_EVENT with the
/// one-time code and opens the verification page, then waits for gh to finish.
#[tauri::command]
pub async fn github_login(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        let mut child = command("gh")
            .args(["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start GitHub CLI: {}", e))?;

        // gh prints the code on stderr; collect both streams for error reporting
        let stderr = child.stderr.take();
        let stdout = child.stdout.take();
        *LOGIN_CHILD.lock().map_err(|e| e.to_string())? = Some(child);

        let mut log = String::new();
        if let Some(stderr) = stderr {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Some(code) = parse_device_code(&line) {
                    let _ = app.emit(LOGIN_CODE_EVENT, serde_json::json!({ "code": code, "url": DEVICE_URL }));
                    open_url(DEVICE_URL);
                }
                log.push_str(&line);
                log.push('\n');
            }
        }
        if let Some(mut stdout) = stdout {
            let _ = std::io::Read::read_to_string(&mut stdout, &mut log);
        }

        let child = LOGIN_CHILD.lock().map_err(|e| e.to_string())?.take();
        let Some(mut child) = child else {
            return Err("cancelled".to_string());
        };
        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(log.trim().lines().last().unwrap_or("GitHub login failed").to_string());
        }
        // Let git use this account for https://github.com (what gh's interactive login offers)
        let _ = run("gh", &["auth", "setup-git", "--hostname", "github.com"]);
        Ok(())
    })
    .await?
}

#[tauri::command]
pub async fn github_login_cancel() -> Result<(), String> {
    if let Some(mut child) = LOGIN_CHILD.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
pub async fn github_logout(login: String) -> Result<(), String> {
    blocking(move || {
        let output = run("gh", &["auth", "logout", "--hostname", "github.com", "--user", &login])
            .ok_or("Failed to run GitHub CLI")?;
        if output.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
    })
    .await?
}

// ── SSH access ────────────────────────────────────────────────────────────────

fn known_hosts_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".ssh").join("known_hosts"))
}

/// Whether known_hosts has github.com. `ssh-keygen -F` also matches hashed entries;
/// the plain-text check is a fallback when ssh-keygen isn't available.
fn github_is_known_host() -> bool {
    let Some(path) = known_hosts_path().filter(|p| p.exists()) else {
        return false;
    };
    let path_str = path.to_string_lossy().to_string();
    match run("ssh-keygen", &["-F", "github.com", "-f", &path_str]) {
        Some(output) => output.status.success(),
        None => fs::read_to_string(&path).is_ok_and(|c| has_github_entry(&c)),
    }
}

fn has_github_entry(known_hosts: &str) -> bool {
    known_hosts.lines().any(|line| {
        line.split_whitespace()
            .next()
            .is_some_and(|hosts| hosts.split(',').any(|h| h == "github.com"))
    })
}

/// GitHub's SSH host keys from the HTTPS-authenticated meta API, via gh or curl.
fn github_host_keys() -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct Meta {
        ssh_keys: Vec<String>,
    }
    let attempts: [(&str, &[&str]); 2] = [
        ("gh", &["api", "meta"]),
        ("curl", &["-fsSL", "--max-time", "15", "https://api.github.com/meta"]),
    ];
    for (program, args) in attempts {
        if let Some(output) = run(program, args).filter(|o| o.status.success()) {
            if let Ok(meta) = serde_json::from_slice::<Meta>(&output.stdout) {
                if !meta.ssh_keys.is_empty() {
                    return Ok(meta.ssh_keys);
                }
            }
        }
    }
    Err("Could not download GitHub's SSH host keys (check your network or proxy)".to_string())
}

fn known_hosts_lines(keys: &[String]) -> Vec<String> {
    keys.iter()
        .flat_map(|key| [format!("github.com {}", key), format!("[ssh.github.com]:443 {}", key)])
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct SshTestResult {
    /// "ok", "denied", "network" or "error"
    pub status: String,
    pub user: Option<String>,
    pub message: String,
}

fn classify_ssh_output(text: &str) -> SshTestResult {
    // Success: "Hi <user>! You've successfully authenticated, but GitHub does not provide shell access."
    if let Some(rest) = text.split("Hi ").nth(1) {
        if let Some(user) = rest.split('!').next().filter(|u| !u.contains(char::is_whitespace)) {
            return SshTestResult { status: "ok".into(), user: Some(user.to_string()), message: text.trim().into() };
        }
    }
    let status = if text.contains("Permission denied") {
        "denied"
    } else if ["Could not resolve", "timed out", "Connection refused", "Network is unreachable", "Connection closed"]
        .iter()
        .any(|s| text.contains(s))
    {
        "network"
    } else {
        "error"
    };
    SshTestResult { status: status.into(), user: None, message: text.trim().into() }
}

/// `ssh -T git@github.com` using the user's ssh config, but verifying the server
/// against GitHub's published host keys in a temporary known_hosts file.
#[tauri::command]
pub async fn github_ssh_test() -> Result<SshTestResult, String> {
    blocking(|| {
        let keys = github_host_keys()?;
        let temp = std::env::temp_dir().join(format!("sshui-github-known-hosts-{}", std::process::id()));
        fs::write(&temp, known_hosts_lines(&keys).join("\n") + "\n").map_err(|e| e.to_string())?;

        let mut cmd = command("ssh");
        cmd.args(["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=yes"])
            .arg("-o")
            .arg(format!("UserKnownHostsFile={}", temp.display()))
            .arg("git@github.com");
        let result = run_with_timeout(cmd, Duration::from_secs(25));
        let _ = fs::remove_file(&temp);

        Ok(match result {
            Ok(output) => {
                let mut text = String::from_utf8_lossy(&output.stderr).to_string();
                text.push_str(&String::from_utf8_lossy(&output.stdout));
                classify_ssh_output(&text)
            }
            Err(e) if e == "timeout" => SshTestResult {
                status: "network".into(),
                user: None,
                message: "Connection to github.com timed out".into(),
            },
            Err(e) => SshTestResult { status: "error".into(), user: None, message: e },
        })
    })
    .await?
}

/// Add GitHub's published host keys to ~/.ssh/known_hosts (skipping ones already there).
#[tauri::command]
pub async fn github_trust_host_keys() -> Result<usize, String> {
    blocking(|| {
        let keys = github_host_keys()?;
        let path = known_hosts_path().ok_or("Failed to get home directory")?;
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let existing = fs::read_to_string(&path).unwrap_or_default();
        let missing: Vec<String> = known_hosts_lines(&keys)
            .into_iter()
            .filter(|line| !existing.lines().any(|l| l.trim() == line))
            .collect();
        if missing.is_empty() {
            return Ok(0);
        }
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        let prefix = if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" };
        writeln!(file, "{}{}", prefix, missing.join("\n")).map_err(|e| e.to_string())?;
        Ok(missing.len())
    })
    .await?
}

// ── Git identity and proxy ────────────────────────────────────────────────────

fn git_set(key: &str, value: Option<&str>) -> Result<(), String> {
    let output = match value.map(str::trim).filter(|v| !v.is_empty()) {
        Some(v) => run("git", &["config", "--global", key, v]),
        None => run("git", &["config", "--global", "--unset-all", key]),
    }
    .ok_or("Failed to run git")?;
    // Exit code 5 = unsetting a key that isn't set
    if output.status.success() || (value.is_none() && output.status.code() == Some(5)) {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn github_set_git_identity(name: String, email: String) -> Result<(), String> {
    blocking(move || {
        git_set("user.name", Some(&name).filter(|s| !s.trim().is_empty()).map(|s| s.as_str()))?;
        git_set("user.email", Some(&email).filter(|s| !s.trim().is_empty()).map(|s| s.as_str()))
    })
    .await?
}

/// Set (or clear, with `None`) git's global http.proxy and https.proxy.
#[tauri::command]
pub async fn github_set_git_proxy(proxy: Option<String>) -> Result<(), String> {
    blocking(move || {
        let value = proxy.as_deref().map(str::trim).filter(|v| !v.is_empty());
        if let Some(v) = value {
            proxy_address(v)?;
        }
        git_set("http.proxy", value)?;
        git_set("https.proxy", value)
    })
    .await?
}

/// `host:port` of a proxy URL such as `http://127.0.0.1:7890` or `socks5://host:1080`.
fn proxy_address(proxy: &str) -> Result<(String, u16), String> {
    let without_scheme = proxy.split("://").nth(1).unwrap_or(proxy);
    let authority = without_scheme.split('/').next().unwrap_or_default();
    let host_port = authority.rsplit('@').next().unwrap_or_default();
    let default_port = if proxy.starts_with("socks") { 1080 } else { 80 };
    let invalid = || format!("Invalid proxy address \"{}\"", proxy);
    let parse_port = |p: &str| p.parse::<u16>().map_err(|_| format!("Invalid proxy port in \"{}\"", proxy));
    let (host, port) = if let Some(rest) = host_port.strip_prefix('[') {
        // [ipv6] or [ipv6]:port
        let (host, after) = rest.split_once(']').ok_or_else(invalid)?;
        match after.strip_prefix(':') {
            Some(p) => (host, parse_port(p)?),
            None if after.is_empty() => (host, default_port),
            None => return Err(invalid()),
        }
    } else {
        match host_port.rsplit_once(':') {
            Some((host, p)) => (host, parse_port(p)?),
            None => (host_port, default_port),
        }
    };
    if host.is_empty() {
        return Err(format!("Invalid proxy address \"{}\"", proxy));
    }
    Ok((host.to_string(), port))
}

#[derive(Debug, Clone, Serialize)]
pub struct ProxyTestResult {
    /// The proxy port accepts TCP connections
    pub reachable: bool,
    /// `git ls-remote` against github.com succeeded through the proxy
    pub github_ok: bool,
    pub elapsed_ms: u64,
    pub message: String,
}

/// Check a proxy (or a direct connection when `proxy` is empty) end-to-end with git.
#[tauri::command]
pub async fn github_test_proxy(proxy: Option<String>) -> Result<ProxyTestResult, String> {
    blocking(move || {
        let proxy = proxy.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
        if let Some(p) = &proxy {
            let (host, port) = proxy_address(p)?;
            let reachable = (host.as_str(), port)
                .to_socket_addrs()
                .ok()
                .and_then(|mut addrs| addrs.next())
                .is_some_and(|addr| TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok());
            if !reachable {
                return Ok(ProxyTestResult {
                    reachable: false,
                    github_ok: false,
                    elapsed_ms: 0,
                    message: format!("Nothing is listening on {}:{}", host, port),
                });
            }
        }

        let mut cmd = command("git");
        cmd.arg("-c").arg(format!("http.proxy={}", proxy.as_deref().unwrap_or("")));
        cmd.args(["ls-remote", "--exit-code", "https://github.com/github/gitignore.git", "HEAD"]);
        let start = Instant::now();
        let result = run_with_timeout(cmd, Duration::from_secs(20));
        let elapsed_ms = start.elapsed().as_millis() as u64;
        Ok(match result {
            Ok(o) if o.status.success() => {
                ProxyTestResult { reachable: true, github_ok: true, elapsed_ms, message: String::new() }
            }
            Ok(o) => ProxyTestResult {
                reachable: true,
                github_ok: false,
                elapsed_ms,
                message: String::from_utf8_lossy(&o.stderr).trim().lines().last().unwrap_or("").to_string(),
            },
            Err(_) => ProxyTestResult {
                reachable: true,
                github_ok: false,
                elapsed_ms,
                message: "Timed out reaching github.com".into(),
            },
        })
    })
    .await?
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links can be opened".into());
    }
    open_url(&url);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gh_status_json() {
        let json = r#"{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"octo","tokenSource":"keyring","scopes":"gist, read:org, repo","gitProtocol":"https"}]}}"#;
        let accounts = parse_gh_accounts(json);
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].login, "octo");
        assert_eq!(accounts[0].scopes, vec!["gist", "read:org", "repo"]);
        assert!(parse_gh_accounts(r#"{"hosts":{}}"#).is_empty());
        assert!(parse_gh_accounts("not json").is_empty());
    }

    #[test]
    fn parses_device_code() {
        assert_eq!(parse_device_code("! First copy your one-time code: A816-29DD").as_deref(), Some("A816-29DD"));
        assert_eq!(
            parse_device_code("\u{1b}[0;33m!\u{1b}[0m First copy your one-time code: \u{1b}[1mAB12-CD34\u{1b}[0m").as_deref(),
            Some("AB12-CD34")
        );
        assert_eq!(parse_device_code("Open this URL to continue"), None);
    }

    #[test]
    fn classifies_ssh_results() {
        let ok = classify_ssh_output("Hi octo! You've successfully authenticated, but GitHub does not provide shell access.");
        assert_eq!((ok.status.as_str(), ok.user.as_deref()), ("ok", Some("octo")));
        assert_eq!(classify_ssh_output("git@github.com: Permission denied (publickey).").status, "denied");
        assert_eq!(classify_ssh_output("ssh: Could not resolve hostname github.com").status, "network");
        assert_eq!(classify_ssh_output("Host key verification failed.").status, "error");
    }

    #[test]
    fn detects_github_known_host() {
        assert!(has_github_entry("github.com ssh-ed25519 AAAA\n"));
        assert!(has_github_entry("gitlab.com ssh-rsa X\ngithub.com,140.82.112.3 ssh-rsa Y\n"));
        assert!(!has_github_entry("|1|hashed= ssh-ed25519 AAAA\nexample.com ssh-rsa Z\n"));
    }

    #[test]
    fn parses_proxy_addresses() {
        assert_eq!(proxy_address("http://127.0.0.1:7890").unwrap(), ("127.0.0.1".into(), 7890));
        assert_eq!(proxy_address("socks5://user:pw@proxy.local:1081/").unwrap(), ("proxy.local".into(), 1081));
        assert_eq!(proxy_address("http://proxy.local").unwrap(), ("proxy.local".into(), 80));
        assert_eq!(proxy_address("http://[::1]:8080").unwrap(), ("::1".into(), 8080));
        assert!(proxy_address("http://:8080").is_err());
        assert!(proxy_address("http://host:notaport").is_err());
    }
}
