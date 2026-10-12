use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub auto_backup: bool,
    pub backup_limit: u32,
    pub confirm_delete: bool,
    /// Show the GitHub page in the sidebar
    #[serde(default = "default_true")]
    pub show_github: bool,
    /// Developer tool pages, off until the user enables them
    #[serde(default)]
    pub show_npm: bool,
    #[serde(default)]
    pub show_docker: bool,
    #[serde(default)]
    pub show_pip: bool,
    /// Proxy profiles page
    #[serde(default = "default_true")]
    pub show_proxy: bool,
    /// Environment variables page (Windows)
    #[serde(default)]
    pub show_env: bool,
    #[serde(default)]
    pub show_rust: bool,
    #[serde(default)]
    pub show_go: bool,
    /// WSL page (Windows)
    #[serde(default)]
    pub show_wsl: bool,
    /// AI coding agents
    #[serde(default)]
    pub show_codex: bool,
    #[serde(default)]
    pub show_claude: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            auto_backup: true,
            backup_limit: 10,
            confirm_delete: true,
            show_github: true,
            show_npm: false,
            show_docker: false,
            show_pip: false,
            show_proxy: true,
            show_env: false,
            show_rust: false,
            show_go: false,
            show_wsl: false,
            show_codex: false,
            show_claude: false,
        }
    }
}

fn get_settings_path() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or("Failed to get home directory")?;
    let ssh_at_dir = home_dir.join(".ssh-at");

    if !ssh_at_dir.exists() {
        fs::create_dir_all(&ssh_at_dir).map_err(|e| e.to_string())?;
    }

    Ok(ssh_at_dir.join("settings.json"))
}

#[tauri::command]
pub async fn load_settings() -> Result<AppSettings, String> {
    let settings_path = get_settings_path()?;

    if !settings_path.exists() {
        // 返回默认设置
        return Ok(AppSettings::default());
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;

    let settings: AppSettings = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings: {}", e))?;

    Ok(settings)
}

#[tauri::command]
pub async fn save_settings(settings: AppSettings) -> Result<(), String> {
    let settings_path = get_settings_path()?;

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;

    Ok(())
}
