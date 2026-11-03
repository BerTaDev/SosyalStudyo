import importlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.request
import zipfile
from pathlib import Path

import core

FFMPEG_URL = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip"
FFMPEG_SIZE = 200_000_000
FFMPEG_FILES = ("ffmpeg.exe", "ffprobe.exe")
ENGINE = (("numpy", "numpy"), ("scipy", "scipy"), ("soundfile", "soundfile"), ("PIL", "Pillow"))
BROWSERS = (("Microsoft Edge", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
            ("Microsoft Edge", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
            ("Google Chrome", r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            ("Google Chrome", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"))
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
UA = {"User-Agent": "SosyalStudyo"}

JOBS = {"ffmpeg": {"state": "idle", "done": 0, "total": 0, "error": None},
        "tiktok": {"state": "idle", "error": None}}
_lock = threading.Lock()
_cancel = threading.Event()


class Cancelled(Exception):
    pass


def _set(name, **kw):
    with _lock:
        JOBS[name].update(kw)


def _job(name):
    with _lock:
        return dict(JOBS[name])


def _python():
    exe = Path(sys.executable)
    alt = exe.with_name("python.exe")
    return str(alt if exe.name.lower() == "pythonw.exe" and alt.exists() else exe)


def tools_dir():
    return core.HOME / "bin"


def hint_file():
    return core.DATA / "bilesenler.json"


def engine():
    importlib.invalidate_caches()
    missing = [pkg for mod, pkg in ENGINE if importlib.util.find_spec(mod) is None]
    node = os.environ.get("SOSYAL_NODE") or shutil.which("node")
    return {"ok": not missing and bool(node), "missing": missing, "node": bool(node), "python": sys.version.split()[0],
            "bundled": core.BUNDLED}


def ffmpeg():
    core.use_tools()
    found = {f: shutil.which(f) for f in ("ffmpeg", "ffprobe")}
    local = tools_dir().resolve()
    here = all(p and Path(p).resolve().parent == local for p in found.values())
    return dict(_job("ffmpeg"), ok=all(found.values()), ffmpeg=bool(found["ffmpeg"]), ffprobe=bool(found["ffprobe"]),
                local=here, size=FFMPEG_SIZE)


def browser():
    for name, path in BROWSERS:
        if Path(path).exists():
            return {"ok": True, "name": name}
    return {"ok": False, "name": None}


def tiktok():
    import tiktok as tt
    importlib.invalidate_caches()
    pkg = importlib.util.find_spec("playwright") is not None
    return dict(_job("tiktok"), ok=pkg and tt.browser() is not None, package=pkg, browser=tt.browser() is not None)


def whisper():
    import transcribe
    return transcribe.status()


def claude():
    path = shutil.which("claude")
    home = Path.home() / ".claude"
    return {"ok": bool(path or home.exists()), "cli": bool(path), "config": home.exists()}


def state():
    ff = ffmpeg()
    seen = bool(core.read_json(hint_file(), {}).get("hint_seen"))
    return {"engine": engine(), "ffmpeg": ff, "browser": browser(), "tiktok": tiktok(), "whisper": whisper(),
            "claude": claude(), "hint": not ff["ok"] and not seen}


def _download(dest, retry=True):
    meta_file = dest.with_name(dest.name + ".json")
    part = dest.with_name(dest.name + ".part")
    meta = core.read_json(meta_file, {}) or {}
    have = part.stat().st_size if part.exists() and meta.get("total") else 0
    if have and have >= meta["total"]:
        part.replace(dest)
        meta_file.unlink(missing_ok=True)
        return
    headers = dict(UA)
    if have:
        headers["Range"] = f"bytes={have}-"
        if meta.get("validator"):
            headers["If-Range"] = meta["validator"]
    with urllib.request.urlopen(urllib.request.Request(FFMPEG_URL, headers=headers), timeout=60) as r:
        total = int(r.headers.get("Content-Length") or 0)
        if have and r.status == 206:
            span = (r.headers.get("Content-Range") or "").rsplit("/", 1)[-1]
            total = int(span) if span.isdigit() else have + total
            if total != meta.get("total"):
                r.close()
                part.unlink(missing_ok=True)
                meta_file.unlink(missing_ok=True)
                if retry:
                    return _download(dest, retry=False)
                raise RuntimeError("sunucudaki dosya değişti, tekrar dene")
        else:
            have = 0
        etag = r.headers.get("ETag") or ""
        validator = etag if etag and not etag.startswith("W/") else r.headers.get("Last-Modified") or ""
        core.write_json(meta_file, {"total": total, "validator": validator})
        got = have
        _set("ffmpeg", state="downloading", done=got, total=total or FFMPEG_SIZE)
        with open(part, "ab" if have else "wb") as out:
            while True:
                if _cancel.is_set():
                    raise Cancelled
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
                got += len(chunk)
                _set("ffmpeg", done=got)
    if total and got < total:
        raise RuntimeError("bağlantı koptu, kaldığı yerden devam etmek için tekrar dene")
    part.replace(dest)
    meta_file.unlink(missing_ok=True)


def _extract(archive, target):
    with zipfile.ZipFile(archive) as z:
        names = {Path(i.filename).name.lower(): i for i in z.infolist() if "/bin/" in i.filename or i.filename.endswith("LICENSE.txt")}
        if not all(f in names for f in FFMPEG_FILES):
            raise RuntimeError("indirilen pakette ffmpeg.exe / ffprobe.exe yok")
        for f in FFMPEG_FILES + ("license.txt",):
            info = names.get(f)
            if not info:
                continue
            dest = target / ("ffmpeg-LICENSE.txt" if f == "license.txt" else f)
            tmp = dest.with_name(dest.name + ".new")
            with z.open(info) as src, open(tmp, "wb") as out:
                shutil.copyfileobj(src, out, 1 << 20)
            os.replace(tmp, dest)


def _ffmpeg_run():
    target = tools_dir()
    archive = target / "_ffmpeg.zip"
    try:
        target.mkdir(parents=True, exist_ok=True)
        if not archive.exists():
            _download(archive)
        _set("ffmpeg", state="extracting")
        try:
            _extract(archive, target)
        except zipfile.BadZipFile:
            raise RuntimeError("indirilen dosya bozuk çıktı, tekrar indir")
        finally:
            archive.unlink(missing_ok=True)
        core.use_tools()
        _set("ffmpeg", state="idle", done=0, total=0, error=None)
        core.log_activity("ffmpeg ve ffprobe indirildi; video üretimi hazır", kind="info")
    except Cancelled:
        _set("ffmpeg", state="idle", done=0, total=0, error=None)
    except Exception as e:  # noqa: BLE001
        _set("ffmpeg", state="error", error=f"ffmpeg indirilemedi: {e}")


def ffmpeg_install():
    with _lock:
        if JOBS["ffmpeg"]["state"] in ("downloading", "extracting"):
            return state()
        JOBS["ffmpeg"].update(state="downloading", done=0, total=0, error=None)
    _cancel.clear()
    threading.Thread(target=_ffmpeg_run, daemon=True).start()
    return state()


def ffmpeg_cancel():
    _cancel.set()
    return state()


def _tiktok_run():
    try:
        r = subprocess.run([_python(), "-m", "pip", "install", "--disable-pip-version-check", "--no-warn-script-location",
                            *core.pip_target(), "playwright"], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", creationflags=NO_WINDOW)
        core.use_tools()
        import tiktok as tt
        tt.reset_available()
        if r.returncode or importlib.util.find_spec("playwright") is None:
            raise RuntimeError((r.stderr or r.stdout).strip()[-300:] or f"çıkış kodu {r.returncode}")
        _set("tiktok", state="idle", error=None)
        core.log_activity("TikTok bileşeni (Playwright) kuruldu", kind="info")
    except Exception as e:  # noqa: BLE001
        _set("tiktok", state="error", error=f"kurulamadı: {e}")


def tiktok_install():
    with _lock:
        if JOBS["tiktok"]["state"] == "installing":
            return state()
        JOBS["tiktok"].update(state="installing", error=None)
    threading.Thread(target=_tiktok_run, daemon=True).start()
    return state()


def hint_seen():
    core.write_json(hint_file(), {"hint_seen": True, "at": core.now()})
    return {"ok": True}


def handle_get(h, path):
    if path != "/api/components":
        return False
    h.send_json(state())
    return True


def handle_post(h, path):
    h.json_body()
    actions = {"/api/components/ffmpeg/install": ffmpeg_install, "/api/components/ffmpeg/cancel": ffmpeg_cancel,
               "/api/components/tiktok/install": tiktok_install, "/api/components/hint": hint_seen}
    fn = actions.get(path)
    if not fn:
        return h.fail("yok", 404)
    return h.send_json(fn())


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) > 1 and sys.argv[1] == "ffmpeg":
        _ffmpeg_run()
    print(json.dumps(state(), ensure_ascii=False, indent=1))
