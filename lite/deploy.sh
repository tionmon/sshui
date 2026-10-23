#!/usr/bin/env bash
# Deploy or update SSHUI Lite on a server over SSH, from a checkout of this repo.
#
#   bash lite/deploy.sh <ssh-host> [VAR=value ...]
#
# Examples:
#   bash lite/deploy.sh myserver SSHUI_DOMAIN=ssh.example.com    # first install
#   bash lite/deploy.sh myserver                                  # update, keep settings
#   bash lite/deploy.sh myserver SSHUI_PASSWORD='new secret'      # change the login
#
# The remote user must be root (or have passwordless sudo).
set -euo pipefail

[ $# -ge 1 ] || { sed -n '2,12p' "$0"; exit 1; }
HOST="$1"; shift
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

envs=""
for kv in "$@"; do
  case "$kv" in
    SSHUI_DOMAIN=*|SSHUI_USER=*|SSHUI_PASSWORD=*|SSHUI_SSH_USER=*|SSHUI_PORT=*) envs+=" $(printf '%q' "$kv")" ;;
    *) echo "unknown argument: $kv" >&2; exit 1 ;;
  esac
done

STAGE="/tmp/sshui-deploy.$$"
echo "==> Uploading to $HOST:$STAGE"
tar -C "$HERE" -czf - app.py static sshui.service install.sh | \
  ssh "$HOST" "rm -rf $STAGE && mkdir -p $STAGE && tar -xzf - -C $STAGE"

SUDO=""
if [ "$(ssh "$HOST" id -u)" != 0 ]; then SUDO="sudo -n"; fi
ssh "$HOST" "cd $STAGE && $SUDO env$envs bash install.sh; rc=\$?; rm -rf $STAGE; exit \$rc"
