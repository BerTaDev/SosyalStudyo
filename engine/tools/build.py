import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt, lfilter

STUDIO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(STUDIO))

import core  # noqa: E402

ROOT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
SR = 48000


def load_config():
    return json.loads((ROOT / "config.json").read_text(encoding="utf-8"))


# ---------- narration ----------

def speech_region(x):
    w = int(SR * 0.005)
    n = len(x) // w
    r = np.sqrt((x[:n * w].reshape(n, w) ** 2).mean(1))
    idx = np.where(r > r.max() * 0.02)[0]
    return idx[0] * 0.005, (idx[-1] + 1) * 0.005


def load_voice(cfg):
    if not cfg["voice"]["lines"]:
        return []
    vdir = ROOT / cfg["voice"]["dir"]
    if not (vdir / "words.json").exists():
        raise SystemExit("HATA: önce seslendirme (studio.py voice)")
    meta = json.loads((vdir / "words.json").read_text(encoding="utf-8"))
    by_id = {l["id"]: l for l in meta["lines"]}
    out = []
    for line in cfg["voice"]["lines"]:
        x, sr = sf.read(vdir / f"{line['id']}.wav", dtype="float32")
        if x.ndim > 1:
            x = x.mean(1)
        if sr != SR:
            x = resample_poly(x, SR, sr).astype(np.float32)
        lead, end = speech_region(x)
        words = [dict(w) for w in by_id[line["id"]]["words"]]
        if words:
            words[0]["start"] = lead
            if len(words) > 1:
                words[0]["end"] = max(lead + 0.08, min(words[0]["end"], words[1]["start"] - 0.02))
            words[-1]["end"] = max(words[-1]["end"], end)
        tokens = line.get("show", line["text"]).split()
        if len(tokens) == len(words):
            for w, tok in zip(words, tokens):
                w["text"] = tok
        offset = line["at"] - lead
        for w in words:
            w["start"] = round(w["start"] + offset, 3)
            w["end"] = round(w["end"] + offset, 3)
        out.append({"id": line["id"], "text": line["text"], "at": line["at"], "fileStart": round(offset, 3),
                    "start": round(line["at"], 3), "end": round(end + offset, 3), "audio": x, "words": words})
    return out


# ---------- beats ----------

class Resolver:
    def __init__(self, cfg, voice):
        self.raw = cfg.get("beats", {})
        self.voice = {v["id"]: v for v in voice}
        self.cache = {}

    def value(self, expr):
        if isinstance(expr, (int, float)):
            return float(expr)
        if isinstance(expr, list):
            return [self.value(e) for e in expr]
        m = re.fullmatch(r"\s*([^+\-]+?)\s*([+\-]\s*[\d.]+)?\s*", expr)
        base, off = m.group(1), m.group(2)
        val = self.ref(base)
        return round(val + (float(off.replace(" ", "")) if off else 0.0), 3)

    def ref(self, name):
        if name.startswith("@"):
            parts = name[1:].split(":")
            v = self.voice[parts[0]]
            if len(parts) == 1:
                return v["start"]
            if parts[1] == "end":
                return v["end"]
            return v["words"][int(parts[1])]["start"]
        idx = None
        m = re.fullmatch(r"(\w+)\[(\d)\]", name)
        if m:
            name, idx = m.group(1), int(m.group(2))
        if name not in self.cache:
            self.cache[name] = self.value(self.raw[name])
        val = self.cache[name]
        if isinstance(val, list):
            return val[idx or 0]
        return val

    def all(self):
        return {k: self.ref(k) if not isinstance(self.raw[k], list) else self.value(self.raw[k]) for k in self.raw}


# ---------- subtitles ----------

def text_len(words):
    return len(" ".join(w["text"] for w in words))


def split_two(words):
    total = text_len(words)
    best, best_k = None, 1
    for k in range(1, len(words)):
        left = text_len(words[:k])
        bonus = 14 if words[k - 1]["text"][-1] in ".?!" else 8 if words[k - 1]["text"][-1] in ",;:" else 0
        cost = abs(left - total / 2) - bonus
        if best is None or cost < best:
            best, best_k = cost, k
    return words[:best_k], words[best_k:]


def split_n(words, n):
    if n <= 1 or len(words) < 2:
        return [words]
    if n == 2:
        return list(split_two(words))
    a, b = split_two(words)
    return split_n(a, n // 2) + split_n(b, n - n // 2)


def chunk_words(voice, cfg):
    st = cfg["subtitle"]
    per = st["maxChars"] * st["maxRows"]
    out = []
    for v in voice:
        words = v["words"]
        for group in split_n(words, -(-text_len(words) // per)):
            rows = [group] if text_len(group) <= st["maxChars"] else list(split_two(group))
            out.append({"start": group[0]["start"], "end": group[-1]["end"],
                        "rows": [" ".join(w["text"] for w in r) for r in rows],
                        "words": [{"text": w["text"], "start": w["start"], "end": w["end"]} for w in group]})
    for i, c in enumerate(out):
        nxt = out[i + 1]["start"] - 0.04 if i + 1 < len(out) else c["end"] + st["hold"]
        c["end"] = round(min(c["end"] + st["hold"], nxt), 3)
    return out


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


# ---------- audio helpers ----------

def to_stereo(x):
    if x.ndim == 1:
        return np.stack([x, x], 1)
    return x[:, :2]


def load_lib(cfg, rel, cache={}):
    path = Path(rel) if Path(rel).is_absolute() else Path(cfg.get("assets", {}).get("sfxLibrary") or core.HOME / "sfx") / rel
    if path not in cache:
        x, sr = sf.read(path, dtype="float32", always_2d=True)
        if sr != SR:
            g = np.gcd(SR, sr)
            x = resample_poly(x, SR // g, sr // g, axis=0).astype(np.float32)
        cache[path] = to_stereo(x)
    return cache[path]


def db(v):
    return 10 ** (v / 20)


def place(track, x, t):
    i = int(round(t * SR))
    if i >= len(track):
        return
    if i < 0:
        x = x[-i:]
        i = 0
    n = min(len(x), len(track) - i)
    track[i:i + n] += x[:n]


def fade(x, fin=0.0, fout=0.0):
    n = len(x)
    env = np.ones(n, dtype=np.float32)
    a = int(fin * SR)
    b = int(fout * SR)
    if a > 0:
        env[:a] = np.linspace(0, 1, a) ** 2
    if b > 0:
        env[n - b:] = np.minimum(env[n - b:], np.linspace(1, 0, b) ** 2)
    return x * env[:, None] if x.ndim > 1 else x * env


def k_weight(x):
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    return lfilter(b2, a2, lfilter(b1, a1, x, axis=0), axis=0)


def lufs(x):
    y = k_weight(to_stereo(x).astype(np.float64))
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    ms = np.array([(y[i:i + blk] ** 2).mean(0).sum() for i in range(0, len(y) - blk, hop)])
    ld = -0.691 + 10 * np.log10(ms + 1e-12)
    g = ms[ld > -70]
    if not len(g):
        return -70.0
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g = ms[(ld > -70) & (ld > rel)]
    return float(-0.691 + 10 * np.log10(g.mean()))


def limit(x, ceiling_db):
    ceil = db(ceiling_db)
    look = int(0.004 * SR)
    peak = np.abs(x).max(1)
    need = np.minimum(1.0, ceil / np.maximum(peak, 1e-9))
    from scipy.ndimage import minimum_filter1d
    g = minimum_filter1d(need, size=2 * look + 1)
    rel = np.exp(-1.0 / (0.08 * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):
        cur = g[i] if g[i] < cur else g[i] + (cur - g[i]) * rel
        out[i] = cur
    return x * out[:, None]


def write(path, x):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.clip(x, -1, 1), SR, subtype="PCM_16")


# ---------- build ----------

def build():
    cfg = load_config()
    voice = load_voice(cfg)
    res = Resolver(cfg, voice)
    beats = res.all()
    dur = cfg["video"]["duration"]
    n = int(round(dur * SR))

    def T(expr):
        return res.value(expr)

    # voice
    vtrack = np.zeros((n, 2), dtype=np.float32)
    for v in voice:
        place(vtrack, to_stereo(v["audio"]) * db(cfg["voice"].get("gain", 0)), v["fileStart"])
    vl = lufs(vtrack)
    vtrack *= db(-16.5 - vl)

    # music
    mtrack = np.zeros((n, 2), dtype=np.float32)
    music_info = []
    for tr in cfg.get("music", {}).get("tracks", []):
        path = Path(tr["file"]) if Path(tr["file"]).is_absolute() else Path(cfg.get("assets", {}).get("musicDir") or core.HOME / "muzik") / tr["file"]
        info = sf.info(path)
        at = T(tr["at"])
        until = min(T(tr["until"]), dur)
        if "sync" in tr:
            src0 = tr["sync"]["source"] - (T(tr["sync"]["beat"]) - at)
        else:
            src0 = tr["from"]
        x, sr = sf.read(path, start=int(src0 * info.samplerate), stop=int((src0 + until - at) * info.samplerate),
                        dtype="float32", always_2d=True)
        if sr != SR:
            x = resample_poly(x, SR, sr, axis=0).astype(np.float32)
        x = to_stereo(x)
        x = fade(x, tr.get("fadeIn", 0), tr.get("fadeOut", 0)) * db(tr.get("gain", 0))
        if tr.get("automation"):
            pts = np.array(tr["automation"], dtype=float)
            tt = at + np.arange(len(x)) / SR
            x *= db(np.interp(tt, pts[:, 0], pts[:, 1]))[:, None].astype(np.float32)
        place(mtrack, x, at)
        music_info.append({"id": tr["id"], "file": tr["file"], "start": round(at, 3), "end": round(until, 3),
                           "sourceStart": round(src0, 3)})
    env = np.abs(vtrack[:, 0])
    hop = int(0.01 * SR)
    blocks = env[:len(env) // hop * hop].reshape(-1, hop).max(1)
    active = (blocks > db(-38)).astype(float)
    duck = np.zeros_like(active)
    a = np.exp(-0.01 / cfg.get("music", {}).get("duckAttack", 0.06))
    r = np.exp(-0.01 / cfg.get("music", {}).get("duckRelease", 0.4))
    cur = 0.0
    for i, v in enumerate(active):
        cur = v + (cur - v) * (a if v > cur else r)
        duck[i] = cur
    look = int(0.05 / 0.01)
    duck = np.concatenate([duck[look:], np.zeros(look)])
    gain = db(-cfg.get("music", {}).get("duckDb", 9) * np.interp(np.arange(n) / hop, np.arange(len(duck)), duck)).astype(np.float32)
    mtrack *= gain[:, None]
    ml = lufs(mtrack)

    # sfx
    stracks = np.zeros((n, 2), dtype=np.float32)
    sfx_info = []
    sfx_dir = ROOT / "sfx"
    sfx_dir.mkdir(exist_ok=True)
    for old in sfx_dir.glob("*.wav"):
        old.unlink()
    rendered = []
    for i, ev in enumerate(cfg.get("sfx", [])):
        at = T(ev["at"])
        if "synth" in ev:
            raise SystemExit(f"HATA: kodla sentezlenmiş ses yasak ({ev.get('id')}); gerçek kayıt kullan")
        x = render_layers(cfg, ev)
        x = to_stereo(x.astype(np.float32))
        if "until" in ev:
            x = fade(x[:max(1, int((T(ev["until"]) - at) * SR))], 0, 0.06)
        x = fade(x, ev.get("fadeIn", 0), ev.get("fadeOut", 0)) * db(ev.get("gain", 0))
        rendered.append((i, ev, at, x))
    sfx_mix = np.zeros((n, 2), dtype=np.float32)
    for i, ev, at, x in rendered:
        place(sfx_mix, x, at)

    pre = vtrack + mtrack + sfx_mix
    mixcfg = cfg.get("mix", {"targetLufs": -14, "truePeak": -1.0})
    g = db(mixcfg["targetLufs"] - lufs(pre))
    vtrack *= g
    mtrack *= g
    sfx_mix *= g
    for i, ev, at, x in rendered:
        x = x * g
        name = f"{i + 1:02d}_{ev['id']}.wav"
        write(sfx_dir / name, x)
        sfx_info.append({"id": ev["id"], "file": f"sfx/{name}", "start": round(at, 3), "end": round(at + len(x) / SR, 3)})

    ceiling = mixcfg["truePeak"] - 0.3
    stems = {"seslendirme": vtrack, "muzik": mtrack, "sfx": sfx_mix}
    for k in stems:
        if np.abs(stems[k]).max() > db(ceiling):
            stems[k] = limit(stems[k], ceiling)
    mix = limit(stems["seslendirme"] + stems["muzik"] + stems["sfx"], ceiling)
    for k, x in stems.items():
        write(ROOT / f"{k}.wav", x)
    write(ROOT / "mix.wav", mix)

    # subtitles
    subs = chunk_words(voice, cfg)
    (ROOT / "altyazi.srt").write_text(
        "\n".join(f"{i}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n" + "\n".join(c["rows"]) + "\n"
                  for i, c in enumerate(subs, 1)), encoding="utf-8")
    (ROOT / "altyazi.json").write_text(json.dumps(
        {"lines": [{"id": v["id"], "text": v["text"], "start": v["start"], "end": v["end"], "words": v["words"]} for v in voice],
         "cues": subs}, ensure_ascii=False, indent=1), encoding="utf-8")

    # timeline for the renderer
    scenes = [{"id": s["id"], "name": s.get("name", s["id"]), "start": T(s["start"]), "end": T(s["end"])} for s in cfg.get("scenes", [])]
    timeline = {"duration": dur, "beats": beats, "scenes": scenes, "subtitles": subs,
                "voice": [{"id": v["id"], "start": v["start"], "end": v["end"], "words": v["words"]} for v in voice]}
    (ROOT / "build").mkdir(exist_ok=True)
    (ROOT / "build" / "timeline.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=1), encoding="utf-8")
    last = max((v["end"] for v in voice), default=0)
    if last > dur - 0.3:
        print(f"UYARI: seslendirme {last:.2f} sn'de bitiyor, video {dur} sn")
    print(f"voice {lufs(stems['seslendirme']):.1f} LUFS | music {lufs(stems['muzik']):.1f} | sfx {lufs(stems['sfx']):.1f} | mix {lufs(mix):.1f} LUFS, peak {20 * np.log10(np.abs(mix).max()):.2f} dBFS")


def render_layers(cfg, ev):
    parts = []
    burst = ev.get("burst")
    if burst:
        for k in range(burst["count"]):
            layer = ev["layers"][k % len(ev["layers"])]
            parts.append((k * burst["interval"], load_lib(cfg, layer["path"]) * db(layer.get("gain", 0) - (k % 3) * 0.8)))
        if ev.get("tail"):
            parts.append(((burst["count"] - 1) * burst["interval"], load_lib(cfg, ev["tail"]["path"]) * db(ev["tail"].get("gain", 0))))
    else:
        for layer in ev["layers"]:
            parts.append((layer.get("offset", 0), load_lib(cfg, layer["path"]) * db(layer.get("gain", 0))))
    length = max(int(o * SR) + len(x) for o, x in parts)
    out = np.zeros((length, 2), dtype=np.float32)
    for o, x in parts:
        i = int(o * SR)
        out[i:i + len(x)] += x
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    build()
