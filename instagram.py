import json
import re
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import core

GRAPH = "https://graph.instagram.com"
GRAPH_FB = "https://graph.facebook.com"
CLOUDFLARED = core.HOME / "bin" / "cloudflared.exe"


class IgError(Exception):
    pass


def is_ig_token(token):
    return token.startswith("IG")


def _call(method, path, params=None, token=None, versioned=True, timeout=90):
    ig = core.settings()["instagram"]
    token = (token or ig["token"] or "").strip()
    if not token:
        raise IgError("Instagram erişim anahtarı girilmemiş (Ayarlar > Instagram)")
    host = GRAPH if is_ig_token(token) else GRAPH_FB
    version = ig.get("api_version") if versioned else ""
    url = f"{host}/{version}/{path}" if version else f"{host}/{path}"
    data = None
    if params and method in ("GET", "DELETE"):
        url += "?" + urllib.parse.urlencode(params)
    elif params:
        data = urllib.parse.urlencode(params).encode()
    elif method == "POST":
        data = b""
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        try:
            err = json.loads(body).get("error", {})
            msg = err.get("error_user_msg") or err.get("message") or body
        except json.JSONDecodeError:
            msg = body[:300]
        raise IgError(f"Instagram hatası {e.code}: {msg}") from None
    except urllib.error.URLError as e:
        raise IgError(f"Instagram'a bağlanılamadı: {e.reason}") from None


def check_shape(token):
    if len(token) < 60 or any(c.isspace() for c in token) or not token.isascii():
        raise IgError(f"Yapıştırılan metin bir erişim anahtarına benzemiyor ({len(token)} karakter, '{token[:4]}…' ile başlıyor). "
                      "Anahtar boşluksuz tek satırdır, genelde 150+ karakterdir ve EAA ya da IGAA ile başlar. "
                      "Meta'daki anahtarın yanındaki kopyala düğmesini kullanıp tekrar yapıştır.")


def test(token=None):
    token = (token or core.settings()["instagram"]["token"] or "").strip()
    check_shape(token)
    if is_ig_token(token):
        me = _call("GET", "me", {"fields": "user_id,username,account_type,profile_picture_url"}, token=token)
        return {"user_id": str(me.get("user_id") or me.get("id")), "username": me.get("username"),
                "account_type": me.get("account_type"), "picture": me.get("profile_picture_url")}
    pages = _call("GET", "me/accounts", {"fields": "instagram_business_account{id,username,profile_picture_url}"}, token=token)
    for page in pages.get("data", []):
        acc = page.get("instagram_business_account")
        if acc:
            return {"user_id": acc["id"], "username": acc.get("username"), "account_type": "BUSINESS",
                    "picture": acc.get("profile_picture_url")}
    known = core.settings()["instagram"].get("user_id")
    if known:
        acc = _call("GET", known, {"fields": "id,username,profile_picture_url"}, token=token)
        return {"user_id": acc["id"], "username": acc.get("username"), "account_type": "BUSINESS",
                "picture": acc.get("profile_picture_url")}
    raise IgError("Bu anahtarla bağlı bir Instagram işletme hesabı bulunamadı")


def permissions():
    token = (core.settings()["instagram"].get("token") or "").strip()
    if not token or is_ig_token(token):
        return None
    r = _call("GET", "me/permissions", {})
    return sorted(p["permission"] for p in r.get("data", []) if p.get("status") == "granted")


def refresh_token():
    ig = core.settings()["instagram"]
    if not is_ig_token(ig["token"]):
        return
    url = f"{GRAPH}/refresh_access_token?" + urllib.parse.urlencode({"grant_type": "ig_refresh_token", "access_token": ig["token"]})
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise IgError(f"anahtar yenilenemedi ({e.code})") from None
    core.save_settings({"instagram": {"token": data["access_token"], "token_refreshed": core.now()}})


def ensure_cloudflared(log=print):
    if CLOUDFLARED.exists():
        return
    log("Paylaşım aracı (cloudflared) indiriliyor")
    CLOUDFLARED.parent.mkdir(parents=True, exist_ok=True)
    url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    tmp = CLOUDFLARED.with_suffix(".part")
    with urllib.request.urlopen(url, timeout=300) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    tmp.replace(CLOUDFLARED)


MIME = {".mp4": "video/mp4", ".mov": "video/quicktime", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}


class _FileHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_HEAD(self):
        self.serve(False)

    def do_GET(self):
        self.serve(True)

    def serve(self, body):
        file = self.server.routes.get(self.path.split("?")[0])
        if not file:
            self.send_response(404)
            self.end_headers()
            return
        size = file.stat().st_size
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m:
            start = int(m.group(1) or 0)
            end = int(m.group(2)) if m.group(2) else size - 1
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", MIME.get(file.suffix.lower(), "application/octet-stream"))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        if not body:
            return
        with open(file, "rb") as f:
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


class Tunnel:
    """Exposes the given files through a temporary Cloudflare quick tunnel while publishing."""

    def __init__(self, files, log=print):
        self.files = [Path(f) for f in (files if isinstance(files, (list, tuple)) else [files])]
        self.log = log

    def __enter__(self):
        ensure_cloudflared(self.log)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _FileHandler)
        secret = secrets.token_urlsafe(24)
        paths = [f"/{secret}/{i}{f.suffix.lower()}" for i, f in enumerate(self.files)]
        self.httpd.routes = dict(zip(paths, self.files))
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        port = self.httpd.server_address[1]
        self.proc = subprocess.Popen([str(CLOUDFLARED), "tunnel", "--url", f"http://127.0.0.1:{port}", "--no-autoupdate"],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
                                     creationflags=subprocess.CREATE_NO_WINDOW)
        base = None
        found = threading.Event()

        def read():
            nonlocal base
            for line in self.proc.stderr:
                m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
                if m and not base:
                    base = m.group(0)
                    found.set()
        threading.Thread(target=read, daemon=True).start()
        if not found.wait(60):
            self.__exit__(None, None, None)
            raise IgError("geçici paylaşım bağlantısı açılamadı (cloudflared)")
        self.urls = [base + path for path in paths]
        for _ in range(45):
            try:
                req = urllib.request.Request(self.urls[0], method="HEAD")
                with urllib.request.urlopen(req, timeout=10) as r:
                    if r.status in (200, 206):
                        return self.urls
            except Exception:  # noqa: BLE001
                time.sleep(2)
        self.__exit__(None, None, None)
        raise IgError("geçici paylaşım bağlantısına dışarıdan ulaşılamadı")

    def __exit__(self, *exc):
        try:
            self.proc.terminate()
        except Exception:  # noqa: BLE001
            pass
        try:
            self.httpd.shutdown()
        except Exception:  # noqa: BLE001
            pass


KIND_NAMES = {"reels": "Reels", "image": "fotoğraf", "carousel": "kaydırmalı gönderi", "story": "hikâye"}
VIDEO_EXT = (".mp4", ".mov")


def full_caption(post):
    text = (post.get("caption") or "").strip()
    tags = (post.get("hashtags") or "").strip()
    return f"{text}\n\n{tags}".strip() if tags else text


def media_files(post):
    pdir = core.post_dir(post["id"])
    if post.get("media"):
        return [pdir / m for m in post["media"]]
    return [pdir / post["video"]] if post.get("video") else []


def validate(post):
    problems = []
    kind = post.get("kind") or "reels"
    files = media_files(post)
    if not files:
        problems.append("video hazır değil" if kind == "reels" else "görsel yok")
    if kind == "carousel" and not 2 <= len(files) <= 10:
        problems.append("kaydırmalı gönderi 2-10 parça olmalı")
    cap = full_caption(post)
    if not cap and kind != "story":
        problems.append("açıklama boş")
    if len(cap) > 2200:
        problems.append(f"açıklama {len(cap)} karakter (en fazla 2200)")
    if len(re.findall(r"#\w+", cap)) > 30:
        problems.append("30'dan fazla hashtag")
    ig = core.settings()["instagram"]
    if not ig.get("token") or not ig.get("user_id"):
        problems.append("Instagram bağlı değil")
    return problems


def wait_ready(cid, log, label):
    for i in range(90):
        st = _call("GET", cid, {"fields": "status_code,status"})
        code = st.get("status_code")
        if code in ("FINISHED", "PUBLISHED") or code is None:
            return
        if code in ("ERROR", "EXPIRED"):
            raise IgError(f"Instagram {label} işleyemedi: {st.get('status') or code}")
        log(f"Instagram {label} işliyor ({i * 10} sn)")
        time.sleep(10)
    raise IgError("Instagram işleme süresi aşıldı")


def publish(post, log=print, publish_at=None):
    problems = validate(post)
    if problems:
        raise IgError(", ".join(problems))
    ig = core.settings()["instagram"]
    uid = ig["user_id"]
    kind = post.get("kind") or "reels"
    files = media_files(post)
    log("Geçici bağlantı açılıyor")
    with Tunnel(files, log) as urls:
        log(f"Instagram'a gönderiliyor ({KIND_NAMES.get(kind, kind)})")
        is_video = [f.suffix.lower() in VIDEO_EXT for f in files]
        if kind == "carousel":
            children = []
            for url, vid in zip(urls, is_video):
                params = {"is_carousel_item": "true", **({"media_type": "VIDEO", "video_url": url} if vid else {"image_url": url})}
                child = _call("POST", f"{uid}/media", params)["id"]
                if vid:
                    wait_ready(child, log, "videoyu")
                children.append(child)
            cid = _call("POST", f"{uid}/media", {"media_type": "CAROUSEL", "children": ",".join(children),
                                                 "caption": full_caption(post)})["id"]
        elif kind == "story":
            params = {"media_type": "STORIES", **({"video_url": urls[0]} if is_video[0] else {"image_url": urls[0]})}
            cid = _call("POST", f"{uid}/media", params)["id"]
        elif kind == "image":
            cid = _call("POST", f"{uid}/media", {"image_url": urls[0], "caption": full_caption(post)})["id"]
        else:
            params = {"media_type": "REELS", "video_url": urls[0], "caption": full_caption(post), "share_to_feed": "true"}
            if post.get("thumb_offset"):
                params["thumb_offset"] = str(int(post["thumb_offset"]))
            cid = _call("POST", f"{uid}/media", params)["id"]
        wait_ready(cid, log, "paylaşımı")
        while publish_at and core.parse_time(core.now()) < publish_at:
            log(f"Hazır, {publish_at.strftime('%H:%M')} bekleniyor")
            time.sleep(min(15, max(1, (publish_at - core.parse_time(core.now())).total_seconds())))
        log("Yayınlanıyor")
        mid = _call("POST", f"{uid}/media_publish", {"creation_id": cid})["id"]
    info = {}
    try:
        info = _call("GET", mid, {"fields": "permalink,timestamp"})
    except IgError:
        pass
    return {"id": mid, "permalink": info.get("permalink"), "at": core.now(), "kind": kind}
