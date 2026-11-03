import datetime as dt
import threading
import time

import core

EVERY = 3600
TT_EVERY = 6 * 3600
KEEP_DAYS = 60
SERIES_DAYS = 30
RECENT = 12

_lock = threading.Lock()


def path():
    return core.DATA / "istatistik.json"


def load():
    d = core.read_json(path(), None)
    return d if isinstance(d, dict) else {"days": {}, "at": 0, "tt_at": 0, "cur": {}, "recent": []}


def _utc(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if ts else None


def _iso_utc(text):
    if not text:
        return None
    try:
        t = dt.datetime.fromisoformat(str(text).replace("Z", "+00:00").replace("+0000", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.astimezone()
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _title(text, n=90):
    line = (text or "").strip().splitlines()[0] if (text or "").strip() else ""
    return line[:n]


def _ig():
    import igaccount
    if not core.settings()["instagram"].get("user_id"):
        return None, []
    prof = igaccount.profile()
    out = {"followers": _num(prof.get("followers_count")), "follows": _num(prof.get("follows_count")),
           "media": _num(prof.get("media_count")), "username": prof.get("username")}
    try:
        tot = igaccount.total_views()
        out.update({k: _num(tot.get(k)) for k in ("views", "likes", "comments", "shares", "saves")})
    except Exception:  # noqa: BLE001
        pass
    try:
        ins = igaccount.account_insights(7)
        t = ins.get("totals") or {}
        out.update(reach7=_num(t.get("reach")), views7=_num(t.get("views")), engaged7=_num(t.get("accounts_engaged")),
                   interactions7=_num(t.get("total_interactions")))
    except Exception:  # noqa: BLE001
        pass
    recent = []
    try:
        for m in ((igaccount.media() or {}).get("items") or [])[:8]:
            recent.append({"p": "ig", "t": _title(m.get("caption")), "at": _iso_utc(m.get("timestamp")), "v": _num(m.get("views")),
                           "l": _num(m.get("like_count")), "c": _num(m.get("comments_count")), "u": m.get("permalink")})
    except Exception:  # noqa: BLE001
        pass
    return out, recent


def _yt():
    import youtube
    import ytaccount
    if not youtube.connected():
        return None, []
    r = ytaccount.channel()
    if not r.get("ok"):
        return None, []
    c = r["data"]
    tot = c.get("totals") or {}
    out = {"subscribers": _num(c.get("subscribers")), "views": _num(c.get("views")), "videos": _num(c.get("videos")),
           "likes": _num(tot.get("likes")), "comments": _num(tot.get("comments")), "title": c.get("title")}
    recent = []
    v = ytaccount.videos()
    if v.get("ok"):
        for x in ((v.get("data") or {}).get("items") or [])[:12]:
            if x.get("privacy") not in ("public", "unlisted") or len(recent) >= 8:
                continue
            recent.append({"p": "yt", "t": _title(x.get("title")), "at": _iso_utc(x.get("published_at")),
                           "v": _num(x.get("views")), "l": _num(x.get("likes")), "c": _num(x.get("comments")), "u": x.get("url")})
    return out, recent


def _tt():
    import tiktok
    r = tiktok.account()
    if not r.get("ok"):
        return None, []
    d = r["data"]
    prof = d.get("profile") or {}
    tot = d.get("totals") or {}
    out = {"followers": _num(prof.get("followers")), "likes": _num(prof.get("likes")), "videos": _num(prof.get("videos")),
           "views": _num(tot.get("views")), "username": prof.get("username")}
    recent = [{"p": "tt", "t": _title(x.get("desc")), "at": _iso_utc(x.get("at")), "v": _num(x.get("views")), "l": _num(x.get("likes")),
               "c": _num(x.get("comments")), "u": x.get("url")}
              for x in (d.get("items") or []) if x.get("state") != "scheduled"][:8]
    return out, recent


def _run(fn):
    try:
        return fn()
    except Exception:  # noqa: BLE001
        return None, None


def collect(force=False):
    if not _lock.acquire(blocking=False):
        return False
    try:
        d = load()
        now = time.time()
        if not force and now - float(d.get("at") or 0) < EVERY:
            return False
        cur = dict(d.get("cur") or {})
        old = {}
        for r in d.get("recent") or []:
            old.setdefault(r.get("p"), []).append(r)
        jobs = [("ig", _ig), ("yt", _yt)]
        if force or now - float(d.get("tt_at") or 0) >= TT_EVERY:
            jobs.append(("tt", _tt))
            d["tt_at"] = now
        for key, fn in jobs:
            val, rows = _run(fn)
            if val is not None:
                cur[key] = dict(val, at=_utc(now))
            if rows is not None:
                old[key] = rows
        rows = [r for k in ("ig", "yt", "tt") for r in old.get(k) or []]
        rows.sort(key=lambda r: r.get("at") or "", reverse=True)
        d["recent"] = rows[:RECENT * 2]
        d["cur"] = cur
        day = dt.date.today().isoformat()
        d.setdefault("days", {})[day] = {
            "ig_f": (cur.get("ig") or {}).get("followers"), "ig_v": (cur.get("ig") or {}).get("views"),
            "yt_s": (cur.get("yt") or {}).get("subscribers"), "yt_v": (cur.get("yt") or {}).get("views"),
            "tt_f": (cur.get("tt") or {}).get("followers"), "tt_v": (cur.get("tt") or {}).get("views"),
        }
        for k in sorted(d["days"])[:-KEEP_DAYS]:
            del d["days"][k]
        d["at"] = now
        core.write_json(path(), d)
        return True
    finally:
        _lock.release()


def snapshot():
    d = load()
    if not d.get("at"):
        return None
    days = sorted(d.get("days") or {})[-SERIES_DAYS:]
    return {"at": _utc(float(d["at"])), "ig": (d.get("cur") or {}).get("ig"), "yt": (d.get("cur") or {}).get("yt"),
            "tt": (d.get("cur") or {}).get("tt"), "hist": [dict(d["days"][k], d=k) for k in days],
            "recent": (d.get("recent") or [])[:RECENT]}
