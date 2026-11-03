import argparse
import datetime as dt
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import autopilot
import cloud
import core
import eleven
import ideas
import igaccount
import accounts
import auditkit
import claudeinfo
import instagram
import manual
import notify
import oturum
import tplreq
import produce
import research
import tiktok
import webagent
import transcribe
import components
import desktop
import youtube
import ytaccount
import update
import setupguide

WEB = core.ROOT / "web"
PREP_SECONDS = 240
BUSY = set()
BUSY_LOCK = threading.Lock()


def background(pid, key, fn):
    tag = f"{pid}:{key}"
    with BUSY_LOCK:
        if tag in BUSY:
            return False
        BUSY.add(tag)

    def run():
        try:
            fn()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        finally:
            with BUSY_LOCK:
                BUSY.discard(tag)
    threading.Thread(target=run, daemon=True).start()
    return True


def set_stage(pid, text, **kw):
    core.update_post(pid, lambda p: p.update(stage=text, **kw))


def do_publish(pid, at=None):
    def step(text):
        set_stage(pid, text)
        core.log_activity(text, post=pid, kind="publish")

    def fn():
        set_stage(pid, "Paylaşım hazırlanıyor", status="paylasiliyor", error=None)
        core.log_activity("Instagram paylaşımı başladı", post=pid, kind="publish")
        try:
            res = instagram.publish(core.load_post(pid), log=step, publish_at=at)
            set_stage(pid, "Instagram'da yayında", status="paylasildi", published=res, schedule=None)
            core.log_activity("Instagram'da yayınlandı", post=pid, kind="done")
            youtube.post_changed(pid)
        except Exception as e:  # noqa: BLE001
            set_stage(pid, "Paylaşılamadı", status="hata", error=str(e))
            core.log_activity(f"Paylaşılamadı: {e}", post=pid, kind="error")
    return background(pid, "publish", fn)


def youtube_problems(p):
    block = core.youtube_block(p.get("kind"))
    if block:
        return [block]
    return [] if youtube._video_ok(p) else ["video hazır değil"]


def youtube_now(pid, by=""):
    at = dt.datetime.now().replace(second=0, microsecond=0).isoformat(timespec="minutes")
    core.update_post(pid, lambda q: q.update(status="planlandi", schedule=at, stage="YouTube'a hemen yükleniyor", error=None,
                                             after_render=None))
    core.log_activity(f"YouTube'da hemen paylaşılacak{by}", post=pid, kind="publish")
    cloud.post_released(pid)
    youtube.post_changed(pid)


def youtube_only_tick(p, t):
    pid = p["id"]
    y = p.get("youtube") or {}
    st = y.get("state")
    vid = y.get("video_id")
    yat = core.parse_time(y.get("at")) if y.get("at") else None
    passed = bool(yat and not y.get("hold") and (t - yat).total_seconds() >= youtube.LOCK_AFTER)
    if st in youtube.FINAL or (st == "scheduled" and vid and passed):
        res = {"at": y["at"] if yat and yat <= t else core.now(),
               "platforms": {"youtube": {"url": y.get("url") or (f"https://youtube.com/shorts/{vid}" if vid else None), "state": st,
                                         "video_id": vid}}}
        stage = {"published": "YouTube'da yayında", "private_locked": "YouTube'da gizli kaldı"}.get(st, "YouTube yayın saati geçti")
        done = {"v": False}

        def fn(q):
            if q.get("status") == "planlandi" and not core.ig_on(q):
                done["v"] = True
                q.update(status="paylasildi", published=res, schedule=None, stage=stage, error=None, after_render=None)
        core.update_post(pid, fn)
        if done["v"] and st not in youtube.FINAL:
            core.log_activity("YouTube yayın saati geçti; paylaşıldı olarak işaretlendi", post=pid, kind="info")
        return
    at = core.parse_time(p["schedule"])
    if not at or t < at:
        return
    why = None
    if youtube.target(p, youtube.conf()) is None:
        why = core.youtube_block(p.get("kind"))
    elif st == "error" and int(y.get("attempts") or 0) >= youtube.MAX_ATTEMPTS:
        why = y.get("error") or "YouTube'a yüklenemedi"
    elif st == "deleted":
        why = y.get("error") or "Video YouTube'da bulunamadı"
    if not why:
        return
    done = {"v": False}

    def fail(q):
        if q.get("status") == "planlandi" and not core.ig_on(q):
            done["v"] = True
            q.update(status="hata", stage="YouTube'da paylaşılamadı", error=f"YouTube'da paylaşılamadı: {why}")
    core.update_post(pid, fail)
    if done["v"]:
        core.log_activity(f"Paylaşılamadı: YouTube — {why}", post=pid, kind="error")


def apply_after_render(p):
    pid = p["id"]
    ar = p.get("after_render") or {}
    tg = core.targets(p)

    def take(q):
        q.update(after_render=None)
        core.write_targets(q, tg)
    core.update_post(pid, take)
    by = f" ({ar['by']})" if ar.get("by") else ""
    if not tg["instagram"]:
        probs = youtube_problems(core.load_post(pid))
        if probs:
            msg = ", ".join(probs)
            set_stage(pid, f"Otomatik paylaşılamadı: {msg}")
            core.log_activity(f"Video bitti ama otomatik paylaşılamadı: {msg}{by}", post=pid, kind="error")
            return
    if ar.get("action") == "schedule":
        at = core.parse_time(ar.get("at"))
        if at:
            core.update_post(pid, lambda q: q.update(status="planlandi", schedule=at.isoformat(timespec="minutes"),
                                                     stage="Video bitti, otomatik planlandı", error=None))
            core.log_activity(f"Video bitti, otomatik planlandı: {at.strftime('%d.%m.%Y %H:%M')}{by}", post=pid, kind="schedule")
            if tg["instagram"]:
                cloud.post_scheduled(pid)
            youtube.post_changed(pid)
            return
    if not tg["instagram"]:
        youtube_now(pid, by)
        return
    problems = instagram.validate(core.load_post(pid))
    if problems:
        msg = ", ".join(problems)
        set_stage(pid, f"Otomatik paylaşılamadı: {msg}")
        core.log_activity(f"Video bitti ama otomatik paylaşılamadı: {msg}{by}", post=pid, kind="error")
        return
    core.log_activity(f"Video bitti, otomatik paylaşılıyor{by}", post=pid, kind="publish")
    do_publish(pid)


def run_due(t):
    for p in core.list_posts():
        if p.get("after_render") and p["status"] == "inceleme" and core.ready(p):
            apply_after_render(p)
            continue
        if p["status"] != "planlandi" or not p.get("schedule"):
            continue
        if not core.ig_on(p):
            youtube_only_tick(p, t)
            continue
        at = core.parse_time(p["schedule"])
        if (at - t).total_seconds() > PREP_SECONDS:
            continue
        if cloud.owns(p, t):
            continue
        if (t - at).total_seconds() > 6 * 3600:
            core.update_post(p["id"], lambda q: q.update(
                status="hata", stage="Planlanan saat kaçtı",
                error="Stüdyo planlanan saatte açık değildi; yeniden planla ya da şimdi paylaş."))
            continue
        cloud.fallback(p)
        do_publish(p["id"], at)


def scheduler_loop():
    last_refresh = 0
    while True:
        try:
            autopilot.tick()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        try:
            t = dt.datetime.now()
            run_due(t)
            ig = core.settings()["instagram"]
            if ig.get("token") and time.time() - last_refresh > 3600:
                last_refresh = time.time()
                prev = core.parse_time(ig.get("token_refreshed")) if ig.get("token_refreshed") else None
                if prev and (t - prev).days >= 7:
                    instagram.refresh_token()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        try:
            cloud.tick()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        try:
            youtube.tick()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        try:
            tiktok.tick()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        time.sleep(20)


def post_detail(p):
    out = dict(p)
    proj = core.project_dir(p)
    out["voice_lines"] = produce.voice_lines(p)
    out["has_thumb"] = (core.post_dir(p["id"]) / "thumb.jpg").exists()
    out["busy"] = sorted(t.split(":")[1] for t in BUSY if t.startswith(p["id"] + ":"))
    out["problems"] = instagram.validate(p) if core.ready(p) else []
    out["caption_full"] = instagram.full_caption(p)
    out["project_path"] = str(proj) if proj else None
    out["subs"] = bool(p.get("video") and proj and (proj / "altyazi.json").exists())
    out["activity"] = core.read_activity(80, post=p["id"])
    out["cloud"] = cloud.post_info(p)
    out["youtube"] = youtube.post_info(p)
    out["tiktok"] = tiktok.post_info(p)
    out["targets"] = core.targets(p)
    return out


def save_upload(handler, dest_dir, stem):
    name = urllib.parse.unquote(handler.headers.get("X-Filename", "dosya.png"))
    ext = Path(name).suffix.lower()
    allow_video = handler.headers.get("X-Allow-Video") == "1"
    allow_audio = handler.headers.get("X-Allow-Audio") == "1"
    video = ext in manual.VIDEO_EXT and allow_video
    audio = ext in core.AUDIO_EXT and allow_audio
    if ext not in core.IMAGE_EXT and not video and not audio:
        handler.body()
        kinds = ["görsel: png, jpg, webp, gif"] + (["video: mp4, mov, webm"] if allow_video else []) + (["ses: mp3, wav, m4a, ogg"] if allow_audio else [])
        raise ValueError(f"bu dosya türü yüklenemez ({'; '.join(kinds)})")
    n = int(handler.headers.get("Content-Length") or 0)
    if n > (1024 if video else 300 if audio else 25) * 1024 * 1024:
        raise ValueError("dosya çok büyük (görsel en fazla 25 MB, ses 300 MB, video 1 GB)")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{stem}{ext}"
    handler.body_read = True
    with open(dest, "wb") as f:
        left = n
        while left > 0:
            chunk = handler.rfile.read(min(1 << 20, left))
            if not chunk:
                break
            f.write(chunk)
            left -= len(chunk)
    return dest, name


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def send_download(self, body, ctype, name):
        safe = " ".join(re.sub(r'[\\/:*?"<>|\r\n]+', " ", name).split())[:120] or "dosya"
        ascii_name = re.sub(r"[^A-Za-z0-9._ -]+", "_", safe)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(safe)}")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, text, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def fail(self, msg, status=400):
        self.send_json({"error": msg}, status)

    def body(self):
        self.body_read = True
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def json_body(self):
        raw = self.body()
        return json.loads(raw.decode("utf-8")) if raw else {}

    def send_file(self, path):
        path = Path(path)
        if not path.is_file():
            return self.fail("dosya yok", 404)
        size = path.stat().st_size
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix in (".js", ".mjs"):
            ctype = "text/javascript; charset=utf-8"
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m and size:
            start = int(m.group(1) or 0)
            end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(1 << 20, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (ConnectionError, OSError):
                    return
                left -= len(chunk)

    def do_GET(self):
        try:
            self.route_get()
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.fail(str(e), 500)

    def do_POST(self):
        self.body_read = False
        try:
            self.route_post()
        except KeyError as e:
            self.fail(f"bulunamadı: {e}", 404)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.fail(str(e), 500)
        finally:
            if not self.body_read and int(self.headers.get("Content-Length") or 0):
                self.close_connection = True

    def route_get(self):
        url = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(url.path)
        qs = urllib.parse.parse_qs(url.query)
        if path == "/":
            return self.send_file(WEB / "index.html")
        if path.startswith("/web/"):
            target = (WEB / path[5:]).resolve()
            if WEB.resolve() in target.parents:
                return self.send_file(target)
            return self.fail("yok", 404)
        if path == "/api/state":
            credits = core.eleven_credits(fresh="fresh" in qs)
            posts, batches = core.list_posts(), ideas.list_batches()
            return self.send_json({"posts": [core.summary(p) for p in posts], "agents": core.list_agents(),
                                   "credits": credits, "settings": core.public_settings(), "now": core.now(),
                                   "queue": core.queue(), "activity": core.read_activity(60),
                                   "ideas": [ideas.summary(b) for b in batches],
                                   "notifications": notify.listing(), "notify_settings": notify.settings(),
                                   "trash": len(core.list_trash()),
                                   "claude": claudeinfo.brief(),
                                   "tpl_requests": [tplreq.summary(r) for r in tplreq.list_requests()],
                                   "autopilot": autopilot.summaries(posts, batches),
                                   "cloud": cloud.brief(posts), "youtube": youtube.brief(posts),
                                   "tiktok": tiktok.brief(posts),
                                   "draft_inbox": len(core.read_json(core.DATA / "draft_inbox.json", {}).get("refs") or [])})
        if path == "/api/oturumlar":
            return self.send_json(oturum.listing())
        if path == "/api/oturum/avatar":
            e = oturum.find(int((qs.get("id") or ["0"])[0] or 0))
            f = oturum.avatar(e["data"]) if e else None
            return self.send_file(f) if f else self.fail("yok", 404)
        if path == "/api/cloud":
            return self.send_json(cloud.public())
        if path == "/api/youtube":
            return self.send_json(youtube.public(self.server.server_address[1]))
        if path == "/api/tiktok":
            return self.send_json(tiktok.public())
        m = re.fullmatch(r"/api/tiktok/media/((?:avatar|cover_\d+)\.jpg)", path)
        if m:
            f = tiktok.root() / "media" / m.group(1)
            return self.send_file(f) if f.exists() else self.fail("yok", 404)
        if path == "/api/tiktok/account":
            return self.send_json(tiktok.account("fresh" in urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)))
        if path == "/api/site":
            return self.send_json(auditkit.site_view())
        if path == "/api/youtube/audit-kit":
            return self.send_json(auditkit.view())
        m = re.fullmatch(r"/api/youtube/audit-kit/shots/([\w.\-]+\.png)", path)
        if m:
            return self.send_file(auditkit.shot_dir() / m.group(1))
        if path == "/oauth/youtube":
            m = re.match(r"o(\d+)\.", (qs.get("state") or [""])[0])
            e = oturum.find(int(m.group(1))) if m and int(m.group(1)) != core.OTURUM else None
            if e:
                self.send_response(302)
                self.send_header("Location", f"http://127.0.0.1:{e['port']}{self.path}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            ok, text = youtube.finish_auth(*((qs.get(k) or [None])[0] for k in ("code", "state", "error")))
            return self.send_html(youtube.oauth_page(ok, text), 200 if ok else 400)
        if path == "/api/autopilot":
            return self.send_json(autopilot.summaries())
        m = re.fullmatch(r"/api/autopilot/(A\d+)", path)
        if m:
            c = autopilot.load(m.group(1))
            return self.send_json(autopilot.detail(c)) if c and not c.get("deleted") else self.fail("yok", 404)
        if path.startswith("/api/ig/"):
            return self.ig_get(path[8:], qs)
        if path.startswith("/api/yt/"):
            return self.yt_get(path[8:], qs)
        if path == "/api/templates":
            return self.send_json(produce.list_templates())
        if path == "/api/trash":
            return self.send_json([core.trash_summary(p) for p in core.list_trash()])
        if path == "/api/claude":
            return self.send_json(claudeinfo.state())
        m = re.fullmatch(r"/tpl/([\w\-]+)/(preview\.mp4|poster\.jpg)", path)
        if m:
            d = produce.find_template(m.group(1))
            return self.send_file(d / m.group(2)) if d else self.fail("yok", 404)
        m = re.fullmatch(r"/api/tpl-requests/(S\d+)", path)
        if m:
            r = tplreq.load(m.group(1))
            return self.send_json(r) if r else self.fail("yok", 404)
        m = re.fullmatch(r"/api/ideas/(F\d+)", path)
        if m:
            b = ideas.load(m.group(1))
            return self.send_json(b) if b and not b.get("deleted") else self.fail("yok", 404)
        if path == "/api/activity":
            return self.send_json(core.read_activity(int(qs.get("limit", ["300"])[0]), post=qs.get("post", [None])[0]))
        if path == "/avatar":
            av = core.avatar_file()
            return self.send_file(av) if av else self.fail("yok", 404)
        if webagent.handle_get(self, path, qs):
            return
        if research.handle_get(self, path):
            return
        if path == "/api/busy":
            return self.send_json({"busy": busy_reason()})
        if path == "/api/update/ready":
            return self.send_json({"busy": busy_everywhere()})
        if update.handle_get(self, path, qs) or setupguide.handle_get(self, path, qs):
            return
        m = re.fullmatch(r"/uploads/([\w.\-]+)", path)
        if m:
            return self.send_file(core.UPLOADS / m.group(1))
        m = re.fullmatch(r"/media/(\d+)/(refs|kaynak)/([\w.\-]+)", path)
        if m:
            return self.send_file(core.post_dir(m.group(1)) / m.group(2) / m.group(3))
        m = re.fullmatch(r"/api/posts/(\d+)", path)
        if m:
            p = core.load_post(m.group(1))
            return self.send_json(post_detail(p)) if p else self.fail("yok", 404)
        m = re.fullmatch(r"/api/posts/(\d+)/altyazi\.(srt|vtt)", path)
        if m:
            p = core.load_post(m.group(1))
            text = produce.subtitles(p, m.group(2)) if p else None
            if not text:
                return self.fail("bu içeriğin altyazısı yok", 404)
            ctype = "application/x-subrip" if m.group(2) == "srt" else "text/vtt"
            return self.send_download(text.encode("utf-8"), f"{ctype}; charset=utf-8", f"{p['title'] or p['id']}.{m.group(2)}")
        if path == "/api/stt":
            return self.send_json(transcribe.status())
        if components.handle_get(self, path):
            return
        if path == "/api/desktop":
            return self.send_json(desktop.status())
        if path == "/api/uiprefs":
            return self.send_json(core.read_json(core.DATA / "ui_prefs.json", {}))
        if path == "/api/instagram/permissions":
            try:
                return self.send_json({"granted": instagram.permissions()})
            except instagram.IgError as e:
                return self.send_json({"granted": None, "error": str(e)})
        if path == "/api/voices":
            return self.send_json(core.eleven_voices(fresh="fresh" in qs))
        if path == "/api/eleven/accounts":
            return self.send_json(eleven.view(fresh="fresh" in qs))
        m = re.fullmatch(r"/media/(\d+)/([\w.\-]+)", path)
        if m:
            return self.send_file(core.post_dir(m.group(1)) / m.group(2))
        m = re.fullmatch(r"/proj/(\d+)/(.+)", path)
        if m:
            p = core.load_post(m.group(1))
            proj = core.project_dir(p) if p else None
            if not proj:
                return self.fail("yok", 404)
            target = (proj / m.group(2)).resolve()
            if proj.resolve() in target.parents and target.suffix.lower() in (".mp4", ".wav", ".png", ".jpg"):
                return self.send_file(target)
            return self.fail("yok", 404)
        self.fail("yok", 404)

    def route_post(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/cloud/"):
            return self.cloud_post(path[11:])
        if path.startswith("/api/youtube/"):
            return self.youtube_post(path[13:])
        if path.startswith("/api/tiktok/"):
            return self.tiktok_post(path[12:])
        if path in ("/api/site", "/api/site/off"):
            d = self.json_body()
            try:
                return self.send_json(auditkit.site_off() if path.endswith("/off") else auditkit.save_site(d))
            except ValueError as e:
                return self.fail(str(e))
        if path == "/api/oturumlar":
            d = self.json_body()
            try:
                return self.send_json({"oturum": oturum.create(d.get("name"))})
            except ValueError as e:
                return self.fail(str(e))
        m = re.fullmatch(r"/api/oturumlar/(\d+)(/delete)?", path)
        if m:
            d = self.json_body()
            try:
                if m.group(2):
                    return self.send_json(oturum.remove(int(m.group(1))))
                return self.send_json({"oturum": oturum.rename(int(m.group(1)), d.get("name"))})
            except ValueError as e:
                return self.fail(str(e))
        if path == "/api/oturum/shutdown":
            self.body()
            if not core.OTURUM:
                return self.fail("ana stüdyo bu yolla kapatılamaz")
            why = busy_reason()
            if why:
                return self.fail(why, 409)
            self.send_json({"ok": True})
            threading.Thread(target=stop_server, args=(self.server,), daemon=True).start()
            return
        if path in ("/api/desktop/install", "/api/desktop/open"):
            d = self.json_body()
            if path.endswith("install"):
                return self.send_json(desktop.install())
            port = self.server.server_address[1]
            return self.send_json({"opened": desktop.open_app(port, d.get("page"))})
        if path in ("/api/draft/inbox", "/api/draft/inbox/take"):
            d = self.json_body()
            f = core.DATA / "draft_inbox.json"
            with core.locked():
                box = core.read_json(f, {}).get("refs") or []
                if path.endswith("take"):
                    core.write_json(f, {"refs": []})
                    return self.send_json({"refs": box})
                box += [r for r in d.get("refs") or [] if isinstance(r, dict) and r.get("id")]
                core.write_json(f, {"refs": box})
            return self.send_json({"queued": len(box)})
        if path == "/api/uiprefs":
            d = self.json_body()
            prefs = {k: str(v) for k, v in (d.get("prefs") or {}).items() if str(k).startswith("sosyal")}
            core.write_json(core.DATA / "ui_prefs.json", {"updated": core.now(), "prefs": prefs})
            return self.send_json({"ok": True})
        if path in ("/api/stt/install", "/api/stt/cancel"):
            self.body()
            return self.send_json(transcribe.start() if path.endswith("install") else transcribe.cancel())
        if path.startswith("/api/components/"):
            return components.handle_post(self, path)
        if path.startswith("/api/webagent/"):
            return webagent.handle_post(self, path)
        if path.startswith("/api/research/"):
            return research.handle_post(self, path)
        if path == "/api/posts":
            d = self.json_body()
            if not (d.get("concept") or "").strip() and not d.get("source"):
                return self.fail("konsept boş")
            if d.get("source") and not transcribe.status()["ready"]:
                return self.fail("önce konuşma tanıma modelini indir (Oluştur > Hazır ses / video > İndir)")
            try:
                p = core.new_post(d.get("title", ""), d.get("concept") or "", int(d.get("duration") or 30), d.get("brief"), d.get("refs"),
                                  source=d.get("source"), research=d.get("research"))
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json(p)
        if path.startswith("/api/ig/"):
            return self.ig_post(path[8:])
        if path == "/api/ideas":
            d = self.json_body()
            topic = (d.get("topic") or "").strip()
            if not topic:
                return self.fail("konu boş")
            count = max(1, min(30, int(d.get("count") or 10)))
            return self.send_json(ideas.new_batch(topic, count, d.get("brief")))
        m = re.fullmatch(r"/api/ideas/(F\d+)/(more|item|produce|delete)", path)
        if m:
            bid, action = m.groups()
            d = self.json_body()
            try:
                if action == "more":
                    b = ideas.request_more(bid, max(1, min(20, int(d.get("count") or 5))))
                elif action == "item":
                    b = ideas.edit_item(bid, d["id"], {k: v for k, v in d.items() if k != "id"})
                elif action == "produce":
                    ids = [str(x) for x in d.get("items") or []]
                    if not ids:
                        return self.fail("seçili fikir yok")
                    tpls = {str(k): str(v) for k, v in (d.get("templates") or {}).items() if v}
                    tg = core.norm_targets(d.get("targets"))
                    per = {str(k): core.norm_targets(v, base=tg) for k, v in (d.get("item_targets") or {}).items() if isinstance(v, dict)}
                    made = ideas.produce(bid, ids, tpls, targets=tg, item_targets=per)
                    return self.send_json({"posts": made, "batch": ideas.load(bid)})
                else:
                    ideas.update(bid, lambda b: b.update(deleted=True))
                    return self.send_json({"ok": True})
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json(b)
        if path == "/api/autopilot":
            try:
                c = autopilot.create(self.json_body())
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json(autopilot.detail(c))
        if path == "/api/autopilot/preview":
            try:
                return self.send_json(autopilot.preview(self.json_body()))
            except ValueError as e:
                return self.fail(str(e))
        m = re.fullmatch(r"/api/autopilot/(A\d+)/(pause|resume|cancel|delete|approve|duplicate|targets)", path)
        if m:
            if m.group(2) == "duplicate":
                self.body()
                return self.send_json(autopilot.duplicate(m.group(1)))
            try:
                c = autopilot.action(m.group(1), m.group(2), self.json_body())
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json(autopilot.detail(c))
        if path == "/api/claude/prefs":
            d = self.json_body()
            ids = {m[0] for m in claudeinfo.MODELS}
            eff = {e[0] for e in claudeinfo.EFFORTS}
            pref = {"model": d.get("model") if d.get("model") in ids else "", "effort": d.get("effort") if d.get("effort") in eff else ""}
            core.save_settings({"claude": pref})
            return self.send_json(claudeinfo.state())
        if path == "/api/claude/refresh":
            claudeinfo.request_refresh()
            return self.send_json(claudeinfo.state())
        if path == "/api/claude/account":
            d = self.json_body()
            acc = d.get("account")
            names = core.account_names()
            if acc not in names:
                return self.fail("bilinmeyen hesap")
            cur = core.active_accounts()
            if "on" in d:
                new = [a for a in cur if a != acc] + ([acc] if d.get("on") else [])
                if not new:
                    return self.fail("en az bir hesap açık kalmalı")
            else:
                new = [acc]
            new = core.set_active_accounts(new)
            if new != cur:
                core.log_activity("Ajan hesapları: " + " + ".join(names[a] for a in new) + " iş alıyor", kind="info")
            return self.send_json(claudeinfo.state())
        if path == "/api/claude/open":
            try:
                accounts.launch(self.json_body().get("account") or "s2")
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json({"ok": True})
        if path == "/api/claude/accounts/add":
            try:
                acc = accounts.add(self.json_body().get("name"))
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json(dict(claudeinfo.state(), added=acc))
        if path == "/api/claude/accounts/remove":
            d = self.json_body()
            try:
                res = accounts.remove(d.get("account"), bool(d.get("delete_files")))
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json(dict(claudeinfo.state(), removed=res))
        if path == "/api/notifications/read":
            d = self.json_body()
            notify.mark_read(d.get("ids"))
            return self.send_json(notify.listing())
        if path == "/api/notifications/clear":
            notify.clear()
            return self.send_json(notify.listing())
        if path == "/api/tpl-requests":
            d = self.json_body()
            try:
                r = tplreq.new_request(d.get("name"), d.get("answers"), d.get("description") or "", d.get("uploads") or [],
                                       d.get("links") or [], d.get("similarity") or "")
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json(tplreq.summary(r))
        m = re.fullmatch(r"/api/tpl-requests/(S\d+)/(note|delete)", path)
        if m:
            d = self.json_body()
            try:
                if m.group(2) == "note":
                    return self.send_json(tplreq.summary(tplreq.add_note(m.group(1), d.get("text"))))
                tplreq.update(m.group(1), lambda q: q.update(deleted=True))
                return self.send_json({"ok": True})
            except (ValueError, KeyError) as e:
                return self.fail(str(e))
        m = re.fullmatch(r"/api/templates/([\w\-]+)/(note|delete)", path)
        if m:
            d = self.json_body()
            r = tplreq.by_template(m.group(1))
            try:
                if m.group(2) == "note":
                    if not r:
                        return self.fail("bu şablon için düzeltme istenemez")
                    return self.send_json(tplreq.summary(tplreq.add_note(r["id"], d.get("text"))))
                tplreq.delete_template(m.group(1))
                return self.send_json({"ok": True})
            except ValueError as e:
                return self.fail(str(e))
        if path == "/api/posts/targets":
            d = self.json_body()
            ids = [str(x) for x in d.get("ids") or []][:300]
            raw = {k: d[k] for k in core.PLATFORMS if d.get(k) is not None}
            if not ids:
                return self.fail("seçili içerik yok")
            if not raw:
                return self.fail("değişiklik yok")
            updated, skipped = [], []
            for pid in ids:
                try:
                    if not re.fullmatch(r"\d+", pid):
                        raise KeyError(pid)
                    core.change_targets(pid, raw)
                    updated.append(pid)
                except KeyError:
                    skipped.append({"id": pid, "reason": "bulunamadı"})
                except ValueError as e:
                    skipped.append({"id": pid, "reason": str(e)})
            return self.send_json({"updated": updated, "skipped": skipped})
        if path == "/api/posts/manual":
            d = self.json_body()
            try:
                p = manual.create(d.get("kind", ""), d.get("uploads") or [], d.get("caption") or "", d.get("hashtags") or "")
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json(post_detail(p))
        if path == "/api/uploads":
            import secrets
            try:
                dest, name = save_upload(self, core.UPLOADS, secrets.token_hex(8))
            except ValueError as e:
                return self.fail(str(e))
            return self.send_json({"id": dest.name, "name": name, "url": f"/uploads/{dest.name}"})
        if path == "/api/avatar":
            old = core.avatar_file()
            try:
                dest, name = save_upload(self, core.DATA, "avatar_new")
            except ValueError as e:
                return self.fail(str(e))
            if old:
                old.unlink()
            dest.replace(core.DATA / f"avatar{dest.suffix}")
            return self.send_json(core.public_settings())
        if path == "/api/avatar/delete":
            old = core.avatar_file()
            if old:
                old.unlink()
            return self.send_json(core.public_settings())
        if path == "/api/eleven/accounts":
            d = self.json_body()
            try:
                return self.send_json(eleven.add_account(d.get("key"), d.get("name")))
            except ValueError as e:
                return self.fail(str(e))
        m = re.fullmatch(r"/api/eleven/accounts/([\w-]+)/(delete|enable|rename|up|down|restore)", path)
        if m:
            d = self.json_body()
            if m.group(2) == "restore":
                try:
                    return self.send_json(eleven.restore_account(m.group(1)))
                except ValueError as e:
                    return self.fail(str(e))
            return self.send_json(eleven.update_account(m.group(1), m.group(2), d.get("value")))
        if path == "/api/eleven/strategy":
            try:
                return self.send_json(eleven.set_strategy(self.json_body().get("strategy")))
            except ValueError as e:
                return self.fail(str(e))
        if path == "/api/settings":
            d = self.json_body()
            d.pop("cloud", None)
            d.pop("youtube", None)
            dtg = d.pop("default_targets", None)
            if dtg is not None:
                try:
                    core.save_default_targets(dtg)
                except ValueError as e:
                    return self.fail(str(e))
            ig = d.get("instagram")
            if ig is not None and not ig.get("token"):
                ig.pop("token", None)
            el = d.pop("elevenlabs", None)
            if el and el.get("key"):
                try:
                    eleven.add_account(el["key"], el.get("name"))
                except ValueError as e:
                    return self.fail(str(e))
            core.save_settings(d)
            if ig is not None:
                cloud.kick()
            return self.send_json(core.public_settings())
        if path == "/api/instagram/test":
            d = self.json_body()
            token = d.get("token") or None
            try:
                me = instagram.test(token)
            except instagram.IgError as e:
                return self.fail(str(e))
            patch = {"user_id": me["user_id"], "username": me["username"]}
            if token:
                patch.update(token=token, token_refreshed=core.now())
            core.save_settings({"instagram": patch})
            cloud.kick()
            if me.get("picture") and not core.avatar_file():
                try:
                    with urllib.request.urlopen(me["picture"], timeout=30) as r:
                        (core.DATA / "avatar.jpg").write_bytes(r.read())
                except Exception:  # noqa: BLE001
                    pass
            return self.send_json(me)
        if path == "/api/open-instagram":
            d = self.json_body()
            target = (d.get("path") or "").strip().lstrip("/")
            open_window("https://www.instagram.com/" + urllib.parse.quote(target, safe="/?=&"), "520,940")
            return self.send_json({"ok": True})
        if path == "/api/instagram/disconnect":
            core.save_settings({"instagram": {"token": "", "user_id": "", "username": ""}})
            cloud.kick()
            return self.send_json({"ok": True})
        if path == "/api/trash/empty":
            freed = 0
            items = core.list_trash()
            for p in items:
                freed += core.purge_post(p["id"])
            return self.send_json({"count": len(items), "freed": freed})
        m = re.fullmatch(r"/api/posts/(\d+)/youtube(?:/(retry|upload-now|manual|unmanual))?", path)
        if m:
            return self.youtube_post_action(*m.groups())
        m = re.fullmatch(r"/api/posts/(\d+)/tiktok(?:/(now))?", path)
        if m:
            return self.tiktok_post_action(*m.groups())
        m = re.fullmatch(r"/api/posts/(\d+)/(\w[\w-]*)", path)
        if not m:
            return self.fail("yok", 404)
        pid, action = m.groups()
        if core.load_post(pid) is None:
            return self.fail("yok", 404)
        d = self.json_body()
        if action == "update":
            allowed = {"title", "caption", "hashtags", "thumb_offset"}
            patch = {k: v for k, v in d.items() if k in allowed}
            before = core.load_post(pid)
            if "thumb_offset" in patch:
                patch["cover_user"] = True
            p = core.update_post(pid, lambda p: p.update(patch))
            if "thumb_offset" in patch and patch["thumb_offset"] != before.get("thumb_offset"):
                background(pid, "thumb", lambda: produce.make_thumb(pid))
            if any(k in patch for k in ("caption", "hashtags", "thumb_offset", "title")):
                cloud.post_changed(pid)
                youtube.post_changed(pid)
        elif action == "message":
            if not (d.get("text") or "").strip():
                return self.fail("not boş")
            p = core.add_message(pid, "user", d["text"])
            core.log_activity("Revizyon notu yazıldı", post=pid, kind="queue")
            if p["status"] in ("inceleme", "hata", "planlandi"):
                core.update_post(pid, lambda q: q.update(status="uretimde", stage="Revizyon notu ajana iletildi",
                                                         schedule=None, error=None))
                cloud.post_released(pid)
                youtube.post_changed(pid)
        elif action == "caption-request":
            core.update_post(pid, lambda p: p.update(caption_request={"at": core.now(), "hint": d.get("hint", "")}))
            core.log_activity("Açıklama istendi", post=pid, kind="queue")
        elif action == "caption-cancel":
            core.update_post(pid, lambda p: p.update(caption_request=None))
        elif action == "after-render":
            act = d.get("action") or ""
            if act not in ("", "schedule", "publish"):
                return self.fail("bilinmeyen işlem")
            ar = None
            if act == "schedule":
                at = core.parse_time(d.get("at"))
                if not at:
                    return self.fail("tarih yok")
                if at < dt.datetime.now() - dt.timedelta(minutes=1):
                    return self.fail("geçmiş bir saat seçildi")
                ar = {"action": "schedule", "at": at.isoformat(timespec="minutes"), "set": core.now()}
            elif act == "publish":
                ar = {"action": "publish", "set": core.now()}
            tg = None
            if act and d.get("targets") is not None:
                try:
                    tg = core.merge_targets(core.load_post(pid), d.get("targets"))
                except ValueError as e:
                    return self.fail(str(e))

            def keep_ar(q):
                q.update(after_render=ar)
                if tg:
                    core.write_targets(q, tg)
            core.update_post(pid, keep_ar)
            what = (f"{at.strftime('%d.%m.%Y %H:%M')} için planlanacak" if act == "schedule" else
                    "hemen paylaşılacak" if act == "publish" else "yapılacak işlem iptal edildi")
            core.log_activity("Video bitince " + what + (" · yalnızca YouTube" if tg and not tg["instagram"] else ""), post=pid,
                              kind="schedule")
        elif action == "schedule":
            at = core.parse_time(d.get("at"))
            if not at:
                return self.fail("tarih yok")
            if at < dt.datetime.now() - dt.timedelta(minutes=1):
                return self.fail("geçmiş bir saat seçildi")
            p = core.load_post(pid)
            if not core.ready(p):
                return self.fail("paylaşılacak dosya hazır değil")
            try:
                tg = core.merge_targets(p, d.get("targets"))
            except ValueError as e:
                return self.fail(str(e))

            def plan(q):
                q.update(status="planlandi", schedule=at.isoformat(timespec="minutes"), stage=core.planned_stage(tg), error=None,
                         after_render=None)
                core.write_targets(q, tg)
            core.update_post(pid, plan)
            core.log_activity(f"Paylaşım planlandı: {at.strftime('%d.%m.%Y %H:%M')}" + ("" if tg["instagram"] else " · yalnızca YouTube"),
                              post=pid, kind="schedule")
            if tg["instagram"]:
                cloud.post_scheduled(pid)
            else:
                cloud.post_released(pid)
            youtube.post_changed(pid)
        elif action == "targets":
            try:
                core.change_targets(pid, d)
            except ValueError as e:
                return self.fail(str(e))
        elif action == "unschedule":
            core.update_post(pid, lambda q: q.update(status="inceleme", schedule=None, stage="Plan kaldırıldı"))
            cloud.post_released(pid)
            youtube.post_changed(pid)
        elif action == "publish":
            p = core.load_post(pid)
            try:
                tg = core.merge_targets(p, d.get("targets"))
            except ValueError as e:
                return self.fail(str(e))
            problems = instagram.validate(p) if tg["instagram"] else youtube_problems(p)
            if problems:
                return self.fail(", ".join(problems))

            def take(q):
                q.update(after_render=None)
                core.write_targets(q, tg)
            core.update_post(pid, take)
            if not tg["instagram"]:
                youtube_now(pid)
            else:
                cloud.post_released(pid)
                youtube.post_changed(pid)
                do_publish(pid)
        elif action == "manual":
            if not core.ready(core.load_post(pid)):
                return self.fail("paylaşılacak dosya hazır değil")
            res = {"manual": True, "at": core.now(), "permalink": (d.get("link") or "").strip() or None}
            core.update_post(pid, lambda q: q.update(status="paylasildi", published=res, schedule=None,
                                                     stage="Elle paylaşıldı", error=None, after_render=None))
            core.log_activity("Elle paylaşıldı olarak işaretlendi", post=pid, kind="done")
            cloud.post_released(pid)
            youtube.post_changed(pid)
        elif action == "retry":
            core.update_post(pid, lambda q: q.update(status="inceleme" if core.ready(q) else "uretimde", error=None,
                                                     stage="Yeniden denenecek"))
            cloud.post_released(pid)
            youtube.post_changed(pid)
        elif action == "delete":
            core.trash_post(pid)
            cloud.post_released(pid)
            youtube.post_changed(pid)
            return self.send_json({"ok": True})
        elif action == "to-template":
            try:
                return self.send_json(produce.template_from_post(pid, d.get("name"), d.get("description") or ""))
            except ValueError as e:
                return self.fail(str(e))
        elif action == "restore":
            return self.send_json(core.summary(core.restore_post(pid)))
        elif action == "purge":
            try:
                return self.send_json({"ok": True, "freed": core.purge_post(pid)})
            except ValueError as e:
                return self.fail(str(e))
        else:
            return self.fail("bilinmeyen işlem", 404)
        return self.send_json(post_detail(core.load_post(pid)))


def _ig_get(self, sub, qs):
    fresh = "fresh" in qs
    if sub == "profile":
        return self.send_json(igaccount.safe(igaccount.profile, fresh))
    if sub == "media":
        return self.send_json(igaccount.safe(igaccount.media, qs.get("after", [None])[0], fresh))
    m = re.fullmatch(r"media/(\d+)", sub)
    if m:
        return self.send_json(igaccount.safe(igaccount.media_detail, m.group(1), fresh))
    if sub == "comments":
        return self.send_json(igaccount.safe(igaccount.recent_comments, fresh))
    if sub == "insights":
        return self.send_json(igaccount.safe(igaccount.account_insights, int(qs.get("days", ["7"])[0]), fresh))
    if sub == "top":
        return self.send_json(igaccount.safe(igaccount.top_media, fresh))
    if sub == "views":
        return self.send_json(igaccount.safe(igaccount.total_views, fresh))
    if sub == "conversations":
        return self.send_json(igaccount.safe(igaccount.conversations, fresh))
    m = re.fullmatch(r"conversations/([\w\-:=]+)", sub)
    if m:
        return self.send_json(igaccount.safe(igaccount.thread, m.group(1), fresh))
    if sub == "tags":
        return self.send_json(igaccount.safe(igaccount.tags, fresh))
    if sub == "rivals":
        return self.send_json(igaccount.safe(igaccount.rivals, fresh))
    return self.fail("yok", 404)


def _yt_get(self, sub, qs):
    fresh = "fresh" in qs
    if sub == "channel":
        return self.send_json(ytaccount.safe(ytaccount.channel, fresh))
    if sub == "videos":
        return self.send_json(ytaccount.safe(ytaccount.videos, qs.get("page", [None])[0], fresh))
    return self.fail("yok", 404)


def _ig_post(self, sub):
    d = self.json_body()
    text = (d.get("message") or d.get("text") or "").strip()
    m = re.fullmatch(r"comment/(\d+)/(reply|hide|delete)", sub)
    if m:
        cid, action = m.groups()
        if action == "reply":
            if not text:
                return self.fail("yanıt boş")
            return self.send_json(igaccount.safe(igaccount.reply_comment, cid, text))
        if action == "hide":
            return self.send_json(igaccount.safe(igaccount.hide_comment, cid, bool(d.get("hide", True))))
        return self.send_json(igaccount.safe(igaccount.delete_comment, cid))
    m = re.fullmatch(r"media/(\d+)/comment", sub)
    if m:
        if not text:
            return self.fail("yorum boş")
        return self.send_json(igaccount.safe(igaccount.comment_on, m.group(1), text))
    m = re.fullmatch(r"conversations/([\w\-:=]+)/send", sub)
    if m:
        if not text:
            return self.fail("mesaj boş")
        return self.send_json(igaccount.safe(igaccount.send_dm, m.group(1), text))
    if sub == "rivals/add":
        return self.send_json(igaccount.safe(igaccount.watch_add, d.get("username", "")))
    if sub == "rivals/remove":
        return self.send_json(igaccount.safe(igaccount.watch_remove, d.get("username", "")))
    return self.fail("yok", 404)


def _cloud_post(self, sub):
    d = self.json_body()
    try:
        if sub == "connect":
            cloud.connect(d.get("api_token"), d.get("account_id"), d.get("worker"))
        elif sub == "disconnect":
            cloud.disconnect(bool(d.get("delete_remote")))
        elif sub == "enable":
            cloud.enable(bool(d.get("on")))
        elif sub == "sync":
            if not cloud.active():
                return self.fail("bulut bağlı değil ya da kapalı")
            cloud.sync_now()
        elif sub == "redeploy":
            cloud.redeploy()
        elif sub == "panel":
            cloud.panel_set(d.get("password"))
        elif sub == "panel/new-link":
            cloud.panel_new_link()
        elif sub == "panel/off":
            cloud.panel_off()
        else:
            m = re.fullmatch(r"jobs/(\d+)/(upload|retry|cancel)", sub)
            if not m:
                return self.fail("yok", 404)
            cloud.job_action(m.group(1), m.group(2))
    except ValueError as e:
        return self.fail(str(e))
    return self.send_json(cloud.public())


def _youtube_post(self, sub):
    d = self.json_body()
    port = self.server.server_address[1]
    if sub in ("audit-kit", "audit-kit/screenshots", "audit-kit/open-folder"):
        try:
            if sub == "audit-kit":
                auditkit.save_kit(d)
            elif sub == "audit-kit/screenshots":
                auditkit.start_shots(port)
            else:
                auditkit.open_folder()
        except ValueError as e:
            return self.fail(str(e))
        return self.send_json(auditkit.view())
    try:
        if sub == "client":
            youtube.save_client(d.get("client_id"), d.get("client_secret"))
        elif sub == "auth":
            return self.send_json({"url": youtube.auth_url(port)})
        elif sub == "disconnect":
            youtube.disconnect(bool(d.get("revoke")))
        elif sub == "settings":
            youtube.update_settings(d)
        elif sub == "sync":
            if not youtube.connected():
                return self.fail("YouTube bağlı değil")
            youtube.sync_now()
        else:
            return self.fail("yok", 404)
    except ValueError as e:
        return self.fail(str(e))
    return self.send_json(youtube.public(port))


def _youtube_post_action(self, pid, action):
    if core.load_post(pid) is None:
        return self.fail("yok", 404)
    d = self.json_body()
    try:
        if action == "retry":
            youtube.retry(pid)
        elif action == "upload-now":
            youtube.upload_now(pid)
        elif action == "manual":
            youtube.mark_manual(pid, d.get("link"))
        elif action == "unmanual":
            youtube.unmark_manual(pid)
        else:
            youtube.edit_post(pid, d)
    except ValueError as e:
        return self.fail(str(e))
    return self.send_json(post_detail(core.load_post(pid)))


Handler.ig_get = _ig_get
Handler.ig_post = _ig_post
Handler.yt_get = _yt_get
Handler.cloud_post = _cloud_post
Handler.youtube_post = _youtube_post
Handler.youtube_post_action = _youtube_post_action


def _tiktok_post(self, sub):
    d = self.json_body()
    try:
        if sub == "login":
            tiktok.login()
        elif sub == "check":
            tiktok.check()
        elif sub == "settings":
            tiktok.update_settings(d)
        else:
            return self.fail("yok", 404)
    except ValueError as e:
        return self.fail(str(e))
    return self.send_json(tiktok.public())


def _tiktok_post_action(self, pid, action):
    if core.load_post(pid) is None:
        return self.fail("yok", 404)
    d = self.json_body()
    try:
        if action == "now":
            tiktok.now(pid)
        else:
            tiktok.edit_post(pid, d)
    except ValueError as e:
        return self.fail(str(e))
    return self.send_json(post_detail(core.load_post(pid)))


Handler.tiktok_post = _tiktok_post
Handler.tiktok_post_action = _tiktok_post_action


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def edge_exe():
    for exe in (shutil.which("msedge"), r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if exe and Path(exe).exists():
            return exe
    return None


def open_window(url, size="1500,940"):
    exe = edge_exe()
    if exe:
        subprocess.Popen([exe, f"--app={url}", f"--window-size={size}"])
    else:
        webbrowser.open(url)


def open_app(port):
    desktop.open_app(port)


def busy_reason():
    if any(p.get("status") == "paylasiliyor" for p in core.list_posts()):
        return "Bu oturumda şu an paylaşım sürüyor; bitince tekrar dene"
    if tiktok._run.get("busy"):
        return "Bu oturumda TikTok yüklemesi sürüyor; bitince tekrar dene"
    if any(youtube._active(pid) for pid in list(youtube._uploads)):
        return "Bu oturumda YouTube yüklemesi sürüyor; bitince tekrar dene"
    if any(g.get("status") == "calisiyor" for g in webagent.list_jobs()):
        return "Bu oturumda araştırma ajanı çalışıyor; bitince ya da iptal edince tekrar dene"
    return None


def busy_everywhere():
    why = busy_reason()
    if why or core.OTURUM:
        return why
    for e in oturum.entries()[1:]:
        if not oturum.listening(e["port"]):
            continue
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{e['port']}/api/busy", timeout=4) as r:
                why = json.loads(r.read().decode("utf-8")).get("busy")
        except (OSError, ValueError):
            continue
        if why:
            return f"{e['name']}: {why}"
    return None


def stop_server(httpd):
    time.sleep(0.3)
    httpd.shutdown()
    os._exit(0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", action="store_true")
    ap.add_argument("--port", type=int)
    ap.add_argument("--data")
    args = ap.parse_args()
    if args.data:
        core.set_data(args.data)
    port = args.port or core.settings()["port"]
    core.ensure_data()
    try:
        httpd = Server(("127.0.0.1", port), Handler)
    except OSError:
        print(f"port {port} dolu, stüdyo zaten açık olabilir")
        if args.open:
            open_app(port)
        return
    threading.Thread(target=scheduler_loop, daemon=True).start()
    threading.Thread(target=notify.loop, daemon=True).start()
    if not core.OTURUM:
        threading.Thread(target=oturum.watch, daemon=True).start()
    print(f"Sosyal Stüdyo: http://127.0.0.1:{port}  veri: {core.DATA}")
    if args.open:
        threading.Timer(0.5, open_app, args=(port,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    if sys.stdout:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
