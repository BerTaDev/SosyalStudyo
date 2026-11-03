const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

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

process.env.STUDIO_URL = process.env.STUDIO_URL || `http://127.0.0.1:${PORT}/`;
process.env.STUDIO_APPID = process.env.STUDIO_APPID || "com.bertadev.sosyalstudyo";
ensureServer();
require(path.join(STUDIO, "desktop", "main.js"));
