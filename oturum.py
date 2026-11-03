import datetime as dt
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

import core

BASE_PORT = 8670
MAX = 20
_spawned = {}
_lock = threading.Lock()


def reg_file():
    return core.HOME / "oturumlar.json"


def registry():
    r = core.read_json(reg_file(), {}) or {}
    r.setdefault("list", [])
    r.setdefault("next", max([e["id"] for e in r["list"]] + [0]) + 1)
    return r


def _home_settings():
    return core.read_json(core.HOME / "settings.json", {}) or {}


def home_port():
    return int(_home_settings().get("port") or core.DEFAULT_SETTINGS["port"])


def entries():
    r = registry()
    home = {"id": 0, "name": r.get("home_name") or "Ana stüdyo", "data": str(core.HOME), "port": home_port(), "home": True}
    return [home] + [dict(e, home=False) for e in r["list"]]


def find(oid):
    return next((e for e in entries() if e["id"] == int(oid)), None)


def current():
    return find(core.OTURUM) or {"id": core.OTURUM, "name": "", "port": core.settings()["port"]}


def listening(port, timeout=0.4):
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=timeout):
            return True
    except OSError:
        return False


def avatar(data):
    for ext in core.IMAGE_EXT:
        f = Path(data) / f"avatar{ext}"
        if f.exists():
            return f
    return None


def _accounts(data):
    s = core.read_json(Path(data) / "settings.json", {}) or {}
    ig = (s.get("instagram") or {}).get("username") or ""
    yt = ((s.get("youtube") or {}).get("channel") or {}).get("title") or ""
    tt = (((core.read_json(Path(data) / "tiktok" / "account.json", {}) or {}).get("data") or {}).get("profile") or {})
    out = {"instagram": ig, "youtube": yt if (s.get("youtube") or {}).get("refresh_token") else "", "tiktok": tt.get("username") or ""}
    return {k: v for k, v in out.items() if v}


def public(e):
    f = avatar(e["data"])
    return {"id": e["id"], "name": e["name"], "port": e["port"], "url": f"http://127.0.0.1:{e['port']}/", "home": e["home"],
            "running": e["id"] == core.OTURUM or listening(e["port"]), "created": e.get("created"),
            "accounts": _accounts(e["data"]),
            "avatar": f"/api/oturum/avatar?id={e['id']}&v={int(f.stat().st_mtime)}" if f else None}


def listing():
    return {"current": core.OTURUM, "list": [public(e) for e in entries()]}


def _name(text):
    name = " ".join(str(text or "").split())[:40]
    if not name:
        raise ValueError("Oturuma bir ad ver")
    return name


def _seed(data, oid, name, port):
    data.mkdir(parents=True, exist_ok=True)
    core.write_json(data / "oturum.json", {"id": oid, "home": str(core.HOME), "name": name, "created": core.now()})
    home = _home_settings()
    yt = home.get("youtube") or {}
    s = {"port": port, "narrator": home.get("narrator") or {}, "notifications": home.get("notifications") or {},
         "youtube": {k: yt[k] for k in ("client_id", "client_secret", "audited", "upload_ahead_hours") if k in yt},
         "tiktok": {k: v for k, v in (home.get("tiktok") or {}).items() if k != "auto"}}
    core.write_json(data / "settings.json", {k: v for k, v in s.items() if v})
    prefs = core.HOME / "ui_prefs.json"
    if prefs.exists():
        shutil.copyfile(prefs, data / "ui_prefs.json")


def create(name):
    name = _name(name)
    with core.locked(core.HOME):
        r = registry()
        if len(r["list"]) >= MAX:
            raise ValueError(f"En fazla {MAX} oturum açılabilir")
        oid = r["next"]
        used = {e["port"] for e in entries()}
        port = int(_home_settings().get("oturum_base") or BASE_PORT) + oid
        while port in used or listening(port):
            port += 1
        data = core.HOME / "oturumlar" / str(oid)
        _seed(data, oid, name, port)
        e = {"id": oid, "name": name, "data": str(data), "port": port, "created": core.now()}
        r["list"].append(e)
        r["next"] = oid + 1
        core.write_json(reg_file(), r)
    core.log_activity(f"Yeni oturum açıldı: {name}", kind="info")
    spawn(e)
    for _ in range(75):
        if listening(port):
            break
        time.sleep(0.2)
    return public(dict(e, home=False))


def rename(oid, name):
    name = _name(name)
    with core.locked(core.HOME):
        r = registry()
        if oid == 0:
            r["home_name"] = name
        else:
            e = next((x for x in r["list"] if x["id"] == oid), None)
            if not e:
                raise KeyError(oid)
            e["name"] = name
            meta = core.read_json(Path(e["data"]) / "oturum.json", {}) or {}
            core.write_json(Path(e["data"]) / "oturum.json", dict(meta, name=name))
        core.write_json(reg_file(), r)
    return public(find(oid))


def _shutdown(port):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/oturum/shutdown", data=b"{}", method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=15).read()
    except urllib.error.HTTPError as err:
        try:
            msg = json.loads(err.read().decode("utf-8") or "{}").get("error")
        except ValueError:
            msg = None
        raise ValueError(msg or "Oturum kapatılamadı")
    except OSError:
        pass
    for _ in range(50):
        if not listening(port):
            return
        time.sleep(0.2)


def remove(oid):
    oid = int(oid)
    if oid == 0:
        raise ValueError("Ana stüdyo silinemez")
    if oid == core.OTURUM:
        raise ValueError("İçinde olduğun oturum silinemez; önce başka bir oturuma geç")
    with core.locked(core.HOME):
        r = registry()
        e = next((x for x in r["list"] if x["id"] == oid), None)
        if not e:
            raise KeyError(oid)
        r["list"] = [x for x in r["list"] if x["id"] != oid]
        core.write_json(reg_file(), r)
    try:
        if listening(e["port"]):
            _shutdown(e["port"])
    except ValueError:
        with core.locked(core.HOME):
            r = registry()
            r["list"] = sorted(r["list"] + [e], key=lambda x: x["id"])
            core.write_json(reg_file(), r)
        raise
    dest = core.HOME / "oturumlar" / "_silinen" / f"{oid}_{dt.datetime.now():%Y%m%d_%H%M%S}"
    moved = False
    for _ in range(25):
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(e["data"], str(dest))
            moved = True
            break
        except OSError:
            time.sleep(0.4)
    core.log_activity(f"Oturum kaldırıldı: {e['name']}", kind="info")
    return {"ok": True, "kept": str(dest if moved else e["data"])}


def _pythonw():
    exe = Path(sys.executable)
    w = exe.with_name("pythonw.exe")
    return str(w if w.exists() else exe)


def spawn(e):
    with _lock:
        if time.time() - _spawned.get(e["id"], 0) < 30:
            return False
        _spawned[e["id"]] = time.time()
    cmd = [_pythonw(), str(core.ROOT / "server.py"), "--data", e["data"], "--port", str(e["port"])]
    env = dict(os.environ, SOSYAL_DATA=e["data"])
    io = {"stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    for flags in (0x00000008 | 0x00000200 | 0x01000000, 0x00000008 | 0x00000200):
        try:
            subprocess.Popen(cmd, cwd=str(core.ROOT), env=env, creationflags=flags, close_fds=True, **io)
            return True
        except OSError:
            continue
    return False


def watch():
    time.sleep(2)
    while True:
        try:
            for e in registry()["list"]:
                if not listening(e["port"]):
                    spawn(e)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        time.sleep(45)


def data_for(oid):
    if not oid:
        return core.HOME
    e = find(oid)
    if not e:
        raise ValueError(f"oturum yok: {oid}")
    return Path(e["data"])


def all_data():
    return [Path(e["data"]) for e in entries()]
