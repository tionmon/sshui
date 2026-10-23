# SSHUI Lite

[中文文档](./README-zh.md) · [Back to SSHUI](../README.md)

A lightweight web version of SSHUI for Linux servers. It edits the server's **SSH client config** (`~/.ssh/config`, by default root's) from a browser, served over HTTPS by Caddy behind a login.

It does **not** touch the SSH *server* configuration (`/etc/ssh/sshd_config`).

## Features

- **Hosts**: table of `Host` entries with search, add, edit and delete. Common fields (HostName, User, Port, IdentityFile, ProxyJump) have their own inputs; other options and comments in a block are kept as-is. Editing one host leaves the rest of the file untouched. `Match` blocks and wildcard entries are listed and edited in the editor.
- **Config editor**: the whole file with syntax colouring, line numbers, a Validate button and Ctrl+S.
- **Safe saves**: every change shows a diff, is checked with `ssh -G` on a scratch copy (bad options and values are rejected with the line number, nothing is written), then the old file is backed up and the new one is written atomically with mode 600. If the file changed on the server since the page loaded, the save is refused.
- **Takes effect immediately**: `ssh` reads its config on every run, so no reload is needed.
- **Backups**: one is taken before every save (last 50 kept). Compare against the current file and restore.
- Light / dark / system theme, English / 中文, works on phones.

## Requirements

- Debian or Ubuntu (other distributions work if `python3`, `openssh-client`, `curl` and `caddy` are installed by hand)
- root on the server, or a user with passwordless `sudo`
- For HTTPS: a DNS name pointing at the server and ports 80/443 open (Caddy gets the certificate automatically)

## Deploy

From a checkout of this repository on your own machine (Linux, macOS, or Git Bash on Windows):

```bash
# First install
bash lite/deploy.sh <ssh-host> SSHUI_DOMAIN=ssh.example.com

# Update to the current code; keeps domain, login and data
bash lite/deploy.sh <ssh-host>

# Change the login password
bash lite/deploy.sh <ssh-host> SSHUI_PASSWORD='new password'
```

`<ssh-host>` is anything `ssh` accepts (a `Host` alias from your own `~/.ssh/config`, or `root@1.2.3.4`). On a first install without `SSHUI_PASSWORD`, a random password is generated and **printed once** at the end.

You can also copy the `lite/` folder to the server and run `sudo bash install.sh` there with the same variables.

### Options

| Variable | Default | Meaning |
|---|---|---|
| `SSHUI_DOMAIN` | reused from the previous install | Public hostname served by Caddy. Without one, the app only listens on `127.0.0.1` (use an SSH tunnel). |
| `SSHUI_USER` | `admin` | Login user name |
| `SSHUI_PASSWORD` | keep existing, or generate | Login password. Only a bcrypt hash is stored in the Caddyfile. |
| `SSHUI_SSH_USER` | `root` | Whose `~/.ssh/config` is edited |
| `SSHUI_PORT` | `8787` | Local port of the app |

## What the installer does

`install.sh` is idempotent: running it again converges to the same state and reports what changed.

1. Installs missing packages (`python3`, `openssh-client`, `curl`, `caddy`) with apt.
2. Removes the earlier experiment `ssh-config-editor.service` (an sshd_config editor) if it is present.
3. Copies the app to `/opt/sshui` and creates `/var/lib/sshui/backups` (mode 700).
4. **Fixes `~/.ssh` permissions** for `SSHUI_SSH_USER`: the directory is set to 700. `config`, `authorized_keys` and `known_hosts` are set to 600. Every private key (detected by its `-----BEGIN … PRIVATE KEY` header, with or without a `.pub`) is set to 600, and `*.pub` files to 644. Ownership is set to that user. This prevents `Permissions 0666 for '…' are too open … This private key will be ignored`.
5. Installs and (re)starts `sshui.service`. The service is bound to `127.0.0.1` and hardened: it can only write the `.ssh` directory and its backup folder.
6. Writes the Caddy site between `# >>> sshui-lite` and `# <<< sshui-lite` markers in `/etc/caddy/Caddyfile`, adopting an existing hand-written block for the same domain. It keeps the current password hash unless a new password is given, validates the result before swapping it in (the old file is kept as `Caddyfile.bak-sshui-*`), and reloads Caddy.
7. Verifies the result: the service answers locally, and the public URL returns 401 without a login.

## Files on the server

| Path | What |
|---|---|
| `/opt/sshui/app.py`, `/opt/sshui/static/` | The app (Python standard library only) |
| `/etc/systemd/system/sshui.service` | Service unit |
| `/var/lib/sshui/backups/` | Config backups (`YYYYMMDD-HHMMSS-mmm.config`) |
| `/etc/caddy/Caddyfile` | Site block between the `sshui-lite` markers |

Logs: `journalctl -u sshui` and `journalctl -u caddy`.

## Security

- The app listens on `127.0.0.1` only; Caddy adds HTTPS, HSTS and basic auth.
- Changes need a JSON request with a custom `X-SSHUI` header, so other websites can't forge them through the browser's saved login.
- Only the one configured file can be read or written; host names are never passed to a shell.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `https://…` doesn't load right after the first install | Wait a minute for the certificate; check that DNS points at the server and ports 80/443 are open; `journalctl -u caddy -n 50`. |
| Forgot the password | `bash lite/deploy.sh <host> SSHUI_PASSWORD='…'` |
| `bad permissions` / `UNPROTECTED PRIVATE KEY FILE` | Re-run the deploy (step 4 fixes it) or `chmod 600 ~/.ssh/<key>`. |
| A save is rejected | The message shows `ssh`'s error and line number; the file was not changed. |

## Uninstall

```bash
systemctl disable --now sshui
rm -rf /opt/sshui /etc/systemd/system/sshui.service
systemctl daemon-reload
# delete the block between "# >>> sshui-lite" and "# <<< sshui-lite" in /etc/caddy/Caddyfile, then:
systemctl reload caddy
# optional: rm -rf /var/lib/sshui   (backups)
```

`~/.ssh/config` itself is left in place.

## Runbook for an AI assistant / operator

When asked to "deploy" or "update" SSHUI Lite on a server:

1. Use an up-to-date checkout of this repository (`git pull`).
2. Run `bash lite/deploy.sh <ssh-host>` and add `SSHUI_DOMAIN=…` only on a first install. Never pass a password unless the owner asks for a change.
3. Read the output. Each step prints what it changed: permissions fixed, Caddyfile updated or unchanged, and the 401 check. A first install prints a generated password once, so relay it to the owner.
4. The target is the **client** config `~/.ssh/config`. Do not edit `/etc/ssh/sshd_config` or reload `sshd`.
5. Do not use `pkill -f` patterns that also match the remote shell's own command line.
