import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

import core

TOOLS = core.ENGINE / "tools"
TEMPLATES = core.ENGINE / "templates"
DEFAULT_TEMPLATE = "kinetik"
FREE_TEMPLATE = "_serbest"


def template_roots():
    return [TEMPLATES, core.HOME / "sablonlar"]


def find_template(tid):
    for r in template_roots():
        d = r / (tid or "")
        if tid and (d / "src" / "scene.js").exists():
            return d
    return None


def template_dir(tid=None):
    d = find_template(tid) if tid else None
    return d if d and (d / "config.json").exists() else TEMPLATES / FREE_TEMPLATE


def list_templates():
    out = []
    for i, r in enumerate(template_roots()):
        for d in sorted(r.iterdir()) if r.exists() else []:
            meta = core.read_json(d / "meta.json")
            if not meta or not (d / "src" / "scene.js").exists():
                continue
            stamp = int((d / "preview.mp4").stat().st_mtime) if (d / "preview.mp4").exists() else 0
            out.append(dict(meta, id=d.name, custom=i > 0, preview=f"/tpl/{d.name}/preview.mp4?v={stamp}" if stamp else None,
                            poster=f"/tpl/{d.name}/poster.jpg?v={stamp}" if stamp else None))
    out.sort(key=lambda m: (m["custom"], m.get("order", 99), m["name"]))
    return out
FORMATS = {"9:16": (1080, 1920), "4:5": (1080, 1350), "1:1": (1080, 1080), "16:9": (1920, 1080)}


def log(pid, text, kind="step"):
    post = core.load_post(pid) or {}
    core.log_activity(text, post=pid, agent=post.get("agent"), kind=kind)


def apply_brief(cfg, post, proj):
    brief = post.get("brief") or {}
    w, h = FORMATS.get(brief.get("format"), FORMATS["9:16"])
    cfg["video"]["width"], cfg["video"]["height"] = w, h
    cfg["subtitle"]["y"] = round(h * 0.72)
    cfg["subtitle"]["enabled"] = brief.get("subtitles", True) is not False
    for key, col in zip(("accent", "accent2", "bg"), brief.get("colors") or []):
        cfg["colors"][key] = col
    if brief.get("cta"):
        cfg["text"]["follow"] = brief["cta"]
    if brief.get("voiceover") is False:
        cfg["voice"]["lines"] = []
    script = post.get("script")
    if script and script.get("lines"):
        lines = script["lines"]
        n = len(lines)
        cfg["voice"]["lines"] = [dict({"id": f"l{k:02d}", "text": t}, **({"anchor": 0.3} if k == 1 else {"gap": 0.4}))
                                 for k, t in enumerate(lines, 1)]
        cfg["beats"] = {f"s{k}": f"@l{k:02d}-0.15" for k in range(2, n + 1)}
        cfg["beats"]["outro"] = f"@l{n:02d}:end+0.4"
        cfg["scenes"] = [{"id": f"s{k}", "name": f"Sahne {k}", "start": 0 if k == 1 else f"s{k}",
                          "end": f"s{k + 1}" if k < n else "outro"} for k in range(1, n + 1)]
        cfg["scenes"].append({"id": "outro", "name": "Kapanış", "start": "outro", "end": cfg["video"]["duration"]})
        scenes = script.get("scenes") or []
        cfg["text"]["cards"] = [(scenes[k]["text"] if k < len(scenes) and scenes[k].get("text") else lines[k]) for k in range(n)]
    images = {}
    for i, ref in enumerate(r for r in post.get("refs") or [] if r.get("use")):
        src = core.post_dir(post["id"]) / "refs" / ref["file"]
        if src.exists():
            (proj / "images").mkdir(exist_ok=True)
            shutil.copy(src, proj / "images" / ref["file"])
            images[f"ref{i + 1}"] = f"images/{ref['file']}"
    if images:
        cfg["images"] = images


def attach_source(cfg, post, proj):
    s = post["source"]
    src = core.post_dir(post["id"]) / "kaynak" / s["file"]
    media = proj / "media"
    media.mkdir(exist_ok=True)
    wav = media / "source.wav"
    if not wav.exists():
        core.need_ffmpeg()
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le",
                        str(wav)], check=True)
    cfg["voice"]["source"] = "media/source.wav"
    cfg["voice"]["lines"] = []
    if s.get("visual"):
        dest = media / f"footage{src.suffix.lower()}"
        if not dest.exists():
            try:
                os.link(src, dest)
            except OSError:
                shutil.copy(src, dest)
        cfg["video"]["footage"] = f"media/{dest.name}"


def env():
    e = dict(os.environ)
    e["PROJECTS_ROOT"] = str(core.PROJECTS)
    e["SOSYAL_RENDER_TMP"] = str(core.DATA / "_render")
    e["PYTHONIOENCODING"] = "utf-8"
    return e


def run(cmd, cwd=None, log=None):
    e = core.node_env(env()) if cmd[0] == core.node_exe() else env()
    try:
        proc = subprocess.run(cmd, cwd=cwd, env=e, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except FileNotFoundError:
        raise RuntimeError(core.FFMPEG_MISSING if Path(str(cmd[0])).stem.lower() in ("ffmpeg", "ffprobe") else f"{cmd[0]} bulunamadı")
    if log:
        Path(log).parent.mkdir(parents=True, exist_ok=True)
        with open(log, "a", encoding="utf-8") as f:
            f.write(f"$ {' '.join(map(str, cmd))}\n{proc.stdout}\n{proc.stderr}\n")
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout).strip()[-1500:])
    return proc.stdout


def handle():
    s = core.settings()
    name = s["instagram"].get("username") or s.get("channel") or ""
    return f"@{name}" if name else ""


def scaffold(pid, name):
    core.ensure_data()
    post = core.load_post(pid)
    clean = re.sub(r"[^A-Za-z0-9]+", "", name.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")))
    folder = post.get("project") or f"{pid}_{clean or 'Video'}"
    proj = core.PROJECTS / folder
    (proj / "src").mkdir(parents=True, exist_ok=True)
    (proj / "build").mkdir(exist_ok=True)
    shutil.copy(core.ENGINE / "index.template.html", proj / "index.html")
    tdir = template_dir((post.get("brief") or {}).get("template"))
    if not (proj / "config.json").exists():
        cfg = json.loads((tdir / "config.json").read_text(encoding="utf-8"))
        cfg["meta"]["title"] = post["title"]
        cfg["video"]["duration"] = post.get("duration") or cfg["video"]["duration"]
        cfg["scenes"][-1]["end"] = cfg["video"]["duration"]
        cfg["text"]["handle"] = handle() or cfg["text"]["handle"]
        apply_brief(cfg, post, proj)
        if post.get("source"):
            attach_source(cfg, post, proj)
        (proj / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not (proj / "src" / "scene.js").exists():
        shutil.copytree(tdir / "src", proj / "src", dirs_exist_ok=True)
        if (tdir / "assets").exists():
            shutil.copytree(tdir / "assets", proj / "assets", dirs_exist_ok=True)
    own = os.environ.get("SOSYAL_NODE")
    node = ["set ELECTRON_RUN_AS_NODE=1", f'"{own}" ..\\_engine\\tools\\serve.mjs "%~dp0." 8790 --open'] if own else \
        [r'node ..\_engine\tools\serve.mjs "%~dp0." 8790 --open']
    with open(proj / "onizle.bat", "w", newline="") as f:
        f.write("\r\n".join(["@echo off", 'cd /d "%~dp0"', "set PROJECTS_ROOT=%~dp0.."] + node) + "\r\n")
    core.update_post(pid, lambda p: p.update(project=folder))
    log(pid, "Proje açıldı")
    return proj


def need_project(pid):
    post = core.load_post(pid)
    proj = core.project_dir(post)
    if not proj or not (proj / "config.json").exists():
        raise RuntimeError("proje yok: önce `studio.py scaffold`")
    return post, proj


def log_file(proj):
    return proj / "build" / "studio_log.txt"


def voice(pid):
    post, proj = need_project(pid)
    cfg = json.loads((proj / "config.json").read_text(encoding="utf-8"))
    if cfg["voice"].get("source"):
        log(pid, "Hazır ses yazıya dökülüyor (kredi harcanmaz)")
        out = run([sys.executable, "-X", "utf8", str(TOOLS / "voice.py"), str(proj)], cwd=proj, log=log_file(proj))
        log(pid, "Hazır ses satırlara bölündü, zamanlar hazır")
        return out
    if cfg["voice"]["lines"] and not core.settings()["narrator"].get("voice_id"):
        raise RuntimeError("anlatıcı sesi seçilmemiş (stüdyo Ayarlar > ElevenLabs)")
    chars = sum(len(l["text"]) for l in cfg["voice"]["lines"])
    log(pid, f"ElevenLabs seslendiriyor ({len(cfg['voice']['lines'])} satır, {chars} karakter)")
    out = run([sys.executable, "-X", "utf8", str(TOOLS / "voice.py"), str(proj)], cwd=proj, log=log_file(proj))
    log(pid, "Seslendirme hazır, satırlar zamana yerleşti")
    return out


def build(pid):
    post, proj = need_project(pid)
    return run([sys.executable, "-X", "utf8", str(TOOLS / "build.py"), str(proj)], cwd=proj, log=log_file(proj))


def stills(pid, times, noblur=False):
    post, proj = need_project(pid)
    build(pid)
    out = proj / "build" / "stills"
    cmd = [core.node_exe(), str(TOOLS / "export.mjs"), str(proj), "--stills", times, "--out", str(out)]
    if noblur:
        cmd.append("--noblur")
    run(cmd, cwd=proj, log=log_file(proj))
    log(pid, f"Kontrol kareleri üretildi ({times.replace(',', ', ')} sn)")
    return sorted(out.glob("f*.png"), key=lambda p: p.stat().st_mtime)[-len(times.split(",")):]


def render(pid):
    post, proj = need_project(pid)
    t0 = time.time()
    log(pid, "Video render ediliyor")
    build(pid)
    run([core.node_exe(), str(TOOLS / "export.mjs"), str(proj)], cwd=proj, log=log_file(proj))
    final = core.post_dir(pid) / "final.mp4"
    tmp = final.with_suffix(".tmp.mp4")
    shutil.copy(proj / "video.mp4", tmp)
    os.replace(tmp, final)
    vd = probe(final)
    core.update_post(pid, lambda p: p.update(video="final.mp4", video_duration=vd))
    auto_cover(pid)
    make_thumb(pid)
    log(pid, f"Video hazır ({vd or 0:.0f} sn video, render {time.time() - t0:.0f} sn)", kind="done")
    return final


def probe(path):
    if not shutil.which("ffprobe"):
        return core.probe_fallback(path)[0]
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return None


def auto_cover(pid):
    import random
    post = core.load_post(pid)
    if post.get("cover_user"):
        return post.get("thumb_offset")
    pdir = core.post_dir(pid)
    vd = post.get("video_duration") or (probe(pdir / post["video"]) if post.get("video") else None)
    if not vd or vd < 2:
        return None
    proj = core.project_dir(post)
    tl = core.read_json(proj / "build" / "timeline.json", {}) if proj else {}
    scenes = [s for s in tl.get("scenes", []) if isinstance(s.get("start"), (int, float)) and isinstance(s.get("end"), (int, float))
              and s["end"] - s["start"] >= 1.2 and s["start"] >= 0.8 and s["end"] <= vd - 1.0]
    if len(scenes) > 1:
        sc = random.choice(scenes[:-1] if scenes[-1]["end"] >= vd - 2.5 else scenes)
        span = sc["end"] - sc["start"]
        ms = int((sc["start"] + span * random.uniform(0.55, 0.85)) * 1000)
    else:
        lo, hi = max(1.0, vd * 0.25), max(1.5, vd * 0.75)
        ms = int(random.uniform(lo, min(hi, vd - 0.5)) * 1000)
    core.update_post(pid, lambda p: p.update(thumb_offset=ms))
    return ms


def make_thumb(pid):
    post = core.load_post(pid)
    pdir = core.post_dir(pid)
    if not post.get("video") or not (pdir / post["video"]).exists():
        return None
    t = (post.get("thumb_offset") or 0) / 1000
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(t), "-i", str(pdir / post["video"]), "-frames:v", "1",
                    "-vf", "scale=540:-2", "-q:v", "3", str(pdir / "thumb.jpg")], check=False)
    return pdir / "thumb.jpg"


def subtitle_cues(post):
    proj = core.project_dir(post)
    return (core.read_json(proj / "altyazi.json", {}) or {}).get("cues") or [] if proj else []


def subtitles(post, fmt="srt"):
    cues = [c for c in subtitle_cues(post) if c.get("rows")]
    if not cues:
        return None
    sep = "," if fmt == "srt" else "."

    def ts(t):
        ms = int(round(max(0.0, float(t)) * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}{sep}{ms % 1000:03d}"

    text = "\n\n".join(f"{i}\n{ts(c['start'])} --> {ts(c['end'])}\n" + "\n".join(c["rows"]) for i, c in enumerate(cues, 1)) + "\n"
    return "\ufeff" + ("WEBVTT\n\n" + text if fmt == "vtt" else text.replace("\n", "\r\n"))


def voice_lines(post):
    proj = core.project_dir(post)
    if not proj:
        return []
    cfg = core.read_json(proj / "config.json", {})
    timing = {l["id"]: l for l in core.read_json(proj / "altyazi.json", {}).get("lines", [])}
    out = []
    for line in cfg.get("voice", {}).get("lines", []):
        wav = proj / cfg["voice"]["dir"] / f"{line['id']}.wav"
        t = timing.get(line["id"], {})
        out.append({"id": line["id"], "text": line["text"], "start": t.get("start", line.get("at")),
                    "end": t.get("end"), "audio": wav.exists()})
    return out


def template_from_post(pid, name="", description=""):
    import tplreq
    post = core.load_post(pid)
    if not post:
        raise KeyError(pid)
    proj = core.project_dir(post)
    if not post.get("video") or not proj or not (proj / "src" / "scene.js").exists() or not (proj / "config.json").exists():
        raise ValueError("bu içeriğin hazır videosu ya da proje dosyaları yok")
    name = (name or "").strip()[:40] or f"{post['title'][:30]} stili"
    root = core.HOME / "sablonlar"
    root.mkdir(parents=True, exist_ok=True)
    taken = {d.name for d in root.iterdir()} | {t["id"] for t in list_templates()}
    base = tplreq.slug(name)
    tid, n = base, 2
    while tid in taken:
        tid, n = f"{base}-{n}", n + 1
    d = root / tid
    shutil.copytree(proj / "src", d / "src")
    if (proj / "assets").exists():
        shutil.copytree(proj / "assets", d / "assets")
    cfg = json.loads((proj / "config.json").read_text(encoding="utf-8"))
    cfg["meta"]["title"] = name
    cfg.setdefault("music", {})["tracks"] = []
    cfg["sfx"] = []
    for line in cfg.get("voice", {}).get("lines", []):
        line.pop("at", None)
    (d / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    meta = {"name": name, "description": (description or "").strip()[:300] or f"\"{post['title']}\" videosunun görsel dili: renkleri, yazı tipleri, sahne yapısı ve animasyonları.",
            "best_for": f"{post['title']} gibi içerikler", "tags": ["videodan"], "order": 60, "from_post": pid}
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    final = core.post_dir(pid) / post["video"]
    vd = post.get("video_duration") or probe(final) or 8
    start = round(min(max(0.0, vd * 0.15), max(0.0, vd - 8.5)), 2)
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", "8", "-i", str(final), "-vf", "scale=540:-2", "-an",
         "-c:v", "libx264", "-crf", "27", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(d / "preview.mp4")])
    thumb = core.post_dir(pid) / "thumb.jpg"
    if thumb.exists():
        shutil.copy(thumb, d / "poster.jpg")
    else:
        run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start + 2), "-i", str(final), "-frames:v", "1", "-vf", "scale=540:-2",
             "-q:v", "3", str(d / "poster.jpg")])
    core.log_activity(f"Videodan şablon alındı: {name} (#{pid})", post=pid, kind="done")
    return dict(meta, id=tid)


def template_preview(tid, seconds=8):
    tdir = find_template(tid)
    if not tdir:
        raise RuntimeError(f"şablon yok: {tid}")
    core.ensure_data()
    proj = core.PROJECTS / f"_onizleme_{tid}"
    if proj.exists():
        shutil.rmtree(proj)
    shutil.copytree(tdir / "src", proj / "src")
    if (tdir / "assets").exists():
        shutil.copytree(tdir / "assets", proj / "assets")
    (proj / "build").mkdir(parents=True, exist_ok=True)
    shutil.copy(core.ENGINE / "index.template.html", proj / "index.html")
    cfg = json.loads((tdir / "config.json").read_text(encoding="utf-8"))
    step = (seconds - 2) / 3
    cfg["video"]["duration"] = seconds
    cfg["voice"]["lines"] = []
    cfg["beats"] = {"s2": round(step, 2), "s3": round(step * 2, 2), "outro": round(step * 3, 2)}
    cfg["scenes"] = [{"id": "s1", "name": "Sahne 1", "start": 0, "end": "s2"}, {"id": "s2", "name": "Sahne 2", "start": "s2", "end": "s3"},
                     {"id": "s3", "name": "Sahne 3", "start": "s3", "end": "outro"}, {"id": "outro", "name": "Kapanış", "start": "outro", "end": seconds}]
    cfg["text"]["handle"] = handle() or "@kanalin"
    cfg.setdefault("music", {})["tracks"] = []
    cfg["sfx"] = []
    (proj / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    log = proj / "build" / "studio_log.txt"
    run([sys.executable, "-X", "utf8", str(TOOLS / "build.py"), str(proj)], cwd=proj, log=log)
    full = proj / "full.mp4"
    run([core.node_exe(), str(TOOLS / "export.mjs"), str(proj), "--out", str(full)], cwd=proj, log=log)
    w, h = cfg["video"]["width"], cfg["video"]["height"]
    scale = "scale=540:-2" if h >= w else "scale=-2:540"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(full), "-vf", scale, "-an", "-c:v", "libx264", "-crf", "27",
         "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(tdir / "preview.mp4")])
    run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(round(step * 0.6, 2)), "-i", str(full), "-frames:v", "1", "-vf", scale,
         "-q:v", "3", str(tdir / "poster.jpg")])
    shutil.rmtree(proj, ignore_errors=True)
    return tdir / "preview.mp4"

