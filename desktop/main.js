const { app, BrowserWindow, WebContentsView, Menu, ipcMain, session, shell, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");

const START = process.env.STUDIO_URL || "http://127.0.0.1:8655/";
const ORIGIN = new URL(START).origin;
const HOME = "https://www.google.com/";
const DATA = process.env.STUDIO_DESKTOP_DATA || path.join(process.env.LOCALAPPDATA || app.getPath("appData"), "SosyalStudyo", "desktop-data");
const TEST = !!process.env.STUDIO_DESKTOP_TEST;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split(".")[0]}.0.0.0 Safari/537.36`;

app.setPath("userData", DATA);
app.userAgentFallback = UA;
if (TEST) {
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
  app.commandLine.appendSwitch("mute-audio");
}
app.setAppUserModelId(process.env.STUDIO_APPID || "SosyalStudyo");
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let cur = null;
let bounds = null;
let shown = false;
let seq = 0;
let loading = false;
const sets = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, d) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));
  } catch {
    return d;
  }
};
const writeJson = (f, v) => {
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 1));
  } catch {}
};
const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return ORIGIN;
  }
};
const isLocal = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
  } catch {
    return false;
  }
};

function normalize(text) {
  const t = (text || "").trim();
  if (!t) return HOME;
  if (/^(https?|about|file):/i.test(t)) return t;
  if (!/\s/.test(t) && /\.[a-z]{2,}/i.test(t.split("/")[0]) && !t.startsWith(".")) return `https://${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

function makeSession(part) {
  const ses = session.fromPartition(part);
  ses.setUserAgent(UA, "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7");
  const allowed = new Set(["clipboard-sanitized-write", "fullscreen", "pointerLock", "window-management"]);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  return ses;
}

function setFor(origin) {
  const key = origin || ORIGIN;
  let S = sets.get(key);
  if (!S) {
    const home = key === ORIGIN;
    const port = new URL(key).port || "80";
    S = { origin: key, home, file: home ? "tabs.json" : `tabs-${port}.json`, tabs: new Map(), order: [], active: null, agentTab: null,
      loaded: false, saveTimer: null, ses: makeSession(home ? "persist:tarayici" : `persist:tarayici-${port}`) };
    sets.set(key, S);
  }
  return S;
}

function senderSet(e) {
  const S = setFor(originOf((e.senderFrame && e.senderFrame.url) || e.sender.getURL()));
  if (win && e.sender === win.webContents) cur = S;
  return S;
}

function state(S) {
  return {
    active: S.active,
    tabs: S.order.filter((id) => S.tabs.has(id)).map((id) => {
      const t = S.tabs.get(id);
      const wc = t.view.webContents;
      return { id, url: wc.getURL() || t.url || "", title: wc.getTitle() || "", loading: wc.isLoading(), favicon: t.favicon || "", agent: !!t.agent,
        canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward() };
    }),
  };
}

function save(S) {
  if (!S.loaded) return;
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => {
    const st = state(S);
    const urls = st.tabs.map((t) => t.url).filter((u) => /^https?:/.test(u));
    writeJson(S.file, { tabs: urls, active: Math.max(0, st.tabs.findIndex((t) => t.id === S.active)) });
  }, 800);
}

function emit(S) {
  if (S === cur && win && !win.isDestroyed()) win.webContents.send("bw-state", state(S));
  save(S);
}

function cmd(S, c) {
  if (S !== cur || !win || win.isDestroyed()) return;
  if (c.focus) win.webContents.focus();
  win.webContents.send("bw-cmd", c);
}

function layout() {
  if (!win || win.isDestroyed()) return;
  for (const S of sets.values()) {
    for (const [id, t] of S.tabs) {
      const on = S === cur && id === S.active && shown && bounds;
      if (on) {
        if (!t.attached) {
          win.contentView.addChildView(t.view);
          t.attached = true;
        }
        t.view.setBounds(bounds);
        t.view.setVisible(true);
        if (TEST) console.log("layout", S.origin, id, JSON.stringify(bounds));
      } else if (t.attached) t.view.setVisible(false);
    }
  }
}

function activate(S, id) {
  if (!S.tabs.has(id)) return;
  S.active = id;
  layout();
  emit(S);
}

function ctxMenu(t, p) {
  const S = t.set;
  const wc = t.view.webContents;
  const items = [];
  if (p.linkURL) {
    items.push({ label: "Bağlantıyı yeni sekmede aç", click: () => newTab(S, p.linkURL) });
    items.push({ label: "Bağlantı adresini kopyala", click: () => clipboard.writeText(p.linkURL) });
    items.push({ type: "separator" });
  }
  if (p.mediaType === "image" && p.srcURL) {
    items.push({ label: "Görseli kopyala", click: () => wc.copyImageAt(p.x, p.y) });
    items.push({ label: "Görseli yeni sekmede aç", click: () => newTab(S, p.srcURL) });
    items.push({ type: "separator" });
  }
  if (p.isEditable) {
    items.push({ label: "Kes", role: "cut", enabled: p.editFlags.canCut }, { label: "Kopyala", role: "copy", enabled: p.editFlags.canCopy },
      { label: "Yapıştır", role: "paste", enabled: p.editFlags.canPaste }, { label: "Tümünü seç", role: "selectAll" }, { type: "separator" });
  } else if (p.selectionText) {
    items.push({ label: "Kopyala", role: "copy" }, { label: `"${p.selectionText.trim().slice(0, 24)}${p.selectionText.trim().length > 24 ? "…" : ""}" için Google'da ara`, click: () => newTab(S, p.selectionText) });
    items.push({ label: "Seçimi panoya ekle", click: () => cmd(S, { type: "capture", mode: "selection" }) }, { type: "separator" });
  }
  items.push({ label: "Geri", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
    { label: "İleri", enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
    { label: "Yenile", click: () => wc.reload() }, { type: "separator" },
    { label: "Ekran görüntüsünü panoya ekle", click: () => cmd(S, { type: "capture", mode: "visible" }) },
    { label: "Tam sayfayı panoya ekle", click: () => cmd(S, { type: "capture", mode: "full" }) },
    { label: "Sayfanın HTML'ini panoya ekle", click: () => cmd(S, { type: "capture", mode: "html" }) },
    { type: "separator" }, { label: "İncele", click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup({ window: win });
}

function keys(e, input, t) {
  if (input.type !== "keyDown") return;
  const S = t.set;
  const k = (input.key || "").toLowerCase();
  const ctrl = input.control || input.meta;
  const wc = t.view.webContents;
  let hit = true;
  if (ctrl && k === "t") newTab(S);
  else if (ctrl && k === "w") closeTab(S, t.id);
  else if (ctrl && k === "l") cmd(S, { type: "address", focus: true });
  else if ((ctrl && k === "r") || k === "f5") wc.reload();
  else if (input.alt && k === "arrowleft") wc.navigationHistory.goBack();
  else if (input.alt && k === "arrowright") wc.navigationHistory.goForward();
  else if (k === "f12" || (ctrl && input.shift && k === "i")) wc.toggleDevTools();
  else if (ctrl && input.shift && k === "s") cmd(S, { type: "capture", mode: "region", focus: true });
  else hit = false;
  if (hit) e.preventDefault();
}

function newTab(S, url, focusAddress = !url) {
  const view = new WebContentsView({ webPreferences: { session: S.ses, sandbox: true, contextIsolation: true } });
  const id = `t${++seq}`;
  const t = { id, set: S, view, url: normalize(url), favicon: "", attached: false };
  S.tabs.set(id, t);
  const at = S.order.indexOf(S.active);
  S.order.splice(at >= 0 ? at + 1 : S.order.length, 0, id);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url: u }) => {
    newTab(S, u);
    return { action: "deny" };
  });
  for (const ev of ["did-start-loading", "did-stop-loading", "page-title-updated", "did-navigate", "did-navigate-in-page"]) wc.on(ev, () => emit(S));
  wc.on("page-favicon-updated", (_e, favs) => {
    t.favicon = favs[0] || "";
    emit(S);
  });
  wc.on("context-menu", (_e, p) => ctxMenu(t, p));
  wc.on("before-input-event", (e, input) => keys(e, input, t));
  wc.loadURL(t.url).catch(() => {});
  activate(S, id);
  if (focusAddress) cmd(S, { type: "address", focus: true });
  return t;
}

function closeTab(S, id) {
  const t = S.tabs.get(id);
  if (!t) return;
  const i = S.order.indexOf(id);
  if (t.attached && win && !win.isDestroyed()) win.contentView.removeChildView(t.view);
  if (S.agentTab === id) S.agentTab = null;
  S.tabs.delete(id);
  S.order = S.order.filter((x) => x !== id);
  try {
    t.view.webContents.close();
  } catch {}
  if (!S.order.length) return newTab(S);
  if (S.active === id) activate(S, S.order[Math.min(i, S.order.length - 1)]);
  else emit(S);
}

function ensureTabs(S) {
  if (S.loaded) return;
  S.loaded = true;
  const saved = readJson(S.file, {});
  const urls = (saved.tabs || []).filter((u) => typeof u === "string").slice(0, 12);
  if (!urls.length && !S.tabs.size) urls.push(HOME);
  const ids = urls.map((u) => newTab(S, u, false).id);
  if (ids.length) activate(S, ids[Math.min(Math.max(saved.active || 0, 0), ids.length - 1)]);
}

async function fullPage(wc) {
  const dbg = wc.debugger;
  const own = !dbg.isAttached();
  if (own) dbg.attach("1.3");
  try {
    const m = await dbg.sendCommand("Page.getLayoutMetrics");
    const size = m.cssContentSize || m.contentSize || {};
    const vp = m.cssVisualViewport || m.visualViewport || {};
    const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: Math.max(size.width || 0, vp.clientWidth || 0), height: Math.min(Math.max(size.height || 0, vp.clientHeight || 0), 16000), scale: 1 } });
    return shot.data;
  } finally {
    if (own) dbg.detach();
  }
}

function setupIpc() {
  ipcMain.handle("bw:state", (e) => {
    const S = senderSet(e);
    ensureTabs(S);
    return state(S);
  });
  ipcMain.handle("bw:layout", (e, r) => {
    const S = senderSet(e);
    shown = !!(r && r.show);
    if (r && r.w > 0 && r.h > 0) bounds = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.w), height: Math.round(r.h) };
    if (shown) ensureTabs(S);
    layout();
  });
  ipcMain.handle("bw:open", (e, url) => {
    const S = senderSet(e);
    newTab(S, url);
    return state(S);
  });
  ipcMain.handle("bw:close", (e, id) => {
    const S = senderSet(e);
    closeTab(S, id);
    return state(S);
  });
  ipcMain.handle("bw:activate", (e, id) => {
    const S = senderSet(e);
    activate(S, id);
    return state(S);
  });
  ipcMain.handle("bw:focus", (e) => {
    const S = senderSet(e);
    const t = S.tabs.get(S.active);
    if (t) t.view.webContents.focus();
  });
  ipcMain.handle("bw:nav", (e, { id, action, url }) => {
    const S = senderSet(e);
    const t = S.tabs.get(id || S.active);
    if (!t) return state(S);
    const wc = t.view.webContents;
    if (action === "go") wc.loadURL(normalize(url)).catch(() => {});
    else if (action === "back") wc.navigationHistory.goBack();
    else if (action === "forward") wc.navigationHistory.goForward();
    else if (action === "reload") wc.reload();
    else if (action === "stop") wc.stop();
    return state(S);
  });
  ipcMain.handle("bw:snapshot", async (e) => {
    const S = senderSet(e);
    const t = S.tabs.get(S.active);
    if (!t) return null;
    const img = await t.view.webContents.capturePage();
    return img.isEmpty() ? null : img.toDataURL();
  });
  ipcMain.handle("bw:capture", async (e, { id, mode }) => {
    const S = senderSet(e);
    const t = S.tabs.get(id || S.active);
    if (!t) throw new Error("sekme yok");
    const wc = t.view.webContents;
    const meta = { title: wc.getTitle() || wc.getURL(), url: wc.getURL() };
    if (mode === "html") {
      const d = await wc.executeJavaScript("({html: document.documentElement.outerHTML, text: document.body ? document.body.innerText : '', title: document.title, url: location.href})");
      return { kind: "html", title: d.title || meta.title, url: d.url || meta.url, data: d.html, text: d.text };
    }
    if (mode === "selection") {
      const text = String(await wc.executeJavaScript("String(getSelection ? getSelection().toString() : '')")).trim();
      if (!text) throw new Error("sayfada seçili metin yok; önce fareyle metni seç");
      return { kind: "text", ...meta, data: text };
    }
    if (mode === "full") return { kind: "png", ...meta, data: await fullPage(wc) };
    const img = await wc.capturePage();
    return { kind: "png", ...meta, data: img.toPNG().toString("base64") };
  });
}

// ---------- research agent executor ----------

function agentTabFor(S, job) {
  let t = S.tabs.get(S.agentTab);
  if (!t) {
    t = newTab(S, HOME, false);
    S.agentTab = t.id;
  }
  t.agent = job;
  return t;
}

async function settle(wc, max = 20000) {
  const end = Date.now() + max;
  await sleep(350);
  while (wc.isLoading() && Date.now() < end) await sleep(200);
  await sleep(700);
}

const READ_JS = (max) => `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none"; };
  document.querySelectorAll("[data-sa-n]").forEach((e) => e.removeAttribute("data-sa-n"));
  const links = []; const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    if (links.length >= 80) break;
    const text = (a.innerText || a.getAttribute("aria-label") || a.title || "").replace(/\\s+/g, " ").trim();
    if (!text || !/^https?:/.test(a.href) || seen.has(a.href) || !vis(a)) continue;
    seen.add(a.href); a.setAttribute("data-sa-n", "l" + (links.length + 1)); links.push({ n: links.length + 1, text: text.slice(0, 100), url: a.href });
  }
  const inputs = [];
  for (const i of document.querySelectorAll("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image]), textarea, [contenteditable=true]")) {
    if (inputs.length >= 15 || !vis(i)) continue;
    i.setAttribute("data-sa-n", "i" + (inputs.length + 1));
    inputs.push({ n: inputs.length + 1, label: (i.getAttribute("aria-label") || i.placeholder || i.name || i.title || i.type || "").slice(0, 60) });
  }
  const text = (document.body ? document.body.innerText : "").replace(/[ \\t]+/g, " ").replace(/\\n\\s*\\n+/g, "\\n\\n").trim();
  return { title: document.title, url: location.href, text: text.slice(0, ${max}), truncated: text.length > ${max}, links, inputs };
})()`;

const TYPE_JS = (sel, text, enter) => `(() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return false;
  e.scrollIntoView({ block: "center" });
  e.focus();
  if (e.isContentEditable) e.textContent = ${JSON.stringify(text)};
  else {
    const proto = e.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(e, ${JSON.stringify(text)});
  }
  e.dispatchEvent(new Event("input", { bubbles: true }));
  e.dispatchEvent(new Event("change", { bubbles: true }));
  if (${enter ? "true" : "false"}) {
    e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    const f = e.form;
    if (f) f.requestSubmit ? f.requestSubmit() : f.submit();
  }
  return true;
})()`;

async function post(origin, pathname, body) {
  const r = await fetch(`${origin}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

async function agentDo(S, job, action, a) {
  const t = agentTabFor(S, job);
  const wc = t.view.webContents;
  const here = () => ({ url: wc.getURL(), title: wc.getTitle() });
  if (action === "open" || action === "search") {
    const target = action === "search" ? `https://www.google.com/search?q=${encodeURIComponent(a.q || "")}` : normalize(a.url);
    await wc.loadURL(target).catch(() => {});
    await settle(wc);
    return here();
  }
  if (action === "read") return wc.executeJavaScript(READ_JS(Math.max(500, Math.min(+a.max || 6000, 30000))));
  if (action === "click") {
    const ok = await wc.executeJavaScript(`(() => { const e = document.querySelector('[data-sa-n="l${+a.n}"]'); if (!e) return false; e.removeAttribute("target"); e.scrollIntoView({ block: "center" }); e.click(); return true; })()`);
    if (!ok) throw new Error("bu numarada bağlantı yok; önce read çalıştır");
    await settle(wc);
    return here();
  }
  if (action === "type") {
    const sel = a.n ? `[data-sa-n="i${+a.n}"]` : "textarea[name=q], input[name=q], input[type=search], input[type=text], textarea";
    if (!(await wc.executeJavaScript(TYPE_JS(sel, String(a.text || ""), !!a.enter)))) throw new Error("yazılacak kutu bulunamadı; read ile kutu numarasına bak");
    if (a.enter) await settle(wc);
    return here();
  }
  if (action === "scroll") {
    await wc.executeJavaScript(`scrollBy(0, ${+a.dy || 800})`);
    await sleep(500);
    return { ...here(), y: await wc.executeJavaScript("Math.round(scrollY)") };
  }
  if (action === "back") {
    wc.navigationHistory.goBack();
    await settle(wc);
    return here();
  }
  const meta = { title: wc.getTitle() || wc.getURL(), url: wc.getURL(), note: a.note || "", job };
  if (action === "shot") {
    const data = a.mode === "full" ? await fullPage(wc) : (await wc.capturePage()).toPNG().toString("base64");
    return { item: await post(S.origin, "/api/research/add", { kind: "png", ...meta, data }) };
  }
  if (action === "savehtml") {
    const d = await wc.executeJavaScript("({html: document.documentElement.outerHTML, text: document.body ? document.body.innerText : ''})");
    return { item: await post(S.origin, "/api/research/add", { kind: "html", ...meta, data: d.html, text: d.text }) };
  }
  if (action === "save") {
    return { item: await post(S.origin, "/api/research/add", { kind: "text", ...meta, title: a.title || meta.title, data: String(a.text || "") }) };
  }
  throw new Error(`bilinmeyen komut: ${action}`);
}

const loops = new Set();

async function agentLoop(origin) {
  loops.add(origin);
  const S = setFor(origin);
  while (loops.has(origin)) {
    let c = null;
    try {
      const r = await fetch(`${origin}/api/webagent/pull`);
      if (r.status === 200) c = await r.json();
      else if (r.status !== 204) await sleep(3000);
    } catch {
      await sleep(3000);
    }
    if (!c || !c.id) continue;
    let out;
    try {
      out = { id: c.id, ok: true, result: await agentDo(S, c.job, c.action, c.args || {}) };
    } catch (e) {
      out = { id: c.id, ok: false, error: String(e?.message || e) };
    }
    if (S === cur && win && !win.isDestroyed()) win.webContents.send("bw-cmd", { type: "agent" });
    emit(S);
    await post(origin, "/api/webagent/result", out).catch(() => {});
  }
}

async function oturumlar() {
  const r = await fetch(`${ORIGIN}/api/oturumlar`, { signal: AbortSignal.timeout(4000) });
  const d = await r.json();
  return (d.list || []).map((o) => originOf(o.url));
}

async function agentLoops() {
  agentLoop(ORIGIN);
  for (;;) {
    try {
      const want = new Set(await oturumlar());
      want.add(ORIGIN);
      for (const o of want) if (!loops.has(o)) agentLoop(o);
      for (const o of [...loops]) if (!want.has(o)) loops.delete(o);
    } catch {}
    await sleep(20000);
  }
}

async function startUrl() {
  const last = readJson("last.json", {}).url;
  if (TEST || !last || new URL(START).hash || originOf(last) === ORIGIN) return START;
  try {
    if ((await oturumlar()).includes(originOf(last))) return last;
  } catch {}
  return START;
}

async function load(url) {
  if (loading) return;
  loading = true;
  try {
    for (let i = 0; i < 240; i++) {
      if (!win || win.isDestroyed()) return;
      try {
        await win.loadURL(url);
        return;
      } catch {
        await sleep(500);
      }
    }
  } finally {
    loading = false;
  }
}

function createWindow() {
  const b = readJson("window.json", {});
  win = new BrowserWindow({ width: b.width || 1500, height: b.height || 940, x: TEST ? -4000 : b.x, y: TEST ? 40 : b.y, minWidth: 900, minHeight: 600, title: "Sosyal Stüdyo",
    backgroundColor: "#0e1116", icon: path.join(__dirname, "..", "icon.ico"), autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true } });
  if (process.platform === "win32" && process.env.STUDIO_RELAUNCH && !TEST) {
    win.setAppDetails({ appId: "SosyalStudyo", relaunchCommand: process.env.STUDIO_RELAUNCH, relaunchDisplayName: "Sosyal Stüdyo",
      appIconPath: path.join(__dirname, "..", "icon.ico") });
  }
  win.once("ready-to-show", () => {
    if (b.maximized) win.maximize();
    win.show();
  });
  const keep = () => {
    if (!win.isMaximized() && !win.isMinimized()) writeJson("window.json", { ...win.getBounds(), maximized: false });
    else writeJson("window.json", { ...readJson("window.json", {}), maximized: win.isMaximized() });
  };
  win.on("resized", keep);
  win.on("moved", keep);
  win.on("maximize", keep);
  win.on("unmaximize", keep);
  const openOutside = (url) => shell.openExternal(url).then(() => win && !win.isDestroyed() && win.minimize()).catch(() => {});
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocal(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: "#0e1116", width: 1200, height: 860 } };
    openOutside(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!isLocal(url)) {
      e.preventDefault();
      openOutside(url);
    }
  });
  win.webContents.on("did-navigate", (_e, url) => {
    if (!isLocal(url)) return;
    const S = setFor(originOf(url));
    if (S !== cur) {
      cur = S;
      shown = false;
      layout();
    }
    if (!TEST) writeJson("last.json", { url: `${S.origin}/` });
  });
  win.webContents.on("did-fail-load", (_e, code, _d, url, main) => {
    if (main && code !== -3 && isLocal(url) && !loading) setTimeout(() => load(url), 1000);
  });
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const k = (input.key || "").toLowerCase();
    if (k === "f12" || ((input.control || input.meta) && input.shift && k === "i")) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    } else if (k === "f5" || ((input.control || input.meta) && k === "r")) {
      win.webContents.reload();
      e.preventDefault();
    }
  });
  win.on("closed", () => {
    win = null;
  });
  startUrl().then(load);
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.on("window-all-closed", () => app.quit());
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setupIpc();
  createWindow();
  if (!process.env.STUDIO_DESKTOP_NOAGENT) agentLoops();
});
