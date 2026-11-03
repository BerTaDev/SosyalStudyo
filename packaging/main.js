const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn, execFile } = require("child_process");
const { app, ipcMain } = require("electron");

const RES = process.resourcesPath;
const STUDIO = path.join(RES, "studio");
const PYTHON = path.join(RES, "python");
const portOf = (url) => {
  try {
    return Number(new URL(url).port) || 0;
  } catch {
    return 0;
  }
};
const PORT = Number(process.env.SOSYAL_PORT) || portOf(process.env.STUDIO_URL) || 8655;

function listening(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.setTimeout(1500, () => {
      s.destroy();
      resolve(false);
    });
  });
}

async function ensureServer() {
  if (await listening(PORT)) return;
  const pyw = path.join(PYTHON, "pythonw.exe");
  const py = fs.existsSync(pyw) ? pyw : path.join(PYTHON, "python.exe");
  const env = { ...process.env, SOSYAL_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(py, [path.join(STUDIO, "server.py"), "--port", String(PORT)], { cwd: STUDIO, env, detached: true, stdio: "ignore", windowsHide: true }).unref();
}

const upd = { phase: "idle", percent: 0, version: null, error: null };
let updater = null;

function newer(a, b) {
  const parts = (s) => String(s).split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function fail(e) {
  Object.assign(upd, { phase: "error", error: String((e && e.message) || e).split("\n")[0].slice(0, 240) });
}

function getUpdater() {
  if (updater) return updater;
  updater = require("electron-updater").autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.on("download-progress", (p) => Object.assign(upd, { phase: "downloading", percent: Math.floor(p.percent || 0) }));
  updater.on("update-downloaded", (i) => Object.assign(upd, { phase: "ready", percent: 100, version: i.version }));
  updater.on("error", (e) => {
    if (upd.phase !== "ready" && upd.phase !== "installing") fail(e);
  });
  return updater;
}

async function download() {
  if (["checking", "downloading", "ready", "installing"].includes(upd.phase)) return;
  Object.assign(upd, { phase: "checking", percent: 0, error: null });
  try {
    const r = await getUpdater().checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    if (!v || !newer(v, app.getVersion())) {
      upd.phase = "none";
      return;
    }
    Object.assign(upd, { phase: "downloading", version: v });
    getUpdater().downloadUpdate().catch(fail);
  } catch (e) {
    fail(e);
  }
}

function busy() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/update/ready`, { timeout: 8000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body).busy || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(null));
  });
}

function stopPython() {
  const dir = (PYTHON + path.sep).replace(/'/g, "''");
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}', 'OrdinalIgnoreCase') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  const args = ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")];
  return new Promise((resolve) => execFile("powershell.exe", args, { windowsHide: true, timeout: 30000 }, () => resolve()));
}

async function install() {
  if (upd.phase !== "ready") return { ok: false, reason: "Güncelleme henüz inmedi." };
  const why = await busy();
  if (why) return { ok: false, reason: why };
  upd.phase = "installing";
  await stopPython();
  await new Promise((r) => setTimeout(r, 800));
  await stopPython();
  setTimeout(() => getUpdater().quitAndInstall(true, true), 300);
  return { ok: true };
}

ipcMain.handle("upd:state", () => ({ ...upd, current: app.getVersion() }));
ipcMain.handle("upd:download", async () => {
  await download();
  return { ...upd, current: app.getVersion() };
});
ipcMain.handle("upd:install", () => install());

process.env.STUDIO_URL = process.env.STUDIO_URL || `http://127.0.0.1:${PORT}/`;
process.env.STUDIO_APPID = process.env.STUDIO_APPID || "com.bertadev.sosyalstudyo";
ensureServer();
require(path.join(STUDIO, "desktop", "main.js"));
