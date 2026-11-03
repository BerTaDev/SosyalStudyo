import re

import core

BRIEF_KEYS = ("tone", "audience", "format", "duration", "notes", "style", "template")


def root():
    return core.DATA / "ideas"


def path(bid):
    return root() / bid / "batch.json"


def load(bid):
    return core.read_json(path(bid))


def save(b):
    b["updated"] = core.now()
    core.write_json(path(b["id"]), b)


def update(bid, fn):
    with core.locked():
        b = load(bid)
        if b is None:
            raise KeyError(bid)
        fn(b)
        save(b)
        return b


def list_batches():
    out = []
    if root().exists():
        for d in root().iterdir():
            b = core.read_json(d / "batch.json")
            if b and not b.get("deleted"):
                out.append(b)
    out.sort(key=lambda b: b["created"], reverse=True)
    return out


def counts(b):
    st = [i["status"] for i in b["ideas"]]
    return {"total": len(st), "selected": st.count("secildi"), "rejected": st.count("elendi"),
            "produced": st.count("uretimde"), "new": st.count("yeni")}


def summary(b):
    out = {k: b.get(k) for k in ("id", "topic", "status", "stage", "agent", "requested", "created", "updated", "brief")}
    out["counts"] = counts(b)
    return out


def new_batch(topic, count, brief=None):
    brief = {k: v for k, v in (brief or {}).items() if k in BRIEF_KEYS and v not in (None, "", [])}
    with core.locked():
        root().mkdir(parents=True, exist_ok=True)
        ids = [int(d.name[1:]) for d in root().glob("F*") if d.name[1:].isdigit()]
        bid = f"F{core.next_id(ids):03d}"
        b = {"id": bid, "topic": topic.strip(), "requested": int(count), "brief": brief, "status": "sirada",
             "stage": "Ajan bekleniyor", "agent": None, "ideas": [], "created": core.now(), "updated": core.now()}
        (root() / bid).mkdir(parents=True, exist_ok=True)
        save(b)
    core.log_activity(f"Fikir isteği sıraya girdi: {b['topic']} ({count} fikir)", post=bid, kind="queue")
    return b


def request_more(bid, count):
    def fn(b):
        b["requested"] = len(b["ideas"]) + int(count)
        b["status"] = "sirada"
        b["stage"] = f"{count} fikir daha isteniyor"
    b = update(bid, fn)
    core.log_activity(f"{count} fikir daha istendi: {b['topic']}", post=bid, kind="queue")
    return b


def clean_idea(raw):
    lines = [str(x).strip() for x in raw.get("lines") or [] if str(x).strip()]
    if not raw.get("title") or not lines:
        raise ValueError("her fikirde 'title' ve boş olmayan 'lines' olmalı")
    scenes = []
    for s in raw.get("scenes") or []:
        if isinstance(s, dict):
            scenes.append({"visual": str(s.get("visual", "")).strip(), "text": str(s.get("text", "")).strip()})
    tags = raw.get("hashtags") or ""
    if isinstance(tags, list):
        tags = " ".join(t if t.startswith("#") else f"#{t}" for t in tags)
    return {"title": str(raw["title"]).strip(), "hook": str(raw.get("hook", "")).strip(), "angle": str(raw.get("angle", "")).strip(),
            "duration": int(raw.get("duration") or 30), "lines": lines, "scenes": scenes,
            "caption": str(raw.get("caption", "")).strip(), "hashtags": str(tags).strip(), "why": str(raw.get("why", "")).strip()}


def save_ideas(bid, items, agent=None):
    cleaned = [clean_idea(x) for x in items]

    def fn(b):
        start = len(b["ideas"])
        for k, idea in enumerate(cleaned, start + 1):
            idea.update(id=f"{bid}-{k:02d}", status="yeni", post=None, edited=False, created=core.now())
            b["ideas"].append(idea)
        if len(b["ideas"]) >= b["requested"]:
            b["status"] = "hazir"
            b["stage"] = f"{len(b['ideas'])} fikir hazır"
        else:
            b["stage"] = f"{len(b['ideas'])}/{b['requested']} fikir yazıldı"
        if agent:
            b["agent"] = agent
    b = update(bid, fn)
    core.log_activity(f"{len(cleaned)} metin kurgusu yazıldı: {b['topic']}", post=bid, agent=agent,
                      kind="done" if b["status"] == "hazir" else "step")
    return b


def edit_item(bid, iid, patch):
    allowed = {"status", "title", "hook", "lines", "caption", "hashtags", "template"}

    def fn(b):
        for i in b["ideas"]:
            if i["id"] == iid:
                if i["status"] == "uretimde" and patch.get("status") not in (None, "uretimde"):
                    raise ValueError("bu fikir zaten üretimde")
                for k, v in patch.items():
                    if k not in allowed:
                        continue
                    if k == "lines":
                        v = [x.strip() for x in (v if isinstance(v, list) else str(v).split("\n")) if x.strip()]
                        if not v:
                            raise ValueError("seslendirme metni boş olamaz")
                    if k == "status" and v not in ("yeni", "secildi", "elendi"):
                        raise ValueError("geçersiz durum")
                    if k == "template":
                        v = str(v or "").strip()
                        if v and not re.fullmatch(r"[\w\-]{1,40}", v):
                            raise ValueError("geçersiz şablon")
                    i[k] = v
                if set(patch) & {"title", "hook", "lines", "caption", "hashtags"}:
                    i["edited"] = True
                return
        raise KeyError(iid)
    return update(bid, fn)


def produce(bid, iids, templates=None, targets=None, item_targets=None):
    b = load(bid)
    if b is None:
        raise KeyError(bid)
    brief = b.get("brief") or {}
    made = []
    for idea in b["ideas"]:
        if idea["id"] not in iids or idea["status"] == "uretimde":
            continue
        concept = "\n".join(x for x in (idea["angle"], f"Kanca: {idea['hook']}" if idea["hook"] else "",
                                        f"Fikir seti {bid}: {b['topic']}") if x)
        tpl = (templates or {}).get(idea["id"]) or idea.get("template") or brief.get("template")
        post_brief = {"format": brief.get("format") or "9:16", "tone": brief.get("tone"), "style": brief.get("style"),
                      "audience": brief.get("audience"), "voiceover": True, "subtitles": True, "template": tpl}
        extra = {"script": {"hook": idea["hook"], "lines": idea["lines"], "scenes": idea["scenes"], "idea": idea["id"]},
                 "caption": idea.get("caption") or ""}
        if idea.get("hashtags"):
            extra["hashtags"] = idea["hashtags"]
        extra.update(core.targets_patch((item_targets or {}).get(idea["id"]) or targets))
        post = core.new_post(idea["title"], concept, idea.get("duration") or brief.get("duration") or 30, post_brief, extra=extra)
        made.append((idea["id"], post["id"]))

    def mark(b):
        for iid, pid in made:
            for i in b["ideas"]:
                if i["id"] == iid:
                    i["status"] = "uretimde"
                    i["post"] = pid
    if made:
        update(bid, mark)
        core.log_activity(f"{len(made)} kurgu üretime gönderildi: {b['topic']}", post=bid, kind="queue")
    return [pid for _, pid in made]
