import json
import re
import threading
import time
import urllib.error
import urllib.request

import core

API = "https://api.github.com/repos/BerTaDev/SosyalStudyo/releases/latest"
PAGE = "https://bertadev.github.io/SosyalStudyo/#indir"
TTL = 6 * 3600
RETRY_TTL = 30 * 60
FRESH_GAP = 10
VER_RE = re.compile(r"^\s*[vV]?(\d+(?:\.\d+){0,2})(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\s*$")

_lock = threading.Lock()
_mem = {}


def cache_file():
    return core.HOME / "update_check.json"


def current():
    try:
        return (core.ROOT / "VERSION").read_text(encoding="utf-8-sig").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def parse(text):
    m = VER_RE.match(str(text or ""))
    if not m:
        return None
    nums = [int(x) for x in m.group(1).split(".")]
    return tuple(nums + [0] * (3 - len(nums))), tuple(m.group(2).split(".")) if m.group(2) else ()


def _pre_key(part):
    return (0, int(part), "") if part.isdigit() else (1, 0, part)


def is_newer(a, b):
    pa, pb = parse(a), parse(b)
    if not pa or not pb:
        return False
    if pa[0] != pb[0]:
        return pa[0] > pb[0]
    if pa[1] == pb[1]:
        return False
    if not pa[1] or not pb[1]:
        return not pa[1]
    return [_pre_key(x) for x in pa[1]] > [_pre_key(x) for x in pb[1]]


def _clean(tag):
    tag = str(tag or "").strip()
    return tag[1:] if tag[:1] in "vV" else tag


def _fetch():
    req = urllib.request.Request(API, headers={"User-Agent": f"SosyalStudyo/{current()}", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"latest": None, "release": None, "reason": "no_release" if e.code == 404 else "error"}
    except (OSError, ValueError):
        return {"latest": None, "release": None, "reason": "offline"}
    tag = d.get("tag_name") or d.get("name") or ""
    if d.get("draft") or not parse(tag):
        return {"latest": None, "release": None, "reason": "no_release"}
    return {"latest": _clean(tag), "release": d.get("html_url") or None, "reason": None}


def _stale(c, fresh):
    age = time.time() - float(c.get("ts") or 0)
    if fresh:
        return age > FRESH_GAP or age < 0
    return age < 0 or age > (TTL if c.get("latest") or c.get("reason") == "no_release" else RETRY_TTL)


def check(fresh=False):
    with _lock:
        c = _mem.get(str(cache_file())) or {}
        f = core.read_json(cache_file(), None)
        if isinstance(f, dict) and float(f.get("ts") or 0) > float(c.get("ts") or 0):
            c = f
        if not c or _stale(c, fresh):
            c = dict(_fetch(), ts=time.time(), checked=core.now())
            try:
                core.write_json(cache_file(), c)
            except OSError:
                pass
        _mem[str(cache_file())] = c
    return view(c)


def view(c):
    cur = current()
    latest = c.get("latest") or None
    newer = bool(latest) and is_newer(latest, cur)
    return {"current": cur, "latest": latest, "newer": newer, "state": "newer" if newer else "current" if latest else "unknown",
            "checked": c.get("checked"), "page": PAGE, "release": c.get("release") if latest else None, "reason": c.get("reason")}


def handle_get(h, path, qs):
    if path != "/api/update":
        return False
    h.send_json(check("fresh" in qs))
    return True
