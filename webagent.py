import collections
import re
import select
import socket
import threading
import time
import uuid

import core

OPEN = ("sirada", "calisiyor", "duraklatildi", "inceleme")
CLOSED = ("bitti", "iptal")
LABELS = {"sirada": "Sırada", "calisiyor": "Çalışıyor", "duraklatildi": "Duraklatıldı", "inceleme": "İncelemede",
          "bitti": "Bitti", "iptal": "İptal edildi"}
ACTIONS = ("open", "search", "read", "click", "type", "scroll", "back", "shot", "savehtml", "save")
VERBS = {"open": "açma", "search": "arama", "read": "okuma", "click": "tıklama", "type": "yazma", "scroll": "kaydırma",
         "back": "geri gitme", "shot": "ekran görüntüsü", "savehtml": "sayfa kaydı", "save": "bilgi kaydı"}
ID_RE = re.compile(r"G\d{3,}")
JOB_RE = re.compile(r"/api/webagent/(G\d{3,})(?:/(\w+))?")
DESKTOP_TTL = 30
PULL_WAIT = 25
RESULT_WAIT = 90
PAUSE_WAIT = 600
LOG_MAX = 600
LIST_LOG = 40

_lock = threading.Lock()
_ready = threading.Condition(_lock)
_pending = collections.deque()
_waiting = {}
_desk = {"seen": 0.0, "pulling": 0}


class Closed(Exception):
    def __init__(self, status):
        super().__init__(status)
        self.status = status


class Paused(Exception):
    pass


class NoDesktop(Exception):
    pass


def root():
    return core.DATA / "arastirma" / "gorevler"


def path(jid):
    return root() / f"{jid}.json"


def load(jid):
    return core.read_json(path(jid)) if ID_RE.fullmatch(jid or "") else None


def save(j):
    j["updated"] = core.now()
    core.write_json(path(j["id"]), j)


def update(jid, fn):
    with core.locked():
        j = load(jid)
        if j is None:
            raise KeyError(jid)
        fn(j)
        save(j)
        return j


def list_jobs():
    out = []
    if root().exists():
        for f in root().glob("G*.json"):
            j = core.read_json(f)
            if j and ID_RE.fullmatch(j.get("id") or ""):
                out.append(j)
    out.sort(key=lambda j: (j.get("created") or "", int(j["id"][1:])), reverse=True)
    return out


def title(j):
    return _short(j.get("task", "").strip().split("\n")[0], 60)


def _short(text, n=80):
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    return t if len(t) <= n else t[:n].rstrip() + "…"


def _log(j, text, kind="info"):
    j.setdefault("log", []).append({"at": core.now(), "text": _short(text, 500), "kind": kind})
    del j["log"][:-LOG_MAX]


def _take(j):
    new = [c for c in j.get("commands", []) if not c.get("seen")]
    for c in new:
        c["seen"] = True
    return [{"at": c["at"], "text": c["text"]} for c in new]


def view(j, n=LIST_LOG):
    out = {k: v for k, v in j.items() if k != "log"}
    log = j.get("log") or []
    out["log"] = log[-n:]
    out["log_total"] = len(log)
    out["label"] = LABELS.get(j["status"], j["status"])
    out["pending_commands"] = sum(1 for c in j.get("commands") or [] if not c.get("seen"))
    return out


def state():
    jobs = list_jobs()
    active = next((j for j in jobs if j["status"] in OPEN), None)
    return {"jobs": [view(j) for j in jobs[:20]], "active": view(active, LOG_MAX) if active else None, "desktop": desktop_alive()}


def new_job(task):
    task = str(task or "").strip()
    if not task:
        raise ValueError("görev boş")
    with core.locked():
        root().mkdir(parents=True, exist_ok=True)
        ids = [int(f.stem[1:]) for f in root().glob("G*.json") if f.stem[1:].isdigit()]
        jid = f"G{core.next_id(ids):03d}"
        j = {"id": jid, "task": task[:4000], "status": "sirada", "created": core.now(), "updated": core.now(), "agent": None,
             "log": [], "commands": [], "summary": "", "items": [], "page": None, "started": None, "finished": None}
        _log(j, "Görev sıraya girdi", "user")
        save(j)
    core.log_activity(f"Tarayıcı görevi sıraya girdi: {title(j)}", post=jid, kind="queue")
    return j


def claim(j, agent):
    j.update(status="calisiyor", agent=agent, claimed=core.now())
    for c in j.get("commands") or []:
        c["seen"] = True
    _log(j, f"{agent} görevi aldı", "agent")
    save(j)


def pause(jid):
    def fn(j):
        if j["status"] in CLOSED:
            raise ValueError("görev kapandı")
        if j["status"] != "duraklatildi":
            j["paused_from"] = j["status"]
            j["status"] = "duraklatildi"
            _log(j, "Kullanıcı duraklattı", "user")
    return update(jid, fn)


def resume(jid):
    def fn(j):
        if j["status"] == "duraklatildi":
            j["status"] = j.pop("paused_from", None) or ("calisiyor" if j.get("agent") else "sirada")
            _log(j, "Kullanıcı devam ettirdi", "user")
    return update(jid, fn)


def _close(jid, status, text):
    box = {}

    def fn(j):
        box["was"] = j["status"]
        if j["status"] not in CLOSED:
            j.update(status=status, finished=core.now())
            j.pop("paused_from", None)
            _log(j, text, "user")
    j = update(jid, fn)
    if box["was"] not in CLOSED:
        _drop(jid)
        core.log_activity(f"{'Tarayıcı görevi bitti' if status == 'bitti' else 'Tarayıcı görevi iptal edildi'}: {title(j)}",
                          post=jid, kind="info")
    return j


def cancel(jid):
    return _close(jid, "iptal", "Kullanıcı iptal etti")


def done(jid):
    return _close(jid, "bitti", "Kullanıcı görevi bitirdi")


def command(jid, text):
    text = str(text or "").strip()
    if not text:
        raise ValueError("komut boş")

    def fn(j):
        if j["status"] in CLOSED:
            raise ValueError("görev kapandı; yeni görev aç")
        j.setdefault("commands", []).append({"at": core.now(), "text": text[:2000], "seen": False})
        _log(j, f"Komut: {text}", "user")
        if j["status"] == "inceleme":
            j["status"] = "calisiyor"
        elif j["status"] == "duraklatildi" and j.get("paused_from") == "inceleme":
            j["paused_from"] = "calisiyor"
    return update(jid, fn)


def link_item(jid, rid):
    if not load(jid):
        return

    def fn(j):
        if rid not in j.setdefault("items", []):
            j["items"].append(rid)
    update(jid, fn)


def agent_log(jid, text):
    text = str(text or "").strip()
    if not text:
        raise ValueError("boş satır")
    box = {}

    def fn(j):
        if j["status"] in CLOSED:
            raise Closed(j["status"])
        _log(j, text, "agent")
        box["commands"] = _take(j)
    j = update(jid, fn)
    return {"ok": True, "status": j["status"], "commands": box["commands"]}


def review(jid, summary):
    summary = str(summary or "").strip()
    if not summary:
        raise ValueError("özet boş")
    box = {}

    def fn(j):
        if j["status"] in CLOSED:
            raise Closed(j["status"])
        box["commands"] = _take(j)
        nxt = "calisiyor" if box["commands"] else "inceleme"
        if j["status"] == "duraklatildi":
            j["paused_from"] = nxt
        else:
            j["status"] = nxt
        j.update(summary=summary[:6000], reviewed=core.now())
        _log(j, "İncelemeye gönderildi", "review")
    j = update(jid, fn)
    if not box["commands"]:
        core.log_activity(f"Tarayıcı araştırması incelemeye hazır: {title(j)}", post=jid, agent=j.get("agent"), kind="step")
    return {"ok": True, "status": j["status"], "commands": box["commands"], "summary": j["summary"]}


def wait(jid, timeout=600, gone=lambda: False):
    end = time.time() + max(1, min(int(timeout), 3600))
    while True:
        j = load(jid)
        if j is None:
            raise KeyError(jid)
        st = j["status"]
        fresh = any(not c.get("seen") for c in j.get("commands") or [])
        if st not in ("inceleme", "duraklatildi") or (st == "inceleme" and fresh):
            break
        if time.time() > end:
            return {"status": st, "commands": [], "summary": j.get("summary") or "", "timeout": True}
        if gone():
            return None
        time.sleep(1)
    box = {}

    def fn(q):
        box["commands"] = [] if q["status"] == "duraklatildi" else _take(q)
        if box["commands"] and q["status"] == "inceleme":
            q["status"] = "calisiyor"
    j = update(jid, fn)
    return {"status": j["status"], "commands": box["commands"], "summary": j.get("summary") or "", "timeout": False}


def desktop_alive():
    with _lock:
        return _desk["pulling"] > 0 or time.time() - _desk["seen"] < DESKTOP_TTL


def _drop(jid):
    with _lock:
        for c in [c for c in _pending if c["job"] == jid]:
            _pending.remove(c)


def pull(gone=lambda: False):
    end = time.time() + PULL_WAIT
    with _ready:
        _desk["pulling"] += 1
        _desk["seen"] = time.time()
        try:
            while True:
                if gone():
                    return None
                if _pending:
                    return _pending.popleft()
                left = end - time.time()
                if left <= 0:
                    return None
                _ready.wait(min(1.0, left))
        finally:
            _desk["pulling"] -= 1
            _desk["seen"] = time.time()


def result(cid, ok, res, error):
    with _lock:
        _desk["seen"] = time.time()
        slot = _waiting.get(cid)
        if slot:
            slot["res"] = {"ok": bool(ok), "result": res, "error": error}
            slot["event"].set()
    return bool(slot)


def _describe(action, args, res, ok, error):
    r = res if isinstance(res, dict) else {}
    item = r.get("item") if isinstance(r.get("item"), dict) else {}
    rid = f" ({item['id']})" if item.get("id") else ""
    if not ok:
        return f"Başarısız ({VERBS.get(action, action)}): {error or 'bilinmeyen hata'}"
    if action == "open":
        return f"Açıldı: {r.get('url') or args.get('url') or ''}"
    if action == "search":
        return f"Arandı: {args.get('q') or ''}"
    if action == "read":
        return f"Okundu: {r.get('title') or r.get('url') or 'sayfa'}"
    if action == "click":
        return f"Tıklandı: #{args.get('n')}" + (f" → {r['title']}" if r.get("title") else "")
    if action == "type":
        return f"Yazıldı: {_short(args.get('text'), 80)}" + (" (Enter)" if args.get("enter") else "")
    if action == "scroll":
        return f"Kaydırıldı: {args.get('dy')}"
    if action == "back":
        return "Geri gidildi"
    if action == "shot":
        return f"Ekran görüntüsü kaydedildi{rid}"
    if action == "savehtml":
        return f"Sayfa kaydedildi{rid}"
    return f"Bilgi kaydedildi{rid}: {_short(args.get('title'), 80)}"


def do(jid, action, args, gone=lambda: False):
    if action not in ACTIONS:
        raise ValueError(f"bilinmeyen işlem: {action}")
    args = args if isinstance(args, dict) else {}
    end = time.time() + PAUSE_WAIT
    while True:
        j = load(jid)
        if j is None:
            raise KeyError(jid)
        if j["status"] in CLOSED:
            raise Closed(j["status"])
        if j["status"] != "duraklatildi":
            break
        if time.time() > end:
            raise Paused()
        if gone():
            return None
        time.sleep(1)
    if not desktop_alive():
        raise NoDesktop()

    def start(q):
        if q["status"] in CLOSED:
            raise Closed(q["status"])
        if q["status"] in ("sirada", "inceleme"):
            q["status"] = "calisiyor"
        q["started"] = q.get("started") or core.now()
    if j["status"] != "calisiyor" or not j.get("started"):
        update(jid, start)
    cmd = {"id": uuid.uuid4().hex[:12], "job": jid, "action": action, "args": args}
    slot = {"event": threading.Event(), "res": None}
    with _ready:
        _waiting[cmd["id"]] = slot
        _pending.append(cmd)
        _ready.notify_all()
    limit = time.time() + RESULT_WAIT
    res = None
    try:
        while res is None:
            if slot["event"].wait(1):
                res = slot["res"]
            elif time.time() > limit:
                res = {"ok": False, "result": None, "error": f"masaüstü {RESULT_WAIT} sn içinde yanıt vermedi"}
            elif (load(jid) or {}).get("status") == "iptal":
                raise Closed("iptal")
            elif gone():
                return None
    finally:
        with _lock:
            _waiting.pop(cmd["id"], None)
            if cmd in _pending:
                _pending.remove(cmd)
    ok = res["ok"]
    out = res.get("result")
    item = out.get("item") if isinstance(out, dict) else None
    rid = item.get("id") if isinstance(item, dict) else None
    error = None if ok else str(res.get("error") or "işlem başarısız")
    box = {}

    def fin(q):
        _log(q, _describe(action, args, out, ok, error), "action" if ok else "error")
        if ok and isinstance(out, dict) and out.get("url"):
            q["page"] = {"url": out["url"], "title": out.get("title") or ""}
        if rid and rid not in q.setdefault("items", []):
            q["items"].append(rid)
        box["commands"] = _take(q)
    j = update(jid, fin)
    return {"ok": ok, "result": out, "error": error, "commands": box["commands"], "status": j["status"]}


def _gone(h):
    try:
        r, _, _ = select.select([h.connection], [], [], 0)
        return bool(r) and not h.connection.recv(1, socket.MSG_PEEK)
    except (OSError, ValueError):
        return True


def _no_content(h):
    h.send_response(204)
    h.send_header("Cache-Control", "no-store")
    h.end_headers()


def handle_get(h, path, qs):
    if not path.startswith("/api/webagent"):
        return False
    if path == "/api/webagent":
        h.send_json(state())
        return True
    if path == "/api/webagent/pull":
        cmd = pull(lambda: _gone(h))
        if cmd:
            h.send_json(cmd)
        elif _gone(h):
            h.close_connection = True
        else:
            _no_content(h)
        return True
    m = JOB_RE.fullmatch(path)
    if not m or m.group(2) not in (None, "wait"):
        h.fail("yok", 404)
        return True
    if m.group(2) is None:
        j = load(m.group(1))
        if j:
            h.send_json(view(j, LOG_MAX))
        else:
            h.fail("yok", 404)
        return True
    try:
        timeout = int((qs.get("timeout") or ["600"])[0])
    except ValueError:
        timeout = 600
    res = wait(m.group(1), timeout, lambda: _gone(h))
    if res is None:
        h.close_connection = True
    else:
        h.send_json(res)
    return True


USER_ACTIONS = {"pause": pause, "resume": resume, "cancel": cancel, "done": done}


def handle_post(h, path):
    d = h.json_body()
    try:
        if path == "/api/webagent/new":
            j = new_job(d.get("task"))
            return h.send_json(dict(state(), job=view(j, LOG_MAX)))
        if path == "/api/webagent/result":
            return h.send_json({"accepted": result(str(d.get("id") or ""), d.get("ok"), d.get("result"), d.get("error"))})
        m = JOB_RE.fullmatch(path)
        if not m or not m.group(2):
            return h.fail("yok", 404)
        jid, act = m.groups()
        if act in USER_ACTIONS or act == "command":
            j = command(jid, d.get("text")) if act == "command" else USER_ACTIONS[act](jid)
            return h.send_json(dict(state(), job=view(j, LOG_MAX)))
        if act == "do":
            res = do(jid, str(d.get("action") or ""), d.get("args"), lambda: _gone(h))
            if res is None:
                h.close_connection = True
                return None
            return h.send_json(res)
        if act == "log":
            return h.send_json(agent_log(jid, d.get("text")))
        if act == "review":
            return h.send_json(review(jid, d.get("summary")))
        return h.fail("yok", 404)
    except Closed as e:
        return h.send_json({"error": e.status, "status": e.status}, 409)
    except Paused:
        return h.send_json({"error": "duraklatıldı", "status": "duraklatildi", "paused": True}, 409)
    except NoDesktop:
        return h.send_json({"error": "masaüstü penceresi kapalı", "desktop": False}, 409)
    except ValueError as e:
        return h.fail(str(e))
