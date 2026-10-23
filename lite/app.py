#!/usr/bin/env python3
"""SSHUI Lite - web editor for the OpenSSH client configuration (~/.ssh/config).

Every save is parsed with `ssh -G` against a scratch copy first, the previous
file is backed up, then the new one is written atomically. ssh reads its config
on every invocation, so a saved change applies to the next connection.

Listens on 127.0.0.1 only; authentication is done by the reverse proxy.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("SSHUI_HOST", "127.0.0.1")
PORT = int(os.environ.get("SSHUI_PORT", "8787"))
CONFIG = os.environ.get("SSHUI_CONFIG", "/root/.ssh/config")
SSH_DIR = os.path.dirname(CONFIG)
BACKUP_DIR = os.environ.get("SSHUI_BACKUPS", "/var/lib/sshui/backups")
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
SSH = shutil.which("ssh") or "/usr/bin/ssh"
MAX_BYTES = 512 * 1024
KEEP_BACKUPS = 50
BACKUP_RE = re.compile(r"^(\d{8}-\d{6}-\d{3})\.config$")

lock = threading.Lock()


class ApiError(Exception):
    def __init__(self, message, status=400, detail=""):
        super().__init__(message)
        self.status = status
        self.detail = detail


def run(cmd, timeout=15):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
    return p.returncode, p.stdout, p.stderr.strip()


def read_text(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def mtime():
    return os.stat(CONFIG).st_mtime_ns if os.path.exists(CONFIG) else None


def config_info():
    exists = os.path.exists(CONFIG)
    st = os.stat(CONFIG) if exists else None
    return {"path": CONFIG, "exists": exists, "mtime": st.st_mtime_ns if st else None,
            "size": st.st_size if st else 0, "mode": oct(st.st_mode & 0o777)[2:] if st else "600"}


def write_atomic(path, content, mode=0o600):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".sshui.", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        st = os.stat(os.path.dirname(path))  # keep a non-root user's ~/.ssh/config owned by them
        os.chown(tmp, st.st_uid, st.st_gid)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def validate(content):
    """Parse `content` with `ssh -G` from a scratch file; live config untouched.
    ssh rejects unknown keywords anywhere in the file, not only in matching blocks."""
    with tempfile.TemporaryDirectory(prefix="sshui-") as tmp:
        path = os.path.join(tmp, "config")
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        os.chmod(path, 0o600)
        code, _, err = run([SSH, "-G", "-F", path, "sshui-validate.invalid"])
        err = "\n".join(l for l in err.splitlines() if not l.startswith("Pseudo-terminal"))
        return code == 0, err.replace(path, CONFIG)


def list_keys():
    """Private keys in ~/.ssh, detected by their PEM header (a .pub isn't required)."""
    keys = []
    if os.path.isdir(SSH_DIR):
        for n in sorted(os.listdir(SSH_DIR)):
            p = os.path.join(SSH_DIR, n)
            if n.endswith(".pub") or not os.path.isfile(p) or os.path.getsize(p) > 64 * 1024:
                continue
            try:
                with open(p, "rb") as f:
                    head = f.read(64)
            except OSError:
                continue
            if head.startswith(b"-----BEGIN") and b"PRIVATE KEY" in head:
                keys.append("~/.ssh/" + n)
    return keys


# ---------- backups ----------

def make_backup():
    if not os.path.exists(CONFIG):
        return None
    os.makedirs(BACKUP_DIR, mode=0o700, exist_ok=True)
    now = time.time()
    bid = time.strftime("%Y%m%d-%H%M%S", time.localtime(now)) + "-%03d.config" % (int(now * 1000) % 1000)
    shutil.copy2(CONFIG, os.path.join(BACKUP_DIR, bid))
    for old in sorted((b for b in os.listdir(BACKUP_DIR) if BACKUP_RE.match(b)), reverse=True)[KEEP_BACKUPS:]:
        os.unlink(os.path.join(BACKUP_DIR, old))
    return bid


def list_backups():
    if not os.path.isdir(BACKUP_DIR):
        return []
    out = []
    for b in sorted(os.listdir(BACKUP_DIR), reverse=True):
        m = BACKUP_RE.match(b)
        if m:
            out.append({"id": b, "time": m.group(1), "size": os.stat(os.path.join(BACKUP_DIR, b)).st_size})
    return out


def backup_path(bid):
    p = os.path.join(BACKUP_DIR, bid or "")
    if not BACKUP_RE.match(bid or "") or not os.path.isfile(p):
        raise ApiError("Backup not found", 404)
    return p


def save(content, expected_mtime, check_mtime=True):
    with lock:
        if check_mtime and mtime() != expected_mtime:
            raise ApiError("The config was changed on the server since you opened it. Reload it first.", 409)
        ok, out = validate(content)
        if not ok:
            raise ApiError("ssh rejected the configuration; nothing was changed.", 422, out)
        mode = os.stat(CONFIG).st_mode & 0o777 if os.path.exists(CONFIG) else 0o600
        bid = make_backup()
        write_atomic(CONFIG, content, mode & 0o644)  # ssh refuses group/world-writable configs
        return {"ok": True, "backup": bid, "output": out, **config_info()}


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "sshui-lite"
    sys_version = ""

    def log_message(self, fmt, *args):
        pass

    def send(self, status, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        # A JSON content type plus a custom header can't be sent cross-site
        # without a CORS preflight, which blocks CSRF via the proxy's auth.
        if self.headers.get("X-SSHUI") != "1" or "application/json" not in self.headers.get("Content-Type", ""):
            raise ApiError("Bad request", 400)
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BYTES:
            raise ApiError("Request too large", 413)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            raise ApiError("Invalid JSON", 400)

    def handle_api(self, method):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        r = url.path
        if method == "GET":
            if r == "/api/config":
                return {"content": read_text(CONFIG) if os.path.exists(CONFIG) else "", **config_info()}
            if r == "/api/status":
                _, _, ver = run([SSH, "-V"])
                return {"version": ver, "keys": list_keys(), **config_info()}
            if r == "/api/backups":
                return list_backups()
            if r == "/api/backup":
                return {"content": read_text(backup_path(q.get("id")))}
            raise ApiError("Not found", 404)

        b = self.body()
        if r == "/api/validate":
            ok, out = validate(str(b.get("content", "")))
            return {"ok": ok, "output": out}
        if r == "/api/save":
            content = b.get("content")
            if not isinstance(content, str):
                raise ApiError("Missing content")
            return save(content, b.get("mtime"))
        if r == "/api/backups/restore":
            return save(read_text(backup_path(b.get("id"))), None, check_mtime=False)
        if r == "/api/backups/delete":
            os.unlink(backup_path(b.get("id")))
            return {"ok": True}
        raise ApiError("Not found", 404)

    def dispatch(self, method):
        if self.path.startswith("/api/"):
            try:
                self.send(200, self.handle_api(method))
            except ApiError as e:
                self.send(e.status, {"error": str(e), "detail": e.detail})
            except Exception as e:  # noqa: BLE001
                self.send(500, {"error": "Internal error", "detail": str(e)})
            return
        if method != "GET":
            return self.send(405, {"error": "Method not allowed"})
        name = {"/": "index.html", "/index.html": "index.html", "/favicon.svg": "favicon.svg"}.get(urlparse(self.path).path)
        if not name:
            return self.send(404, b"Not found", "text/plain")
        with open(os.path.join(STATIC, name), "rb") as f:
            ctype = "image/svg+xml" if name.endswith(".svg") else "text/html; charset=utf-8"
            self.send(200, f.read(), ctype)

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")


if __name__ == "__main__":
    os.makedirs(BACKUP_DIR, mode=0o700, exist_ok=True)
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True
    print(f"sshui-lite editing {CONFIG} on http://{HOST}:{PORT}", flush=True)
    srv.serve_forever()
