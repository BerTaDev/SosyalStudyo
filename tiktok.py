import datetime as dt
import importlib.util
import json
import os
import re
import subprocess
import threading
import time
import traceback
from pathlib import Path

import cloud
import core
import instagram

DEFAULTS = {"auto": False, "visibility": "Herkes", "ahead_days": 7}
VISIBILITY = ("Herkes", "Arkadaşlar")
UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload?from=upload"
LOGIN_URL = "https://www.tiktok.com/login"
CONTENT_URL = "https://www.tiktok.com/tiktokstudio/content"
ACCOUNT_TTL = 900
VIS_NAMES = {1: "Herkes", 2: "Sadece siz", 3: "Arkadaşlar"}
FILE_INPUT = 'input[type=file][accept^="video"]'
MIN_LEAD = 20 * 60
LATE = 6 * 3600
MAX_ATTEMPTS = 3
RETRY_WAIT = 300
UPLOAD_TIMEOUT = 900
LOGIN_TIMEOUT = 1800
BROWSERS = (("msedge", (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe")),
            ("chrome", (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"))))
MONTHS = ("Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık")

_lock = threading.Lock()
_browser = threading.Lock()
_run = {"busy": None, "login": False}
_retry_at = {}
_cache = {"avail": (0.0, False), "state": (None, {})}


class TtError(Exception):
    def __init__(self, msg, code="upload"):
        super().__init__(msg)
        self.code = code


def root():
    return core.DATA / "tiktok"


def profile():
    return root() / "profile"


def conf():
    c = dict(DEFAULTS)
    c.update(core.settings().get("tiktok") or {})
    return c


def save(patch):
    core.save_settings({"tiktok": patch})


def browser():
    for chan, paths in BROWSERS:
        for p in paths:
            if Path(p).exists():
                return chan, p
    return None


def reset_available():
    importlib.invalidate_caches()
    _cache["avail"] = (0.0, False)


def available():
    t, v = _cache["avail"]
    if time.time() - t > 60:
        v = importlib.util.find_spec("playwright") is not None and browser() is not None
        _cache["avail"] = (time.time(), v)
    return v


def _load():
    f = root() / "state.json"
    try:
        m = f.stat().st_mtime_ns
    except OSError:
        return {}
    if _cache["state"][0] != m:
        _cache["state"] = (m, core.read_json(f, {}) or {})
    return dict(_cache["state"][1])


def _store(fn):
    with _lock:
        s = core.read_json(root() / "state.json", {}) or {}
        fn(s)
        root().mkdir(parents=True, exist_ok=True)
        core.write_json(root() / "state.json", s)


def event(text, kind="info"):
    _store(lambda s: s.update(events=((s.get("events") or []) + [{"at": core.now(), "text": text, "kind": kind}])[-60:]))


def _set_login(v):
    _store(lambda s: s.update(logged_in=v, checked_at=core.now()))


def _set(pid, **kw):
    def fn(q):
        y = dict(q.get("tiktok") or {})
        y.update(kw)
        q["tiktok"] = y
    return core.update_post(pid, fn)


def _fmt(t):
    return t.isoformat(timespec="minutes") if t else None


def _nice(t):
    return t.strftime("%d.%m %H:%M") if t else ""


def _video(p):
    files = instagram.media_files(p)
    return files[0] if files and files[0].suffix.lower() in instagram.VIDEO_EXT and files[0].exists() else None


def _usable(p):
    return (p.get("kind") or "reels") == "reels" and not p.get("deleted")


def _enabled(p, c):
    v = (p.get("tiktok") or {}).get("enabled")
    return bool(c["auto"]) if v is None else bool(v)


def _want(p, c):
    if not p or not _usable(p) or not _enabled(p, c) or p.get("status") != "planlandi" or not p.get("schedule") or not _video(p):
        return False, None
    return True, core.parse_time(p["schedule"])


def _slot(t):
    t = t.replace(second=0, microsecond=0)
    extra = (5 - t.minute % 5) % 5
    return t + dt.timedelta(minutes=extra)


# ---------- browser automation ----------

def _launch(pw, headless=True):
    chan, _ = browser()
    return pw.chromium.launch_persistent_context(str(profile()), channel=chan, headless=headless, locale="tr-TR",
                                                 viewport={"width": 1400, "height": 1000}, args=["--mute-audio"])


def _logged(ctx):
    return any(c["name"] == "sessionid" and c["value"] for c in ctx.cookies("https://www.tiktok.com"))


def _captcha(page):
    return page.locator("#captcha_container, [id*=captcha], [class*=captcha_verify], [class*=secsdk-captcha]").count() > 0


def _dismiss(page):
    for _ in range(8):
        if not page.locator(".react-joyride__overlay, .react-joyride__tooltip").count():
            break
        for act in ("skip", "close", "last", "primary"):
            b = page.locator(f'button[data-action="{act}"]')
            if b.count() and b.first.is_visible():
                b.first.click()
                break
        else:
            page.keyboard.press("Escape")
        page.wait_for_timeout(700)
    m = page.locator(".TUXModal:has-text('Otomatik içerik kontrolleri')")
    if m.count() and m.first.is_visible():
        m.first.get_by_role("button", name="İptal", exact=True).click()
        page.wait_for_timeout(600)
    b = page.get_by_role("button", name="Anladım", exact=True)
    if b.count() and b.first.is_visible():
        b.first.click()
        page.wait_for_timeout(600)


def _caption(page, text):
    ed = page.locator("[data-e2e=caption_container] .public-DraftEditor-content")
    ed.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Delete")
    page.wait_for_timeout(300)
    for i, line in enumerate(text.split("\n")):
        if i:
            page.keyboard.press("Escape")
            page.keyboard.press("Enter")
        if line:
            page.keyboard.type(line, delay=10)
    page.wait_for_timeout(800)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


def _blocks(page):
    return page.evaluate("() => [...document.querySelectorAll('[data-e2e=caption_container] [data-block=true]')]"
                         ".map(b => b.innerText.trim()).filter(Boolean)")


def _visibility(page, name):
    trig = page.locator("[data-e2e=video_visibility_container] button.Select__trigger")
    if trig.inner_text().strip() == name:
        return trig
    trig.click()
    page.wait_for_timeout(600)
    page.locator("[role=option]").filter(has_text=name).first.click()
    page.wait_for_timeout(700)
    return trig


def _exact(text):
    return re.compile(rf"^\s*{re.escape(text)}\s*$")


def _schedule(page, target):
    box = page.locator("[data-e2e=schedule_container]")
    box.get_by_text("Planla", exact=True).click()
    page.wait_for_timeout(1200)
    consent = page.locator(".TUXModal:has-text('planlanan paylaşma için kaydedilmesine')")
    if consent.count() and consent.first.is_visible():
        consent.first.get_by_role("button", name="İzin ver", exact=True).click()
        page.wait_for_timeout(1200)
    ins = box.locator("input.TUXTextInputCore-input")
    date_in = next((ins.nth(i) for i in range(ins.count()) if "-" in ins.nth(i).input_value()), None)
    time_in = next((ins.nth(i) for i in range(ins.count()) if ":" in ins.nth(i).input_value()), None)
    if date_in is None or time_in is None:
        raise TtError("TikTok planlama alanı açılmadı")
    date_in.click()
    page.wait_for_timeout(600)
    cal = page.locator(".calendar-wrapper").first
    for _ in range(3):
        head = cal.locator(".month-title").inner_text().strip()
        year = int(cal.locator(".year-title").inner_text().strip() or 0)
        shown = (year, MONTHS.index(head) + 1 if head in MONTHS else target.month)
        if shown >= (target.year, target.month):
            break
        cal.locator(".month-header-wrapper .arrow").last.click()
        page.wait_for_timeout(500)
    cal.locator("span.day.valid").filter(has_text=_exact(str(target.day))).first.click()
    page.wait_for_timeout(600)
    time_in.click()
    page.wait_for_timeout(600)
    cols = page.locator(".tiktok-timepicker-time-picker-container:not(.tiktok-timepicker-invisible) .tiktok-timepicker-time-scroll-container")
    cols.nth(0).locator(".tiktok-timepicker-option-text").filter(has_text=_exact(f"{target.hour:02d}")).first.click()
    page.wait_for_timeout(400)
    cols.nth(1).locator(".tiktok-timepicker-option-text").filter(has_text=_exact(f"{target.minute:02d}")).first.click()
    page.wait_for_timeout(400)
    page.mouse.click(1350, 120)
    page.wait_for_timeout(600)
    return date_in, time_in


def _shot(page):
    try:
        page.screenshot(path=str(root() / "last_error.png"), timeout=10000)
    except Exception:  # noqa: BLE001
        pass


def _automate(pid, video, caption, target, vis):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ctx = _launch(pw)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            if not _logged(ctx):
                raise TtError("TikTok oturumu kapalı; Ayarlar › TikTok'tan yeniden giriş yap", "login")
            page.goto(UPLOAD_URL, wait_until="domcontentloaded", timeout=60000)
            try:
                page.wait_for_selector(FILE_INPUT, state="attached", timeout=45000)
            except Exception:  # noqa: BLE001
                if _captcha(page):
                    raise TtError("TikTok bir güvenlik doğrulaması istiyor; Ayarlar › TikTok'tan giriş penceresini açıp doğrula", "captcha") from None
                if "login" in page.url:
                    raise TtError("TikTok oturumu kapanmış; Ayarlar › TikTok'tan yeniden giriş yap", "login") from None
                raise TtError("TikTok yükleme sayfası açılmadı") from None
            _set(pid, stage="Video TikTok'a yükleniyor")
            page.set_input_files(FILE_INPUT, str(video))
            page.wait_for_selector("[data-e2e=schedule_container]", timeout=180000)
            t0 = time.time()
            while True:
                st = page.locator("[data-e2e=upload_status_container]").inner_text() if page.locator("[data-e2e=upload_status_container]").count() else ""
                if "Yüklendi" in st:
                    break
                if any(k in st for k in ("başarısız", "Başarısız", "failed")):
                    raise TtError(f"TikTok videoyu yükleyemedi: {st.strip()[:120]}")
                if time.time() - t0 > UPLOAD_TIMEOUT:
                    raise TtError("TikTok'a yükleme çok uzun sürdü")
                page.wait_for_timeout(2000)
            page.wait_for_timeout(2000)
            _set(pid, stage="Açıklama ve saat ayarlanıyor")
            _dismiss(page)
            _caption(page, caption)
            trig = _visibility(page, vis)
            date_in = time_in = None
            if target:
                date_in, time_in = _schedule(page, target)
            want = [ln.strip() for ln in caption.split("\n") if ln.strip()]
            btn = page.locator("[data-e2e=post_video_button]")
            checks = {"caption": _blocks(page) == want, "visibility": trig.inner_text().strip() == vis,
                      "button": btn.inner_text().strip() == ("Planla" if target else "Paylaş")}
            if target:
                checks.update(date=date_in.input_value() == target.strftime("%Y-%m-%d"),
                              time=time_in.input_value() == target.strftime("%H:%M"),
                              mode=page.evaluate("() => document.querySelector('input[name=postSchedule]:checked')?.value") == "schedule")
            bad = [k for k, v in checks.items() if not v]
            if bad:
                raise TtError("TikTok formu beklendiği gibi doldurulamadı (" + ", ".join(bad) + "); hiçbir şey paylaşılmadı")
            _set(pid, stage="TikTok'a gönderiliyor")
            btn.click()
            t0 = time.time()
            while "tiktokstudio/content" not in page.url and time.time() - t0 < 120:
                page.wait_for_timeout(1500)
            if "tiktokstudio/content" not in page.url:
                raise TtError("TikTok gönderiyi onaylamadı; TikTok Studio › Gönderiler'den kontrol et", "verify")
        except TtError:
            _shot(page)
            raise
        except Exception as e:  # noqa: BLE001
            _shot(page)
            if _captcha(page):
                raise TtError("TikTok bir güvenlik doğrulaması istiyor; Ayarlar › TikTok'tan giriş penceresini açıp doğrula", "captcha") from None
            raise TtError(f"TikTok sayfasında beklenmeyen durum: {str(e).splitlines()[0][:160]}") from None
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass


def _process(pid):
    if not _browser.acquire(blocking=False):
        return
    try:
        c = conf()
        p = core.load_post(pid)
        want, sched = _want(p, c)
        y = (p or {}).get("tiktok") or {}
        if not want or y.get("state") not in (None, "queued", "error"):
            return
        _run["busy"] = pid
        now = dt.datetime.now()
        target = None if (sched - now).total_seconds() < MIN_LEAD else _slot(sched)
        vis = c["visibility"] if c["visibility"] in VISIBILITY else "Herkes"
        _set(pid, state="uploading", code=None, error=None, stage="TikTok açılıyor")
        _automate(pid, _video(p), instagram.full_caption(p), target, vis)
        at = target or now.replace(second=0, microsecond=0)
        _set(pid, state="scheduled" if target else "published", at=_fmt(at), sched=p["schedule"], visibility=vis,
             uploaded_at=core.now(), attempts=0, code=None, error=None, stage=None)
        _retry_at.pop(pid, None)
        if _load().get("logged_in") is not True:
            _set_login(True)
        when = f"{_nice(at)} için planlandı" if target else "hemen paylaşıldı"
        event(f"#{pid} TikTok'ta {when} ({vis})", "uploaded")
        core.log_activity(f"TikTok'ta {when} ({vis})", post=pid, kind="schedule")
    except TtError as e:
        cur = ((core.load_post(pid) or {}).get("tiktok") or {})
        _set(pid, state="error", error=str(e), code=e.code, attempts=int(cur.get("attempts") or 0) + 1, stage=None)
        _retry_at[pid] = time.time() + RETRY_WAIT
        if e.code in ("login", "captcha"):
            _set_login(False)
        event(f"#{pid} TikTok: {e}", "error")
        core.log_activity(f"TikTok'a yüklenemedi: {e}", post=pid, kind="error")
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        _set(pid, state="error", error="TikTok işleminde beklenmeyen hata", code="upload", stage=None)
        _retry_at[pid] = time.time() + RETRY_WAIT
    finally:
        _run["busy"] = None
        _browser.release()


def tick():
    if not available() or _run["login"] or _load().get("logged_in") is False:
        return
    c = conf()
    now = dt.datetime.now()
    due = []
    for p in core.list_posts():
        pid = p["id"]
        y = p.get("tiktok") or {}
        st = y.get("state")
        want, sched = _want(p, c)
        if st == "scheduled":
            at = core.parse_time(y["at"]) if y.get("at") else None
            moved = (p.get("deleted") or p.get("status") in ("sirada", "uretimde", "inceleme", "hata") or y.get("enabled") is False
                     or (p.get("status") == "planlandi" and y.get("sched") != p.get("schedule")))
            if at and at <= now:
                _set(pid, state="published", code=None)
            elif moved and y.get("code") != "changed":
                _set(pid, code="changed")
                event(f"#{pid} stüdyoda değişti; TikTok'taki planı TikTok Studio'dan güncellemen gerekiyor", "warn")
            continue
        if st == "published" or st == "uploading" and _run["busy"] == pid:
            continue
        if not want:
            if st in ("queued", "error", "uploading"):
                _set(pid, state=None, code=None, error=None, stage=None)
            continue
        if st == "uploading":
            _set(pid, state="queued", stage=None)
        if st == "error" and (int(y.get("attempts") or 0) >= MAX_ATTEMPTS or time.time() < _retry_at.get(pid, 0)):
            continue
        lead = (sched - now).total_seconds()
        if lead < -LATE:
            if st != "error" or y.get("code") != "late":
                _set(pid, state="error", code="late", error="Paylaşım saati çoktan geçti; TikTok'a gönderilmedi", attempts=MAX_ATTEMPTS)
            continue
        if lead > int(c["ahead_days"]) * 86400:
            if st != "queued" or y.get("code") != "wait":
                _set(pid, state="queued", code="wait")
            continue
        if st is None or y.get("code") == "wait":
            _set(pid, state="queued", code=None)
        due.append((sched, pid))
    if due and not _browser.locked():
        threading.Thread(target=_process, args=(min(due)[1],), daemon=True).start()


# ---------- account ----------

def _norm(text):
    return " ".join((text or "").split())[:60]


def _studio_links():
    out = {}
    for p in core.list_posts():
        if (p.get("tiktok") or {}).get("state") in ("scheduled", "published"):
            out[_norm(instagram.full_caption(p))] = {"id": p["id"], "title": p.get("title") or ""}
    return out


def _local(ts):
    return dt.datetime.fromtimestamp(ts).isoformat(timespec="minutes") if ts else None


def _fetch_account():
    from playwright.sync_api import sync_playwright
    got = {}

    def on_resp(r):
        if "item_list" not in r.url:
            return
        try:
            body = json.loads(r.request.post_data or "{}")
            j = r.json()
        except Exception:  # noqa: BLE001
            return
        if int(body.get("size") or 0) >= got.get("size", -1):
            got.update(items=j.get("item_list") or [], size=int(body.get("size") or 0))

    with sync_playwright() as pw:
        ctx = _launch(pw)
        try:
            if not _logged(ctx):
                raise TtError("TikTok oturumu kapalı; Ayarlar › TikTok'tan yeniden giriş yap", "login")
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.on("response", on_resp)
            page.goto(CONTENT_URL, wait_until="domcontentloaded", timeout=60000)
            t0 = time.time()
            while "items" not in got and time.time() - t0 < 25:
                page.wait_for_timeout(500)
            page.wait_for_timeout(1500)
            if "items" not in got:
                raise TtError("TikTok gönderi listesi alınamadı" if not _captcha(page) else "TikTok bir güvenlik doğrulaması istiyor", "account")
            uid = page.evaluate("() => ((document.querySelector('a[href*=\"/@\"]') || {}).getAttribute?.('href') || '')"
                                ".split('/@')[1]?.split(/[/?#]/)[0] || ''") or _load().get("username") or ""
            prof = {}
            if uid:
                page.goto(f"https://www.tiktok.com/@{uid}", wait_until="domcontentloaded", timeout=60000)
                raw = page.evaluate("() => document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent || ''")
                try:
                    info = json.loads(raw)["__DEFAULT_SCOPE__"]["webapp.user-detail"]["userInfo"]
                    u, st = info.get("user") or {}, info.get("stats") or {}
                    prof = {"nickname": u.get("nickname"), "bio": u.get("signature") or "", "avatar": u.get("avatarLarger") or u.get("avatarMedium"),
                            "verified": bool(u.get("verified")), "private": bool(u.get("privateAccount")),
                            "followers": st.get("followerCount"), "following": st.get("followingCount"),
                            "likes": st.get("heartCount", st.get("heart")), "videos": st.get("videoCount")}
                except (ValueError, KeyError, TypeError):
                    prof = {}
                if not prof.get("avatar"):
                    imgs = page.evaluate("() => [...document.querySelectorAll('img')].map(i => i.src).filter(s => /-avt-|avatar/.test(s))")
                    if imgs:
                        prof["avatar"] = imgs[0]
            media = root() / "media"
            media.mkdir(parents=True, exist_ok=True)
            stamp = int(time.time())

            def grab(url, name):
                if not url:
                    return None
                try:
                    r = page.request.get(url, headers={"Referer": "https://www.tiktok.com/"}, timeout=20000)
                    if r.ok:
                        (media / name).write_bytes(r.body())
                        return f"/api/tiktok/media/{name}?v={stamp}"
                except Exception:  # noqa: BLE001
                    pass
                return None
            if prof.get("avatar"):
                prof["avatar"] = grab(prof["avatar"], "avatar.jpg") or prof["avatar"]
            covers = {}
            for x in got["items"]:
                iid = re.sub(r"\D", "", str(x.get("item_id") or ""))
                if iid and (x.get("cover_url") or [None])[0]:
                    covers[iid] = grab(x["cover_url"][0], f"cover_{iid}.jpg")
        finally:
            try:
                ctx.close()
            except Exception:  # noqa: BLE001
                pass
    links = _studio_links()
    now_ts = time.time()
    items = []
    for x in got["items"]:
        sched = int(x.get("schedule_time") or 0)
        vis = int(x.get("visibility") or 0)
        iid = str(x.get("item_id") or "")
        items.append({"id": iid, "desc": x.get("desc") or "", "cover": covers.get(iid) or (x.get("cover_url") or [None])[0],
                      "duration": round(int(x.get("duration") or 0) / 1000),
                      "state": "scheduled" if sched > now_ts else ("public" if vis == 1 else "limited"),
                      "visibility": VIS_NAMES.get(vis, "Gizli"),
                      "at": _local(sched if sched > now_ts else int(x.get("post_time") or x.get("create_time") or 0)),
                      "views": int(x.get("play_count") or 0), "likes": int(x.get("like_count") or 0),
                      "comments": int(x.get("comment_count") or 0), "shares": int(x.get("share_count") or 0),
                      "saves": int(x.get("favorite_count") or 0),
                      "url": f"https://www.tiktok.com/@{uid}/video/{iid}" if uid and iid else None,
                      "studio": links.get(_norm(x.get("desc")))})
    totals = {k: sum(i[k] for i in items) for k in ("views", "likes", "comments", "shares", "saves")}
    if uid:
        _store(lambda s: s.update(username=uid))
    return {"profile": dict(prof, username=uid or None, url=f"https://www.tiktok.com/@{uid}" if uid else None,
                            studio_url="https://www.tiktok.com/tiktokstudio"),
            "items": items, "totals": totals}


def account(fresh=False):
    f = root() / "account.json"
    cached = core.read_json(f, None)
    age = time.time() - float(cached.get("ts") or 0) if cached else None

    def out(c, warning=None):
        return {"ok": True, "data": c["data"], "fetched_at": _local(int(c["ts"])), "warning": warning}

    if cached and age < (60 if fresh else ACCOUNT_TTL):
        return out(cached)
    if not available() or _load().get("logged_in") is not True:
        return {"ok": False, "error": {"code": "login", "message": "TikTok bağlı değil; Ayarlar › TikTok'tan giriş yap"}}
    if _run["login"] or not _browser.acquire(blocking=False):
        if cached:
            return out(cached, "TikTok şu an video yüklüyor; bilgiler biraz eski olabilir")
        return {"ok": False, "error": {"code": "busy", "message": "TikTok şu an video yüklüyor; birazdan tekrar dene"}}
    try:
        _release_profile()
        data = _fetch_account()
        old = ((cached or {}).get("data") or {}).get("profile") or {}
        for k, v in old.items():
            if data["profile"].get(k) is None and v is not None:
                data["profile"][k] = v
        c = {"ts": time.time(), "data": data}
        core.write_json(f, c)
        return out(c)
    except TtError as e:
        if e.code == "login":
            _set_login(False)
        if cached:
            return out(cached, str(e))
        return {"ok": False, "error": {"code": e.code, "message": str(e)}}
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        if cached:
            return out(cached, "TikTok bilgileri yenilenemedi")
        return {"ok": False, "error": {"code": "error", "message": f"TikTok bilgileri alınamadı: {str(e).splitlines()[0][:120]}"}}
    finally:
        _browser.release()


# ---------- login ----------

def _profile_procs():
    if os.name != "nt":
        return []
    q = (f"Get-CimInstance Win32_Process | Where-Object {{ $_.CommandLine -like '*{profile()}*' }} | "
         "Select-Object -ExpandProperty ProcessId")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", q], capture_output=True, text=True, timeout=30,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return [int(x) for x in r.stdout.split() if x.strip().isdigit()]


def _release_profile():
    t0 = time.time()
    while time.time() - t0 < 15:
        if not _profile_procs():
            return
        time.sleep(1)
    for pid in _profile_procs():
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    time.sleep(2)


def check():
    if not available():
        return None
    if _browser.locked():
        return _load().get("logged_in")
    with _browser:
        from playwright.sync_api import sync_playwright
        _release_profile()
        try:
            with sync_playwright() as pw:
                ctx = _launch(pw)
                ok = _logged(ctx)
                ctx.close()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            return None
    _set_login(ok)
    return ok


def _login_flow():
    try:
        with _browser:
            _release_profile()
            root().mkdir(parents=True, exist_ok=True)
            proc = subprocess.Popen([browser()[1], f"--user-data-dir={profile()}", "--no-first-run", "--no-default-browser-check",
                                     "--new-window", LOGIN_URL])
            try:
                proc.wait(timeout=LOGIN_TIMEOUT)
            except subprocess.TimeoutExpired:
                proc.terminate()
            _release_profile()
    finally:
        _run["login"] = False
    ok = check()
    if ok:
        for p in core.list_posts():
            y = p.get("tiktok") or {}
            if y.get("state") == "error" and y.get("code") in ("login", "captcha"):
                _set(p["id"], state="queued", code=None, error=None, attempts=0)
                _retry_at.pop(p["id"], None)
    event("TikTok oturumu açık" if ok else "TikTok'a giriş yapılmadı", "ok" if ok else "warn")


def login():
    if not available():
        raise ValueError("TikTok için Playwright ve Edge ya da Chrome gerekli")
    if _run["login"]:
        return
    _run["login"] = True
    threading.Thread(target=_login_flow, daemon=True).start()


# ---------- views ----------

def _note(p, y, c):
    st = y.get("state")
    if st == "queued":
        if y.get("code") == "wait" and p.get("schedule"):
            at = core.parse_time(p["schedule"]) - dt.timedelta(days=int(c["ahead_days"]))
            return f"TikTok'a {_nice(at)} civarı planlanacak"
        return "TikTok planlaması sırada"
    if st == "uploading":
        return y.get("stage") or "TikTok'a yükleniyor"
    if st == "scheduled":
        at = core.parse_time(y["at"]) if y.get("at") else None
        return f"TikTok'ta planlandı · {_nice(at)}"
    if st == "published":
        return "TikTok'ta yayın saati geldi"
    if st == "error":
        return y.get("error")
    return None


def post_info(p, c=None):
    if not _usable(p) or not available():
        return None
    c = c or conf()
    if _load().get("logged_in") is not True:
        return None
    y = p.get("tiktok") or {}
    return {"enabled": _enabled(p, c), "state": y.get("state"), "at": y.get("at") or (p.get("schedule") if y.get("state") == "queued" else None),
            "note": _note(p, y, c), "error": y.get("error") if y.get("state") == "error" else None, "code": y.get("code"),
            "visibility": y.get("visibility") or c["visibility"]}


def _jobs(c):
    out = []
    week = (dt.datetime.now() - dt.timedelta(days=7)).isoformat(timespec="minutes")
    for p in core.list_posts():
        y = p.get("tiktok") or {}
        if not y.get("state") or (y["state"] == "published" and (y.get("at") or "") < week):
            continue
        out.append({"pid": p["id"], "title": p.get("title") or p["id"], "thumb": cloud._thumb(p["id"]), "at": y.get("at") or p.get("schedule"),
                    "state": y["state"], "note": _note(p, y, c), "error": y.get("error"), "code": y.get("code")})
    out.sort(key=lambda x: x.get("at") or "")
    return out


def public():
    c = conf()
    s = _load()
    b = browser()
    return {"available": available(), "browser": b[0] if b else None, "logged_in": s.get("logged_in"), "checked_at": s.get("checked_at"),
            "login_running": _run["login"], "busy": bool(_run["busy"]), "auto": bool(c["auto"]),
            "visibility": c["visibility"] if c["visibility"] in VISIBILITY else "Herkes", "ahead_days": int(c["ahead_days"]),
            "jobs": _jobs(c), "events": list(reversed(s.get("events") or []))}


def brief(posts):
    states = [((p.get("tiktok") or {}).get("state")) for p in posts]
    return {"available": available(), "logged_in": _load().get("logged_in"), "auto": bool(conf()["auto"]),
            "uploading": states.count("uploading"), "queued": states.count("queued"), "errors": states.count("error")}


# ---------- actions ----------

def update_settings(d):
    patch = {}
    if "auto" in d:
        patch["auto"] = bool(d["auto"])
    if "visibility" in d:
        if d["visibility"] not in VISIBILITY:
            raise ValueError("TikTok planlaması yalnızca Herkes ya da Arkadaşlar görünürlüğüyle yapılabilir")
        patch["visibility"] = d["visibility"]
    if "ahead_days" in d:
        try:
            patch["ahead_days"] = max(1, min(10, int(d["ahead_days"])))
        except (TypeError, ValueError):
            raise ValueError("geçersiz gün sayısı") from None
    if not patch:
        raise ValueError("değişiklik yok")
    save(patch)
    if "auto" in patch:
        event("Planlanan Reels videoları TikTok'ta da planlanacak" if patch["auto"] else "Otomatik TikTok planlaması kapatıldı",
              "ok" if patch["auto"] else "warn")


def edit_post(pid, d):
    if "enabled" not in d:
        raise ValueError("değişiklik yok")
    p = core.load_post(pid)
    y = (p or {}).get("tiktok") or {}
    _set(pid, enabled=bool(d["enabled"]))
    if not d["enabled"] and y.get("state") == "scheduled":
        _set(pid, code="changed")
    core.log_activity("TikTok paylaşımı " + ("açıldı" if d["enabled"] else "kapatıldı"), post=pid, kind="info")


def now(pid):
    p = core.load_post(pid)
    if not p:
        raise KeyError(pid)
    y = p.get("tiktok") or {}
    if y.get("state") in ("scheduled", "published"):
        raise ValueError("Bu video TikTok'a zaten gönderildi")
    if y.get("state") == "uploading":
        raise ValueError("TikTok işlemi zaten sürüyor")
    if not _want(p, conf())[0]:
        raise ValueError("Önce paylaşımı planla ve bu içerikte TikTok'u aç")
    _set(pid, state="queued", code=None, error=None, attempts=0)
    _retry_at.pop(pid, None)
    if not _browser.locked():
        threading.Thread(target=_process, args=(pid,), daemon=True).start()
