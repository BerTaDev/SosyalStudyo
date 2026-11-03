import datetime as dt
import json
import math
import re
import threading
import traceback

import core
import ideas
import produce

CHARS_PER_SEC = 14
MAX_VIDEOS = 30
EXTRA_IDEAS = 2
LEAD = dt.timedelta(minutes=10)
GAP = dt.timedelta(minutes=30)
LATE = dt.timedelta(hours=6)
HORIZON = 366
MODES = ("immediate", "slots", "interval", "review")
ACTIVE = ("calisiyor", "onay_bekliyor", "duraklatildi")
MAKING = ("sirada", "uretimde")
LIVE = ("sirada", "uretimde", "inceleme")
SENT = ("planlandi", "paylasiliyor", "paylasildi")
HM = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")
_lock = threading.RLock()


def root():
    return core.DATA / "autopilot"


def path(aid):
    return root() / f"{aid}.json"


def load(aid):
    return core.read_json(path(aid))


def save(c):
    c["updated"] = core.now()
    with core.locked():
        core.write_json(path(c["id"]), c)


def list_campaigns(deleted=False):
    out = []
    if root().exists():
        for f in root().glob("A*.json"):
            c = core.read_json(f)
            if c and (deleted or not c.get("deleted")):
                out.append(c)
    out.sort(key=lambda c: c["created"], reverse=True)
    return out


def must(aid):
    c = load(aid)
    if c is None or c.get("deleted"):
        raise KeyError(aid)
    return c


def log(c, text, kind="info"):
    core.log_activity(f"Otopilot · {c['name']}: {text}", post=c["id"], kind=kind)


def by(c):
    return f"Otopilot: {c['name']}"


def fmt(t):
    return t.isoformat(timespec="minutes")


def nice(t):
    return t.strftime("%d.%m.%Y %H:%M")


def parse(s):
    try:
        return core.parse_time(str(s)) if s else None
    except ValueError:
        return None


def minutes(s):
    m = HM.match(str(s or "").strip())
    if not m:
        raise ValueError(s)
    return int(m.group(1)) * 60 + int(m.group(2))


def hm(n):
    return f"{n // 60:02d}:{n % 60:02d}"


def chars(idea):
    return sum(len(x) for x in idea.get("lines") or [])


def template_ids():
    try:
        return {m["id"] for m in produce.list_templates()}
    except OSError:
        return set()


def plan_templates(topics, brief, start=0):
    out, k = [], start
    for t in topics:
        for _ in range(t["count"]):
            tpl, src = pick_template(t, brief, k)
            k += src == "mix"
            out.append(tpl)
    return out


def pick_template(topic, brief, mix_index, override=None, idea=None):
    if override:
        return override, "approve"
    if idea and idea.get("template"):
        return idea["template"], "idea"
    if topic.get("template"):
        return topic["template"], "topic"
    if brief.get("template_mode") == "mix" and brief.get("templates"):
        return brief["templates"][mix_index % len(brief["templates"])], "mix"
    if brief.get("template"):
        return brief["template"], "brief"
    return None, None


# ---------- validation ----------

def normalize_publish(p, check_time=True):
    errors = []
    now = dt.datetime.now()
    mode = p.get("mode") if p.get("mode") in MODES else "review"
    slots = []
    for s in p.get("slots") or []:
        t = parse(s)
        if t is None:
            errors.append(f"Geçersiz paylaşım saati: {s}")
            continue
        slots.append(t.replace(second=0, microsecond=0))
    slots = sorted(set(slots))
    iv = p.get("interval") or {}
    try:
        start = dt.date.fromisoformat(str(iv.get("start") or "")[:10]).isoformat()
    except ValueError:
        start = now.date().isoformat()
    times = set()
    for x in iv.get("times") or []:
        try:
            times.add(minutes(x))
        except ValueError:
            errors.append(f"Geçersiz saat: {x}")
    every = None
    if iv.get("every_hours") not in (None, "", 0, "0"):
        try:
            every = max(1, min(168, int(iv["every_hours"])))
        except (TypeError, ValueError):
            errors.append("Geçersiz saat aralığı")
    window = list(iv.get("window") or ["09:00", "23:00"])[:2]
    try:
        window = [hm(minutes(window[0])), hm(minutes(window[1]))]
    except (ValueError, IndexError):
        errors.append("Geçersiz zaman aralığı")
        window = ["09:00", "23:00"]
    raw_days = iv.get("days")
    days = sorted({int(x) for x in (range(7) if raw_days is None else raw_days) if str(x).lstrip("-").isdigit() and 0 <= int(x) <= 6})
    interval = {"start": start, "times": [hm(x) for x in sorted(times)], "every_hours": every, "window": window, "days": days}
    if mode == "slots":
        if not slots:
            errors.append("En az bir paylaşım saati ekle")
        elif check_time and slots[0] <= now:
            errors.append(f"Geçmiş bir saat seçildi: {nice(slots[0])}")
    if mode == "interval":
        if not times and not every:
            errors.append("Günlük paylaşım saati ya da 'her N saatte bir' seç")
        if not days:
            errors.append("En az bir gün seç")
    return {"mode": mode, "slots": [fmt(t) for t in slots], "interval": interval}, errors


def normalize(d, check_time=True):
    errors = []
    topics = []
    known = template_ids()

    def check_tpl(tid):
        if tid and tid not in known:
            errors.append(f"Bilinmeyen video stili: {tid}")
    for t in d.get("topics") or []:
        if not isinstance(t, dict):
            continue
        name = str(t.get("topic") or "").strip()
        if not name:
            continue
        try:
            n = int(t.get("count") or 1)
        except (TypeError, ValueError):
            n = 1
        tpl = str(t.get("template") or "").strip()
        check_tpl(tpl)
        topics.append({"topic": name[:200], "count": max(1, min(MAX_VIDEOS, n)), "template": tpl})
    total = sum(t["count"] for t in topics)
    if not topics:
        errors.append("En az bir konu yaz")
    elif total > MAX_VIDEOS:
        errors.append(f"En fazla {MAX_VIDEOS} video üretilebilir (şu an {total})")
    raw = d.get("brief") or {}
    brief = {}
    for k in ("tone", "audience", "notes", "template", "style"):
        v = raw.get(k)
        brief[k] = v.strip() if isinstance(v, str) else (v if v not in (None, []) else "")
    brief["format"] = str(raw.get("format") or "9:16")
    try:
        brief["duration"] = max(5, min(600, int(raw.get("duration") or 30)))
    except (TypeError, ValueError):
        brief["duration"] = 30
    mode = raw.get("template_mode")
    if mode not in ("agent", "single", "mix"):
        mode = "single" if brief["template"] else "agent"
    templates = []
    for x in raw.get("templates") or []:
        x = str(x or "").strip()
        if x and x not in templates:
            templates.append(x)
    if mode == "agent":
        brief["template"], templates = "", []
    elif mode == "single":
        templates = []
        if not brief["template"]:
            errors.append("Tek stil için bir video stili seç")
        check_tpl(brief["template"])
    else:
        brief["template"] = ""
        if len(templates) < 2:
            errors.append("Karışık stil için en az 2 video stili seç")
        for x in templates:
            check_tpl(x)
    brief["template_mode"], brief["templates"] = mode, templates
    publish, perr = normalize_publish(d.get("publish") or {}, check_time)
    name = str(d.get("name") or "").strip() or (topics[0]["topic"] if topics else "Otopilot")
    try:
        targets = core.norm_targets(d.get("targets"))
    except ValueError as e:
        targets = None
        errors.append(str(e))
    spec = {"name": name[:80], "topics": topics, "brief": brief, "review_ideas": bool(d.get("review_ideas")), "publish": publish,
            "repeat_of": str(d.get("repeat_of") or "").strip() or None, "targets": targets}
    return spec, errors + perr


# ---------- schedule ----------

def interval_iter(iv, after):
    days = set(iv.get("days") or [])
    start = dt.date.fromisoformat(iv["start"])
    first = max(start, after.date() - dt.timedelta(days=1))
    every = iv.get("every_hours")
    if every:
        w0, w1 = minutes(iv["window"][0]), minutes(iv["window"][1])
        if every < 24:
            end = w1 if w1 >= w0 else w1 + 1440
            for k in range(HORIZON + 1):
                d = first + dt.timedelta(days=k)
                if d.weekday() not in days:
                    continue
                base = dt.datetime.combine(d, dt.time())
                m = w0
                while m <= end:
                    t = base + dt.timedelta(minutes=m)
                    if t >= after:
                        yield t
                    m += every * 60
            return
        anchor = dt.datetime.combine(start, dt.time()) + dt.timedelta(minutes=w0)
        step = dt.timedelta(hours=every)
        j = max(0, math.ceil((after - anchor) / step))
        for k in range(j, j + HORIZON * 24 // every + 2):
            t = anchor + k * step
            m = t.hour * 60 + t.minute
            inside = w0 <= m <= w1 if w0 <= w1 else (m >= w0 or m <= w1)
            if t.weekday() in days and inside:
                yield t
        return
    times = sorted(minutes(x) for x in iv.get("times") or [])
    if not times:
        return
    for k in range(HORIZON + 1):
        d = first + dt.timedelta(days=k)
        if d.weekday() not in days:
            continue
        for m in times:
            t = dt.datetime.combine(d, dt.time()) + dt.timedelta(minutes=m)
            if t >= after:
                yield t


def free_slots(iv, n, taken, now=None):
    now = now or dt.datetime.now()
    taken = list(taken)
    out = []
    if n <= 0:
        return out
    for t in interval_iter(iv, now + LEAD):
        if any(abs(t - x) < GAP for x in taken):
            continue
        out.append(t)
        taken.append(t)
        if len(out) >= n:
            break
    return out


def taken_slots(posts, current=None):
    out = []
    status = {p["id"]: p["status"] for p in posts}
    for p in posts:
        if p["status"] == "planlandi" and parse(p.get("schedule")):
            out.append(parse(p["schedule"]))
        ar = p.get("after_render") or {}
        if ar.get("action") == "schedule" and parse(ar.get("at")):
            out.append(parse(ar["at"]))
    cs = [c for c in list_campaigns() if not current or c["id"] != current["id"]] + ([current] if current else [])
    for c in cs:
        if c["status"] == "iptal":
            continue
        for e in c["posts"]:
            if e.get("slot") and not e.get("gone") and status.get(e["post"]) in LIVE and parse(e["slot"]):
                out.append(parse(e["slot"]))
    return out


def next_slot(c):
    used = {e["slot"] for e in c["posts"] if e.get("slot") and not e.get("gone")}
    now = dt.datetime.now()
    for s in c["publish"]["slots"]:
        if s not in used and parse(s) > now:
            return s
    return None


def upcoming(c, posts):
    mode = c["publish"]["mode"]
    now = dt.datetime.now()
    if mode == "slots":
        used = {e["slot"] for e in c["posts"] if e.get("slot") and not e.get("gone")}
        return [s for s in c["publish"]["slots"] if s not in used and parse(s) > now][:10]
    if mode == "interval" and c["status"] in ACTIVE:
        return [fmt(t) for t in free_slots(c["publish"]["interval"], 10, taken_slots(posts, c))]
    return []


# ---------- credits ----------

def voice_left(p):
    if p["status"] not in MAKING or p.get("manual") or (p.get("brief") or {}).get("voiceover") is False:
        return 0
    lines = []
    if p.get("project"):
        try:
            lines = produce.voice_lines(p)
        except (KeyError, TypeError, OSError):
            lines = []
    if lines:
        return sum(len(x["text"]) for x in lines if not x["audio"])
    script = (p.get("script") or {}).get("lines") or []
    return sum(len(x) for x in script) if script else int(p.get("duration") or 30) * CHARS_PER_SEC


def credit_info(posts=None):
    cr = core.eleven_credits()
    if not isinstance(cr, dict) or cr.get("error") or cr.get("left") is None:
        return None, (cr or {}).get("error") if isinstance(cr, dict) else None, 0
    reserved = sum(voice_left(p) for p in (posts if posts is not None else core.list_posts()))
    return cr, None, reserved


# ---------- engine ----------

def entry_for(c, i):
    return next((e for e in c["batches"] if e.get("index") == i), None)


def same_topic(a, b):
    return str(a or "").strip().casefold() == str(b or "").strip().casefold()


def previous_titles(aid, topic, limit=15):
    out, seen = [], set()
    for _ in range(5):
        prev = load(aid) if aid else None
        if not prev:
            break
        for e in prev.get("batches") or []:
            if not same_topic(e.get("topic"), topic):
                continue
            b = ideas.load(e["batch"]) or {}
            items = sorted(b.get("ideas") or [], key=lambda i: i.get("status") != "uretimde")
            for i in items:
                title = str(i.get("title") or "").strip()
                if title and title.casefold() not in seen:
                    seen.add(title.casefold())
                    out.append(title if len(title) <= 80 else title[:79] + "…")
        aid = prev.get("repeat_of")
    return out[:limit]


def brief_for(c, i):
    b = c["brief"]
    topic = c["topics"][i]
    notes = [b["notes"]] if b.get("notes") else []
    notes.append(f"Bu set otomatik üretim için yazılıyor: her fikir yaklaşık {b['duration']} saniyelik ayrı bir video olacak.")
    tpl = topic.get("template") or (b.get("template") if b.get("template_mode") != "mix" else "")
    if not tpl and b.get("template_mode") == "mix":
        notes.append("Videolar farklı görsel stillerle üretilecek; seslendirme metnini her stile uyan sade cümlelerle yaz.")
    if c.get("repeat_of"):
        titles = previous_titles(c["repeat_of"], topic["topic"])
        if titles:
            notes.append("Bu konuda daha önce şu fikirler işlendi; bunlardan farklı, yeni fikirler yaz: " + "; ".join(titles))
    out = {k: v for k, v in b.items() if k not in ("template_mode", "templates")}
    out.update(notes="\n".join(notes), template=tpl or "")
    return out


def ensure_batches(c):
    for i, t in enumerate(c["topics"]):
        if entry_for(c, i):
            continue
        want = min(MAX_VIDEOS, t["count"] + EXTRA_IDEAS) if c["review_ideas"] else t["count"]
        b = ideas.new_batch(t["topic"], want, brief_for(c, i))
        c["batches"].append({"index": i, "topic": t["topic"], "count": t["count"], "batch": b["id"], "produced": False})


def fail(c, text):
    c.update(status="hata", stage=text, hold=None)
    log(c, text, "error")


def check_batches(c, batches):
    for e in c["batches"]:
        if e["produced"]:
            continue
        b = batches.get(e["batch"])
        if not b or b.get("deleted"):
            return fail(c, f"Fikir seti silinmiş: {e['topic']}")
        if b["status"] == "hata":
            return fail(c, f"Fikir seti hata verdi: {e['topic']}" + (f" ({b['stage']})" if b.get("stage") else ""))


def auto_pick(b, count):
    return [i["id"] for i in b["ideas"] if i["status"] not in ("elendi", "uretimde")][:count]


def select(c, batches):
    pending = [e for e in c["batches"] if not e["produced"] and "selected" not in e]
    if not pending:
        return
    if c["review_ideas"]:
        if len(c["batches"]) == len(c["topics"]) and all(batches[e["batch"]]["status"] == "hazir" for e in pending):
            c.update(status="onay_bekliyor", stage="Fikirler onayını bekliyor")
            log(c, "Fikirler hazır, onayını bekliyor", "done")
        return
    for e in pending:
        b = batches[e["batch"]]
        if b["status"] == "hazir":
            e["selected"] = auto_pick(b, e["count"])


def remaining(c, e, b):
    done = {x["idea"] for x in c["posts"]}
    sel = set(e.get("selected") or [])
    return [i for i in b["ideas"] if i["id"] in sel and i["id"] not in done and i["status"] != "uretimde"]


def produce_selected(c, batches):
    todo = []
    for e in c["batches"]:
        if e["produced"] or "selected" not in e:
            continue
        items = remaining(c, e, batches[e["batch"]])
        if not items:
            e["produced"] = True
            continue
        todo += [(e, i) for i in items]
    if not todo:
        return None
    cr, err, reserved = credit_info()
    if cr is None:
        text = "ElevenLabs kredisi okunamadı, tekrar denenecek" + (f" ({err})" if err else "")
        if c.get("stage") != text:
            log(c, text, "info")
        c["stage"] = text
        return text
    avail = (cr["left"] or 0) - reserved
    need = [chars(i) for _, i in todo]
    k = used = 0
    for n in need:
        if used + n > avail:
            break
        used += n
        k += 1
    go = todo[:k]
    order = []
    for e, _ in go:
        if e not in order:
            order.append(e)
    for e in order:
        items = [i for ee, i in go if ee is e]
        idx = e.get("index")
        topic = c["topics"][idx] if isinstance(idx, int) and 0 <= idx < len(c["topics"]) else {}
        mix = sum(1 for x in c["posts"] if x.get("template_from") == "mix")
        plan = {}
        for i in items:
            plan[i["id"]] = pick_template(topic, c["brief"], mix, (e.get("templates") or {}).get(i["id"]), i)
            mix += plan[i["id"]][1] == "mix"
        pids = ideas.produce(e["batch"], [i["id"] for i in items], templates={k: v[0] for k, v in plan.items() if v[0]},
                             targets=c.get("targets"))
        b = ideas.load(e["batch"])
        batches[e["batch"]] = b
        idea_of = {i.get("post"): i for i in b["ideas"] if i.get("post") in pids}
        for pid in pids:
            iid = idea_of[pid]["id"] if pid in idea_of else None
            tpl, src = plan.get(iid, (None, None))
            entry = {"post": pid, "idea": iid, "batch": e["batch"], "topic": e["topic"], "template": tpl, "template_from": src,
                     "slot": None, "handled": False, "action": None, "preset": False}
            patch = {"autopilot": c["id"]}
            if c["publish"]["mode"] == "slots":
                entry["slot"] = next_slot(c)
                if entry["slot"]:
                    patch["after_render"] = {"action": "schedule", "at": entry["slot"], "by": by(c), "set": core.now()}
                    entry["preset"] = True
            core.update_post(pid, lambda q, patch=patch: q.update(patch))
            c["posts"].append(entry)
        if not remaining(c, e, b):
            e["produced"] = True
    if go:
        log(c, f"{len(go)} video üretime gönderildi", "queue")
    if k < len(todo):
        rest = sum(need[k:])
        c.update(status="duraklatildi", hold="credits",
                 stage=f"ElevenLabs kredisi yetmiyor: {rest} karakter gerekli, {max(0, avail - used)} kaldı")
        log(c, c["stage"] + f" ({k} video üretime gönderildi, {len(todo) - k} video bekliyor)", "error")
    return None


def preset_slot(c, e, p):
    at = parse(e["slot"])
    if not at or at < dt.datetime.now() + LEAD:
        return
    ar = {"action": "schedule", "at": e["slot"], "by": by(c), "set": core.now()}
    core.update_post(p["id"], lambda q: q.update(after_render=ar))
    p["after_render"] = ar
    e["preset"] = True


def handle_posts(c):
    mode = c["publish"]["mode"]
    posts = core.list_posts()
    pm = {p["id"]: p for p in posts}
    now = dt.datetime.now()
    taken = None
    for e in c["posts"]:
        p = pm.get(e["post"])
        if not p:
            if not e.get("gone"):
                e.update(gone=True, handled=True)
            continue
        st = p["status"]
        if e["handled"] and e.get("action") in ("publish", "schedule") and st in MAKING:
            e.update(handled=False, preset=False)
            if mode == "interval":
                e["slot"] = None
        if e["handled"]:
            continue
        if st in SENT:
            e.update(handled=True, action="schedule" if st == "planlandi" else "publish", preset=False)
            continue
        ready = st == "inceleme" and core.ready(p)
        if not ready:
            if mode == "slots" and e.get("slot") and not e.get("preset") and not p.get("after_render") and st in MAKING:
                preset_slot(c, e, p)
            continue
        ar = p.get("after_render")
        if ar:
            e.update(handled=True, action=ar.get("action"), preset=False)
            if ar.get("at"):
                e["slot"] = ar["at"]
            continue
        if e.get("preset"):
            e.update(handled=True, action="review", preset=False)
            core.log_activity("Otopilot planı elle kaldırılmış; video İncelemede bekliyor", post=p["id"], kind="info")
            continue
        ar, reason = None, None
        if mode == "immediate":
            ar = {"action": "publish"}
        elif mode == "slots":
            at = parse(e.get("slot"))
            if at and at >= now:
                ar = {"action": "schedule", "at": e["slot"]}
            elif at and now - at <= LATE:
                ar = {"action": "publish"}
            else:
                reason = f"planlanan saat geçti ({nice(at)})" if at else "paylaşım saati kalmadı"
        elif mode == "interval":
            if taken is None:
                taken = taken_slots(posts, c)
            found = free_slots(c["publish"]["interval"], 1, taken, now)
            if found:
                e["slot"] = fmt(found[0])
                taken.append(found[0])
                ar = {"action": "schedule", "at": e["slot"]}
            else:
                reason = "uygun paylaşım saati bulunamadı"
        if ar:
            ar.update(by=by(c), set=core.now())
            core.update_post(p["id"], lambda q, ar=ar: q.update(after_render=ar))
            p["after_render"] = ar
            e.update(handled=True, action=ar["action"])
        else:
            e.update(handled=True, action="review")
            core.log_activity(f"Otopilot: {reason}; video İncelemede bekliyor" if reason else "Otopilot: video İncelemede onayını bekliyor",
                              post=p["id"], kind="info")
    return pm


def finish(c, batches, pm, wait):
    entries = [e for e in c["posts"] if not e.get("gone") and e["post"] in pm]
    making = [e for e in entries if pm[e["post"]]["status"] in MAKING or
              (pm[e["post"]]["status"] == "inceleme" and not core.ready(pm[e["post"]]))]
    all_made = len(c["batches"]) == len(c["topics"]) and all(e["produced"] for e in c["batches"])
    if not all_made:
        if wait:
            return
        hazir = sum(1 for e in c["batches"] if e["produced"] or (batches.get(e["batch"]) or {}).get("status") == "hazir")
        stage = f"Fikirler yazılıyor: {hazir}/{len(c['topics'])} konu hazır" if hazir < len(c["topics"]) else "Videolar üretime gönderiliyor"
        if entries:
            stage += f" · {len(entries) - len(making)}/{len(entries)} video hazır"
        c["stage"] = stage
        return
    if making:
        c["stage"] = f"Videolar üretiliyor: {len(entries) - len(making)}/{len(entries)} hazır"
        return

    def closed(e):
        st = pm[e["post"]]["status"]
        return st in SENT or (e["handled"] and e.get("action") == "review" and st == "inceleme")
    auto = [e for e in entries if not closed(e) and pm[e["post"]]["status"] == "inceleme" and pm[e["post"]].get("after_render")]
    waiting = [e for e in entries if not closed(e) and e not in auto]
    if waiting:
        c["stage"] = f"{len(waiting)} video ilgini bekliyor (Planlama sekmesi)"
        return
    if auto:
        c["stage"] = f"{len(auto)} video otomatik planlanıyor ya da paylaşılıyor"
        return
    sts = [pm[e["post"]]["status"] for e in entries]
    parts = [f"{n} {t}" for n, t in ((sts.count("planlandi") + sts.count("paylasiliyor"), "planlandı"),
                                      (sts.count("paylasildi"), "paylaşıldı"), (sts.count("inceleme"), "İncelemede")) if n]
    c.update(status="bitti", stage="Tamamlandı" + (": " + ", ".join(parts) if parts else ""))
    log(c, c["stage"], "done")


def _step(c):
    if c["status"] == "calisiyor":
        ensure_batches(c)
    batches = {e["batch"]: ideas.load(e["batch"]) for e in c["batches"]}
    if c["status"] == "calisiyor":
        check_batches(c, batches)
    if c["status"] == "calisiyor":
        select(c, batches)
    wait = produce_selected(c, batches) if c["status"] == "calisiyor" else None
    if c["status"] == "calisiyor" or (c["status"] == "duraklatildi" and c.get("hold") == "credits"):
        pm = handle_posts(c)
        if c["status"] == "calisiyor":
            finish(c, batches, pm, wait)


def step(c):
    before = json.dumps(c, sort_keys=True, ensure_ascii=False)
    try:
        _step(c)
    finally:
        if json.dumps(c, sort_keys=True, ensure_ascii=False) != before:
            save(c)
    return c


def tick():
    with _lock:
        for c in list_campaigns():
            if c["status"] == "calisiyor" or (c["status"] == "duraklatildi" and c.get("hold") == "credits"):
                try:
                    step(c)
                except Exception:  # noqa: BLE001
                    traceback.print_exc()


# ---------- actions ----------

def create(d):
    spec, errors = normalize(d)
    if errors:
        raise ValueError(errors[0])
    prev = load(spec["repeat_of"]) if spec["repeat_of"] and re.fullmatch(r"A\d+", spec["repeat_of"]) else None
    spec.update(repeat_of=prev["id"] if prev else None, repeat_name=prev["name"] if prev else None)
    with _lock:
        with core.locked():
            root().mkdir(parents=True, exist_ok=True)
            ids = [int(f.stem[1:]) for f in root().glob("A*.json") if f.stem[1:].isdigit()]
            aid = f"A{core.next_id(ids):03d}"
            c = dict(spec, id=aid, created=core.now(), updated=core.now(), status="calisiyor", stage="Fikirler isteniyor",
                     hold=None, batches=[], posts=[])
            core.write_json(path(aid), c)
        total = sum(t["count"] for t in c["topics"])
        log(c, f"başladı ({total} video, {len(c['topics'])} konu)", "queue")
        return step(c)


def release(c):
    for e in c["posts"]:
        p = core.load_post(e["post"])
        if not p or p.get("deleted") or p["status"] in SENT:
            continue
        ar = p.get("after_render") or {}
        if str(ar.get("by") or "").startswith("Otopilot"):
            core.update_post(p["id"], lambda q: q.update(after_render=None))
            e.update(handled=False, preset=False)
            if c["publish"]["mode"] == "interval":
                e["slot"] = None


def pause(c):
    if c["status"] not in ACTIVE:
        raise ValueError("Bu otopilot duraklatılamaz")
    release(c)
    c.update(status="duraklatildi", hold="user", stage="Duraklatıldı")
    save(c)
    log(c, "duraklatıldı")
    return c


def resume(c):
    if c["status"] not in ("duraklatildi", "hata"):
        raise ValueError("Bu otopilot zaten çalışıyor ya da bitti")
    if c["status"] == "hata":
        keep = []
        for e in c["batches"]:
            b = ideas.load(e["batch"])
            bad = not e["produced"] and (not b or b.get("deleted") or b["status"] == "hata")
            if bad and any(x.get("batch") == e["batch"] for x in c["posts"]):
                e["produced"] = True
                bad = False
            if not bad:
                keep.append(e)
        c["batches"] = keep
    c.update(status="calisiyor", hold=None, stage="Devam ediyor")
    save(c)
    log(c, "devam ettirildi")
    return step(c)


def cancel(c):
    if c["status"] not in ACTIVE + ("hata",):
        raise ValueError("Bu otopilot zaten bitti")
    release(c)
    def drop(b):
        if b["status"] == "sirada":
            b["deleted"] = True
    for e in c["batches"]:
        b = ideas.load(e["batch"])
        if not e["produced"] and b and not b.get("deleted") and b["status"] == "sirada":
            ideas.update(e["batch"], drop)
    c.update(status="iptal", hold=None, stage="İptal edildi")
    save(c)
    log(c, "iptal edildi")
    return c


def delete(c):
    if c["status"] in ACTIVE + ("hata",):
        cancel(c)
    c["deleted"] = True
    save(c)
    return c


def approve(c, ids, templates=None):
    if c["status"] != "onay_bekliyor":
        raise ValueError("Bu otopilot fikir onayı beklemiyor")
    want = {str(x) for x in ids or []}
    chosen = {str(k): str(v or "").strip() for k, v in (templates or {}).items() if str(v or "").strip()}
    known = template_ids() if chosen else set()
    bad = sorted({v for v in chosen.values() if v not in known})
    if bad:
        raise ValueError(f"Bilinmeyen video stili: {bad[0]}")
    found = 0
    for e in c["batches"]:
        if e["produced"] or "selected" in e:
            continue
        b = ideas.load(e["batch"])
        if not b or b.get("deleted"):
            e.update(selected=[], produced=True)
            continue
        if want:
            e["selected"] = [i["id"] for i in b["ideas"] if i["id"] in want and i["status"] != "uretimde"]
        else:
            e["selected"] = auto_pick(b, e["count"])
        e["templates"] = {k: v for k, v in chosen.items() if k in e["selected"]}
        found += len(e["selected"])
    if want and not found:
        raise ValueError("Seçilen fikirler bulunamadı")
    if found + sum(1 for e in c["posts"] if not e.get("gone")) > MAX_VIDEOS:
        raise ValueError(f"En fazla {MAX_VIDEOS} video seçilebilir")
    c.update(status="calisiyor", hold=None, stage="Fikirler onaylandı")
    save(c)
    log(c, f"fikirler onaylandı, {found} video üretime gidiyor", "queue")
    return step(c)


def action(aid, name, d=None):
    with _lock:
        c = must(aid)
        if name == "pause":
            return pause(c)
        if name == "resume":
            return resume(c)
        if name == "cancel":
            return cancel(c)
        if name == "delete":
            return delete(c)
        if name == "approve":
            return approve(c, (d or {}).get("ideas"), (d or {}).get("templates"))
        if name == "targets":
            return set_targets(c, d or {})
        raise ValueError("bilinmeyen işlem")


def set_targets(c, raw):
    t = core.norm_targets({k: raw.get(k) for k in core.PLATFORMS})
    c["targets"] = t
    save(c)
    log(c, f"paylaşım yerleri: {core.targets_text(t)}")
    for e in c["posts"]:
        p = core.load_post(e["post"])
        if not p or p.get("deleted") or p["status"] in ("paylasiliyor", "paylasildi"):
            continue
        try:
            core.change_targets(p["id"], t)
        except (ValueError, KeyError):
            pass
    return c


def duplicate(aid):
    c = must(aid)
    known = template_ids()
    today = dt.date.today()
    now = dt.datetime.now()
    brief = json.loads(json.dumps(c["brief"]))
    brief.setdefault("template_mode", "single" if brief.get("template") else "agent")
    brief.setdefault("templates", [])
    if brief.get("template") and brief["template"] not in known:
        brief["template"] = ""
    brief["templates"] = [t for t in brief["templates"] if t in known]
    pub = json.loads(json.dumps(c["publish"]))
    pub["slots"] = [s for s in pub.get("slots") or [] if (parse(s) or now) > now]
    iv = pub.get("interval") or {}
    try:
        if dt.date.fromisoformat(str(iv.get("start"))[:10]) < today:
            iv["start"] = today.isoformat()
    except ValueError:
        iv["start"] = today.isoformat()
    pub["interval"] = iv
    name = c["name"] if c["name"].endswith(" (tekrar)") else f"{c['name']} (tekrar)"
    topics = [{"topic": t["topic"], "count": t["count"], "template": t.get("template") if t.get("template") in known else ""}
              for t in c["topics"]]
    return {"name": name, "topics": topics, "brief": brief, "review_ideas": c["review_ideas"], "publish": pub, "repeat_of": c["id"],
            "targets": c.get("targets")}


# ---------- views ----------

def planned(c):
    done = {e["idea"] for e in c["posts"]}
    n = sum(1 for e in c["posts"] if not e.get("gone"))
    if c["status"] == "iptal":
        return n
    for i, t in enumerate(c["topics"]):
        e = entry_for(c, i)
        if e is None or ("selected" not in e and not e["produced"]):
            n += t["count"]
        elif not e["produced"]:
            n += sum(1 for x in e["selected"] if x not in done)
    return n


def progress(c, pm, bm):
    out = {"videos": planned(c), "ideas_ready": 0, "ideas_requested": 0, "producing": 0, "ready": 0, "scheduled": 0,
           "published": 0, "failed": 0}
    for e in c["batches"]:
        b = bm.get(e["batch"]) or ideas.load(e["batch"])
        if b:
            out["ideas_ready"] += len(b["ideas"])
            out["ideas_requested"] += b.get("requested") or 0
    for e in c["posts"]:
        p = pm.get(e["post"])
        if not p or e.get("gone"):
            continue
        st = p["status"]
        if st in MAKING or (st == "inceleme" and not core.ready(p)):
            out["producing"] += 1
        elif st == "inceleme":
            out["ready"] += 1
        elif st in ("planlandi", "paylasiliyor"):
            out["scheduled"] += 1
        elif st == "paylasildi":
            out["published"] += 1
        elif st == "hata":
            out["failed"] += 1
    return out


def next_up(c, pm):
    best = None
    for e in c["posts"]:
        p = pm.get(e["post"])
        if not p:
            continue
        ar = p.get("after_render") or {}
        at = p.get("schedule") if p["status"] == "planlandi" else (ar.get("at") if ar.get("action") == "schedule" else None)
        if at and (best is None or at[:16] < best["at"]):
            best = {"post": p["id"], "title": p["title"], "at": at[:16]}
    return best


def summary(c, pm, bm):
    out = dict(c, progress=progress(c, pm, bm), next=next_up(c, pm))
    out.setdefault("repeat_of", None)
    out.setdefault("repeat_name", None)
    return out


def summaries(posts=None, batches=None):
    cs = list_campaigns()
    if not cs:
        return []
    pm = {p["id"]: p for p in (posts if posts is not None else core.list_posts())}
    bm = {b["id"]: b for b in (batches if batches is not None else ideas.list_batches())}
    return [summary(c, pm, bm) for c in cs]


def compact_idea(i):
    out = {k: i.get(k) for k in ("id", "title", "hook", "angle", "lines", "duration", "status", "post")}
    out["chars"] = chars(i)
    return out


def detail(c):
    posts = core.list_posts()
    pm = {p["id"]: p for p in posts}
    out = summary(c, pm, {})
    out["post_list"] = [dict(core.summary(pm[e["post"]]), slot=e.get("slot"), idea=e.get("idea"), topic=e.get("topic"),
                             handled=e.get("handled"), action=e.get("action"), template=e.get("template"),
                             template_from=e.get("template_from"))
                        for e in c["posts"] if e["post"] in pm and not e.get("gone")]
    batch_list = []
    for e in c["batches"]:
        b = ideas.load(e["batch"])
        if not b:
            continue
        s = ideas.summary(b)
        s.update(count=e["count"], selected=e.get("selected"), produced=e["produced"], deleted=bool(b.get("deleted")),
                 ideas=[compact_idea(i) for i in b["ideas"]])
        batch_list.append(s)
    out["batch_list"] = batch_list
    out["upcoming"] = upcoming(c, posts)
    out["activity"] = core.read_activity(40, post=c["id"])
    return out


def preview(d):
    spec, errors = normalize(d)
    n = sum(t["count"] for t in spec["topics"])
    pub = spec["publish"]
    posts = core.list_posts()
    now = dt.datetime.now()
    warnings = list(errors)
    if pub["mode"] == "slots":
        fut = [s for s in pub["slots"] if parse(s) > now]
        slots = fut[:n] + [None] * max(0, n - len(fut))
        if fut and n > len(fut):
            warnings.append(f"{n - len(fut)} video için paylaşım saati yok; bu videolar İncelemede bekleyecek")
    elif pub["mode"] == "interval" and pub["interval"]["days"] and (pub["interval"]["times"] or pub["interval"]["every_hours"]):
        found = free_slots(pub["interval"], n, taken_slots(posts), now)
        slots = [fmt(t) for t in found] + [None] * (n - len(found))
        if len(found) < n:
            warnings.append(f"Seçilen gün ve saatlerde yalnızca {len(found)} boş paylaşım saati bulundu")
    else:
        slots = [None] * n
    chars_est = n * spec["brief"]["duration"] * CHARS_PER_SEC
    cr, err, reserved = credit_info(posts)
    if cr is None:
        warnings.append("ElevenLabs kredisi okunamadı" + (f": {err}" if err else ""))
    else:
        avail = (cr["left"] or 0) - reserved
        if chars_est > avail:
            warnings.append(f"Tahmini {chars_est} karakter gerekiyor, ElevenLabs'te kullanılabilir {max(0, avail)} karakter var"
                            + (f" ({reserved} karakter sıradaki videolara ayrıldı)" if reserved else "")
                            + "; kredi yetmezse üretim duraklar")
    st = core.settings()
    if not (st.get("narrator") or {}).get("voice_id"):
        warnings.append("Anlatıcı sesi seçilmemiş (Ayarlar > ElevenLabs)")
    ig = st.get("instagram") or {}
    tg = spec.get("targets") or core.default_targets()
    if pub["mode"] != "review" and tg.get("instagram") and not (ig.get("token") and ig.get("user_id")):
        warnings.append("Instagram bağlı değil; videolar hazır olunca otomatik paylaşılamaz (Ayarlar > Instagram)")
    if (spec.get("targets") or {}).get("youtube") and core.youtube_block("reels"):
        warnings.append("YouTube bağlı değil; videolar YouTube'a yüklenmez (Ayarlar > YouTube)")
    return {"slots": slots, "templates_plan": plan_templates(spec["topics"], spec["brief"]), "chars_est": chars_est, "credits": cr,
            "warnings": warnings, "errors": errors, "videos": n, "reserved_chars": reserved, "publish": pub}
