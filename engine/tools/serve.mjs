import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(process.env.PROJECTS_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".wav": "audio/wav", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",".png": "image/png", ".css": "text/css" };

export function serve(port = 0, hook = null) {
  const server = http.createServer(async (req, res) => {
    if (hook && (await hook(req, res))) return;
    let url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (url.endsWith("/")) url += "index.html";
    const file = path.normalize(path.join(ROOT, url));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    const size = fs.statSync(file).size;
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? +range[1] : 0;
      const end = range[2] ? +range[2] : size - 1;
      res.writeHead(206, { "Content-Type": type, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1, "Cache-Control": "no-store" });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const project = path.basename(path.resolve(process.argv[2] || "."));
  const port = +(process.argv.slice(3).find((a) => /^\d+$/.test(a)) || 8790);
  const server = await serve(port);
  const url = `http://127.0.0.1:${server.address().port}/${encodeURIComponent(project)}/`;
  console.log(`Önizleme: ${url}  (kapatmak için bu pencereyi kapat)`);
  if (process.argv.includes("--open")) exec(`start "" "${url}"`);
}
