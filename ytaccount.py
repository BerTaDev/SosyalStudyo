import datetime as dt
import re
import threading
import time

import core
import youtube as yt

TTL = 600
ERR_TTL = 60
MIN_FRESH = 20
PAGE = 24
SHORT_MAX = 180
CHANNEL_PARTS = "snippet,statistics,contentDetails,brandingSettings"
VIDEO_PARTS = "snippet,statistics,status,contentDetails"
BANNER_CROP = "=w2120"
COST = {"channel": 3, "videos": 2}
VIEWS_CAP = 100

_cache = {}
_locks = {}
_guard = threading.Lock()


class NotConnected(Exception):
    pass


def _lock(key):
    with _guard:
        return _locks.setdefault(key, threading.Lock())


def _iso(ts):
    return dt.datetime.fromtimestamp(ts).replace(microsecond=0).isoformat() if ts else None


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _chan():
    c = yt.conf()
    if not yt.connected(c):
        raise NotConnected()
    return (c.get("channel") or {}).get("id") or "mine"


def explain(e):
    if isinstance(e, NotConnected):
        return {"code": "not_connected", "message": "YouTube kanalı bağlı değil"}
    if getattr(e, "reconnect", False):
        return {"code": "reconnect", "message": "YouTube bağlantısının süresi doldu; Ayarlar > YouTube'dan yeniden bağlan"}
    if getattr(e, "quota", False):
        return {"code": "quota", "message": f"{e}; kota {yt._nice(yt.reset_at())} sonra yenilenir"}
    return {"code": "error", "message": str(e) or "YouTube'dan bilgi alınamadı"}


def _out(entry):
    if entry.get("data") is None:
        return {"ok": False, "error": entry["error"]}
    return {"ok": True, "data": entry["data"], "fetched_at": _iso(entry["fetched"]), "warning": entry.get("error")}


def cached(key, fn, fresh=False):
    with _lock(key):
        hit = _cache.get(key)
        if hit:
            age = time.time() - hit["t"]
            live = age < (TTL if hit.get("error") is None else ERR_TTL)
            if live and not (fresh and (age >= MIN_FRESH or hit.get("error"))):
                return _out(hit)
        try:
            entry = {"t": time.time(), "fetched": time.time(), "data": fn(), "error": None}
        except yt.YtError as e:
            entry = {"t": time.time(), "fetched": (hit or {}).get("fetched"), "data": (hit or {}).get("data"), "error": explain(e)}
        _cache[key] = entry
        return _out(entry)


def drop(prefix):
    for k in list(_cache):
        if k.startswith(prefix):
            _cache.pop(k, None)


def _thumb(th, order):
    th = th or {}
    for k in order:
        if (th.get(k) or {}).get("url"):
            return th[k]["url"]
    return None


def _banner(url):
    if not url:
        return None
    tail = url.rsplit("/", 1)[-1]
    return url + BANNER_CROP if "googleusercontent.com" in url and "=" not in tail else url


def _channel_view(it):
    sn = it.get("snippet") or {}
    st = it.get("statistics") or {}
    pl = (it.get("contentDetails") or {}).get("relatedPlaylists") or {}
    br = (it.get("brandingSettings") or {}).get("image") or {}
    cid = it.get("id") or ""
    handle = (sn.get("customUrl") or "").strip()
    if handle and not handle.startswith("@"):
        handle = "@" + handle
    banner = br.get("bannerExternalUrl")
    return {"id": cid, "title": sn.get("title") or cid, "handle": handle or None, "description": sn.get("description") or "",
            "avatar": _thumb(sn.get("thumbnails"), ("high", "medium", "default")), "banner": banner, "banner_wide": _banner(banner),
            "country": sn.get("country"), "created_at": sn.get("publishedAt"),
            "subscribers": None if st.get("hiddenSubscriberCount") else _int(st.get("subscriberCount")),
            "subscribers_hidden": bool(st.get("hiddenSubscriberCount")), "views": _int(st.get("viewCount")),
            "videos": _int(st.get("videoCount")), "uploads": pl.get("uploads"),
            "url": f"https://www.youtube.com/{handle}" if handle else f"https://www.youtube.com/channel/{cid}",
            "studio_url": f"https://studio.youtube.com/channel/{cid}" if cid else "https://studio.youtube.com"}


def _video_totals(up):
    tot, seen, page = {"views": 0, "likes": 0, "comments": 0}, 0, None
    while seen < VIEWS_CAP:
        params = {"part": "contentDetails", "playlistId": up, "maxResults": 50}
        if page:
            params["pageToken"] = page
        pl = yt._api("GET", "/playlistItems", params, cost=1)
        ids = list(dict.fromkeys(i for i in ((x.get("contentDetails") or {}).get("videoId") for x in pl.get("items") or []) if i))
        if ids:
            j = yt._api("GET", "/videos", {"part": "statistics", "id": ",".join(ids), "maxResults": len(ids)}, cost=1)
            for x in j.get("items") or []:
                st = x.get("statistics") or {}
                tot["views"] += _int(st.get("viewCount")) or 0
                tot["likes"] += _int(st.get("likeCount")) or 0
                tot["comments"] += _int(st.get("commentCount")) or 0
        seen += len(ids)
        page = pl.get("nextPageToken")
        if not page or not ids:
            break
    return dict(tot, videos=seen)


def _fetch_channel():
    j = yt._api("GET", "/channels", {"part": CHANNEL_PARTS, "mine": "true"}, cost=1)
    items = j.get("items") or []
    if not items:
        raise yt.YtError("Bu Google hesabında YouTube kanalı bulunamadı")
    view = _channel_view(items[0])
    if view["uploads"]:
        try:
            tot = _video_totals(view["uploads"])
            view["views"] = max(view["views"] or 0, tot["views"])
            view["totals"] = dict(tot, views=view["views"])
        except yt.YtError:
            pass
    return view


def _meta():
    c = yt.conf()
    return {"audited": bool(c.get("audited")), "needs_reconnect": yt.needs_reconnect(), "quota": yt.quota_info(c), "cost": COST}


def channel(fresh=False):
    cid = _chan()
    r = cached(f"channel:{cid}", _fetch_channel, fresh)
    r.update(_meta())
    return r


def _duration(text):
    m = re.fullmatch(r"P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?", text or "")
    if not m:
        return None
    d, h, mi, s = m.groups()
    return int(d or 0) * 86400 + int(h or 0) * 3600 + int(mi or 0) * 60 + int(float(s or 0))


def _future(stamp):
    try:
        return dt.datetime.fromisoformat(stamp.replace("Z", "+00:00")) > dt.datetime.now(dt.timezone.utc)
    except (AttributeError, ValueError):
        return False


def _video_view(it):
    sn = it.get("snippet") or {}
    ss = it.get("status") or {}
    st = it.get("statistics") or {}
    vid = it.get("id") or ""
    priv = ss.get("privacyStatus") or "private"
    pub_at = ss.get("publishAt")
    secs = _duration((it.get("contentDetails") or {}).get("duration"))
    short = secs is not None and 0 < secs <= SHORT_MAX
    th = sn.get("thumbnails") or {}
    return {"id": vid, "title": sn.get("title") or "", "description": sn.get("description") or "",
            "published_at": sn.get("publishedAt"), "privacy": "scheduled" if priv == "private" and _future(pub_at) else priv,
            "privacy_raw": priv, "publish_at": pub_at, "upload_status": ss.get("uploadStatus"),
            "processing": ss.get("uploadStatus") == "uploaded", "duration": secs, "short": short,
            "thumb": _thumb(th, ("high", "standard", "medium", "default")),
            "thumb_hi": _thumb(th, ("maxres", "standard", "high", "medium", "default")),
            "views": _int(st.get("viewCount")), "likes": _int(st.get("likeCount")), "comments": _int(st.get("commentCount")),
            "url": f"https://youtube.com/shorts/{vid}" if short else f"https://www.youtube.com/watch?v={vid}",
            "studio_url": f"https://studio.youtube.com/video/{vid}/edit"}


def _uploads_id(cid):
    hit = _cache.get(f"channel:{cid}")
    up = ((hit or {}).get("data") or {}).get("uploads")
    if up:
        return up
    if cid.startswith("UC") and len(cid) > 2:
        return "UU" + cid[2:]
    r = channel()
    if not r["ok"]:
        raise yt.YtError(r["error"]["message"])
    return r["data"]["uploads"]


def _fetch_videos(cid, page):
    params = {"part": "contentDetails", "playlistId": _uploads_id(cid), "maxResults": PAGE}
    if page:
        params["pageToken"] = page
    try:
        pl = yt._api("GET", "/playlistItems", params, cost=1)
    except yt.YtError as e:
        if e.status == 404 and not page:
            return {"items": [], "next": None, "total": 0}
        raise
    ids = [(x.get("contentDetails") or {}).get("videoId") for x in pl.get("items") or []]
    ids = list(dict.fromkeys(i for i in ids if i))
    items = []
    if ids:
        j = yt._api("GET", "/videos", {"part": VIDEO_PARTS, "id": ",".join(ids), "maxResults": len(ids)}, cost=1)
        by = {x.get("id"): x for x in j.get("items") or []}
        items = [_video_view(by[i]) for i in ids if i in by]
    total = (pl.get("pageInfo") or {}).get("totalResults")
    return {"items": items, "next": pl.get("nextPageToken"), "total": total if total is not None else len(items)}


def studio_links():
    out = {}
    for p in core.list_posts():
        y = p.get("youtube") or {}
        if y.get("video_id"):
            out[y["video_id"]] = {"id": p["id"], "title": p.get("title") or "", "state": y.get("state")}
    return out


def videos(page=None, fresh=False):
    cid = _chan()
    if fresh and not page:
        for k in list(_cache):
            if k.startswith(f"videos:{cid}:") and k != f"videos:{cid}:":
                _cache.pop(k, None)
    r = cached(f"videos:{cid}:{page or ''}", lambda: _fetch_videos(cid, page), fresh)
    if r["ok"]:
        links = studio_links()
        r["data"] = dict(r["data"], items=[dict(v, studio=links.get(v["id"])) for v in r["data"]["items"]])
    r.update(_meta())
    return r


def safe(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except (NotConnected, yt.YtError) as e:
        out = {"ok": False, "error": explain(e)}
        try:
            out.update(_meta())
        except Exception:  # noqa: BLE001
            pass
        return out
