//! Saved API profiles for Codex CLI and Claude Code: endpoint, key and models, switched
//! in one click from the page or the tray.
//!
//! Profiles live in ~/.ssh-at/agent-profiles.json (keys included, like the tools' own
//! config files). Each agent has a built-in "official" profile that removes any custom
//! endpoint. Which profile is current is worked out from the live config, so edits made
//! elsewhere are noticed.
//!
//! - Claude Code: the ANTHROPIC_* variables in the `env` of ~/.claude/settings.json.
//! - Codex: a `[model_providers.sshui]` table (base_url, wire_api,
//!   experimental_bearer_token) selected with `model_provider = "sshui"`, plus `model`.
//!   auth.json (the ChatGPT sign-in) is never touched.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use toml_edit::{value, Document, Item, Table};

use super::agents::{agent, config_path, json_set, read_settings, read_text, save_settings_map, write_with_backup, Agent};
use super::devtools::{mask, validate_url, write_file};
use super::proc::blocking;
use super::userenv;

pub const CHANGED_EVENT: &str = "agent-profiles-changed";
pub const OFFICIAL_ID: &str = "official";
/// Provider id SSHUI manages in Codex's config.toml
const CODEX_PROVIDER: &str = "sshui";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    /// Claude Code: "token" (ANTHROPIC_AUTH_TOKEN) or "apikey" (ANTHROPIC_API_KEY)
    #[serde(default)]
    pub auth: String,
    #[serde(default)]
    pub model: String,
    /// Claude Code model aliases
    #[serde(default)]
    pub opus_model: String,
    #[serde(default)]
    pub sonnet_model: String,
    #[serde(default)]
    pub haiku_model: String,
    /// Codex: "responses" or "chat"
    #[serde(default)]
    pub wire_api: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct AgentStore {
    profiles: Vec<AgentProfile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    codex: AgentStore,
    #[serde(default)]
    claude: AgentStore,
}

impl Store {
    fn agent_mut(&mut self, agent: Agent) -> &mut AgentStore {
        match agent {
            Agent::Codex => &mut self.codex,
            Agent::Claude => &mut self.claude,
        }
    }
}

/// A profile as the page sees it: the key is never sent, only a masked hint.
#[derive(Debug, Clone, Serialize)]
pub struct ProfileView {
    #[serde(flatten)]
    pub profile: AgentProfile,
    pub key_hint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfilesState {
    pub profiles: Vec<ProfileView>,
    /// The profile matching the live config, if any
    pub current_id: Option<String>,
    /// The live config, keys masked
    pub live: ProfileView,
    /// Codex: OPENAI_BASE_URL from the environment, which redirects the official provider
    pub env_base_url: Option<String>,
    pub store_path: String,
}

fn store_path() -> Result<PathBuf, String> {
    let dir = dirs::home_dir().ok_or("Failed to get home directory")?.join(".ssh-at");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("agent-profiles.json"))
}

fn load_store() -> Result<Store, String> {
    match fs::read_to_string(store_path()?) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("Failed to read agent profiles: {}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::default()),
        Err(e) => Err(e.to_string()),
    }
}

fn save_store(store: &Store) -> Result<(), String> {
    write_file(&store_path()?, &serde_json::to_string_pretty(store).map_err(|e| e.to_string())?)
}

fn official(agent: Agent) -> AgentProfile {
    AgentProfile { id: OFFICIAL_ID.into(), name: "Official".into(), wire_api: wire_default(agent), ..Default::default() }
}

fn wire_default(agent: Agent) -> String {
    if agent == Agent::Codex { "responses".into() } else { String::new() }
}

/// The store's profiles with the official one first (it is stored only once edited).
fn profiles_of(store: &Store, agent: Agent) -> Vec<AgentProfile> {
    let list = match agent {
        Agent::Codex => &store.codex.profiles,
        Agent::Claude => &store.claude.profiles,
    };
    let mut out = vec![list.iter().find(|p| p.id == OFFICIAL_ID).cloned().unwrap_or_else(|| official(agent))];
    out.extend(list.iter().filter(|p| p.id != OFFICIAL_ID).cloned());
    out
}

fn view(p: AgentProfile) -> ProfileView {
    let key_hint = if p.api_key.is_empty() { String::new() } else { mask(&p.api_key) };
    ProfileView { profile: AgentProfile { api_key: String::new(), ..p }, key_hint }
}

// ── Reading the live config ───────────────────────────────────────────────────

const CLAUDE_VARS: [&str; 7] = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];

fn live_claude() -> Result<AgentProfile, String> {
    let settings = read_settings(&config_path(Agent::Claude)?)?;
    let env = |k: &str| {
        settings
            .get("env")
            .and_then(|e| e.get(k))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
    };
    let token = env("ANTHROPIC_AUTH_TOKEN");
    let (auth, api_key) = if token.is_empty() && !env("ANTHROPIC_API_KEY").is_empty() {
        ("apikey", env("ANTHROPIC_API_KEY"))
    } else {
        ("token", token)
    };
    Ok(AgentProfile {
        id: String::new(),
        name: String::new(),
        base_url: env("ANTHROPIC_BASE_URL"),
        api_key,
        auth: auth.into(),
        model: env("ANTHROPIC_MODEL"),
        opus_model: env("ANTHROPIC_DEFAULT_OPUS_MODEL"),
        sonnet_model: env("ANTHROPIC_DEFAULT_SONNET_MODEL"),
        haiku_model: env("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
        wire_api: String::new(),
    })
}

fn read_codex() -> Result<(PathBuf, Document), String> {
    let path = config_path(Agent::Codex)?;
    let doc = read_text(&path)?
        .parse::<Document>()
        .map_err(|e| format!("config.toml is not valid TOML: {}", e.to_string().trim()))?;
    Ok((path, doc))
}

fn live_codex() -> Result<AgentProfile, String> {
    let (_, doc) = read_codex()?;
    let s = |item: Option<&Item>| item.and_then(Item::as_str).unwrap_or_default().trim().to_string();
    let provider = s(doc.get("model_provider"));
    let table = (!provider.is_empty())
        .then(|| doc.get("model_providers").and_then(|p| p.get(&provider)))
        .flatten();
    let (base_url, api_key, wire_api) = match table {
        Some(t) => {
            // A key can also come from the environment variable named by env_key
            let key = Some(s(t.get("experimental_bearer_token")))
                .filter(|k| !k.is_empty())
                .or_else(|| {
                    let name = s(t.get("env_key"));
                    (!name.is_empty()).then(|| userenv::effective_var(&name)).flatten()
                })
                .unwrap_or_default();
            (s(t.get("base_url")), key, Some(s(t.get("wire_api"))).filter(|w| !w.is_empty()).unwrap_or_else(|| "responses".into()))
        }
        None => (String::new(), String::new(), "responses".into()),
    };
    Ok(AgentProfile { base_url, api_key, model: s(doc.get("model")), wire_api, ..Default::default() })
}

fn live(agent: Agent) -> Result<AgentProfile, String> {
    match agent {
        Agent::Codex => live_codex(),
        Agent::Claude => live_claude(),
    }
}

fn same_url(a: &str, b: &str) -> bool {
    a.trim().trim_end_matches('/').eq_ignore_ascii_case(b.trim().trim_end_matches('/'))
}

/// Whether the live config is what applying `p` would produce.
fn matches(agent: Agent, p: &AgentProfile, live: &AgentProfile) -> bool {
    let models = p.model == live.model
        && (agent == Agent::Codex
            || (p.opus_model == live.opus_model && p.sonnet_model == live.sonnet_model && p.haiku_model == live.haiku_model));
    if p.id == OFFICIAL_ID {
        return models && live.base_url.is_empty() && live.api_key.is_empty();
    }
    let auth = agent == Agent::Codex || p.api_key.is_empty() || p.auth == live.auth;
    models && auth && same_url(&p.base_url, &live.base_url) && p.api_key == live.api_key
}

// ── Applying ──────────────────────────────────────────────────────────────────

fn apply_claude(p: &AgentProfile) -> Result<(), String> {
    let path = config_path(Agent::Claude)?;
    let mut settings = read_settings(&path)?;
    let custom = p.id != OFFICIAL_ID;
    let opt = |s: &str| (!s.trim().is_empty()).then(|| Value::from(s.trim()));
    let key_var = if p.auth == "apikey" { "ANTHROPIC_API_KEY" } else { "ANTHROPIC_AUTH_TOKEN" };
    for var in CLAUDE_VARS {
        let v = match var {
            "ANTHROPIC_BASE_URL" if custom => opt(&p.base_url),
            "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY" if custom && var == key_var => opt(&p.api_key),
            "ANTHROPIC_MODEL" => opt(&p.model),
            "ANTHROPIC_DEFAULT_OPUS_MODEL" => opt(&p.opus_model),
            "ANTHROPIC_DEFAULT_SONNET_MODEL" => opt(&p.sonnet_model),
            "ANTHROPIC_DEFAULT_HAIKU_MODEL" => opt(&p.haiku_model),
            _ => None,
        };
        json_set(&mut settings, &["env", var], v);
    }
    save_settings_map(&path, &settings)
}

fn apply_codex_doc(doc: &mut Document, p: &AgentProfile) {
    if p.id == OFFICIAL_ID {
        if doc.get("model_provider").and_then(Item::as_str) == Some(CODEX_PROVIDER) {
            doc.remove("model_provider");
        }
        if let Some(providers) = doc.get_mut("model_providers").and_then(Item::as_table_mut) {
            providers.remove(CODEX_PROVIDER);
            if providers.is_empty() {
                doc.remove("model_providers");
            }
        }
    } else {
        let providers = doc.entry("model_providers").or_insert_with(|| {
            let mut t = Table::new();
            t.set_implicit(true);
            Item::Table(t)
        });
        if let Some(providers) = providers.as_table_mut() {
            let mut t = Table::new();
            t.insert("name", value(p.name.as_str()));
            t.insert("base_url", value(p.base_url.trim()));
            t.insert("wire_api", value(if p.wire_api.is_empty() { "responses" } else { p.wire_api.as_str() }));
            if !p.api_key.is_empty() {
                t.insert("experimental_bearer_token", value(p.api_key.as_str()));
            }
            providers.insert(CODEX_PROVIDER, Item::Table(t));
        }
        doc.insert("model_provider", value(CODEX_PROVIDER));
    }
    match p.model.trim() {
        "" => {
            doc.remove("model");
        }
        m => {
            doc.insert("model", value(m));
        }
    }
}

fn apply_codex(p: &AgentProfile) -> Result<(), String> {
    let (path, mut doc) = read_codex()?;
    apply_codex_doc(&mut doc, p);
    write_with_backup(&path, &doc.to_string())
}

pub fn apply_blocking(agent_id: &str, id: &str) -> Result<(), String> {
    let agent = agent(agent_id)?;
    let store = load_store()?;
    let p = profiles_of(&store, agent)
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("This profile no longer exists")?;
    match agent {
        Agent::Codex => apply_codex(&p),
        Agent::Claude => apply_claude(&p),
    }
}

/// Whether the user saved any profile besides the official one (for the tray).
pub fn has_custom_profiles(agent_id: &str) -> bool {
    let (Ok(agent), Ok(store)) = (agent(agent_id), load_store()) else { return false };
    profiles_of(&store, agent).len() > 1
}

pub fn state_blocking(agent_id: &str) -> Result<ProfilesState, String> {
    let agent = agent(agent_id)?;
    let mut store = load_store()?;
    let live = live(agent)?;
    // First visit: the official profile starts with the models already configured,
    // so switching to it later doesn't silently drop them
    if live.base_url.is_empty() && !store.agent_mut(agent).profiles.iter().any(|p| p.id == OFFICIAL_ID) {
        let seeded = AgentProfile { api_key: String::new(), ..AgentProfile { id: OFFICIAL_ID.into(), name: "Official".into(), ..live.clone() } };
        store.agent_mut(agent).profiles.insert(0, seeded);
        save_store(&store)?;
    }
    let profiles = profiles_of(&store, agent);
    let current_id = profiles.iter().find(|p| matches(agent, p, &live)).map(|p| p.id.clone());
    Ok(ProfilesState {
        profiles: profiles.into_iter().map(view).collect(),
        current_id,
        live: view(live),
        env_base_url: (agent == Agent::Codex).then(|| userenv::effective_var("OPENAI_BASE_URL")).flatten(),
        store_path: store_path()?.display().to_string(),
    })
}

fn validate(agent: Agent, p: &AgentProfile) -> Result<(), String> {
    if p.name.trim().is_empty() {
        return Err("The profile needs a name".into());
    }
    if p.id != OFFICIAL_ID {
        validate_url(p.base_url.trim(), &["http", "https"])?;
    }
    if p.api_key.contains(char::is_whitespace) {
        return Err("The key must not contain spaces".into());
    }
    let models = [&p.model, &p.opus_model, &p.sonnet_model, &p.haiku_model];
    if models.iter().any(|m| m.trim().contains(char::is_whitespace)) {
        return Err("Model names must not contain spaces".into());
    }
    match agent {
        Agent::Claude if !["token", "apikey", ""].contains(&p.auth.as_str()) => Err("Unknown key type".into()),
        Agent::Codex if !["responses", "chat", ""].contains(&p.wire_api.as_str()) => Err("Unknown wire API".into()),
        _ => Ok(()),
    }
}

fn notify(app: &AppHandle) {
    crate::tray::refresh_menu(app);
    let _ = app.emit(CHANGED_EVENT, ());
}

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_profiles(agent: String) -> Result<ProfilesState, String> {
    blocking(move || state_blocking(&agent)).await?
}

/// Create or update a profile. `api_key: None` keeps the saved key.
#[tauri::command]
pub async fn agent_save_profile(
    app: AppHandle,
    agent: String,
    profile: AgentProfile,
    api_key: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        let agent_kind = self::agent(&agent)?;
        let mut store = load_store()?;
        let existing = profiles_of(&store, agent_kind).into_iter().find(|p| !profile.id.is_empty() && p.id == profile.id);
        let mut p = AgentProfile {
            name: profile.name.trim().to_string(),
            base_url: profile.base_url.trim().to_string(),
            model: profile.model.trim().to_string(),
            opus_model: profile.opus_model.trim().to_string(),
            sonnet_model: profile.sonnet_model.trim().to_string(),
            haiku_model: profile.haiku_model.trim().to_string(),
            api_key: match api_key {
                Some(k) => k.trim().to_string(),
                None => existing.as_ref().map(|e| e.api_key.clone()).unwrap_or_default(),
            },
            ..profile
        };
        if p.id.is_empty() {
            p.id = format!(
                "p{:x}",
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
            );
        }
        if p.id == OFFICIAL_ID {
            p.base_url.clear();
            p.api_key.clear();
        }
        validate(agent_kind, &p)?;
        let list = &mut store.agent_mut(agent_kind).profiles;
        if list.iter().any(|x| x.id != p.id && x.name.eq_ignore_ascii_case(&p.name)) {
            return Err(format!("A profile named \"{}\" already exists", p.name));
        }
        match list.iter_mut().find(|x| x.id == p.id) {
            Some(slot) => *slot = p,
            None => list.push(p),
        }
        save_store(&store)
    })
    .await??;
    notify(&app);
    Ok(())
}

#[tauri::command]
pub async fn agent_delete_profile(app: AppHandle, agent: String, id: String) -> Result<(), String> {
    blocking(move || {
        if id == OFFICIAL_ID {
            return Err("The official profile can't be deleted".to_string());
        }
        let agent = self::agent(&agent)?;
        let mut store = load_store()?;
        store.agent_mut(agent).profiles.retain(|p| p.id != id);
        save_store(&store)
    })
    .await??;
    notify(&app);
    Ok(())
}

#[tauri::command]
pub async fn agent_apply_profile(app: AppHandle, agent: String, id: String) -> Result<(), String> {
    blocking(move || apply_blocking(&agent, &id)).await??;
    notify(&app);
    Ok(())
}

/// Save the live config as a new profile (e.g. the endpoint set up before SSHUI).
#[tauri::command]
pub async fn agent_import_live(app: AppHandle, agent: String, name: String) -> Result<(), String> {
    blocking(move || {
        let agent_kind = self::agent(&agent)?;
        let mut p = live(agent_kind)?;
        p.name = name.trim().to_string();
        if p.base_url.is_empty() && agent_kind == Agent::Codex {
            // Codex pointed at another endpoint through environment variables
            p.base_url = userenv::effective_var("OPENAI_BASE_URL").unwrap_or_default();
            if p.api_key.is_empty() {
                p.api_key = userenv::effective_var("OPENAI_API_KEY").unwrap_or_default();
            }
        }
        if p.base_url.is_empty() {
            return Err("The current configuration uses the official endpoint; edit the Official profile instead".into());
        }
        p.id = format!(
            "p{:x}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
        );
        validate(agent_kind, &p)?;
        let mut store = load_store()?;
        let list = &mut store.agent_mut(agent_kind).profiles;
        if list.iter().any(|x| x.name.eq_ignore_ascii_case(&p.name)) {
            return Err(format!("A profile named \"{}\" already exists", p.name));
        }
        list.push(p);
        save_store(&store)
    })
    .await??;
    notify(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn relay() -> AgentProfile {
        AgentProfile {
            id: "p1".into(),
            name: "Relay".into(),
            base_url: "https://relay.example.com/v1".into(),
            api_key: "sk-test-1234567890".into(),
            model: "gpt-5".into(),
            wire_api: "responses".into(),
            ..Default::default()
        }
    }

    #[test]
    fn codex_profiles_round_trip() {
        let mut doc = "model = \"old\"\nnotify = [\"x\"]\n\n[mcp_servers.repl]\ncommand = \"node\"\n".parse::<Document>().unwrap();
        apply_codex_doc(&mut doc, &relay());
        let text = doc.to_string();
        assert!(text.contains("model_provider = \"sshui\""), "{}", text);
        assert!(text.contains("[model_providers.sshui]\nname = \"Relay\"\nbase_url = \"https://relay.example.com/v1\""));
        assert!(text.contains("experimental_bearer_token = \"sk-test-1234567890\""));
        assert!(text.contains("[mcp_servers.repl]"));
        assert!(!text.contains("[model_providers]\n"));

        apply_codex_doc(&mut doc, &official(Agent::Codex));
        let text = doc.to_string();
        assert!(!text.contains("sshui") && !text.contains("model ="), "{}", text);
        assert!(text.starts_with("notify = [\"x\"]\n"));
    }

    #[test]
    fn matching_detects_current_profile() {
        let p = relay();
        assert!(matches(Agent::Codex, &p, &AgentProfile { api_key: p.api_key.clone(), base_url: "https://relay.example.com/v1/".into(), model: "gpt-5".into(), ..Default::default() }));
        assert!(!matches(Agent::Codex, &p, &AgentProfile { model: "gpt-5".into(), ..Default::default() }));
        let off = official(Agent::Claude);
        assert!(matches(Agent::Claude, &off, &AgentProfile::default()));
        assert!(!matches(Agent::Claude, &off, &AgentProfile { base_url: "https://x".into(), ..Default::default() }));
    }

    #[test]
    fn validates_profiles() {
        assert!(validate(Agent::Claude, &AgentProfile { name: "A".into(), base_url: "https://a".into(), ..Default::default() }).is_ok());
        assert!(validate(Agent::Claude, &AgentProfile { name: "A".into(), base_url: "a.com".into(), ..Default::default() }).is_err());
        assert!(validate(Agent::Claude, &AgentProfile { name: " ".into(), base_url: "https://a".into(), ..Default::default() }).is_err());
        assert!(validate(Agent::Codex, &AgentProfile { name: "O".into(), id: OFFICIAL_ID.into(), ..Default::default() }).is_ok());
    }
}
