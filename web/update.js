const $ = (s, r = document) => r.querySelector(s);
const POLL_MS = 30 * 60 * 1000;
const STATE = {
  newer: { icon: "circle-arrow-up", lv: "warn", badge: "Yeni sürüm" },
  current: { icon: "badge-check", lv: "ok", badge: "Güncel" },
  unknown: { icon: "info", lv: "", badge: "Bilinmiyor" },
};
const REASON = { no_release: "Henüz yayınlanmış bir sürüm bulunamadı.", offline: "Güncelleme bilgisine ulaşılamadı; internet bağlantını kontrol et.", error: "Güncelleme bilgisi şu an alınamadı." };

const U = { X: null, d: null, busy: false, err: null, mode: "full", fitting: false, hideT: null, self: null, selfT: null };
const ACTIVE = ["checking", "downloading", "ready", "installing"];

function rel(iso) {
  if (!iso) return "henüz kontrol edilmedi";
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return "az önce";
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  if (s < 86400) return `${Math.round(s / 3600)} saat önce`;
  return new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

const st = () => STATE[U.d?.state] || STATE.unknown;
const v = (x) => (x ? `v${String(x).replace(/^v/i, "")}` : "");
const shellUpd = () => window.studioShell?.upd;
const canSelf = () => !!U.self && U.self.phase !== "none" && (U.d?.state === "newer" || ACTIVE.includes(U.self.phase));
const loading = () => canSelf() && ["checking", "downloading"].includes(U.self.phase);

function selfSummary(d) {
  const s = U.self;
  if (s.phase === "checking") return "Güncelleme hazırlanıyor…";
  if (s.phase === "downloading") return `${v(s.version || d?.latest)} indiriliyor: %${s.percent}`;
  if (s.phase === "ready") return `${v(s.version)} indirildi. Kurulum için stüdyo kapanıp birkaç saniye içinde yeniden açılacak; verilerin yerinde kalır.`;
  if (s.phase === "installing") return "Güncelleniyor; stüdyo birazdan yeniden açılacak.";
  if (s.phase === "error") return `Güncelleme indirilemedi: ${s.error}`;
  return `${v(d?.latest)} yayınlandı. Güncelle'ye bas; yeni sürüm uygulamanın içinden indirilip kurulur.`;
}

function summary(d) {
  if (canSelf()) return selfSummary(d);
  if (!d) return U.err || "Sürüm bilgisi alınıyor…";
  if (d.state === "newer") return `${v(d.latest)} yayınlandı. İndirme sayfasından yeni sürümü indirip kur.`;
  if (d.state === "current") return "En son sürümü kullanıyorsun.";
  return REASON[d.reason] || REASON.error;
}

function labelFor(mode) {
  const d = U.d;
  if (!d) return mode === "mini" ? "" : "v…";
  if (mode === "mini") return "";
  if (loading()) return mode === "full" ? `İndiriliyor %${U.self.percent}` : `%${U.self.percent}`;
  if (canSelf() && U.self.phase === "ready") return mode === "full" ? "Güncellemeye hazır" : v(U.self.version);
  if (d.state === "newer") return mode === "full" ? `Yeni sürüm ${v(d.latest)}` : v(d.latest);
  if (d.state === "current" && mode === "full") return `${v(d.current)} · Güncel`;
  return v(d.current);
}

function drawBtn() {
  const b = $("#updBtn");
  if (!b) return;
  const { ic } = U.X;
  const s = st();
  const text = labelFor(U.mode);
  b.className = `upd-btn ${U.d?.state || "unknown"} ${U.mode}`;
  b.innerHTML = `${ic(U.busy ? "loader-circle" : s.icon, 13, U.busy ? "spin" : "")}${text ? `<span class="upd-t">${U.X.esc(text)}</span>` : ""}`;
  b.setAttribute("aria-label", U.d ? `Sosyal Stüdyo ${v(U.d.current)} · ${s.badge}` : "Sürüm");
}

function overflowing() {
  const r = $(".top-right");
  return !!r && r.scrollWidth > r.clientWidth + 1;
}

function fit() {
  if (U.fitting || !$("#updBtn")) return;
  U.fitting = true;
  const before = U.mode;
  for (const m of ["full", "short", "mini"]) {
    U.mode = m;
    drawBtn();
    if (!overflowing()) break;
  }
  U.fitting = false;
  if (before !== U.mode && $("#updPop")) drawPop();
}

let fitQueued = false;
function queueFit() {
  if (fitQueued) return;
  fitQueued = true;
  queueMicrotask(() => {
    fitQueued = false;
    fit();
  });
}

function mainBtn(d, sm) {
  const { ic, esc } = U.X;
  const z = sm ? 13 : 15;
  const cls = `btn ${sm ? "sm " : ""}`;
  if (canSelf()) {
    const s = U.self;
    if (loading()) return `<button type="button" class="${cls}primary" disabled>${ic("loader-circle", z, "spin")}İndiriliyor %${s.percent}</button>`;
    if (s.phase === "ready") return `<button type="button" class="${cls}primary" data-upd="install">${ic("rotate-cw", z)}Yeniden başlat ve güncelle</button>`;
    if (s.phase === "installing") return `<button type="button" class="${cls}primary" disabled>${ic("loader-circle", z, "spin")}Güncelleniyor</button>`;
    return `<button type="button" class="${cls}primary" data-upd="self">${ic("download", z)}${s.phase === "error" ? "Tekrar dene" : `${esc(v(d?.latest))} sürümüne güncelle`}</button>`;
  }
  const label = d?.state === "newer" ? (sm ? `${esc(v(d.latest))} indir` : `${esc(v(d.latest))} sürümünü indir`) : "İndirme sayfası";
  return `<button type="button" class="${cls}${d?.state === "newer" ? "primary" : ""}" data-upd="page">${ic("download", z)}${label}</button>`;
}

const bar = () => (loading() ? `<div class="upd-bar"><i style="width:${U.self.percent}%"></i></div>` : "");

function popHtml() {
  const { ic, esc } = U.X;
  const d = U.d;
  const s = st();
  return `<div class="stt-head"><span class="stt-ic ${s.lv}">${ic(s.icon, 15)}</span><b>Sosyal Stüdyo ${esc(v(d?.current) || "")}</b><span class="sp-lv ${s.lv}">${s.badge}</span></div>
    <div class="stt-body"><div>${esc(summary(d))}</div>${bar()}<div>Son kontrol: ${esc(rel(d?.checked))}</div></div>
    <div class="upd-acts">${mainBtn(d, true)}
      <button type="button" class="btn sm" data-upd="check" ${U.busy ? "disabled" : ""}>${ic("refresh-cw", 13, U.busy ? "spin" : "")}Şimdi kontrol et</button></div>`;
}

function drawPop() {
  const p = $("#updPop");
  const b = $("#updBtn");
  if (!p || !b) return;
  p.innerHTML = popHtml();
  const r = b.getBoundingClientRect();
  const w = p.offsetWidth;
  const left = Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2));
  p.style.top = `${r.bottom + 10}px`;
  p.style.left = `${left}px`;
  p.style.setProperty("--ax", `${Math.round(r.left + r.width / 2 - left)}px`);
}

function showPop() {
  clearTimeout(U.hideT);
  let p = $("#updPop");
  if (!p) {
    p = document.createElement("div");
    p.id = "updPop";
    p.onmouseenter = () => clearTimeout(U.hideT);
    p.onmouseleave = hidePop;
    p.onclick = actions;
    document.body.append(p);
    drawPop();
    p.classList.add("in");
  } else drawPop();
}

function hidePop(now) {
  clearTimeout(U.hideT);
  const go = () => $("#updPop")?.remove();
  if (now === true) go();
  else U.hideT = setTimeout(go, 220);
}

function openPage() {
  window.open(U.d?.page || "https://www.bertadev.com/sosyal-studyo#indir", "_blank", "noopener");
}

async function actions(e) {
  const b = e.target.closest("[data-upd]");
  if (!b || b.disabled) return;
  if (b.dataset.upd === "page") return openPage();
  if (b.dataset.upd === "self") return startSelf();
  if (b.dataset.upd === "install") return installSelf();
  if (b.dataset.upd === "check") {
    await checkNow();
    const d = U.d;
    if (d && !U.err) U.X.toast(d.state === "newer" ? `Yeni sürüm var: ${v(d.latest)}` : d.state === "current" ? "Sosyal Stüdyo güncel" : summary(d), d.state === "unknown");
  }
}

function redraw() {
  drawBtn();
  queueFit();
  if ($("#updPop")) drawPop();
  const f = $("#sSurumBody");
  if (f) f.innerHTML = settingsBody();
  const tab = $('#stNav [data-st="sSurum"]');
  if (tab) {
    const sm = $("small", tab);
    const dot = $(".st-dot", tab);
    if (sm) sm.textContent = tabSub();
    if (dot) dot.className = `st-dot ${dotCls()}`;
  }
}

async function load(fresh = false) {
  if (U.busy) return;
  U.busy = true;
  if (fresh) redraw();
  try {
    U.d = await U.X.api(`/api/update${fresh ? "?fresh=1" : ""}`);
    U.err = null;
  } catch (e) {
    U.err = e.message;
    if (fresh) U.X.toast(`Güncelleme kontrol edilemedi: ${e.message}`, true);
  }
  U.busy = false;
  redraw();
}

const checkNow = () => load(true);

function selfDone() {
  const s = U.self;
  if (s.phase === "ready") U.X.toast(`${v(s.version)} indirildi; kurmak için "Yeniden başlat ve güncelle"ye bas`);
  else if (s.phase === "error") U.X.toast(`Güncelleme indirilemedi: ${s.error}`, true);
  else if (s.phase === "none") U.X.toast("Bu sürüm uygulamanın içinden kurulamıyor; indirme sayfasından indir", true);
}

function pollSelf() {
  clearTimeout(U.selfT);
  U.selfT = setTimeout(async () => {
    try {
      U.self = await shellUpd().state();
    } catch {
      return;
    }
    redraw();
    if (["checking", "downloading"].includes(U.self.phase)) pollSelf();
    else selfDone();
  }, 700);
}

async function probeSelf() {
  try {
    U.self = await shellUpd().state();
  } catch {
    U.self = null;
    return;
  }
  redraw();
  if (["checking", "downloading"].includes(U.self.phase)) pollSelf();
}

async function startSelf() {
  try {
    U.self = await shellUpd().download();
  } catch (e) {
    return U.X.toast(`Güncelleme başlatılamadı: ${e.message}`, true);
  }
  redraw();
  if (["checking", "downloading"].includes(U.self.phase)) pollSelf();
  else selfDone();
}

async function installSelf() {
  let r;
  try {
    r = await shellUpd().install();
  } catch (e) {
    r = { ok: false, reason: e.message };
  }
  if (!r?.ok) return U.X.toast(r?.reason || "Güncelleme kurulamadı", true);
  U.self = { ...U.self, phase: "installing" };
  redraw();
  U.X.toast("Stüdyo güncelleniyor; birkaç saniye içinde yeniden açılacak");
}

export function initUpdate(X) {
  U.X = X;
  const right = $(".top-right");
  if (!right || $("#updBtn")) return;
  const b = document.createElement("button");
  b.id = "updBtn";
  b.type = "button";
  b.onclick = () => {
    if (canSelf()) return showPop();
    hidePop(true);
    openPage();
  };
  b.onmouseenter = showPop;
  b.onmouseleave = hidePop;
  b.onfocus = showPop;
  b.onblur = (e) => {
    if (!$("#updPop")?.contains(e.relatedTarget)) hidePop();
  };
  right.prepend(b);
  drawBtn();
  new ResizeObserver(queueFit).observe($(".top"));
  const watch = new MutationObserver(queueFit);
  for (const el of [$(".top-stat"), $("#liveBtn"), $(".tabs")]) if (el) watch.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  load();
  probeSelf();
  setInterval(() => load(), POLL_MS);
}

const tabSub = () => (U.d ? `${v(U.d.current)} · ${st().badge}` : "Sürüm bilgisi");
const dotCls = () => ({ current: "ok", newer: "warn" })[U.d?.state] || "";

export function updateSettingsTab() {
  return ["sSurum", "Sürüm", "badge-check", tabSub(), `<i class="st-dot ${dotCls()}"></i>`];
}

function settingsBody() {
  const { ic, esc } = U.X;
  const d = U.d;
  const s = st();
  return `<div class="upd-card ${d?.state || "unknown"}"><span class="upd-cic">${ic(s.icon, 20)}</span>
      <div class="grow"><b>Sosyal Stüdyo ${esc(v(d?.current) || "")}</b><span>${esc(summary(d))}</span>${bar()}</div><span class="sp-lv ${s.lv}">${s.badge}</span></div>
    <div class="row wrap upd-row">
      ${mainBtn(d, false)}
      <button type="button" class="btn" data-upd="check" ${U.busy ? "disabled" : ""}>${ic("refresh-cw", 15, U.busy ? "spin" : "")}Şimdi kontrol et</button>
      ${d?.release ? `<a class="btn ghost" href="${esc(d.release)}" target="_blank" rel="noopener">${ic("file-text", 15)}Sürüm notları</a>` : ""}
      ${canSelf() ? `<button type="button" class="btn ghost" data-upd="page">${ic("external-link", 15)}İndirme sayfası</button>` : ""}</div>
    <div class="sm muted upd-note">Son kontrol: ${esc(rel(d?.checked))}. Stüdyo açıkken yeni sürümü birkaç saatte bir kendiliğinden kontrol eder.</div>`;
}

export function updateSettingsHtml() {
  return `<fieldset id="sSurum"><legend>Sürüm</legend><div id="sSurumBody">${U.X ? settingsBody() : ""}</div></fieldset>`;
}

export function bindUpdateSettings(X, m) {
  const box = $("#sSurumBody", m);
  if (!box) return;
  box.onclick = X.guard(actions);
}
