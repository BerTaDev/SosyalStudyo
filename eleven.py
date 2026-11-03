import base64
import datetime as dt
import json
import os
import time
import urllib.error
import urllib.request

import core

API = os.environ.get("ELEVENLABS_API_BASE") or "https://api.elevenlabs.io"
SWITCH_CODES = (401, 402, 403, 404)
_pinned = None
_spent = {}
_removed = []
last_account = None


class ElevenError(Exception):
    def __init__(self, msg, code=None, status=""):
        super().__init__(msg)
        self.code = code
        self.status = status


def accounts(include_disabled=False):
    el = core.settings().get("elevenlabs", {})
    out = [a for a in el.get("accounts") or [] if a.get("key") and (include_disabled or a.get("enabled", True))]
    if not el.get("accounts") and el.get("key"):
        out.append({"id": "main", "name": "Ana hesap", "key": el["key"], "enabled": True})
    env = os.environ.get("ELEVENLABS_API_KEY")
    if env and not any(a["key"] == env for a in out):
        out.append({"id": "env", "name": "Ortam değişkeni", "key": env, "enabled": True})
    return out


def strategy():
    return core.settings().get("elevenlabs", {}).get("strategy") or "most"


def key():
    acc = accounts()
    return acc[0]["key"] if acc else None


def explain(code, body):
    try:
        d = json.loads(body).get("detail", {})
        status, msg = (d.get("status", ""), d.get("message", "")) if isinstance(d, dict) else ("", str(d))
    except json.JSONDecodeError:
        status, msg = "", body[:300]
    if status == "api_key_id_used_as_api_key":
        text = ("Bu, anahtarın kimliği (ID); asıl anahtar değil. Asıl anahtar sk_ ile başlar ve yalnızca oluşturulduğu an bir kez "
                "gösterilir. ElevenLabs › Developers › API Keys'te yeni bir anahtar oluştur ve çıkan sk_ ile başlayan değeri kopyala.")
    elif status == "quota_exceeded" or code == 402:
        text = "ElevenLabs kredisi bitti: " + msg
    elif status == "missing_permissions":
        text = "ElevenLabs anahtarında izin eksik (Text to Speech, Voices okuma, User okuma gerekli): " + msg
    elif code == 401:
        text = "ElevenLabs anahtarı geçersiz: " + (msg or status)
    else:
        text = f"ElevenLabs hatası {code}: {status} {msg}".strip()
    return ElevenError(text, code, status)


def call(path, body=None, timeout=180, acc=None):
    if acc is None:
        found = accounts()
        if not found:
            raise ElevenError("ElevenLabs anahtarı girilmemiş (Ayarlar > Seslendirme)")
        acc = found[0]
    data = json.dumps(body).encode("utf-8") if body is not None else None
    for attempt in range(6):
        req = urllib.request.Request(API + path, data=data, method="POST" if data else "GET",
                                     headers={"xi-api-key": acc["key"], "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            if (e.code == 429 or e.code >= 500) and attempt < 5:
                time.sleep(min(60, 5 * 2 ** attempt))
                continue
            raise explain(e.code, text) from None
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise ElevenError(f"ElevenLabs'e bağlanılamadı: {e.reason}") from None


def voices(acc=None):
    out = []
    for v in call("/v1/voices", acc=acc).get("voices", []):
        lb = v.get("labels") or {}
        gender = {"male": "erkek", "female": "kadın"}.get((lb.get("gender") or "").lower(), "")
        info = ", ".join(x for x in (lb.get("accent"), lb.get("description"), lb.get("age")) if x)
        out.append({"id": v["voice_id"], "name": v.get("name", "?"), "info": info, "gender": gender,
                    "preview": v.get("preview_url"), "category": v.get("category")})
    return out


def credits(acc=None):
    d = call("/v1/user/subscription", acc=acc)
    c = {"used": d.get("character_count"), "limit": d.get("character_limit"), "plan": d.get("tier"),
         "reset": d.get("next_character_count_reset_unix")}
    c["left"] = (c["limit"] or 0) - (c["used"] or 0)
    if c.get("reset"):
        c["reset_date"] = dt.datetime.fromtimestamp(c["reset"]).strftime("%d.%m.%Y")
    return c


def all_credits():
    out = []
    for a in accounts(include_disabled=True):
        row = {"id": a["id"], "name": a.get("name") or a["id"], "enabled": a.get("enabled", True)}
        if row["enabled"]:
            try:
                row.update(credits(a))
            except ElevenError as e:
                row["error"] = str(e)
        out.append(row)
    return out


def view(fresh=False):
    cr = core.eleven_credits(fresh=fresh)
    rows = {r["id"]: r for r in cr.get("accounts") or []}
    out = []
    for a in accounts(include_disabled=True):
        r = rows.get(a["id"], {})
        out.append({"id": a["id"], "name": a.get("name") or a["id"], "enabled": a.get("enabled", True), "hint": "…" + a["key"][-4:],
                    "added": a.get("added"), **{k: r.get(k) for k in ("left", "used", "limit", "plan", "reset_date", "error")}})
    total = {k: cr.get(k) for k in ("left", "used", "limit", "plan", "reset_date", "error")}
    return {"strategy": strategy(), "accounts": out, "total": total, "pinned": _pinned}


def add_account(key_, name=""):
    key_ = (key_ or "").strip()
    if len(key_) < 20 or " " in key_:
        raise ValueError("Bu bir ElevenLabs API anahtarına benzemiyor")
    if any(a["key"] == key_ for a in accounts(include_disabled=True)):
        raise ValueError("Bu anahtar zaten ekli")
    try:
        c = credits({"id": "new", "key": key_})
    except ElevenError as e:
        raise ValueError(str(e)) from None

    def fn(accs, el):
        n = len(accs) + 1
        accs.append({"id": "a" + os.urandom(3).hex(), "name": (name or "").strip()[:40] or f"Hesap {n}", "key": key_,
                     "enabled": True, "added": core.now(), "plan": c.get("plan")})
        return accs
    core.eleven_save_accounts(fn)
    return view(fresh=True)


def update_account(aid, action, value=None):
    def fn(accs, el):
        idx = next((i for i, a in enumerate(accs) if a["id"] == aid or (aid == "main" and i == 0)), None)
        if idx is None:
            raise KeyError(aid)
        if action == "delete":
            _removed.append(accs.pop(idx))
            del _removed[:-5]
        elif action == "enable":
            accs[idx]["enabled"] = bool(value)
        elif action == "rename":
            accs[idx]["name"] = str(value or "").strip()[:40] or accs[idx]["name"]
        elif action in ("up", "down"):
            j = idx - 1 if action == "up" else idx + 1
            if 0 <= j < len(accs):
                accs[idx], accs[j] = accs[j], accs[idx]
        return accs
    core.eleven_save_accounts(fn)
    out = view(fresh=action in ("delete", "enable"))
    if action == "delete" and _removed:
        out["removed_id"] = _removed[-1]["id"]
    return out


def restore_account(aid):
    acc = next((a for a in reversed(_removed) if a["id"] == aid), None)
    if not acc:
        raise ValueError("Bu hesap artık geri alınamıyor; anahtarı yeniden ekle")

    def fn(accs, el):
        if not any(a["key"] == acc["key"] for a in accs):
            accs.append(acc)
        return accs
    core.eleven_save_accounts(fn)
    _removed.remove(acc)
    return view(fresh=True)


def set_strategy(value):
    if value not in ("most", "order"):
        raise ValueError("geçersiz kullanım sırası")
    core.save_settings({"elevenlabs": {"strategy": value}})
    return view()


def _order(need):
    acc = accounts()
    if not acc:
        raise ElevenError("ElevenLabs anahtarı girilmemiş (Ayarlar > Seslendirme)")
    left = {}
    if len(acc) > 1:
        cached = core.eleven_credits().get("accounts") or []
        left = {c["id"]: c.get("left") for c in cached if c.get("left") is not None}
    for aid, n in _spent.items():
        if aid in left:
            left[aid] -= n
    if strategy() == "most":
        acc.sort(key=lambda a: -(left.get(a["id"]) if left.get(a["id"]) is not None else -1))
    if _pinned:
        acc.sort(key=lambda a: a["id"] != _pinned)
    enough = [a for a in acc if left.get(a["id"]) is None or left[a["id"]] >= need]
    return enough + [a for a in acc if a not in enough]


def speak(text, voice, sample_rate=24000):
    """Returns (pcm16 mono bytes, words with start/end seconds)."""
    pcm, al = speak_aligned(text, voice, sample_rate)
    return pcm, words(al) if al else []


def speak_aligned(text, voice, sample_rate=24000):
    """Returns (pcm16 mono bytes, character alignment of the input text)."""
    global _pinned, last_account
    body = {"text": text, "model_id": voice.get("model", "eleven_v3"), "language_code": voice.get("language", "tr"),
            "voice_settings": {"stability": voice.get("stability", 0.5), "similarity_boost": voice.get("similarity", 0.75)}}
    for k in ("style", "speed"):
        if voice.get(k) is not None:
            body["voice_settings"][k] = voice[k]
    path = f"/v1/text-to-speech/{voice['voice_id']}/with-timestamps?output_format=pcm_{sample_rate}"
    errors = []
    for acc in _order(len(text)):
        try:
            try:
                data = call(path, body, acc=acc)
            except ElevenError as e:
                if "language" not in str(e).lower() or "language_code" not in body:
                    raise
                body.pop("language_code")
                data = call(path, body, acc=acc)
        except ElevenError as e:
            if e.code not in SWITCH_CODES:
                raise
            errors.append(f"{acc.get('name') or acc['id']}: {e}")
            if _pinned == acc["id"]:
                _pinned = None
            continue
        _pinned = last_account = acc["id"]
        _spent[acc["id"]] = _spent.get(acc["id"], 0) + len(text)
        if errors:
            print(f"ElevenLabs: {acc.get('name') or acc['id']} hesabına geçildi ({'; '.join(errors)})", flush=True)
        return base64.b64decode(data["audio_base64"]), data.get("alignment") or data.get("normalized_alignment")
    if len(errors) == 1:
        raise ElevenError(errors[0].split(": ", 1)[1])
    raise ElevenError("Hiçbir ElevenLabs hesabı seslendiremedi — " + " | ".join(errors))


def words(al):
    out, cur = [], None
    for ch, s, e in zip(al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]):
        if ch.isspace():
            if cur:
                out.append(cur)
                cur = None
            continue
        if cur is None:
            cur = {"start": s, "end": e, "text": ch}
        else:
            cur["end"] = e
            cur["text"] += ch
    if cur:
        out.append(cur)
    return [{"start": round(w["start"], 3), "end": round(w["end"], 3), "text": w["text"]} for w in out]
