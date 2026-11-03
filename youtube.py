import base64
import collections
import datetime as dt
import hashlib
import hmac
import html
import http.client
import json
import os
import re
import secrets
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

import cloud
import core
import instagram

try:
    from zoneinfo import ZoneInfo
    PACIFIC = ZoneInfo("America/Los_Angeles")
except Exception:  # noqa: BLE001
    PACIFIC = None

API_BASE = os.environ.get("YOUTUBE_API_BASE", "https://www.googleapis.com/youtube/v3").rstrip("/")
UPLOAD_BASE = os.environ.get("YOUTUBE_UPLOAD_BASE", "https://www.googleapis.com").rstrip("/")
OAUTH_BASE = os.environ.get("GOOGLE_OAUTH_BASE", "https://oauth2.googleapis.com").rstrip("/")
AUTH_URL = os.environ.get("GOOGLE_AUTH_URL", "https://accounts.google.com/o/oauth2/v2/auth")
SCOPE = "https://www.googleapis.com/auth/youtube"
UA = "SosyalStudyo/1.0"
CHUNK = 8 << 20
COST_INSERT = 100
COST_UPDATE = 50
COST_DELETE = 50
COST_LIST = 1
RESERVE = 200
SYNC_EVERY = 60
POLL_EVERY = 600
POLL_DUE = 120
LOCK_AFTER = 900
FRESH_PUBLISH = 1800
HOLD_LEAD = 900
OAUTH_TTL = 900
SESSION_TTL = 6 * 86400
MAX_ATTEMPTS = 3
MAX_FAILS = 6
RETRY_WAIT = 120
UPLOAD_TIMEOUT = 120
DEFAULTS = {"client_id": "", "client_secret": "", "refresh_token": "", "access_token": "", "token_expires": 0, "channel": None,
            "connected_at": "", "audited": False, "auto": False, "category": "22", "synthetic": False, "quota_limit": 10000,
            "quota_insert": COST_INSERT, "upload_ahead_hours": 168}
SECRETS = ("client_secret", "refresh_token", "access_token", "token_expires")
USER_KEYS = ("enabled", "title", "description")
ACTIVE = ("queued", "upload", "retry", "finalize")
FINAL = ("published", "private_locked")
QUOTA_REASONS = ("quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded")
RECONNECT_REASONS = ("invalid_grant", "unauthorized_client", "invalid_client", "reconnect")

_lock = threading.RLock()
_sync_lock = threading.Lock()
_tok_lock = threading.Lock()
_pump_lock = threading.Lock()
_pid_locks = collections.defaultdict(threading.RLock)
_uploads = {}
_retry_at = {}
_store = None
_last_tick = 0.0
_pump_again = False
_sync_again = False
_view_cache = [0.0, None]


class YtError(Exception):
    def __init__(self, msg, status=None, reason=None):
        super().__init__(msg)
        self.status = status
        self.reason = reason

    @property
    def reconnect(self):
        return self.reason in RECONNECT_REASONS

    @property
    def quota(self):
        return self.reason in QUOTA_REASONS

    @property
    def transient(self):
        return self.status is None or self.status >= 500 or self.status in (408, 429)


class _Expired(Exception):
    pass


# ---------- settings / store ----------

def conf():
    return {**DEFAULTS, **(core.settings().get("youtube") or {})}


def _view_conf():
    if time.time() - _view_cache[0] > 1.5 or _view_cache[1] is None:
        _view_cache[:] = [time.time(), conf()]
    return _view_cache[1]


def save(patch):
    core.save_settings({"youtube": patch})
    _view_cache[0] = 0.0


def configured(c=None):
    c = c or conf()
    return bool(c.get("client_id") and c.get("client_secret"))


def connected(c=None):
    c = c or conf()
    return bool(c.get("refresh_token") and c.get("channel"))


def redirect_uri(port):
    if core.OTURUM:
        import oturum
        port = oturum.home_port()
    return f"http://127.0.0.1:{port}/oauth/youtube"


def _load():
    global _store
    if _store is None:
        _store = core.read_json(core.DATA / "youtube.json", None) or {}
        for k, v in (("events", []), ("quota", {}), ("oauth", None), ("sessions", {}), ("checked", {}),
                     ("needs_reconnect", False), ("last_sync", None)):
            _store.setdefault(k, v)
    return _store


def _persist():
    with _lock:
        core.write_json(core.DATA / "youtube.json", _load())


def event(text, kind="info"):
    with _lock:
        s = _load()
        s["events"] = (s["events"] + [{"at": core.now(), "text": text, "kind": kind}])[-50:]
        _persist()


def needs_reconnect():
    return bool(_load().get("needs_reconnect"))


def _set_reconnect(on):
    with _lock:
        s = _load()
        was = bool(s.get("needs_reconnect"))
        s["needs_reconnect"] = bool(on)
        _persist()
    return was


def _now():
    return dt.datetime.now().replace(microsecond=0)


def _utcnow():
    return dt.datetime.now(dt.timezone.utc)


def _fmt(t):
    return t.isoformat(timespec="minutes") if t else None


def _nice(t):
    t = core.parse_time(t) if isinstance(t, str) else t
    return t.strftime("%d.%m %H:%M") if t else ""


# ---------- quota ----------

def _pacific(t):
    if PACIFIC:
        return t.astimezone(PACIFIC)
    utc = dt.timezone.utc
    mar = dt.datetime(t.year, 3, 8, 10, tzinfo=utc)
    start = mar + dt.timedelta(days=(6 - mar.weekday()) % 7)
    nov = dt.datetime(t.year, 11, 1, 9, tzinfo=utc)
    end = nov + dt.timedelta(days=(6 - nov.weekday()) % 7)
    return t.astimezone(dt.timezone(dt.timedelta(hours=-7 if start <= t < end else -8)))


def quota_day(t=None):
    return _pacific(t or _utcnow()).date().isoformat()


def reset_at(t=None):
    t = t or _utcnow()
    nxt = _pacific(t).date() + dt.timedelta(days=1)
    if PACIFIC:
        m = dt.datetime.combine(nxt, dt.time(), PACIFIC)
    else:
        m = next(c for c in (dt.datetime.combine(nxt, dt.time(h), dt.timezone.utc) for h in (8, 7)) if _pacific(c).hour == 0)
    return m.astimezone().replace(tzinfo=None)


def _quota():
    with _lock:
        s = _load()
        q = s.setdefault("quota", {})
        day = quota_day()
        if q.get("day") != day:
            q.clear()
            q.update(day=day, used=0, exhausted=None)
            _persist()
        return q


def _charge(units):
    if not units:
        return
    with _lock:
        q = _quota()
        q["used"] = int(q.get("used") or 0) + int(units)
        _persist()


def _exhaust(reason):
    with _lock:
        q = _quota()
        already = q.get("exhausted")
        q["exhausted"] = reason
        _persist()
    if not already:
        what = "kanalın günlük yükleme sınırı" if reason == "uploadLimitExceeded" else "günlük API kotası"
        event(f"YouTube {what} doldu; {_nice(reset_at())} sonra devam edilecek", "quota")


def _exhausted():
    return bool(_quota().get("exhausted"))


def quota_info(c=None):
    c = c or conf()
    q = dict(_quota())
    limit = int(c.get("quota_limit") or DEFAULTS["quota_limit"])
    cost = int(c.get("quota_insert") or COST_INSERT)
    used = int(q.get("used") or 0)
    left = 0 if q.get("exhausted") else max(0, (limit - RESERVE - used) // max(1, cost))
    return {"used": used, "limit": limit, "insert_cost": cost, "uploads_left": left,
            "resets_at": reset_at().isoformat(timespec="seconds"), "exhausted": bool(q.get("exhausted"))}


# ---------- HTTP ----------

def _json(raw):
    try:
        return json.loads(raw or b"{}")
    except ValueError:
        return {}


def _http(method, url, data=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()
    except (urllib.error.URLError, OSError) as e:
        raise YtError(f"Google'a bağlanılamadı: {getattr(e, 'reason', e)}") from None


def _oauth_error(status, raw):
    j = _json(raw)
    reason = j.get("error") if isinstance(j.get("error"), str) else None
    desc = j.get("error_description") or ""
    if reason == "invalid_grant":
        msg = "Google bağlantısının süresi doldu ya da erişim geri alındı; YouTube'a yeniden bağlan"
    elif reason in ("invalid_client", "unauthorized_client"):
        msg = "Client ID ya da Client secret Google'da tanınmadı; bilgileri kontrol edip yeniden bağlan"
    else:
        msg = f"Google hatası {status}: {desc or reason or 'bilinmiyor'}"
    return YtError(msg, status, reason)


def _oauth(path, form):
    st, _, raw = _http("POST", OAUTH_BASE + path, urllib.parse.urlencode(form).encode(),
                       {"Content-Type": "application/x-www-form-urlencoded"})
    if st >= 400:
        raise _oauth_error(st, raw)
    return _json(raw)


def _api_error(status, raw):
    err = _json(raw).get("error")
    err = err if isinstance(err, dict) else {}
    reasons = err.get("errors") or [{}]
    reason = (reasons[0] or {}).get("reason") or err.get("status")
    msg = re.sub(r"<[^>]+>", "", err.get("message") or "").strip() or f"HTTP {status}"
    if reason in QUOTA_REASONS:
        _exhaust(reason)
        text = "YouTube kanalının günlük yükleme sınırı doldu" if reason == "uploadLimitExceeded" else "YouTube günlük API kotası doldu"
    elif reason == "youtubeSignupRequired":
        text = "Bu Google hesabında YouTube kanalı yok"
    elif reason == "invalidPublishAt":
        text = "YouTube yayın saatini kabul etmedi"
    elif reason in ("videoNotFound",) or status == 404:
        text = "Video YouTube'da bulunamadı"
    elif status == 403:
        text = f"YouTube bu işleme izin vermedi ({msg})"
    elif status == 401:
        text = "YouTube erişimi reddedildi; yeniden bağlanman gerekebilir"
    else:
        text = f"YouTube hatası {status}: {msg}"
    return YtError(text, status, reason)


def _token(force=False):
    with _tok_lock:
        c = conf()
        if not c["refresh_token"]:
            raise YtError("YouTube bağlı değil", None, "reconnect")
        if not force and c["access_token"] and float(c["token_expires"] or 0) - time.time() > 120:
            return c["access_token"]
        try:
            j = _oauth("/token", {"client_id": c["client_id"], "client_secret": c["client_secret"],
                                  "refresh_token": c["refresh_token"], "grant_type": "refresh_token"})
        except YtError as e:
            if e.reconnect:
                _lost(str(e))
            raise
        tok = j.get("access_token")
        if not tok:
            raise YtError("Google erişim anahtarı vermedi")
        save({"access_token": tok, "token_expires": int(time.time() + int(j.get("expires_in") or 3600))})
        return tok


def _lost(text):
    if not _set_reconnect(True):
        event(f"YouTube bağlantısı koptu: {text}", "error")
        core.log_activity("YouTube bağlantısı yenilenmeli (Ayarlar > YouTube > Yeniden bağlan)", kind="error")


def _api(method, path, params=None, body=None, cost=COST_LIST, token=None):
    url = API_BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    for attempt in (0, 1):
        tok = token or _token(force=attempt == 1)
        headers = {"Authorization": f"Bearer {tok}"}
        if data is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
        st, _, raw = _http(method, url, data, headers)
        if st == 401 and attempt == 0 and not token:
            continue
        _charge(cost if st < 400 else 1)
        if st >= 400:
            raise _api_error(st, raw)
        return _json(raw)


# ---------- OAuth ----------

def save_client(client_id, client_secret):
    cid = (client_id or "").strip()
    secret = (client_secret or "").strip()
    if not cid.endswith(".apps.googleusercontent.com") or len(cid) < 40 or not cid.isascii() or any(ch.isspace() for ch in cid):
        raise ValueError("Client ID '….apps.googleusercontent.com' ile biten tek satırlık bir metin olmalı")
    c = conf()
    if not secret:
        if cid == c["client_id"] and c["client_secret"]:
            secret = c["client_secret"]
        else:
            raise ValueError("Client secret boş")
    if len(secret) < 8 or not secret.isascii() or any(ch.isspace() for ch in secret):
        raise ValueError("Client secret boşluksuz tek satırlık bir metin olmalı")
    if connected(c) and cid != c["client_id"]:
        disconnect(False)
        event("Farklı bir OAuth istemcisi kaydedildi; YouTube'a yeniden bağlan", "warn")
    save({"client_id": cid, "client_secret": secret})
    if cid != c["client_id"] or secret != c["client_secret"]:
        event("Google OAuth istemcisi kaydedildi", "info")


def auth_url(port):
    c = conf()
    if not configured(c):
        raise ValueError("Önce Client ID ve Client secret kaydet")
    state = (f"o{core.OTURUM}." if core.OTURUM else "") + secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    uri = redirect_uri(port)
    with _lock:
        _load()["oauth"] = {"state": state, "verifier": verifier, "created": time.time(), "redirect_uri": uri}
        _persist()
    q = {"client_id": c["client_id"], "redirect_uri": uri, "response_type": "code", "scope": SCOPE, "access_type": "offline",
         "prompt": "consent", "include_granted_scopes": "true", "state": state, "code_challenge": challenge,
         "code_challenge_method": "S256"}
    return AUTH_URL + "?" + urllib.parse.urlencode(q)


def _channel(token=None):
    j = _api("GET", "/channels", {"part": "snippet", "mine": "true"}, cost=COST_LIST, token=token)
    items = j.get("items") or []
    if not items:
        raise YtError("Bu Google hesabında YouTube kanalı yok. Önce youtube.com'da bir kanal oluştur, sonra yeniden bağlan.")
    it = items[0]
    sn = it.get("snippet") or {}
    th = sn.get("thumbnails") or {}
    thumb = ((th.get("high") or th.get("medium") or th.get("default") or {}).get("url"))
    return {"id": it.get("id"), "title": sn.get("title") or it.get("id"), "thumb": thumb, "handle": sn.get("customUrl")}


def finish_auth(code, state, error=None):
    with _lock:
        s = _load()
        pend = s.get("oauth")
        match = bool(pend and state and hmac.compare_digest(str(state), str(pend.get("state") or "")))
        if match:
            s["oauth"] = None
            _persist()
    if not match:
        return False, "Bu bağlantı isteği bulunamadı ya da kullanıldı. Stüdyoda tekrar 'Google ile bağlan'a bas."
    if error:
        text = "Google'da izin verilmedi." if error == "access_denied" else f"Google bağlantıyı tamamlamadı ({error})."
        return False, text + " Stüdyoda tekrar 'Google ile bağlan'a basabilirsin."
    if time.time() - float(pend.get("created") or 0) > OAUTH_TTL:
        return False, "Bağlantı isteğinin süresi doldu (15 dakika). Stüdyoda tekrar 'Google ile bağlan'a bas."
    if not code:
        return False, "Google onay kodu gelmedi. Stüdyoda tekrar 'Google ile bağlan'a bas."
    c = conf()
    try:
        j = _oauth("/token", {"code": code, "client_id": c["client_id"], "client_secret": c["client_secret"],
                              "redirect_uri": pend["redirect_uri"], "grant_type": "authorization_code",
                              "code_verifier": pend["verifier"]})
        if not j.get("refresh_token"):
            raise YtError("Google yenileme anahtarı vermedi; tekrar bağlanmayı dene")
        if not j.get("access_token"):
            raise YtError("Google erişim anahtarı vermedi; tekrar bağlanmayı dene")
        ch = _channel(token=j["access_token"])
    except YtError as e:
        event(f"YouTube bağlanamadı: {e}", "error")
        return False, str(e)
    save({"refresh_token": j["refresh_token"], "access_token": j["access_token"],
          "token_expires": int(time.time() + int(j.get("expires_in") or 3600)), "channel": ch, "connected_at": core.now()})
    _set_reconnect(False)
    event(f"YouTube bağlandı: {ch['title']}", "connect")
    core.log_activity(f"YouTube kanalı bağlandı: {ch['title']}", kind="info")
    kick()
    return True, ch["title"]


def oauth_page(ok, text):
    head = "YouTube bağlandı" if ok else "YouTube bağlanamadı"
    body = (f"Kanal: <b>{html.escape(text)}</b>. Bu sekmeyi kapatabilirsin; stüdyo bağlantıyı birkaç saniye içinde gösterecek."
            if ok else html.escape(text))
    color = "#16a34a" if ok else "#dc2626"
    return f"""<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{head}</title><style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e7e9ee;
font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}}.c{{max-width:460px;margin:16px;padding:28px 30px;border-radius:14px;
background:#181b22;border:1px solid #2a2f3a}}h1{{margin:0 0 8px;font-size:20px;color:{color}}}p{{margin:0;color:#b9bfcc}}</style></head>
<body><div class="c"><h1>{head}</h1><p>{body}</p></div></body></html>"""


def disconnect(revoke=False):
    c = conf()
    for pid in list(_uploads):
        _cancel(pid)
    notes = []
    if revoke and c["refresh_token"]:
        try:
            _oauth("/revoke", {"token": c["refresh_token"]})
        except YtError as e:
            notes.append(str(e))
    kept = 0
    for p in _all_posts():
        y = p.get("youtube") or {}
        if y.get("video_id") and y.get("state") not in FINAL:
            kept += 1
        elif y.get("state") and not y.get("video_id"):
            _clear(p["id"])
    save({"refresh_token": "", "access_token": "", "token_expires": 0, "channel": None, "connected_at": ""})
    with _lock:
        s = _load()
        s.update(needs_reconnect=False, oauth=None, sessions={}, checked={})
        _persist()
    text = "YouTube bağlantısı kaldırıldı" + (" (Google erişimi geri alındı)" if revoke and not notes else "")
    if kept:
        text += f"; YouTube'da planlı {kept} video duruyor, YouTube Studio'dan yönetebilirsin"
    event(text + (f" — not: {'; '.join(notes)}" if notes else ""), "cancel")
    core.log_activity("YouTube bağlantısı kaldırıldı", kind="info")
    return notes


def update_settings(d):
    c = conf()
    patch = {}
    for k in ("auto", "audited", "synthetic"):
        if k in d:
            patch[k] = bool(d[k])
    if "category" in d:
        cat = str(d["category"] or "").strip()
        if not cat.isdigit():
            raise ValueError("geçersiz kategori")
        patch["category"] = cat
    for k, lo, hi in (("upload_ahead_hours", 1, 720), ("quota_limit", 1000, 10_000_000), ("quota_insert", 1, 100_000)):
        if k in d:
            try:
                patch[k] = max(lo, min(hi, int(d[k])))
            except (TypeError, ValueError):
                raise ValueError(f"geçersiz değer: {k}") from None
    if not patch:
        return
    save(patch)
    if "auto" in patch and patch["auto"] != bool(c["auto"]):
        if patch["auto"]:
            event("Otomatik YouTube Shorts paylaşımı açıldı; planlı Reels videoları YouTube'a da yüklenecek", "ok")
        else:
            pinned = 0
            for p in core.list_posts():
                y = p.get("youtube") or {}
                if y.get("enabled") is None and y.get("video_id") and y.get("state") not in FINAL:
                    _set(p["id"], enabled=True)
                    pinned += 1
            extra = f"; YouTube'a zaten yüklenmiş {pinned} video planlı kalıyor (içerikten tek tek kapatabilirsin)" if pinned else ""
            event("Otomatik YouTube Shorts paylaşımı kapatıldı" + extra, "warn")
    if "audited" in patch and patch["audited"] != bool(c["audited"]):
        event("YouTube API denetimi onaylandı olarak işaretlendi" if patch["audited"] else "YouTube API denetimi onaylanmadı olarak işaretlendi", "info")
    kick()


# ---------- posts ----------

def _all_posts():
    out = []
    if core.POSTS.exists():
        for d in core.POSTS.iterdir():
            p = core.read_json(d / "post.json")
            if p and p.get("id"):
                out.append(p)
    return out


def _plock(pid):
    with _lock:
        return _pid_locks[pid]


def _set(pid, **kw):
    def fn(q):
        y = dict(q.get("youtube") or {})
        y.update(kw)
        q["youtube"] = y
    return core.update_post(pid, fn)


def _clear(pid, **kw):
    def fn(q):
        y = q.get("youtube") or {}
        keep = {k: y.get(k) for k in USER_KEYS if y.get(k) is not None}
        keep.update(kw)
        q["youtube"] = keep or None
    return core.update_post(pid, fn)


def _enabled(p, c):
    v = (p.get("youtube") or {}).get("enabled")
    if v is None:
        return True if (p.get("targets") or {}).get("instagram") is False else bool(c.get("auto", True))
    return bool(v)


def target(p, c=None):
    c = c or _view_conf()
    if not connected(c) or (p.get("kind") or "reels") != "reels":
        return None
    return _enabled(p, c)


def _video_ok(p):
    files = instagram.media_files(p)
    return bool(files and files[0].suffix.lower() in instagram.VIDEO_EXT and files[0].exists())


def _want(p, y=None, c=None):
    c = c or conf()
    if not p or not connected(c) or p.get("deleted") or (p.get("kind") or "reels") != "reels":
        return False, None
    y = (p.get("youtube") or {}) if y is None else y
    if not _enabled(p, c) or not _video_ok(p):
        return False, None
    st = p.get("status")
    sched = core.parse_time(p.get("schedule")) if p.get("schedule") else None
    has = bool(y.get("video_id")) or y.get("state") in ("queued", "uploading", "scheduled", "error")
    if st == "planlandi" and sched:
        return True, sched
    if st == "paylasiliyor":
        return has, sched
    if st == "paylasildi":
        if has:
            return True, None
        pub = p.get("published") or {}
        at = core.parse_time(pub.get("at")) if pub.get("at") else None
        con = core.parse_time(c.get("connected_at")) if c.get("connected_at") else None
        fresh = at and con and at >= con and (_now() - at).total_seconds() <= FRESH_PUBLISH
        return bool(fresh and not pub.get("manual")), None
    if st == "hata" and y.get("video_id"):
        return True, core.parse_time(y.get("at")) if y.get("at") else None
    return False, None


def _plan(target):
    if target is None or (target - _now()).total_seconds() <= 60:
        return None
    return target.replace(second=0, microsecond=0)


def _committed(y):
    if y.get("hold"):
        return False
    at = core.parse_time(y.get("at")) if y.get("at") else None
    return not at or (at - _now()).total_seconds() <= 60


def _active(pid):
    u = _uploads.get(pid)
    return bool(u and u["phase"] in ACTIVE)


def _cancel(pid):
    u = _uploads.get(pid)
    if u and _active(pid):
        u["cancel"] = True


def _defer(pid, secs=RETRY_WAIT):
    _retry_at[pid] = time.time() + secs


def _waiting(pid):
    return time.time() < _retry_at.get(pid, 0)


# ---------- metadata ----------

def _clean_title(text):
    return re.sub(r"\s+", " ", (text or "").replace("<", "").replace(">", "")).strip()[:100].rstrip()


def default_title(p):
    first = (p.get("caption") or "").strip().split("\n")[0]
    return _clean_title(p.get("title")) or _clean_title(first) or "Shorts"


def _title(p):
    return _clean_title((p.get("youtube") or {}).get("title")) or default_title(p)


def _cut_bytes(text, n):
    b = text.encode("utf-8")
    return text if len(b) <= n else b[:n].decode("utf-8", "ignore").rstrip()


def default_description(p):
    text = instagram.full_caption(p).replace("<", "").replace(">", "").strip()
    if re.search(r"(?i)#shorts\b", text):
        return _cut_bytes(text, 5000)
    text = _cut_bytes(text, 4988)
    lines = text.splitlines()
    sep = " " if lines and lines[-1].lstrip().startswith("#") else ("\n\n" if text else "")
    return f"{text}{sep}#Shorts"


def _description(p):
    own = (p.get("youtube") or {}).get("description")
    if own:
        return _cut_bytes(own.replace("<", "").replace(">", "").strip(), 5000)
    return default_description(p)


def _tags(p, desc):
    seen, out, total = set(), [], 0
    for t in re.findall(r"#(\w+)", f"{p.get('hashtags') or ''} {desc}"):
        k = t.lower()
        if k in seen:
            continue
        add = len(t) + (1 if out else 0)
        if total + add > 500:
            break
        seen.add(k)
        out.append(t)
        total += add
    return out


def _lang():
    lang = str((core.settings().get("narrator") or {}).get("language") or "tr")
    return lang if re.fullmatch(r"[a-z]{2,3}(-[A-Za-z]{2,4})?", lang) else "tr"


def _snippet(p, c):
    desc = _description(p)
    lang = _lang()
    return {"title": _title(p), "description": desc, "tags": _tags(p, desc), "categoryId": str(c.get("category") or "22"),
            "defaultLanguage": lang, "defaultAudioLanguage": lang}


def _status(desired, c, hold=False):
    out = {"privacyStatus": "private" if desired or hold else "public", "selfDeclaredMadeForKids": False,
           "containsSyntheticMedia": bool(c.get("synthetic")), "embeddable": True, "license": "youtube", "publicStatsViewable": True}
    if desired and not hold:
        out["publishAt"] = cloud.to_utc(desired)
    return out


def _sig(snippet):
    raw = json.dumps([snippet["title"], snippet["description"], snippet["tags"], snippet["categoryId"], snippet["defaultLanguage"]],
                     ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


# ---------- upload ----------

def _put(uri, headers, body=b""):
    u = urllib.parse.urlsplit(uri)
    cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
    conn = cls(u.netloc, timeout=UPLOAD_TIMEOUT, blocksize=1 << 16)
    try:
        conn.request("PUT", u.path + (f"?{u.query}" if u.query else ""), body=body, headers={"User-Agent": UA, **headers})
        r = conn.getresponse()
        return r.status, r.headers, r.read()
    finally:
        conn.close()


def _next_offset(headers):
    m = re.search(r"bytes=(\d+)-(\d+)", (headers or {}).get("Range") or "")
    return int(m.group(2)) + 1 if m else 0


def _query(uri, size):
    st, h, raw = _put(uri, {"Authorization": f"Bearer {_token()}", "Content-Length": "0", "Content-Range": f"bytes */{size}"})
    if st in (200, 201):
        return size, _json(raw)
    if st == 308:
        return _next_offset(h), None
    if st in (404, 410):
        raise _Expired()
    if st == 401:
        _token(force=True)
    raise YtError(f"YouTube yükleme durumu alınamadı (HTTP {st})", st if st != 401 else None)


def _wait_s(fails):
    return min(30, 2 ** (fails - 1))


def _init_session(meta, size, ctype):
    url = UPLOAD_BASE + "/upload/youtube/v3/videos?" + urllib.parse.urlencode({"uploadType": "resumable", "part": "snippet,status"})
    data = json.dumps(meta, ensure_ascii=False).encode("utf-8")
    for attempt in (0, 1):
        headers = {"Authorization": f"Bearer {_token(force=attempt == 1)}", "Content-Type": "application/json; charset=UTF-8",
                   "X-Upload-Content-Length": str(size), "X-Upload-Content-Type": ctype}
        st, h, raw = _http("POST", url, data, headers)
        if st == 401 and attempt == 0:
            continue
        _charge(int(conf().get("quota_insert") or COST_INSERT) if st < 400 else 1)
        if st >= 400:
            raise _api_error(st, raw)
        loc = h.get("Location")
        if not loc:
            raise YtError("YouTube yükleme oturumu açılamadı")
        return loc


def _send(path, size, prog, uri, ctype, resume):
    offset = 0
    if resume:
        offset, res = _query(uri, size)
        if res is not None:
            return res
    fails = 0
    with open(path, "rb") as fh:
        while True:
            if prog["cancel"]:
                raise cloud._Canceled()
            prog.update(phase="upload", sent=offset)
            end = min(size, offset + CHUNK)
            fh.seek(offset)
            try:
                st, h, raw = _put(uri, {"Authorization": f"Bearer {_token()}", "Content-Type": ctype,
                                        "Content-Length": str(end - offset), "Content-Range": f"bytes {offset}-{end - 1}/{size}"},
                                  cloud._Body(fh, end - offset, prog))
            except (OSError, http.client.HTTPException):
                st, h, raw = None, None, b""
            if st in (200, 201):
                return _json(raw)
            if st == 308:
                offset = _next_offset(h)
                fails = 0
                continue
            if st in (404, 410):
                raise _Expired()
            if st is not None and 400 <= st < 500 and st not in (401, 408, 429):
                raise _api_error(st, raw)
            if st == 401:
                _token(force=True)
            while True:
                fails += 1
                if fails > MAX_FAILS:
                    raise YtError("YouTube'a yükleme bağlantısı tekrar tekrar koptu; daha sonra kaldığı yerden denenecek")
                prog["phase"] = "retry"
                time.sleep(_wait_s(fails))
                if prog["cancel"]:
                    raise cloud._Canceled()
                try:
                    offset, res = _query(uri, size)
                except (OSError, http.client.HTTPException, YtError):
                    continue
                if res is not None:
                    return res
                break


def _session(pid, vsig, size, chan):
    with _lock:
        sess = (_load().get("sessions") or {}).get(pid)
    if sess and sess.get("vsig") == vsig and sess.get("size") == size and sess.get("channel") == chan \
            and time.time() - float(sess.get("created") or 0) < SESSION_TTL:
        return sess
    return None


def _keep_session(pid, sess):
    with _lock:
        s = _load()
        if sess:
            s.setdefault("sessions", {})[pid] = sess
        else:
            (s.get("sessions") or {}).pop(pid, None)
        _persist()


def _discard(pid, prog, sess, f, size, ctype):
    prog.update(phase="finalize", cancel=False)
    try:
        if not f or not size or not f.exists():
            raise YtError("dosya yok")
        res = _send(f, size, prog, sess["uri"], ctype, True)
        vid = res.get("id")
        if vid:
            _api("DELETE", "/videos", {"id": vid}, cost=COST_DELETE)
            event(f"#{pid} yarıda kalan YouTube yüklemesi kapatıldı, kanalda boş video bırakılmadı", "cancel")
    except Exception:  # noqa: BLE001
        event(f"#{pid} yarıda kalan YouTube yüklemesi YouTube Studio'da boş bir taslak bırakmış olabilir; oradan silebilirsin", "warn")


def _upload(pid):
    c = conf()
    prog = {"phase": "queued", "sent": 0, "total": 0, "pct": 0.0, "speed": 0, "eta": None, "started": time.time(),
            "cancel": False, "error": None}
    with _plock(pid):
        p = core.load_post(pid)
        y = (p or {}).get("youtube") or {}
        want, target = _want(p, y, c)
        if not want or y.get("video_id") or y.get("state") != "queued" or _active(pid):
            return
        _uploads[pid] = prog
        _set(pid, state="uploading", code=None, error=None)
    chan = (c.get("channel") or {}).get("id")
    try:
        f = instagram.media_files(p)[0]
        size = f.stat().st_size
        vsig = cloud._vsig(p)
        ctype = "video/quicktime" if f.suffix.lower() == ".mov" else "video/mp4"
        desired = _plan(target)
        hold = bool(desired and (desired - _now()).total_seconds() < HOLD_LEAD)
        snippet = _snippet(p, c)
        meta = {"snippet": snippet, "status": _status(desired, c, hold)}
        prog.update(phase="upload", total=size, sent=0, started=time.time(), _win=[])
        sess = _session(pid, vsig, size, chan)
        resume = bool(sess)
        if sess:
            event(f"#{pid} YouTube yüklemesi kaldığı yerden sürüyor", "upload")
        for attempt in (0, 1):
            if not sess:
                sess = {"uri": _init_session(meta, size, ctype), "vsig": vsig, "size": size, "created": time.time(), "channel": chan,
                        "at": _fmt(desired or _now()), "sig": _sig(snippet), "hold": hold,
                        "privacy": meta["status"]["privacyStatus"]}
                _keep_session(pid, sess)
                if attempt == 0:
                    event(f"#{pid} YouTube'a yükleniyor ({cloud._mb(size)})", "upload")
            try:
                res = _send(f, size, prog, sess["uri"], ctype, resume)
                break
            except _Expired:
                _keep_session(pid, None)
                sess, resume = None, False
                if attempt == 1:
                    raise YtError("YouTube yükleme oturumu kapandı; daha sonra yeniden denenecek") from None
        vid = res.get("id")
        if not vid:
            raise YtError("YouTube video kimliği dönmedi")
        prog.update(phase="finalize", pct=100.0, eta=0)
        with _plock(pid):
            _keep_session(pid, None)
            _set(pid, state="scheduled", video_id=vid, url=None, at=sess["at"], uploaded_at=core.now(), vsig=sess["vsig"],
                 sig=sess["sig"], hold=sess["hold"], privacy=sess["privacy"], channel=chan, attempts=0, error=None, code=None,
                 force=False, failed_at=None, published_at=None)
            prog.update(phase="done", finished=time.time())
        public_now = sess["privacy"] == "public"
        when = "hemen yayına giriyor" if public_now else f"{_nice(sess['at'])} için planlandı"
        event(f"YouTube'a yüklendi: #{pid} {p.get('title') or ''} ({when})", "uploaded")
        core.log_activity(f"YouTube Shorts'a yüklendi ({when})", post=pid, kind="schedule")
        _reconcile(pid)
    except cloud._Canceled:
        started = locals().get("sess")
        if started and started.get("uri"):
            _discard(pid, prog, started, locals().get("f"), locals().get("size"), locals().get("ctype"))
        with _plock(pid):
            _keep_session(pid, None)
            prog.update(phase="canceled", finished=time.time())
            cur = core.load_post(pid) or {}
            if (cur.get("youtube") or {}).get("state") == "uploading":
                _clear(pid)
        event(f"#{pid} YouTube yüklemesi durduruldu", "cancel")
    except Exception as e:  # noqa: BLE001
        if not isinstance(e, (YtError, OSError, ValueError)):
            traceback.print_exc()
        err = e if isinstance(e, YtError) else YtError(f"yükleme hatası: {e}")
        with _plock(pid):
            if not err.transient or err.quota:
                _keep_session(pid, None)
            prog.update(phase="error", error=str(err), finished=time.time())
            try:
                if err.quota:
                    _set(pid, state="queued", code="quota", error=None)
                elif err.reconnect:
                    _set(pid, state="queued", code="reconnect", error=None)
                else:
                    cur = core.load_post(pid) or {}
                    tries = int((cur.get("youtube") or {}).get("attempts") or 0) + 1
                    code = "file" if isinstance(e, OSError) else ("invalid" if err.status == 400 else
                                                                  "forbidden" if err.status == 403 else "upload_failed")
                    _set(pid, state="error", error=str(err), code=code, attempts=tries, failed_at=core.now())
            except KeyError:
                pass
        if not err.quota and not err.reconnect:
            event(f"#{pid} YouTube'a yüklenemedi: {err}", "error")
            core.log_activity(f"YouTube'a yüklenemedi: {err}", post=pid, kind="error")
    finally:
        t = threading.Timer(120, lambda: _uploads.get(pid) is prog and not _active(pid) and _uploads.pop(pid, None))
        t.daemon = True
        t.start()


def _next_upload():
    c = conf()
    if not connected(c) or needs_reconnect():
        return None
    cands = []
    for p in core.list_posts():
        y = p.get("youtube") or {}
        if y.get("state") != "queued" or y.get("video_id") or _active(p["id"]):
            continue
        want, target = _want(p, y, c)
        if want:
            cands.append((target or dt.datetime.min, p, y))
    cands.sort(key=lambda x: (x[0], x[1]["id"]))
    ahead = int(c.get("upload_ahead_hours") or DEFAULTS["upload_ahead_hours"]) * 3600
    ok = quota_info(c)["uploads_left"] > 0
    now = _now()
    for target, p, y in cands:
        due = y.get("force") or target == dt.datetime.min or (target - now).total_seconds() <= ahead
        code = None if due and ok else ("quota" if due else "wait")
        if code:
            if y.get("code") != code:
                with _plock(p["id"]):
                    cur = (core.load_post(p["id"]) or {}).get("youtube") or {}
                    if cur.get("state") == "queued":
                        _set(p["id"], code=code)
            continue
        return p["id"]
    return None


def _pump_run():
    global _pump_again
    while True:
        try:
            while _pump_again:
                _pump_again = False
                while pid := _next_upload():
                    _upload(pid)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        finally:
            _pump_lock.release()
        if not _pump_again or not _pump_lock.acquire(blocking=False):
            return


def _kick():
    global _pump_again
    _pump_again = True
    if _pump_lock.acquire(blocking=False):
        threading.Thread(target=_pump_run, daemon=True).start()


# ---------- reconcile ----------

def _delete_video(pid, y):
    if needs_reconnect() or _waiting(pid) or _exhausted():
        return False
    try:
        _api("DELETE", "/videos", {"id": y["video_id"]}, cost=COST_DELETE)
    except YtError as e:
        if e.status != 404:
            _defer(pid)
            event(f"#{pid} YouTube'dan silinemedi: {e}", "warn")
            return False
    return True


def _mark_missing(pid):
    _set(pid, state="deleted", video_id=None, code="missing", hold=False,
         error="Video YouTube'da bulunamadı; YouTube Studio'dan silinmiş olabilir.")
    event(f"#{pid} YouTube'da bulunamadı (silinmiş olabilir)", "warn")
    core.log_activity("YouTube videosu bulunamadı; YouTube Studio'dan silinmiş olabilir", post=pid, kind="error")


def _push_update(pid, p, y, target, c):
    desired = _plan(target)
    snippet = _snippet(p, c)
    sig = _sig(snippet)
    at = _fmt(desired)
    parts = []
    if y.get("hold") or desired is None or at != y.get("at"):
        parts.append("status")
    if sig != y.get("sig"):
        parts.append("snippet")
    if not parts or needs_reconnect() or _waiting(pid) or _exhausted():
        return
    status = _status(desired, c)
    body = {"id": y["video_id"]}
    if "snippet" in parts:
        body["snippet"] = snippet
    if "status" in parts:
        body["status"] = status
    try:
        _api("PUT", "/videos", {"part": ",".join(parts)}, body, cost=COST_UPDATE)
    except YtError as e:
        if e.status == 404:
            _mark_missing(pid)
            return
        _defer(pid)
        event(f"#{pid} YouTube'da güncellenemedi: {e}", "warn")
        return
    patch = {"sig": sig} if "snippet" in parts else {}
    if "status" in parts:
        patch.update(at=at or _fmt(_now()), hold=False, privacy=status["privacyStatus"])
    _set(pid, **patch)
    texts = []
    if "status" in parts:
        texts.append(f"yayın saati {_nice(at)}" if at else "hemen yayına alındı")
    if "snippet" in parts:
        texts.append("başlık/açıklama")
    event(f"#{pid} YouTube'da güncellendi: {', '.join(texts)}", "sync")
    if "status" in parts and not y.get("hold"):
        core.log_activity("YouTube " + (f"yayın saati güncellendi: {_nice(at)}" if at else "videosu hemen yayına alındı"),
                          post=pid, kind="schedule")


def _reconcile(pid):
    c = conf()
    if not connected(c):
        return
    with _plock(pid):
        p = core.load_post(pid)
        if not p:
            return
        y = p.get("youtube") or {}
        st = y.get("state")
        want, target = _want(p, y, c)
        if _active(pid):
            if not want:
                _cancel(pid)
            return
        if st in FINAL or y.get("manual"):
            return
        if y.get("channel") and y["channel"] != (c.get("channel") or {}).get("id"):
            return
        if not y.get("video_id"):
            if not want:
                if st:
                    _clear(pid)
                return
            if st in (None, "uploading"):
                _set(pid, state="queued", code=None, error=None)
                _kick()
            elif st == "queued":
                _kick()
            return
        if _committed(y):
            return
        if not want:
            if _delete_video(pid, y):
                _clear(pid)
                event(f"#{pid} YouTube'daki planlı video silindi", "cancel")
                core.log_activity("YouTube'daki planlı video silindi (artık paylaşılmayacak)", post=pid, kind="info")
            return
        cur = cloud._stable_vsig(p)
        if cur and y.get("vsig") and cur != y["vsig"]:
            if _delete_video(pid, y):
                _clear(pid, state="queued")
                event(f"#{pid} videosu değişti, YouTube'a yeniden yüklenecek", "upload")
                core.log_activity("Video değişti; YouTube'daki eski sürüm silindi, yenisi yüklenecek", post=pid, kind="schedule")
                _kick()
            return
        _push_update(pid, p, y, target, c)


def _redo(pid):
    with _plock(pid):
        p = core.load_post(pid) or {}
        y = p.get("youtube") or {}
        if y.get("video_id") and not y.get("manual") and not _delete_video(pid, y):
            return
        _clear(pid, state="queued", attempts=0)
    _kick()


def _spawn(fn, *args):
    cloud._spawn(fn, *args)


def post_changed(pid):
    if connected():
        _spawn(_reconcile, pid)


def kick():
    global _last_tick, _sync_again
    _last_tick = 0.0
    _sync_again = True
    if connected():
        _spawn(_sync)


def tick():
    global _last_tick
    if time.time() - _last_tick < SYNC_EVERY or not connected():
        return
    _last_tick = time.time()
    _spawn(_sync)


def _relevant(p):
    if (p.get("youtube") or {}).get("state"):
        return True
    return (p.get("kind") or "reels") == "reels" and p.get("status") in ("planlandi", "paylasiliyor", "paylasildi")


def _sync(force=False, block=None):
    global _sync_again
    block = force if block is None else block
    if not (_sync_lock.acquire(timeout=30) if block else _sync_lock.acquire(blocking=False)):
        return False
    _sync_again = False
    try:
        c = conf()
        if not connected(c):
            return False
        _quota()
        posts = _all_posts()
        for p in posts:
            if _relevant(p):
                _reconcile(p["id"])
        now = _now()
        for p in posts:
            y = p.get("youtube") or {}
            if y.get("state") != "error" or y.get("video_id") or int(y.get("attempts") or 0) >= MAX_ATTEMPTS or _active(p["id"]):
                continue
            failed = core.parse_time(y.get("failed_at")) if y.get("failed_at") else None
            if failed and (now - failed).total_seconds() < 300:
                continue
            with _plock(p["id"]):
                cur = core.load_post(p["id"])
                cy = (cur or {}).get("youtube") or {}
                if cy.get("state") == "error" and not cy.get("video_id") and _want(cur, cy, c)[0]:
                    _set(p["id"], state="queued", code=None)
        _kick()
        if not needs_reconnect():
            _poll(force)
        with _lock:
            _load()["last_sync"] = core.now()
            _persist()
        return True
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return False
    finally:
        _sync_lock.release()
        if _sync_again:
            _spawn(_sync)


def sync_now(wait=25):
    global _last_tick
    _last_tick = time.time()
    t = threading.Thread(target=_sync, args=(True,), daemon=True)
    t.start()
    t.join(wait)


# ---------- status sync ----------

def _poll_due(y, checked):
    at = core.parse_time(y.get("at")) if y.get("at") else None
    age = time.time() - checked if checked else None
    if at and at <= _now():
        return age is None or age >= POLL_DUE or checked < at.timestamp() + 30
    return age is None or age >= POLL_EVERY


def _poll(force=False):
    c = conf()
    chan = (c.get("channel") or {}).get("id")
    with _lock:
        checked = dict(_load().get("checked") or {})
    due = []
    for p in _all_posts():
        y = p.get("youtube") or {}
        vid = y.get("video_id")
        if not vid or y.get("state") != "scheduled" or (y.get("channel") and y["channel"] != chan) or _active(p["id"]):
            continue
        if force or _poll_due(y, checked.get(vid)):
            due.append(p)
    for i in range(0, len(due), 50):
        batch = due[i:i + 50]
        ids = [p["youtube"]["video_id"] for p in batch]
        try:
            j = _api("GET", "/videos", {"part": "status,processingDetails", "id": ",".join(ids)}, cost=COST_LIST)
        except YtError as e:
            event(f"YouTube durumları alınamadı: {e}", "warn")
            return
        items = {it.get("id"): it for it in j.get("items") or []}
        stamp = time.time()
        with _lock:
            ck = _load().setdefault("checked", {})
            for vid in ids:
                ck[vid] = stamp
            live = {(p.get("youtube") or {}).get("video_id") for p in _all_posts()}
            for vid in list(ck):
                if vid not in live:
                    ck.pop(vid, None)
            _persist()
        for p in batch:
            _apply(p["id"], items.get(p["youtube"]["video_id"]), c)


def _apply(pid, item, c):
    with _plock(pid):
        p = core.load_post(pid)
        y = (p or {}).get("youtube") or {}
        if not p or y.get("state") != "scheduled" or not y.get("video_id"):
            return
        vid = y["video_id"]
        if item is None:
            _mark_missing(pid)
            return
        st = item.get("status") or {}
        pd = item.get("processingDetails") or {}
        up, priv = st.get("uploadStatus"), st.get("privacyStatus")
        if up in ("failed", "rejected", "deleted") or pd.get("processingStatus") in ("failed", "terminated"):
            why = st.get("failureReason") or st.get("rejectionReason") or pd.get("processingFailureReason") or up
            code = "rejected" if up == "rejected" else "processing_failed"
            text = f"YouTube videoyu {'reddetti' if code == 'rejected' else 'işleyemedi'} ({why})"
            _set(pid, state="error", code=code, error=text, failed_at=core.now(), attempts=MAX_ATTEMPTS)
            event(f"#{pid} {text}", "error")
            core.log_activity(text, post=pid, kind="error")
            return
        at = core.parse_time(y.get("at")) if y.get("at") else None
        passed = not at or at <= _now()
        if priv == "public" or (priv == "unlisted" and passed):
            url = f"https://youtube.com/shorts/{vid}"
            _set(pid, state="published", url=url, published_at=core.now(), error=None, code=None, privacy=priv)
            event(f"YouTube'da yayında: #{pid} {p.get('title') or ''}", "published")
            core.log_activity("YouTube Shorts'ta yayında", post=pid, kind="done")
            return
        if not passed or y.get("hold"):
            return
        if (_now() - at).total_seconds() < LOCK_AFTER:
            return
        if y.get("manual"):
            _set(pid, state="published", url=f"https://youtube.com/shorts/{vid}", published_at=core.now(), error=None, code=None,
                 privacy=priv)
            return
        if c.get("audited"):
            text = ("YouTube videoyu planlanan saatte herkese açmadı ve gizli tuttu. YouTube Studio'dan durumunu kontrol et; "
                    "gerekirse elle herkese açık yapabilirsin.")
            code = "private"
        else:
            text = ("Video YouTube'da gizli kaldı: Google bu projeyle API üzerinden yüklenen videoları gizli tutuyor. "
                    "Ayarlar › YouTube'dan denetim başvurusu yapabilirsin; bu sırada YouTube Studio'dan elle herkese açık yapmayı deneyebilirsin.")
            code = "audit"
        _set(pid, state="private_locked", code=code, error=text, privacy=priv)
        event(f"#{pid} YouTube'da gizli kaldı" + (" (API denetimi gerekli)" if code == "audit" else ""), "warn")
        core.log_activity("YouTube videosu gizli kaldı" + (" — API denetimi gerekli" if code == "audit" else ""), post=pid, kind="error")


# ---------- post actions ----------

def _check(p, c):
    if not connected(c):
        raise ValueError("YouTube bağlı değil (Ayarlar > YouTube)")
    if needs_reconnect():
        raise ValueError("YouTube bağlantısı yenilenmeli (Ayarlar > YouTube > Yeniden bağlan)")
    if (p.get("kind") or "reels") != "reels":
        raise ValueError("YouTube'a yalnızca Reels videoları gönderilir")
    if p.get("deleted"):
        raise ValueError("içerik çöp kutusunda")
    if not _video_ok(p):
        raise ValueError("video dosyası hazır değil")
    if not _enabled(p, c):
        raise ValueError("bu içerik için YouTube paylaşımı kapalı")
    if not _want(p, None, c)[0]:
        raise ValueError("önce paylaşımı planla")


def edit_post(pid, d):
    patch = {}
    if "enabled" in d:
        patch["enabled"] = None if d["enabled"] is None else bool(d["enabled"])
    if "title" in d:
        raw = re.sub(r"\s+", " ", str(d["title"] or "").replace("<", "").replace(">", "")).strip()
        if len(raw) > 100:
            raise ValueError("YouTube başlığı en fazla 100 karakter olabilir")
        patch["title"] = raw or None
    if "description" in d:
        raw = str(d["description"] or "").replace("<", "").replace(">", "").strip()
        if len(raw.encode("utf-8")) > 5000:
            raise ValueError("YouTube açıklaması en fazla 5000 bayt olabilir")
        patch["description"] = raw or None
    if not patch:
        raise ValueError("değişiklik yok")
    before = core.load_post(pid) or {}
    if patch.get("enabled") is False and not core.ig_on(before) and before.get("status") not in ("paylasildi", "paylasiliyor"):
        raise ValueError("Instagram kapalıyken YouTube da kapatılamaz; önce paylaşım yerlerinden Instagram'ı aç")
    _set(pid, **patch)
    if "enabled" in patch and patch["enabled"] != (before.get("youtube") or {}).get("enabled"):
        on = _enabled(core.load_post(pid), conf())
        core.log_activity("YouTube Shorts paylaşımı " + ("açıldı" if on else "kapatıldı"), post=pid, kind="info")
    post_changed(pid)


def retry(pid):
    c = conf()
    p = core.load_post(pid)
    if not p:
        raise KeyError(pid)
    _check(p, c)
    if _active(pid):
        raise ValueError("YouTube yüklemesi zaten sürüyor")
    y = p.get("youtube") or {}
    st = y.get("state")
    _retry_at.pop(pid, None)
    if y.get("video_id") and st == "error":
        _spawn(_redo, pid)
    elif not y.get("video_id") and st in (None, "queued", "error", "deleted"):
        _clear(pid, state="queued", attempts=0)
        _kick()
    elif y.get("video_id"):
        post_changed(pid)
    core.log_activity("YouTube için yeniden denenecek", post=pid, kind="queue")


def upload_now(pid):
    c = conf()
    p = core.load_post(pid)
    if not p:
        raise KeyError(pid)
    _check(p, c)
    y = p.get("youtube") or {}
    if y.get("video_id"):
        raise ValueError("video zaten YouTube'a yüklendi")
    if _active(pid):
        raise ValueError("YouTube yüklemesi zaten sürüyor")
    _clear(pid, state="queued", force=True, attempts=0)
    _kick()


VID_RE = re.compile(r"(?:youtu\.be/|/shorts/|/live/|/embed/|/video/|[?&]v=)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])")


def video_id_from(link):
    link = str(link or "").strip()
    if not link:
        return None
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", link):
        return link
    m = VID_RE.search(link)
    if not m:
        raise ValueError("YouTube bağlantısı tanınmadı; Shorts ya da video linkini yapıştır")
    return m.group(1)


def _lookup(vid, c):
    if not connected(c) or needs_reconnect():
        return None
    try:
        j = _api("GET", "/videos", {"part": "status,snippet", "id": vid}, cost=COST_LIST)
    except YtError:
        return None
    items = j.get("items") or []
    if not items:
        raise ValueError("Bu bağlantıdaki video YouTube'da bulunamadı")
    chan = (c.get("channel") or {}).get("id")
    if chan and (items[0].get("snippet") or {}).get("channelId") != chan:
        raise ValueError("Bu video bağlı YouTube kanalında değil")
    return items[0].get("status") or {}


def mark_manual(pid, link=None):
    c = conf()
    p = core.load_post(pid)
    if not p:
        raise KeyError(pid)
    if (p.get("kind") or "reels") != "reels":
        raise ValueError("YouTube'a yalnızca Reels videoları gönderilir")
    if _active(pid):
        raise ValueError("Video şu an YouTube'a yükleniyor; önce bu içerikte YouTube'u kapat")
    y = p.get("youtube") or {}
    if y.get("video_id") and not y.get("manual"):
        raise ValueError("Bu video stüdyo tarafından zaten YouTube'a yüklendi")
    vid = video_id_from(link)
    st = _lookup(vid, c) if vid else None
    now = _now()
    sched = core.parse_time(p["schedule"]) if p.get("schedule") else None
    pub = dt.datetime.fromisoformat(cloud.to_local(st["publishAt"])) if st and st.get("publishAt") else None
    if st is not None:
        planned = st.get("privacyStatus") != "public" and pub and pub > now
        at = pub if planned else now
    else:
        planned = bool(vid and sched and sched > now)
        at = sched if planned else now
    _retry_at.pop(pid, None)
    with _plock(pid):
        _set(pid, enabled=True, manual=True, state="scheduled" if planned else "published", video_id=vid,
             url=f"https://youtube.com/shorts/{vid}" if vid else None, at=_fmt(at), channel=(c.get("channel") or {}).get("id"),
             published_at=None if planned else core.now(), privacy=(st or {}).get("privacyStatus"), code=None, error=None,
             hold=False, force=None, attempts=0)
    event(f"#{pid} YouTube'da elle {'planlandı' if planned else 'paylaşıldı'} olarak işaretlendi", "published")
    core.log_activity("YouTube'da elle paylaşıldı olarak işaretlendi", post=pid, kind="done")


def unmark_manual(pid):
    p = core.load_post(pid)
    if not p:
        raise KeyError(pid)
    if not (p.get("youtube") or {}).get("manual"):
        raise ValueError("Bu içerik elle paylaşıldı olarak işaretli değil")
    with _plock(pid):
        _clear(pid)
    core.log_activity("YouTube elle paylaşım işareti kaldırıldı", post=pid, kind="info")
    post_changed(pid)


# ---------- views ----------

def _progress(u):
    return {k: u.get(k) for k in ("phase", "pct", "sent", "total", "speed", "eta")}


def _note(p, y, st, c):
    if y.get("manual") and st in ("scheduled", "published"):
        at = core.parse_time(y.get("at")) if y.get("at") else None
        return f"YouTube'da elle planlandı · {_nice(at)}" if st == "scheduled" and at and at > _now() else "YouTube'da elle paylaşıldı"
    if st == "queued":
        code = y.get("code")
        if code == "quota":
            return f"Kota doldu, {_nice(reset_at())} sonra yüklenecek"
        if code == "reconnect":
            return "YouTube bağlantısı yenilenince yüklenecek"
        if code == "wait" and p.get("schedule"):
            at = core.parse_time(p["schedule"]) - dt.timedelta(hours=int(c.get("upload_ahead_hours") or DEFAULTS["upload_ahead_hours"]))
            return f"YouTube'a {_nice(at)} civarı yüklenecek"
        return "YouTube yüklemesi sırada"
    if st == "uploading":
        return "YouTube'a yükleniyor"
    if st == "scheduled":
        if y.get("hold"):
            return "YouTube'a yüklendi, yayın saati ayarlanıyor"
        at = core.parse_time(y.get("at")) if y.get("at") else None
        if at and at > _now():
            return f"YouTube'da planlandı · {_nice(at)}"
        return "YouTube'da yayına giriyor"
    if st == "published":
        return "YouTube'da yayında"
    return None


def view(p, c=None):
    c = c or _view_conf()
    if not connected(c) or (p.get("kind") or "reels") != "reels":
        return None
    y = p.get("youtube") or {}
    u = _uploads.get(p["id"])
    active = bool(u and u["phase"] in ACTIVE)
    st = "uploading" if active else y.get("state")
    at = y.get("at") or (p.get("schedule") if st == "queued" else None)
    return {"enabled": _enabled(p, c), "state": st, "progress": _progress(u) if active else None, "url": y.get("url"),
            "at": at, "error": y.get("error") if st in ("error", "private_locked", "deleted") else None, "code": y.get("code"),
            "title": y.get("title"), "default_title": default_title(p), "note": _note(p, y, st, c), "video_id": y.get("video_id"),
            "manual": bool(y.get("manual"))}


def post_info(p):
    c = conf()
    v = view(p, c)
    if v is None:
        return None
    v.update(description=(p.get("youtube") or {}).get("description"), default_description=default_description(p),
             needs_reconnect=needs_reconnect())
    return v


def _jobs(c):
    out = []
    week = (_now() - dt.timedelta(days=7)).isoformat(timespec="seconds")
    for p in core.list_posts():
        v = view(p, c)
        if not v or not v["state"]:
            continue
        y = p.get("youtube") or {}
        if v["state"] == "published" and (y.get("published_at") or "") < week:
            continue
        out.append({"pid": p["id"], "title": p.get("title") or p["id"], "yt_title": _title(p), "thumb": cloud._thumb(p["id"]),
                    "at": v["at"], "state": v["state"], "progress": v["progress"], "url": v["url"], "error": v["error"],
                    "code": v["code"], "note": v["note"], "video_id": v["video_id"]})
    out.sort(key=lambda x: x.get("at") or "")
    return out


def _channel_view(ch):
    if not isinstance(ch, dict) or not ch.get("thumb"):
        return ch
    return dict(ch, thumb=re.sub(r"=s\d+(?=-|$)", "=s240", ch["thumb"]))


def public(port=None):
    c = conf()
    s = _load()
    on = connected(c)
    with _lock:
        events = list(reversed(s.get("events") or []))
    return {"configured": configured(c), "connected": on, "client_id": c["client_id"] or None,
            "channel": _channel_view(c["channel"]) if on else None, "connected_at": c["connected_at"] or None, "audited": bool(c["audited"]),
            "auto": bool(c["auto"]), "category": str(c["category"] or "22"), "synthetic": bool(c["synthetic"]),
            "quota": quota_info(c), "needs_reconnect": bool(on and s.get("needs_reconnect")),
            "upload_ahead_hours": int(c["upload_ahead_hours"] or DEFAULTS["upload_ahead_hours"]),
            "jobs": _jobs(c) if on else [], "events": events, "redirect_uri": redirect_uri(port) if port else None,
            "last_sync": s.get("last_sync")}


def brief(posts=None):
    c = conf()
    if not connected(c):
        return {"configured": configured(c), "connected": False, "channel_title": None, "audited": bool(c["audited"]),
                "uploading": 0, "queued": 0, "errors": 0, "uploads_left": None, "needs_reconnect": False}
    posts = core.list_posts() if posts is None else posts
    states = [(p.get("youtube") or {}).get("state") for p in posts if (p.get("kind") or "reels") == "reels"]
    return {"configured": True, "connected": True, "channel_title": (c["channel"] or {}).get("title"), "audited": bool(c["audited"]),
            "uploading": sum(1 for pid in list(_uploads) if _active(pid)), "queued": states.count("queued"),
            "errors": states.count("error"), "uploads_left": quota_info(c)["uploads_left"], "needs_reconnect": needs_reconnect()}


def public_settings(raw):
    yt = {**DEFAULTS, **(raw if isinstance(raw, dict) else {})}
    out = {k: v for k, v in yt.items() if k not in SECRETS}
    out.update(has_client=configured(yt), connected=connected(yt))
    return out
