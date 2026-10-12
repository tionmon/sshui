//! AI coding agents: Codex CLI (~/.codex/config.toml, AGENTS.md, prompts, skills) and
//! Claude Code (~/.claude/settings.json, CLAUDE.md, agents, commands, output styles,
//! skills).
//!
//! Instruction files are plain Markdown inside the agent's home directory; only the
//! documented locations can be read or written. Config files are validated before they
//! are saved and the previous version is kept next to them as `<file>.sshui-bak`.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use toml_edit::{value, Document, Item};

use super::devtools::{env_overrides, find_in_path, home, mask, tool_version, write_file};
use super::proc::blocking;
use super::userenv;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Agent {
    Codex,
    Claude,
}

pub(super) fn agent(id: &str) -> Result<Agent, String> {
    match id {
        "codex" => Ok(Agent::Codex),
        "claude" => Ok(Agent::Claude),
        _ => Err(format!("Unknown agent \"{}\"", id)),
    }
}

/// CODEX_HOME / CLAUDE_CONFIG_DIR, or ~/.codex / ~/.claude.
fn agent_home(agent: Agent) -> Result<PathBuf, String> {
    let (var, dir) = match agent {
        Agent::Codex => ("CODEX_HOME", ".codex"),
        Agent::Claude => ("CLAUDE_CONFIG_DIR", ".claude"),
    };
    match userenv::effective_var(var) {
        Some(p) => Ok(PathBuf::from(p)),
        None => Ok(home()?.join(dir)),
    }
}

pub(super) fn config_path(agent: Agent) -> Result<PathBuf, String> {
    Ok(agent_home(agent)?.join(match agent {
        Agent::Codex => "config.toml",
        Agent::Claude => "settings.json",
    }))
}

pub fn codex_bin() -> Option<PathBuf> {
    find_in_path(&["codex"])
}

/// npm installs `claude` on PATH; the native installer uses ~/.local/bin, older local
/// installs ~/.claude/local.
pub fn claude_bin() -> Option<PathBuf> {
    find_in_path(&["claude"]).or_else(|| {
        let exe = if cfg!(windows) { "claude.exe" } else { "claude" };
        let candidates = [
            home().ok().map(|h| h.join(".local").join("bin").join(exe)),
            agent_home(Agent::Claude).ok().map(|h| h.join("local").join(exe)),
        ];
        candidates.into_iter().flatten().find(|p| p.is_file())
    })
}

pub(super) fn read_text(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(t) => Ok(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
    }
}

/// Write a config file, keeping the previous version as `<file>.sshui-bak`.
pub(super) fn write_with_backup(path: &Path, content: &str) -> Result<(), String> {
    if path.is_file() {
        let mut backup = path.as_os_str().to_owned();
        backup.push(".sshui-bak");
        fs::copy(path, PathBuf::from(backup)).map_err(|e| format!("Failed to back up {}: {}", path.display(), e))?;
    }
    write_file(path, content)
}

// ── Instruction files ─────────────────────────────────────────────────────────

/// How files are laid out in one group
#[derive(Clone, Copy)]
enum Layout {
    /// One file at the home root
    Single(&'static str),
    /// `<dir>/<name>.md`
    Flat,
    /// `<dir>/<name>.md` or `<dir>/<namespace>/<name>.md`
    Nested,
    /// `<dir>/<name>/SKILL.md`
    Skill,
}

struct Group {
    id: &'static str,
    dir: &'static str,
    layout: Layout,
}

fn groups(agent: Agent) -> &'static [Group] {
    const CODEX: &[Group] = &[
        Group { id: "global", dir: "", layout: Layout::Single("AGENTS.md") },
        Group { id: "override", dir: "", layout: Layout::Single("AGENTS.override.md") },
        Group { id: "prompts", dir: "prompts", layout: Layout::Flat },
        Group { id: "skills", dir: "skills", layout: Layout::Skill },
    ];
    const CLAUDE: &[Group] = &[
        Group { id: "global", dir: "", layout: Layout::Single("CLAUDE.md") },
        Group { id: "agents", dir: "agents", layout: Layout::Flat },
        Group { id: "commands", dir: "commands", layout: Layout::Nested },
        Group { id: "outputStyles", dir: "output-styles", layout: Layout::Flat },
        Group { id: "skills", dir: "skills", layout: Layout::Skill },
    ];
    match agent {
        Agent::Codex => CODEX,
        Agent::Claude => CLAUDE,
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct InstructionFile {
    /// Path relative to the agent's home, with '/' separators
    pub path: String,
    pub exists: bool,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstructionGroup {
    pub id: String,
    /// Folder relative to the home ("" for single files)
    pub dir: String,
    /// "single", "flat", "nested" or "skill"
    pub layout: String,
    pub files: Vec<InstructionFile>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstructionFiles {
    pub home: String,
    pub groups: Vec<InstructionGroup>,
}

fn valid_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 120
        && !s.starts_with('.')
        && !s.ends_with([' ', '.'])
        && !s.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
}

/// Resolve a relative instruction-file path, accepting only the documented locations.
fn resolve(agent: Agent, rel: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = rel.split('/').collect();
    let invalid = || format!("\"{}\" is not an instruction file location", rel);
    if !parts.iter().all(|p| valid_segment(p)) {
        return Err(invalid());
    }
    let is_md = |name: &str| name.len() > 3 && name.to_ascii_lowercase().ends_with(".md");
    let ok = groups(agent).iter().any(|g| match (g.layout, parts.as_slice()) {
        (Layout::Single(file), [name]) => *name == file,
        (Layout::Flat, [dir, name]) => *dir == g.dir && is_md(name),
        (Layout::Nested, [dir, name]) => *dir == g.dir && is_md(name),
        (Layout::Nested, [dir, _ns, name]) => *dir == g.dir && is_md(name),
        (Layout::Skill, [dir, _skill, file]) => *dir == g.dir && *file == "SKILL.md",
        _ => false,
    });
    if !ok {
        return Err(invalid());
    }
    Ok(parts.iter().fold(agent_home(agent)?, |p, s| p.join(s)))
}

fn file_entry(home: &Path, rel: String) -> InstructionFile {
    let meta = fs::metadata(rel.split('/').fold(home.to_path_buf(), |p, s| p.join(s))).ok().filter(|m| m.is_file());
    InstructionFile {
        exists: meta.is_some(),
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        modified_ms: meta
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        path: rel,
    }
}

fn list_dir(dir: &Path) -> Vec<(String, bool)> {
    let mut out: Vec<(String, bool)> = fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    valid_segment(&name).then(|| (name, e.path().is_dir()))
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|(n, _)| n.to_lowercase());
    out
}

fn list_group(home: &Path, g: &Group) -> Vec<InstructionFile> {
    let is_md = |n: &str| n.to_ascii_lowercase().ends_with(".md");
    let dir = home.join(g.dir);
    let mut rels: Vec<String> = Vec::new();
    match g.layout {
        Layout::Single(file) => rels.push(file.to_string()),
        Layout::Flat => rels.extend(list_dir(&dir).into_iter().filter(|(n, d)| !d && is_md(n)).map(|(n, _)| format!("{}/{}", g.dir, n))),
        Layout::Nested => {
            for (name, is_dir) in list_dir(&dir) {
                if !is_dir && is_md(&name) {
                    rels.push(format!("{}/{}", g.dir, name));
                } else if is_dir {
                    rels.extend(
                        list_dir(&dir.join(&name))
                            .into_iter()
                            .filter(|(n, d)| !d && is_md(n))
                            .map(|(n, _)| format!("{}/{}/{}", g.dir, name, n)),
                    );
                }
            }
        }
        Layout::Skill => rels.extend(
            list_dir(&dir)
                .into_iter()
                .filter(|(n, d)| *d && dir.join(n).join("SKILL.md").is_file())
                .map(|(n, _)| format!("{}/{}/SKILL.md", g.dir, n)),
        ),
    }
    rels.into_iter().map(|rel| file_entry(home, rel)).collect()
}

#[tauri::command]
pub async fn agent_instruction_files(agent: String) -> Result<InstructionFiles, String> {
    blocking(move || {
        let agent = self::agent(&agent)?;
        let home = agent_home(agent)?;
        let groups = groups(agent)
            .iter()
            .map(|g| InstructionGroup {
                id: g.id.to_string(),
                dir: g.dir.to_string(),
                layout: match g.layout {
                    Layout::Single(_) => "single",
                    Layout::Flat => "flat",
                    Layout::Nested => "nested",
                    Layout::Skill => "skill",
                }
                .to_string(),
                files: list_group(&home, g),
            })
            .collect();
        Ok(InstructionFiles { home: home.display().to_string(), groups })
    })
    .await?
}

const MAX_FILE: u64 = 2 * 1024 * 1024;

#[tauri::command]
pub async fn agent_read_file(agent: String, path: String) -> Result<String, String> {
    blocking(move || {
        let file = resolve(self::agent(&agent)?, &path)?;
        if fs::metadata(&file).is_ok_and(|m| m.len() > MAX_FILE) {
            return Err("The file is too large to edit here".to_string());
        }
        read_text(&file)
    })
    .await?
}

#[tauri::command]
pub async fn agent_write_file(agent: String, path: String, content: String, create: bool) -> Result<(), String> {
    blocking(move || {
        let file = resolve(self::agent(&agent)?, &path)?;
        if create && file.exists() {
            return Err(format!("{} already exists", path));
        }
        write_file(&file, &content)
    })
    .await?
}

#[tauri::command]
pub async fn agent_delete_file(agent: String, path: String) -> Result<(), String> {
    blocking(move || {
        let file = resolve(self::agent(&agent)?, &path)?;
        match fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("Failed to delete {}: {}", path, e)),
            _ => {}
        }
        // A skill is its folder: remove it once SKILL.md is gone and nothing else is left
        if path.ends_with("/SKILL.md") {
            if let Some(dir) = file.parent() {
                let _ = fs::remove_dir(dir);
            }
        }
        Ok(())
    })
    .await?
}

// ── Config file (raw) ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ConfigFile {
    pub path: String,
    pub exists: bool,
    pub content: String,
}

fn validate_config(agent: Agent, content: &str) -> Result<(), String> {
    match agent {
        Agent::Codex => content
            .parse::<Document>()
            .map(|_| ())
            .map_err(|e| format!("Invalid TOML: {}", e.to_string().trim())),
        Agent::Claude if content.trim().is_empty() => Ok(()),
        Agent::Claude => match serde_json::from_str::<Value>(content) {
            Ok(Value::Object(_)) => Ok(()),
            Ok(_) => Err("settings.json must contain a JSON object".into()),
            Err(e) => Err(format!("Invalid JSON: {}", e)),
        },
    }
}

#[tauri::command]
pub async fn agent_config(agent: String) -> Result<ConfigFile, String> {
    blocking(move || {
        let path = config_path(self::agent(&agent)?)?;
        Ok(ConfigFile { exists: path.exists(), content: read_text(&path)?, path: path.display().to_string() })
    })
    .await?
}

#[tauri::command]
pub async fn agent_save_config(agent: String, content: String) -> Result<(), String> {
    blocking(move || {
        let agent = self::agent(&agent)?;
        validate_config(agent, &content)?;
        write_with_backup(&config_path(agent)?, &content)
    })
    .await?
}

// ── Codex ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct CodexInfo {
    pub version: Option<String>,
    pub config_path: String,
    pub config_exists: bool,
    pub model: Option<String>,
    pub model_reasoning_effort: Option<String>,
    pub model_provider: Option<String>,
    pub approval_policy: Option<String>,
    pub sandbox_mode: Option<String>,
    /// Custom providers defined in [model_providers.*]
    pub providers: Vec<String>,
    pub mcp_servers: Vec<String>,
    /// "chatgpt" or "apikey", from auth.json (its contents are never returned)
    pub auth_mode: Option<String>,
    pub env_overrides: BTreeMap<String, String>,
}

fn table_keys(doc: &Document, key: &str) -> Vec<String> {
    doc.get(key)
        .and_then(Item::as_table_like)
        .map(|t| t.iter().map(|(k, _)| k.to_string()).collect())
        .unwrap_or_default()
}

fn codex_auth_mode(home: &Path) -> Option<String> {
    let auth: Value = serde_json::from_str(&fs::read_to_string(home.join("auth.json")).ok()?).ok()?;
    if let Some(mode) = auth.get("auth_mode").and_then(Value::as_str) {
        return Some(mode.to_lowercase().replace("_", ""));
    }
    if auth.get("tokens").is_some_and(|t| !t.is_null()) {
        Some("chatgpt".into())
    } else if auth.get("OPENAI_API_KEY").is_some_and(|k| k.as_str().is_some_and(|s| !s.is_empty())) {
        Some("apikey".into())
    } else {
        None
    }
}

#[tauri::command]
pub async fn codex_info() -> Result<CodexInfo, String> {
    blocking(|| {
        let bin = codex_bin().ok_or("Codex CLI is not installed")?;
        let home = agent_home(Agent::Codex)?;
        let path = config_path(Agent::Codex)?;
        let doc = read_text(&path)?.parse::<Document>().map_err(|e| format!("config.toml is not valid TOML: {}", e.to_string().trim()))?;
        let get = |k: &str| doc.get(k).and_then(Item::as_str).map(str::to_string);
        Ok(CodexInfo {
            version: tool_version(&bin, &["--version"]),
            config_exists: path.exists(),
            config_path: path.display().to_string(),
            model: get("model"),
            model_reasoning_effort: get("model_reasoning_effort"),
            model_provider: get("model_provider"),
            approval_policy: get("approval_policy"),
            sandbox_mode: get("sandbox_mode"),
            providers: table_keys(&doc, "model_providers"),
            mcp_servers: table_keys(&doc, "mcp_servers"),
            auth_mode: codex_auth_mode(&home),
            env_overrides: env_overrides(&["OPENAI_BASE_URL", "OPENAI_API_KEY", "CODEX_HOME"]),
        })
    })
    .await?
}

fn codex_validate(key: &str, v: &str) -> Result<(), String> {
    let one_of = |options: &[&str]| {
        options
            .contains(&v)
            .then_some(())
            .ok_or_else(|| format!("{} must be one of: {}", key, options.join(", ")))
    };
    match key {
        "model" | "model_provider" => {
            if v.contains(char::is_whitespace) {
                Err(format!("{} must not contain spaces", key))
            } else {
                Ok(())
            }
        }
        "model_reasoning_effort" => one_of(&["none", "minimal", "low", "medium", "high", "xhigh"]),
        "approval_policy" => one_of(&["untrusted", "on-failure", "on-request", "never"]),
        "sandbox_mode" => one_of(&["read-only", "workspace-write", "danger-full-access"]),
        _ => Err(format!("Unsupported Codex setting \"{}\"", key)),
    }
}

const CODEX_KEYS: [&str; 5] = ["model", "model_provider", "model_reasoning_effort", "approval_policy", "sandbox_mode"];

fn codex_apply(doc: &mut Document, key: &str, v: Option<&str>) -> Result<(), String> {
    if !CODEX_KEYS.contains(&key) {
        return Err(format!("Unsupported Codex setting \"{}\"", key));
    }
    match v {
        Some(v) => {
            codex_validate(key, v)?;
            doc.insert(key, value(v));
        }
        None => {
            doc.remove(key);
        }
    }
    Ok(())
}

/// Set or remove a top-level setting in config.toml.
#[tauri::command]
pub async fn codex_set(key: String, value: Option<String>) -> Result<(), String> {
    blocking(move || {
        let path = config_path(Agent::Codex)?;
        let mut doc = read_text(&path)?.parse::<Document>().map_err(|e| format!("config.toml is not valid TOML: {}", e.to_string().trim()))?;
        codex_apply(&mut doc, &key, value.as_deref().map(str::trim).filter(|v| !v.is_empty()))?;
        write_with_backup(&path, &doc.to_string())
    })
    .await?
}

// ── Claude Code ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeEnvVar {
    pub name: String,
    /// Masked when `secret`
    pub value: String,
    pub secret: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeInfo {
    pub version: Option<String>,
    pub settings_path: String,
    pub settings_exists: bool,
    pub model: Option<String>,
    pub default_mode: Option<String>,
    pub env: Vec<ClaudeEnvVar>,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub ask: Vec<String>,
}

fn is_secret(name: &str) -> bool {
    let upper = name.to_uppercase();
    ["KEY", "TOKEN", "SECRET", "PASSWORD"].iter().any(|s| upper.contains(s))
}

pub(super) fn read_settings(path: &Path) -> Result<Map<String, Value>, String> {
    let text = read_text(path)?;
    if text.trim().is_empty() {
        return Ok(Map::new());
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err("settings.json is not valid JSON. Fix it in the Config file tab first.".into()),
    }
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn claude_info() -> Result<ClaudeInfo, String> {
    blocking(|| {
        let bin = claude_bin().ok_or("Claude Code is not installed")?;
        let path = config_path(Agent::Claude)?;
        let settings = read_settings(&path)?;
        let permissions = settings.get("permissions");
        let env = settings
            .get("env")
            .and_then(Value::as_object)
            .map(|env| {
                env.iter()
                    .map(|(name, v)| {
                        let raw = v.as_str().map(str::to_string).unwrap_or_else(|| v.to_string());
                        let secret = is_secret(name);
                        ClaudeEnvVar { name: name.clone(), value: if secret { mask(&raw) } else { raw }, secret }
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(ClaudeInfo {
            version: tool_version(&bin, &["--version"]),
            settings_exists: path.exists(),
            settings_path: path.display().to_string(),
            model: settings.get("model").and_then(Value::as_str).map(str::to_string),
            default_mode: permissions.and_then(|p| p.get("defaultMode")).and_then(Value::as_str).map(str::to_string),
            env,
            allow: strings(permissions.and_then(|p| p.get("allow"))),
            deny: strings(permissions.and_then(|p| p.get("deny"))),
            ask: strings(permissions.and_then(|p| p.get("ask"))),
        })
    })
    .await?
}

/// Set (or remove, with `None`) the value at `path`, creating objects on the way and
/// removing objects left empty.
pub(super) fn json_set(root: &mut Map<String, Value>, path: &[&str], v: Option<Value>) {
    let Some((last, parents)) = path.split_last() else { return };
    if let Some((first, rest)) = parents.split_first() {
        if v.is_none() && !root.get(*first).is_some_and(Value::is_object) {
            return;
        }
        let child = root.entry(first.to_string()).or_insert_with(|| Value::Object(Map::new()));
        if !child.is_object() {
            *child = Value::Object(Map::new());
        }
        let map = child.as_object_mut().expect("object");
        json_set(map, &[rest, &[*last]].concat(), v);
        if map.is_empty() {
            root.remove(*first);
        }
        return;
    }
    match v {
        Some(v) => {
            root.insert(last.to_string(), v);
        }
        None => {
            root.remove(*last);
        }
    }
}

fn valid_env_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !name.starts_with(|c: char| c.is_ascii_digit())
}

fn claude_apply(settings: &mut Map<String, Value>, path: &[String], v: Option<Value>) -> Result<(), String> {
    let p: Vec<&str> = path.iter().map(String::as_str).collect();
    let is_string = |v: &Option<Value>| v.as_ref().is_none_or(Value::is_string);
    let ok = match p.as_slice() {
        ["model"] | ["permissions", "defaultMode"] => is_string(&v),
        ["env", name] => valid_env_name(name) && is_string(&v),
        ["permissions", "allow" | "deny" | "ask"] => v
            .as_ref()
            .is_none_or(|v| v.as_array().is_some_and(|a| a.iter().all(Value::is_string))),
        _ => return Err(format!("Unsupported Claude Code setting \"{}\"", p.join("."))),
    };
    if !ok {
        return Err(format!("Invalid value for {}", p.join(".")));
    }
    // Empty strings and lists remove the setting
    let v = v.filter(|v| match v {
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(a) => !a.is_empty(),
        _ => true,
    });
    json_set(settings, &p, v);
    Ok(())
}

pub(super) fn save_settings_map(path: &Path, settings: &Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_with_backup(path, &(text + "\n"))
}

/// Set or remove one supported setting in ~/.claude/settings.json.
#[tauri::command]
pub async fn claude_set(path: Vec<String>, value: Option<Value>) -> Result<(), String> {
    blocking(move || {
        let file = config_path(Agent::Claude)?;
        let mut settings = read_settings(&file)?;
        claude_apply(&mut settings, &path, value)?;
        save_settings_map(&file, &settings)
    })
    .await?
}

/// HTTPS_PROXY (or HTTP_PROXY) from Claude Code's settings env.
pub(super) fn claude_proxy() -> Option<String> {
    let settings = read_settings(&config_path(Agent::Claude).ok()?).ok()?;
    let env = settings.get("env")?;
    ["HTTPS_PROXY", "HTTP_PROXY"]
        .iter()
        .find_map(|k| env.get(*k).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string))
}

pub(super) fn set_claude_proxy(url: Option<&str>, no_proxy: Option<&str>) -> Result<(), String> {
    let file = config_path(Agent::Claude)?;
    let mut settings = read_settings(&file)?;
    for (name, v) in [("HTTPS_PROXY", url), ("HTTP_PROXY", url), ("NO_PROXY", no_proxy)] {
        json_set(&mut settings, &["env", name], v.map(Value::from));
    }
    save_settings_map(&file, &settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_only_documented_locations() {
        assert!(resolve(Agent::Codex, "AGENTS.md").is_ok());
        assert!(resolve(Agent::Codex, "prompts/review.md").is_ok());
        assert!(resolve(Agent::Codex, "skills/pdf/SKILL.md").is_ok());
        assert!(resolve(Agent::Claude, "CLAUDE.md").is_ok());
        assert!(resolve(Agent::Claude, "commands/git/commit.md").is_ok());
        assert!(resolve(Agent::Claude, "output-styles/terse.md").is_ok());
        for bad in [
            "../secrets.md",
            "agents/../../x.md",
            "settings.json",
            "agents/a.txt",
            "agents/.hidden.md",
            "commands/a/b/c.md",
            "skills/x/other.md",
            "C:/x.md",
            "agents\\x.md",
            "CLAUDE.md",
        ] {
            let agent = if bad == "CLAUDE.md" { Agent::Codex } else { Agent::Claude };
            assert!(resolve(agent, bad).is_err(), "{} should be rejected", bad);
        }
    }

    #[test]
    fn codex_settings_keep_tables() {
        let mut doc = "model = \"gpt-5\"\n\n[mcp_servers.repl]\ncommand = \"node\"\n".parse::<Document>().unwrap();
        codex_apply(&mut doc, "approval_policy", Some("on-request")).unwrap();
        codex_apply(&mut doc, "model", None).unwrap();
        let text = doc.to_string();
        assert!(text.starts_with("approval_policy = \"on-request\"\n"), "{}", text);
        assert!(text.contains("[mcp_servers.repl]\ncommand = \"node\""));
        assert!(codex_apply(&mut doc, "sandbox_mode", Some("everything")).is_err());
        assert!(codex_apply(&mut doc, "notify", Some("x")).is_err());
    }

    #[test]
    fn claude_settings_edit_nested_values() {
        let mut s: Map<String, Value> =
            serde_json::from_str(r#"{"env":{"ANTHROPIC_BASE_URL":"https://a"},"hooks":{"x":1}}"#).unwrap();
        claude_apply(&mut s, &["env".into(), "HTTPS_PROXY".into()], Some(Value::from("http://p:1"))).unwrap();
        claude_apply(&mut s, &["permissions".into(), "allow".into()], Some(serde_json::json!(["Bash(git:*)"]))).unwrap();
        claude_apply(&mut s, &["env".into(), "ANTHROPIC_BASE_URL".into()], None).unwrap();
        assert_eq!(
            serde_json::to_string(&s).unwrap(),
            r#"{"env":{"HTTPS_PROXY":"http://p:1"},"hooks":{"x":1},"permissions":{"allow":["Bash(git:*)"]}}"#
        );
        claude_apply(&mut s, &["permissions".into(), "allow".into()], Some(serde_json::json!([]))).unwrap();
        claude_apply(&mut s, &["env".into(), "HTTPS_PROXY".into()], Some(Value::from(""))).unwrap();
        assert_eq!(serde_json::to_string(&s).unwrap(), r#"{"hooks":{"x":1}}"#);
        assert!(claude_apply(&mut s, &["hooks".into()], None).is_err());
        assert!(claude_apply(&mut s, &["env".into(), "BAD NAME".into()], Some(Value::from("x"))).is_err());
    }

    #[test]
    fn validates_config_files() {
        assert!(validate_config(Agent::Codex, "model = \"x\"\n").is_ok());
        assert!(validate_config(Agent::Codex, "model = \n").is_err());
        assert!(validate_config(Agent::Claude, "{\"model\": \"opus\"}").is_ok());
        assert!(validate_config(Agent::Claude, "[1]").is_err());
        assert!(validate_config(Agent::Claude, "{,}").is_err());
    }
}
