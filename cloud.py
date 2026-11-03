import collections
import datetime as dt
import hashlib
import json
import re
import secrets
import subprocess
import threading
import time
import traceback
import urllib.error
import urllib.request

import core
import instagram

API = "https://api.cloudflare.com/client/v4"
WORKER_FILE = core.ROOT / "cloud" / "worker.js"
DEFAULT_WORKER = "sosyal-studyo-yayin"
COMPAT_DATE = "2025-01-01"
UA = "SosyalStudyo/1.0"
CHUNK = 4 << 20
MAX_CHUNK = 20 << 20
MAX_CHUNKS = 25
MAX_VIDEO = 2 << 30
SYNC_EVERY = 60
USAGE_EVERY = 600
MIN_LEAD = 180
LIMITS = {"requests": 100000, "kv_reads": 100000, "kv_writes": 1000, "kv_deletes": 1000, "kv_lists": 1000, "storage": 1073741824}
LIVE = ("uploading", "ready", "preparing", "publishing", "error")
HOLDS = ("ready", "preparing", "publishing", "published")
LOCAL = ("failed", "removed")
PANEL_VERSION = 2
SITE_VERSION = 3
PANEL_ITER = 6000
SNAP_EVERY = 1800
SNAP_MIN = 120
THUMB_W = 360
THUMB_MAX = 300 * 1024
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
EMPTY = {"enabled": False, "account_id": "", "api_token": "", "worker": "", "kv_id": "", "subdomain": "", "url": "", "key": "",
         "version": 0, "connected_at": "", "ig_sig": "", "panel": None}
STEPS = (("verify", "API anahtarı doğrulanıyor"), ("account", "Cloudflare hesabı seçiliyor"),
         ("kv", "Video deposu (KV) hazırlanıyor"), ("script", "Yayın programı yükleniyor"),
         ("cron", "Dakikalık zamanlayıcı kuruluyor"), ("subdomain", "workers.dev adresi açılıyor"),
         ("ping", "Bulut bağlantısı deneniyor"))
STAGES = {"ready": "Bulutta, PC kapalıyken de paylaşılır", "preparing": "Bulutta, Instagram'a hazırlanıyor",
          "publishing": "Bulutta yayınlanıyor"}

_lock = threading.RLock()
_sync_lock = threading.Lock()
_panel_lock = threading.Lock()
_toggle_lock = threading.Lock()
_snap_lock = threading.Lock()
_gate = threading.Semaphore(1)
_pid_locks = collections.defaultdict(threading.Lock)
_uploads = {}
_connect = None
_choice = None
_pending_token = None
_store = None
_last_tick = 0.0
_redeploy_at = 0.0
_thumb_fail = {}


class CloudError(Exception):
    def __init__(self, msg, status=None, code=None, data=None):
        super().__init__(msg)
        self.status = status
        self.code = code
        self.data = data or {}


class _Canceled(Exception):
    pass


# ---------- settings / store ----------

def conf():
    return {**EMPTY, **(core.settings().get("cloud") or {})}


def configured(c=None):
    c = c or conf()
    return bool(c["url"] and c["key"])


def active(c=None):
    c = c or conf()
    return configured(c) and bool(c["enabled"])


def save(patch):
    core.save_settings({"cloud": patch})


def bundled_version():
    m = re.search(r"const VERSION = (\d+)", WORKER_FILE.read_text(encoding="utf-8"))
    return int(m.group(1)) if m else 0


def worker_url(worker, subdomain):
    return f"https://{worker}.{subdomain}.workers.dev"


def _load():
    global _store
    if _store is None:
        _store = core.read_json(core.DATA / "bulut.json", None) or {}
        for k, v in (("events", []), ("remote", None), ("status", None), ("last_sync", None), ("usage", None), ("usage_at", 0)):
            _store.setdefault(k, v)
    return _store


def _persist():
    with _lock:
        core.write_json(core.DATA / "bulut.json", _load())


def event(text, kind="info"):
    with _lock:
        s = _load()
        s["events"] = (s["events"] + [{"at": core.now(), "text": text, "kind": kind}])[-50:]
        _persist()


def to_utc(local):
    t = local if isinstance(local, dt.datetime) else core.parse_time(local)
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_local(utc):
    if not utc:
        return None
    t = dt.datetime.fromisoformat(str(utc).replace("Z", "+00:00"))
    return t.astimezone().replace(tzinfo=None).isoformat(timespec="seconds")


def _mb(n):
    return f"{(n or 0) / 1048576:.1f}".replace(".", ",") + " MB"


# ---------- HTTP ----------

def _cf_message(raw, status):
    try:
        errs = json.loads(raw).get("errors") or []
    except (ValueError, AttributeError):
        errs = []
    code = errs[0].get("code") if errs else None
    msg = (errs[0].get("message") if errs else None) or (raw or b"")[:200].decode("utf-8", "replace") or f"HTTP {status}"
    if status == 401 or code in (1000, 6111, 9106, 9109):
        return f"API anahtarı geçersiz ya da süresi dolmuş ({msg})", code
    if status == 403 or code == 10000:
        return f"API anahtarının bu işlem için izni yok ({msg})", code
    return f"Cloudflare hatası: {msg}", code


def cf_raw(method, path, token, body=None, data=None, ctype=None, timeout=60):
    headers = {"Authorization": f"Bearer {token}", "User-Agent": UA}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        ctype = "application/json"
    if ctype:
        headers["Content-Type"] = ctype
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except urllib.error.HTTPError as e:
        raw = e.read()
        msg, code = _cf_message(raw, e.code)
        raise CloudError(msg, e.code, code) from None
    except (urllib.error.URLError, OSError) as e:
        raise CloudError(f"Cloudflare'e bağlanılamadı: {getattr(e, 'reason', e)}") from None
    try:
        return json.loads(raw or b"{}")
    except ValueError:
        raise CloudError("Cloudflare'den anlaşılmayan yanıt geldi") from None


def cf(method, path, token, **kw):
    j = cf_raw(method, path, token, **kw)
    if j.get("success") is False:
        msg, code = _cf_message(json.dumps(j).encode(), 200)
        raise CloudError(msg, 200, code)
    return j.get("result")


def wapi(method, path, body=None, c=None, timeout=60, reader=None, length=None, raw=None, ctype=None):
    c = c or conf()
    headers = {"X-Studio-Key": c["key"], "User-Agent": UA}
    data = None
    if reader is not None:
        data = reader
        headers["Content-Type"] = "application/octet-stream"
        headers["Content-Length"] = str(length)
    elif raw is not None:
        data = raw
        headers["Content-Type"] = ctype or "application/octet-stream"
    elif body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(c["url"] + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read())
        except ValueError:
            j = {}
        msg = j.get("error") or f"HTTP {e.code}"
        if e.code == 401:
            msg = "bulut anahtarı tutmuyor (yeniden bağlan)"
        raise CloudError(msg, e.code, None, j) from None
    except (urllib.error.URLError, OSError) as e:
        raise CloudError(f"buluta ulaşılamadı: {getattr(e, 'reason', e)}") from None


def ping(c=None):
    t0 = time.time()
    wapi("GET", "/api/ping", c=c, timeout=20)
    return int((time.time() - t0) * 1000)


# ---------- deploy ----------

def _safe_worker(name):
    name = re.sub(r"[^a-z0-9-]+", "-", (name or "").lower()).strip("-")[:60]
    return name if re.match(r"^[a-z]", name or "") else default_worker()


def default_worker():
    return DEFAULT_WORKER + (f"-{core.OTURUM}" if core.OTURUM else "")


def _check_worker(name):
    if not core.OTURUM:
        return name
    home = (core.read_json(core.HOME / "settings.json", {}) or {}).get("cloud") or {}
    if name == (home.get("worker") or DEFAULT_WORKER):
        raise ValueError("Bu ad ana stüdyonun bulut yayıncısına ait; bu oturum için başka bir ad seç")
    return name


def _new_connect(redeploy=False):
    c = conf()
    prev = int((_load().get("remote") or {}).get("version") or c["version"] or 0) if configured(c) else 0
    return {"steps": [{"id": i, "label": label, "state": "wait", "detail": ""} for i, label in STEPS], "error": None,
            "running": True, "done": False, "current": None, "started": core.now(), "finished": None, "_end": 0,
            "redeploy": bool(redeploy), "from_version": prev or None, "version": None}


def _step(sid, state, detail=None):
    with _lock:
        if not _connect:
            return
        if state == "run":
            _connect["current"] = sid
        for s in _connect["steps"]:
            if s["id"] == sid:
                s["state"] = state
                if detail is not None:
                    s["detail"] = detail


def _finish(error=None):
    with _lock:
        if _connect:
            _connect.update(running=False, done=not error, error=error, finished=core.now(), _end=time.time())


def _multipart(meta, code):
    b = "----SosyalStudyo" + secrets.token_hex(12)
    body = (f'--{b}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n'.encode()
            + json.dumps(meta).encode() + b"\r\n"
            + f'--{b}\r\nContent-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n'
              f'Content-Type: application/javascript+module\r\n\r\n'.encode()
            + code.encode("utf-8") + b"\r\n" + f"--{b}--\r\n".encode())
    return body, f"multipart/form-data; boundary={b}"


def _verify(token, account_id):
    try:
        r = cf("GET", "/user/tokens/verify", token) or {}
        if r.get("status") not in (None, "active"):
            raise CloudError(f"API anahtarı etkin değil ({r.get('status')})")
    except CloudError:
        if not account_id:
            raise
        cf("GET", f"/accounts/{account_id}/tokens/verify", token)


def _subdomain(token, acc):
    try:
        r = cf("GET", f"/accounts/{acc}/workers/subdomain", token) or {}
        if r.get("subdomain"):
            return r["subdomain"], False
    except CloudError as e:
        if e.status not in (404, 200) and e.code != 10007:
            raise
    last = None
    for _ in range(3):
        name = "studyo-" + secrets.token_hex(4)
        try:
            r = cf("PUT", f"/accounts/{acc}/workers/subdomain", token, body={"subdomain": name}) or {}
            return r.get("subdomain") or name, True
        except CloudError as e:
            if e.status in (401, 403):
                raise
            last = e
    raise last


def _finalize(c, wait=150):
    t0 = time.time()
    while True:
        try:
            ms = ping(c)
            wapi("PUT", "/api/meta", {"origin": c["url"], "deployed": to_utc(dt.datetime.now())}, c=c)
            push_ig(c)
            break
        except CloudError as e:
            if time.time() - t0 > wait:
                raise CloudError(f"Kurulum tamam ama adrese henüz ulaşılamıyor ({e}). Yeni workers.dev adresinin açılması "
                                 "birkaç dakika sürebilir; biraz sonra 'Şimdi eşitle'ye bas.") from None
            _step("ping", "run", f"Adres açılıyor, bekleniyor ({int(time.time() - t0)} sn)")
            time.sleep(5)
    if panel_conf(c):
        try:
            push_panel(c)
        except CloudError as e:
            event(f"Uzaktan takip ayarı buluta gönderilemedi: {e}", "warn")
    if site_conf() and int(c["version"] or 0) >= SITE_VERSION:
        try:
            push_site(c)
        except CloudError as e:
            core.save_settings({"site": {"push_error": str(e)}})
            event(f"Yasal sayfalar buluta gönderilemedi: {e}", "warn")
    return ms


def _deploy(token, account_id, worker, redeploy=False):
    global _choice, _pending_token
    cur = conf()
    if not redeploy:
        _pending_token = token
    try:
        _step("verify", "run")
        _verify(token, account_id or cur["account_id"])
        _step("verify", "ok", "Anahtar geçerli")
        _step("account", "run")
        acc = account_id or (cur["account_id"] if redeploy else "")
        name = acc
        if not acc:
            accounts = cf("GET", "/accounts?per_page=50", token) or []
            if not accounts:
                raise CloudError("Bu anahtar hiçbir Cloudflare hesabına erişemiyor")
            if len(accounts) > 1:
                with _lock:
                    _choice = [{"id": a["id"], "name": a.get("name") or a["id"]} for a in accounts]
                _pending_token = token
                _step("account", "wait", "Birden fazla hesap var, kullanılacak hesabı seç")
                _finish("Birden fazla Cloudflare hesabı bulundu; kullanılacak hesabı seç.")
                return
            acc, name = accounts[0]["id"], accounts[0].get("name") or accounts[0]["id"]
        with _lock:
            _choice = None
        _step("account", "ok", name)
        _step("kv", "run")
        title = worker
        found = None
        for page in range(1, 6):
            items = cf("GET", f"/accounts/{acc}/storage/kv/namespaces?per_page=100&page={page}", token) or []
            found = next((n for n in items if n.get("title") == title), None)
            if found or len(items) < 100:
                break
        ns = found or cf("POST", f"/accounts/{acc}/storage/kv/namespaces", token, body={"title": title})
        _step("kv", "ok", "Var olan depo kullanılıyor" if found else "Yeni depo açıldı")
        _step("script", "run")
        same = cur["key"] and cur["worker"] == worker and cur["account_id"] == acc
        key = cur["key"] if same else secrets.token_urlsafe(32)
        meta = {"main_module": "worker.js", "compatibility_date": COMPAT_DATE,
                "bindings": [{"type": "kv_namespace", "name": "STORE", "namespace_id": ns["id"]},
                             {"type": "secret_text", "name": "STUDIO_KEY", "text": key}]}
        body, ctype = _multipart(meta, WORKER_FILE.read_text(encoding="utf-8"))
        cf("PUT", f"/accounts/{acc}/workers/scripts/{worker}", token, data=body, ctype=ctype, timeout=120)
        version = bundled_version()
        _step("script", "ok", f"Sürüm {version}")
        _step("cron", "run")
        cf("PUT", f"/accounts/{acc}/workers/scripts/{worker}/schedules", token, body=[{"cron": "* * * * *"}])
        _step("cron", "ok", "Her dakika kontrol eder")
        _step("subdomain", "run")
        sub, created = _subdomain(token, acc)
        cf("POST", f"/accounts/{acc}/workers/scripts/{worker}/subdomain", token, body={"enabled": True})
        url = worker_url(worker, sub)
        _step("subdomain", "ok", url)
        save({"enabled": cur["enabled"] if redeploy else True, "account_id": acc, "api_token": token, "worker": worker,
              "kv_id": ns["id"], "subdomain": sub, "url": url, "key": key, "version": version,
              "connected_at": cur["connected_at"] if redeploy and cur["connected_at"] else core.now(),
              "ig_sig": cur["ig_sig"] if same else ""})
        _pending_token = None
        _step("ping", "run")
        ms = _finalize(conf(), 240 if created else 150)
        _step("ping", "ok", f"Yanıt {ms} ms")
        with _lock:
            prev = (_connect or {}).get("from_version")
            if _connect:
                _connect["version"] = version
            r = _load().get("remote")
            if r:
                r["version"] = version
        if not redeploy:
            event(f"Bulut yayın bağlandı: {url}", "connect")
        elif prev and prev != version:
            event(f"Bulut güncellendi: sürüm {prev} → {version}", "deploy")
        else:
            event(f"Bulut servisi yeniden kuruldu (sürüm {version}, zaten günceldi)", "deploy")
        _finish(None)
        kick()
    except Exception as e:  # noqa: BLE001
        if not isinstance(e, CloudError):
            traceback.print_exc()
        with _lock:
            sid = (_connect or {}).get("current") or "verify"
        _step(sid, "error", str(e))
        _finish(str(e))
        event(f"Bulut kurulumu tamamlanamadı: {e}", "error")


def _start_deploy(token, account_id, worker, redeploy):
    global _connect
    with _lock:
        if _connect and _connect["running"]:
            raise ValueError("kurulum zaten sürüyor")
        _connect = _new_connect(redeploy)
    threading.Thread(target=_deploy, args=(token, account_id, worker, redeploy), daemon=True).start()


def connect(api_token=None, account_id=None, worker=None):
    c = conf()
    token = (api_token or "").strip() or _pending_token or c["api_token"]
    if not token:
        raise ValueError("Cloudflare API anahtarı boş")
    if len(token) < 20 or not token.isascii() or any(ch.isspace() for ch in token):
        raise ValueError("Yapıştırılan metin bir Cloudflare API anahtarına benzemiyor (boşluksuz tek satır olmalı)")
    _start_deploy(token, (account_id or "").strip() or None, _check_worker(_safe_worker(worker or c["worker"] or default_worker())), False)


def redeploy():
    c = conf()
    if not configured(c) or not c["api_token"]:
        raise ValueError("bulut bağlı değil")
    _start_deploy(c["api_token"], c["account_id"], c["worker"] or default_worker(), True)


def disconnect(delete_remote=False):
    global _choice, _pending_token, _connect
    c = conf()
    for pid in list(_uploads):
        _cancel_upload(pid)
    notes = []
    if configured(c):
        try:
            st = wapi("GET", "/api/status", c=c, timeout=20)
            for j in st.get("jobs") or []:
                wapi("DELETE", f"/api/jobs/{j['pid']}", c=c, timeout=30)
            wapi("PUT", "/api/config", {"token": ""}, c=c, timeout=20)
        except CloudError as e:
            notes.append(str(e))
        if panel_conf(c):
            try:
                wapi("DELETE", "/api/panel", c=c, timeout=20)
            except CloudError as e:
                if e.status != 404:
                    notes.append(str(e))
        if site_conf():
            try:
                wapi("DELETE", "/api/site", c=c, timeout=20)
            except CloudError as e:
                if e.status != 404:
                    notes.append(str(e))
            core.save_settings({"site": {"pushed_at": None, "push_error": None}})
    if delete_remote and c["api_token"] and c["account_id"]:
        acc, token = c["account_id"], c["api_token"]
        if c["worker"]:
            try:
                cf("DELETE", f"/accounts/{acc}/workers/scripts/{c['worker']}?force=true", token)
            except CloudError as e:
                notes.append(str(e))
        if c["kv_id"]:
            try:
                cf("DELETE", f"/accounts/{acc}/storage/kv/namespaces/{c['kv_id']}", token)
            except CloudError as e:
                notes.append(str(e))
    for p in core.list_posts() + core.list_trash():
        if (p.get("cloud") or {}).get("state") not in (None, "published"):
            core.update_post(p["id"], lambda q: q.update(cloud=None))
    save(dict(EMPTY))
    with _lock:
        s = _load()
        s.update(remote=None, status=None, usage=None, usage_at=0, last_sync=None)
        _reset_snap(s)
        _persist()
        _choice = None
        _pending_token = None
        _connect = None
    text = "Bulut bağlantısı kaldırıldı" + (" (Cloudflare'deki program ve depo silindi)" if delete_remote else "")
    event(text + (f" — not: {'; '.join(notes)}" if notes else ""), "cancel")
    return notes


def _disabled_mark(q):
    cl = dict(q.get("cloud") or {})
    if q.get("status") == "planlandi" and q.get("schedule") and (q.get("kind") or "reels") == "reels":
        q["cloud"] = {"state": "removed", "code": "disabled", "reason": "Bulut yayını kapatılınca buluttan silindi",
                      "at": q.get("schedule"), "size": cl.get("size"), "removed_at": core.now()}
        q["stage"] = "Paylaşım planlandı (bu bilgisayardan)"
    else:
        q["cloud"] = None


def _switch_off(c):
    with _toggle_lock:
        for pid in list(_uploads):
            _cancel_upload(pid)
        t0 = time.time()
        while any(_upload_active(pid) for pid in list(_uploads)) and time.time() - t0 < 15:
            time.sleep(0.2)
        deleted = 0
        try:
            st = wapi("GET", "/api/status", c=c, timeout=20)
            for j in st.get("jobs") or []:
                if j.get("status") != "published":
                    wapi("DELETE", f"/api/jobs/{j['pid']}", c=c, timeout=30)
                    _drop_remote(j["pid"])
                    deleted += 1
        except CloudError as e:
            event(f"Buluttaki işler silinemedi: {e}", "warn")
        marked = 0
        for p in core.list_posts():
            cl = p.get("cloud") or {}
            if cl.get("state") in LIVE + ("failed",):
                core.update_post(p["id"], _disabled_mark)
                marked += 1
        if deleted or marked:
            event(f"Buluttaki {deleted} video silindi; {marked} planlı paylaşım bu bilgisayardan yapılacak", "cancel")


def _switch_on():
    with _toggle_lock:
        if not active():
            return
        todo = []
        for p in core.list_posts():
            cl = p.get("cloud") or {}
            if cl.get("state") == "removed" and cl.get("code") == "disabled" and not cl.get("manual"):
                if _wants(p) and not ineligible(p) and _seconds_left(p) > MIN_LEAD:
                    todo.append(p)
                elif p.get("status") != "planlandi":
                    core.update_post(p["id"], lambda q: q.update(cloud=None))
        todo.sort(key=lambda p: p["schedule"])
        for p in todo:
            core.update_post(p["id"], lambda q: q.update(cloud=None))
            request_upload(p["id"])
        if todo:
            event(f"{len(todo)} planlı video buluta yeniden yükleniyor", "upload")


def enable(on):
    c = conf()
    if not configured(c):
        raise ValueError("bulut bağlı değil")
    save({"enabled": bool(on)})
    if on:
        event("Bulut yayını açıldı", "ok")
        _spawn(_switch_on)
        kick()
        return
    event("Bulut yayını kapatıldı; planlı paylaşımlar bu bilgisayardan yapılacak", "warn")
    _spawn(_switch_off, c)


# ---------- posts ----------

def _sig(p):
    raw = f"{instagram.full_caption(p)}|{p.get('thumb_offset') or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _vsig(p):
    files = instagram.media_files(p)
    if not files or not files[0].exists():
        return ""
    st = files[0].stat()
    return f"{st.st_size}:{int(st.st_mtime)}"


def _stable_vsig(p):
    cur = _vsig(p)
    return cur if cur and time.time() - int(cur.split(":")[1]) >= 90 else ""


def _video_changed(p, cl):
    if cl.get("state") not in ("ready", "error"):
        return False
    cur = _stable_vsig(p)
    if not cur:
        return False
    if cl.get("vsig"):
        return cl["vsig"] != cur
    up = core.parse_time(cl["uploaded_at"]) if cl.get("uploaded_at") else None
    return bool(up and int(cur.split(":")[1]) > up.timestamp() + 1)


def _ig_sig(ig):
    raw = f"{ig.get('token') or ''}|{ig.get('user_id') or ''}|{ig.get('api_version') or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def ineligible(p):
    if (p.get("kind") or "reels") != "reels":
        return "kind"
    files = instagram.media_files(p)
    if not files or not files[0].exists():
        return "video dosyası yok"
    if files[0].suffix.lower() not in (".mp4", ".mov"):
        return "video türü desteklenmiyor"
    if files[0].stat().st_size > MAX_VIDEO:
        return "video 2 GB'den büyük"
    return None


def _wants(p, c=None):
    return bool(p and not p.get("deleted") and p.get("status") == "planlandi" and p.get("schedule")
                and (p.get("kind") or "reels") == "reels" and core.ig_on(p) and active(c))


def _seconds_left(p):
    at = core.parse_time(p.get("schedule"))
    return (at - dt.datetime.now()).total_seconds() if at else -1


def _upload_active(pid):
    u = _uploads.get(pid)
    return bool(u and u["phase"] in ("queued", "compress", "hash", "upload", "retry", "finalize"))


def _cancel_upload(pid):
    u = _uploads.get(pid)
    if u and _upload_active(pid):
        u["cancel"] = True


def _set_cloud(pid, **kw):
    def fn(q):
        cur = dict(q.get("cloud") or {})
        cur.update(kw)
        q["cloud"] = cur
    return core.update_post(pid, fn)


def chunk_plan(size):
    cs = CHUNK
    while -(-size // cs) > MAX_CHUNKS:
        cs += 1 << 20
    if cs > MAX_CHUNK:
        raise ValueError("video bulut için çok büyük")
    return cs, max(1, -(-size // cs))


def _advance(prog, n):
    t = time.time()
    prog["sent"] += n
    total = prog["total"] or 1
    prog["pct"] = round(min(100.0, prog["sent"] * 100 / total), 1)
    win = prog.setdefault("_win", [])
    if not win or t - win[-1][0] >= 0.25:
        win.append((t, prog["sent"]))
        del win[:-24]
    if len(win) >= 2 and win[-1][0] - win[0][0] >= 1:
        speed = (win[-1][1] - win[0][1]) / (win[-1][0] - win[0][0])
    else:
        speed = prog["sent"] / max(0.2, t - (prog.get("started") or t))
    speed = max(0.0, speed)
    prog["speed"] = int(speed)
    prog["eta"] = int((total - prog["sent"]) / speed) if speed > 0 else None


class _Body:
    def __init__(self, fh, length, prog):
        self.fh, self.left, self.prog = fh, length, prog

    def read(self, n=-1):
        if self.prog.get("cancel"):
            raise _Canceled()
        n = self.left if n is None or n < 0 else min(n, self.left)
        data = self.fh.read(n) if n else b""
        self.left -= len(data)
        if data:
            _advance(self.prog, len(data))
        return data


def _put_chunk(c, pid, i, fh, offset, length, prog):
    for attempt in range(4):
        base = prog["sent"]
        fh.seek(offset)
        try:
            wapi("PUT", f"/api/jobs/{pid}/chunk/{i}", c=c, timeout=180, reader=_Body(fh, length, prog), length=length)
            prog["sent"] = base + length
            return
        except CloudError as e:
            prog["sent"] = base
            if (e.status and 400 <= e.status < 500 and e.status != 429) or attempt == 3:
                raise
            prog["phase"] = "retry"
            time.sleep(2 + attempt * 4)
            prog["phase"] = "upload"


def _job_cloud(job, at, sig, **extra):
    out = {"state": job["status"], "at": at, "size": job.get("size"), "chunks": job.get("chunks"),
           "error": job.get("error"), "job_updated": job.get("updated"), "sig": sig}
    out.update(extra)
    return out


SLIM_BITRATE = 12_000_000


def _probe(path):
    if not core.has_tool("ffprobe"):
        d, b = core.probe_fallback(path)
        return float(d or 0), b
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,bit_rate", "-of", "json", str(path)],
                         capture_output=True, text=True)
    try:
        f = json.loads(out.stdout)["format"]
        return float(f.get("duration") or 0), int(f.get("bit_rate") or 0)
    except (ValueError, KeyError):
        return 0.0, 0


def slim_copy(pid, src, prog):
    dur, rate = _probe(src)
    if rate and rate <= SLIM_BITRATE:
        return src
    out = core.DATA / "_bulut" / f"{pid}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        return out
    tmp = out.with_suffix(".tmp.mp4")
    prog.update(phase="compress", pct=0.0, sent=0, total=0, eta=None)
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
           "-maxrate", "10M", "-bufsize", "20M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
           "-progress", "pipe:1", "-nostats", str(tmp)]
    started = time.time()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in proc.stdout:
        if prog.get("cancel"):
            proc.kill()
            raise _Canceled()
        if line.startswith("out_time_us=") and dur:
            try:
                done = int(line.split("=", 1)[1]) / 1e6
            except ValueError:
                continue
            pct = max(0.0, min(99.0, done / dur * 100))
            el = time.time() - started
            prog.update(pct=round(pct, 1), eta=round(el / pct * (100 - pct)) if pct > 1 else None)
    if proc.wait() != 0 or not tmp.exists():
        err = (proc.stderr.read() or "").strip()[-300:]
        tmp.unlink(missing_ok=True)
        raise ValueError(f"video küçültülemedi: {err or 'ffmpeg hatası'}")
    tmp.replace(out)
    event(f"#{pid} Instagram kalitesinde küçültüldü: {_mb(src.stat().st_size)} → {_mb(out.stat().st_size)}", "upload")
    return out


def drop_slim(pid):
    (core.DATA / "_bulut" / f"{pid}.mp4").unlink(missing_ok=True)


def _upload_run(pid):
    prog = _uploads[pid]
    c = conf()
    try:
        with _gate:
            if prog["cancel"]:
                raise _Canceled()
            p = core.load_post(pid)
            if not _wants(p, c) or ineligible(p):
                raise _Canceled()
            vsig0 = _vsig(p)
            f = slim_copy(pid, instagram.media_files(p)[0], prog)
            at0, sig0 = p["schedule"], _sig(p)
            size = f.stat().st_size
            cs, n = chunk_plan(size)
            prog.update(phase="hash", total=size)
            h = hashlib.sha256()
            with open(f, "rb") as fh:
                while chunk := fh.read(1 << 20):
                    h.update(chunk)
            prog.update(phase="upload")
            event(f"#{pid} buluta yükleniyor ({_mb(size)})", "upload")
            wapi("POST", "/api/jobs", {"pid": pid, "title": p.get("title") or pid, "at": to_utc(p["schedule"]),
                                       "caption": instagram.full_caption(p), "thumb_offset": p.get("thumb_offset") or None,
                                       "size": size, "chunks": n, "chunk_size": cs, "sha256": h.hexdigest()}, c=c)
            _set_cloud(pid, state="uploading", at=at0, size=size, chunks=n, sig=sig0, vsig=vsig0, error=None)
            prog.update(phase="upload", sent=0, started=time.time(), _win=[])
            with open(f, "rb") as fh:
                for i in range(n):
                    _put_chunk(c, pid, i, fh, i * cs, min(cs, size - i * cs), prog)
            prog.update(phase="finalize", pct=100.0, eta=0)
            job = wapi("POST", f"/api/jobs/{pid}/ready", c=c)["job"]
        p = core.update_post(pid, lambda q: q.update(
            cloud=_job_cloud(job, at0, sig0, uploaded_at=core.now(), attempts=0, vsig=vsig0),
            stage=STAGES["ready"] if q.get("status") == "planlandi" else q.get("stage")))
        prog.update(phase="done", finished=time.time())
        drop_slim(pid)
        event(f"Buluta yüklendi: #{pid} {p.get('title') or ''} ({_mb(size)})", "uploaded")
        core.log_activity("Video buluta yüklendi; PC kapalıyken de paylaşılacak", post=pid, kind="schedule")
        if _worker_version(c) >= PANEL_VERSION:
            _send_thumb(pid, c)
        _reconcile_post(pid)
        sync()
    except _Canceled:
        _delete_quiet(pid, c)
        prog.update(phase="canceled", finished=time.time())
    except Exception as e:  # noqa: BLE001
        if not isinstance(e, (CloudError, ValueError, OSError)):
            traceback.print_exc()
        _delete_quiet(pid, c)
        try:
            p = core.load_post(pid) or {}
            tries = int((p.get("cloud") or {}).get("attempts") or 0) + 1
            code = "no_space" if isinstance(e, CloudError) and e.status == 507 else ("too_big" if "çok büyük" in str(e) else "upload_failed")
            _set_cloud(pid, state="failed", error=str(e), code=code, error_stage="uploading", attempts=tries, failed_at=core.now())
        except KeyError:
            pass
        prog.update(phase="error", error=str(e), finished=time.time())
        event(f"#{pid} buluta yüklenemedi: {e}", "error")
        core.log_activity(f"Buluta yüklenemedi: {e} (paylaşım bu bilgisayardan yapılacak)", post=pid, kind="error")
    finally:
        t = threading.Timer(120, lambda: _uploads.get(pid) is prog and not _upload_active(pid) and _uploads.pop(pid, None))
        t.daemon = True
        t.start()


def job_at_local(job):
    loc = to_local(job.get("at"))
    return loc[:16] if loc else None


def request_upload(pid):
    with _lock:
        if _upload_active(pid):
            return False
        _uploads[pid] = {"phase": "queued", "sent": 0, "total": 0, "pct": 0.0, "speed": 0, "eta": None,
                         "started": time.time(), "cancel": False, "error": None}
    p = core.load_post(pid)
    _set_cloud(pid, state="uploading", at=p.get("schedule"), error=None)
    threading.Thread(target=_upload_run, args=(pid,), daemon=True).start()
    return True


def _delete_quiet(pid, c=None):
    c = c or conf()
    if not configured(c):
        return False
    try:
        wapi("DELETE", f"/api/jobs/{pid}", c=c, timeout=30)
        return True
    except CloudError as e:
        event(f"#{pid} buluttan silinemedi: {e}", "warn")
        return False


def _drop_remote(pid):
    with _lock:
        r = _load().get("remote")
        if r and r.get("jobs"):
            r["jobs"] = [j for j in r["jobs"] if j.get("pid") != pid]


def _reconcile_post(pid, allow_upload=False):
    with _pid_locks[pid]:
        p = core.load_post(pid)
        if not p:
            return
        c = conf()
        cl = p.get("cloud") or {}
        st = cl.get("state")
        want = _wants(p, c)
        if _upload_active(pid):
            if not want:
                _cancel_upload(pid)
            return
        if st in LIVE:
            if not want:
                _release(pid, c)
                return
            vchanged = _video_changed(p, cl)
            if not vchanged and not cl.get("vsig") and st in ("ready", "error") and _stable_vsig(p):
                _set_cloud(pid, vsig=_stable_vsig(p))
            if not vchanged and cl.get("at") == p["schedule"] and cl.get("sig") == _sig(p):
                return
            if st in ("ready", "error", "uploading") and not vchanged:
                try:
                    r = wapi("PATCH", f"/api/jobs/{pid}", {"at": to_utc(p["schedule"]), "caption": instagram.full_caption(p),
                                                           "thumb_offset": p.get("thumb_offset") or None,
                                                           "title": p.get("title") or pid}, c=c)
                    _set_cloud(pid, at=p["schedule"], sig=_sig(p), job_updated=r["job"]["updated"])
                    if r.get("changed"):
                        event(f"#{pid} bulutta güncellendi", "sync")
                    return
                except CloudError as e:
                    if e.status not in (404, 409):
                        event(f"#{pid} bulutta güncellenemedi: {e}", "warn")
                        return
            if st == "publishing":
                return
            _delete_quiet(pid, c)
            _drop_remote(pid)
            core.update_post(pid, lambda q: q.update(cloud=None))
            if _seconds_left(p) > MIN_LEAD:
                event(f"#{pid} değişti, buluta yeniden yükleniyor", "upload")
                request_upload(pid)
            else:
                event(f"#{pid} değişti; saate az kaldığı için bu bilgisayardan paylaşılacak", "warn")
            return
        if allow_upload and want and not (st == "removed" and cl.get("manual")) and not ineligible(p) and _seconds_left(p) > MIN_LEAD:
            request_upload(pid)


def _release(pid, c=None):
    _cancel_upload(pid)
    p = core.load_post(pid)
    if p and (p.get("cloud") or {}).get("state") in LIVE + ("failed",):
        core.update_post(pid, lambda q: q.update(cloud=None))
    if _delete_quiet(pid, c):
        _drop_remote(pid)


def _spawn(fn, *args):
    def run():
        try:
            fn(*args)
        except Exception:  # noqa: BLE001
            traceback.print_exc()
    threading.Thread(target=run, daemon=True).start()


def post_scheduled(pid):
    if active():
        _spawn(_reconcile_post, pid, True)


def post_changed(pid):
    if configured():
        _spawn(_reconcile_post, pid, False)


def post_released(pid):
    if not configured():
        return
    p = core.load_post(pid)
    if not p:
        return
    st = (p.get("cloud") or {}).get("state")
    if st in LIVE + ("failed",) or _upload_active(pid):
        _cancel_upload(pid)
        core.update_post(pid, lambda q: q.update(cloud=None))
        _spawn(_release, pid, None)


def owns(p, now):
    st = (p.get("cloud") or {}).get("state")
    if not st or st in LOCAL or not configured():
        return False
    late = (now - core.parse_time(p["schedule"])).total_seconds()
    if st == "uploading":
        return late < 120
    if st == "ready" and late > 600:
        s = _load()
        checked = (s.get("status") or {}).get("checked")
        fresh = (s.get("status") or {}).get("ok") and checked and (now - core.parse_time(checked)).total_seconds() < 180
        return not fresh
    return st in HOLDS


def fallback(p):
    cl = p.get("cloud") or {}
    st = cl.get("state")
    if not st or st == "removed":
        return
    pid = p["id"]
    why = {"error": f"bulutta hata: {cl.get('error') or 'bilinmiyor'}", "uploading": "yükleme zamanında bitmedi",
           "failed": f"buluta yüklenemedi: {cl.get('error') or 'bilinmiyor'}", "ready": "bulut zamanında başlamadı"}.get(st, st)
    _cancel_upload(pid)
    _set_cloud(pid, state="removed", code="canceled", reason="Bulut paylaşamadı, bu bilgisayardan paylaşıldı", error=cl.get("error"),
               error_stage=cl.get("error_stage") or ("uploading" if st in ("uploading", "failed") else st))
    if st != "failed":
        _spawn(_release_remote, pid)
    core.log_activity(f"Bulut paylaşamadı ({why}), bu bilgisayardan paylaşılıyor", post=pid, kind="publish")
    event(f"#{pid} bu bilgisayardan paylaşılıyor: {why}", "warn")


def _release_remote(pid):
    if _delete_quiet(pid):
        _drop_remote(pid)


def view(p):
    cl = p.get("cloud") or {}
    st = cl.get("state")
    if not st:
        return None
    out = {k: cl.get(k) for k in ("at", "size", "uploaded_at", "error", "error_stage", "job_updated", "permalink", "published_at")}
    if st == "failed":
        out.update(state="error", local=True, code=cl.get("code") or "upload_failed", error_stage="uploading")
    elif st == "removed":
        out.update(state="canceled", local=True, code=cl.get("code") or "canceled", reason=cl.get("reason"))
    else:
        out["state"] = st
    u = _uploads.get(p["id"])
    out["upload"] = _progress(u) if u and _upload_active(p["id"]) else None
    if out["upload"]:
        out["state"] = "uploading"
    return out


def post_info(p):
    return view(p) if configured() else None


# ---------- sync ----------

def kick():
    global _last_tick
    _last_tick = 0.0
    if active():
        threading.Thread(target=sync, daemon=True).start()


def tick():
    global _last_tick
    if time.time() - _last_tick < SYNC_EVERY or not active():
        return
    _last_tick = time.time()
    threading.Thread(target=sync, daemon=True).start()


def _maybe_redeploy(c):
    global _redeploy_at
    if c["api_token"] and int(c["version"] or 0) < bundled_version() and time.time() - _redeploy_at > 3600:
        _redeploy_at = time.time()
        with _lock:
            busy = bool(_connect and _connect["running"])
        if not busy:
            try:
                _start_deploy(c["api_token"], c["account_id"], c["worker"] or default_worker(), True)
            except ValueError:
                pass


def sync(block=False):
    if not (_sync_lock.acquire(timeout=30) if block else _sync_lock.acquire(blocking=False)):
        return False
    try:
        c = conf()
        if not active(c):
            return False
        _maybe_redeploy(c)
        t0 = time.time()
        try:
            st = wapi("GET", "/api/status", c=c, timeout=30)
        except CloudError as e:
            with _lock:
                s = _load()
                was_ok = (s.get("status") or {}).get("ok") is not False
                s["status"] = {"ok": False, "checked": core.now(), "latency_ms": None, "error": str(e)}
                _persist()
            if was_ok:
                event(f"Buluta ulaşılamadı: {e}", "warn")
            return False
        latency = int((time.time() - t0) * 1000)
        with _lock:
            s = _load()
            if (s.get("status") or {}).get("ok") is False:
                event("Bulut bağlantısı yeniden kuruldu", "ok")
            s["status"] = {"ok": True, "checked": core.now(), "latency_ms": latency, "error": None}
            s["remote"] = st
        _apply_remote(c, st, t0)
        _sync_ig(c, st)
        if (st.get("meta") or {}).get("origin") != c["url"]:
            try:
                wapi("PUT", "/api/meta", {"origin": c["url"], "deployed": to_utc(dt.datetime.now())}, c=c)
            except CloudError:
                pass
        _reconcile_all(c)
        _backfill_thumb(c, st)
        _refresh_usage(c)
        with _lock:
            _load()["last_sync"] = core.now()
            _persist()
        maybe_snapshot(c)
        return True
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        return False
    finally:
        _sync_lock.release()


def _mark_published(p, j):
    pid = p["id"]
    res = {"id": j.get("media_id"), "permalink": j.get("permalink"), "at": to_local(j.get("published_at")) or core.now(),
           "kind": "reels", "cloud": True}
    done = {"v": False}

    def fn(q):
        if (q.get("published") or {}).get("cloud") and q.get("status") == "paylasildi":
            return
        done["v"] = True
        q.update(status="paylasildi", published=res, schedule=None, stage="Instagram'da yayında (bulut)", error=None,
                 after_render=None)
        cl = dict(q.get("cloud") or {})
        cl.update(state="published", published_at=res["at"], permalink=res["permalink"], error=None,
                  job_updated=j.get("updated"))
        q["cloud"] = cl
    core.update_post(pid, fn)
    if done["v"]:
        core.log_activity("Bulut üzerinden paylaşıldı", post=pid, kind="publish")
        core.log_activity("Instagram'da yayınlandı", post=pid, kind="done")
        event(f"Yayınlandı: #{pid} {p.get('title') or ''}", "published")


def _busy(pid, since):
    u = _uploads.get(pid)
    return bool(u) and (_upload_active(pid) or (u.get("finished") or 0) >= since)


def _apply_remote(c, st, since):
    remote = {j["pid"]: j for j in st.get("jobs") or [] if j.get("pid")}
    posts = {p["id"]: p for p in core.list_trash() + core.list_posts()}
    for pid, j in remote.items():
        p = posts.get(pid)
        status = j.get("status")
        if status == "published":
            if p:
                _mark_published(p, j)
                if j.get("thumb") is False and int(st.get("version") or 0) >= PANEL_VERSION:
                    _send_thumb(pid, c)
            if _delete_quiet(pid, c):
                _drop_remote(pid)
            continue
        if _busy(pid, since):
            continue
        cl = (p or {}).get("cloud") or {}
        if not _wants(p, c) or cl.get("state") in LOCAL:
            if _delete_quiet(pid, c):
                _drop_remote(pid)
            if p and cl.get("state") in LIVE:
                core.update_post(pid, lambda q: q.update(cloud=None))
            continue
        if status == "uploading":
            if cl.get("state") not in (None, "uploading"):
                continue
            core.update_post(pid, lambda q: q.update(cloud=None))
            if _seconds_left(p) > MIN_LEAD:
                request_upload(pid)
            continue
        if cl.get("state") == status and cl.get("job_updated") == j.get("updated"):
            continue
        prev = cl.get("state")

        def fn(q, j=j, status=status):
            cur = dict(q.get("cloud") or {})
            cur.update(state=status, error=j.get("error"), error_stage=j.get("error_stage") if status == "error" else None,
                       job_updated=j.get("updated"), size=j.get("size"), chunks=j.get("chunks"))
            cur.setdefault("at", job_at_local(j))
            cur.setdefault("sig", _sig(q))
            q["cloud"] = cur
            if status in STAGES:
                q["stage"] = STAGES[status]
            elif status == "error":
                q["stage"] = f"Bulutta hata: {j.get('error') or 'bilinmiyor'}"
        core.update_post(pid, fn)
        if status == "error" and prev != "error":
            core.log_activity(f"Bulut paylaşımı hata verdi: {j.get('error') or 'bilinmiyor'}", post=pid, kind="error")
            event(f"#{pid} bulutta hata: {j.get('error')}", "error")
        elif status == "preparing" and prev != "preparing":
            event(f"#{pid} Instagram'a gönderildi, hazırlanıyor", "ready")
    for p in posts.values():
        pid = p["id"]
        st_local = (p.get("cloud") or {}).get("state")
        if pid in remote or _busy(pid, since) or st_local not in LIVE:
            continue
        if not _wants(p, c):
            core.update_post(pid, lambda q: q.update(cloud=None))
            continue
        try:
            job = wapi("POST", f"/api/jobs/{pid}/ready", c=c)["job"]
            if job.get("status") == "uploading":
                raise CloudError("eksik", 404)
            _set_cloud(pid, state=job["status"], error=job.get("error"), job_updated=job.get("updated"))
        except CloudError as e:
            if e.status not in (404, 409):
                continue
            core.update_post(pid, lambda q: q.update(cloud=None))
            if _wants(p, c) and not ineligible(p) and _seconds_left(p) > MIN_LEAD:
                event(f"#{pid} bulutta bulunamadı, yeniden yükleniyor", "warn")
                request_upload(pid)


def _reconcile_all(c):
    for p in core.list_posts() + core.list_trash():
        cl = p.get("cloud") or {}
        st = cl.get("state")
        if st in LIVE:
            if not _wants(p, c) or cl.get("at") != p.get("schedule") or cl.get("sig") != _sig(p) or not cl.get("vsig") or _video_changed(p, cl):
                _reconcile_post(p["id"])
        elif st == "failed" and _wants(p, c) and int(cl.get("attempts") or 0) < 3 and not _upload_active(p["id"]):
            failed = core.parse_time(cl.get("failed_at")) if cl.get("failed_at") else None
            if (not failed or (dt.datetime.now() - failed).total_seconds() > 300) and _seconds_left(p) > 300 and not ineligible(p):
                request_upload(p["id"])


def _sync_ig(c, st):
    ig = core.settings()["instagram"]
    w = st.get("ig") or {}
    if w.get("refreshed") and (ig.get("token") or "").startswith("IG"):
        wref = to_local(w["refreshed"])
        if wref > (ig.get("token_refreshed") or ""):
            try:
                cfg = wapi("GET", "/api/config", c=c)
            except CloudError:
                cfg = {}
            if cfg.get("token") and cfg["token"] != ig.get("token") and cfg.get("user_id") == ig.get("user_id"):
                core.save_settings({"instagram": {"token": cfg["token"], "token_refreshed": wref}})
                ig = core.settings()["instagram"]
                save({"ig_sig": _ig_sig(ig)})
                event("Instagram anahtarı bulutta yenilendi, stüdyoya alındı", "token")
                return
    if _ig_sig(ig) != c["ig_sig"]:
        try:
            push_ig(c)
            if ig.get("token"):
                event("Instagram bağlantısı buluta gönderildi", "token")
        except CloudError as e:
            event(f"Instagram bağlantısı buluta gönderilemedi: {e}", "warn")


def push_ig(c=None):
    c = c or conf()
    ig = core.settings()["instagram"]
    body = {"token": ig.get("token") or "", "user_id": ig.get("user_id") or "", "api_version": ig.get("api_version") or "",
            "updated": to_utc(ig["token_refreshed"]) if ig.get("token_refreshed") else None}
    wapi("PUT", "/api/config", body, c=c)
    save({"ig_sig": _ig_sig(ig)})


_Q_REQUESTS = """query ($acc: string!, $start: Time!, $end: Time!) { viewer { accounts(filter: {accountTag: $acc}) {
  workersInvocationsAdaptive(limit: 10000, filter: {datetime_geq: $start, datetime_leq: $end}) { sum { requests } } } } }"""
_Q_KV = """query ($acc: string!, $day: Date!) { viewer { accounts(filter: {accountTag: $acc}) {
  kvOperationsAdaptiveGroups(limit: 100, filter: {date_geq: $day, date_leq: $day}) { sum { requests } dimensions { actionType } } } } }"""


def _graphql(c, query, variables):
    try:
        j = cf_raw("POST", "/graphql", c["api_token"], body={"query": query, "variables": variables}, timeout=30)
    except CloudError:
        return None
    if j.get("errors") or not j.get("data"):
        return None
    accs = ((j["data"].get("viewer") or {}).get("accounts")) or []
    return accs[0] if accs else None


def usage(c=None):
    c = c or conf()
    if not c["api_token"] or not c["account_id"]:
        return None
    now = dt.datetime.now(dt.timezone.utc)
    day = now.strftime("%Y-%m-%d")
    a = _graphql(c, _Q_REQUESTS, {"acc": c["account_id"], "start": f"{day}T00:00:00Z", "end": now.strftime("%Y-%m-%dT%H:%M:%SZ")})
    k = _graphql(c, _Q_KV, {"acc": c["account_id"], "day": day})
    if a is None and k is None:
        return None
    ops = collections.Counter()
    alias = {"get": "read", "put": "write"}
    for row in (k or {}).get("kvOperationsAdaptiveGroups") or []:
        act = str((row.get("dimensions") or {}).get("actionType") or "").lower()
        ops[alias.get(act, act)] += int((row.get("sum") or {}).get("requests") or 0)
    req = sum(int((r.get("sum") or {}).get("requests") or 0) for r in (a or {}).get("workersInvocationsAdaptive") or [])
    kv = k is not None
    return {"date": day, "requests": req if a is not None else None, "kv_reads": ops["read"] if kv else None,
            "kv_writes": ops["write"] if kv else None, "kv_deletes": ops["delete"] if kv else None,
            "kv_lists": ops["list"] if kv else None}


def _refresh_usage(c, force=False):
    s = _load()
    if not force and time.time() - (s.get("usage_at") or 0) < USAGE_EVERY:
        return
    s["usage_at"] = time.time()
    s["usage"] = usage(c)


# ---------- actions ----------

def sync_now(wait=25):
    global _last_tick
    _last_tick = time.time()
    with _lock:
        _load()["usage_at"] = 0
    t = threading.Thread(target=sync, args=(True,), daemon=True)
    t.start()
    t.join(wait)


def job_action(pid, action):
    p = core.load_post(pid)
    if not p:
        raise KeyError(pid)
    c = conf()
    if not active(c):
        raise ValueError("bulut bağlı değil ya da kapalı")
    cl = p.get("cloud") or {}
    if action == "cancel":
        _cancel_upload(pid)
        if cl.get("state") in LIVE + ("failed",) or _upload_active(pid):
            _delete_quiet(pid, c)
            _drop_remote(pid)
        _set_cloud(pid, state="removed", code="canceled", reason="Buluttan kaldırıldı", manual=True, error=None)
        if p.get("status") == "planlandi":
            core.update_post(pid, lambda q: q.update(stage="Paylaşım planlandı (bu bilgisayardan)"))
        event(f"#{pid} buluttan kaldırıldı; bu bilgisayardan paylaşılacak", "cancel")
        return
    if action not in ("upload", "retry"):
        raise ValueError("bilinmeyen işlem")
    if not core.ig_on(p):
        raise ValueError("bu içerik Instagram'da paylaşılmayacak; buluta yüklenmez")
    reason = ineligible(p)
    if reason == "kind":
        raise ValueError("şimdilik yalnızca Reels videoları buluta yüklenebilir")
    if reason:
        raise ValueError(reason)
    if action == "retry" and cl.get("state") == "error":
        at = core.parse_time(p.get("schedule")) if p.get("schedule") else None
        soon = dt.datetime.now().replace(second=0, microsecond=0) + dt.timedelta(minutes=3)
        if not at or at < soon:
            at = soon
        sched = at.isoformat(timespec="minutes")
        try:
            r = wapi("POST", f"/api/jobs/{pid}/retry", {"at": to_utc(at)}, c=c)
            core.update_post(pid, lambda q: q.update(status="planlandi", schedule=sched, error=None, stage=STAGES["ready"]))
            core.update_post(pid, lambda q: q.update(cloud=_job_cloud(r["job"], sched, cl.get("sig") or _sig(q), vsig=cl.get("vsig"),
                                                                      uploaded_at=cl.get("uploaded_at"))))
            core.log_activity(f"Bulutta yeniden denenecek: {at.strftime('%d.%m.%Y %H:%M')}", post=pid, kind="schedule")
            event(f"#{pid} bulutta yeniden denenecek", "sync")
            return
        except CloudError as e:
            if e.status not in (404, 409):
                raise ValueError(str(e)) from None
        core.update_post(pid, lambda q: q.update(status="planlandi", schedule=sched, error=None, cloud=None))
    elif p.get("status") != "planlandi" or not p.get("schedule"):
        raise ValueError("önce paylaşımı planla")
    elif _seconds_left(p) < MIN_LEAD:
        raise ValueError("yayın saatine çok az kaldı; bu bilgisayardan paylaşılacak")
    else:
        core.update_post(pid, lambda q: q.update(cloud=None))
    request_upload(pid)


# ---------- remote panel ----------

def _worker_version(c=None):
    c = c or conf()
    return int((_load().get("remote") or {}).get("version") or c["version"] or 0)


def panel_conf(c=None):
    p = (c or conf()).get("panel")
    return p if isinstance(p, dict) and p.get("enabled") and p.get("token") and p.get("hash") else None


def _pw_hash(password, salt, iterations=PANEL_ITER):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, 32).hex()


def _check_password(password):
    if not isinstance(password, str) or not password:
        raise ValueError("Şifre boş")
    if len(password) < 6:
        raise ValueError("Şifre en az 6 karakter olmalı")
    if len(password) > 128:
        raise ValueError("Şifre en fazla 128 karakter olabilir")
    if password != password.strip():
        raise ValueError("Şifre boşlukla başlayıp bitemez")


def push_panel(c=None, p=None):
    c = c or conf()
    p = p or panel_conf(c)
    wapi("PUT", "/api/panel", {"token": p["token"], "salt": p["salt"], "hash": p["hash"], "iterations": p["iterations"]},
         c=c, timeout=30)


def _panel_put(c, p):
    try:
        push_panel(c, p)
    except CloudError as e:
        if e.status == 404:
            raise ValueError("Bulut servisi uzaktan takibi henüz desteklemiyor; önce servisi güncelle") from None
        raise ValueError(f"Buluta gönderilemedi: {e}") from None


def _panel_ready():
    c = conf()
    if not configured(c):
        raise ValueError("Önce bulut yayını bağla")
    return c


def panel_set(password):
    _check_password(password)
    with _panel_lock:
        c = _panel_ready()
        cur = panel_conf(c)
        salt = secrets.token_bytes(16)
        stamp = core.now()
        p = {"enabled": True, "token": cur["token"] if cur else secrets.token_urlsafe(18), "salt": salt.hex(),
             "hash": _pw_hash(password, salt), "iterations": PANEL_ITER, "created": (cur or {}).get("created") or stamp,
             "pw_set_at": stamp}
        _panel_put(c, p)
        save({"panel": p})
    event("Uzaktan takip şifresi değiştirildi; açık oturumlar kapandı" if cur else "Uzaktan takip linki oluşturuldu", "panel")
    if not cur:
        _spawn(maybe_snapshot, None, True)


def panel_new_link():
    with _panel_lock:
        c = _panel_ready()
        cur = panel_conf(c)
        if not cur:
            raise ValueError("Uzaktan takip kapalı")
        p = {**cur, "token": secrets.token_urlsafe(18), "created": core.now()}
        _panel_put(c, p)
        save({"panel": p})
    event("Uzaktan takip için yeni link oluşturuldu; eski link artık çalışmaz", "panel")


def panel_off():
    with _panel_lock:
        c = conf()
        if configured(c):
            try:
                wapi("DELETE", "/api/panel", c=c, timeout=30)
            except CloudError as e:
                if e.status != 404:
                    raise ValueError(f"Buluttaki panel kapatılamadı: {e}") from None
        was = panel_conf(c)
        save({"panel": None})
    with _lock:
        _reset_snap(_load())
        _persist()
    if was:
        event("Uzaktan takip kapatıldı; link ve şifre silindi", "panel")


def site_conf():
    s = core.settings().get("site")
    return s if isinstance(s, dict) and s.get("published") and s.get("owner_name") and s.get("email") else None


def push_site(c=None, s=None):
    c = c or conf()
    s = s or site_conf()
    body = {k: s.get(k) or "" for k in ("owner_name", "email", "app_name", "channel_url", "instagram_url")}
    body.update(lang_default="en", updated=to_utc(s["updated"]) if s.get("updated") else None)
    r = wapi("PUT", "/api/site", body, c=c, timeout=30)
    core.save_settings({"site": {"pushed_at": core.now(), "push_error": None, "pushed_url": c["url"]}})
    return r


def panel_view(c, s, deployed):
    p = panel_conf(c) if configured(c) else None
    out = {"enabled": bool(p), "supported": configured(c) and deployed >= PANEL_VERSION, "url": None, "created": None,
           "pw_set_at": None, "last_snapshot": None, "snapshot_error": None}
    if p:
        out.update(url=f"{c['url'].rstrip('/')}/p/{p['token']}", created=p.get("created"), pw_set_at=p.get("pw_set_at"),
                   last_snapshot=s.get("snap_last"), snapshot_error=s.get("snap_error"))
    return out


def _reset_snap(s):
    s.update(snap_at=0, snap_sig=None, snap_day=None, snap_last=None, snap_error=None)


def _snap_body(c, s):
    posts = core.list_posts()
    _, local_only = _lists(c, s, posts)
    names = {p["id"]: p.get("title") for p in posts}
    lo = [{"pid": x["pid"], "title": (x.get("title") or "")[:120], "at": to_utc(x["at"]), "detail": (x.get("detail") or "")[:160]}
          for x in local_only[:40]]
    up = [{"pid": pid, "title": (names.get(pid) or pid)[:120], "pct": u.get("pct") or 0}
          for pid, u in sorted(_uploads.items()) if _upload_active(pid)]
    usage = s.get("usage")
    if usage:
        usage = {**usage, "checked": to_utc(dt.datetime.fromtimestamp(s["usage_at"])) if s.get("usage_at") else None}
    offset = dt.datetime.now().astimezone().utcoffset()
    studio = {"enabled": bool(c["enabled"]), "sync_every": SYNC_EVERY, "push_every": SNAP_EVERY,
              "planned": sum(1 for p in posts if p.get("status") == "planlandi"),
              "tz": int(offset.total_seconds() // 60) if offset else 0,
              "last_sync": to_utc(s["last_sync"]) if s.get("last_sync") else None}
    return {"at": to_utc(dt.datetime.now()), "usage": usage, "local_only": lo, "uploading": up, "studio": studio}


def _snap_sig(body):
    raw = json.dumps([[(x["pid"], x["at"], x["detail"]) for x in body["local_only"]], [x["pid"] for x in body["uploading"]]])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def maybe_snapshot(c=None, force=False):
    c = c or conf()
    if not configured(c) or not panel_conf(c) or not _snap_lock.acquire(blocking=False):
        return False
    try:
        with _lock:
            s = _load()
            if time.time() - (s.get("snap_try") or 0) < SNAP_MIN:
                return False
        body = _snap_body(c, s)
        sig = _snap_sig(body)
        day = (body["usage"] or {}).get("date")
        due = (force or time.time() - (s.get("snap_at") or 0) >= SNAP_EVERY or sig != s.get("snap_sig")
               or day != s.get("snap_day"))
        if not due:
            return False
        s["snap_try"] = time.time()
        try:
            wapi("PUT", "/api/snapshot", body, c=c, timeout=30)
        except CloudError as e:
            with _lock:
                s["snap_error"] = str(e)
                _persist()
            return False
        with _lock:
            s.update(snap_at=time.time(), snap_sig=sig, snap_day=day, snap_last=core.now(), snap_error=None)
            _persist()
        return True
    finally:
        _snap_lock.release()


def thumb_jpeg(pid):
    src = core.post_dir(pid) / "thumb.jpg"
    if not src.exists():
        return None
    err = ""
    for width, q in ((THUMB_W, 5), (240, 10)):
        out = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-frames:v", "1", "-vf", f"scale='min({width},iw)':-2",
                              "-pix_fmt", "yuvj420p", "-q:v", str(q), "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"],
                             capture_output=True, timeout=60, creationflags=NO_WINDOW)
        if out.returncode == 0 and out.stdout and len(out.stdout) <= THUMB_MAX:
            return out.stdout
        err = (out.stderr or b"").decode("utf-8", "replace").strip()[-200:]
        if out.returncode != 0:
            break
    raise ValueError(f"küçük resim hazırlanamadı: {err or 'çok büyük'}")


def _send_thumb(pid, c=None):
    c = c or conf()
    src = core.post_dir(pid) / "thumb.jpg"
    try:
        data = thumb_jpeg(pid)
        if data is None:
            return False
        wapi("PUT", f"/api/jobs/{pid}/thumb", c=c, timeout=60, raw=data, ctype="image/jpeg")
    except (CloudError, ValueError, OSError, subprocess.SubprocessError) as e:
        _thumb_fail[pid] = time.time()
        event(f"#{pid} küçük resmi buluta gönderilemedi: {e}", "warn")
        return False
    _thumb_fail.pop(pid, None)
    mtime = int(src.stat().st_mtime) if src.exists() else None
    try:
        _set_cloud(pid, thumb_m=mtime)
    except KeyError:
        pass
    return True


def _backfill_thumb(c, st):
    if int(st.get("version") or 0) < PANEL_VERSION:
        return
    for j in st.get("jobs") or []:
        pid = j.get("pid")
        if not pid or j.get("status") not in ("ready", "preparing", "publishing", "error") or _upload_active(pid):
            continue
        if time.time() - _thumb_fail.get(pid, 0) < 3600:
            continue
        f = core.post_dir(pid) / "thumb.jpg"
        if not f.exists():
            continue
        p = core.load_post(pid) or {}
        sent = (p.get("cloud") or {}).get("thumb_m")
        if j.get("thumb") and (not sent or sent == int(f.stat().st_mtime)):
            continue
        if _send_thumb(pid, c):
            j["thumb"] = True
        return


# ---------- views ----------

def _progress(u):
    return {"phase": u["phase"], "pct": u["pct"], "sent": u["sent"], "total": u["total"], "speed": u["speed"], "eta": u["eta"]}


def _thumb(pid):
    f = core.post_dir(pid) / "thumb.jpg"
    return f"/media/{pid}/thumb.jpg?v={int(f.stat().st_mtime)}" if f.exists() else None


def _log_view(lines):
    return [{"at": to_local(x.get("at")), "text": x.get("text")} for x in lines or []]


def _job_view(pid, j, p):
    u = _uploads.get(pid)
    up = _progress(u) if u and _upload_active(pid) else None
    cl = (p or {}).get("cloud") or {}
    j = j or {}
    status = "uploading" if up else (j.get("status") or cl.get("state"))
    return {
        "pid": pid, "title": (p or {}).get("title") or j.get("title") or pid, "thumb": _thumb(pid),
        "at": job_at_local(j) if j.get("at") else ((p or {}).get("schedule") or cl.get("at")),
        "status": status, "size": j.get("size") or cl.get("size") or (u or {}).get("total") or None,
        "chunks": j.get("chunks") or cl.get("chunks"), "upload": up,
        "error": j.get("error") or (cl.get("error") if status in ("error", "failed") else None),
        "error_stage": (j.get("error_stage") or cl.get("error_stage")) if status == "error" else None,
        "permalink": j.get("permalink") or cl.get("permalink"),
        "published_at": to_local(j.get("published_at")) or cl.get("published_at"),
        "log": _log_view(j.get("log")), "local_status": (p or {}).get("status"),
    }


def _lists(c, s, posts=None):
    remote = s.get("remote") or {}
    rjobs = {j["pid"]: j for j in remote.get("jobs") or [] if j.get("pid")} if configured(c) else {}
    posts = core.list_posts() if posts is None else posts
    pmap = {p["id"]: p for p in posts}
    jobs = [_job_view(pid, j, pmap.get(pid)) for pid, j in rjobs.items()]
    seen = set(rjobs)
    for pid in list(_uploads):
        if pid not in seen and _upload_active(pid):
            jobs.append(_job_view(pid, None, pmap.get(pid)))
            seen.add(pid)
    week = (dt.datetime.now() - dt.timedelta(days=7)).isoformat(timespec="seconds")
    for p in posts:
        cl = p.get("cloud") or {}
        if p["id"] in seen or not configured(c):
            continue
        live = cl.get("state") in ("uploading", "ready", "preparing", "publishing") and p["status"] == "planlandi"
        if live or (cl.get("state") == "published" and (cl.get("published_at") or "") >= week):
            jobs.append(_job_view(p["id"], None, p))
            seen.add(p["id"])
    jobs.sort(key=lambda x: x.get("at") or "")
    local_only = []
    for p in posts:
        if p["status"] != "planlandi" or not p.get("schedule") or p["id"] in seen or not core.ig_on(p):
            continue
        cl = p.get("cloud") or {}
        kind = p.get("kind") or "reels"
        bad = ineligible(p)
        if kind != "reels":
            reason = kind if kind in ("image", "carousel", "story") else "kind"
            detail = f"{instagram.KIND_NAMES.get(kind, kind).capitalize()} paylaşımları şimdilik bu bilgisayardan yapılır"
        elif not active(c):
            reason, detail = "disabled", "Bulut yayını kapalı"
        elif cl.get("state") == "failed":
            reason, detail = cl.get("code") or "upload_failed", f"Buluta yüklenemedi: {cl.get('error') or 'bilinmiyor'}"
        elif cl.get("state") == "removed" and cl.get("code") == "disabled":
            reason, detail = "disabled", cl.get("reason") or "Bulut yayını kapatılınca buluttan silindi"
        elif cl.get("state") == "removed":
            reason, detail = "canceled", cl.get("reason") or "Buluttan kaldırıldı"
        elif bad == "video 300 MB'den büyük":
            reason, detail = "too_big", "Video 300 MB'den büyük"
        elif bad:
            reason, detail = "upload_failed", bad.capitalize()
        elif _seconds_left(p) < MIN_LEAD:
            reason, detail = "before_connect", "Yayın saatine çok az kaldı"
        else:
            reason, detail = "before_connect", "Bulut bağlanmadan önce planlandı"
        local_only.append({"pid": p["id"], "title": p.get("title"), "at": p["schedule"], "reason": reason, "detail": detail,
                           "error": cl.get("error") if cl.get("state") in LOCAL else None, "thumb": _thumb(p["id"]), "kind": kind,
                           "can_upload": bool(kind == "reels" and active(c) and not bad and _seconds_left(p) > MIN_LEAD)})
    local_only.sort(key=lambda x: x["at"])
    return jobs, local_only


def public():
    c = conf()
    s = _load()
    with _lock:
        conn = json.loads(json.dumps(_connect)) if _connect else None
        choice = list(_choice) if _choice else None
    if conn and conn["done"] and time.time() - conn["_end"] > 300:
        conn = None
    if conn:
        conn.pop("_end", None)
    remote = s.get("remote") or {}
    jobs, local_only = _lists(c, s)
    w = remote.get("ig") or {}
    deployed = remote.get("version") or c["version"] or 0
    latest = bundled_version()
    stg = remote.get("storage") or {}
    return {
        "configured": configured(c), "enabled": bool(c["enabled"]), "connecting": conn, "accounts_choice": choice,
        "worker": c["worker"] or None, "url": c["url"] or None, "account_id": c["account_id"] or None,
        "connected_at": c["connected_at"] or None, "has_token": bool(c["api_token"]),
        "version": deployed or None, "latest_version": latest, "update_available": configured(c) and deployed < latest,
        "status": s.get("status") or {"ok": None, "checked": None, "latency_ms": None, "error": None},
        "storage": {"used": stg.get("used") or 0, "limit": stg.get("limit") or LIMITS["storage"], "videos": stg.get("videos") or 0},
        "usage": s.get("usage") if configured(c) else None, "limits": LIMITS,
        "ig": {"configured": bool(w.get("configured")), "updated": to_local(w.get("updated")), "refreshed": to_local(w.get("refreshed"))},
        "jobs": jobs, "local_only": local_only, "last_sync": s.get("last_sync"),
        "events": list(reversed(s.get("events") or [])),
        "panel": panel_view(c, s, deployed),
    }


def brief(posts=None):
    c = conf()
    if not configured(c):
        return {"configured": False, "enabled": False, "ok": None, "uploading": 0, "errors": 0, "storage_pct": 0}
    s = _load()
    remote = s.get("remote") or {}
    stg = remote.get("storage") or {}
    errors = sum(1 for j in remote.get("jobs") or [] if j.get("status") == "error")
    errors += sum(1 for p in (posts if posts is not None else core.list_posts())
                  if p.get("status") == "planlandi" and (p.get("cloud") or {}).get("state") == "failed")
    limit = stg.get("limit") or LIMITS["storage"]
    return {"configured": True, "enabled": bool(c["enabled"]), "ok": (s.get("status") or {}).get("ok"),
            "uploading": sum(1 for pid in list(_uploads) if _upload_active(pid)), "errors": errors,
            "storage_pct": round((stg.get("used") or 0) * 100 / limit, 1)}
