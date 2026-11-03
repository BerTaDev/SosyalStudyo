import re
import subprocess
from pathlib import Path

import core

HOME = Path.home()
MAIN = {"id": "main", "name": "Ana hesap", "dir": None}
_desktop = None


def desktop():
    global _desktop
    if _desktop is None:
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(520)
            ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buf)
            _desktop = Path(buf.value) if buf.value else HOME / "Desktop"
        except Exception:  # noqa: BLE001
            _desktop = HOME / "Desktop"
    return _desktop


def extra():
    lst = core.settings().get("accounts")
    if lst is None:
        d = HOME / "ClaudeSession2"
        lst = [{"id": "s2", "name": "Session 2", "dir": str(d), "shortcut": str(desktop() / "Claude Session 2.lnk")}] if d.exists() else []
    return [a for a in lst if a.get("id") and a["id"] != "main"]


def all_accounts():
    return [MAIN] + extra()


def names():
    return {a["id"]: a["name"] for a in all_accounts()}


def find(acc_id):
    return next((a for a in all_accounts() if a["id"] == acc_id), None)


def launcher(acc):
    return Path(acc["dir"]) / "launcher" / "launch.vbs" if acc and acc.get("dir") else None


def launch(acc_id):
    acc = find(acc_id)
    path = launcher(acc)
    if not path or not path.exists():
        raise ValueError("bu oturumun başlatıcısı bulunamadı")
    subprocess.Popen(["wscript", str(path)], close_fds=True)


def make_icon(n, dest):
    from PIL import Image, ImageDraw, ImageFont
    base = HOME / "ClaudeSession2" / "launcher" / "claude2.ico"
    if base.exists():
        im = Image.open(base)
        im.size = max(im.info.get("sizes") or [im.size])
        im = im.convert("RGBA").resize((256, 256))
    else:
        im = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
        ImageDraw.Draw(im).rounded_rectangle((8, 8, 248, 248), 56, fill=(214, 110, 76, 255))
    d = ImageDraw.Draw(im)
    d.ellipse((122, 122, 258, 258), fill=(255, 255, 255, 255))
    d.ellipse((131, 131, 249, 249), fill=(30, 30, 30, 255))
    txt = str(n)
    try:
        font = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 74 if len(txt) == 1 else 56)
    except OSError:
        font = ImageFont.load_default()
    x0, y0, x1, y1 = d.textbbox((0, 0), txt, font=font)
    d.text((190 - (x1 - x0) / 2 - x0, 190 - (y1 - y0) / 2 - y0), txt, font=font, fill=(255, 255, 255, 255))
    im.save(dest, sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])


def _ps_quote(s):
    return "'" + str(s).replace("'", "''") + "'"


def add(name=None):
    ids = {a["id"] for a in all_accounts()}
    n = 2
    while f"s{n}" in ids:
        n += 1
    name = (name or "").strip()[:40] or f"Session {n}"
    if name in names().values():
        raise ValueError("bu adda bir oturum zaten var")
    pdir = HOME / f"ClaudeSession{n}"
    ldir = pdir / "launcher"
    ldir.mkdir(parents=True, exist_ok=True)
    (ldir / "launch.ps1").write_text(
        f"$profileDir = {_ps_quote(pdir)}\n"
        "$pkg = Get-AppxPackage -Name Claude | Sort-Object Version -Descending | Select-Object -First 1\n"
        "$exe = Join-Path $pkg.InstallLocation 'app\\claude.exe'\n"
        "Start-Process -FilePath $exe -ArgumentList \"--user-data-dir=`\"$profileDir`\"\"\n", encoding="utf-8-sig")
    (ldir / "launch.vbs").write_text(
        'Set sh = CreateObject("WScript.Shell")\n'
        f'sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{ldir / "launch.ps1"}""", 0, False\n',
        encoding="utf-16")
    ico = ldir / f"claude{n}.ico"
    try:
        make_icon(n, ico)
    except Exception:  # noqa: BLE001
        ico = None
    safe = re.sub(r'[\\/:*?"<>|]+', " ", name).strip()
    lnk = desktop() / f"Claude {safe}.lnk"
    ps = (f"$s = (New-Object -ComObject WScript.Shell).CreateShortcut({_ps_quote(lnk)}); "
          f"$s.TargetPath = 'wscript.exe'; $s.Arguments = {_ps_quote(chr(34) + str(ldir / 'launch.vbs') + chr(34))}; "
          f"$s.WorkingDirectory = {_ps_quote(ldir)}; $s.Description = {_ps_quote('Claude ' + name)}; "
          + (f"$s.IconLocation = {_ps_quote(str(ico) + ',0')}; " if ico else "") + "$s.Save()")
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, timeout=30)
    acc = {"id": f"s{n}", "name": name, "dir": str(pdir), "shortcut": str(lnk)}
    core.save_settings({"accounts": extra() + [acc]})
    core.log_activity(f"Yeni Claude oturumu eklendi: {name}", kind="info")
    return acc


def remove(acc_id, delete_files=False):
    if acc_id == "main":
        raise ValueError("ana hesap çıkarılamaz")
    acc = find(acc_id)
    if not acc:
        raise KeyError(acc_id)
    core.save_settings({"accounts": [a for a in extra() if a["id"] != acc_id]})
    if acc_id in core.active_accounts():
        core.set_active_accounts([a for a in core.active_accounts() if a != acc_id])
    note = ""
    if delete_files:
        lnk = Path(acc.get("shortcut") or "")
        if lnk.suffix.lower() == ".lnk" and lnk.exists():
            lnk.unlink()
        pdir = Path(acc.get("dir") or "")
        if pdir.parent == HOME and re.fullmatch(r"ClaudeSession\d+", pdir.name) and pdir.exists():
            try:
                core._remove_tree(pdir)
            except OSError:
                note = "Profil klasörü kullanımda; o Claude penceresini kapatıp tekrar dene."
    core.log_activity(f"Claude oturumu çıkarıldı: {acc['name']}" + (" (dosyalarıyla)" if delete_files and not note else ""), kind="info")
    return {"ok": True, "note": note}
