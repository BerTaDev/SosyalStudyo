import { ICONS } from "/web/icons.js";

const CLAUDE_NEW = "https://claude.ai/new?q=";
const cache = new Map();
let X0 = null;
let wired = false;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ic = (name, size = 16) => `<span class="icw">${(ICONS[name] || "").replace("<svg", `<svg width="${size}" height="${size}" class="ic"`)}</span>`;

export function claudeSetupBtn(topic, label = "Claude ile kur", cls = "") {
  return `<button type="button" class="btn sm cs-btn${cls ? " " + cls : ""}" data-claude-setup="${esc(topic)}" title="Bu kurulumu Claude ile adım adım yap">${ic("bot", 13)}${esc(label)}</button>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  }
}

async function fetchTopic(topic) {
  if (cache.has(topic)) return cache.get(topic);
  const r = await fetch(`/api/claude-setup/${encodeURIComponent(topic)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  cache.set(topic, d);
  return d;
}

function overlay() {
  let o = document.getElementById("csModal");
  if (!o) {
    o = document.createElement("div");
    o.id = "csModal";
    o.className = "modal cs-modal";
    document.body.append(o);
  }
  return o;
}

export function closeClaudeSetup() {
  document.getElementById("csModal")?.remove();
}

function flash(btn, html) {
  if (!btn) return;
  btn._orig ??= btn.innerHTML;
  btn.innerHTML = html;
  btn.classList.add("cs-done");
  clearTimeout(btn._t);
  btn._t = setTimeout(() => {
    btn.innerHTML = btn._orig;
    btn.classList.remove("cs-done");
  }, 1800);
}

function body(d) {
  return `<h2>${ic("bot", 20)}<span class="grow">Claude ile kur<small>${esc(d.title)}</small></span></h2>
    <p class="cs-lead">Claude bu kurulumu sana adım adım anlatır. Aşağıdaki hazır metni yeni bir Claude sohbetine gönder; her seferinde tek adım söyler, sen "tamam" deyince devam eder.</p>
    <div class="cs-safe">${ic("shield-check", 16)}<span>Şifreni, API anahtarını ya da token'ı Claude'a yazma. Onları stüdyodaki kutulara <b>kendin</b> yapıştırırsın; metin Claude'a da bunu söylüyor.</span></div>
    <label for="csPrompt">Hazır metin</label>
    <textarea id="csPrompt" class="cs-prompt" readonly spellcheck="false" rows="9">${esc(d.prompt)}</textarea>
    <div class="cs-acts">
      <button type="button" class="btn primary" data-cs="copy">${ic("copy", 15)}Kopyala</button>
      <button type="button" class="btn" data-cs="open" title="claude.ai'de yeni bir sohbet açar; klasör yolları gönderilmez">${ic("external-link", 15)}Claude'da aç</button>
      <span class="grow"></span>
      <a class="btn ghost" href="${esc(d.guide_url)}" target="_blank" rel="noopener">${ic("file-text", 15)}Rehberi oku</a>
    </div>
    <div class="cs-code">${ic("terminal", 16)}<div class="grow"><b>Birlikte, bilgisayarında yapmak için</b>
      <span>Claude masaüstü uygulamasında <b>Code</b> sekmesini aç, klasör olarak stüdyo klasörünü seç ve metni oraya yapıştır. Claude rehberi okuyup komutları senin onayınla çalıştırabilir.</span>
      <div class="cs-path"><code title="${esc(d.studio_dir)}">${esc(d.studio_dir)}</code><button type="button" class="btn sm ghost" data-cs="path" title="Klasör yolunu kopyala">${ic("copy", 13)}</button></div></div></div>
    <div class="foot"><button type="button" class="btn" data-cs="close">Kapat</button></div>`;
}

export async function openClaudeSetup(topic) {
  const o = overlay();
  o.innerHTML = `<div class="dialog cs-dlg" role="dialog" aria-modal="true"><div class="cs-wait">${ic("loader-circle", 20).replace('class="icw"', 'class="icw spin"')}<span>Hazırlanıyor…</span></div></div>`;
  o.onclick = (e) => {
    if (e.target === o) closeClaudeSetup();
  };
  let d;
  try {
    d = await fetchTopic(topic);
  } catch (e) {
    if (!o.isConnected) return;
    o.querySelector(".dialog").innerHTML = `<h2>${ic("triangle-alert", 20)}Kurulum metni alınamadı</h2><p class="cs-lead">${esc(e.message)}</p><div class="foot"><button type="button" class="btn" data-cs="close">Kapat</button></div>`;
    o.querySelector("[data-cs=close]").onclick = closeClaudeSetup;
    return;
  }
  if (!o.isConnected) return;
  const dlg = o.querySelector(".dialog");
  dlg.innerHTML = body(d);
  const ta = dlg.querySelector("#csPrompt");
  ta.onfocus = () => ta.select();
  dlg.onclick = async (e) => {
    const b = e.target.closest("[data-cs]");
    if (!b) return;
    const a = b.dataset.cs;
    if (a === "close") return closeClaudeSetup();
    if (a === "copy") {
      const ok = await copyText(d.prompt);
      if (ok) flash(b, `${ic("check", 15)}Kopyalandı`);
      else {
        ta.focus();
        X0?.toast("Kopyalanamadı; metni seçip Ctrl+C ile kopyala", true);
      }
      return;
    }
    if (a === "path") {
      if (await copyText(d.studio_dir)) flash(b, ic("check", 13));
      return;
    }
    if (a === "open") window.open(CLAUDE_NEW + encodeURIComponent(d.web_prompt || d.prompt), "_blank", "noopener");
  };
  dlg.querySelector("[data-cs=copy]")?.focus();
}

function onClick(e) {
  const el = e.target.closest?.("[data-claude-setup]");
  if (!el || el.disabled) return;
  e.preventDefault();
  e.stopPropagation();
  openClaudeSetup(el.dataset.claudeSetup);
}

function onKey(e) {
  if (e.key !== "Escape" || !document.getElementById("csModal")) return;
  e.stopImmediatePropagation();
  e.stopPropagation();
  closeClaudeSetup();
}

export function initClaudeSetup(X) {
  X0 = X;
  if (wired) return;
  wired = true;
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
}
