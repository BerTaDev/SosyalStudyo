import datetime as dt
import json
import re
import time

import core
import instagram as ig

MEDIA_FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count"
COMMENT_FIELDS = "id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp,like_count,hidden}"
REEL_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time",
                "ig_reels_video_view_total_time"]
POST_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"]
ACCOUNT_METRICS = ["views", "reach", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves",
                   "follows_and_unfollows", "profile_links_taps"]

_cache = {}


def uid():
    u = core.settings()["instagram"].get("user_id")
    if not u:
        raise ig.IgError("Instagram bağlı değil (Ayarlar > Instagram)")
    return u


def cached(key, ttl, fn, fresh=False):
    hit = _cache.get(key)
    if hit and not fresh and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def drop(*prefixes):
    for k in list(_cache):
        if k.startswith(prefixes):
            _cache.pop(k, None)


def explain(err):
    text = str(err)
    if "allowed window" in text or "zaman aralığının dışında" in text:
        return {"code": "dm_window", "message": "Instagram bu kişiye şu an uygulama üzerinden yanıt göndermeye izin vermiyor.", "raw": text}
    if "(#10)" in text or "does not have permission" in text:
        return {"code": "permission", "message": "Bu bilgi için anahtarda izin yok."}
    if "disabled access to Instagram Direct" in text:
        return {"code": "dm_disabled", "message": "Instagram hesabında uygulama dışından mesaj erişimi kapalı."}
    return {"code": "error", "message": text}


def profile(fresh=False):
    fields = "username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count"
    return cached("profile", 120, lambda: ig._call("GET", uid(), {"fields": fields}), fresh)


def studio_links():
    out = {}
    for p in core.list_posts():
        pub = p.get("published") or {}
        if pub.get("id"):
            out[str(pub["id"])] = p["id"]
    return out


def media(after=None, fresh=False):
    def get():
        params = {"fields": MEDIA_FIELDS, "limit": 24}
        if after:
            params["after"] = after
        return ig._call("GET", f"{uid()}/media", params)
    r = cached(f"media:{after or ''}", 120, get, fresh)
    links = studio_links()
    items = [dict(m, studio_post=links.get(m["id"])) for m in r.get("data", [])]
    if fresh:
        drop(*(f"views:{m['id']}" for m in items))
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(6) as ex:
        for m, v in zip(items, ex.map(views_of, [m["id"] for m in items])):
            m["views"] = v
    return {"items": items, "after": (r.get("paging") or {}).get("cursors", {}).get("after") if (r.get("paging") or {}).get("next") else None}


def views_of(mid):
    def get():
        try:
            r = ig._call("GET", f"{mid}/insights", {"metric": "views"})
        except ig.IgError:
            return None
        row = (r.get("data") or [{}])[0]
        vals = row.get("values") or [{}]
        return (row.get("total_value") or {}).get("value", vals[0].get("value"))
    return cached(f"views:{mid}", 600, get)


VIEWS_CAP = 500


def stats_of(mid):
    def get():
        for metrics in ("views,shares,saved", "views"):
            try:
                r = ig._call("GET", f"{mid}/insights", {"metric": metrics})
            except ig.IgError:
                continue
            out = {}
            for row in r.get("data") or []:
                vals = row.get("values") or [{}]
                out[row["name"]] = (row.get("total_value") or {}).get("value", vals[0].get("value"))
            return out
        return {}
    return cached(f"stats:{mid}", 600, get)


def total_views(fresh=False):
    def get():
        rows, after = [], None
        while len(rows) < VIEWS_CAP:
            params = {"fields": "id,like_count,comments_count", "limit": 100}
            if after:
                params["after"] = after
            r = ig._call("GET", f"{uid()}/media", params)
            rows += r.get("data", [])
            paging = r.get("paging") or {}
            after = (paging.get("cursors") or {}).get("after") if paging.get("next") else None
            if not after:
                break
        rows = rows[:VIEWS_CAP]
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(6) as ex:
            stats = list(ex.map(stats_of, [m["id"] for m in rows]))

        def total(key):
            vals = [s.get(key) for s in stats if isinstance(s.get(key), (int, float))]
            return sum(vals) if vals else None
        counted = sum(1 for s in stats if isinstance(s.get("views"), (int, float)))
        return {"views": total("views"), "likes": sum(int(m.get("like_count") or 0) for m in rows),
                "comments": sum(int(m.get("comments_count") or 0) for m in rows), "shares": total("shares"), "saves": total("saved"),
                "media": len(rows), "counted": counted, "capped": bool(after)}
    return cached("views_total", 1800, get, fresh)


def media_insights(m):
    metrics = REEL_METRICS if m.get("media_product_type") == "REELS" else POST_METRICS
    try:
        r = ig._call("GET", f"{m['id']}/insights", {"metric": ",".join(metrics)})
    except ig.IgError as e:
        if "permission" in explain(e)["code"]:
            raise
        r = ig._call("GET", f"{m['id']}/insights", {"metric": ",".join(POST_METRICS[:5])})
    out = {}
    for row in r.get("data", []):
        vals = row.get("values") or [{}]
        out[row["name"]] = (row.get("total_value") or {}).get("value", vals[0].get("value"))
    return out


def media_detail(mid, fresh=False):
    def get():
        m = ig._call("GET", mid, {"fields": MEDIA_FIELDS})
        out = {"media": m, "studio_post": studio_links().get(mid)}
        try:
            out["insights"] = media_insights(m)
        except ig.IgError as e:
            out["insights_error"] = explain(e)
        try:
            out["comments"] = ig._call("GET", f"{mid}/comments", {"fields": COMMENT_FIELDS, "limit": 50}).get("data", [])
        except ig.IgError as e:
            out["comments"] = []
            out["comments_error"] = explain(e)
        return out
    return cached(f"detail:{mid}", 60, get, fresh)


def recent_comments(fresh=False):
    def get():
        rows = []
        for m in media().get("items", [])[:12]:
            if not m.get("comments_count"):
                continue
            for c in ig._call("GET", f"{m['id']}/comments", {"fields": COMMENT_FIELDS, "limit": 30}).get("data", []):
                rows.append(dict(c, media={k: m.get(k) for k in ("id", "caption", "thumbnail_url", "media_url", "media_type", "permalink")}))
        rows.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
        return rows
    return cached("comments", 60, get, fresh)


def reply_comment(cid, message):
    r = ig._call("POST", f"{cid}/replies", {"message": message})
    drop("detail:", "comments")
    return r


def comment_on(mid, message):
    r = ig._call("POST", f"{mid}/comments", {"message": message})
    drop("detail:", "comments", "media:")
    return r


def hide_comment(cid, hide):
    r = ig._call("POST", cid, {"hide": "true" if hide else "false"})
    drop("detail:", "comments")
    return r


def delete_comment(cid):
    r = ig._call("DELETE", cid)
    drop("detail:", "comments", "media:")
    return r


def account_insights(days=7, fresh=False):
    def get():
        until = int(time.time())
        since = until - days * 86400
        out = {"days": days, "totals": {}, "series": []}
        r = ig._call("GET", f"{uid()}/insights", {"metric": ",".join(ACCOUNT_METRICS), "period": "day",
                                                 "metric_type": "total_value", "since": since, "until": until})
        for row in r.get("data", []):
            out["totals"][row["name"]] = (row.get("total_value") or {}).get("value")
        try:
            s = ig._call("GET", f"{uid()}/insights", {"metric": "reach", "period": "day", "since": since, "until": until})
            for row in s.get("data", []):
                out["series"] = [{"date": v["end_time"][:10], "value": v.get("value", 0)} for v in row.get("values", [])]
        except ig.IgError:
            pass
        return out
    return cached(f"insights:{days}", 300, get, fresh)


def top_media(fresh=False):
    def get():
        rows = []
        for m in media().get("items", [])[:12]:
            try:
                rows.append(dict(m, insights=media_insights(m)))
            except ig.IgError as e:
                if explain(e)["code"] == "permission":
                    raise
        rows.sort(key=lambda m: (m["insights"].get("views") or 0), reverse=True)
        return rows
    return cached("top", 300, get, fresh)


def conversations(fresh=False):
    def get():
        r = ig._call("GET", f"{uid()}/conversations", {"platform": "instagram",
                                                       "fields": "id,updated_time,participants,messages.limit(1){message,from,created_time}"})
        me = core.settings()["instagram"].get("username")
        out = []
        for c in r.get("data", []):
            people = [p for p in (c.get("participants") or {}).get("data", []) if p.get("username") != me]
            last = ((c.get("messages") or {}).get("data") or [{}])[0]
            out.append({"id": c["id"], "updated": c.get("updated_time"), "with": people[0] if people else {},
                        "last": last.get("message", ""), "last_from_me": (last.get("from") or {}).get("username") == me})
        return out
    return cached("convs", 30, get, fresh)


def thread(cid, fresh=False):
    def get():
        r = ig._call("GET", cid, {"fields": "participants,messages.limit(50){id,message,from,to,created_time,attachments}"})
        me = core.settings()["instagram"].get("username")
        msgs = []
        for m in (r.get("messages") or {}).get("data", []):
            msgs.append({"id": m["id"], "text": m.get("message", ""), "at": m.get("created_time"),
                         "mine": (m.get("from") or {}).get("username") == me, "from": (m.get("from") or {}).get("username"),
                         "attachments": bool(m.get("attachments"))})
        msgs.sort(key=lambda m: m["at"] or "")
        people = [p for p in (r.get("participants") or {}).get("data", []) if p.get("username") != me]
        return {"id": cid, "with": people[0] if people else {}, "messages": msgs}
    return cached(f"thread:{cid}", 15, get, fresh)


def send_dm(cid, text):
    t = thread(cid)
    rid = (t.get("with") or {}).get("id")
    if not rid:
        raise ig.IgError("alıcı bulunamadı")
    r = ig._call("POST", f"{uid()}/messages", {"recipient": json.dumps({"id": rid}), "message": json.dumps({"text": text})})
    drop("thread:", "convs")
    return r


def safe(fn, *a, **kw):
    try:
        return {"ok": True, "data": fn(*a, **kw)}
    except ig.IgError as e:
        return {"ok": False, "error": explain(e)}


TAG_FIELDS = "id,caption,media_type,media_url,permalink,timestamp,username,like_count,comments_count"
DISCOVERY_FIELDS = ("username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count,"
                    "media.limit(12){id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count}")
USERNAME = re.compile(r"^[A-Za-z0-9._]{1,30}$")


def tags(fresh=False):
    return cached("tags", 120, lambda: ig._call("GET", f"{uid()}/tags", {"fields": TAG_FIELDS, "limit": 30}).get("data", []), fresh)


def watch_file():
    return core.DATA / "rakipler.json"


def watch_list():
    try:
        return json.loads(watch_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"accounts": [], "history": {}}


def clean_username(text):
    name = (text or "").strip().rstrip("/").split("?")[0].split("/")[-1].lstrip("@").lower()
    if not USERNAME.match(name):
        raise ig.IgError("geçerli bir Instagram kullanıcı adı yaz (ör. ornekhesap)")
    return name


def watch_add(text):
    name = clean_username(text)
    discover(name, True)
    w = watch_list()
    if name not in w["accounts"]:
        w["accounts"].append(name)
    watch_file().write_text(json.dumps(w, ensure_ascii=False, indent=1), encoding="utf-8")
    drop("rivals")
    return w["accounts"]


def watch_remove(name):
    w = watch_list()
    w["accounts"] = [a for a in w["accounts"] if a != name]
    watch_file().write_text(json.dumps(w, ensure_ascii=False, indent=1), encoding="utf-8")
    drop("rivals")
    return w["accounts"]


def discover(name, fresh=False):
    def get():
        try:
            r = ig._call("GET", uid(), {"fields": f"business_discovery.username({name}){{{DISCOVERY_FIELDS}}}"})
        except ig.IgError as e:
            if "(#110)" in str(e) or "Cannot find User" in str(e) or "bulunam" in str(e) or "Invalid user id" in str(e):
                raise ig.IgError(f"@{name} bulunamadı ya da profesyonel hesap değil (sadece İşletme/İçerik üreticisi hesaplar izlenebilir)") from None
            raise
        d = r["business_discovery"]
        items = (d.pop("media", None) or {}).get("data", [])
        likes = [m["like_count"] for m in items if m.get("like_count") is not None]
        comments = [m.get("comments_count") or 0 for m in items]
        d["media"] = items
        d["avg_likes"] = round(sum(likes) / len(likes)) if likes else None
        d["avg_comments"] = round(sum(comments) / len(comments), 1) if comments else None
        fol = d.get("followers_count") or 0
        d["engagement"] = round(((d["avg_likes"] or 0) + (d["avg_comments"] or 0)) / fol * 100, 2) if fol and likes else None
        stamps = sorted(m["timestamp"] for m in items if m.get("timestamp"))
        if len(stamps) >= 2:
            span = (dt.datetime.fromisoformat(stamps[-1][:19]) - dt.datetime.fromisoformat(stamps[0][:19])).total_seconds() / 86400
            d["per_week"] = round((len(stamps) - 1) / max(span, 1) * 7, 1)
        d["last_post"] = stamps[-1] if stamps else None
        return d
    return cached(f"disc:{name}", 600, get, fresh)


def track(rows):
    w = watch_list()
    today = dt.date.today().isoformat()
    hist = w.setdefault("history", {})
    for row in rows:
        if row.get("followers_count") is None:
            continue
        h = hist.setdefault(row["username"], {})
        h[today] = row["followers_count"]
        week = (dt.date.today() - dt.timedelta(days=7)).isoformat()
        base = max((k for k in h if k <= week), default=min(h))
        if base != today:
            row["growth"] = row["followers_count"] - h[base]
            row["growth_since"] = base
    watch_file().write_text(json.dumps(w, ensure_ascii=False, indent=1), encoding="utf-8")
    return rows


def rivals(fresh=False):
    def get():
        me = core.settings()["instagram"].get("username")
        rows = []
        for name in ([me] if me else []) + watch_list()["accounts"]:
            try:
                rows.append(dict(discover(name, fresh), ok=True, me=name == me))
            except ig.IgError as e:
                rows.append({"username": name, "ok": False, "me": name == me, "error": explain(e)})
        return track(rows)
    return cached("rivals", 600, get, fresh)
