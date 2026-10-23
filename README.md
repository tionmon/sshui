# SSHUI

[中文文档](./README-zh.md)

> SSHUI is a fork of [baerwang/ssh-at](https://github.com/baerwang/ssh-at) (Apache-2.0), maintained independently with a redesigned interface. The visual style is inspired by [Storage UI](https://github.com/hahahumble/storageui).

## Editions

SSHUI comes in two editions that share the same look:

| | **SSHUI Desktop** | **SSHUI Lite** |
|---|---|---|
| Runs as | Native app (Tauri) on macOS, Windows, Linux | Small web service on a Linux server, behind Caddy |
| Manages | `~/.ssh/config`, SSH keys, hosts file, proxies, dev tools, sing-box… | `~/.ssh/config` only |
| Access | Local window + system tray | Browser, over HTTPS with a login |
| Dependencies | Bundled installer | Python 3 standard library, no packages |
| Docs | [Desktop app](#desktop-app) below | [lite/README.md](./lite/README.md) |

## Desktop app

### Overview

**SSHUI** is a desktop GUI tool for managing SSH keys, hosts, and configurations. Generate keys, edit `~/.ssh/config` visually, and keep automatic backups—all in one app.

Built with Tauri 2, React, and Rust for a native cross-platform experience.

### Features

- **📝 SSH Config Management**
  - Visual editor for `~/.ssh/config`
  - Add, edit, delete, and search SSH hosts
  - Real-time syntax highlighting with Monaco Editor
  - Automatic backup before every save

- **🔑 SSH Key Management**
  - Generate SSH keys (RSA, Ed25519, ECDSA)
  - View key fingerprints
  - One-click copy public keys to clipboard
  - Delete keys with confirmation

- **💾 Backup & Restore**
  - Automatic timestamped backups
  - Browse and restore previous configs
  - Delete old backups

- **🗂️ Hosts File Management**
  - Edit the system hosts file with syntax highlighting
  - Save multiple hosts schemes (e.g. Development, Staging, Ad blocking)
  - One-click switching from the app or the system tray menu
  - Requests administrator rights only when needed (UAC / macOS prompt / pkexec)
  - Automatic backup of the previous hosts file and DNS cache flush on every switch

- **🌐 Proxy Profiles**
  - Save proxies (e.g. a local Clash port, the office proxy) and switch them in one click, also from the tray
  - Applies to git, npm, pip, Cargo, Claude Code, the HTTP(S)_PROXY environment variables and the Windows system proxy
  - Shows which tools match the active profile

- **🕸️ sing-box Config Editor** (enable in Settings → Advanced)
  - Edit nodes, node groups, rule sets and routing rules of any sing-box config.json without writing JSON
  - Import share links (vless, vmess, trojan, ss, hysteria2, tuic, anytls, wireguard…) or base64 subscription content
  - Relay (detour) chains with a preview and loop prevention; hide or disable nodes and bring them back later
  - Renames and deletes update every reference; problems are flagged while editing
  - Saving shows a diff, runs `sing-box check` when available and keeps a `.sshui-bak` backup

- **🧰 Developer & System Tools** (each can be shown or hidden in Settings → Advanced)
  - GitHub: gh login, SSH access test, git identity and proxy
  - npm, pip, Cargo/rustup and Go: registry mirrors with speed tests, proxies and tokens
  - Docker: registry logins and Docker Hub mirrors
  - Codex CLI and Claude Code: saved API profiles (base URL, key, models) switched in one click or from the tray; model, approvals/permissions; edit AGENTS.md / CLAUDE.md, custom prompts, subagents, slash commands, output styles and skills; raw config.toml / settings.json editor
  - Windows: user PATH and environment variable editor, WSL (.wslconfig) settings and distributions
  - Tools that aren't installed show a "not installed" view; nothing is read or started for them

- **🌍 Multi-language Support**
  - English / 中文
  - Auto-detect system language

- **🎨 Modern UI**
  - Clean neutral design system (Geist type, hairline borders, soft status badges) built on MUI
  - Light / Dark / System theme, switchable from the sidebar
  - System tray integration (minimize to tray, not quit)
  - macOS Dock icon auto-hide when minimized

### Screenshots

_Screenshots below predate the UI redesign and will be refreshed._

#### Hosts Management
![Hosts Management](./screenshots/hosts.png)

#### SSH Keys
![SSH Keys](./screenshots/keys.png)

#### Config Editor
![Config Editor](./screenshots/editor.png)

#### Backups
![Backups](./screenshots/backups.png)

#### Settings
![Settings](./screenshots/settings.png)

### Tech Stack

**Frontend:**
- React 19 + TypeScript
- Material-UI (MUI)
- Monaco Editor
- React Router
- React Query
- i18next

**Backend:**
- Rust
- Tauri 2
- Tokio (async runtime)
- Custom SSH config parser

**Build:**
- Vite
- pnpm

### Installation

#### Download Pre-built Binaries

Go to [Releases](https://github.com/tionmon/sshui/releases) and download:

- **macOS**: `.dmg` (Universal binary for Intel & Apple Silicon)
- **Windows**: `.msi`
- **Linux**: `.AppImage` or `.deb`

#### Build from Source

**Prerequisites:**
- Node.js 20+
- pnpm 8+
- Rust 1.88+
- Platform-specific dependencies:
  - **macOS**: Xcode Command Line Tools, `create-dmg` (`brew install create-dmg`)
  - **Linux**: `libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`
  - **Windows**: WebView2 (usually pre-installed on Windows 10+)

**Build Steps:**

```bash
# Clone the repository
git clone https://github.com/tionmon/sshui.git
cd sshui

# Install dependencies
pnpm install

# Development mode
pnpm tauri dev

# Production build
pnpm tauri build
```

Build outputs:
- macOS: `src-tauri/target/release/bundle/macos/SSHUI.app` and `.dmg`
- Windows: `src-tauri/target/release/bundle/msi/*.msi`
- Linux: `src-tauri/target/release/bundle/appimage/*.AppImage` and `.deb`

### Usage

1. **Launch the app**
   - macOS: Drag `SSHUI.app` to `/Applications` and launch
   - Windows: Run the `.msi` installer
   - Linux: Make `.AppImage` executable and run, or install `.deb`

2. **Manage SSH Hosts**
   - Navigate to **Hosts** tab
   - Click **+** to add a new host
   - Edit inline or use the **Config Editor** for raw editing

3. **Generate SSH Keys**
   - Go to **Keys** tab
   - Click **Generate Key**
   - Choose algorithm (Ed25519 recommended), name, passphrase
   - Keys are saved to `~/.ssh-at/creds/`

4. **Backups**
   - Visit **Backups** tab to view all automatic backups
   - Restore or delete as needed

5. **Settings**
   - Toggle theme (light/dark)
   - Switch language (English/中文)
   - Open config directory

## SSHUI Lite (Linux server)

A lightweight web version for headless Linux servers: edit the server's `~/.ssh/config` from a browser.
It has a Hosts table (add / edit / delete `Host` entries), a raw config editor, and automatic backups with restore.
Every save is shown as a diff, checked with `ssh -G` first and written atomically with mode 600.

Deploy or update from a checkout of this repo with one command:

```bash
bash lite/deploy.sh <ssh-host> SSHUI_DOMAIN=ssh.example.com   # first install
bash lite/deploy.sh <ssh-host>                                 # later updates
```

See **[lite/README.md](./lite/README.md)** for options, what the installer does and troubleshooting.

## License

Apache 2.0
