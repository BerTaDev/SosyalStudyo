import { THEMES, themePrefs, setTheme } from "/web/theme.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
let X0 = null;
let H = {};

const sep = { sep: true };

async function copy(text, what = "Kopyalandı") {
  try {
    await navigator.clipboard.writeText(text);
    X0.toast(what);
  } catch {
    X0.toast("Panoya kopyalanamadı", true);
  }
}

function download(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name || "";
  document.body.append(a);
  a.click();
  a.remove();
}

function openUrl(url) {
  window.open(url, "_blank", "noopener");
}

function editableItems(el) {
  const s = el.selectionStart ?? 0;
  const e = el.selectionEnd ?? 0;
  const has = e > s;
  const ro = el.readOnly || el.disabled;
  const put = (text) => {
    el.focus();
    el.setRangeText(text, s, e, "end");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return [
    { label: "Kes", icon: "scissors", key: "Ctrl+X", off: !has || ro, run: async () => { await copy(el.value.slice(s, e), "Kesildi"); put(""); } },
    { label: "Kopyala", icon: "copy", key: "Ctrl+C", off: !has, run: () => copy(el.value.slice(s, e)) },
    { label: "Yapıştır", icon: "clipboard-paste", key: "Ctrl+V", off: ro, run: async () => {
      try {
        put(await navigator.clipboard.readText());
      } catch {
        el.focus();
        X0.toast("Yapıştırmak için Ctrl+V kullan", true);
      }
    } },
    { label: "Tümünü seç", icon: "square-check", key: "Ctrl+A", run: () => { el.focus(); el.select(); } },
  ];
}

async function captionOf(id) {
  const d = await X0.api(`/api/posts/${id}`);
  return (d.caption_full || [d.caption, d.hashtags].filter(Boolean).join("\n\n") || "").trim();
}

function postItems(id) {
  const { S } = X0;
  const p = S.posts.find((x) => x.id === id);
  if (!p) return [];
  const out = [{ head: `#${p.id} · ${p.title || "İçerik"}` }, { label: "Aç", icon: "arrow-right", run: () => H.open(id) }];
  if (p.status === "planlandi")
    out.push({ label: "Saati değiştir", icon: "calendar-clock", run: () => { S.resched = id; H.open(id); } });
  if (p.youtube?.url) out.push({ label: "YouTube'da aç", icon: "youtube", run: () => openUrl(p.youtube.url) });
  if (p.published?.permalink) out.push({ label: "Instagram'da aç", icon: "instagram", run: () => openUrl(p.published.permalink) });
  out.push(sep);
  if (p.video) out.push({ label: "Videoyu indir", icon: "download", run: () => download(`/media/${p.id}/${p.video}`, `${p.title || p.id}.mp4`) });
  if (p.video && p.subs) out.push({ label: "Altyazıyı indir (.srt)", icon: "captions", run: () => download(`/api/posts/${p.id}/altyazi.srt`, `${p.title || p.id}.srt`) });
  out.push({ label: "Açıklamayı kopyala", icon: "copy", run: async () => {
    const t = await captionOf(id);
    if (t) copy(t, "Açıklama kopyalandı");
    else X0.toast("Bu içeriğin açıklaması yok", true);
  } });
  out.push({ label: "Başlığı kopyala", icon: "type", run: () => copy(p.title || "", "Başlık kopyalandı") });
  if (p.status !== "paylasiliyor") out.push(sep, { label: "Çöp kutusuna taşı", icon: "trash-2", danger: true, run: () => H.trash(p) });
  return out;
}

function videoItems(v) {
  const { S } = X0;
  const d = S.detail;
  const out = [{ label: v.paused ? "Oynat" : "Duraklat", icon: v.paused ? "play" : "pause", key: "Boşluk", run: () => ($("#playBtn") || v).click() },
    { label: v.muted ? "Sesi aç" : "Sesi kapat", icon: v.muted ? "volume-2" : "volume-x", run: () => $("#muteBtn")?.click() }];
  if ($("#coverBtn")) out.push({ label: "Bu kareyi kapak yap", icon: "image", run: () => $("#coverBtn").click() });
  if (d?.video) out.push({ label: "Videoyu indir", icon: "download", run: () => download(`/media/${d.id}/${d.video}`, `${d.title || d.id}.mp4`) });
  if (d?.video && d.subs) out.push({ label: "Altyazıyı indir (.srt)", icon: "captions", run: () => download(`/api/posts/${d.id}/altyazi.srt`, `${d.title || d.id}.srt`) });
  return out;
}

function themeItems() {
  const p = themePrefs();
  const cur = THEMES.find((t) => t.id === p.theme)?.id || THEMES[0].id;
  return [{ label: "Tema", icon: "palette", sub: THEMES.map((t) => ({ label: t.name, dot: t.c[0], check: t.id === cur, run: () => setTheme({ theme: t.id }) })) },
    { label: p.motion === false ? "Hareketli arka planı aç" : "Hareketli arka planı durdur", icon: p.motion === false ? "sparkles" : "pause", run: () => setTheme({ motion: p.motion === false }) }];
}

function generalItems(target) {
  const { S } = X0;
  const out = [];
  if ($("#detail")?.contains(target) && $(".pane[data-fold]")) {
    out.push({ label: "Tüm bölümleri aç", icon: "chevron-down", run: () => H.foldAll(false) },
      { label: "Tüm bölümleri kapat", icon: "chevron-up", run: () => H.foldAll(true) }, sep);
  }
  out.push({ label: "Yeni içerik", icon: "plus", run: () => X0.setTab("create") });
  if (S.tab !== "calendar") out.push({ label: "Planlamaya git", icon: "calendar-range", run: () => X0.setTab("calendar") });
  out.push({ label: "Yenile", icon: "refresh-cw", key: "F5", run: () => { X0.refresh(); X0.toast("Güncellendi"); } }, sep, ...themeItems(),
    { label: "Ayarlar", icon: "settings", run: () => H.settings() });
  return out;
}

function build(e) {
  const t = e.target;
  const sel = document.activeElement?.matches?.("input, textarea") ? "" : String(getSelection() || "").trim();
  const edit = t.closest?.("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=hidden]), textarea");
  if (edit && "selectionStart" in edit && edit.selectionStart !== null) return editableItems(edit);
  const out = [];
  const push = (items) => {
    if (!items.length) return;
    if (out.length) out.push(sep);
    out.push(...items);
  };
  if (sel) push([{ label: "Seçili metni kopyala", icon: "copy", key: "Ctrl+C", run: () => copy(sel) }]);
  const chip = t.closest(".top-stat .chip");
  if (chip) push([{ label: "Ayrıntıları aç", icon: "arrow-right", run: () => chip.click() }]);
  const pid = t.closest("#postList .card[data-id]")?.dataset.id || t.closest("[data-ev]")?.dataset.ev || t.closest("a.postlink[href^='#']")?.getAttribute("href").slice(1);
  if (pid) push(postItems(pid));
  const vid = t.closest("#vid, .screen")?.closest(".phone-wrap") && $("#vid");
  if (vid && !pid) push(videoItems(vid));
  const a = t.closest("a[href]");
  const href = a?.getAttribute("href") || "";
  if (a && href && !href.startsWith("#") && !pid) push([{ label: "Bağlantıyı yeni sekmede aç", icon: "external-link", run: () => openUrl(a.href) },
    { label: "Bağlantıyı kopyala", icon: "link", run: () => copy(a.href, "Bağlantı kopyalandı") }]);
  if (!out.length || (sel && out.length === 1)) push(generalItems(t));
  return out;
}

function itemHtml(it, i) {
  const { ic, esc } = X0;
  if (it.sep) return `<div class="cx-sep"></div>`;
  if (it.head) return `<div class="cx-head">${esc(it.head)}</div>`;
  const lead = it.dot ? `<i class="cx-dot" style="background:${it.dot}"></i>` : ic(it.icon || "circle-dashed", 15);
  const inner = `${lead}<span class="grow">${esc(it.label)}</span>${it.check ? ic("check", 14) : ""}${it.key ? `<span class="cx-key">${esc(it.key)}</span>` : ""}`;
  if (it.sub)
    return `<div class="cx-it has-sub" data-i="${i}" role="menuitem" tabindex="0" aria-haspopup="true">${inner}${ic("chevron-right", 14)}
      <div class="cx-menu cx-sub" role="menu">${it.sub.map((s, j) => itemHtml(s, `${i}.${j}`)).join("")}</div></div>`;
  return `<button type="button" class="cx-it${it.danger ? " danger" : ""}" data-i="${i}" role="menuitem" ${it.off ? "disabled" : ""}>${inner}</button>`;
}

export function closeMenu() {
  const m = $("#ctxMenu");
  if (!m) return;
  m._off?.();
  m.remove();
}

function find(items, path) {
  const [a, b] = String(path).split(".").map(Number);
  return b === undefined ? items[a] : items[a]?.sub?.[b];
}

function open(items, x, y) {
  closeMenu();
  if (!items.length) return;
  const m = document.createElement("div");
  m.id = "ctxMenu";
  m.className = "cx-menu";
  m.setAttribute("role", "menu");
  m.innerHTML = items.map((it, i) => itemHtml(it, i)).join("");
  document.body.append(m);
  const w = m.offsetWidth;
  const h = m.offsetHeight;
  const left = x + w > innerWidth - 8 ? Math.max(8, x - w) : x;
  const top = y + h > innerHeight - 8 ? Math.max(8, y - h) : y;
  m.style.left = `${left}px`;
  m.style.top = `${top}px`;
  m.style.transformOrigin = `${left < x ? "right" : "left"} ${top < y ? "bottom" : "top"}`;
  if (left + w + 200 > innerWidth) m.classList.add("flip");
  requestAnimationFrame(() => m.classList.add("in"));
  m.onclick = (e) => {
    const b = e.target.closest(".cx-it");
    if (!b || b.disabled) return;
    if (b.classList.contains("has-sub") && b.querySelector(".cx-sub").contains(e.target) && b !== e.target.closest(".cx-it")) return;
    const it = find(items, b.dataset.i);
    if (it?.sub) {
      b.classList.toggle("open");
      return;
    }
    closeMenu();
    if (it?.run) Promise.resolve(it.run()).catch((err) => X0.toast(err.message || String(err), true));
  };
  m.addEventListener("contextmenu", (e) => e.preventDefault());
  const btns = () => $$(":scope > .cx-it:not(:disabled)", m);
  const key = (e) => {
    if (e.key === "Escape") return closeMenu();
    const list = btns();
    const i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[n]?.focus();
    }
    if (e.key === "Enter" && document.activeElement?.classList.contains("has-sub")) {
      e.preventDefault();
      document.activeElement.classList.toggle("open");
    }
  };
  const outside = (e) => {
    if (!m.contains(e.target)) closeMenu();
  };
  const away = () => closeMenu();
  m._off = () => {
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", key, true);
    document.removeEventListener("wheel", away, true);
    removeEventListener("resize", away);
    removeEventListener("blur", away);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("wheel", away, { capture: true, passive: true });
    addEventListener("resize", away);
    addEventListener("blur", away);
  }, 0);
}

export function initContextMenu(X, hooks) {
  X0 = X;
  H = hooks;
  document.addEventListener("contextmenu", (e) => {
    if (e.shiftKey) return;
    e.preventDefault();
    open(build(e), e.clientX, e.clientY);
  });
}
