import re
import shutil
from pathlib import Path

import core

QUESTIONS = [
    ("purpose", "Hangi içerikler için?"),
    ("mood", "Nasıl bir hava?"),
    ("background", "Zemin"),
    ("typography", "Yazı stili"),
    ("motion", "Hareket"),
    ("elements", "Ekranda neler olsun?"),
    ("colors", "Renkler"),
]
STATUS = {"sirada": "Sırada", "yapiliyor": "Hazırlanıyor", "hazir": "Hazır", "hata": "Hata"}


def root():
    return core.DATA / "sablon_istekleri"


def custom_root():
    return core.HOME / "sablonlar"


def path(rid):
    return root() / rid / "request.json"


def load(rid):
    return core.read_json(path(rid))


def save(r):
    r["updated"] = core.now()
    core.write_json(path(r["id"]), r)


def update(rid, fn):
    with core.locked():
        r = load(rid)
        if r is None:
            raise KeyError(rid)
        fn(r)
        save(r)
        return r


def list_requests():
    out = []
    if root().exists():
        for d in root().iterdir():
            r = core.read_json(d / "request.json")
            if r and not r.get("deleted"):
                out.append(r)
    out.sort(key=lambda r: r["created"], reverse=True)
    return out


def summary(r):
    out = {k: r.get(k) for k in ("id", "name", "status", "stage", "progress", "agent", "template", "error", "created", "updated")}
    out["refs"] = len(r.get("refs") or [])
    return out


def slug(name):
    s = name.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:24] or "sablon"


def new_request(name, answers=None, description="", uploads=None, links=None, similarity=""):
    name = (name or "").strip() or "Benim şablonum"
    answers = {k: v for k, v in (answers or {}).items() if k in dict(QUESTIONS) and v not in (None, "", [])}
    links = [x.strip() for x in (links or []) if x and x.strip()][:10]
    if not answers and not description.strip() and not uploads and not links:
        raise ValueError("soruları yanıtla, ne istediğini anlat ya da bir referans ekle")
    with core.locked():
        root().mkdir(parents=True, exist_ok=True)
        ids = [int(d.name[1:]) for d in root().glob("S*") if d.name[1:].isdigit()]
        rid = f"S{core.next_id(ids):03d}"
        d = root() / rid
        (d / "refs").mkdir(parents=True, exist_ok=True)
        refs = []
        for i, u in enumerate(uploads or [], 1):
            src = core.UPLOADS / Path(u.get("id", "")).name
            if not src.exists():
                continue
            dest = d / "refs" / f"{i:02d}{src.suffix.lower()}"
            shutil.move(str(src), dest)
            refs.append({"file": dest.name, "name": u.get("name") or src.name, "note": (u.get("note") or "").strip()})
        base = slug(name)
        tid = base
        n = 2
        taken = {p.name for p in custom_root().iterdir()} if custom_root().exists() else set()
        import produce
        taken |= {t["id"] for t in produce.list_templates()}
        while tid in taken:
            tid = f"{base}-{n}"
            n += 1
        r = {"id": rid, "name": name, "answers": answers, "description": description.strip(), "refs": refs, "links": links,
             "similarity": similarity, "template": tid, "status": "sirada", "stage": "Ajan bekleniyor", "progress": 0,
             "agent": None, "error": None, "messages": [], "created": core.now()}
        save(r)
    core.log_activity(f"Şablon isteği sıraya girdi: {name}", post=rid, kind="queue")
    return r


def add_note(rid, text):
    text = (text or "").strip()
    if not text:
        raise ValueError("not boş")

    def fn(r):
        r["messages"].append({"author": "user", "text": text, "at": core.now()})
        r.update(status="sirada", stage="Düzeltme sırada", progress=0, error=None)
    r = update(rid, fn)
    core.log_activity("Şablon için düzeltme istendi", post=rid, kind="queue")
    return r


def by_template(tid):
    for r in list_requests():
        if r.get("template") == tid:
            return r
    return None


def delete_template(tid):
    d = custom_root() / tid
    if not d.exists() or not (d / "meta.json").exists():
        raise ValueError("sadece kendi oluşturduğun şablonlar silinebilir")
    shutil.rmtree(d)
    r = by_template(tid)
    if r:
        update(r["id"], lambda q: q.update(deleted=True))
