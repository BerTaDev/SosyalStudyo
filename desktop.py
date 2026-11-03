import os
import shutil
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ELECTRON = "44.7.0"
APP = Path(__file__).resolve().parent / "desktop"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
DETACHED = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
SIZE_MB = 380

JOB = {"state": "idle", "error": None}
_lock = threading.Lock()


def home():
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / "SosyalStudyo" / "desktop-runtime"


def exe():
    p = home() / "node_modules" / "electron" / "dist" / "electron.exe"
    return p if p.exists() else None


def app_exe():
    own = os.environ.get("SOSYAL_NODE")
    if own and Path(own).name.lower() == "sosyalstudyo.exe" and Path(own).exists():
        return Path(own)
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    p = Path(base) / "Programs" / "sosyal-studyo" / "SosyalStudyo.exe"
    return p if p.exists() else None


def status():
    with _lock:
        job = dict(JOB)
    return dict(job, installed=bool(exe() or app_exe()), size_mb=SIZE_MB, npm=bool(shutil.which("npm")))


def _run(cmd, cwd, env=None):
    r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout).strip()[-400:] or f"çıkış kodu {r.returncode}")


def _install():
    try:
        npm = shutil.which("npm.cmd") or shutil.which("npm")
        node = shutil.which("node")
        if not npm or not node:
            raise RuntimeError("Node.js bulunamadı (nodejs.org'dan kurulmalı)")
        d = home()
        d.mkdir(parents=True, exist_ok=True)
        (d / "package.json").write_text('{"name": "sosyal-studyo-runtime", "version": "1.0.0", "private": true}\n', encoding="utf-8")
        _run([npm, "install", f"electron@{ELECTRON}", "--no-audit", "--no-fund", "--ignore-scripts"], d)
        cache = d / "cache"
        env = dict(os.environ, electron_config_cache=str(cache))
        _run([node, str(d / "node_modules" / "electron" / "install.js")], d, env)
        shutil.rmtree(cache, ignore_errors=True)
        if not exe():
            raise RuntimeError("masaüstü bileşeni kurulamadı")
        with _lock:
            JOB.update(state="idle", error=None)
    except Exception as e:  # noqa: BLE001
        with _lock:
            JOB.update(state="error", error=str(e))


def install():
    with _lock:
        if JOB["state"] == "installing":
            return status()
        JOB.update(state="installing", error=None)
    threading.Thread(target=_install, daemon=True).start()
    return status()


def edge():
    for p in (shutil.which("msedge"), r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if p and Path(p).exists():
            return p
    return None


def open_app(port, page=None):
    url = f"http://127.0.0.1:{port}/"
    a = app_exe()
    if a:
        subprocess.Popen([str(a)], env=dict(os.environ, STUDIO_URL=url + (f"#{page}" if page else "")), creationflags=DETACHED,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
        return "app"
    e = exe()
    if e:
        if page:
            url += f"#{page}"
        exe_py = Path(sys.executable)
        pyw = exe_py.with_name("pythonw.exe")
        relaunch = f'"{pyw if pyw.exists() else exe_py}" "{Path(__file__).resolve().parent / "server.py"}" --open'
        subprocess.Popen([str(e), str(APP)], env=dict(os.environ, STUDIO_URL=url, STUDIO_RELAUNCH=relaunch), creationflags=DETACHED,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
        return "desktop"
    b = edge()
    if b:
        subprocess.Popen([b, f"--app={url}", "--window-size=1500,940"])
        return "edge"
    webbrowser.open(url)
    return "browser"


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "install":
        _install()
        print(status())
