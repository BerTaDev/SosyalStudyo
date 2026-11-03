import contextlib
import datetime as dt
import json
import msvcrt
import os
import shutil
import sys
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT / "engine"


def _data_dir():
    if os.environ.get("SOSYAL_DATA"):
        return Path(os.environ["SOSYAL_DATA"])
    try:
        return Path(json.loads((ROOT / "local.json").read_text(encoding="utf-8-sig"))["data_dir"])
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        return Path.home() / "SosyalStudyo"


def _oturum(data):
    try:
        meta = json.loads((Path(data) / "oturum.json").read_text(encoding="utf-8-sig"))
        return Path(meta["home"]), int(meta["id"])
    except (FileNotFoundError, KeyError, TypeError, ValueError):
        return Path(data), 0


DATA = _data_dir()
HOME, OTURUM = _oturum(DATA)
PROJECTS = DATA / "projeler"
POSTS = DATA / "posts"
AGENTS = HOME / "agents"
UPLOADS = DATA / "uploads"
SHARED_SETTINGS = ("elevenlabs", "voice_favorites", "agent_account", "agent_accounts", "accounts", "claude", "site", "audit_kit")
IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
AUDIO_EXT = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac")
VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm")
WORK_STALE = 45 * 60
BUNDLED = any(Path(sys.base_prefix).glob("python*._pth"))
FFMPEG_MISSING = "ffmpeg bulunamadı: Ayarlar > Bileşenler bölümünden indirip tekrar dene"


def pylib():
    return HOME / "_py" / "site-packages"


def cli():
    if not BUNDLED:
        return "python -X utf8 studio.py"
    exe = Path(sys.executable)
    exe = exe.with_name("python.exe") if exe.name.lower() == "pythonw.exe" else exe
    return f'"{exe.as_posix()}" -X utf8 studio.py'


def pip_target():
    return ["--target", str(pylib()), "--upgrade"] if BUNDLED else []


def use_tools():
    tools = HOME / "bin"
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")) and any((tools / f).exists() for f in ("ffmpeg.exe", "ffprobe.exe")):
        cur = os.environ.get("PATH", "")
        if str(tools).lower() not in [p.lower().rstrip("\\/") for p in cur.split(os.pathsep)]:
            os.environ["PATH"] = str(tools) + os.pathsep + cur
    if BUNDLED:
        lib = str(pylib())
        if lib not in sys.path:
            sys.path.append(lib)
        sys.path_importer_cache.pop(lib, None)


use_tools()


def node_exe():
    return os.environ.get("SOSYAL_NODE") or "node"


def node_env(env=None):
    out = dict(os.environ if env is None else env)
    if os.environ.get("SOSYAL_NODE"):
        out["ELECTRON_RUN_AS_NODE"] = "1"
    return out


def has_tool(name):
    return shutil.which(name) is not None


def need_ffmpeg():
    if not has_tool("ffmpeg"):
        raise ValueError(FFMPEG_MISSING)


def probe_fallback(path):
    import re
    import subprocess
    need_ffmpeg()
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path)], capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=60)
    m = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr or "")
    b = re.search(r"bitrate: (\d+) kb/s", r.stderr or "")
    dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else None
    return dur, int(b.group(1)) * 1000 if b else 0


def set_data(path):
    global DATA, HOME, OTURUM, PROJECTS, POSTS, AGENTS, UPLOADS
    DATA = Path(path)
    HOME, OTURUM = _oturum(DATA)
    PROJECTS, POSTS, AGENTS, UPLOADS = DATA / "projeler", DATA / "posts", HOME / "agents", DATA / "uploads"
    os.environ["SOSYAL_DATA"] = str(DATA)
    use_tools()
    _dt_cache[0] = 0.0
    _cache.clear()
    for name, attr in (("youtube", "_store"), ("youtube", "_view_cache"), ("igaccount", "_cache"), ("ytaccount", "_cache"),
                       ("tiktok", "_cache")):
        mod = sys.modules.get(name)
        if mod is None or not hasattr(mod, attr):
            continue
        val = getattr(mod, attr)
        if attr == "_store":
            setattr(mod, attr, None)
        elif attr == "_view_cache":
            val[:] = [0.0, None]
        elif name == "tiktok":
            val.update(avail=(0.0, False), state=(None, {}))
        else:
            val.clear()


def id_base():
    return OTURUM * 1000


def next_id(ids):
    return max(list(ids) + [id_base()]) + 1

DEFAULT_SETTINGS = {
    "port": 8655,
    "channel": "",
    "display_name": "",
    "default_hashtags": "",
    "narrator": {"voice_id": "", "name": "", "model": "eleven_v3", "language": "tr", "stability": 0.5, "similarity": 0.75},
    "elevenlabs": {"key": "", "accounts": [], "strategy": "most"},
    "instagram": {"user_id": "", "username": "", "token": "", "token_refreshed": "", "api_version": ""},
}

STATUS = {
    "sirada": "Sırada",
    "uretimde": "Üretimde",
    "inceleme": "İncelemede",
    "planlandi": "Planlandı",
    "paylasiliyor": "Paylaşılıyor",
    "paylasildi": "Paylaşıldı",
    "hata": "Hata",
}


def now():
    return dt.datetime.now().replace(microsecond=0).isoformat()


def parse_time(text):
    return dt.datetime.fromisoformat(text) if text else None


def read_json(path, default=None):
    for attempt in range(20):
        try:
            return json.loads(Path(path).read_text(encoding="utf-8-sig"))
        except (FileNotFoundError, json.JSONDecodeError):
            return default
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for attempt in range(20):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05)
    os.replace(tmp, path)


@contextlib.contextmanager
def locked(root=None):
    root = Path(root or DATA)
    root.mkdir(parents=True, exist_ok=True)
    fh = open(root / "studio.lock", "a+b")
    try:
        while True:
            try:
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                time.sleep(0.03)
        yield
    finally:
        try:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        except OSError:
            pass
        fh.close()


def ensure_data():
    for d in (DATA, PROJECTS, POSTS, AGENTS, UPLOADS, HOME / "muzik", HOME / "sfx", HOME / "bin"):
        d.mkdir(parents=True, exist_ok=True)
    link = PROJECTS / "_engine"
    if not link.exists():
        import subprocess
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(ENGINE)], capture_output=True, check=True)


# ---------- activity ----------

def log_activity(text, post=None, agent=None, kind="info"):
    DATA.mkdir(parents=True, exist_ok=True)
    line = json.dumps({"at": now(), "post": post, "agent": agent, "kind": kind, "text": text}, ensure_ascii=False)
    with open(DATA / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(line + "\n")


def read_activity(limit=200, post=None):
    path = DATA / "activity.jsonl"
    if not path.exists():
        return []
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 400_000))
        lines = f.read().decode("utf-8", "replace").splitlines()
    out = []
    for raw in reversed(lines):
        try:
            item = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if post and item.get("post") != post:
            continue
        out.append(item)
        if len(out) >= limit:
            break
    return out


def avatar_file():
    for ext in IMAGE_EXT:
        f = DATA / f"avatar{ext}"
        if f.exists():
            return f
    return None


# ---------- settings ----------

def settings():
    data = read_json(DATA / "settings.json", {})
    if OTURUM:
        home = read_json(HOME / "settings.json", {})
        data = {k: v for k, v in data.items() if k not in SHARED_SETTINGS}
        data.update({k: home[k] for k in SHARED_SETTINGS if k in home})
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    for k, v in data.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def _merge(cur, patch):
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(cur.get(k), dict):
            cur[k].update(v)
        else:
            cur[k] = v
    return cur


def save_settings(patch):
    shared = {k: v for k, v in patch.items() if OTURUM and k in SHARED_SETTINGS}
    if shared:
        with locked(HOME):
            write_json(HOME / "settings.json", _merge(read_json(HOME / "settings.json", {}), shared))
    with locked():
        cur = _merge(settings(), {k: v for k, v in patch.items() if k not in shared})
        write_json(DATA / "settings.json", {k: v for k, v in cur.items() if not (OTURUM and k in SHARED_SETTINGS)})
    _dt_cache[0] = 0.0
    return settings() if shared else cur


def public_settings():
    s = settings()
    ig = dict(s["instagram"])
    ig["has_token"] = bool(ig.pop("token", ""))
    s["instagram"] = ig
    import eleven
    accs = [{"id": a["id"], "name": a.get("name") or a["id"], "enabled": a.get("enabled", True), "added": a.get("added"),
             "hint": "…" + a["key"][-4:], "virtual": a["id"] in ("main", "env") and not s["elevenlabs"].get("accounts")}
            for a in eleven.accounts(include_disabled=True)]
    s["elevenlabs"] = {"has_key": any(a["enabled"] for a in accs), "strategy": s["elevenlabs"].get("strategy") or "most", "accounts": accs}
    if isinstance(s.get("cloud"), dict):
        cl = {k: v for k, v in s["cloud"].items() if k not in ("api_token", "key", "ig_sig")}
        cl["has_token"] = bool(s["cloud"].get("api_token"))
        pn = cl.get("panel")
        cl["panel"] = {k: pn.get(k) for k in ("enabled", "created", "pw_set_at")} if isinstance(pn, dict) else None
        s["cloud"] = cl
    import youtube
    s["youtube"] = youtube.public_settings(s.get("youtube"))
    av = avatar_file()
    s["avatar"] = f"/avatar?v={int(av.stat().st_mtime)}" if av else None
    s["default_targets"] = default_targets(fresh=True)
    return s


# ---------- publish targets ----------

PLATFORMS = ("instagram", "youtube")
PLATFORM_NAMES = {"instagram": "Instagram", "youtube": "YouTube"}
SENT_STATUSES = ("planlandi", "paylasiliyor", "paylasildi")
_dt_cache = [0.0, None]


def default_targets(fresh=False):
    if fresh or time.time() - _dt_cache[0] > 1.5 or _dt_cache[1] is None:
        s = settings()
        raw = s.get("default_targets") if isinstance(s.get("default_targets"), dict) else {}
        import youtube
        yc = youtube.conf()
        yt = bool(yc.get("auto"))
        ig = raw.get("instagram") is not False or not (yt and youtube.connected(yc))
        _dt_cache[:] = [time.time(), {"instagram": ig, "youtube": yt}]
    return dict(_dt_cache[1])


def ig_on(p):
    t = p.get("targets") if isinstance(p.get("targets"), dict) else {}
    if t.get("instagram") is None:
        return True if p.get("status") in SENT_STATUSES else default_targets()["instagram"]
    return bool(t["instagram"])


def targets(p, yc=None):
    import youtube
    return {"instagram": ig_on(p), "youtube": youtube.target(p, yc)}


def targets_text(t):
    names = [PLATFORM_NAMES[k] for k in PLATFORMS if t.get(k)]
    return " + ".join(names) if names else "hiçbir yer"


def youtube_block(kind, yc=None):
    import youtube
    yc = yc or youtube.conf()
    if (kind or "reels") != "reels":
        return "YouTube'a yalnızca Reels videoları gönderilir"
    if not youtube.connected(yc):
        return "YouTube bağlı değil (Ayarlar > YouTube)"
    return None


def norm_targets(raw, kind="reels", base=None):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("geçersiz paylaşım yerleri")
    base = base or default_targets()
    block = youtube_block(kind)
    ig = base.get("instagram", True) if raw.get("instagram") is None else bool(raw["instagram"])
    yt = raw.get("youtube")
    if yt is None:
        yt = None if block else base.get("youtube")
    yt = None if yt is None else bool(yt)
    if yt and (kind or "reels") != "reels":
        raise ValueError(block)
    if not ig and not (yt and not block):
        raise ValueError("En az bir paylaşım yeri seçili olmalı" + (f"; {block}" if block and raw.get("youtube") is not False else ""))
    return {"instagram": ig, "youtube": yt}


def merge_targets(p, raw):
    raw = raw if isinstance(raw, dict) else {}
    cur = targets(p)
    out = dict(cur)
    if raw.get("instagram") is not None:
        out["instagram"] = bool(raw["instagram"])
    if raw.get("youtube") is not None:
        want = bool(raw["youtube"])
        if cur["youtube"] is None:
            if want:
                raise ValueError(youtube_block(p.get("kind")) or "YouTube kullanılamıyor")
        else:
            out["youtube"] = want
    if not out["instagram"] and not out["youtube"]:
        block = youtube_block(p.get("kind"))
        raise ValueError("En az bir paylaşım yeri seçili olmalı" + (f"; {block}" if block else ""))
    return out


def write_targets(q, t):
    if t.get("instagram") is not None:
        q["targets"] = {**(q.get("targets") if isinstance(q.get("targets"), dict) else {}), "instagram": bool(t["instagram"])}
    if t.get("youtube") is not None or (t.get("instagram") is False and (q.get("kind") or "reels") == "reels"):
        y = dict(q.get("youtube") or {})
        y["enabled"] = True if t.get("instagram") is False else bool(t["youtube"])
        q["youtube"] = y


def targets_patch(t):
    out = {}
    if t and t.get("instagram") is not None:
        out["targets"] = {"instagram": bool(t["instagram"])}
    if t and (t.get("youtube") is not None or t.get("instagram") is False):
        out["youtube"] = {"enabled": True if t.get("instagram") is False else bool(t["youtube"])}
    return out


def save_default_targets(raw):
    if not isinstance(raw, dict):
        raise ValueError("geçersiz paylaşım yerleri")
    import youtube
    yc = youtube.conf()
    cur = default_targets(fresh=True)
    ig = cur["instagram"] if raw.get("instagram") is None else bool(raw["instagram"])
    yt = cur["youtube"] if raw.get("youtube") is None else bool(raw["youtube"])
    if not ig and not (yt and youtube.connected(yc)):
        raise ValueError("Varsayılan olarak en az bir paylaşım yeri açık olmalı" + ("" if youtube.connected(yc) else "; YouTube bağlı değil"))
    save_settings({"default_targets": {"instagram": ig}})
    if yt != bool(yc.get("auto")):
        youtube.update_settings({"auto": yt})
    return default_targets(fresh=True)


def planned_stage(t):
    return "Paylaşım planlandı" if t.get("instagram") else "YouTube'da yayınlanacak"


def change_targets(pid, raw):
    p = load_post(pid)
    if p is None or p.get("deleted"):
        raise KeyError(pid)
    if p.get("status") in ("paylasiliyor", "paylasildi"):
        raise ValueError("paylaşılmış içeriğin paylaşım yerleri değiştirilemez")
    new = merge_targets(p, raw)
    old = targets(p)

    def fn(q):
        write_targets(q, new)
        if q.get("status") == "planlandi" and q.get("stage") in ("Paylaşım planlandı", "YouTube'da yayınlanacak"):
            q["stage"] = planned_stage(new)
    p = update_post(pid, fn)
    if new != old:
        log_activity(f"Paylaşım yerleri: {targets_text(new)}", post=pid, kind="schedule")
        import cloud
        import youtube
        if p.get("status") == "planlandi":
            if new["instagram"]:
                cloud.post_scheduled(pid)
            else:
                cloud.post_released(pid)
        youtube.post_changed(pid)
    return p


# ---------- posts ----------

def post_dir(pid):
    return POSTS / pid


def load_post(pid):
    return read_json(post_dir(pid) / "post.json")


def save_post(post):
    post["updated"] = now()
    write_json(post_dir(post["id"]) / "post.json", post)


def update_post(pid, fn):
    with locked():
        post = load_post(pid)
        if post is None:
            raise KeyError(pid)
        fn(post)
        save_post(post)
        return post


def list_posts():
    out = []
    if POSTS.exists():
        for d in POSTS.iterdir():
            p = read_json(d / "post.json")
            if p and not p.get("deleted"):
                out.append(p)
    out.sort(key=lambda p: p["created"], reverse=True)
    return out


BRIEF_KEYS = ("format", "tone", "style", "colors", "audience", "key_points", "voiceover", "subtitles", "music", "cta", "links",
              "template")


def clean_brief(brief):
    brief = brief or {}
    out = {k: brief.get(k) for k in BRIEF_KEYS if brief.get(k) not in (None, "", [])}
    out.setdefault("format", "9:16")
    out.setdefault("voiceover", True)
    out.setdefault("subtitles", True)
    return out


def media_duration(path):
    import subprocess
    if not shutil.which("ffprobe"):
        d = probe_fallback(path)[0]
        return round(d, 2) if d else None
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                           capture_output=True, text=True, timeout=60)
        return round(float(r.stdout.strip()), 2)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def take_source(pid, source):
    import shutil
    src = UPLOADS / Path(source.get("id", "")).name
    ext = src.suffix.lower()
    if not src.exists() or ext not in AUDIO_EXT + VIDEO_EXT:
        raise ValueError("hazır ses/video dosyası bulunamadı, yeniden yükle")
    dur = media_duration(src)
    if not dur:
        raise ValueError("dosya okunamadı (bozuk ya da desteklenmeyen biçim)")
    if dur > 600:
        raise ValueError("hazır ses/video en fazla 10 dakika olabilir")
    dest = post_dir(pid) / "kaynak" / f"kaynak{ext}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(src), dest)
    kind = "video" if ext in VIDEO_EXT else "audio"
    return {"file": dest.name, "name": source.get("name") or src.name, "kind": kind,
            "visual": kind == "video" and source.get("visual", True) is not False, "duration": dur}


def new_post(title, concept, duration=30, brief=None, refs=None, extra=None, source=None, research=None):
    import math
    import re
    import shutil
    with locked():
        ids = [int(d.name) for d in POSTS.glob("*") if d.name.isdigit()] if POSTS.exists() else []
        pid = f"{next_id(ids):03d}"
        post_dir(pid).mkdir(parents=True, exist_ok=True)
        try:
            src = take_source(pid, source) if source else None
        except ValueError:
            _remove_tree(post_dir(pid))
            raise
        if src:
            duration = max(5, math.ceil(src["duration"] + 1.5))
            title = title.strip() or (concept.strip().split("\n")[0][:60] if concept.strip() else Path(src["name"]).stem[:60])
        stored = []
        for i, ref in enumerate(refs or [], 1):
            up = UPLOADS / Path(ref.get("id", "")).name
            if not up.exists() or up.suffix.lower() not in IMAGE_EXT:
                continue
            stem = re.sub(r"[^A-Za-z0-9]+", "_", Path(ref.get("name") or up.name).stem)[:40].strip("_") or "ref"
            dest = post_dir(pid) / "refs" / f"{i:02d}_{stem}{up.suffix.lower()}"
            dest.parent.mkdir(exist_ok=True)
            shutil.move(str(up), dest)
            stored.append({"file": dest.name, "name": ref.get("name") or up.name, "note": (ref.get("note") or "").strip(),
                           "use": bool(ref.get("use"))})
        post = {
            "id": pid, "title": title.strip() or concept.strip().split("\n")[0][:60], "concept": concept.strip(),
            "duration": duration, "brief": clean_brief(brief), "refs": stored, "status": "sirada", "stage": "Ajan bekleniyor",
            "progress": 0, "agent": None, "project": None, "video": None, "video_duration": None,
            "caption": "", "hashtags": settings()["default_hashtags"], "caption_request": None,
            "thumb_offset": 0, "schedule": None, "published": None, "error": None,
            "messages": [], "created": now(), "updated": now(),
        }
        if src:
            post["source"] = src
            post["brief"]["voiceover"] = True
        if research:
            from research import attach
            post["research"] = attach(pid, research)
        post.update(extra or {})
        save_post(post)
    log_activity(f"Yeni içerik sıraya girdi: {post['title']}", post=pid, kind="queue")
    return post


def add_message(pid, author, text, agent=None):
    def fn(p):
        p["messages"].append({"author": author, "text": text.strip(), "at": now(), "agent": agent})
    return update_post(pid, fn)


def ready(post):
    return bool(post.get("video") or post.get("media"))


def project_dir(post):
    return PROJECTS / post["project"] if post.get("project") else None


# ---------- trash ----------

def _is_reparse(path):
    import stat
    try:
        st = os.stat(path, follow_symlinks=False)
    except OSError:
        return False
    return bool(getattr(st, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)) or os.path.islink(path)


def _tree_size(path):
    total = 0
    for base, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if not _is_reparse(os.path.join(base, d))]
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


def _remove_tree(path):
    import shutil
    import stat
    if _is_reparse(path):
        os.rmdir(path)
        return
    for base, dirs, _ in os.walk(path):
        for d in list(dirs):
            full = os.path.join(base, d)
            if _is_reparse(full):
                os.rmdir(full)
                dirs.remove(d)

    def onerror(fn, p, exc):
        os.chmod(p, stat.S_IWRITE)
        fn(p)
    shutil.rmtree(path, onerror=onerror)


def _post_dirs(post):
    out = [post_dir(post["id"])]
    pd = project_dir(post)
    if pd and pd.parent == PROJECTS and pd.name != "_engine" and not pd.name.startswith("_"):
        out.append(pd)
    return [d for d in out if d.exists()]


def list_trash():
    out = []
    if POSTS.exists():
        for d in POSTS.iterdir():
            p = read_json(d / "post.json")
            if p and p.get("deleted"):
                out.append(p)
    out.sort(key=lambda p: p.get("deleted_at") or p["updated"], reverse=True)
    return out


def trash_post(pid):
    def fn(q):
        if not q.get("deleted"):
            q.update(prev_status=q.get("status"), deleted_at=now())
        q.update(deleted=True, schedule=None, after_render=None)
    p = update_post(pid, fn)
    log_activity("Çöp kutusuna taşındı", post=pid, kind="info")
    return p


def restore_post(pid):
    def fn(q):
        prev = q.get("prev_status") or q.get("status")
        if prev == "paylasildi" and q.get("published"):
            st = "paylasildi"
        else:
            st = "inceleme" if ready(q) else "sirada"
        q.update(deleted=False, deleted_at=None, prev_status=None, status=st, error=None,
                 stage="Çöp kutusundan geri alındı")
        if st == "sirada":
            q.update(agent=None, progress=0)
    p = update_post(pid, fn)
    log_activity("Çöp kutusundan geri alındı", post=pid, kind="info")
    return p


def purge_post(pid):
    with locked():
        p = load_post(pid)
        if not p or not p.get("deleted"):
            raise ValueError("içerik çöp kutusunda değil")
        dirs = _post_dirs(p)
        freed = sum(_tree_size(d) for d in dirs)
        idea = (p.get("script") or {}).get("idea")
        for d in dirs:
            _remove_tree(d)
    if idea and "-" in idea:
        try:
            import ideas

            def fn(b):
                for i in b["ideas"]:
                    if i["id"] == idea and i.get("post") == pid:
                        i["status"] = "yeni"
                        i["post"] = None
            ideas.update(idea.rsplit("-", 1)[0], fn)
        except Exception:  # noqa: BLE001
            pass
    log_activity(f"Kalıcı olarak silindi: {p.get('title', pid)}", post=None, kind="info")
    return freed


def trash_summary(p):
    out = summary(p)
    out["deleted_at"] = p.get("deleted_at")
    out["prev_status"] = p.get("prev_status")
    out["size"] = sum(_tree_size(d) for d in _post_dirs(p))
    return out


def summary(p):
    keys = ("id", "title", "status", "stage", "progress", "agent", "video", "schedule", "published", "error",
            "created", "updated", "thumb_offset", "kind", "media", "manual", "after_render", "autopilot")
    out = {k: p.get(k) for k in keys}
    if p.get("cloud"):
        import cloud
        out["cloud"] = cloud.view(p)
    else:
        out["cloud"] = None
    import youtube
    out["youtube"] = youtube.view(p)
    import tiktok
    out["tiktok"] = tiktok.post_info(p)
    out["targets"] = targets(p)
    out["has_thumb"] = (post_dir(p["id"]) / "thumb.jpg").exists()
    out["subs"] = bool(p.get("video") and p.get("project") and (PROJECTS / p["project"] / "altyazi.json").exists())
    out["caption_pending"] = bool(p.get("caption_request"))
    out["no_caption"] = not (p.get("caption") or "").strip() and (p.get("kind") or "reels") != "story"
    out["duration"] = p.get("video_duration") or p.get("duration")
    return out


# ---------- agents ----------

def account_names():
    import accounts
    return accounts.names()


def active_accounts():
    names = account_names()
    s = settings()
    lst = s.get("agent_accounts")
    if not isinstance(lst, list):
        lst = [s.get("agent_account") or "main"]
    lst = [a for a in names if a in lst]
    return lst or ["main"]


def set_active_accounts(lst):
    names = account_names()
    lst = [a for a in names if a in lst] or ["main"]
    save_settings({"agent_accounts": lst, "agent_account": lst[0]})
    return lst


def active_account():
    return active_accounts()[0]


def heartbeat(name, state=None, post=None, text=None, watching=None, only=None, account=None):
    path = AGENTS / f"{name}.json"
    with locked():
        cur = read_json(path, {"name": name})
        cur["seen"] = now()
        if state:
            cur["state"] = state
            cur["since"] = now()
        if post is not None:
            cur["post"] = post or None
        if text is not None:
            cur["text"] = text
        if watching is not None:
            cur["watching"] = watching
        if only is not None:
            cur["only"] = only
        if account is not None:
            cur["account"] = account
        write_json(path, cur)


def list_agents():
    out = []
    if AGENTS.exists():
        t = dt.datetime.now()
        for f in sorted(AGENTS.glob("*.json")):
            a = read_json(f)
            if not a:
                continue
            age = (t - parse_time(a["seen"])).total_seconds()
            if a.get("state") == "working" and age < WORK_STALE:
                a["live"] = "working"
            elif a.get("watching") and age < 30:
                a["live"] = "watching"
            else:
                a["live"] = "off"
                if a.get("state") == "working" and age < 12 * 3600:
                    a["stale"] = True
            out.append(a)
    return out


def queue():
    """Pending work in the order agents will take it."""
    t = dt.datetime.now()
    posts = list_posts()
    out = []
    for p in sorted(posts, key=lambda p: p["updated"]):
        req = p.get("caption_request")
        if req and (not req.get("claimed") or (t - parse_time(req["claimed"])).total_seconds() > 900):
            out.append({"kind": "caption", "post": p["id"], "title": p["title"], "since": req["at"]})
    for p in sorted(posts, key=lambda p: p["updated"]):
        if p["status"] == "sirada":
            continue
        seen = p.get("seen_note") or ""
        notes = [m for m in p["messages"] if m["author"] == "user" and m["at"] > seen]
        if notes:
            out.append({"kind": "note", "post": p["id"], "title": p["title"], "since": notes[0]["at"], "agent": p.get("agent")})
    import ideas
    for b in sorted(ideas.list_batches(), key=lambda b: b["updated"]):
        if b["status"] == "sirada":
            out.append({"kind": "ideas", "post": b["id"], "title": b["topic"], "since": b["updated"]})
    import tplreq
    for r in sorted(tplreq.list_requests(), key=lambda r: r["updated"]):
        if r["status"] == "sirada":
            out.append({"kind": "template", "post": r["id"], "title": r["name"], "since": r["updated"]})
    for p in sorted(posts, key=lambda p: p["created"]):
        if p["status"] == "sirada":
            out.append({"kind": "new", "post": p["id"], "title": p["title"], "since": p["created"]})
    return out


def agent_alive(name):
    acc = active_accounts()
    return any(a["name"] == name and a["live"] != "off" and (a.get("account") or "main") in acc for a in list_agents())


def specialists(exclude=None):
    out = {}
    acc = active_accounts()
    for a in list_agents():
        if a["live"] != "off" and a["name"] != exclude and (a.get("account") or "main") in acc:
            for k in a.get("only") or []:
                out.setdefault(k, []).append(a["name"])
    return out


def dispatch_next(agent, quiet=10, only=None, account="main"):
    """Claims one job for this agent: caption request > revision note > new post."""
    if account not in active_accounts():
        return None
    t = dt.datetime.now()
    with locked():
        job = _claim(list_posts(), agent, quiet, t, only)
    if job:
        text = {"new": "üretmeye başladı", "note": "revizyon notunu aldı", "caption": "açıklama yazmaya başladı",
                "ideas": "metin kurgusu yazmaya başladı", "template": "şablon tasarlamaya başladı",
                "research": "tarayıcıda araştırmaya başladı"}[job["kind"]]
        log_activity(f"{agent} {text}", post=job["post"]["id"], agent=agent, kind="claim")
    return job


def _claim(posts, agent, quiet, t, only=None):
    spec = specialists(exclude=agent)

    def can(kind):
        return kind in only if only else kind not in spec

    for p in sorted(posts, key=lambda p: p["updated"]) if can("caption") else []:
        req = p.get("caption_request")
        if req and (not req.get("claimed") or (t - parse_time(req["claimed"])).total_seconds() > 900):
            req["claimed"] = now()
            req["agent"] = agent
            save_post(p)
            return {"kind": "caption", "post": p}
    for p in sorted(posts, key=lambda p: p["updated"]) if can("note") else []:
        if p["status"] == "sirada":
            continue
        owner = p.get("agent")
        if owner and owner != agent and agent_alive(owner):
            continue
        seen = p.get("seen_note") or ""
        notes = [m for m in p["messages"] if m["author"] == "user" and m["at"] > seen]
        if notes and (t - parse_time(notes[-1]["at"])).total_seconds() >= quiet:
            p["seen_note"] = notes[-1]["at"]
            p["agent"] = agent
            save_post(p)
            return {"kind": "note", "post": p, "notes": notes}
    import webagent
    for g in sorted(webagent.list_jobs(), key=lambda g: (g["created"], g["id"])) if can("research") else []:
        if g["status"] == "sirada":
            webagent.claim(g, agent)
            return {"kind": "research", "job": g, "post": {"id": g["id"], "title": webagent.title(g)}}
    import ideas
    for b in sorted(ideas.list_batches(), key=lambda b: b["updated"]) if can("ideas") else []:
        if b["status"] == "sirada":
            b["status"] = "yaziliyor"
            b["agent"] = agent
            b["stage"] = "Metin kurguları yazılıyor"
            ideas.save(b)
            return {"kind": "ideas", "batch": b, "post": {"id": b["id"], "title": b["topic"]}}
    import tplreq
    for r in sorted(tplreq.list_requests(), key=lambda r: r["updated"]) if can("template") else []:
        if r["status"] == "sirada":
            r.update(status="yapiliyor", agent=agent, stage="Şablon tasarlanıyor", progress=0.05)
            r["seen_note"] = r["messages"][-1]["at"] if r["messages"] else ""
            tplreq.save(r)
            return {"kind": "template", "request": r, "post": {"id": r["id"], "title": r["name"]}}
    for p in sorted(posts, key=lambda p: p["created"]) if can("new") else []:
        if p["status"] == "sirada":
            p["status"] = "uretimde"
            p["agent"] = agent
            p["stage"] = "Kurgu hazırlanıyor"
            p["progress"] = 0.05
            p["seen_note"] = p["messages"][-1]["at"] if p["messages"] else ""
            save_post(p)
            return {"kind": "new", "post": p}
    return None


# ---------- ElevenLabs ----------

_cache = {}


def cached(key, ttl, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    try:
        val = fn()
    except Exception as e:  # noqa: BLE001
        val = {"error": str(e)}
    _cache[key] = (time.time(), val)
    return val


def eleven_credits(fresh=False):
    import eleven
    if fresh:
        _cache.pop("credits", None)

    def get():
        rows = eleven.all_credits()
        if not rows:
            raise eleven.ElevenError("ElevenLabs anahtarı girilmemiş (Ayarlar > Seslendirme)")
        ok = [r for r in rows if r.get("enabled") and r.get("left") is not None]
        if not ok:
            bad = [r for r in rows if r.get("error")]
            return {"error": bad[0]["error"] if bad else "Açık ElevenLabs hesabı yok", "accounts": rows}
        paid = [r for r in ok if (r.get("plan") or "free") != "free"]
        resets = sorted((r["reset"], r["reset_date"]) for r in ok if r.get("reset"))
        return {"left": sum(r["left"] for r in ok), "used": sum(r["used"] or 0 for r in ok), "limit": sum(r["limit"] or 0 for r in ok),
                "plan": paid[0]["plan"] if paid else "free", "reset_date": resets[0][1] if resets else None, "accounts": rows}
    return cached("credits", 60, get)


def eleven_voices(fresh=False):
    import eleven
    if fresh:
        _cache.pop("voices", None)

    def get():
        seen, out, errors = set(), [], []
        for a in eleven.accounts():
            try:
                for v in eleven.voices(a):
                    if v["id"] not in seen:
                        seen.add(v["id"])
                        out.append(v)
            except eleven.ElevenError as e:
                errors.append(str(e))
        if not out and errors:
            raise eleven.ElevenError(errors[0])
        return out
    return cached("voices", 3600, get)


def eleven_save_accounts(fn):
    import eleven
    with locked():
        cur = settings()
        el = cur["elevenlabs"]
        accs = [dict(a) for a in el.get("accounts") or []]
        if not accs and el.get("key"):
            accs = [{"id": "a" + uuid.uuid4().hex[:6], "name": "Hesap 1", "key": el["key"], "enabled": True, "added": now()}]
        accs = fn(accs, el)
        el["accounts"] = accs
        el["key"] = ""
        write_json(DATA / "settings.json", cur)
    _cache.pop("credits", None)
    _cache.pop("voices", None)
    eleven._pinned = None
    return accs
