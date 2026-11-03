import importlib
import importlib.util
import os
import subprocess
import sys
import threading
import urllib.request
from pathlib import Path

import core

MODEL = "large-v3-turbo"
REPO = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
FILES = ("config.json", "preprocessor_config.json", "tokenizer.json", "vocabulary.json", "model.bin")
SIZE = 1_622_000_000
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
NOT_READY = "konuşma tanıma modeli inik değil: stüdyoda Oluştur > Hazır ses / video > İndir"

JOB = {"state": "idle", "done": 0, "total": 0, "error": None}
_lock = threading.Lock()
_cancel = threading.Event()


class Cancelled(Exception):
    pass


def model_dir():
    return core.HOME / "_models" / "whisper" / MODEL


def available():
    importlib.invalidate_caches()
    return importlib.util.find_spec("faster_whisper") is not None


def model_ready():
    d = model_dir()
    return all((d / f).exists() for f in FILES)


def status():
    with _lock:
        job = dict(JOB)
    pkg, model = available(), model_ready()
    return dict(job, package=pkg, model=model, ready=pkg and model, size=SIZE)


def _set(**kw):
    with _lock:
        JOB.update(kw)


def _python():
    exe = Path(sys.executable)
    alt = exe.with_name("python.exe")
    return str(alt if exe.name.lower() == "pythonw.exe" and alt.exists() else exe)


SMALL = {"config.json": 2263, "preprocessor_config.json": 340, "tokenizer.json": 2710337, "vocabulary.json": 1068114}


def _sizes(base):
    try:
        with urllib.request.urlopen(urllib.request.Request(base + "model.bin", method="HEAD"), timeout=30) as r:
            big = int(r.headers.get("Content-Length") or 0)
    except OSError:
        big = 0
    return dict(SMALL, **{"model.bin": big or SIZE - sum(SMALL.values())})


def _download():
    d = model_dir()
    d.mkdir(parents=True, exist_ok=True)
    base = f"https://huggingface.co/{REPO}/resolve/main/"
    sizes = _sizes(base)
    total = sum(sizes.values())
    done = sum(sizes[f] for f in FILES if (d / f).exists())
    parts = sum((d / f"{f}.part").stat().st_size for f in FILES if (d / f"{f}.part").exists())
    _set(state="downloading", done=done + parts, total=total)
    for f in FILES:
        dest = d / f
        if dest.exists():
            continue
        part = d / f"{f}.part"
        have = part.stat().st_size if part.exists() else 0
        req = urllib.request.Request(base + f, headers={"Range": f"bytes={have}-"} if have else {})
        with urllib.request.urlopen(req, timeout=60) as r:
            if have and r.status != 206:
                have = 0
            got = have
            with open(part, "ab" if have else "wb") as out:
                while True:
                    if _cancel.is_set():
                        raise Cancelled
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
                    got += len(chunk)
                    _set(done=done + got)
        part.replace(dest)
        done += got
        _set(done=done)


def _run():
    try:
        if not available():
            _set(state="installing", done=0, total=0)
            r = subprocess.run([_python(), "-m", "pip", "install", *core.pip_target(), "faster-whisper"], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
            core.use_tools()
            if r.returncode or not available():
                raise RuntimeError("bileşen kurulamadı: " + (r.stderr or r.stdout).strip()[-300:])
        if not model_ready():
            _download()
        _set(state="idle", done=0, total=0, error=None)
        core.log_activity("Konuşma tanıma modeli indirildi; hazır ses / video ile video yapılabilir", kind="info")
    except Cancelled:
        _set(state="idle", error=None)
    except Exception as e:  # noqa: BLE001
        _set(state="error", error=f"indirme yarıda kaldı: {e}")


def start():
    with _lock:
        if JOB["state"] in ("installing", "downloading"):
            return status()
        JOB.update(state="downloading" if available() else "installing", done=0, total=0, error=None)
    _cancel.clear()
    threading.Thread(target=_run, daemon=True).start()
    return status()


def cancel():
    _cancel.set()
    return status()


def words(path, language=None, progress=None):
    if not available() or not model_ready():
        raise RuntimeError(NOT_READY)
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_dir()), device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
    segs, info = model.transcribe(str(path), language=language or None, word_timestamps=True, beam_size=1,
                                  condition_on_previous_text=False)
    out = []
    for s in segs:
        for w in s.words or []:
            t = w.word.strip()
            if t:
                out.append({"start": round(w.start, 3), "end": round(w.end, 3), "text": t})
        if progress:
            progress(f"yazıya dökülüyor {s.end:.0f}/{info.duration:.0f} sn")
    return out, info.language, info.duration


SENT_END = ".?!…"
SOFT_END = ",;:"


def split_lines(ws, max_words=16, pause=0.7):
    lines, cur = [], []
    for w in ws:
        if cur:
            prev = cur[-1]
            gap = w["start"] - prev["end"]
            n = len(cur)
            if (prev["text"][-1] in SENT_END and n >= 3) or gap > pause or n >= max_words + 4 \
                    or (n >= max_words and prev["text"][-1] in SOFT_END):
                lines.append(cur)
                cur = []
        cur.append(w)
    if cur:
        lines.append(cur)
    return lines


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    res, lang, dur = words(sys.argv[1], progress=lambda t: print(t, flush=True))
    print(lang, dur)
    for ln in split_lines(res):
        print(f"{ln[0]['start']:7.2f} {ln[-1]['end']:7.2f}  {' '.join(w['text'] for w in ln)}")
