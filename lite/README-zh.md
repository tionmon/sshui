# SSHUI Lite

[English](./README.md) · [返回 SSHUI](../README-zh.md)

SSHUI 面向 Linux 服务器的轻量 Web 版。在浏览器中编辑服务器上的 **SSH 客户端配置**（`~/.ssh/config`，默认是 root 的），由 Caddy 提供 HTTPS 并要求登录。

它**不会**修改 SSH *服务端*配置（`/etc/ssh/sshd_config`）。

## 功能

- **主机**：`Host` 条目列表，支持搜索、添加、编辑、删除。常用字段（HostName、User、Port、IdentityFile、ProxyJump）有独立输入框，其他选项和注释原样保留；编辑一个主机不会改动文件的其他部分。`Match` 块和通配条目会列出，在编辑器中修改。
- **配置编辑器**：整个文件，带语法着色、行号、校验按钮和 Ctrl+S 保存。
- **安全保存**：每次修改都会先显示差异，再用 `ssh -G` 在临时副本上校验（错误的选项或取值会被拒绝并标出行号，不写入任何内容），然后备份旧文件，并以 600 权限原子写入新文件。如果页面打开后文件在服务器上被改过，保存会被拒绝。
- **立即生效**：`ssh` 每次运行都会重新读取配置，无需重载。
- **备份**：每次保存前自动备份（保留最近 50 份），可与当前文件对比并恢复。
- 浅色 / 深色 / 跟随系统主题，English / 中文，支持手机。

## 环境要求

- Debian 或 Ubuntu（其他发行版需手动安装 `python3`、`openssh-client`、`curl`、`caddy`）
- 服务器 root 权限，或免密 `sudo` 的用户
- 如需 HTTPS：一个指向服务器的域名，并开放 80/443 端口（Caddy 会自动申请证书）

## 部署

在你自己电脑上的本仓库检出目录中运行（Linux、macOS，或 Windows 的 Git Bash）：

```bash
# 首次安装
bash lite/deploy.sh <ssh 主机> SSHUI_DOMAIN=ssh.example.com

# 更新到当前代码，保留域名、登录信息和数据
bash lite/deploy.sh <ssh 主机>

# 修改登录密码
bash lite/deploy.sh <ssh 主机> SSHUI_PASSWORD='新密码'
```

`<ssh 主机>` 可以是 `ssh` 能识别的任何形式（你本地 `~/.ssh/config` 中的别名，或 `root@1.2.3.4`）。首次安装如未指定 `SSHUI_PASSWORD`，会生成随机密码并在最后**只显示一次**。

也可以把 `lite/` 目录复制到服务器上，用同样的变量运行 `sudo bash install.sh`。

### 参数

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SSHUI_DOMAIN` | 沿用上次安装 | Caddy 对外提供的域名。不设置则只监听 `127.0.0.1`（通过 SSH 隧道访问）。 |
| `SSHUI_USER` | `admin` | 登录用户名 |
| `SSHUI_PASSWORD` | 保留现有，或自动生成 | 登录密码。Caddyfile 中只保存 bcrypt 哈希。 |
| `SSHUI_SSH_USER` | `root` | 编辑哪个用户的 `~/.ssh/config` |
| `SSHUI_PORT` | `8787` | 应用的本地端口 |

## 安装脚本做了什么

`install.sh` 是幂等的：重复运行会收敛到同一状态，并报告改动了什么。

1. 用 apt 安装缺少的软件包（`python3`、`openssh-client`、`curl`、`caddy`）。
2. 如果存在早期试验版 `ssh-config-editor.service`（sshd_config 编辑器），将其移除。
3. 把应用复制到 `/opt/sshui`，创建 `/var/lib/sshui/backups`（权限 700）。
4. **修正 `SSHUI_SSH_USER` 的 `~/.ssh` 权限**：目录设为 700；`config`、`authorized_keys`、`known_hosts` 设为 600；所有私钥（按 `-----BEGIN … PRIVATE KEY` 文件头识别，有无 `.pub` 均可）设为 600；`*.pub` 设为 644；属主改为该用户。这样可以避免 `Permissions 0666 for '…' are too open … This private key will be ignored`。
5. 安装并（重新）启动 `sshui.service`。服务只监听 `127.0.0.1` 并做了加固：只能写 `.ssh` 目录和备份目录。
6. 在 `/etc/caddy/Caddyfile` 的 `# >>> sshui-lite` 和 `# <<< sshui-lite` 标记之间写入站点配置；同域名已有手写配置块的，会将其接管。除非指定新密码，否则保留现有密码哈希；新配置校验通过后才替换（旧文件保存为 `Caddyfile.bak-sshui-*`），然后重载 Caddy。
7. 验证结果：服务在本地有响应，公网地址未登录时返回 401。

## 服务器上的文件

| 路径 | 内容 |
|---|---|
| `/opt/sshui/app.py`、`/opt/sshui/static/` | 应用（仅用 Python 标准库） |
| `/etc/systemd/system/sshui.service` | 服务单元 |
| `/var/lib/sshui/backups/` | 配置备份（`YYYYMMDD-HHMMSS-mmm.config`） |
| `/etc/caddy/Caddyfile` | `sshui-lite` 标记之间的站点配置 |

日志：`journalctl -u sshui` 和 `journalctl -u caddy`。

## 安全

- 应用只监听 `127.0.0.1`；HTTPS、HSTS 和登录认证由 Caddy 提供。
- 修改操作要求 JSON 请求并带自定义 `X-SSHUI` 请求头，其他网站无法借助浏览器已保存的登录状态伪造请求。
- 只能读写配置的那一个文件；主机名不会传给 shell。

## 故障排查

| 现象 | 处理 |
|---|---|
| 首次安装后 `https://…` 打不开 | 等一分钟让证书签发；确认域名解析到服务器且 80/443 已开放；查看 `journalctl -u caddy -n 50`。 |
| 忘记密码 | `bash lite/deploy.sh <主机> SSHUI_PASSWORD='…'` |
| `bad permissions` / `UNPROTECTED PRIVATE KEY FILE` | 重新部署一次（第 4 步会修正），或 `chmod 600 ~/.ssh/<密钥>`。 |
| 保存被拒绝 | 提示中会显示 `ssh` 的报错和行号，文件没有被修改。 |

## 卸载

```bash
systemctl disable --now sshui
rm -rf /opt/sshui /etc/systemd/system/sshui.service
systemctl daemon-reload
# 删除 /etc/caddy/Caddyfile 中 "# >>> sshui-lite" 与 "# <<< sshui-lite" 之间的内容，然后：
systemctl reload caddy
# 可选：rm -rf /var/lib/sshui   （备份）
```

`~/.ssh/config` 本身会保留。

## 运维 / AI 助手操作手册

当被要求在某台服务器上“部署”或“更新” SSHUI Lite 时：

1. 使用本仓库的最新检出（`git pull`）。
2. 运行 `bash lite/deploy.sh <ssh 主机>`，仅首次安装时加 `SSHUI_DOMAIN=…`。除非所有者要求改密码，否则不要传密码。
3. 阅读输出：每一步都会打印改动（修正了哪些权限、Caddyfile 是否更新、401 检查）。首次安装会显示一次生成的密码，需要转告所有者。
4. 目标是**客户端**配置 `~/.ssh/config`。不要修改 `/etc/ssh/sshd_config`，也不要重载 `sshd`。
5. 不要使用会匹配到远程 shell 自身命令行的 `pkill -f` 模式。
