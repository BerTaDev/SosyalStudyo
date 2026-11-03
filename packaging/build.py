import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PY_VERSION = "3.13.17"
PY_SHA256 = "9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38"
PY_URL = f"https://www.python.org/ftp/python/{PY_VERSION}/python-{PY_VERSION}-embed-amd64.zip"
PY_TAG = "".join(PY_VERSION.split(".")[:2])
SKIP_DIRS = ("packaging/", "build-cache/", "dist/", "node_modules/", "docs/", ".github/")
SKIP_NAMES = {"local.json", "Thumbs.db", "desktop.ini", "README.md", ".gitignore", ".gitattributes"}
PRUNE = ("numpy", "scipy")


def log(msg):
    print(f"[build] {msg}", flush=True)


def run(cmd, cwd=None, env=None):
    log(" ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], cwd=cwd, env=env, check=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def rmtree(path):
    if path.exists():
        shutil.rmtree(path)


def download(url, dest, digest=None):
    if dest.exists() and (not digest or sha256(dest) == digest):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    log(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)
    if digest and sha256(tmp) != digest:
        tmp.unlink()
        raise SystemExit(f"checksum mismatch: {url}")
    tmp.replace(dest)
    return dest


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def studio_files():
    out = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                         capture_output=True, check=True).stdout.decode("utf-8")
    keep = []
    for name in sorted({n for n in out.split("\0") if n}):
        p = Path(name)
        if name.startswith(SKIP_DIRS) or p.name in SKIP_NAMES or "__pycache__" in p.parts or p.suffix == ".pyc":
            continue
        if (ROOT / name).is_file():
            keep.append(name)
    return keep


def stage_studio(out):
    dest = out / "studio"
    rmtree(dest)
    files = studio_files()
    for name in files:
        target = dest / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    log(f"studio: {len(files)} files")
    return dest


def stage_python(out, fresh):
    target = out / "python"
    stamp = target / ".stamp.json"
    req = HERE / "requirements.txt"
    want = {"python": PY_VERSION, "requirements": sha256(req)}
    if not fresh and stamp.exists() and json.loads(stamp.read_text(encoding="utf-8")) == want:
        log("python runtime is up to date")
        return target
    rmtree(target)
    archive = download(PY_URL, out / "downloads" / f"python-{PY_VERSION}-embed-amd64.zip", PY_SHA256)
    with zipfile.ZipFile(archive) as z:
        z.extractall(target)
    write_text(target / f"python{PY_TAG}._pth", "\n".join([f"python{PY_TAG}.zip", ".", "Lib\\site-packages", "..\\studio", "import site", ""]))
    site = target / "Lib" / "site-packages"
    site.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, PIP_CACHE_DIR=str(out / "cache" / "pip"), PIP_DISABLE_PIP_VERSION_CHECK="1")
    pip_pin = next(line.strip() for line in req.read_text(encoding="utf-8").splitlines() if line.strip().startswith("pip=="))
    run([sys.executable, "-m", "pip", "install", "--target", site, "--no-deps", "--no-compile", "--ignore-requires-python", pip_pin], env=env)
    rmtree(site / "bin")
    run([target / "python.exe", "-m", "pip", "install", "--only-binary=:all:", "--no-compile", "--no-warn-script-location", "-r", req], env=env)
    rmtree(target / "Scripts")
    for stray in site.glob("*.whl"):
        stray.unlink()
    for pkg in PRUNE:
        for d in sorted((site / pkg).rglob("tests"), key=lambda p: len(p.parts), reverse=True):
            if d.is_dir():
                shutil.rmtree(d)
    for d in list(target.rglob("__pycache__")):
        shutil.rmtree(d, ignore_errors=True)
    run([target / "python.exe", "-c", "import numpy, scipy.signal, scipy.ndimage, soundfile, PIL.Image, zoneinfo, pip, sys; "
         "zoneinfo.ZoneInfo('America/Los_Angeles'); print(sys.version.split()[0], numpy.__version__, scipy.__version__)"])
    write_text(stamp, json.dumps(want))
    return target


def tool(name):
    path = shutil.which(name + ".cmd") or shutil.which(name)
    if not path:
        raise SystemExit(f"{name} not found on PATH (install Node.js 22+)")
    return path


def stage_app(out, version):
    app = out / "app"
    app.mkdir(parents=True, exist_ok=True)
    shutil.copy2(HERE / "main.js", app / "main.js")
    pkg = json.loads((HERE / "package.json").read_text(encoding="utf-8"))
    pkg["version"] = version
    write_text(app / "package.json", json.dumps(pkg, ensure_ascii=False, indent=2) + "\n")
    lock = json.loads((HERE / "package-lock.json").read_text(encoding="utf-8"))
    lock["version"] = version
    lock["packages"][""]["version"] = version
    write_text(app / "package-lock.json", json.dumps(lock, ensure_ascii=False, indent=2) + "\n")
    (app / "build").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "icon.ico", app / "build" / "icon.ico")
    stamp = app / "node_modules" / ".deps.json"
    want = {"lock": sha256(HERE / "package-lock.json")}
    if not (stamp.exists() and json.loads(stamp.read_text(encoding="utf-8")) == want):
        env = dict(os.environ, ELECTRON_SKIP_BINARY_DOWNLOAD="1")
        run([tool("npm"), "ci", "--no-audit", "--no-fund", "--prefer-offline"], cwd=app, env=env)
        write_text(stamp, json.dumps(want))
    return app


def main():
    ap = argparse.ArgumentParser(description="Builds the Sosyal Stüdyo Windows installer.")
    ap.add_argument("--out", default=str(ROOT / "build-cache"), help="build/cache directory")
    ap.add_argument("--fresh-python", action="store_true", help="rebuild the embedded Python runtime")
    ap.add_argument("--dir", action="store_true", help="only build the unpacked app, no installer")
    args = ap.parse_args()
    if os.name != "nt":
        raise SystemExit("the installer is built on Windows")
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    stage_studio(out)
    stage_python(out, args.fresh_python)
    app = stage_app(out, version)
    env = dict(os.environ, CSC_IDENTITY_AUTO_DISCOVERY="false")
    env.setdefault("ELECTRON_BUILDER_CACHE", str(out / "cache" / "builder"))
    run([tool("node"), app / "node_modules" / "electron-builder" / "cli.js", "--win", "dir" if args.dir else "nsis", "--x64", "--publish", "never"], cwd=app, env=env)
    exe = out / "dist" / "SosyalStudyo-Kurulum.exe"
    if not args.dir and exe.exists():
        log(f"installer: {exe} ({exe.stat().st_size / 1e6:.1f} MB)")
    log(f"unpacked app: {out / 'dist' / 'win-unpacked'}")


if __name__ == "__main__":
    main()
