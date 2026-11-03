import base64
import html as htmllib
import re
import secrets
import shutil
import struct
import unicodedata
import urllib.parse

import core

KINDS = ("png", "html", "text")
FILE_RE = re.compile(r"R\d{4,}(?:_t)?\.(?:png|jpg|html|txt)")
POST_FILE_RE = re.compile(r"/media/(\d+)/arastirma/([\w.\-]+)")
THUMB_W = 360
THUMB_MAX_H = 540
TR = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")


def root():
    return core.DATA / "arastirma"


def files_dir():
    return root() / "files"


def _index():
    return root() / "items.json"


def _load():
    db = core.read_json(_index(), None) or {}
    db.setdefault("next", 1)
    db.setdefault("items", [])
    return db


def _excerpt(text, n=280):
    t = re.sub(r"\s+", " ", text or "").strip()
    return t if len(t) <= n else t[:n].rstrip() + "…"


def _html_text(src):
    src = re.sub(r"(?is)<(script|style|noscript|template)\b.*?</\1>", " ", src)
    src = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h\d|tr|section|article)>", "\n", src)
    return htmllib.unescape(re.sub(r"<[^>]+>", " ", src))


def _png_size(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    return None, None


def _thumb(src, dest):
    try:
        from PIL import Image
    except ImportError:
        return False
    try:
        with Image.open(src) as im:
            w, h = im.size
            crop_h = min(h, max(1, round(w * THUMB_MAX_H / THUMB_W)))
            im = im.crop((0, 0, w, crop_h))
            if im.mode in ("RGBA", "LA", "P"):
                im = im.convert("RGBA")
                bg = Image.new("RGB", im.size, (255, 255, 255))
                bg.paste(im, mask=im.split()[-1])
                im = bg
            else:
                im = im.convert("RGB")
            im.thumbnail((THUMB_W, THUMB_MAX_H))
            im.save(dest, "JPEG", quality=82, optimize=True)
        return True
    except Exception:  # noqa: BLE001
        dest.unlink(missing_ok=True)
        return False


def slug(text, n=40):
    t = unicodedata.normalize("NFKD", (text or "").translate(TR)).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "_", t).strip("_")[:n].strip("_").lower()


def _bytes(data):
    if isinstance(data, str):
        return base64.b64decode(data.split(",", 1)[-1])
    return bytes(data or b"")


def _text(data):
    return data.decode("utf-8", "replace") if isinstance(data, (bytes, bytearray)) else str(data or "")


def add(kind, title, url, data, text=None, note="", job=None):
    if kind not in KINDS:
        raise ValueError("bilinmeyen araştırma türü")
    if kind == "text" and not _text(data).strip():
        raise ValueError("metin boş")
    with core.locked():
        db = _load()
        n = int(db["next"])
        db["next"] = n + 1
        core.write_json(_index(), db)
    rid = f"R{n:04d}"
    fd = files_dir()
    fd.mkdir(parents=True, exist_ok=True)
    item = {"id": rid, "kind": kind, "title": (title or "").strip()[:300], "url": (url or "").strip(), "file": None,
            "text_file": None, "thumb": None, "size": 0, "excerpt": "", "note": (note or "").strip(), "job": job or None, "created": core.now()}
    if kind == "png":
        raw = _bytes(data)
        f = fd / f"{rid}.png"
        f.write_bytes(raw)
        w, h = _png_size(raw)
        item.update(file=f.name, size=len(raw), w=w, h=h)
        if _thumb(f, fd / f"{rid}_t.jpg"):
            item["thumb"] = f"/research/{rid}_t.jpg"
    elif kind == "html":
        src = _text(data)
        f = fd / f"{rid}.html"
        f.write_text(src, encoding="utf-8")
        item.update(file=f.name, size=f.stat().st_size)
        if text is None:
            text = _html_text(src)
    else:
        text = _text(data)
    if text is not None and str(text).strip():
        t = fd / f"{rid}.txt"
        t.write_text(str(text), encoding="utf-8")
        item["text_file"] = t.name
        item["excerpt"] = _excerpt(text)
        if kind == "text":
            item.update(file=t.name, size=t.stat().st_size)
            if not item["title"]:
                item["title"] = _excerpt(str(text).strip().split("\n")[0], 80)
    if not item["title"]:
        item["title"] = item["url"] or rid
    with core.locked():
        db = _load()
        db["items"].append(item)
        core.write_json(_index(), db)
    return item


def list_items():
    return sorted(_load()["items"], key=lambda it: (it.get("created") or "", it["id"]), reverse=True)


def get(rid):
    return next((it for it in _load()["items"] if it["id"] == rid), None)


def update(rid, note=None, title=None):
    with core.locked():
        db = _load()
        it = next((x for x in db["items"] if x["id"] == rid), None)
        if it is None:
            raise KeyError(rid)
        if note is not None:
            it["note"] = str(note).strip()
        if title is not None and str(title).strip():
            it["title"] = str(title).strip()[:300]
        core.write_json(_index(), db)
    return it


def _item_files(it):
    names = [it.get("file"), it.get("text_file")]
    if it.get("thumb"):
        names.append(it["thumb"].rsplit("/", 1)[-1])
    return [x for x in dict.fromkeys(names) if x]


def delete(ids):
    ids = {str(x) for x in ids or []}
    with core.locked():
        db = _load()
        gone = [it for it in db["items"] if it["id"] in ids]
        db["items"] = [it for it in db["items"] if it["id"] not in ids]
        core.write_json(_index(), db)
    for it in gone:
        for name in _item_files(it):
            (files_dir() / name).unlink(missing_ok=True)
    return [it["id"] for it in gone]


def send(ids):
    by = {it["id"]: it for it in _load()["items"]}
    refs, research = [], []
    for rid in dict.fromkeys(str(x) for x in ids or []):
        it = by.get(rid)
        if not it:
            continue
        if it["kind"] == "png":
            src = files_dir() / it["file"]
            if not src.exists():
                continue
            core.UPLOADS.mkdir(parents=True, exist_ok=True)
            name = f"{secrets.token_hex(8)}.png"
            shutil.copyfile(src, core.UPLOADS / name)
            refs.append({"id": name, "name": f"{slug(it['title']) or rid}.png", "url": f"/uploads/{name}",
                         "note": it.get("note") or it.get("title") or "", "use": False, "rid": rid})
        else:
            research.append({k: it.get(k) for k in ("id", "kind", "title", "url", "excerpt", "note")})
    return {"refs": refs, "research": research}


def attach(pid, ids):
    if not isinstance(ids, list):
        return []
    by = {it["id"]: it for it in _load()["items"]}
    dest = core.post_dir(pid) / "arastirma"
    out = []
    for rid in dict.fromkeys(str(x) for x in ids):
        it = by.get(rid)
        if not it:
            continue
        base = f"{rid}_{slug(it.get('title')) or it['kind']}"
        names = [it.get("text_file"), it.get("file")] if it["kind"] == "html" else [it.get("file"), it.get("text_file")]
        files = []
        for name in dict.fromkeys(x for x in names if x):
            src = files_dir() / name
            if not src.exists():
                continue
            dest.mkdir(parents=True, exist_ok=True)
            target = dest / f"{base}{src.suffix}"
            shutil.copyfile(src, target)
            files.append(target.name)
        if files:
            out.append({"id": rid, "kind": it["kind"], "title": it.get("title") or "", "url": it.get("url") or "", "files": files,
                        "note": it.get("note") or "", "excerpt": it.get("excerpt") or ""})
    return out


def _send_bytes(h, body, ctype, extra=()):
    h.send_response(200)
    h.send_header("Content-Type", ctype)
    h.send_header("Content-Length", str(len(body)))
    h.send_header("Cache-Control", "no-store")
    for k, v in extra:
        h.send_header(k, v)
    h.end_headers()
    h.wfile.write(body)


def _serve(h, path):
    if not path.is_file():
        return h.fail("dosya yok", 404)
    ext = path.suffix.lower()
    if ext == ".txt":
        return _send_bytes(h, path.read_bytes(), "text/plain; charset=utf-8")
    if ext == ".html":
        return _send_bytes(h, path.read_bytes(), "text/html; charset=utf-8",
                           [("Content-Security-Policy", "sandbox"), ("X-Content-Type-Options", "nosniff")])
    return h.send_file(path)


def handle_get(h, path):
    if path == "/api/research":
        job = (urllib.parse.parse_qs(urllib.parse.urlparse(h.path).query).get("job") or [""])[0]
        items = list_items()
        h.send_json({"items": [it for it in items if it.get("job") == job] if job else items})
        return True
    if path.startswith("/research/"):
        name = path[10:]
        if FILE_RE.fullmatch(name):
            _serve(h, files_dir() / name)
        else:
            h.fail("yok", 404)
        return True
    m = POST_FILE_RE.fullmatch(path)
    if m:
        _serve(h, core.post_dir(m.group(1)) / "arastirma" / m.group(2))
        return True
    return False


def handle_post(h, path):
    d = h.json_body()
    if path == "/api/research/note":
        text = (d.get("text") or "").strip()
        if not text:
            return h.fail("not boş")
        return h.send_json(add("text", d.get("title") or "", d.get("url") or "", text))
    if path == "/api/research/add":
        kind = d.get("kind")
        data = d.get("data") or ""
        if kind == "png":
            import base64
            data = base64.b64decode(data.split(",", 1)[-1])
        job = d.get("job") if re.fullmatch(r"G\d+", str(d.get("job") or "")) else None
        try:
            item = add(kind, d.get("title") or "", d.get("url") or "", data, text=d.get("text"), note=d.get("note") or "", job=job)
        except ValueError as e:
            return h.fail(str(e))
        if job:
            import webagent
            webagent.link_item(job, item["id"])
        return h.send_json(item)
    if path == "/api/research/delete":
        return h.send_json({"deleted": delete(d.get("ids")), "items": list_items()})
    if path == "/api/research/send":
        ids = d.get("ids") or []
        if not ids:
            return h.fail("seçili öğe yok")
        return h.send_json(send(ids))
    m = re.fullmatch(r"/api/research/(R\d+)/update", path)
    if m:
        return h.send_json(update(m.group(1), note=d.get("note"), title=d.get("title")))
    return h.fail("yok", 404)
