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
