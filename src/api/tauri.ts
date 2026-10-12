import { invoke } from '@tauri-apps/api/core'

// Full version matching Rust backend HostEntry
export interface HostEntry {
  host: string
  hostname?: string
  user?: string
  port?: number
  identity_file?: string
  proxy_jump?: string
  proxy_command?: string
  forward_agent?: boolean
  strict_host_key_checking?: string
  server_alive_interval?: number
  server_alive_count_max?: number
  compression?: boolean
  connection_attempts?: number
  connect_timeout?: number
  // One entry per config line, e.g. "8080 localhost:80" (listener, space, destination)
  local_forward?: string[]
  remote_forward?: string[]
  dynamic_forward?: string[]
  pubkey_accepted_key_types?: string
  host_key_algorithms?: string
  extra_options?: Record<string, string>
}

export interface SshConfig {
  hosts: HostEntry[]
  global_options?: Record<string, string>
}

export interface KeyInfo {
  path: string
  key_type: string
  fingerprint: string
  comment?: string
  size?: number
  created?: string
  is_encrypted: boolean
}

export interface BackupInfo {
  id: number
  timestamp: string
  file_path: string
  config_hash: string
  host_count: number
  size_bytes: number
}

// Config operations
export const loadSshConfig = (): Promise<SshConfig> =>
  invoke('load_ssh_config')

export const saveSshConfig = (config: SshConfig): Promise<void> =>
  invoke('save_ssh_config', { config })

export const serializeSshConfig = (config: SshConfig): Promise<string> =>
  invoke('serialize_ssh_config', { config })

export const parseSshConfig = (content: string): Promise<SshConfig> =>
  invoke('parse_ssh_config', { content })

export const addHost = (entry: HostEntry): Promise<void> =>
  invoke('add_host', { entry })

export const updateHost = (name: string, entry: HostEntry): Promise<void> =>
  invoke('update_host', { name, entry })

export const deleteHost = async (name: string): Promise<void> => {
  console.log('[tauri.ts deleteHost] 🔥 Invoking delete_host command with:', name)
  try {
    await invoke('delete_host', { name })
    console.log('[tauri.ts deleteHost] 🔥 Command succeeded')
  } catch (error) {
    console.error('[tauri.ts deleteHost] 🔥 Command failed with error:', error)
    throw error
  }
}

export const searchHosts = (query: string): Promise<HostEntry[]> =>
  invoke('search_hosts', { query })

// Key operations
export const scanSshKeys = (): Promise<KeyInfo[]> =>
  invoke('scan_ssh_keys')

export const getKeyFingerprint = (path: string): Promise<string> =>
  invoke('get_key_fingerprint', { path })

export const generateSshKey = (
  keyType: string,
  name: string,
  comment?: string,
  passphrase?: string,
  bits?: number
): Promise<void> =>
  invoke('generate_ssh_key', { keyType, name, comment, passphrase, bits })

export const deleteSshKey = (path: string): Promise<void> =>
  invoke('delete_ssh_key', { path })

export const readPublicKey = (privateKeyPath: string): Promise<string> =>
  invoke('read_public_key', { privateKeyPath })

// Backup operations
export const listBackups = (): Promise<BackupInfo[]> =>
  invoke('list_backups')

export const restoreBackup = (backupId: number): Promise<void> =>
  invoke('restore_backup', { backupId })

export const deleteBackup = async (backupId: number): Promise<void> => {
  console.log('[tauri.ts deleteBackup] 🔥 Invoking delete_backup command with:', backupId)
  try {
    await invoke('delete_backup', { backupId })
    console.log('[tauri.ts deleteBackup] 🔥 Command succeeded')
  } catch (error) {
    console.error('[tauri.ts deleteBackup] 🔥 Command failed with error:', error)
    throw error
  }
}

// System operations
export const openConfigDir = (): Promise<void> =>
  invoke('open_config_dir')

// Settings operations
export interface AppSettings {
  auto_backup: boolean
  backup_limit: number
  confirm_delete: boolean
  /** Show the GitHub page in the sidebar (missing in older settings files → true) */
  show_github?: boolean
  /** Developer tool pages in the sidebar (default off) */
  show_npm?: boolean
  show_docker?: boolean
  show_pip?: boolean
  /** Proxy profiles page (missing → true) */
  show_proxy?: boolean
  /** Environment variables and WSL pages are Windows only */
  show_env?: boolean
  show_rust?: boolean
  show_go?: boolean
  show_wsl?: boolean
  show_codex?: boolean
  show_claude?: boolean
}

export const loadSettings = (): Promise<AppSettings> =>
  invoke('load_settings')

export const saveSettings = (settings: AppSettings): Promise<void> =>
  invoke('save_settings', { settings })

// Hosts file operations
export interface HostsScheme {
  id: string
  name: string
  content: string
  updated_at: number
}

export interface HostsState {
  hosts_path: string
  system_content: string
  active_id: string | null
  schemes: HostsScheme[]
}

/** Emitted by the backend when schemes or the hosts file change (e.g. from the tray). */
export const HOSTS_STATE_CHANGED_EVENT = 'hosts-state-changed'

export const loadHostsState = (): Promise<HostsState> =>
  invoke('load_hosts_state')

export const saveHostsScheme = (scheme: { id?: string; name: string; content: string }): Promise<HostsScheme> =>
  invoke('save_hosts_scheme', { id: scheme.id ?? null, name: scheme.name, content: scheme.content })

export const deleteHostsScheme = (id: string): Promise<void> =>
  invoke('delete_hosts_scheme', { id })

export const applyHostsScheme = (id: string): Promise<HostsState> =>
  invoke('apply_hosts_scheme', { id })

export const saveSystemHosts = (content: string): Promise<HostsState> =>
  invoke('save_system_hosts', { content })

export const openHostsBackupDir = (): Promise<void> =>
  invoke('open_hosts_backup_dir')

// GitHub
export interface GhAccount {
  login: string
  active: boolean
  state: string
  token_source: string
  scopes: string[]
  git_protocol: string
}

export interface GithubStatus {
  gh: { installed: boolean; version: string | null; accounts: GhAccount[] }
  git: {
    installed: boolean
    version: string | null
    user_name: string | null
    user_email: string | null
    http_proxy: string | null
    https_proxy: string | null
    credential_helper: string | null
  }
  env_proxy: Record<string, string>
  known_host: boolean
}

export interface SshTestResult {
  status: 'ok' | 'denied' | 'network' | 'error'
  user: string | null
  message: string
}

export interface ProxyTestResult {
  reachable: boolean
  github_ok: boolean
  elapsed_ms: number
  message: string
}

/** Emitted during githubLogin() with the device code to enter on github.com */
export const GITHUB_LOGIN_CODE_EVENT = 'github-login-code'

export const githubStatus = (): Promise<GithubStatus> => invoke('github_status')
export const githubLogin = (): Promise<void> => invoke('github_login')
export const githubLoginCancel = (): Promise<void> => invoke('github_login_cancel')
export const githubLogout = (login: string): Promise<void> => invoke('github_logout', { login })
export const githubSshTest = (): Promise<SshTestResult> => invoke('github_ssh_test')
export const githubTrustHostKeys = (): Promise<number> => invoke('github_trust_host_keys')
export const githubSetGitIdentity = (name: string, email: string): Promise<void> =>
  invoke('github_set_git_identity', { name, email })
export const githubSetGitProxy = (proxy: string | null): Promise<void> => invoke('github_set_git_proxy', { proxy })
export const githubTestProxy = (proxy: string | null): Promise<ProxyTestResult> => invoke('github_test_proxy', { proxy })
export const openExternalUrl = (url: string): Promise<void> => invoke('open_external_url', { url })

// Developer tools (npm, Docker, pip)
export interface ToolPresence {
  installed: boolean
  path: string | null
}

export interface DevTools {
  npm: ToolPresence
  docker: ToolPresence
  python: ToolPresence
  git: ToolPresence
  /** cargo or rustup */
  rust: ToolPresence
  go: ToolPresence
  /** Windows only */
  wsl: ToolPresence
  codex: ToolPresence
  claude: ToolPresence
}

export interface NpmInfo {
  version: string | null
  config_path: string
  config_exists: boolean
  registry: string | null
  proxy: string | null
  https_proxy: string | null
  noproxy: string | null
  strict_ssl: string | null
  scopes: { scope: string; registry: string }[]
  auths: { registry: string; kind: 'token' | 'basic' | 'password' | 'username'; masked: string }[]
  env_overrides: Record<string, string>
}

export interface PipInfo {
  python_path: string
  pip_version: string | null
  config_path: string
  config_exists: boolean
  index_url: string | null
  extra_index_urls: string[]
  trusted_hosts: string[]
  proxy: string | null
  timeout: string | null
  env_overrides: Record<string, string>
}

export interface DockerInfo {
  version: string | null
  config_path: string
  config_exists: boolean
  current_context: string | null
  creds_store: string | null
  registries: { server: string; username: string | null; store: string }[]
  daemon_path: string
  daemon_exists: boolean
  registry_mirrors: string[]
}

export interface UrlTestResult {
  ok: boolean
  status: number | null
  elapsed_ms: number
  message: string
}

/** Scans PATH only — no tool is started. */
export const detectDevTools = (): Promise<DevTools> => invoke('detect_dev_tools')
export const npmInfo = (): Promise<NpmInfo> => invoke('npm_info')
export const npmSetConfig = (key: string, value: string | null): Promise<void> => invoke('npm_set_config', { key, value })
export const npmSetToken = (registry: string, token: string | null): Promise<void> =>
  invoke('npm_set_token', { registry, token })
export const npmWhoami = (registry: string | null): Promise<string> => invoke('npm_whoami', { registry })
export const pipInfo = (): Promise<PipInfo> => invoke('pip_info')
export const pipSetConfig = (key: string, value: string | null): Promise<void> => invoke('pip_set_config', { key, value })
export const dockerInfo = (): Promise<DockerInfo> => invoke('docker_info')
export const dockerLogin = (server: string, username: string, password: string): Promise<void> =>
  invoke('docker_login', { server, username, password })
export const dockerLogout = (server: string): Promise<void> => invoke('docker_logout', { server })
export const dockerSetMirrors = (mirrors: string[]): Promise<void> => invoke('docker_set_mirrors', { mirrors })
export const testUrl = (url: string, proxy: string | null = null): Promise<UrlTestResult> => invoke('test_url', { url, proxy })

// Proxy profiles
export interface ProxyProfile {
  id: string
  name: string
  url: string
  no_proxy: string
}

export type ProxyTarget = 'git' | 'npm' | 'pip' | 'cargo' | 'claude' | 'env' | 'system'

export interface ProxyTargetStatus {
  id: ProxyTarget
  available: boolean
  included: boolean
  current: string | null
  location: string
}

export interface ProxyState {
  profiles: ProxyProfile[]
  active_id: string | null
  targets: ProxyTargetStatus[]
}

export interface ProxyApplyResult {
  target: ProxyTarget
  ok: boolean
  message: string
}

/** The built-in "no proxy" profile id */
export const PROXY_DIRECT_ID = 'direct'
export const PROXY_STATE_CHANGED_EVENT = 'proxy-state-changed'

export const proxyState = (): Promise<ProxyState> => invoke('proxy_state')
export const proxySaveProfile = (profile: { id?: string; name: string; url: string; no_proxy: string }): Promise<ProxyProfile> =>
  invoke('proxy_save_profile', { id: profile.id ?? null, name: profile.name, url: profile.url, noProxy: profile.no_proxy })
export const proxyDeleteProfile = (id: string): Promise<void> => invoke('proxy_delete_profile', { id })
export const proxySetTargets = (targets: ProxyTarget[]): Promise<void> => invoke('proxy_set_targets', { targets })
export const proxyApply = (id: string): Promise<ProxyApplyResult[]> => invoke('proxy_apply', { id })

// Environment variables (Windows)
export interface EnvVar {
  name: string
  value: string
  expand: boolean
}

export interface PathEntry {
  value: string
  expanded: string
  exists: boolean
}

export interface EnvState {
  user: EnvVar[]
  system: EnvVar[]
  user_path: PathEntry[]
  system_path: PathEntry[]
  backup_dir: string
}

export const envState = (): Promise<EnvState> => invoke('env_state')
export const envSetVar = (name: string, value: string | null): Promise<void> => invoke('env_set_var', { name, value })
export const envSetUserPath = (entries: string[]): Promise<void> => invoke('env_set_user_path', { entries })
export const envOpenDialog = (): Promise<void> => invoke('env_open_dialog')

// Rust
export interface RustInfo {
  cargo_version: string | null
  rustup_version: string | null
  toolchains: { name: string; default: boolean }[]
  config_path: string
  config_exists: boolean
  registry_mirror: string | null
  replaced_with: string | null
  http_proxy: string | null
  check_revoke: boolean | null
  git_fetch_with_cli: boolean | null
  token: string | null
  credentials_path: string
  rustup_dist_server: string | null
  rustup_update_root: string | null
  env_overrides: Record<string, string>
}

export const rustInfo = (): Promise<RustInfo> => invoke('rust_info')
export const rustSetMirror = (url: string | null): Promise<void> => invoke('rust_set_mirror', { url })
export const rustSetConfig = (key: string, value: string | null): Promise<void> => invoke('rust_set_config', { key, value })
export const rustSetToken = (token: string | null): Promise<void> => invoke('rust_set_token', { token })
export const rustSetRustupMirror = (distServer: string | null, updateRoot: string | null): Promise<void> =>
  invoke('rust_set_rustup_mirror', { distServer, updateRoot })

// Go
export interface GoInfo {
  version: string | null
  gopath: string | null
  goroot: string | null
  gomodcache: string | null
  config_path: string
  config_exists: boolean
  goproxy: string | null
  gosumdb: string | null
  goprivate: string | null
  gotoolchain: string | null
  env_overrides: Record<string, string>
}

export const goInfo = (): Promise<GoInfo> => invoke('go_info')
export const goSetEnv = (key: string, value: string | null): Promise<void> => invoke('go_set_env', { key, value })

// WSL
export interface WslInfo {
  version: string | null
  distros: { name: string; version: number; default: boolean; base_path: string | null }[]
  config_path: string
  config_exists: boolean
  /** "section.key" → value */
  settings: Record<string, string>
}

export const wslInfo = (): Promise<WslInfo> => invoke('wsl_info')
export const wslSetConfig = (section: string, key: string, value: string | null): Promise<void> =>
  invoke('wsl_set_config', { section, key, value })
export const wslShutdown = (): Promise<void> => invoke('wsl_shutdown')
export const wslSetDefault = (name: string): Promise<void> => invoke('wsl_set_default', { name })

// AI coding agents (Codex CLI, Claude Code)
export type AgentId = 'codex' | 'claude'

export interface InstructionFile {
  /** Relative to the agent's home, '/'-separated */
  path: string
  exists: boolean
  size: number
  modified_ms: number
}

export interface InstructionGroup {
  id: string
  dir: string
  layout: 'single' | 'flat' | 'nested' | 'skill'
  files: InstructionFile[]
}

export interface InstructionFiles {
  home: string
  groups: InstructionGroup[]
}

export interface AgentConfigFile {
  path: string
  exists: boolean
  content: string
}

export interface CodexInfo {
  version: string | null
  config_path: string
  config_exists: boolean
  model: string | null
  model_reasoning_effort: string | null
  model_provider: string | null
  approval_policy: string | null
  sandbox_mode: string | null
  providers: string[]
  mcp_servers: string[]
  auth_mode: string | null
  env_overrides: Record<string, string>
}

export interface ClaudeInfo {
  version: string | null
  settings_path: string
  settings_exists: boolean
  model: string | null
  default_mode: string | null
  env: { name: string; value: string; secret: boolean }[]
  allow: string[]
  deny: string[]
  ask: string[]
}

export const agentInstructionFiles = (agent: AgentId): Promise<InstructionFiles> => invoke('agent_instruction_files', { agent })
export const agentReadFile = (agent: AgentId, path: string): Promise<string> => invoke('agent_read_file', { agent, path })
export const agentWriteFile = (agent: AgentId, path: string, content: string, create = false): Promise<void> =>
  invoke('agent_write_file', { agent, path, content, create })
export const agentDeleteFile = (agent: AgentId, path: string): Promise<void> => invoke('agent_delete_file', { agent, path })
export const agentConfig = (agent: AgentId): Promise<AgentConfigFile> => invoke('agent_config', { agent })
export const agentSaveConfig = (agent: AgentId, content: string): Promise<void> => invoke('agent_save_config', { agent, content })
export const codexInfo = (): Promise<CodexInfo> => invoke('codex_info')
export const codexSet = (key: string, value: string | null): Promise<void> => invoke('codex_set', { key, value })
export const claudeInfo = (): Promise<ClaudeInfo> => invoke('claude_info')
export const claudeSet = (path: string[], value: unknown): Promise<void> => invoke('claude_set', { path, value: value ?? null })
