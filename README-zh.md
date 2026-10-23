# SSHUI

[English](./README.md)

**集中管理 SSH 与各类开发工具的配置文件。**可以作为桌面应用使用，也可以作为服务器上的轻量网页使用。

SSHUI 用懂得每个文件含义的可视化编辑器，替代手工修改各种配置文件，包括 `~/.ssh/config`、SSH 密钥、hosts 文件、代理设置、包管理器镜像、AI 编程 CLI 等。每次修改前都会先备份，写入前也能看到具体改了什么。

## 版本

| | **SSHUI 桌面版** | **SSHUI Lite** |
|---|---|---|
| 形态 | 运行在你自己电脑上的原生应用 | 运行在 Linux 服务器上的网页 |
| 平台 | Windows、macOS、Linux | Debian / Ubuntu，由 Caddy 提供 HTTPS 与登录 |
| 管理范围 | SSH、hosts 文件、代理、开发工具、AI CLI、sing-box、WSL | 服务器上的 `~/.ssh/config` |
| 安装 | [Releases](https://github.com/tionmon/sshui/releases) | `bash lite/deploy.sh <服务器>` |
| 文档 | [见下文](#sshui-桌面版) | [lite/README-zh.md](./lite/README-zh.md) |

---

## SSHUI 桌面版

### 可以管理什么

**SSH**
- **主机**：列出、搜索、添加、编辑、删除 `~/.ssh/config` 中的 `Host` 条目，支持 ProxyJump / ProxyCommand 和高级选项。
- **SSH 密钥**：生成 Ed25519、RSA、ECDSA 密钥，查看指纹，复制公钥，删除前确认。
- **配置编辑器**：带语法高亮（Monaco）直接编辑原始文件。
- **备份**：每次保存前自动按时间备份，可浏览、恢复、删除。

**系统**
- **hosts 文件**：保存多套 hosts 方案（开发、测试、广告屏蔽…），可在应用内或托盘中切换。只在切换时请求管理员权限；切换前会备份原文件并刷新 DNS 缓存。
- **代理方案**：保存多个代理，一键应用到 git、npm、pip、Cargo、Claude Code、`HTTP(S)_PROXY` 和 Windows 系统代理，并显示哪些工具与当前方案一致。
- **sing-box**：无需手写 JSON 即可编辑节点、分组、规则集和路由规则。可导入分享链接（vless、vmess、trojan、ss、hysteria2、tuic、anytls、wireguard…）或订阅，构建中转链路并防止循环。重命名会同步更新所有引用。保存时显示差异、运行 `sing-box check` 并保留备份。
- **Windows**：用户 `PATH` 与环境变量、WSL（`.wslconfig`）设置与发行版。

**开发工具**
- **GitHub**：`gh` 登录、SSH 连通性测试、git 身份与代理。
- **npm、Python（pip）、Rust（Cargo / rustup）、Go**：镜像源（含测速）、代理与令牌。
- **Docker**：镜像仓库登录与 Docker Hub 加速镜像。
- **Codex CLI 与 Claude Code**：保存多套 API 方案（地址、密钥、模型），可在应用内或托盘中切换。还可设置模型和审批/权限，编辑 `AGENTS.md` / `CLAUDE.md`、提示词、子代理、斜杠命令、输出风格与技能，或直接编辑 `config.toml` / `settings.json`。

主机、密钥、编辑器和备份始终显示；其他页面可在 **设置 → 高级** 中显示或隐藏。未安装的工具会显示“未安装”视图，不会读取或启动它们。

**通用**：English / 中文，浅色 / 深色 / 跟随系统主题，系统托盘图标（关闭窗口会最小化到托盘），Geist 字体的简洁中性设计。

### 安装

从 [Releases](https://github.com/tionmon/sshui/releases) 下载最新版本：

| 平台 | 文件 |
|---|---|
| Windows（x64） | `SSHUI_<版本>_x64-setup.exe` |
| macOS，Apple 芯片 | `SSHUI_<版本>_aarch64.dmg` |
| macOS，Intel | `SSHUI_<版本>_x64.dmg` |
| Linux（x64） | `.AppImage`、`.deb` 或 `.rpm` |

### 数据存放位置

SSHUI 自己保存的数据都在 `~/.ssh-at/` 中：

| 路径 | 内容 |
|---|---|
| `settings.json` | 应用设置及显示哪些页面 |
| `backups/` | `~/.ssh/config` 的备份 |
| `creds/` | 在应用中生成的密钥 |
| `hosts-schemes.json`、`hosts-backups/` | hosts 方案及系统 hosts 文件的备份 |
| `env-backups/` | 环境变量的备份（Windows） |
| `proxy-profiles.json` | 保存的代理方案 |
| `agent-profiles.json` | Codex CLI / Claude Code 的 API 方案，**包含 API 密钥** |
| `singbox.json` | sing-box 编辑器状态 |

原始配置编辑器和 sing-box 编辑器保存工具自身的文件时，会在旁边保留上一版本 `<文件>.sshui-bak`。

### 从源码构建

需要 Node.js 20+、pnpm 8+、Rust 1.88+，以及对应平台的 Tauri 依赖：
- **Windows**：WebView2（Windows 10/11 已自带）
- **macOS**：Xcode Command Line Tools
- **Linux**：`libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`

```bash
git clone https://github.com/tionmon/sshui.git
cd sshui
pnpm install
pnpm tauri dev      # 开发模式运行
pnpm tauri build    # 安装包输出到 src-tauri/target/release/bundle/
```

### 技术栈

前端为 React 19、TypeScript、MUI、Monaco Editor、TanStack Query、i18next；后端为 Rust 与 Tauri 2。

---

## SSHUI Lite

面向无图形界面 Linux 服务器的轻量 Web 版：在浏览器中编辑服务器上的 `~/.ssh/config`。包含三个页面：
- 主机列表
- 原始配置编辑器
- 备份与恢复

每次保存都会显示差异、用 `ssh -G` 校验，并以 600 权限写入。它只是一个仅用 Python 标准库的文件，由 Caddy 提供 HTTPS 与登录。

```bash
bash lite/deploy.sh <ssh 主机> SSHUI_DOMAIN=ssh.example.com   # 首次安装
bash lite/deploy.sh <ssh 主机>                                 # 更新
```

安装脚本是幂等的，同时会修正 `~/.ssh` 权限（私钥 → 600）。参数、细节与故障排查见 **[lite/README-zh.md](./lite/README-zh.md)**。

---

## 仓库结构

| 路径 | |
|---|---|
| `src/` | 桌面版前端（React） |
| `src-tauri/` | 桌面版后端（Tauri 命令） |
| `crates/ssh-at-core`、`crates/ssh-at-storage` | SSH 配置解析、密钥处理、备份 |
| `lite/` | SSHUI Lite：Web 应用、安装脚本与部署脚本 |

## 许可证

[Apache 2.0](./LICENSE)。

SSHUI 最初基于 [baerwang/ssh-at](https://github.com/baerwang/ssh-at)（Apache-2.0）开发，视觉风格参考 [Storage UI](https://github.com/hahahumble/storageui)。
