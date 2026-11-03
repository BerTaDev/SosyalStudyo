import hashlib
import json
import subprocess
import sys
from pathlib import Path

STUDIO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(STUDIO))

import core  # noqa: E402
import eleven  # noqa: E402

SR = 48000


def line_hash(text, voice):
    keys = ("voice_id", "model", "language", "stability", "similarity", "style", "speed")
    blob = json.dumps({"t": text, **{k: voice.get(k) for k in keys}}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()


def to_wav(pcm, wav, rate_in=24000):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(rate_in), "-ac", "1", "-i", "pipe:0",
                    "-ar", str(SR), "-ac", "1", "-c:a", "pcm_s16le", str(wav)], input=pcm, check=True)


def speech_end(wav):
    import numpy as np
    import soundfile as sf
    x, sr = sf.read(wav, dtype="float32")
    if x.ndim > 1:
        x = x.mean(1)
    w = int(sr * 0.005)
    n = len(x) // w
    r = np.sqrt((x[:n * w].reshape(n, w) ** 2).mean(1))
    idx = np.where(r > r.max() * 0.02)[0]
    return (idx[0] * 0.005, (idx[-1] + 1) * 0.005) if len(idx) else (0.0, len(x) / sr)


RATE = 24000
CHUNK = 2500
GAP = 0.12
LEAD = 0.25
PAUSE_MAX = 0.3
PAUSE_KEEP = 0.18


def tighten(pcm, rate):
    import numpy as np
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
    w = int(rate * 0.01)
    n = len(x) // w
    if n < 3:
        return pcm, []
    r = np.sqrt((x[:n * w].reshape(n, w) ** 2).mean(1))
    silent = r < r.max() * 0.03
    speech = np.where(~silent)[0]
    if not len(speech):
        return pcm, []
    cuts, i, last = [], speech[0], speech[-1]
    while i <= last:
        if silent[i]:
            j = i
            while j <= last and silent[j]:
                j += 1
            if (j - i) * 0.01 > PAUSE_MAX:
                cuts.append((i * 0.01 + PAUSE_KEEP / 2, j * 0.01 - PAUSE_KEEP / 2))
            i = j
        else:
            i += 1
    if not cuts:
        return pcm, []
    parts, prev = [], 0
    for a, b in cuts:
        parts.append(x[prev:int(a * rate)])
        prev = int(b * rate)
    parts.append(x[prev:])
    return np.concatenate(parts).astype("<i2").tobytes(), cuts


def remap(t, cuts):
    shift = 0.0
    for a, b in cuts:
        if t >= b:
            shift += b - a
        elif t > a:
            return a - shift
    return t - shift


def chunks(lines):
    out, cur, n = [], [], 0
    for line in lines:
        if cur and n + len(line["text"]) > CHUNK:
            out.append(cur)
            cur, n = [], 0
        cur.append(line)
        n += len(line["text"]) + 1
    if cur:
        out.append(cur)
    return out


def char_times(text, al):
    chars, starts, ends = al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]
    if "".join(chars) == text:
        return list(zip(starts, ends))
    out, j = [], 0
    for ch in text:
        k = j
        while k < len(chars) and chars[k] != ch:
            k += 1
        if k < len(chars):
            out.append((starts[k], ends[k]))
            j = k + 1
        else:
            out.append(out[-1] if out else (0.0, 0.0))
    return out


def split_group(group, voice, out):
    texts = [l["text"].strip() for l in group]
    text = " ".join(texts)
    pcm, al = eleven.speak_aligned(text, voice, RATE)
    if not al:
        raise eleven.ElevenError("ElevenLabs zamanlama verisi döndürmedi")
    times = char_times(text, al)
    total = len(pcm) // 2 / RATE
    spans, pos = [], 0
    for t in texts:
        idx = [i for i in range(pos, pos + len(t)) if not text[i].isspace()]
        spans.append((times[idx[0]][0], times[idx[-1]][1]) if idx else (0.0, 0.0))
        pos += len(t) + 1
    cuts = [0.0]
    for (s0, e0), (s1, e1) in zip(spans, spans[1:]):
        cuts.append(max(cuts[-1], (e0 + s1) / 2))
    cuts.append(total)
    rows, pos = [], 0
    for k, (line, t) in enumerate(zip(group, texts)):
        a, b = cuts[k], cuts[k + 1]
        lo, hi = int(a * RATE) * 2, int(b * RATE) * 2
        part, cuts_in = tighten(pcm[lo:hi], RATE)
        to_wav(part, out / f"{line['id']}.wav", RATE)
        ws, cur = [], None
        for i in range(pos, pos + len(t)):
            ch = text[i]
            if ch.isspace():
                if cur:
                    ws.append(cur)
                    cur = None
                continue
            s, e = times[i]
            if cur is None:
                cur = {"start": s, "end": e, "text": ch}
            else:
                cur["end"] = e
                cur["text"] += ch
        if cur:
            ws.append(cur)
        rows.append([{"start": round(max(0.0, remap(w["start"] - a, cuts_in)), 3), "end": round(max(0.0, remap(w["end"] - a, cuts_in)), 3),
                      "text": w["text"]} for w in ws])
        pos += len(t) + 1
    return rows, len(text)


def synth(proj, cfg):
    voice = core.settings()["narrator"]
    out = proj / cfg["voice"]["dir"]
    out.mkdir(parents=True, exist_ok=True)
    cache_file = out / "cache.json"
    cache = core.read_json(cache_file, {})
    meta_file = out / "words.json"
    lines = cfg["voice"]["lines"]
    h = line_hash(" | ".join(l["text"] for l in lines), voice)
    old = {l["id"]: l["words"] for l in core.read_json(meta_file, {"lines": []})["lines"]}
    fresh = cache.get("_script") == h and all((out / f"{l['id']}.wav").exists() and l["id"] in old for l in lines)
    meta = {"voice": voice, "mode": "single", "lines": []}
    if fresh:
        meta["lines"] = [{"id": l["id"], "text": l["text"], "words": old[l["id"]]} for l in lines]
    else:
        spent = 0
        for group in chunks(lines):
            rows, n = split_group(group, voice, out)
            spent += n
            for line, words in zip(group, rows):
                meta["lines"].append({"id": line["id"], "text": line["text"], "words": words})
        core.write_json(cache_file, {"_script": h})
        groups = len(chunks(lines))
        print(f"Metnin tamamı tek seferde seslendirildi ({groups} parça), {len(lines)} satıra bölündü")
        print(f"ElevenLabs: {spent} karakter")
    core.write_json(meta_file, meta)


def place(proj, cfg):
    out = proj / cfg["voice"]["dir"]
    prev_end = 0.0
    rows = []
    ignored = 0
    for k, line in enumerate(cfg["voice"]["lines"]):
        lead, end = speech_end(out / f"{line['id']}.wav")
        if k == 0:
            start = round(min(max(line.get("anchor", LEAD), 0.0), 1.0), 2)
        else:
            start = round(prev_end + GAP, 2)
            ignored += bool(line.get("anchor") or line.get("gap"))
        line["at"] = start
        prev_end = start + (end - lead)
        rows.append((line["id"], start, prev_end, line.get("limit")))
    raw = json.loads((proj / "config.json").read_text(encoding="utf-8"))
    for line, src in zip(raw["voice"]["lines"], cfg["voice"]["lines"]):
        line["at"] = src["at"]
    dur = raw["video"]["duration"]
    (proj / "config.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for lid, s, e, limit in rows:
        warn = "  <-- limit aşıldı" if limit and e > limit else ""
        print(f"{lid}: {s:6.2f} -> {e:6.2f}{warn}")
    if ignored:
        print(f"Not: akıcı anlatım için {ignored} satırdaki anchor/gap yok sayıldı; satırlar arası {GAP} sn. Görselleri @satır referanslarıyla sese bağla.")
    print(f"Seslendirme {prev_end:.2f} sn'de bitiyor; video {dur} sn (kapanış için ~1,5-2,5 sn bırakman yeterli)")
    if prev_end > dur - 0.5:
        print(f"UYARI: seslendirme {prev_end:.2f} sn'de bitiyor, video {dur} sn; video.duration'ı uzat ya da metni kısalt")


def ingest(proj, cfg):
    import soundfile as sf
    import transcribe
    rel = cfg["voice"]["source"]
    src = proj / rel
    out = proj / cfg["voice"]["dir"]
    out.mkdir(parents=True, exist_ok=True)
    st = src.stat()
    key = f"{st.st_size}-{int(st.st_mtime)}-{transcribe.MODEL}"
    tfile = out / "transcript.json"
    tr = core.read_json(tfile, {})
    if tr.get("key") != key:
        print("Hazır ses yazıya dökülüyor (yerel konuşma tanıma, kredi harcanmaz)", flush=True)
        ws, lang, dur = transcribe.words(src, progress=lambda t: print(t, flush=True))
        tr = {"key": key, "language": lang, "duration": dur, "words": ws}
        core.write_json(tfile, tr)
    meta = core.read_json(out / "words.json", {"lines": []})
    ids = [l["id"] for l in cfg["voice"]["lines"]]
    fresh = (core.read_json(out / "cache.json", {}).get("_source") == key and meta.get("mode") == "source" and ids
             and ids == [l["id"] for l in meta["lines"]] and all((out / f"{i}.wav").exists() for i in ids))
    raw = json.loads((proj / "config.json").read_text(encoding="utf-8"))
    if fresh:
        at = {l["id"]: l["at"] for l in meta["lines"]}
        for line in raw["voice"]["lines"]:
            line["at"] = at[line["id"]]
    else:
        x, sr = sf.read(src, dtype="float32")
        if x.ndim > 1:
            x = x.mean(1)
        total = len(x) / sr
        groups = transcribe.split_lines(tr["words"])
        if not groups:
            raise SystemExit("HATA: hazır seste konuşma bulunamadı")
        cuts = [0.0] + [round((a[-1]["end"] + b[0]["start"]) / 2, 3) for a, b in zip(groups, groups[1:])] + [total]
        rows, lines = [], []
        for k, g in enumerate(groups, 1):
            lid = f"l{k:02d}"
            a, b = cuts[k - 1], cuts[k]
            wav = out / f"{lid}.wav"
            sf.write(wav, x[int(a * sr):int(b * sr)], sr, subtype="PCM_16")
            lead, _ = speech_end(wav)
            text = " ".join(w["text"] for w in g)
            words = [{"start": round(max(0.0, w["start"] - a), 3), "end": round(max(0.0, w["end"] - a), 3), "text": w["text"]} for w in g]
            rows.append({"id": lid, "text": text, "at": round(a + lead, 3), "words": words})
            lines.append({"id": lid, "text": text, "at": round(a + lead, 3)})
        core.write_json(out / "words.json", {"mode": "source", "source": rel, "language": tr["language"], "lines": rows})
        core.write_json(out / "cache.json", {"_source": key})
        raw["voice"]["lines"] = lines
        print(f"Hazır ses {len(lines)} satıra bölündü (dil: {tr['language']}, {total:.1f} sn)")
    (proj / "config.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    words = {l["id"]: l["words"] for l in core.read_json(out / "words.json")["lines"]}
    for line in raw["voice"]["lines"]:
        ws = words[line["id"]]
        end = line["at"] + (ws[-1]["end"] - ws[0]["start"] if ws else 0)
        print(f"{line['id']}: {line['at']:6.2f} -> {end:6.2f}  {line['text']}")
    last = max((l["at"] for l in raw["voice"]["lines"]), default=0)
    dur = raw["video"]["duration"]
    print(f"Konuşma {tr['duration']:.2f} sn sürüyor; video {dur} sn. Satırların at/id değerlerini değiştirme, görselleri @satır referanslarıyla bağla.")
    if last > dur - 0.5:
        print(f"UYARI: son satır {last:.2f} sn'de başlıyor, video {dur} sn; video.duration'ı uzat")


def main():
    proj = Path(sys.argv[1]).resolve()
    cfg = json.loads((proj / "config.json").read_text(encoding="utf-8"))
    if cfg["voice"].get("source"):
        ingest(proj, cfg)
        return
    synth(proj, cfg)
    place(proj, cfg)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        main()
    except eleven.ElevenError as e:
        print(f"HATA: {e}", file=sys.stderr)
        sys.exit(2)
