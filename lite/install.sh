#!/usr/bin/env bash
# SSHUI Lite installer / updater. Run as root on the server from this directory.
# Safe to re-run: every step converges to the same end state.
#
#   SSHUI_DOMAIN=ssh.example.com bash install.sh
#
# Environment (all optional on re-runs; previous values are reused):
#   SSHUI_DOMAIN      public hostname served by Caddy (HTTPS + basic auth).
#                     Empty and no previous install -> local only (127.0.0.1).
#   SSHUI_USER        basic-auth user name                    (default: admin)
#   SSHUI_PASSWORD    basic-auth password. Empty -> keep the existing hash,
#                     or generate one on first install and print it once.
#   SSHUI_SSH_USER    whose ~/.ssh/config is edited           (default: root)
#   SSHUI_PORT        local port of the app                   (default: 8787)
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/sshui
DATA_DIR=/var/lib/sshui
UNIT=/etc/systemd/system/sshui.service
CADDYFILE=/etc/caddy/Caddyfile
MARK_BEGIN="# >>> sshui-lite (managed by lite/install.sh)"
MARK_END="# <<< sshui-lite"

SSHUI_USER="${SSHUI_USER:-admin}"
SSHUI_PASSWORD="${SSHUI_PASSWORD:-}"
SSHUI_SSH_USER="${SSHUI_SSH_USER:-root}"
SSHUI_PORT="${SSHUI_PORT:-8787}"
SSHUI_DOMAIN="${SSHUI_DOMAIN:-}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[[ "$SSHUI_PORT" =~ ^[0-9]+$ ]] || die "SSHUI_PORT must be a number"
[[ "$SSHUI_USER" =~ ^[A-Za-z0-9._-]+$ ]] || die "SSHUI_USER may only contain letters, digits, . _ -"
getent passwd "$SSHUI_SSH_USER" >/dev/null || die "user $SSHUI_SSH_USER does not exist"
SSH_HOME="$(getent passwd "$SSHUI_SSH_USER" | cut -d: -f6)"
SSH_DIR="$SSH_HOME/.ssh"
SSH_GROUP="$(id -gn "$SSHUI_SSH_USER")"

# Reuse the domain from a previous install when none is given: our managed
# block, or a hand-written site that already proxies to the app's port.
if [ -z "$SSHUI_DOMAIN" ] && [ -f "$CADDYFILE" ] && command -v python3 >/dev/null; then
  SSHUI_DOMAIN="$(MB="$MARK_BEGIN" PORT="$SSHUI_PORT" python3 - "$CADDYFILE" <<'PY'
import os, re, sys
text = open(sys.argv[1]).read()
mb = os.environ["MB"]
i = text.find(mb)
if i >= 0:
    print(text[i + len(mb):].strip().split("{")[0].strip())
    sys.exit()
for m in re.finditer(r"(?m)^(\S[^{\n]*?)\s*\{", text):
    depth, k = 0, m.end() - 1
    while k < len(text):
        depth += {"{": 1, "}": -1}.get(text[k], 0)
        k += 1
        if depth == 0:
            break
    if re.search(r"reverse_proxy\s+(127\.0\.0\.1|localhost):" + os.environ["PORT"] + r"\b", text[m.start():k]):
        print(m.group(1).strip())
        break
PY
)"
fi

# ---------------------------------------------------------------------------
step "Packages"
need=()
command -v python3 >/dev/null || need+=(python3)
command -v ssh >/dev/null     || need+=(openssh-client)
command -v curl >/dev/null    || need+=(curl)
if [ -n "$SSHUI_DOMAIN" ] && ! command -v caddy >/dev/null; then need+=(caddy); fi
if [ ${#need[@]} -gt 0 ]; then
  command -v apt-get >/dev/null || die "missing ${need[*]} and no apt-get; install them manually"
  info "installing ${need[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}" >/dev/null
else
  info "python3, ssh, curl${SSHUI_DOMAIN:+, caddy} present"
fi

# ---------------------------------------------------------------------------
step "Remove the legacy sshd editor (ssh-config-editor)"
if [ -f /etc/systemd/system/ssh-config-editor.service ] || [ -f /usr/local/libexec/ssh-config-editor.py ]; then
  systemctl disable --now ssh-config-editor.service 2>/dev/null || true
  rm -f /etc/systemd/system/ssh-config-editor.service /usr/local/libexec/ssh-config-editor.py
  info "removed"
else
  info "not present"
fi

# ---------------------------------------------------------------------------
step "Install app to $APP_DIR"
install -d -m 755 "$APP_DIR" "$APP_DIR/static"
install -m 755 "$SRC/app.py" "$APP_DIR/app.py"
install -m 644 "$SRC/static/index.html" "$SRC/static/favicon.svg" "$APP_DIR/static/"
install -d -m 700 "$DATA_DIR" "$DATA_DIR/backups"
info "editing $SSH_DIR/config, backups in $DATA_DIR/backups"

# ---------------------------------------------------------------------------
step "Fix ~/.ssh permissions for $SSHUI_SSH_USER"
# ssh ignores private keys and refuses configs that others can read/write.
install -d -m 700 -o "$SSHUI_SSH_USER" -g "$SSH_GROUP" "$SSH_DIR"
fix() { # fix <mode> <file>
  local cur; cur="$(stat -c %a "$2")"
  if [ "$cur" != "$1" ]; then chmod "$1" "$2"; info "$2: $cur -> $1"; fi
}
fixed_any=0
shopt -s nullglob
for f in "$SSH_DIR"/*; do
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  before="$(stat -c %a "$f")"
  case "$(basename "$f")" in
    *.pub) fix 644 "$f" ;;
    config|authorized_keys|authorized_keys2|known_hosts|known_hosts.old) fix 600 "$f" ;;
    *) case "$(head -c 64 "$f" 2>/dev/null | tr -d '\0')" in
         -----BEGIN*PRIVATE\ KEY*) fix 600 "$f" ;;
       esac ;;
  esac
  [ "$before" = "$(stat -c %a "$f")" ] || fixed_any=1
done
shopt -u nullglob
chown -R "$SSHUI_SSH_USER:$SSH_GROUP" "$SSH_DIR"
[ "$fixed_any" = 1 ] || info "all permissions already correct"

# ---------------------------------------------------------------------------
step "systemd service"
sed -e "s|^Environment=.*|Environment=SSHUI_HOST=127.0.0.1 SSHUI_PORT=$SSHUI_PORT SSHUI_CONFIG=$SSH_DIR/config|" \
    -e "s|^ReadWritePaths=.*|ReadWritePaths=$SSH_DIR $DATA_DIR|" \
    "$SRC/sshui.service" > "$UNIT.tmp"
mv "$UNIT.tmp" "$UNIT"
systemctl daemon-reload
systemctl enable sshui.service >/dev/null 2>&1
systemctl restart sshui.service
ok=0
for _ in $(seq 1 20); do
  if curl -fs -o /dev/null "http://127.0.0.1:$SSHUI_PORT/api/config"; then ok=1; break; fi
  sleep 0.5
done
[ "$ok" = 1 ] || { journalctl -u sshui -n 30 --no-pager; die "sshui did not come up on 127.0.0.1:$SSHUI_PORT"; }
info "sshui.service active on 127.0.0.1:$SSHUI_PORT"

# ---------------------------------------------------------------------------
NEW_PASSWORD=""
if [ -n "$SSHUI_DOMAIN" ]; then
  step "Caddy site $SSHUI_DOMAIN"
  mkdir -p /etc/caddy
  touch "$CADDYFILE"

  # Keep the existing password hash unless a new password was given.
  HASH=""
  if [ -z "$SSHUI_PASSWORD" ]; then
    HASH="$(SSHUI_DOMAIN="$SSHUI_DOMAIN" SSHUI_USER="$SSHUI_USER" python3 - "$CADDYFILE" <<'PY'
import os, re, sys
text = open(sys.argv[1]).read()
dom, user = re.escape(os.environ["SSHUI_DOMAIN"]), re.escape(os.environ["SSHUI_USER"])
m = re.search(r"(?ms)^" + dom + r"\s*\{.*?^\}", text)
if m:
    h = re.search(r"(?m)^\s*" + user + r"\s+(\$2[aby]\$\S+)", m.group(0))
    if h:
        print(h.group(1))
PY
)"
  fi
  if [ -z "$HASH" ]; then
    if [ -z "$SSHUI_PASSWORD" ]; then
      SSHUI_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(18))')"
      NEW_PASSWORD="$SSHUI_PASSWORD"
    fi
    HASH="$(caddy hash-password --plaintext "$SSHUI_PASSWORD")"
    info "password hash ${NEW_PASSWORD:+generated}${NEW_PASSWORD:-updated}"
  else
    info "keeping existing password for $SSHUI_USER"
  fi

  # basic_auth replaced basicauth in Caddy 2.8.
  CADDY_VER="$(caddy version | grep -oE '[0-9]+\.[0-9]+' | head -1)"
  AUTH_DIRECTIVE=basicauth
  if [ "$(printf '%s\n2.8\n' "$CADDY_VER" | sort -V | head -1)" = "2.8" ]; then AUTH_DIRECTIVE=basic_auth; fi

  BLOCK="$MARK_BEGIN
$SSHUI_DOMAIN {
	encode gzip
	$AUTH_DIRECTIVE {
		$SSHUI_USER $HASH
	}
	header {
		Strict-Transport-Security \"max-age=31536000\"
		X-Robots-Tag \"noindex, nofollow\"
		-Server
	}
	reverse_proxy 127.0.0.1:$SSHUI_PORT
}
$MARK_END"

  # Replace our managed block, or an unmanaged block for the same domain, or append.
  SSHUI_BLOCK="$BLOCK" SSHUI_DOMAIN="$SSHUI_DOMAIN" MB="$MARK_BEGIN" ME="$MARK_END" python3 - "$CADDYFILE" > "$CADDYFILE.sshui-new" <<'PY'
import os, re, sys
text = open(sys.argv[1]).read()
block, dom = os.environ["SSHUI_BLOCK"], os.environ["SSHUI_DOMAIN"]
mb, me = os.environ["MB"], os.environ["ME"]
i = text.find(mb)
if i >= 0:
    j = text.index(me, i) + len(me)
    text = text[:i] + block + text[j:]
else:
    m = re.search(r"(?m)^" + re.escape(dom) + r"\s*\{", text)
    if m:
        depth, k = 0, m.end() - 1
        while k < len(text):
            depth += {"{": 1, "}": -1}.get(text[k], 0)
            k += 1
            if depth == 0:
                break
        text = text[:m.start()] + block + text[k:]
    else:
        text = text.rstrip() + ("\n\n" if text.strip() else "") + block
sys.stdout.write(text.rstrip() + "\n")
PY

  if cmp -s "$CADDYFILE" "$CADDYFILE.sshui-new"; then
    rm -f "$CADDYFILE.sshui-new"
    info "Caddyfile unchanged"
  else
    cp -a "$CADDYFILE" "$CADDYFILE.bak-sshui-$(date +%Y%m%d-%H%M%S)"
    if ! caddy validate --config "$CADDYFILE.sshui-new" --adapter caddyfile >/tmp/sshui-caddy.log 2>&1; then
      cat /tmp/sshui-caddy.log; rm -f "$CADDYFILE.sshui-new"
      die "new Caddyfile is invalid; the old one was left in place"
    fi
    mv "$CADDYFILE.sshui-new" "$CADDYFILE"
    info "Caddyfile updated (previous copy saved next to it)"
  fi
  systemctl enable caddy >/dev/null 2>&1 || true
  if systemctl is-active --quiet caddy; then systemctl reload caddy; else systemctl start caddy; fi
  info "caddy $(systemctl is-active caddy)"
else
  step "Caddy"
  info "skipped: no SSHUI_DOMAIN. The app is only reachable on 127.0.0.1:$SSHUI_PORT"
  info "(e.g. ssh -L $SSHUI_PORT:127.0.0.1:$SSHUI_PORT <server>, then open http://127.0.0.1:$SSHUI_PORT)"
fi

# ---------------------------------------------------------------------------
step "Verify"
info "sshui: $(systemctl is-active sshui)"
info "config: $SSH_DIR/config ($( [ -f "$SSH_DIR/config" ] && echo "$(stat -c %a "$SSH_DIR/config"), $(grep -ciE '^\s*host\s' "$SSH_DIR/config" || true) Host entries" || echo "not created yet"))"
if [ -n "$SSHUI_DOMAIN" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$SSHUI_DOMAIN:443:127.0.0.1" "https://$SSHUI_DOMAIN/" || true)"
  if [ "$code" = 401 ]; then info "https://$SSHUI_DOMAIN/ -> 401 without login (auth active)"
  else info "WARNING: https://$SSHUI_DOMAIN/ returned '$code' (expected 401; a new certificate can take a minute, or DNS may not point here yet)"; fi
fi

printf '\n\033[32mSSHUI Lite is deployed.\033[0m\n'
[ -n "$SSHUI_DOMAIN" ] && printf '  URL:      https://%s\n  User:     %s\n' "$SSHUI_DOMAIN" "$SSHUI_USER"
[ -n "$NEW_PASSWORD" ] && printf '  Password: %s   (shown once; save it now)\n' "$NEW_PASSWORD"
exit 0
