import json
import threading
import time
import traceback

import core

LIMIT = 300
KINDS = {"comment": "Yeni yorum", "dm": "Yeni mesaj", "follow": "Yeni takipçi", "ready": "Video hazır", "published": "Yayınlandı",
         "error": "Hata", "ideas": "Kurgular hazır", "agent": "Ajan", "template": "Şablon", "autopilot": "Otopilot"}
DEFAULTS = {"enabled": True, "desktop": False, "mute_until": "", "kinds": {k: k != "agent" for k in KINDS}}
_lock = threading.Lock()


def path():
    return core.DATA / "bildirimler.json"


def _load():
    d = core.read_json(path(), None) or {}
    d.setdefault("items", [])
    d.setdefault("next", 1)
    d.setdefault("state", {})
    return d


def settings():
    s = core.settings().get("notifications") or {}
    out = json.loads(json.dumps(DEFAULTS))
    out.update({k: v for k, v in s.items() if k != "kinds"})
    out["kinds"].update(s.get("kinds") or {})
    return out


def add(kind, title, text="", link=None):
    with _lock:
        d = _load()
        item = {"id": d["next"], "at": core.now(), "kind": kind, "title": title, "text": (text or "")[:240], "link": link or {}, "read": False}
        d["next"] += 1
        d["items"] = (d["items"] + [item])[-LIMIT:]
        core.write_json(path(), d)
    return item


def listing(limit=40):
    d = _load()
    return {"unread": sum(1 for i in d["items"] if not i["read"]), "last": d["next"] - 1, "items": d["items"][::-1][:limit]}


def mark_read(ids=None):
    with _lock:
        d = _load()
        for i in d["items"]:
            if ids is None or i["id"] in ids:
                i["read"] = True
        core.write_json(path(), d)


def clear():
    with _lock:
        d = _load()
        d["items"] = []
        core.write_json(path(), d)


def _state(fn):
    with _lock:
        d = _load()
        r = fn(d["state"])
        core.write_json(path(), d)
        return r


def _title_of(pid):
    try:
        if str(pid).startswith("F"):
            import ideas
            return ideas.load(pid)["topic"]
        if str(pid).startswith("S"):
            import tplreq
            return tplreq.load(pid)["name"]
        if str(pid).startswith("A"):
            import autopilot
            return autopilot.load(pid)["name"]
        return core.load_post(pid)["title"]
    except Exception:  # noqa: BLE001
        return ""


def from_activity(e):
    pid, kind, text, agent = e.get("post"), e.get("kind"), e.get("text") or "", e.get("agent")
    sid = str(pid or "")
    title = _title_of(pid) if pid else ""
    if sid.startswith("A") and kind in ("error", "done"):
        return "error" if kind == "error" else "autopilot", "Otopilot", text.replace(f"Otopilot · {title}: ", f"{title}: "), {"tab": "auto"}
    if kind == "error":
        failed = text.startswith("Paylaşılamadı")
        text = text.split(": ", 1)[1] if failed and ": " in text else text
        return "error", "Paylaşılamadı" if failed else "Bir iş hata verdi", f"{title}: {text}" if title else text, {"post": pid}
    if kind == "done":
        if sid.startswith("F"):
            return "ideas", "Metin kurguları hazır", text, {"ideas": pid}
        if sid.startswith("S"):
            return "template", "Şablonun hazır", text, {"tab": "create"}
        if text == "Instagram'da yayınlandı":
            return "published", "Instagram'da yayınlandı", title, {"post": pid}
        if text == "Açıklama yazıldı":
            return "agent", "Açıklama hazır", title, {"post": pid}
        if agent:
            return "ready", "Video hazır", title, {"post": pid}
    if kind == "info" and text == "Kullanıcıya yanıt yazdı":
        return "agent", f"{agent or 'Ajan'} notuna yanıt verdi", title, {"post": pid}
    return None


def tail_activity():
    f = core.DATA / "activity.jsonl"
    if not f.exists():
        return
    size = f.stat().st_size
    start = _state(lambda s: s.get("activity_pos"))
    if start is None or start > size:
        _state(lambda s: s.update(activity_pos=size))
        return
    if start == size:
        return
    with open(f, "rb") as fh:
        fh.seek(start)
        chunk = fh.read(size - start)
    end = start + chunk.rfind(b"\n") + 1
    for line in chunk[: end - start].decode("utf-8", "replace").splitlines():
        try:
            n = from_activity(json.loads(line))
        except ValueError:
            continue
        if n:
            add(*n)
    _state(lambda s: s.update(activity_pos=end))


def check_dms():
    import igaccount
    me = core.settings()["instagram"].get("username")
    convs = igaccount.conversations(fresh=True)
    seen = _state(lambda s: s.get("dm"))
    fresh = {c["id"]: c.get("updated") for c in convs}
    if seen is not None:
        for c in convs:
            if seen.get(c["id"]) != c.get("updated") and not c.get("last_from_me"):
                who = (c.get("with") or {}).get("username") or "biri"
                if who != me:
                    add("dm", f"@{who} mesaj gönderdi", c.get("last") or "", {"tab": "account", "sub": "dms", "conv": c["id"]})
    _state(lambda s: s.update(dm=fresh))


def check_comments():
    import igaccount
    import instagram as ig
    me = core.settings()["instagram"].get("username")
    items = igaccount.media(fresh=True)["items"]
    st = _state(lambda s: dict(s))
    counts, since = st.get("comment_counts"), st.get("comments_since")
    now_counts = {m["id"]: m.get("comments_count") or 0 for m in items}
    if counts is None or not since:
        utc = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
        _state(lambda s: s.update(comment_counts=now_counts, comments_since=utc))
        return
    seen = set(st.get("comment_ids") or [])
    new_ids = []
    for m in items:
        if now_counts[m["id"]] <= counts.get(m["id"], 0):
            continue
        rows = ig._call("GET", f"{m['id']}/comments", {"fields": igaccount.COMMENT_FIELDS, "limit": 50}).get("data", [])
        flat = rows + [r for c in rows for r in ((c.get("replies") or {}).get("data") or [])]
        for c in flat:
            if c["id"] in seen or c.get("username") == me or (c.get("timestamp") or "")[:19] <= since:
                continue
            add("comment", f"@{c.get('username') or 'biri'} yorum yaptı", c.get("text") or "", {"tab": "account", "sub": "comments", "media": m["id"]})
        new_ids += [c["id"] for c in flat]
    if new_ids:
        igaccount.drop("comments", "detail:")
    _state(lambda s: s.update(comment_counts=now_counts, comment_ids=list(dict.fromkeys((s.get("comment_ids") or []) + new_ids))[-2000:]))


def check_followers():
    import igaccount
    n = igaccount.profile(fresh=True).get("followers_count")
    if n is None:
        return
    prev = _state(lambda s: s.get("followers"))
    if prev is not None and n > prev:
        diff = n - prev
        add("follow", f"{diff} yeni takipçi", f"Toplam {n:,}".replace(",", "."), {"tab": "account"})
    _state(lambda s: s.update(followers=n))


def loop():
    last = {"dm": 0, "comments": 0, "followers": 0}
    every = {"dm": 120, "comments": 300, "followers": 600}
    jobs = {"dm": check_dms, "comments": check_comments, "followers": check_followers}
    while True:
        try:
            tail_activity()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        ig = core.settings()["instagram"]
        if ig.get("token") and ig.get("user_id") and settings()["enabled"]:
            for k, fn in jobs.items():
                if time.time() - last[k] < every[k]:
                    continue
                last[k] = time.time()
                try:
                    fn()
                except Exception:  # noqa: BLE001
                    pass
        time.sleep(3)
