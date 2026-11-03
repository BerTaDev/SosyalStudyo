import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import cloud
import core
import youtube

APP_NAME = "Sosyal Stüdyo"
FORM_URL = "https://support.google.com/youtube/contact/yt_api_form"
SHOT_DIR = "denetim_kiti"
SHOT_W = 1366
PAGE_H = 9000
STUDIO_H = 900
POST_H = 1800
MIN_H = 768
SHOT_TIMEOUT = 90
BUDGET_MS = 8000
EMAIL_RE = re.compile(r"^[^\s@<>\"'()\[\],;:\\]+@[^\s@<>\"'()\[\],;:\\]+\.[^\s@<>\"'()\[\],;:\\]{2,}$")
URL_RE = re.compile(r"^https://[^\s<>\"'`]+$")
SITE_FIELDS = ("owner_name", "email", "app_name", "channel_url", "instagram_url")
SHOTS = (
    ("home", "1-ana-sayfa.png", "Ana sayfa", "Homepage Screenshot"),
    ("privacy", "2-gizlilik.png", "Gizlilik politikası (tam sayfa)", "Privacy Policy Screenshots"),
    ("terms", "3-sartlar.png", "Kullanım şartları (tam sayfa)", "Terms of Service Documentation"),
    ("studio", "4-studyo-youtube-ayarlari.png", "Stüdyo · YouTube ayarları", "Additional evidence"),
    ("post", "5-studyo-paylasim-karti.png", "Stüdyo · paylaşımın YouTube kartı", "Additional evidence"),
)
BROWSERS = (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"))
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_lock = threading.Lock()
_site_lock = threading.Lock()
_shots = {"running": False, "done": False, "error": None, "files": [], "skipped": [], "current": None, "started": None, "finished": None}
_open = getattr(os, "startfile", None)


# ---------- site (legal pages on the user's own cloud worker) ----------

def site_settings():
    s = core.settings().get("site")
    return dict(s) if isinstance(s, dict) else {}


def _content(s):
    return {"owner_name": s.get("owner_name") or "", "email": s.get("email") or "", "app_name": s.get("app_name") or APP_NAME,
            "channel_url": s.get("channel_url") or "", "instagram_url": s.get("instagram_url") or ""}


def site_urls(c=None):
    c = c or cloud.conf()
    if not cloud.configured(c):
        return None
    base = c["url"].rstrip("/")
    host = urllib.parse.urlparse(base).hostname or ""
    labels = host.split(".")
    domain = ".".join(labels[-3:]) if host.endswith(".workers.dev") and len(labels) > 3 else host
    return {"home": base + "/", "privacy": base + "/privacy", "terms": base + "/terms", "home_tr": base + "/tr",
            "privacy_tr": base + "/tr/privacy", "terms_tr": base + "/tr/terms", "domain": domain, "host": host}


def channel():
    ch = youtube.conf().get("channel") if youtube.connected() else None
    if not ch:
        return None
    handle = ch.get("handle") or ""
    url = f"https://www.youtube.com/{handle}" if handle.startswith("@") else f"https://www.youtube.com/channel/{ch.get('id')}"
    return {"title": ch.get("title"), "url": url}


def _instagram_url():
    name = (core.settings()["instagram"].get("username") or "").strip().lstrip("@")
    return f"https://www.instagram.com/{name}/" if re.fullmatch(r"[\w.]{1,30}", name) else ""


def site_view():
    c = cloud.conf()
    s = site_settings()
    deployed = cloud._worker_version(c) if cloud.configured(c) else 0
    ch = channel()
    live = bool(s.get("published") and s.get("pushed_at") and cloud.configured(c))
    return {"configured": live, "published": bool(s.get("published")), "pushed_at": s.get("pushed_at") if live else None,
            "connected": cloud.configured(c), "supported": cloud.configured(c) and deployed >= cloud.SITE_VERSION,
            "version": deployed or None, "urls": site_urls(c), "push_error": s.get("push_error"), "updated": s.get("updated"),
            **_content(s), "suggest": {"owner_name": core.settings().get("display_name") or (ch or {}).get("title") or "",
                                        "channel_url": (ch or {}).get("url") or "", "instagram_url": _instagram_url()}}


def _clean(v, n):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n + 1]


def _check_site(d, cur):
    out = _content(cur)
    for k in SITE_FIELDS:
        if k in d:
            out[k] = _clean(d[k], 300)
    if not cur.get("channel_url") and "channel_url" not in d:
        out["channel_url"] = (channel() or {}).get("url") or ""
    if not cur.get("instagram_url") and "instagram_url" not in d:
        out["instagram_url"] = _instagram_url()
    out["app_name"] = out["app_name"] or APP_NAME
    if len(out["owner_name"]) < 2:
        raise ValueError("Ad soyad (ya da marka adı) yaz")
    if len(out["owner_name"]) > 100:
        raise ValueError("Ad soyad en fazla 100 karakter olabilir")
    if len(out["email"]) > 254 or not EMAIL_RE.match(out["email"]):
        raise ValueError("Geçerli bir e-posta adresi yaz")
    if len(out["app_name"]) > 60:
        raise ValueError("Uygulama adı en fazla 60 karakter olabilir")
    if "youtube" in out["app_name"].lower():
        raise ValueError("Uygulama adında 'YouTube' geçmemeli (Google kuralı)")
    for k, label in (("channel_url", "YouTube kanalı"), ("instagram_url", "Instagram")):
        if out[k] and (len(out[k]) > 300 or not URL_RE.match(out[k])):
            raise ValueError(f"{label} adresi https:// ile başlayan geçerli bir bağlantı olmalı")
    return out


def _site_ready(c):
    if not cloud.configured(c):
        raise ValueError("Önce Bulut yayın sekmesinden Cloudflare'i bağla; sayfalar senin bulut servisinde yayınlanır")
    if int(c["version"] or 0) < cloud.SITE_VERSION and cloud._worker_version(c) < cloud.SITE_VERSION:
        raise ValueError("Bulut servisin bu sayfaları henüz desteklemiyor; Bulut yayın sekmesinden servisi güncelle")


def save_site(d):
    with _site_lock:
        cur = site_settings()
        content = _check_site(d or {}, cur)
        same = content == _content(cur) and cur.get("updated")
        patch = {**content, "updated": cur["updated"] if same else core.now()}
        core.save_settings({"site": patch})
        c = cloud.conf()
        _site_ready(c)
        try:
            cloud.push_site(c, {**cur, **patch})
        except cloud.CloudError as e:
            core.save_settings({"site": {"push_error": str(e)}})
            if e.status == 404:
                raise ValueError("Bulut servisin bu sayfaları henüz desteklemiyor; Bulut yayın sekmesinden servisi güncelle") from None
            raise ValueError(f"Sayfalar yayınlanamadı: {e}") from None
        core.save_settings({"site": {"published": True}})
    if not cur.get("published"):
        cloud.event("Yasal sayfalar (ana sayfa, gizlilik, şartlar) bulutta yayınlandı", "site")
    return site_view()


def site_off():
    with _site_lock:
        c = cloud.conf()
        if cloud.configured(c):
            try:
                cloud.wapi("DELETE", "/api/site", c=c, timeout=30)
            except cloud.CloudError as e:
                if e.status != 404:
                    raise ValueError(f"Buluttaki sayfalar kaldırılamadı: {e}") from None
        was = site_settings().get("published")
        core.save_settings({"site": {"published": False, "pushed_at": None, "push_error": None}})
    if was:
        cloud.event("Yasal sayfalar buluttan kaldırıldı", "site")
    return site_view()


# ---------- audit kit ----------

def kit_settings():
    k = core.settings().get("audit_kit")
    return dict(k) if isinstance(k, dict) else {}


def save_kit(d):
    patch = {}
    if "project_number" in d:
        raw = str(d.get("project_number") or "").strip()
        num = re.sub(r"[\s-]", "", raw)
        if num and not num.isdigit():
            raise ValueError("Proje numarası yalnızca rakamlardan oluşur (proje kimliği değil; Cloud Console'da 'Proje numarası')")
        if num and not 6 <= len(num) <= 20:
            raise ValueError("Proje numarası 6 ile 20 rakam arasında olmalı")
        patch["project_number"] = num
    cur = kit_settings().get("submitted_at")
    if "submitted" in d:
        patch["submitted_at"] = (cur or core.now()) if d.get("submitted") else None
    if patch:
        core.save_settings({"audit_kit": patch})
    if "submitted_at" in patch and bool(patch["submitted_at"]) != bool(cur):
        youtube.event("YouTube denetim başvurusu gönderildi olarak işaretlendi" if patch["submitted_at"]
                      else "YouTube denetim başvurusu işareti kaldırıldı", "info")


def client_name(s=None):
    name = _content(s if s is not None else site_settings())["app_name"]
    name = re.sub(r"\s+", " ", re.sub(r"(?i)you\s*tube", "", name)).strip(" -·")
    return name or APP_NAME


def _description(app, ch_url, urls):
    chan = f" ({ch_url})" if ch_url else ""
    legal = f" Privacy policy: {urls['privacy']}. Terms of service: {urls['terms']}." if urls else ""
    return (f"I am an independent content creator. I run {app}, a self-hosted, open-source desktop application, on my own Windows "
            f"computer to prepare my own short vertical videos and publish them to my own YouTube channel{chan} as YouTube Shorts at "
            "planned times. The application uses the YouTube Data API v3 only for my own channel: channels.list to show which "
            "channel is connected; videos.insert to upload my videos (private, or scheduled with publishAt); videos.update to change "
            "the title, description, privacy status or scheduled time of videos it uploaded; videos.delete to remove an uploaded "
            "video when I cancel a post; and videos.list to check upload and processing status. I am the only user: there is no "
            "public sign-up, no other users and no data collection from viewers. No data is sold or shared, no ads are shown, and "
            f"the OAuth tokens are stored only on my computer.{legal}")


def answers(s=None, kit=None):
    s = s if s is not None else site_settings()
    kit = kit if kit is not None else kit_settings()
    content = _content(s)
    urls = site_urls() if s.get("published") else None
    name, email = content["owner_name"], content["email"]
    ch = channel()
    ch_url = content["channel_url"] or (ch or {}).get("url") or ""
    app = client_name(s)
    quota = max(10000, int(youtube.conf().get("quota_limit") or 10000))
    home = urls["home"] if urls else ""
    no_site = "Önce 1. adımda sayfaları yayınla; bağlantı burada çıkar."
    rows = []

    def add(section, field, value, note, kind="text", manual=False, file=None):
        rows.append({"section": section, "field": field, "value": value, "note": note, "kind": kind,
                     "manual": bool(manual or (kind in ("text", "choice") and not value)), "file": file})

    s1, s2, s3, s4, s5, s6, s7 = ("1. Request type", "2. Organization information", "3. Business model", "4. API client",
                                  "5. Use cases", "6. Additional evidence", "7. Attestations")
    add(s1, "Request type", "Complete a compliance audit to request for additional quota", "İlk denetim için uygun seçenek bu; onu işaretle.", "choice")
    add(s2, "Applying as", "As an individual user", "Şirket değil, bireysel başvuru.", "choice")
    add(s2, "Full Legal Name", name, "Kimliğindeki tam adın. Marka adı yazdıysan burada kendi adınla düzelt.")
    add(s2, "Organization's Legal Name", name, "Bireysel başvuruda kurum adı yerine kendi adını yaz.")
    add(s2, "Parent company", "", "Boş bırak.", "skip")
    add(s2, "Organization's Primary Website", home, "Yayınladığın ana sayfa." if home else no_site)
    add(s2, "Country", "", "Ülkeni listeden seç.", "manual", True)
    add(s2, "Street Address", "", "Açık adresin (sokak, numara). Google yalnızca doğrulama için kullanır.", "manual", True)
    add(s2, "City", "", "Şehir.", "manual", True)
    add(s2, "State/Province", "", "İl ya da eyalet.", "manual", True)
    add(s2, "Postal Code", "", "Posta kodu.", "manual", True)
    add(s2, "Category", "", "Listeden içerik üretimi ya da medya/yayıncılığa en yakın seçeneği seç.", "manual", True)
    add(s2, "Organization Size/Type", "Independent Developer/Sole Proprietor", "Bağımsız geliştirici / şahıs.", "choice")
    add(s2, "Primary Contact Name", name, "Ana iletişim kişisi sensin.")
    add(s2, "Primary Contact Email", email, "Google'ın yanıtı bu adrese gelir.")
    add(s2, "Technical Contact", "Same as primary contact", "Ana kişiyle aynı.", "choice")
    add(s2, "Business Contact", "Same as primary contact", "Ana kişiyle aynı.", "choice")
    add(s3, "Describe your organization's work as it relates to YouTube", _description(app, ch_url, urls),
        "YouTube'u nasıl kullandığını anlatan hazır metin; olduğu gibi yapıştır.")
    add(s3, "Target audience", "Individual Content Creators; Internal Users",
        "Bu iki kutuyu işaretle: aracı yalnızca sen, kendi kanalın için kullanıyorsun.", "check")
    add(s3, "Monetization", "Free service (we do not charge users)", "Kimseden ücret alınmıyor.", "choice")
    add(s3, "Do you have a Google or YouTube representative?", "No, I do not have a Google representative", "Google temsilcin yok.", "choice")
    add(s3, "How did you learn about this form?", "YouTube Data API documentation", "Listede varsa belgeler (documentation) seçeneğini seç.", "choice")
    add(s4, "API Client Name", app, "Uygulamanın adı; içinde 'YouTube' geçmemeli.")
    add(s4, "Does the API Client name contain the word \"YouTube\"?", "No", "Adda YouTube geçmiyor.", "choice")
    add(s4, "Primary Access URL", home, "Masaüstü uygulaması olduğu için herkese açık ana sayfanı yaz." if home else no_site)
    add(s4, "Privacy Policy URL", urls["privacy"] if urls else "", "Gizlilik politikası bağlantın." if urls else no_site)
    add(s4, "Terms of Service URL", urls["terms"] if urls else "", "İsteğe bağlı ama doldur." if urls else no_site)
    add(s4, "Is the API Client publicly accessible?", "No", "Yalnızca sen kullanıyorsun; herkese açık değil.", "choice")
    add(s4, "Demo account / test credentials", "Not applicable: a desktop tool used only by its operator; see Special Instructions for Access.",
        "Demo hesap yok; açıklaması bir alttaki alanda.")
    add(s4, "Special Instructions for Access",
        f"{app} is a desktop application that runs only on my own Windows computer and is opened at http://127.0.0.1 (localhost). It has "
        "no public web interface, no sign-up and no demo account. I am its only user and connect my own YouTube channel with Google "
        f"OAuth 2.0.{f' The public pages (home, privacy policy, terms of service) are at {home}.' if home else ''} Screenshots of the "
        "app's YouTube settings and of its YouTube publishing card are attached as additional evidence.",
        "Neden demo hesap veremediğini açıklayan hazır metin.")
    add(s4, "Acknowledgment", "Tick the acknowledgment box", "Kutuyu işaretle.", "check")
    add(s5, "Number of project numbers", "1", "Tek Google Cloud projesi.")
    add(s5, "Google Cloud Project Number", kit.get("project_number") or "",
        "Cloud Console > proje panosu > 'Proje bilgisi' kartındaki Proje numarası (yalnızca rakam, proje kimliği değil).")
    add(s5, "Use case categories", "Video Uploading & Account Management", "Bu kategoriyi işaretle.", "check")
    add(s5, "Does your API Client use OAuth 2.0?", "Yes", "Google ile giriş (OAuth 2.0) kullanılıyor.", "choice")
    add(s5, "Expected API Usage Volume",
        f"Up to {quota:,} quota units per day: about 1-5 video uploads per day (videos.insert, 1,600 units each) plus a few "
        "status checks and metadata updates (videos.list, videos.update, channels.list).", "Günlük beklenen kullanım; olduğu gibi yapıştır.")
    add(s5, "Privacy Policy Screenshots", "2-gizlilik.png", "Tam sayfa gizlilik politikası görüntüsünü yükle.", "upload", file="2-gizlilik.png")
    add(s5, "Homepage Screenshot", "1-ana-sayfa.png", "Gizlilik bağlantısı ve YouTube logosu görünen ana sayfa görüntüsünü yükle.", "upload",
        file="1-ana-sayfa.png")
    add(s5, "Terms of Service Documentation", "3-sartlar.png", "Kullanım şartları görüntüsünü yükle.", "upload", file="3-sartlar.png")
    add(s5, "API endpoints used", "videos.insert, videos.update, videos.delete, videos.list, channels.list",
        "Bu beş kutuyu işaretle; uygulama başka bir uç kullanmıyor.", "check")
    add(s6, "Additional evidence (1)", "4-studyo-youtube-ayarlari.png", "Stüdyonun YouTube ayarları görüntüsünü yükle.", "upload",
        file="4-studyo-youtube-ayarlari.png")
    add(s6, "Additional evidence (2)", "5-studyo-paylasim-karti.png", "Paylaşımın YouTube kartı görüntüsünü yükle.", "upload",
        file="5-studyo-paylasim-karti.png")
    add(s6, "Additional information",
        "Screenshot 4 shows the app's YouTube connection settings (connected channel, upload options, quota). Screenshot 5 shows the "
        "YouTube card of a post, where a video is scheduled for upload to the operator's own channel.", "Görüntüleri açıklayan kısa metin.")
    add(s7, "Attestations", "", "Her maddeyi kendin oku ve işaretle, sonra Gönder'e kendin bas.", "manual", True)
    return rows


def shot_dir():
    return core.DATA / SHOT_DIR


def evidence():
    d = shot_dir()
    out = []
    for key, name, label, field in SHOTS:
        f = d / name
        ok = f.is_file()
        out.append({"key": key, "label": label, "file": name, "field": field, "ready": ok, "path": str(f),
                    "url": f"/api/youtube/audit-kit/shots/{name}?v={int(f.stat().st_mtime)}" if ok else None,
                    "size": f.stat().st_size if ok else None})
    return out


def shots_state():
    with _lock:
        return {k: (list(v) if isinstance(v, list) else v) for k, v in _shots.items()}


def view():
    s = site_settings()
    kit = kit_settings()
    yc = youtube.conf()
    return {"site": site_view(), "project_number": kit.get("project_number") or "", "channel": channel(), "client_name": client_name(s),
            "answers": answers(s, kit), "evidence": evidence(), "shots": shots_state(), "submitted_at": kit.get("submitted_at"),
            "audited": bool(yc.get("audited")), "folder": str(shot_dir()), "form_url": FORM_URL, "browser": bool(browser())}


# ---------- screenshots ----------

def browser():
    for exe in BROWSERS:
        if exe and Path(exe).is_file():
            return exe
    return None


def _pick_post():
    posts = [p for p in core.list_posts() if (p.get("kind") or "reels") == "reels"]
    for test in (lambda p: (p.get("youtube") or {}).get("video_id"), lambda p: p.get("video"), lambda p: True):
        hits = [p for p in posts if test(p)]
        if hits:
            return max(hits, key=lambda p: p.get("updated") or p.get("created") or "")["id"]
    return None


def _kill(pid):
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW)


def _rmtree(path):
    for _ in range(10):
        shutil.rmtree(path, ignore_errors=True)
        if not path.exists():
            return
        time.sleep(0.3)


def _finish_png(src, out, trim, left=0):
    from PIL import Image, ImageChops
    with Image.open(src) as im:
        im = im.convert("RGB")
    lo, hi = im.convert("L").getextrema()
    if hi - lo < 16:
        raise ValueError("görüntü boş çıktı")
    if trim:
        bg = im.getpixel((im.width - 1, im.height - 1))
        area = im.crop((left, 0, im.width, im.height))
        box = ImageChops.difference(area, Image.new("RGB", area.size, bg)).convert("L").point(lambda v: 255 if v > 10 else 0).getbbox()
        h = min(im.height, max(MIN_H if not left else STUDIO_H, (box[3] if box else 0) + 40))
        im = im.crop((0, 0, im.width, h))
    tmp = out.with_name(out.stem + ".tmp.png")
    im.save(tmp, "PNG", optimize=True)
    os.replace(tmp, out)


def capture(exe, url, out, height, trim=False, left=0):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix="sosyal-shot-"))
    raw = profile / "shot.png"
    cmd = [exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check",
           "--disable-extensions", "--disable-sync", "--disable-background-networking", "--disable-component-update",
           "--force-device-scale-factor=1", f"--user-data-dir={profile / 'p'}", f"--window-size={SHOT_W},{height}",
           f"--virtual-time-budget={BUDGET_MS}", f"--screenshot={raw}", url]
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW)
        try:
            p.wait(timeout=SHOT_TIMEOUT)
        except subprocess.TimeoutExpired:
            _kill(p.pid)
            raise ValueError("tarayıcı zamanında yanıt vermedi") from None
        if not raw.is_file() or raw.stat().st_size < 1000:
            raise ValueError("tarayıcı görüntü üretmedi")
        _finish_png(raw, out, trim, left)
    finally:
        _rmtree(profile)


def _status(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": cloud.UA}), timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError):
        return None


def _set(**kw):
    with _lock:
        _shots.update(kw)


def _run(port, exe):
    files, skipped, errors = [], [], []
    try:
        d = shot_dir()
        s = site_settings()
        urls = site_urls() if s.get("published") else None
        studio = f"http://127.0.0.1:{port}/"
        pid = _pick_post()
        plan = {"home": (urls or {}).get("home"), "privacy": (urls or {}).get("privacy"), "terms": (urls or {}).get("terms"),
                "studio": studio + "#ayarlar/youtube", "post": studio + f"#{pid}" if pid else None}
        for key, name, label, _ in SHOTS:
            url = plan[key]
            _set(current=label)
            if not url:
                skipped.append({"file": name, "reason": "Sayfalar yayında değil; önce 1. adımı tamamla" if key in ("home", "privacy", "terms")
                                else "Görüntülenecek Reels paylaşımı yok"})
                continue
            if key in ("home", "privacy", "terms"):
                code = _status(url)
                if code != 200:
                    skipped.append({"file": name, "reason": f"Sayfa açılmadı ({f'HTTP {code}' if code else 'bağlantı yok'})"})
                    continue
            try:
                if key in ("home", "privacy", "terms"):
                    capture(exe, url, d / name, PAGE_H, trim=True)
                elif key == "post":
                    capture(exe, url, d / name, POST_H, trim=True, left=SHOT_W // 4)
                else:
                    capture(exe, url, d / name, STUDIO_H)
                files.append(name)
                _set(files=list(files), skipped=list(skipped))
            except Exception as e:  # noqa: BLE001
                if not isinstance(e, ValueError):
                    traceback.print_exc()
                errors.append(f"{name}: {e}")
                skipped.append({"file": name, "reason": f"Alınamadı: {e}"})
        error = None
        if errors:
            error = f"{len(errors)} görüntü alınamadı ({'; '.join(errors)}). Eksikleri elle alabilirsin."
        if files:
            youtube.event(f"Denetim kiti: {len(files)} ekran görüntüsü hazırlandı", "info")
        _set(running=False, done=True, error=error, files=files, skipped=skipped, current=None, finished=core.now())
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        _set(running=False, done=True, error=f"Ekran görüntüleri hazırlanamadı: {e}", files=files, skipped=skipped, current=None,
             finished=core.now())


def start_shots(port):
    exe = browser()
    if not exe:
        raise ValueError("Bilgisayarda Microsoft Edge ya da Google Chrome bulunamadı. Ekran görüntülerini elle al.")
    with _lock:
        if _shots["running"]:
            return
        _shots.update(running=True, done=False, error=None, files=[], skipped=[], current=None, started=core.now(), finished=None)
    threading.Thread(target=_run, args=(port, exe), daemon=True).start()


def open_folder():
    d = shot_dir()
    d.mkdir(parents=True, exist_ok=True)
    if not _open:
        raise ValueError(f"Klasör açılamadı; elle aç: {d}")
    _open(str(d))
