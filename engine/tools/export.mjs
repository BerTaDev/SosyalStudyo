import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

const args = process.argv.slice(2);
const ROOT = path.resolve(args[0] && !args[0].startsWith("--") ? args[0] : ".");
const PROJECT = path.basename(ROOT);
const flag = (name) => args.includes(name);
const opt = (name, def = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};

function findBrowser() {
  const list = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];
  const hit = list.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("Edge ya da Chrome bulunamadı.");
  return hit;
}

function findFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {}
  const probe = () => execFileSync("python", ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  try {
    return probe();
  } catch {}
  try {
    execFileSync("python", ["-m", "pip", "install", "imageio-ffmpeg"], { stdio: "inherit" });
    return probe();
  } catch {}
  throw new Error("ffmpeg bulunamadı: stüdyoda Ayarlar > Bileşenler bölümünden indirip tekrar dene.");
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      const p = d.id && this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      d.error ? p.rej(new Error(d.error.message)) : p.res(d.result);
    };
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  close() {
    this.ws.close();
  }
}

const RENDER_TMP = process.env.SOSYAL_RENDER_TMP || os.tmpdir();
const PROFILE = path.join(RENDER_TMP, `sosyal-studyo-render-${process.pid}`);

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch {}
}

function killByProfile(dir) {
  if (process.platform !== "win32") return;
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${dir.replace(/'/g, "''")}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore", timeout: 20000 });
  } catch {}
}

function sweepStale() {
  for (const base of new Set([RENDER_TMP, os.tmpdir()])) {
    let names = [];
    try {
      names = fs.readdirSync(base).filter((n) => /^sosyal-studyo-render(-\d+)?$/.test(n));
    } catch {
      continue;
    }
    for (const n of names) {
      const pid = Number(n.split("-").pop());
      if (pid && pid !== process.pid && alive(pid)) continue;
      if (!pid && n !== "sosyal-studyo-render") continue;
      const dir = path.join(base, n);
      killByProfile(dir);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  }
}

async function launch(url) {
  sweepStale();
  const profile = PROFILE;
  fs.mkdirSync(profile, { recursive: true });
  const portFile = path.join(profile, "DevToolsActivePort");
  if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
  const proc = spawn(findBrowser(), ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--hide-scrollbars", "--mute-audio", "--window-size=1080,1920", "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" });
  let port = null;
  for (let i = 0; i < 200 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim() || null;
    } catch {}
  }
  if (!port) {
    killTree(proc.pid);
    killByProfile(profile);
    throw new Error("Tarayıcı başlatılamadı.");
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url });
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      if (await cdp.eval("window.__ready === true")) break;
    } catch {}
    if (i === 599) throw new Error("Sayfa hazır olmadı.");
  }
  return { cdp, proc };
}

const b64 = (dataUrl) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");

function mediaDuration(ff, file) {
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(ff, ["-hide_banner", "-i", file], { encoding: "utf8" }).stderr || "");
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : Infinity;
}

function footageSource(file, length, info, t, hold) {
  const { width: w, height: h, fps } = info;
  const lead = Math.max(0, Math.floor((Math.min(t, length - 1) - 1) * fps) / fps);
  const skip = t - lead;
  const trim = skip > 0 ? `,trim=start=${skip},setpts=PTS-STARTPTS` : "";
  return {
    input: ["-ss", String(lead), "-i", file],
    chain: `fps=${fps}:start_time=0,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,tpad=stop_mode=clone:stop_duration=${hold + skip}${trim}`,
  };
}

function run(ff, list) {
  return new Promise((res, rej) => {
    const p = spawn(ff, list, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(err.slice(-2000)))));
  });
}

const ff = findFfmpeg();
let sink = null;
let frameBytes = 0;
let received = 0;
let total = 0;
const t0 = Date.now();
const server = await serve(0, async (req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/__frame")) return false;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const buf = Buffer.concat(chunks);
  if (!sink || buf.length !== frameBytes) {
    res.writeHead(500);
    res.end();
    return true;
  }
  if (!sink.stdin.write(buf)) await once(sink.stdin, "drain");
  received++;
  if (received % 30 === 0 || received === total) {
    const el = (Date.now() - t0) / 1000;
    process.stdout.write(`\rkare ${received}/${total}  ${el.toFixed(0)} sn geçti  ~${(((total - received) * el) / received).toFixed(0)} sn kaldı   `);
  }
  res.end("ok");
  return true;
});
const base = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(PROJECT)}/index.html?export=1`;
const { cdp, proc } = await launch(base);
const info = await cdp.eval("window.__info");

try {
  const stills = opt("--stills");
  const bench = opt("--bench");
  const footage = info.footage ? path.resolve(ROOT, info.footage) : null;
  if (footage && !fs.existsSync(footage)) throw new Error(`Arka plan videosu bulunamadı: ${footage}`);
  const footageLength = footage ? mediaDuration(ff, footage) : 0;
  if (bench) {
    for (const s of bench.split(",")) console.log(s, JSON.stringify(await cdp.eval(`__bench(${Math.round(parseFloat(s) * info.fps)})`)));
  } else if (stills) {
    const dir = path.resolve(opt("--out", path.join(ROOT, "build", "stills")));
    fs.mkdirSync(dir, { recursive: true });
    for (const s of stills.split(",")) {
      const f = s.includes(".") ? Math.round(parseFloat(s) * info.fps) : +s;
      const t1 = Date.now();
      const file = path.join(dir, `f${String(f).padStart(4, "0")}.png`);
      const png = b64(await cdp.eval(`__renderFrame(${f}, { blur: ${!flag("--noblur")} })`));
      if (footage) {
        const src = footageSource(footage, footageLength, info, f / info.fps, 1 / info.fps);
        execFileSync(ff, ["-y", "-loglevel", "error", ...src.input, "-f", "png_pipe", "-i", "-", "-filter_complex", `[0]${src.chain}[bg];[bg][1]overlay=format=auto`, "-frames:v", "1", file], { input: png, stdio: ["pipe", "ignore", "pipe"] });
      } else fs.writeFileSync(file, png);
      console.log(`kare ${f} (${(f / info.fps).toFixed(2)} sn) ${Date.now() - t1} ms`);
    }
  } else {
    const first = +(opt("--from", 0));
    const last = +(opt("--to", info.frames));
    const out = path.resolve(opt("--out", path.join(ROOT, "video.mp4")));
    const mix = path.join(ROOT, "mix.wav");
    frameBytes = info.width * info.height * 4;
    total = last - first;
    const size = `${info.width}x${info.height}`;
    const src = footage && footageSource(footage, footageLength, info, first / info.fps, total / info.fps);
    const args = ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", size, "-framerate", String(info.fps), "-i", "-"];
    if (src) args.push(...src.input);
    else args.push("-f", "lavfi", "-i", `color=c=${info.background.replace("#", "0x")}:s=${size}:r=${info.fps}`);
    if (fs.existsSync(mix)) args.push("-i", mix);
    args.push("-filter_complex", src ? `[1]${src.chain}[bg];[bg][0]overlay=shortest=1:format=auto,format=yuv420p[v]` : "[1][0]overlay=shortest=1:format=auto,format=yuv420p[v]", "-map", "[v]");
    if (fs.existsSync(mix)) args.push("-map", "2:a", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest");
    args.push("-c:v", "libx264", "-preset", "medium", "-crf", "17", "-profile:v", "high", "-r", String(info.fps), "-map_metadata", "-1", "-movflags", "+faststart", out);
    sink = spawn(ff, args, { stdio: ["pipe", "inherit", "inherit"] });
    const closed = once(sink, "close");
    await cdp.eval(`__exportRange(${first}, ${last})`);
    sink.stdin.end();
    await closed;
    sink = null;
    console.log(`
video hazır: ${out} (${((Date.now() - t0) / 1000).toFixed(0)} sn)`);
  }
} finally {
  cdp.close();
  killTree(proc.pid);
  proc.kill();
  server.close();
  if (proc.exitCode === null) await Promise.race([once(proc, "exit"), new Promise((r) => setTimeout(r, 3000))]);
  killByProfile(PROFILE);
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(PROFILE, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}
console.log(`toplam ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
