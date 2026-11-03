import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageOps

import core

VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm")
KINDS = {"image": "Fotoğraf", "carousel": "Kaydırmalı gönderi", "reels": "Reels", "story": "Hikâye"}


def is_video(path):
    return Path(path).suffix.lower() in VIDEO_EXT


def fit_image(src, dest, kind, ratio=None):
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    w, h = im.size
    if kind != "story":
        lo, hi = 0.8, 1.91
        target = ratio or min(max(w / h, lo), hi)
        if abs(w / h - target) > 0.01:
            if w / h > target:
                nw = int(h * target)
                im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
            else:
                nh = int(w / target)
                im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    if im.width > 1440:
        im = im.resize((1440, round(im.height * 1440 / im.width)), Image.LANCZOS)
    im.save(dest, "JPEG", quality=92)
    return im.width / im.height


def to_mp4(src, dest):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(dest)],
                   check=True)


def thumb(src, dest):
    if is_video(src):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "0.5", "-i", str(src), "-frames:v", "1", "-vf", "scale=540:-2",
                        "-q:v", "3", str(dest)], check=False)
    else:
        im = Image.open(src)
        im.thumbnail((540, 960))
        im.save(dest, "JPEG", quality=85)


def create(kind, uploads, caption="", hashtags=""):
    if kind not in KINDS:
        raise ValueError("geçersiz paylaşım türü")
    files = [core.UPLOADS / Path(u).name for u in uploads]
    files = [f for f in files if f.exists()]
    if not files:
        raise ValueError("dosya yüklenmedi")
    if kind == "reels" and (len(files) != 1 or not is_video(files[0])):
        raise ValueError("Reels için tek bir video seç")
    if kind in ("image", "story") and len(files) != 1:
        raise ValueError("bu tür için tek dosya seç")
    if kind == "image" and is_video(files[0]):
        raise ValueError("fotoğraf paylaşımı için görsel seç (video için Reels)")
    if kind == "carousel" and not 2 <= len(files) <= 10:
        raise ValueError("kaydırmalı gönderi için 2-10 dosya seç")
    if any(is_video(f) for f in files):
        core.need_ffmpeg()
    title = (caption.strip().split("\n")[0][:60] if caption.strip() else "") or f"{KINDS[kind]} paylaşımı"
    extra = {"kind": kind, "status": "inceleme", "stage": "Paylaşıma hazır", "progress": 1, "caption": caption.strip(),
             "manual": True}
    if hashtags.strip():
        extra["hashtags"] = hashtags.strip()
    post = core.new_post(title, f"{KINDS[kind]} · elle yüklendi", 0, {"format": "serbest"}, extra=extra)
    pdir = core.post_dir(post["id"])
    names, ratio = [], None
    for i, f in enumerate(files, 1):
        if is_video(f):
            dest = pdir / ("final.mp4" if kind == "reels" else f"{i:02d}.mp4")
            if f.suffix.lower() == ".mp4":
                shutil.move(str(f), dest)
            else:
                to_mp4(f, dest)
                f.unlink()
        else:
            dest = pdir / f"{i:02d}.jpg"
            r = fit_image(f, dest, kind, ratio if kind == "carousel" else None)
            ratio = ratio or r
            f.unlink()
        names.append(dest.name)
    thumb(pdir / names[0], pdir / "thumb.jpg")

    def fn(p):
        if kind == "reels":
            p["video"] = names[0]
        else:
            p["media"] = names
    core.update_post(post["id"], fn)
    core.log_activity(f"{KINDS[kind]} hazırlandı ({len(names)} dosya)", post=post["id"], kind="done")
    return core.load_post(post["id"])
