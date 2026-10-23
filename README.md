# SSHUI

[中文](./README-zh.md)

**One place for the config files behind your SSH and developer tools.** Use it on your desktop, or as a small web page on a server.

SSHUI replaces hand-editing dotfiles with a visual editor that knows what each file means. That covers `~/.ssh/config`, SSH keys, the hosts file, proxy settings, package-manager mirrors, AI coding CLIs and more. Every change is backed up first, and you can see exactly what will be written.

## Editions

| | **SSHUI Desktop** | **SSHUI Lite** |
|---|---|---|
| What | Native app for your own computer | Web page for a Linux server |
| Platforms | Windows, macOS, Linux | Debian / Ubuntu, behind Caddy (HTTPS + login) |
| Covers | SSH, hosts file, proxies, dev tools, AI CLIs, sing-box, WSL | The server's `~/.ssh/config` |
| Install | [Releases](https://github.com/tionmon/sshui/releases) | `bash lite/deploy.sh <server>` |
| Docs | [below](#sshui-desktop) | [lite/README.md](./lite/README.md) |

---

## SSHUI Desktop

### What you can manage

**SSH**
- **Hosts**: list, search, add, edit and delete `Host` entries in `~/.ssh/config`, including ProxyJump / ProxyCommand and advanced options.
- **SSH keys**: generate Ed25519, RSA or ECDSA keys, view fingerprints, copy public keys and delete with confirmation.
- **Config editor**: edit the raw file with syntax highlighting (Monaco).
- **Backups**: a timestamped copy before every save; browse, restore and delete them.

**System**
- **Hosts file**: keep several hosts schemes (development, staging, ad blocking…) and switch between them from the app or the tray. Administrator rights are requested only for the switch. The previous file is backed up and the DNS cache is flushed.
- **Proxy profiles**: save proxies and apply one in a click to git, npm, pip, Cargo, Claude Code, `HTTP(S)_PROXY` and the Windows system proxy. The app shows which tools match the active profile.
- **sing-box**: edit nodes, groups, rule sets and routing rules without writing JSON. You can import share links (vless, vmess, trojan, ss, hysteria2, tuic, anytls, wireguard…) or subscriptions, and build relay chains with loop prevention. Renames update every reference. Saving shows a diff, runs `sing-box check` and keeps a backup.
- **Windows**: user `PATH` and environment variables, WSL (`.wslconfig`) settings and distributions.

**Developer tools**
- **GitHub**: `gh` login, SSH access test, git identity and proxy.
- **npm, Python (pip), Rust (Cargo / rustup), Go**: registry mirrors with speed tests, proxies and tokens.
- **Docker**: registry logins and Docker Hub mirrors.
- **Codex CLI and Claude Code**: save API profiles (base URL, key, models) and switch them from the app or the tray. You can also set the model and approvals/permissions, and edit `AGENTS.md` / `CLAUDE.md`, prompts, subagents, slash commands, output styles and skills, or the raw `config.toml` / `settings.json`.

Hosts, keys, the editor and backups are always on. The other pages can be shown or hidden in **Settings → Advanced**. Tools that aren't installed get a "not installed" view, and nothing is read or started for them.

**Everywhere:** English / 中文, light / dark / system theme, a system tray icon (closing the window minimises to the tray), and a neutral design with Geist type.

### Install

Download the latest build from [Releases](https://github.com/tionmon/sshui/releases):

| Platform | File |
|---|---|
| Windows (x64) | `SSHUI_<version>_x64-setup.exe` |
| macOS, Apple Silicon | `SSHUI_<version>_aarch64.dmg` |
| macOS, Intel | `SSHUI_<version>_x64.dmg` |
| Linux (x64) | `.AppImage`, `.deb` or `.rpm` |

### Where it keeps its data

Everything SSHUI keeps for itself is in `~/.ssh-at/`:

| Path | Contents |
|---|---|
| `settings.json` | App settings and which pages are shown |
| `backups/` | Backups of `~/.ssh/config` |
| `creds/` | Keys generated in the app |
| `hosts-schemes.json`, `hosts-backups/` | Hosts schemes and backups of the system hosts file |
| `env-backups/` | Backups of environment variables (Windows) |
| `proxy-profiles.json` | Saved proxy profiles |
| `agent-profiles.json` | Codex CLI / Claude Code API profiles, **including API keys** |
| `singbox.json` | sing-box editor state |

When the raw editors and the sing-box editor save a tool's own file, they keep the previous version next to it as `<file>.sshui-bak`.

### Build from source

Requirements: Node.js 20+, pnpm 8+, Rust 1.88+, and the Tauri prerequisites for your platform:
- **Windows**: WebView2 (included in Windows 10/11)
- **macOS**: Xcode Command Line Tools
- **Linux**: `libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`

```bash
git clone https://github.com/tionmon/sshui.git
cd sshui
pnpm install
pnpm tauri dev      # run in development
pnpm tauri build    # installers in src-tauri/target/release/bundle/
```

### Built with

React 19, TypeScript, MUI, Monaco Editor, TanStack Query and i18next on the front end, with Rust and Tauri 2 behind it.

---

## SSHUI Lite

A lightweight web version for headless Linux servers. It edits the server's `~/.ssh/config` from a browser and has three pages:
- a Hosts table
- a raw config editor
- backups with restore

Each save shows a diff, is checked with `ssh -G` and is written with mode 600. It's a single Python file using only the standard library, behind Caddy with HTTPS and a login.

```bash
bash lite/deploy.sh <ssh-host> SSHUI_DOMAIN=ssh.example.com   # first install
bash lite/deploy.sh <ssh-host>                                 # updates
```

The installer is idempotent. It also fixes `~/.ssh` permissions (private keys → 600). Options, details and troubleshooting are in **[lite/README.md](./lite/README.md)**.

---

## Repository layout

| Path | |
|---|---|
| `src/` | Desktop front end (React) |
| `src-tauri/` | Desktop back end (Tauri commands) |
| `crates/ssh-at-core`, `crates/ssh-at-storage` | SSH config parser, key handling, backups |
| `lite/` | SSHUI Lite: web app, installer and deploy script |

## License

[Apache 2.0](./LICENSE).

SSHUI started from [baerwang/ssh-at](https://github.com/baerwang/ssh-at) (Apache-2.0). Its visual style is inspired by [Storage UI](https://github.com/hahahumble/storageui).
