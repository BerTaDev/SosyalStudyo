import { ago as agoLong } from "/web/views.js";
import { claudeSetupBtn } from "/web/claudesetup.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const MB = 1048576;
const GB = 1073741824;
const DEF_LIMITS = { requests: 100000, kv_reads: 100000, kv_writes: 1000, kv_deletes: 1000, kv_lists: 1000, storage: GB };
const USAGE_ROWS = [["requests", "İstekler"], ["kv_reads", "KV okuma"], ["kv_writes", "KV yazma"], ["kv_deletes", "KV silme"], ["kv_lists", "KV listeleme"]];
const STAGES = [["Yükleniyor", "cloud-upload"], ["Bulutta", "cloud-check"], ["Hazırlanıyor", "clapperboard"], ["Yayınlanıyor", "send"], ["Yayında", "circle-check"]];
const STAGE = { uploading: 0, ready: 1, preparing: 2, publishing: 3, published: 4 };
const ORDER = { uploading: 0, publishing: 1, preparing: 2, error: 3, ready: 4 };
const BUSY = new Set(["uploading", "preparing", "publishing"]);
const DONE = new Set(["published", "canceled"]);
const COVER = new Set(["uploading", "ready", "preparing", "publishing"]);
const POST_ST = { sirada: "Sırada", uretimde: "Üretimde", inceleme: "İncelemede", planlandi: "Planlandı", paylasiliyor: "Paylaşılıyor", paylasildi: "Paylaşıldı", hata: "Hata" };
const PHASE = { compress: "Instagram kalitesinde küçültülüyor…", queued: "Sırada, birazdan başlayacak", wait: "Sırada, birazdan başlayacak", hash: "Video kontrol ediliyor…", prepare: "Hazırlanıyor…", start: "Başlatılıyor…", finalize: "Bulutta doğrulanıyor…", verify: "Bulutta doğrulanıyor…", retry: "Bağlantı koptu, yeniden deneniyor…" };
const REASON = { kind: "Bu tür şimdilik bilgisayardan paylaşılır", image: "Fotoğraf · bilgisayardan paylaşılır", carousel: "Kaydırmalı gönderi · bilgisayardan paylaşılır", story: "Hikâye · bilgisayardan paylaşılır", before_connect: "Bulut bağlanmadan önce planlandı", disabled: "Bulut yayın kapalı olduğu için bilgisayarda", too_big: "Video bulut için çok büyük", no_space: "Bulutta yer yok", upload_failed: "Yükleme başarısız oldu", canceled: "Buluttan kaldırıldı" };
const EV_IC = { error: ["triangle-alert", "bad"], warn: ["triangle-alert", "warn"], published: ["send", "ok"], publish: ["send", "ok"], ok: ["circle-check", "ok"], upload: ["cloud-upload", "blue"], uploaded: ["cloud-check", "blue"], ready: ["cloud-check", "blue"], sync: ["refresh-cw", ""], deploy: ["server", "blue"], connect: ["plug", "blue"], cancel: ["cloud-off", ""], token: ["key-round", ""], panel: ["smartphone", "blue"] };
const DOW = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const DOW_LONG = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MON = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const SIGNUP_URL = "https://dash.cloudflare.com/sign-up";
const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";

const C = { X: null, data: null, err: null, loading: null, timer: null, btimer: null, tick: null, html: {}, open: new Set(), ask: null, chipSig: null, wired: false,
  rp: { mode: "", err: "", field: "", busy: "", show: false, copied: false, big: false }, qr: null, qrLoading: null };
const PW_MIN = 6;

const p2 = (n) => String(n).padStart(2, "0");
const fx = (n, max = 1) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: max });
const num = (n) => Number(n || 0).toLocaleString("tr-TR");
const lvl = (p) => (p >= 90 ? "bad" : p >= 70 ? "warn" : "ok");
const pct = (a, b) => (b ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
const pctTxt = (p) => (p > 0 && p < 1 ? "<1" : fx(p, p < 10 ? 1 : 0));
const sod = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate());
const hm = (t) => `${p2(t.getHours())}:${p2(t.getMinutes())}`;

function size(b) {
  b = +b || 0;
  if (b >= GB) return `${fx(b / GB, 2)} GB`;
  if (b >= 100 * MB) return `${fx(b / MB, 0)} MB`;
  if (b >= MB / 10 || !b) return `${fx(b / MB, 1)} MB`;
  return `${fx(b / 1024, 0)} KB`;
}
const speed = (bps) => (bps >= MB / 10 ? `${fx(bps / MB, 1)} MB/sn` : `${fx((bps || 0) / 1024, 0)} KB/sn`);

function dur(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return `${s} sn`;
  if (s < 3600) return `${Math.floor(s / 60)} dk ${p2(s % 60)} sn`;
  return `${Math.floor(s / 3600)} sa ${p2(Math.floor((s % 3600) / 60))} dk`;
}

function left(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} gün ${h} sa`;
  if (h) return `${h} sa ${p2(m)} dk ${p2(s % 60)} sn`;
  return `${m} dk ${p2(s % 60)} sn`;
}

function bigClock(ms, due) {
  const seg = (v, u) => `<b>${p2(v)}</b><i>${u}</i>`;
  if (!(ms >= 1000)) {
    const t = due || "zamanı geldi";
    return `<span class="cv-due">${t.charAt(0).toLocaleUpperCase("tr-TR") + t.slice(1)}</span>`;
  }
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `<b>${d}</b><i>gün</i>${seg(h, "sa")}${seg(m, "dk")}`;
  return `${h ? seg(h, "sa") : ""}${seg(m, "dk")}${seg(s % 60, "sn")}`;
}

function since(iso) {
  if (!iso) return "—";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!isFinite(s)) return "—";
  if (s < 5) return "şimdi";
  if (s < 60) return `${Math.floor(s)} sn önce`;
  return agoLong(iso);
}

function whenText(iso) {
  if (!iso) return "—";
  const t = new Date(iso);
  if (isNaN(t)) return "—";
  const diff = Math.round((sod(t) - sod(new Date())) / 864e5);
  const day = diff === 0 ? "Bugün" : diff === 1 ? "Yarın" : diff === -1 ? "Dün" : diff > 1 && diff < 7 ? DOW_LONG[t.getDay()] : `${t.getDate()} ${MON[t.getMonth()]} ${DOW[t.getDay()]}`;
  return `${day} ${hm(t)}`;
}
const fullTime = (iso) => (iso ? new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

const norm = (d) => (d && d.connecting && !d.connecting.error && (d.connecting.done || d.connecting.running === false) ? { ...d, connecting: null } : d);

function deployWatch(X, d) {
  const cn = d?.connecting;
  if (cn?.running && cn.redeploy && !C.rd) C.rd = { from: cn.from_version ?? d.version };
  if (!C.rd || cn?.running) return;
  const from = C.rd.from;
  C.rd = null;
  if (cn?.error) {
    X.toast(`Servis güncellenemedi: ${cn.error}`, true);
    return;
  }
  const v = cn?.version ?? d?.version;
  if (!v) return;
  X.toast(from && v !== from ? `Servis güncellendi: sürüm ${v}` : `Servis yeniden kuruldu, zaten güncel: sürüm ${v}`);
}

async function redeployNow(X) {
  const d = C.data || {};
  C.rd = { from: d.version };
  const r = await X.api("/api/cloud/redeploy", {});
  if (r?.connecting?.from_version != null) C.rd.from = r.connecting.from_version;
  C.data = norm(r);
  deployWatch(X, r);
}

function load(X) {
  if (!C.loading)
    C.loading = X.api("/api/cloud")
      .then((d) => {
        deployWatch(X, d);
        C.data = norm(d);
        C.err = null;
      })
      .catch((e) => {
        C.err = e.message;
      })
      .finally(() => {
        C.loading = null;
      });
  return C.loading;
}

const jobOf = (pid) => (C.data?.jobs || []).find((j) => j.pid === pid);
const postOf = (X, pid) => (X.S.posts || []).find((p) => p.id === pid);
const thumbOf = (X, pid, url) => {
  if (url) return url;
  const p = postOf(X, pid);
  return p?.has_thumb ? `/media/${p.id}/thumb.jpg?v=${encodeURIComponent(p.updated)}` : "";
};

function startTick() {
  if (C.tick) return;
  C.tick = setInterval(() => {
    if (!tick()) {
      clearInterval(C.tick);
      C.tick = null;
    }
  }, 1000);
}

function tick() {
  const now = Date.now();
  let n = 0;
  for (const el of $$("[data-cd]")) {
    n++;
    const ms = Date.parse(el.dataset.cd) - now;
    const v = ms >= 1000 ? `${left(ms)} sonra` : el.getAttribute("data-cdz") || "zamanı geldi";
    if (el.textContent !== v) el.textContent = v;
    el.classList.toggle("due", !(ms >= 1000));
  }
  for (const el of $$("[data-cdbig]")) {
    n++;
    const v = bigClock(Date.parse(el.dataset.cdbig) - now, el.getAttribute("data-cdz"));
    if (el.innerHTML !== v) el.innerHTML = v;
  }
  for (const el of $$("[data-ago]")) {
    n++;
    const v = since(el.dataset.ago);
    if (el.textContent !== v) el.textContent = v;
  }
  return n;
}

// ---------- top-bar chip ----------

export function renderCloudChip(X, c) {
  C.X = X;
  X.S.cloud = c || null;
  wire(X);
  const el = $("#cloudChip");
  if (!el) return;
  const sig = JSON.stringify(c || null);
  if (C.chipSig === sig) return;
  C.chipSig = sig;
  const { ic } = X;
  const sp = c?.storage_pct != null ? ` · depolama %${pctTxt(+c.storage_pct)}` : "";
  let cls = "";
  let icon = "cloud-off";
  let tail = "";
  let title = "Bulut yayın kurulmadı · bilgisayar kapalıyken paylaşmak için tıkla";
  if (c?.configured) {
    icon = "cloud";
    if (!c.enabled) {
      cls = "warn";
      title = `Bulut yayın kapalı${sp}`;
    } else if (c.ok === false) {
      cls = "bad";
      icon = "cloud-alert";
      title = `Buluta ulaşılamıyor${sp}`;
    } else if (c.errors) {
      cls = "bad";
      title = `${c.errors} bulut işinde hata${sp}`;
    } else {
      cls = "ok";
      title = `Bulut yayın bağlı · PC kapalıyken de paylaşılır${sp}`;
    }
    if (c.uploading) {
      icon = "loader-circle";
      tail = `<b class="cc-n" title="Yükleniyor">${c.uploading}</b>`;
      title = `${c.uploading} video buluta yükleniyor · ${title}`;
    } else if (c.errors) tail = `<b class="cc-n bad">${c.errors}</b>`;
  }
  el.className = `chip cloud-chip ${cls}`;
  el.innerHTML = `${ic(icon, 14, c?.uploading ? "spin" : "")}<span class="cc-t">Bulut</span>${tail}${c?.configured ? `<span class="dot"></span>` : ""}`;
  el.title = title;
}

export function openCloud(X) {
  X.S.planMode = "cloud";
  X.setTab("calendar");
}

export function planModeSeg(X, mode) {
  const { ic } = X;
  return `<div class="seg sm cv-mode"><button type="button" data-plmode="cal" class="${mode === "cal" ? "active" : ""}">${ic("calendar-range", 13)}Takvim</button><button type="button" data-plmode="cloud" class="${mode === "cloud" ? "active" : ""}">${ic("cloud", 13)}Bulut</button></div>`;
}

// ---------- Bulut view ----------

export function renderCloudView(X, el, force = false) {
  C.X = X;
  if (force || !$(".cv", el)) {
    C.html = {};
    el.innerHTML = `<div class="cv"><div class="cv-head" data-sec="head"></div><div class="cv-scroll"><div data-sec="banners"></div><div data-sec="hero"></div><div data-sec="meters"></div><div class="cv-grid"><div class="cv-mainc" data-sec="jobs"></div><aside class="cv-side"><div data-sec="remote"></div><div data-sec="how"></div><div data-sec="side"></div></aside></div></div></div>`;
    bindView(X, $(".cv", el));
    paint(X);
  }
  if (!C.timer) loop(X);
}

function visible(X) {
  const el = $("#calendarView");
  return X.S.tab === "calendar" && X.S.planMode === "cloud" && el && !el.classList.contains("hidden") && $(".cv", el);
}

function fast() {
  const d = C.data;
  return !!d && (!!d.connecting || (d.jobs || []).some((j) => BUSY.has(j.status) || j.upload));
}

function loop(X) {
  clearTimeout(C.timer);
  const step = async () => {
    if (!visible(X)) {
      C.timer = null;
      return;
    }
    await load(X);
    if (visible(X)) paint(X);
    C.timer = setTimeout(step, fast() ? 1000 : 4000);
  };
  C.timer = setTimeout(step, 0);
}

async function refreshNow(X) {
  await load(X);
  paint(X);
}

function setSec(root, name, html) {
  if (C.html[name] === html) return;
  C.html[name] = html;
  const el = $(`[data-sec="${name}"]`, root);
  if (!el) return;
  const keep = $$("input[data-pw]", el).map((i) => [i.dataset.pw, i.value]);
  const act = document.activeElement;
  const foc = act && el.contains(act) && act.dataset?.pw ? [act.dataset.pw, act.selectionStart, act.selectionEnd] : null;
  el.innerHTML = html;
  for (const [k, v] of keep) {
    const i = $(`input[data-pw="${k}"]`, el);
    if (i && v && !i.value) i.value = v;
  }
  if (foc) {
    const i = $(`input[data-pw="${foc[0]}"]`, el);
    if (i && !i.disabled) {
      i.focus();
      try {
        i.setSelectionRange(foc[1], foc[2]);
      } catch {}
    }
  }
}

function paint(X) {
  const root = $("#calendarView .cv");
  if (!root) return;
  const d = C.data;
  const sc = $(".cv-scroll", root);
  const top = sc.scrollTop;
  setSec(root, "head", headHtml(X, d));
  setSec(root, "banners", bannersHtml(X, d));
  setSec(root, "hero", heroHtml(X, d));
  setSec(root, "meters", metersHtml(X, d));
  setSec(root, "jobs", jobsHtml(X, d));
  setSec(root, "remote", remoteHtml(X, d));
  setSec(root, "how", howHtml(X, d));
  setSec(root, "side", sideHtml(X, d));
  rpCheck(root);
  patch(root);
  tick();
  sc.scrollTop = top;
  startTick();
}

function patch(root) {
  for (const j of C.data?.jobs || []) {
    const u = $(`[data-up="${j.pid}"]`, root);
    if (u) fillUp(u, j.upload);
  }
}

function upPct(up) {
  if (!up) return 0;
  if (up.total) return pct(up.sent || 0, up.total);
  return Math.max(0, Math.min(100, +up.pct || 0));
}

function fillUp(el, up) {
  const p = upPct(up);
  const bar = $(".cv-meter i", el);
  if (bar) bar.style.width = `${p}%`;
  const set = (s, v) => {
    const x = $(s, el);
    if (x && x.textContent !== v) x.textContent = v;
  };
  set(".cv-pct", `%${fx(p, p < 10 ? 1 : 0)}`);
  set(".cv-mb", up?.total ? `${fx((up.sent || 0) / MB, 1)} / ${fx(up.total / MB, 1)} MB` : "");
  set(".cv-spd", up?.speed ? speed(up.speed) : "");
  set(".cv-eta", p >= 100 ? "tamamlanıyor…" : up?.eta != null && up?.speed ? `~${dur(Math.max(1, up.eta))} kaldı` : up ? "" : "başlıyor…");
  set(".cv-ph", PHASE[up?.phase] || "");
}

function stateOf(d) {
  if (!d) return { cls: "", icon: "cloud", text: C.err ? "Durum alınamadı" : "Durum alınıyor…" };
  if (d.connecting && !d.connecting.error) return { cls: "run", icon: "loader-circle", spin: true, text: d.configured ? "Güncelleniyor…" : "Kuruluyor…" };
  if (!d.configured) return { cls: "off", icon: "cloud-off", text: "Bağlı değil" };
  if (!d.enabled) return { cls: "warn", icon: "cloud", text: "Bağlı · kapalı" };
  if (d.status?.ok === false) return { cls: "bad", icon: "cloud-alert", text: "Ulaşılamıyor" };
  return { cls: "ok", icon: "cloud-check", text: "Bağlı · çalışıyor" };
}

const actBtn = (X, a, label, icon, cls = "", extra = "") => `<button type="button" class="btn sm ${cls}" data-cv="${a}" ${extra}>${X.ic(icon, 13)}${label}</button>`;

const cloudCount = (d) => (d?.jobs || []).filter((j) => !DONE.has(j.status)).length;

function offText(d) {
  const n = cloudCount(d);
  return n ? `Buluttaki ${n} video silinir; planlı paylaşımlar bu bilgisayardan yapılır` : "Bulutta bekleyen video yok; planlı paylaşımlar bu bilgisayardan yapılır";
}

const OFF_NOTE = "Yeniden açtığında saatine 3 dakikadan fazla olan Reels videoları kendiliğinden tekrar yüklenir.";

function confirmOff(X, done) {
  const d = C.data || {};
  X.confirm(`${X.ic("cloud-off", 20)}Bulut yayın kapatılsın mı?`, `<p style="margin:0 0 8px"><b>${X.esc(offText(d))}.</b></p><p class="sm muted" style="margin:0">${OFF_NOTE}</p>`, "Kapat", X.guard(async () => {
    await X.api("/api/cloud/enable", { on: false });
    X.toast("Bulut yayın kapatıldı; planlı paylaşımlar bu bilgisayardan yapılacak");
    await done?.();
  }));
}

function headHtml(X, d) {
  const { ic, esc } = X;
  const st = stateOf(d);
  const meta = [];
  if (d?.configured) {
    const host = (d.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (host) meta.push(`<a class="cv-url" href="${esc(d.url)}" target="_blank" rel="noopener" title="Servis adresi: ${esc(d.url)}">${ic("server", 12)}<span>${esc(host)}</span></a>`);
    if (d.status?.ok && d.status.latency_ms != null) meta.push(`<span title="Son bağlantı kontrolü">${ic("activity", 12)}<b>${num(d.status.latency_ms)} ms</b></span>`);
    meta.push(`<span title="Buluttaki durumun stüdyoya son alındığı an">${ic("refresh-cw", 12)}Eşitleme <b data-ago="${esc(d.last_sync || "")}"></b></span>`);
    if (d.ig) meta.push(`<span title="${d.ig.configured ? `Instagram anahtarı bulutta${d.ig.refreshed ? " · son yenileme " + esc(fullTime(d.ig.refreshed)) : ""}` : "Instagram anahtarı bulutta yok"}" class="${d.ig.configured ? "" : "warnc"}">${ic("instagram", 12)}${d.ig.configured ? "Anahtar bulutta" : "Anahtar yok"}</span>`);
    if (d.version) meta.push(`<span class="badge" title="${d.update_available ? `Yeni sürüm hazır: ${esc(d.latest_version)}` : `Güncel · sürüm ${esc(d.version)}`}">v${esc(d.version)}</span>`);
  }
  const acts = d?.configured
    ? `${actBtn(X, "sync", "Şimdi eşitle", "refresh-cw", "", 'title="Buluttaki durumu şimdi al"')}
       <button type="button" class="cv-sw ${d.enabled ? "on" : ""}" data-cv="enable" role="switch" aria-checked="${d.enabled ? "true" : "false"}" title="${d.enabled ? `Kapatırsan: ${offText(d)}` : "Açınca planlanan Reels videoları buluta yüklenir"}"><i></i><span>${d.enabled ? "Açık" : "Kapalı"}</span></button>`
    : d && !d.connecting ? actBtn(X, "connect", "Bağlan", "plug", "primary") : "";
  return `${planModeSeg(X, "cloud")}
    <div class="cv-conn ${st.cls}"><span class="cv-conn-ic">${ic(st.icon, 20, st.spin ? "spin" : "")}</span><div class="cv-conn-t"><b>Bulut yayın</b><span>${st.text}</span></div></div>
    ${meta.length ? `<div class="cv-meta">${meta.join("")}</div>` : ""}
    <span class="grow"></span>
    <div class="cv-acts">${acts}<button type="button" class="btn icon sm ghost" data-cv="settings" title="Bulut ayarları">${ic("settings", 15)}</button></div>`;
}

function banner(X, cls, icon, title, text, action = "", spin = false) {
  return `<div class="cv-banner ${cls}"><span class="cv-bi">${X.ic(icon, 18, spin ? "spin" : "")}</span><div class="grow"><b>${title}</b><span>${text}</span></div>${action}</div>`;
}

function stepsInline(X, steps) {
  const { ic, esc } = X;
  return `<span class="cv-stin">${steps.map((s) => `<i class="${esc(s.state)}" title="${esc(s.label)}${s.detail ? " · " + esc(s.detail) : ""}">${ic(s.state === "ok" ? "check" : s.state === "error" ? "x" : s.state === "run" ? "loader-circle" : "circle-dashed", 11, s.state === "run" ? "spin" : "")}${esc(s.label)}</i>`).join("")}</span>`;
}

function bannersHtml(X, d) {
  const { esc } = X;
  if (!d) return C.err ? banner(X, "bad", "unplug", "Bulut bilgisi alınamadı", esc(C.err), actBtn(X, "reload", "Yeniden dene", "refresh-cw")) : `<div class="cv-loading">${X.ic("loader-circle", 22, "spin")}</div>`;
  const out = [];
  const cn = d.connecting;
  if (cn) {
    const steps = cn.steps || [];
    const ok = steps.filter((s) => s.state === "ok").length;
    const what = d.configured ? "Güncelleme" : "Kurulum";
    out.push(cn.error
      ? banner(X, "bad", "circle-x", `${what} tamamlanamadı`, esc(cn.error), d.configured ? actBtn(X, "redeploy", "Tekrar dene", "refresh-cw") : actBtn(X, "connect", "Tekrar dene", "refresh-cw"))
      : banner(X, "info", "loader-circle", `${what} sürüyor${steps.length ? ` · ${ok}/${steps.length}` : ""}`, steps.length ? stepsInline(X, steps) : "Başlatılıyor…", d.configured ? "" : actBtn(X, "connect", "Ayrıntılar", "external-link"), true));
  } else if (d.accounts_choice?.length) out.push(banner(X, "warn", "users", "Cloudflare hesabını seç", "Anahtarın birden fazla hesaba erişebiliyor; kurulumun hangi hesaba yapılacağını seçmen gerekiyor.", actBtn(X, "connect", "Hesap seç", "chevron-right")));
  if (d.configured) {
    if (d.status?.ok === false) out.push(banner(X, "bad", "cloud-alert", "Stüdyo buluta ulaşamıyor", `${esc(d.status.error || "Bağlantı hatası")}. İnternet bağlantını kontrol et. Sorun bu bilgisayardaysa servis Cloudflare'de çalışmaya devam eder ve planlı paylaşımlar yine saatinde yapılır.`, actBtn(X, "sync", "Yeniden dene", "refresh-cw")));
    if (!d.enabled) out.push(banner(X, "warn", "circle-pause", "Bulut yayın kapalı", "Yeni planlanan videolar buluta yüklenmez; paylaşım saatinde stüdyonun açık olması gerekir.", actBtn(X, "enable", "Aç", "power")));
    if (d.ig && !d.ig.configured) out.push(banner(X, "warn", "instagram", "Instagram anahtarı bulutta yok", "Bulut, Instagram'da paylaşabilmek için anahtara ihtiyaç duyar. Instagram'ı Ayarlar'dan bağla; anahtar buluta kendiliğinden gönderilir.", actBtn(X, "igset", "Ayarlar", "settings")));
    if (d.update_available && !cn) out.push(banner(X, "info", "rocket", `Servisin yeni sürümü hazır${d.latest_version ? ` (v${esc(d.latest_version)})` : ""}`, "Güncelleme birkaç saniye sürer; buluttaki videolar ve planlar korunur.", actBtn(X, "redeploy", "Güncelle", "refresh-cw", "primary")));
  }
  return out.join("");
}

function flowHtml(X, small = false) {
  const { ic } = X;
  return `<div class="cv-flow ${small ? "sm" : ""}">
    <div class="cv-fn"><span>${ic("monitor", small ? 16 : 20)}</span><b>Stüdyo</b><i>Planlayınca videoyu yükler</i></div>
    <div class="cv-fa"><i></i></div>
    <div class="cv-fn cl"><span>${ic("cloud", small ? 16 : 20)}</span><b>Senin Cloudflare hesabın</b><i>Saklar, saatini bekler</i></div>
    <div class="cv-fa"><i></i></div>
    <div class="cv-fn ig"><span>${ic("instagram", small ? 16 : 20)}</span><b>Instagram</b><i>Saatinde paylaşılır</i></div>
  </div>`;
}

function heroHtml(X, d) {
  if (!d || d.configured) return "";
  const { ic } = X;
  return `<div class="cv-hero">
    <div class="cv-hero-t">
      <h2>Bilgisayarın kapalıyken de paylaş</h2>
      <p>Planladığın Reels videoları kendi ücretsiz Cloudflare hesabındaki küçük bir servise yüklenir. Saati gelince paylaşımı o servis yapar; bilgisayarının açık olması gerekmez.</p>
      <div class="cv-pts">
        <span>${ic("monitor-off", 15)}PC kapalı olsa da paylaşılır</span>
        <span>${ic("shield-check", 15)}Ücretsiz plan · kart gerekmez</span>
        <span>${ic("timer", 15)}Kurulum yaklaşık 5 dakika</span>
      </div>
      <div class="row wrap">${d.connecting ? "" : `${actBtn(X, "connect", "Bağlan", "plug", "primary")}${claudeSetupBtn("cloudflare")}`}</div>
    </div>
    ${flowHtml(X)}
  </div>
  <div class="cv-free">${ic("credit-card", 18)}<div><b>Ücret çıkmaz.</b> Sadece Cloudflare'in ücretsiz planı kullanılır; hesaba kart eklemen gerekmez. Ücretsiz sınırlar (günde 100 000 istek, 1 000 yazma, 1 GB yer) aşılırsa sadece o işlem başarısız olur; stüdyo açıksa paylaşım bilgisayardan yapılır.</div></div>`;
}

function nextJob(d) {
  const now = Date.now();
  return (d.jobs || []).filter((j) => COVER.has(j.status) && j.at).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).find((j) => Date.parse(j.at) > now - 60000 || j.status !== "ready") || null;
}

function metersHtml(X, d) {
  if (!d?.configured) return "";
  const { ic, esc } = X;
  const L = { ...DEF_LIMITS, ...(d.limits || {}) };
  const st = d.storage || {};
  const lim = st.limit || L.storage;
  const used = st.used || 0;
  const p = pct(used, lim);
  const free = Math.max(0, lim - used);
  const avg = st.videos ? used / st.videos : 40 * MB;
  const fit = Math.floor(free / Math.max(avg, 5 * MB));
  const u = d.usage;
  const nx = nextJob(d);
  const th = nx ? thumbOf(X, nx.pid, nx.thumb) : "";
  return `<div class="cv-meters">
    <div class="cv-card cv-store">
      <div class="cv-ch">${ic("hard-drive", 14)}Depolama<span class="grow"></span><span class="cv-tag ${lvl(p)}">%${pctTxt(p)} dolu</span></div>
      <div class="cv-big"><b>${size(free)}</b><span>boş yer kaldı</span></div>
      <div class="cv-meter lg"><i class="${lvl(p)}" style="width:${p}%"></i></div>
      <div class="cv-sub"><span>${size(used)} / ${size(lim)} kullanıldı</span><span>${ic("film", 12)}${num(st.videos || 0)} video</span></div>
      <div class="cv-note">${fit > 0 ? `Yaklaşık ${num(fit)} Reels daha sığar.` : "Yer doldu; yeni videolar bilgisayardan paylaşılır."} Paylaşılan videolar buluttan silinir.</div>
    </div>
    <div class="cv-card cv-usage">
      <div class="cv-ch">${ic("activity", 14)}Bugünkü kullanım<span class="cv-chs">ücretsiz sınırlar</span><span class="grow"></span>${u?.date ? `<span class="sm muted">${esc(u.date)}</span>` : ""}</div>
      ${USAGE_ROWS.map(([k, name]) => {
        const v = u ? u[k] : null;
        const has = v != null;
        const pp = has ? pct(v, L[k]) : 0;
        return `<div class="cv-urow ${has ? "" : "na"}"><span class="cv-ul">${name}</span><div class="cv-meter"><i class="${lvl(pp)}" style="width:${pp}%"></i></div><span class="cv-uv"><b>${has ? num(v) : "—"}</b><i>/ ${num(L[k])}</i></span></div>`;
      }).join("")}
      <div class="cv-note">${u ? "Sayaçlar her gün 03:00'te (UTC gece yarısı) sıfırlanır; Cloudflare sayıları birkaç dakika gecikmeli verir." : `${ic("info", 12)} Sayılar alınamadı. Görmek istersen anahtarına <b>Account Analytics: Read</b> iznini ekleyip yeniden bağlan.`}</div>
    </div>
    <div class="cv-card cv-next">
      <div class="cv-ch">${ic("timer", 14)}Sıradaki bulut paylaşımı</div>
      ${nx ? `<div class="cv-nx">
          <div class="cv-th xs" style="${th ? `background-image:url('${esc(th)}')` : ""}">${th ? "" : ic("film", 14)}</div>
          <div class="grow"><div class="cv-nt">${esc(nx.title || "#" + nx.pid)}</div><div class="sm muted">${whenText(nx.at)}</div></div></div>
        <div class="cv-clock" data-cdbig="${esc(nx.at)}" data-cdz="${dueText(nx.status)}"></div>
        <div class="cv-note">${ic("monitor-off", 12)} Bilgisayar kapalı olsa da paylaşılır.</div>`
      : `<div class="cv-none">${ic("calendar-clock", 22)}<b>Bulutta bekleyen paylaşım yok</b><span>Bir Reels'i planladığında buraya gelir.</span></div>`}
    </div>
  </div>`;
}

function dueText(st) {
  if (st === "preparing" || st === "publishing") return "şimdi paylaşılıyor";
  if (st === "uploading") return "saati geldi, yükleme sürüyor";
  if (st === "error") return "saati geçti";
  return "birazdan paylaşılacak";
}

function errStage(j) {
  const e = j.error_stage;
  if (Number.isInteger(e)) return Math.max(0, Math.min(3, e));
  if (typeof e === "string" && e in STAGE) return Math.min(3, STAGE[e]);
  const t = j.error || "";
  if (/yükle|upload|chunk|parça/i.test(t)) return 0;
  if (/kaçtı|missed/i.test(t)) return 1;
  if (/media_publish|yayınla/i.test(t)) return 3;
  return 2;
}

function pipeHtml(X, j) {
  const { ic } = X;
  if (j.status === "canceled") return "";
  const err = j.status === "error";
  const cur = err ? errStage(j) : STAGE[j.status] ?? 0;
  const items = STAGES.map(([name, icon], i) => {
    let cls = j.status === "published" || i < cur ? "done" : i === cur ? (err ? "err" : "cur") : "todo";
    const busy = cls === "cur" && BUSY.has(j.status);
    const glyph = cls === "done" ? ic("check", 12) : cls === "err" ? ic("x", 12) : busy ? ic("loader-circle", 12, "spin") : ic(icon, 12);
    return `<li class="${cls}"><span class="cv-pd">${glyph}</span><span class="cv-pn">${name}</span></li>`;
  });
  const cap = err ? `${STAGES[cur][0]} aşamasında hata` : STAGES[Math.min(cur, 4)][0];
  return `<ol class="cv-pipe">${items.join("")}</ol><div class="cv-pcap">Aşama ${Math.min(cur, 4) + 1}/5 · ${cap}</div>`;
}

function jobBody(X, j) {
  const { ic, esc } = X;
  const future = j.at && Date.parse(j.at) > Date.now();
  switch (j.status) {
    case "uploading":
      return `<div class="cv-up" data-up="${esc(j.pid)}"><div class="cv-upt"><b class="cv-pct">%0</b><span class="cv-mb"></span><span class="grow"></span><span class="cv-spd"></span><span class="cv-eta"></span></div><div class="cv-meter up"><i></i></div><div class="cv-ph"></div></div>`;
    case "ready":
      return `<div class="cv-line ok">${ic("cloud-check", 14)}<span>Bulutta hazır. ${future ? "Saatinde" : "Birazdan"} bilgisayar kapalı olsa da paylaşılır.</span></div>`;
    case "preparing":
      return `<div class="cv-line run">${ic("loader-circle", 14, "spin")}<span>Instagram videoyu işliyor${future ? ` · ${hm(new Date(j.at))}'da yayınlanacak` : ""}. Bu birkaç dakika sürebilir.</span></div>`;
    case "publishing":
      return `<div class="cv-line run">${ic("loader-circle", 14, "spin")}<span>Instagram'da yayınlanıyor…</span></div>`;
    case "published":
      return `<div class="cv-line done">${ic("circle-check", 14)}<span>Yayında. Paylaşımı bulut yaptı; video buluttan silindi, yer açıldı.</span></div>`;
    case "error":
      return `<div class="cv-err">${ic("triangle-alert", 16)}<div><b>${esc(j.error || "Bilinmeyen hata")}</b><span>Tekrar deneyebilirsin. Olmazsa paylaşım saatinde stüdyo açıksa bilgisayardan yapılır.</span></div></div>`;
    case "canceled":
      return `<div class="cv-line">${ic("ban", 14)}<span>İptal edildi.</span></div>`;
    default:
      return `<div class="cv-line">${ic("hourglass", 14)}<span>${esc(j.status || "Bekliyor")}</span></div>`;
  }
}

function jobHtml(X, j) {
  const { ic, esc } = X;
  const pid = esc(j.pid);
  const post = postOf(X, j.pid);
  const th = thumbOf(X, j.pid, j.thumb);
  const logs = j.log || [];
  const open = C.open.has(j.pid);
  const acts = [actBtn(X, "post", "İçeriği aç", "external-link", "", `data-pid="${pid}"`)];
  if (j.permalink) acts.push(`<a class="btn sm" href="${esc(j.permalink)}" target="_blank" rel="noopener">${ic("instagram", 13)}Instagram'da aç</a>`);
  if (j.status === "error") acts.push(actBtn(X, "retry", "Tekrar dene", "refresh-cw", "primary", `data-pid="${pid}"`));
  if (["error", "ready", "uploading"].includes(j.status)) acts.push(actBtn(X, "cancel", "Buluttan kaldır", "cloud-off", "ghost danger-ic", `data-pid="${pid}"`));
  if (logs.length) acts.push(`<button type="button" class="btn sm ghost cv-logb ${open ? "on" : ""}" data-cv="log" data-pid="${pid}">${ic("list", 13)}Bulut günlüğü<span class="tb-n">${logs.length}</span>${ic(open ? "chevron-up" : "chevron-down", 13)}</button>`);
  const when = j.status === "published"
    ? `${ic("circle-check", 13)}<span>${esc(whenText(j.published_at || j.at))} paylaşıldı</span>${j.published_at ? `<span class="muted" title="${esc(fullTime(j.published_at))}">· <span data-ago="${esc(j.published_at)}"></span></span>` : ""}`
    : `${ic("calendar-clock", 13)}<span>${esc(whenText(j.at))}</span>${j.at && j.status !== "canceled" ? `<span class="cv-cd" data-cd="${esc(j.at)}" data-cdz="${dueText(j.status)}"></span>` : ""}`;
  return `<div class="cv-job st-${esc(j.status || "x")}" data-job="${pid}">
    <div class="cv-th" style="${th ? `background-image:url('${esc(th)}')` : ""}">${th ? "" : ic("film", 18)}${j.status === "published" ? `<span class="cv-thok">${ic("check", 12)}</span>` : ""}</div>
    <div class="cv-jb">
      <div class="cv-jt"><b>${esc(j.title || post?.title || "#" + j.pid)}</b><span class="cv-pid">#${pid}</span>${j.local_status ? `<span class="badge b-${esc(j.local_status)}" title="Stüdyodaki durum">${POST_ST[j.local_status] || esc(j.local_status)}</span>` : ""}</div>
      <div class="cv-jw">${when}${j.size ? `<span class="muted">· ${size(j.size)}</span>` : ""}</div>
      ${pipeHtml(X, j)}
      ${jobBody(X, j)}
      <div class="cv-jact">${acts.join("")}</div>
      ${C.ask === j.pid ? `<div class="tr-confirm cv-ask">${ic("cloud-off", 18)}<div class="grow"><b>Buluttan kaldırılsın mı?</b><div class="sm">Video buluttan silinir. Plan kalır; paylaşım saatinde stüdyo açıksa bilgisayardan yapılır.</div>
          <div class="row" style="gap:6px;margin-top:8px">${actBtn(X, "ask-no", "Vazgeç", "x")}${actBtn(X, "ask-yes", "Buluttan kaldır", "cloud-off", "danger", `data-pid="${pid}"`)}</div></div></div>` : ""}
      ${open ? `<div class="cv-log">${logs.slice().reverse().map((l) => {
        const at = typeof l === "string" ? "" : l.at;
        const text = typeof l === "string" ? l : l.text;
        return `<div><span title="${esc(fullTime(at))}">${at ? esc(new Date(at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })) : ""}</span><p>${esc(text)}</p></div>`;
      }).join("")}</div>` : ""}
    </div>
  </div>`;
}

function jobsHtml(X, d) {
  if (!d?.configured) return "";
  const { ic } = X;
  const jobs = d.jobs || [];
  const q = jobs.filter((j) => !DONE.has(j.status)).sort((a, b) => (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5) || (a.at || "").localeCompare(b.at || ""));
  const done = jobs.filter((j) => DONE.has(j.status)).sort((a, b) => (b.published_at || b.at || "").localeCompare(a.published_at || a.at || ""));
  return `<section class="cv-sec"><h3>${ic("cloud", 14)}Bulutta sırada<span class="pl-n">${q.length}</span></h3>
      ${q.length ? q.map((j) => jobHtml(X, j)).join("") : `<div class="cv-empty">${ic("cloud", 26)}<div><b>Bulutta bekleyen video yok</b><span>Bir Reels'i planladığında otomatik olarak buluta yüklenir; her adımı burada canlı görürsün.</span></div></div>`}
    </section>
    ${done.length ? `<section class="cv-sec"><h3>${ic("check-check", 14)}Tamamlananlar<span class="pl-n">${done.length}</span></h3>${done.map((j) => jobHtml(X, j)).join("")}</section>` : ""}`;
}

function howHtml(X, d) {
  const { ic } = X;
  return d?.configured ? `<div class="cv-card cv-how">
      <div class="cv-ch">${ic("info", 14)}Nasıl çalışır?</div>
      ${flowHtml(X, true)}
      <ul class="cv-howl">
        <li>${ic("monitor-off", 15)}<div><b>PC kapalı olsa da paylaşılır.</b> Reels planlanınca video buluta yüklenir; saati gelince servis Instagram'a kendisi gönderir.</div></li>
        <li>${ic("shield-check", 15)}<div><b>Ücretsiz plan, kart yok.</b> Ücret çıkmaz. Ücretsiz sınır aşılırsa sadece o işlem başarısız olur; stüdyo açıksa paylaşım bilgisayardan yapılır.</div></li>
        <li>${ic("hard-drive", 15)}<div><b>1 GB yer.</b> Paylaşılan videolar buluttan silinir, yer kendiliğinden açılır.</div></li>
        <li>${ic("refresh-cw", 15)}<div><b>Eşitleme.</b> Stüdyo açıkken her dakika sonuçları (yayın bağlantısı, hatalar) buluttan alır.</div></li>
        <li>${ic("image", 15)}<div>Fotoğraf, kaydırmalı gönderi ve hikâyeler şimdilik bilgisayardan paylaşılır.</div></li>
      </ul></div>` : "";
}

function pwField(X, key, label, ph, busy) {
  const { ic } = X;
  const R = C.rp;
  const eye = key === "a" ? `<button type="button" class="cv-pw-eye" data-cv="pw-eye" tabindex="-1" title="${R.show ? "Şifreyi gizle" : "Şifreyi göster"}" aria-label="${R.show ? "Şifreyi gizle" : "Şifreyi göster"}">${ic(R.show ? "eye-off" : "eye", 15)}</button>` : "";
  return `<label class="cv-rp-l" for="rpPw${key}">${label}</label>
    <div class="cv-pw ${R.field === key ? "bad" : ""}"><input id="rpPw${key}" data-pw="${key}" type="${R.show ? "text" : "password"}" autocomplete="new-password" autocapitalize="off" spellcheck="false" maxlength="128" placeholder="${ph}" ${busy ? "disabled" : ""}>${eye}</div>`;
}

function pwForm(X, kind) {
  const { ic, esc } = X;
  const R = C.rp;
  const busy = R.busy === kind;
  const change = kind === "change";
  const label = busy ? (change ? "Kaydediliyor…" : "Oluşturuluyor…") : change ? "Şifreyi kaydet" : "Link oluştur";
  return `<form class="cv-rp-form ${change ? "chg" : ""}" data-rpf="${kind}" novalidate>
      ${change ? `<div class="cv-rp-ft">${ic("key-round", 14)}<b>Yeni şifre belirle</b><span>Paneli açık olan cihazlarda yeniden giriş gerekir.</span></div>` : ""}
      ${pwField(X, "a", change ? "Yeni şifre" : "Şifre", `En az ${PW_MIN} karakter`, busy)}
      ${pwField(X, "b", "Şifre tekrar", "Aynı şifreyi yaz", busy)}
      <div class="cv-rp-chk"><span data-chk="len">${ic("check", 12)}En az ${PW_MIN} karakter</span><span data-chk="same">${ic("check", 12)}İki şifre aynı</span><span class="cv-rp-caps hidden">${ic("triangle-alert", 12)}Caps Lock açık</span></div>
      ${R.err ? `<div class="cv-rp-err" role="alert">${ic("circle-x", 14)}<span>${esc(R.err)}</span></div>` : ""}
      <div class="cv-rp-fa">${change ? `<button type="button" class="btn sm" data-cv="rp-cancel" ${busy ? "disabled" : ""}>${ic("x", 13)}Vazgeç</button>` : ""}<button type="submit" class="btn primary ${change ? "sm" : "wide"}" ${busy ? "disabled" : ""}>${ic(busy ? "loader-circle" : change ? "check" : "link", change ? 13 : 15, busy ? "spin" : "")}${label}</button></div>
    </form>`;
}

function rpConfirm(X, kind) {
  const { ic } = X;
  const busy = C.rp.busy === kind;
  const nl = kind === "newlink";
  const title = nl ? "Yeni link oluşturulsun mu?" : "Uzaktan takip kapatılsın mı?";
  const text = nl
    ? "Eski link hemen çalışmaz olur; telefondaki yer imini ya da ana ekran kısayolunu yenisiyle değiştirmen gerekir. Şifre aynı kalır."
    : "Link ve şifre silinir; panel açık olan cihazlarda da çalışmaz. İstediğin zaman yeniden açabilirsin.";
  const ok = busy ? (nl ? "Oluşturuluyor…" : "Kapatılıyor…") : nl ? "Yeni link oluştur" : "Kapat";
  return `<div class="tr-confirm cv-rp-ask">${ic(nl ? "refresh-cw" : "power", 18)}<div class="grow"><b>${title}</b><div class="sm">${text}</div>
      <div class="row" style="gap:6px;margin-top:9px"><button type="button" class="btn sm" data-cv="rp-cancel" ${busy ? "disabled" : ""}>${ic("x", 13)}Vazgeç</button><button type="button" class="btn sm danger" data-cv="${nl ? "rp-newlink" : "rp-off"}" ${busy ? "disabled" : ""}>${ic(busy ? "loader-circle" : nl ? "refresh-cw" : "power", 13, busy ? "spin" : "")}${ok}</button></div></div></div>`;
}

function qrHtml(X, url) {
  if (C.qr?.url === url) return C.qr.svg;
  loadQr(url);
  return `<span class="cv-qr-wait">${X.ic("loader-circle", 18, "spin")}</span>`;
}

function loadQr(url) {
  if (C.qrLoading === url) return;
  C.qrLoading = url;
  import("/web/vendor/qrcode-generator.mjs")
    .then((m) => {
      const q = m.default(0, "M");
      q.addData(url);
      q.make();
      C.qr = { url, svg: q.createSvgTag({ cellSize: 4, margin: 8, scalable: true }) };
    })
    .catch(() => {
      C.qr = { url, svg: `<span class="cv-qr-wait">QR oluşturulamadı</span>` };
    })
    .finally(() => {
      C.qrLoading = null;
      if (C.X && visible(C.X)) paint(C.X);
    });
}

function remoteHtml(X, d) {
  if (!d) return "";
  const { ic, esc } = X;
  const pn = d.panel || {};
  const R = C.rp;
  const head = (tag) => `<div class="cv-ch">${ic("smartphone", 14)}Uzaktan takip<span class="grow"></span>${tag}</div>`;
  const lead = `<p class="cv-rp-lead">Telefondan ya da başka bir bilgisayardan, şifreyle bulut panelini aç; bilgisayarın kapalıyken de çalışır.</p>`;
  const pts = `<div class="cv-rp-pts"><span>${ic("eye", 13)}Sadece izleme</span><span>${ic("lock", 13)}Şifreli</span><span>${ic("monitor-off", 13)}PC kapalıyken de</span></div>`;
  if (!d.configured || !pn.supported || !pn.enabled) {
    const off = `<span class="cv-tag">Kapalı</span>`;
    if (!d.configured)
      return `<div class="cv-card cv-rp dis">${head(off)}${lead}${pts}
        <div class="cv-rp-need">${ic("cloud-off", 16)}<span><b>Önce bulut yayını bağla.</b> Panel, senin Cloudflare hesabındaki servisten açılır.</span></div>
        <button type="button" class="btn" disabled title="Bulut yayın bağlanınca kullanılabilir">${ic("link", 15)}Link oluştur</button></div>`;
    if (!pn.supported) {
      const run = d.connecting && !d.connecting.error;
      const can = d.update_available && (d.latest_version || 0) >= 2;
      const note = run
        ? "<b>Servis güncelleniyor…</b> Bitince buradan link oluşturabilirsin."
        : !d.panel
          ? "<b>Stüdyoyu yeniden başlatınca kullanılabilir.</b> Bu özellik stüdyonun yeni sürümüyle geldi."
          : can
            ? "<b>Servisin güncellenmesi gerekiyor.</b> Güncelleme birkaç saniye sürer; buluttaki videolar ve planlar korunur."
            : "<b>Bulut servisinin yeni sürümü gerekiyor.</b> Stüdyo güncellenince servis de kendiliğinden yenilenir.";
      return `<div class="cv-card cv-rp">${head(off)}${lead}${pts}
        <div class="cv-rp-need ${run || can ? "info" : ""}">${ic(run ? "loader-circle" : can ? "rocket" : "info", 16, run ? "spin" : "")}<span>${note}</span></div>
        ${!run && can ? actBtn(X, "redeploy", "Servisi güncelle", "refresh-cw", "primary wide") : ""}</div>`;
    }
    return `<div class="cv-card cv-rp">${head(off)}${lead}${pts}${pwForm(X, "create")}</div>`;
  }
  const url = pn.url || "";
  const shown = url.replace(/^https?:\/\//, "");
  const snap = pn.last_snapshot
    ? `<span title="Stüdyo açıkken bu bilgisayardaki durum (yerel kalacak paylaşımlar, yüklemeler, günlük kullanım) değişince hemen, değişmese de en geç 30 dakikada bir panele gönderilir.">${ic("send", 12)}Son güncelleme gönderimi: <b data-ago="${esc(pn.last_snapshot)}"></b></span>`
    : `<span title="Stüdyo açıkken durum ilk eşitlemede panele gönderilir.">${ic("send", 12)}Son güncelleme gönderimi: <b>henüz yok</b></span>`;
  const body = R.mode === "change" ? pwForm(X, "change") : R.mode === "newlink" || R.mode === "off" ? rpConfirm(X, R.mode) : "";
  return `<div class="cv-card cv-rp on">${head(`<span class="cv-tag ok"><i class="cv-live"></i>Açık</span>`)}
      <div class="cv-rp-link">
        <a class="cv-rp-url" href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(url)}">${ic("link", 13)}<span>${esc(shown)}</span></a>
        <div class="cv-rp-la"><button type="button" class="btn sm ${R.copied ? "ok" : ""}" data-cv="rp-copy">${ic(R.copied ? "check" : "copy", 13)}${R.copied ? "Kopyalandı" : "Kopyala"}</button><a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${ic("external-link", 13)}Aç</a></div>
      </div>
      <div class="cv-rp-qr ${R.big ? "big" : ""}">
        <button type="button" class="cv-qr" data-cv="rp-qr" title="${R.big ? "Küçült" : "Büyüt"}" aria-label="QR kod">${qrHtml(X, url)}</button>
        <div class="cv-rp-qt"><b>${ic("qr-code", 14)}Telefonla aç</b><span>Kameranla okut, şifreni yazıp giriş yap. Ana ekrana eklersen uygulama gibi açılır.</span></div>
      </div>
      <div class="cv-rp-meta">${snap}
        <span>${ic("key-round", 12)}Link <b data-ago="${esc(pn.created || "")}"></b> oluşturuldu · şifre <b data-ago="${esc(pn.pw_set_at || "")}"></b> belirlendi</span>
        ${pn.snapshot_error ? `<span class="warnc">${ic("triangle-alert", 12)}Son gönderim olmadı: ${esc(pn.snapshot_error)}</span>` : ""}</div>
      <div class="cv-rp-acts">${actBtn(X, "rp-change", "Şifreyi değiştir", "key-round", R.mode === "change" ? "on" : "")}${actBtn(X, "rp-ask-newlink", "Yeni link", "refresh-cw", R.mode === "newlink" ? "on" : "")}<span class="grow"></span>${actBtn(X, "rp-ask-off", "Kapat", "power", `ghost danger-ic ${R.mode === "off" ? "on" : ""}`)}</div>
      ${body}
    </div>`;
}

function rpCheck(root) {
  const f = $("[data-rpf]", root);
  if (!f) return;
  const a = $('[data-pw="a"]', f)?.value || "";
  const b = $('[data-pw="b"]', f)?.value || "";
  $('[data-chk="len"]', f)?.classList.toggle("ok", a.length >= PW_MIN);
  $('[data-chk="same"]', f)?.classList.toggle("ok", !!a && a === b);
}

function rpReset(mode = "") {
  Object.assign(C.rp, { mode, err: "", field: "", busy: "" });
}

function rpFocus(root, key) {
  const i = $(`[data-pw="${key}"]`, root);
  if (i) {
    i.focus();
    i.select();
  }
}

async function rpSubmit(X, form) {
  const root = form.closest(".cv");
  const kind = form.dataset.rpf;
  const R = C.rp;
  if (R.busy) return;
  const a = $('[data-pw="a"]', form).value;
  const b = $('[data-pw="b"]', form).value;
  let err = "";
  let field = "";
  if (!a) [err, field] = ["Önce bir şifre yaz", "a"];
  else if (a.length < PW_MIN) [err, field] = [`Şifre en az ${PW_MIN} karakter olmalı`, "a"];
  else if (a !== a.trim()) [err, field] = ["Şifre boşlukla başlayıp bitemez", "a"];
  else if (!b) [err, field] = ["Şifreyi bir kez daha yaz", "b"];
  else if (a !== b) [err, field] = ["Şifreler aynı değil", "b"];
  if (err) {
    Object.assign(R, { err, field });
    paint(X);
    rpFocus(root, field);
    return;
  }
  Object.assign(R, { busy: kind, err: "", field: "" });
  paint(X);
  try {
    C.data = norm(await X.api("/api/cloud/panel", { password: a }));
    rpReset();
    X.toast(kind === "change" ? "Şifre değişti; panelde yeniden giriş gerekir" : "Uzaktan takip açıldı; link hazır");
  } catch (e) {
    Object.assign(R, { busy: "", err: e.message, field: "" });
  }
  paint(X);
  if (R.err) rpFocus(root, "a");
}

async function rpAction(X, a, root) {
  const R = C.rp;
  const d = C.data || {};
  if (a === "pw-eye") {
    R.show = !R.show;
    paint(X);
    return;
  }
  if (a === "rp-change" || a === "rp-ask-newlink" || a === "rp-ask-off") {
    const mode = a === "rp-change" ? "change" : a === "rp-ask-newlink" ? "newlink" : "off";
    if (R.busy) return;
    rpReset(R.mode === mode ? "" : mode);
    paint(X);
    if (R.mode === "change") rpFocus(root, "a");
    else if (R.mode) $('.cv-rp-ask [data-cv="rp-cancel"]', root)?.focus();
    else $(`[data-cv="${a}"]`, root)?.focus();
    return;
  }
  if (a === "rp-cancel") {
    if (!R.busy) rpReset();
    paint(X);
    return;
  }
  if (a === "rp-qr") {
    R.big = !R.big;
    paint(X);
    return;
  }
  if (a === "rp-copy") {
    await copy(d.panel?.url || "");
    R.copied = true;
    X.toast("Link panoya kopyalandı");
    paint(X);
    clearTimeout(C.copyT);
    C.copyT = setTimeout(() => {
      R.copied = false;
      if (visible(X)) paint(X);
    }, 1800);
    return;
  }
  if (a === "rp-newlink" || a === "rp-off") {
    if (R.busy) return;
    const nl = a === "rp-newlink";
    R.busy = R.mode;
    paint(X);
    try {
      C.data = norm(await X.api(nl ? "/api/cloud/panel/new-link" : "/api/cloud/panel/off", {}));
      rpReset();
      R.big = false;
      X.toast(nl ? "Yeni link hazır; eski link artık çalışmaz" : "Uzaktan takip kapatıldı");
    } catch (e) {
      R.busy = "";
      X.toast(e.message, true);
    }
    paint(X);
  }
}

function sideHtml(X, d) {
  if (!d) return "";
  const { ic, esc } = X;
  const lo = d.local_only || [];
  const ev = d.events || [];
  const can = d.configured && d.enabled;
  const local = lo.length ? `<div class="cv-card cv-local">
      <div class="cv-ch">${ic("monitor", 14)}Yerel kalacak<span class="pl-n">${lo.length}</span></div>
      <div class="cv-note top">Bunlar paylaşım saatinde bilgisayardan yapılır; o saatte stüdyo açık olmalı.</div>
      ${lo.map((x) => {
        const p = postOf(X, x.pid);
        const th = thumbOf(X, x.pid, x.thumb);
        const reels = !p || !p.kind || p.kind === "reels";
        return `<div class="cv-lrow">
          <div class="cv-th xs" style="${th ? `background-image:url('${esc(th)}')` : ""}">${th ? "" : ic(reels ? "film" : "image", 13)}</div>
          <div class="grow"><b>${esc(x.title || p?.title || "#" + x.pid)}</b><span>${esc(whenText(x.at))}${x.reason ? ` · ${esc(REASON[x.reason] || x.reason)}` : ""}</span></div>
          ${can && reels ? actBtn(X, "upload", "Buluta yükle", "cloud-upload", "", `data-pid="${esc(x.pid)}"`) : `<span class="cv-loc" title="Bilgisayardan paylaşılır">${ic("monitor", 14)}</span>`}
        </div>`;
      }).join("")}</div>` : "";
  const evs = `<div class="cv-card cv-evs"><div class="cv-ch">${ic("history", 14)}Son olaylar${ev.length ? `<span class="pl-n">${ev.length}</span>` : ""}</div>
      ${ev.length ? `<div class="cv-evl">${ev.map((e) => {
        const [icon, cls] = EV_IC[e.kind] || ["info", ""];
        return `<div class="cv-ev"><span class="cv-evi ${cls}">${ic(icon, 13)}</span><div class="grow"><p>${esc(e.text)}</p><span title="${esc(fullTime(e.at))}" data-ago="${esc(e.at || "")}"></span></div></div>`;
      }).join("")}</div>` : `<div class="cv-note">Henüz olay yok. Yükleme, paylaşım ve eşitleme adımları burada listelenir.</div>`}</div>`;
  return local + evs;
}

function bindView(X, root) {
  root.onclick = X.guard(async (e) => {
    const pm = e.target.closest("[data-plmode]");
    if (pm) {
      if (pm.dataset.plmode !== "cloud") {
        X.S.planMode = "cal";
        X.S.planSig = "";
        X.setTab("calendar");
      }
      return;
    }
    const b = e.target.closest("[data-cv]");
    if (!b || !root.contains(b)) return;
    const a = b.dataset.cv;
    const pid = b.dataset.pid;
    const d = C.data || {};
    if (a === "pw-eye" || a.startsWith("rp-")) await rpAction(X, a, root);
    else if (a === "enable" && d.enabled)
      confirmOff(X, async () => {
        C.html = {};
        await refreshNow(X);
        X.refresh();
      });
    else if (a === "connect") openCloudConnect(X);
    else if (a === "settings") X.openSettings("cloud");
    else if (a === "igset") X.openSettings();
    else if (a === "reload") await refreshNow(X);
    else if (a === "post") {
      X.setTab("posts");
      X.select(pid);
    } else if (a === "log") {
      if (C.open.has(pid)) C.open.delete(pid);
      else C.open.add(pid);
      paint(X);
    } else if (a === "cancel") {
      C.ask = pid;
      paint(X);
    } else if (a === "ask-no") {
      C.ask = null;
      paint(X);
    } else {
      b.disabled = true;
      b.innerHTML = `${X.ic("loader-circle", 13, "spin")}${b.textContent}`;
      try {
        if (a === "sync") {
          await X.api("/api/cloud/sync", {});
          X.toast("Bulut durumu eşitlendi");
        } else if (a === "enable") {
          await X.api("/api/cloud/enable", { on: !d.enabled });
          X.toast(d.enabled ? "Bulut yayın kapatıldı" : "Bulut yayın açıldı");
        } else if (a === "redeploy") {
          await redeployNow(X);
        } else if (a === "retry") {
          await X.api(`/api/cloud/jobs/${pid}/retry`, {});
          X.toast("Yeniden deneniyor");
        } else if (a === "ask-yes") {
          await X.api(`/api/cloud/jobs/${pid}/cancel`, {});
          C.ask = null;
          X.toast("Buluttan kaldırıldı; paylaşım bilgisayardan yapılacak");
        } else if (a === "upload") {
          await X.api(`/api/cloud/jobs/${pid}/upload`, {});
          X.toast("Buluta yükleme başladı");
        }
      } finally {
        C.html = {};
        await refreshNow(X);
        X.refresh();
      }
    }
  });
  root.onsubmit = X.guard(async (e) => {
    const f = e.target.closest("[data-rpf]");
    if (!f) return;
    e.preventDefault();
    await rpSubmit(X, f);
  });
  root.oninput = (e) => {
    if (!e.target.dataset?.pw) return;
    if (C.rp.err) {
      C.rp.err = "";
      C.rp.field = "";
      paint(X);
    } else rpCheck(root);
  };
  const caps = (e) => {
    if (!e.target.dataset?.pw || typeof e.getModifierState !== "function") return;
    $(".cv-rp-caps", root)?.classList.toggle("hidden", !e.getModifierState("CapsLock"));
  };
  root.onkeyup = caps;
  root.onkeydown = (e) => {
    caps(e);
    if (e.key === "Escape" && e.target.closest?.(".cv-rp") && C.rp.mode && !C.rp.busy) {
      e.stopPropagation();
      const back = { change: "rp-change", newlink: "rp-ask-newlink", off: "rp-ask-off" }[C.rp.mode];
      rpReset();
      paint(X);
      $(`[data-cv="${back}"]`, root)?.focus();
    }
  };
}

// ---------- publish pane badge ----------

export function cloudCovers(d) {
  return COVER.has(d?.cloud?.state);
}

export function cloudBadgeHtml(X, d) {
  const { ic, esc, S } = X;
  wire(X);
  const c = d?.cloud;
  const sc = S.cloud;
  const st = c?.state;
  const panel = `<button type="button" class="btn sm ghost" data-cvb="open" title="Bulut panelini aç">${ic("cloud", 13)}Bulut paneli</button>`;
  if (!st || st === "canceled" || st === "deleted") {
    if ((d?.status === "planlandi") && sc?.configured && sc.enabled && d.kind && d.kind !== "reels")
      return `<div class="cvb loc">${ic("monitor", 16)}<div class="grow"><b>Bilgisayardan paylaşılacak</b><span>Bu tür şimdilik buluta yüklenmez; paylaşım saatinde stüdyo açık olmalı.</span></div></div>`;
    return "";
  }
  const pid = esc(d.id);
  if (st === "uploading") {
    badgeLoop(X);
    return `<div class="cvb up" data-cvb-up="${pid}">${ic("cloud-upload", 16)}<div class="grow"><b>Buluta yükleniyor <span class="cvb-p"></span></b><div class="cvb-bar"><i></i></div><span class="cvb-s">Yükleme bitince PC kapalıyken de paylaşılır.</span></div>${panel}</div>`;
  }
  if (st === "ready") return `<div class="cvb ok">${ic("cloud-check", 16)}<div class="grow"><b>Bulutta · PC kapalıyken de paylaşılır</b><span>${c.uploaded_at ? `Yüklendi: ${esc(whenText(c.uploaded_at))}` : "Video bulutta hazır"}${c.size ? ` · ${size(c.size)}` : ""}</span></div>${panel}</div>`;
  if (st === "preparing" || st === "publishing") return `<div class="cvb run">${ic("loader-circle", 16, "spin")}<div class="grow"><b>Bulut paylaşıyor</b><span>${st === "preparing" ? "Instagram videoyu işliyor…" : "Instagram'da yayınlanıyor…"}</span></div>${panel}</div>`;
  if (st === "published") return `<div class="cvb ok">${ic("circle-check", 16)}<div class="grow"><b>Buluttan paylaşıldı</b><span>Sonuç stüdyoya eşitleniyor…</span></div>${panel}</div>`;
  if (st === "error") return `<div class="cvb bad">${ic("cloud-alert", 16)}<div class="grow"><b>Bulut hatası</b><span>${esc(c.error || "Bilinmeyen hata")} · Paylaşım saatinde stüdyo açıksa bilgisayardan yapılır.</span></div><button type="button" class="btn sm" data-cvb="retry" data-pid="${pid}">${ic("refresh-cw", 13)}Tekrar dene</button>${panel}</div>`;
  return `<div class="cvb">${ic("cloud", 16)}<div class="grow"><b>Bulut: ${esc(st)}</b></div>${panel}</div>`;
}

function patchBadges() {
  for (const el of $$(".cvb[data-cvb-up]")) {
    const j = jobOf(el.getAttribute("data-cvb-up"));
    const up = j?.upload;
    const p = upPct(up);
    const bar = $(".cvb-bar i", el);
    if (bar) bar.style.width = `${p}%`;
    const t = $(".cvb-p", el);
    if (t) t.textContent = up ? `%${fx(p, 0)}${up.total ? ` · ${fx((up.sent || 0) / MB, 1)} / ${fx(up.total / MB, 1)} MB` : ""}${up.eta != null && up.speed && p < 100 ? ` · ~${dur(Math.max(1, up.eta))}` : ""}` : "";
  }
}

function badgeLoop(X) {
  if (C.btimer) return;
  const step = async () => {
    const el = $(".cvb[data-cvb-up]");
    if (!el) {
      C.btimer = null;
      return;
    }
    if (!C.timer && el.offsetParent) await load(X);
    patchBadges();
    C.btimer = setTimeout(step, el.offsetParent ? 1200 : 4000);
  };
  C.btimer = setTimeout(step, 200);
}

function wire(X) {
  if (C.wired) return;
  C.wired = true;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cvb]");
    if (!b) return;
    const a = b.getAttribute("data-cvb");
    if (a === "open") openCloud(X);
    if (a === "retry")
      X.guard(async () => {
        b.disabled = true;
        await X.api(`/api/cloud/jobs/${b.dataset.pid}/retry`, {});
        X.toast("Bulut yeniden deniyor");
        await X.refresh();
      })();
  });
}

// ---------- settings section ----------

export function cloudSettingsHtml(X) {
  return `<fieldset id="sCloud"><legend>Bulut yayın (Cloudflare)</legend><div id="sCloudBody" class="cvs"><div class="sm muted" style="margin-top:10px">${X.ic("loader-circle", 13, "spin")} Durum alınıyor…</div></div></fieldset>`;
}

export function bindCloudSettings(X, m, section) {
  const box = $("#sCloudBody", m);
  if (!box) return;
  const { ic, esc } = X;
  let ask = false;
  let askOff = false;
  const draw = () => {
    if (!box.isConnected) return;
    const d = C.data;
    if (!d) {
      box.innerHTML = `<div class="errbox" style="margin-top:10px">${ic("triangle-alert", 14)} Bulut bilgisi alınamadı${C.err ? `: ${esc(C.err)}` : ""}</div>`;
      return;
    }
    const st = stateOf(d);
    const cn = d.connecting;
    if (!d.configured) {
      box.innerHTML = `<div class="cvs-st ${st.cls}">${ic(st.icon, 16, st.spin ? "spin" : "")}<b>${st.text}</b></div>
        ${cn ? `<div class="cvs-run">${stepsInline(X, cn.steps || [])}${cn.error ? `<div class="cvs-err">${ic("circle-x", 13)} ${esc(cn.error)}</div>` : ""}</div>` : ""}
        <div class="help">Planlanan Reels videolarının <b>bilgisayar kapalıyken de</b> paylaşılması için kendi ücretsiz Cloudflare hesabına küçük bir servis kurulur. Kart gerekmez, ücret çıkmaz; ücretsiz sınır aşılırsa sadece o işlem başarısız olur.</div>
        <div class="row wrap" style="margin-top:10px">${actBtn(X, "connect", cn && !cn.error ? "Kurulumu izle" : "Bağla", "plug", "primary")}${claudeSetupBtn("cloudflare")}</div>`;
      return;
    }
    const sto = d.storage || {};
    const lim = sto.limit || DEF_LIMITS.storage;
    box.innerHTML = `<div class="cvs-st ${st.cls}">${ic(st.icon, 16, st.spin ? "spin" : "")}<b>${st.text}</b>${d.status?.ok && d.status.latency_ms != null ? `<span class="muted">· ${num(d.status.latency_ms)} ms</span>` : ""}${d.version ? `<span class="badge">v${esc(d.version)}</span>` : ""}</div>
      ${d.status?.ok === false && d.status.error ? `<div class="cvs-err">${ic("triangle-alert", 13)} ${esc(d.status.error)}</div>` : ""}
      ${d.url ? `<div class="sm muted cvs-url">${ic("server", 12)}<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url.replace(/^https?:\/\//, ""))}</a></div>` : ""}
      <div class="sm muted" style="margin-top:4px">${ic("hard-drive", 12)} Depolama: ${size(sto.used || 0)} / ${size(lim)} · ${num(sto.videos || 0)} video</div>
      ${cn ? `<div class="cvs-run">${stepsInline(X, cn.steps || [])}${cn.error ? `<div class="cvs-err">${ic("circle-x", 13)} ${esc(cn.error)}</div>` : ""}</div>` : ""}
      <label class="check cvs-on" title="${d.enabled ? `Kapatırsan: ${esc(offText(d))}` : "Açınca planlanan Reels videoları buluta yüklenir"}"><input type="checkbox" id="sCloudOn" ${d.enabled || askOff ? "checked" : ""}> Planlanan Reels videolarını buluta yükle (PC kapalıyken de paylaşılsın)</label>
      ${askOff ? `<div class="tr-confirm" style="margin-top:10px">${ic("cloud-off", 20)}<div class="grow"><b>Bulut yayın kapatılsın mı?</b>
          <div class="sm"><b>${esc(offText(d))}.</b> ${OFF_NOTE}</div>
          <div class="row" style="gap:6px;margin-top:8px">${actBtn(X, "off-no", "Vazgeç", "x")}${actBtn(X, "off-yes", "Kapat", "cloud-off", "danger")}</div></div></div>` : ""}
      ${cn && !cn.error ? "" : d.update_available ? `<div class="cvs-upd">${ic("rocket", 14)}<span class="grow">Servisin yeni sürümü hazır${d.latest_version ? ` (v${esc(d.latest_version)})` : ""}.</span>${actBtn(X, "redeploy", "Güncelle", "refresh-cw", "primary")}</div>`
        : d.version ? `<div class="cvs-ver">${ic("circle-check", 13)}<span class="grow">Servis güncel · sürüm ${esc(d.version)}</span>${actBtn(X, "redeploy", "Yeniden kur", "rotate-ccw", "ghost", 'title="Servisi aynı sürümle yeniden kurar; bir şeyler ters giderse onarım için. Videolar ve planlar korunur."')}</div>` : ""}
      <div class="row wrap" style="margin-top:10px">${actBtn(X, "panel", "Bulut panelini aç", "cloud")}${actBtn(X, "sync", "Şimdi eşitle", "refresh-cw")}<span class="grow"></span>${actBtn(X, "disc", "Bağlantıyı kes", "unplug", "ghost danger-ic")}</div>
      ${ask ? `<div class="tr-confirm" style="margin-top:10px">${ic("triangle-alert", 20)}<div class="grow"><b>Bulut bağlantısı kesilsin mi?</b>
          <div class="sm">Planlı paylaşımlar bundan sonra bilgisayardan yapılır; paylaşım saatinde stüdyo açık olmalı.</div>
          <label class="check cvs-del"><input type="checkbox" id="sCloudDel"> Cloudflare'deki servisi ve verileri de sil <span>(buluttaki videolar ve bekleyen işler silinir; Cloudflare hesabın kalır)</span></label>
          <div class="row" style="gap:6px;margin-top:8px">${actBtn(X, "disc-no", "Vazgeç", "x")}${actBtn(X, "disc-yes", "Bağlantıyı kes", "unplug", "danger")}</div></div></div>` : ""}`;
    const on = $("#sCloudOn", box);
    if (on)
      on.onchange = X.guard(async () => {
        if (!on.checked && d.enabled) {
          askOff = true;
          draw();
          return;
        }
        askOff = false;
        on.disabled = true;
        try {
          await X.api("/api/cloud/enable", { on: on.checked });
          X.toast(on.checked ? "Bulut yayın açıldı" : "Bulut yayın kapatıldı");
        } finally {
          await load(X);
          draw();
          X.refresh();
        }
      });
  };
  box.onclick = X.guard(async (e) => {
    const b = e.target.closest("[data-cv]");
    if (!b) return;
    const a = b.dataset.cv;
    if (a === "connect") openCloudConnect(X, { from: "settings" });
    else if (a === "panel") {
      X.closeModal();
      openCloud(X);
    } else if (a === "disc") {
      ask = true;
      draw();
    } else if (a === "disc-no") {
      ask = false;
      draw();
    } else if (a === "off-no") {
      askOff = false;
      draw();
    } else {
      b.disabled = true;
      try {
        if (a === "sync") {
          await X.api("/api/cloud/sync", {});
          X.toast("Bulut durumu eşitlendi");
        } else if (a === "redeploy") {
          await redeployNow(X);
        } else if (a === "off-yes") {
          await X.api("/api/cloud/enable", { on: false });
          askOff = false;
          X.toast("Bulut yayın kapatıldı; planlı paylaşımlar bu bilgisayardan yapılacak");
        } else if (a === "disc-yes") {
          const del = !!$("#sCloudDel", box)?.checked;
          await X.api("/api/cloud/disconnect", { delete_remote: del });
          ask = false;
          X.toast(del ? "Bağlantı kesildi; Cloudflare'deki servis ve veriler silindi" : "Bulut bağlantısı kesildi");
        }
      } finally {
        await load(X);
        draw();
        X.refresh();
        again();
      }
    }
  });
  let polling = false;
  const again = () => {
    if (polling || !box.isConnected || !C.data?.connecting || ask) return;
    polling = true;
    setTimeout(() => load(X).then(() => {
      polling = false;
      if (!box.isConnected) return;
      draw();
      again();
    }), 1000);
  };
  load(X).then(() => {
    draw();
    if (section === "cloud") $("#sCloud", m)?.scrollIntoView({ block: "start" });
    again();
  });
  if (section === "cloud") $("#sCloud", m)?.scrollIntoView({ block: "start" });
}

// ---------- connect wizard ----------

export function openCloudConnect(X, opts = {}) {
  const { ic, esc } = X;
  const W = { step: 1, token: "", started: false, pick: "", err: "" };
  const back = () => {
    if (opts.from === "settings") X.openSettings("cloud");
    else X.closeModal();
  };
  const cur = C.data;
  if (cur?.configured && !cur.connecting) W.step = 4;
  else if (cur?.connecting && !cur.connecting.error) {
    W.step = 3;
    W.started = true;
  } else if (cur?.accounts_choice?.length) {
    W.step = 3;
    W.started = true;
  }

  const stepper = () => `<ol class="cw-steps">${["Hesap", "Anahtar", "Bağla", "Hazır"].map((t, i) => `<li class="${i + 1 < W.step ? "done" : i + 1 === W.step ? "cur" : ""}"><b>${i + 1 < W.step ? ic("check", 12) : i + 1}</b><span>${t}</span></li>`).join("")}</ol>`;

  const step1 = () => `<div class="cw-lead">Bilgisayarın kapalıyken de paylaşım yapılabilmesi için <b>kendi ücretsiz Cloudflare hesabına</b> küçük bir servis kurulur. Kurulumu stüdyo yapar; senden sadece bir anahtar istenir.</div>
    <div class="cw-free">${ic("shield-check", 20)}<div><b>Tamamen ücretsiz plan</b><span>Kart bilgisi gerekmez, ücret çıkmaz. Ücretsiz sınırlar aşılırsa sadece o işlem başarısız olur; stüdyo açıksa paylaşım bilgisayardan yapılır.</span></div></div>
    <div class="cw-card"><span class="cw-n">1</span><div class="grow"><b>Ücretsiz Cloudflare hesabı aç</b>
      <p>E-posta adresin ve bir şifreyle kaydol, sonra e-postana gelen bağlantıyla hesabını doğrula. Plan sorulursa <span class="cw-ui">Free</span> seç. Zaten hesabın varsa bu adımı geç.</p>
      <a class="btn" href="${SIGNUP_URL}" target="_blank" rel="noopener">${ic("external-link", 14)}Cloudflare'e kaydol</a></div></div>
    <div class="foot cw-foot">${claudeSetupBtn("cloudflare", "Claude ile kur", "ghost")}<span class="grow"></span><button type="button" class="btn" data-cw="close">Vazgeç</button><button type="button" class="btn primary" data-cw="next">Hesabım var, devam${ic("chevron-right", 15)}</button></div>`;

  const step2 = () => `<div class="cw-lead">Stüdyonun servisi senin hesabına kurabilmesi için bir <b>API anahtarı (token)</b> oluştur. Cloudflare ekranları İngilizce; düğme adları aşağıda aynen yazıyor.</div>
    <ol class="cw-sub">
      <li><div><b>API Tokens sayfasını aç.</b> Cloudflare'e giriş yapmış olman yeterli.</div><a class="btn sm" href="${TOKEN_URL}" target="_blank" rel="noopener">${ic("external-link", 13)}Sayfayı aç</a></li>
      <li><div>Sağ üstteki <span class="cw-ui cfb">Create Token</span> düğmesine bas.</div></li>
      <li><div>Şablon listesinde <span class="cw-ui row">${ic("server", 12)}Edit Cloudflare Workers<i>Use template</i></span> satırını bul ve <b>Use template</b>'e bas.</div></li>
      <li><div><b>Account Resources</b>: <span class="cw-ui">Include</span> → <span class="cw-ui">kendi hesabın</span><br><b>Zone Resources</b>: <span class="cw-ui">Include</span> → <span class="cw-ui">All zones</span> <span class="muted">(sitesi olmayan hesaplarda da böyle kalır)</span></div></li>
      <li class="opt"><div><span class="cw-opt">İsteğe bağlı</span> Günlük kullanım sayılarını görmek için <b>Permissions</b> altında <span class="cw-ui">+ Add more</span> → <span class="cw-ui">Account</span> <span class="cw-ui">Account Analytics</span> <span class="cw-ui">Read</span> satırını ekle.</div></li>
      <li><div>En altta <span class="cw-ui cfb">Continue to summary</span>, sonra <span class="cw-ui cfb">Create Token</span>.</div></li>
      <li><div>Çıkan anahtarın yanındaki <span class="cw-ui">Copy</span> ile kopyala. Cloudflare bu anahtarı <b>bir daha göstermez</b>; kaybedersen aynı adımlarla yenisini oluşturabilirsin.</div></li>
    </ol>
    <details class="cw-why"><summary>${ic("info", 13)} Bu anahtar neye izin verir?</summary>
      <table class="perm">
        <tr><td><code>Workers Scripts · Edit</code></td><td>Paylaşım servisini hesabına kurmak ve güncellemek</td></tr>
        <tr><td><code>Workers KV Storage · Edit</code></td><td>Videoları ve planları servisin deposunda saklamak</td></tr>
        <tr><td><code>Account Settings · Read</code></td><td>Hesabını bulmak</td></tr>
        <tr><td><code>Account Analytics · Read</code></td><td>İsteğe bağlı: günlük kullanım sayılarını göstermek</td></tr>
      </table>Şablondaki diğer izinler kullanılmaz. Anahtar yalnızca bu bilgisayarda saklanır; istediğin zaman Cloudflare'den silebilirsin.</details>
    <div class="foot cw-foot">${claudeSetupBtn("cloudflare", "Claude ile kur", "ghost")}<span class="grow"></span><button type="button" class="btn" data-cw="prev">${ic("chevron-left", 15)}Geri</button><button type="button" class="btn primary" data-cw="next">Anahtarı kopyaladım, devam${ic("chevron-right", 15)}</button></div>`;

  const runList = (cn) => {
    const steps = cn?.steps || [];
    if (!steps.length) return `<ul class="cw-run"><li class="run">${ic("loader-circle", 18, "spin")}<div><b>Başlatılıyor…</b></div></li></ul>`;
    const ok = steps.filter((s) => s.state === "ok").length;
    return `<div class="cw-prog"><div class="cv-meter"><i class="${cn.error ? "bad" : "ok"}" style="width:${pct(ok, steps.length)}%"></i></div><span>${ok}/${steps.length}</span></div>
      <ul class="cw-run">${steps.map((s) => `<li class="${esc(s.state)}">${s.state === "ok" ? ic("circle-check", 18) : s.state === "error" ? ic("circle-x", 18) : s.state === "run" ? ic("loader-circle", 18, "spin") : ic("circle-dashed", 18)}<div><b>${esc(s.label)}</b>${s.detail ? `<span>${esc(s.detail)}</span>` : ""}</div></li>`).join("")}</ul>`;
  };

  const step3 = () => {
    const d = C.data || {};
    const cn = d.connecting;
    const accs = d.accounts_choice || [];
    if (W.started && accs.length && !(cn && !cn.error) && !W.err) {
      return `<div class="cw-lead">Anahtarın birden fazla Cloudflare hesabına erişebiliyor. Servis hangi hesaba kurulsun?</div>
        <div class="cw-accs">${accs.map((a) => {
          const id = typeof a === "string" ? a : a.id;
          const name = typeof a === "string" ? a : a.name || a.id;
          return `<button type="button" class="cw-acc ${W.pick === id ? "on" : ""}" data-cwacc="${esc(id)}">${ic(W.pick === id ? "circle-check" : "user", 18)}<span><b>${esc(name)}</b><i>${esc(id)}</i></span></button>`;
        }).join("")}</div>
        <div class="foot cw-foot"><span class="grow"></span><button type="button" class="btn" data-cw="retoken">${ic("key-round", 15)}Anahtarı değiştir</button><button type="button" class="btn primary" data-cw="pick" ${W.pick ? "" : "disabled"}>${ic("plug", 15)}Bu hesapla kur</button></div>`;
    }
    if (W.started) {
      const err = W.err || cn?.error;
      return `<div class="cw-lead">${err ? "Kurulum yarıda kaldı." : "Stüdyo servisi hesabına kuruyor. Bu pencereyi kapatsan da kurulum arka planda sürer."}</div>
        ${cn || !err ? runList(cn) : ""}
        ${err ? `<div class="cw-err">${ic("circle-x", 20)}<div><b>Bağlanamadı</b><span>${esc(err)}</span>
            <ul>${/workers\.dev|subdomain|alt alan/i.test(err) ? `<li>Cloudflare panelinde soldaki <b>Workers &amp; Pages</b> sayfasını bir kez aç; workers.dev adresi istenirse onayla, sonra tekrar dene.</li>` : ""}<li>Anahtarı eksiksiz kopyaladığından emin ol (başında ve sonunda boşluk olmamalı).</li><li>Şablonun <b>Edit Cloudflare Workers</b> olduğunu ve <b>Account Resources</b>'ta hesabının seçili olduğunu kontrol et.</li><li>Cloudflare'de e-posta adresini doğruladığından emin ol.</li></ul></div></div>` : ""}
        <div class="foot cw-foot">${err ? `<span class="grow"></span><button type="button" class="btn" data-cw="retoken">${ic("key-round", 15)}Anahtarı değiştir</button>${W.token ? `<button type="button" class="btn primary" data-cw="again">${ic("refresh-cw", 15)}Tekrar dene</button>` : ""}` : `<span class="grow"></span><button type="button" class="btn" data-cw="close">Arka planda sürsün</button>`}</div>`;
    }
    return `<div class="cw-lead">Kopyaladığın anahtarı aşağıya yapıştır ve <b>Bağla</b>'ya bas. Stüdyo servisi hesabına kurar; her adımı burada görürsün.</div>
      <label for="cwToken">Cloudflare API anahtarı</label>
      <div class="row cw-tok"><input id="cwToken" type="password" autocomplete="off" spellcheck="false" placeholder="Anahtarı buraya yapıştır" class="grow"><button type="button" class="btn icon" data-cw="paste" title="Panodan yapıştır">${ic("clipboard-paste", 16)}</button></div>
      <div class="sm muted cw-keep">${ic("lock", 12)} Anahtar yalnızca bu bilgisayarda saklanır ve bir daha gösterilmez.</div>
      <div class="foot cw-foot"><span class="grow"></span><button type="button" class="btn" data-cw="prev">${ic("chevron-left", 15)}Geri</button><button type="button" class="btn primary" data-cw="go">${ic("plug", 15)}Bağla</button></div>`;
  };

  const step4 = () => {
    const d = C.data || {};
    const lo = (d.local_only || []).length;
    return `<div class="cw-done">
        <div class="cw-done-ic">${ic("cloud-check", 40)}</div>
        <h3>Bulut yayın hazır!</h3>
        <p>Bundan sonra planladığın Reels videoları buluta yüklenir ve saati gelince <b>bilgisayarın kapalı olsa da</b> paylaşılır.</p>
        ${d.url ? `<div class="cw-done-url">${ic("server", 13)}<span>${esc(d.url.replace(/^https?:\/\//, ""))}</span></div>` : ""}
        ${lo ? `<div class="cw-done-lo">${ic("info", 14)} Daha önce planlanmış ${lo} paylaşım şimdilik bilgisayarda bekliyor; Bulut panelinden tek tıkla buluta yükleyebilirsin.</div>` : ""}
      </div>
      <div class="foot cw-foot"><span class="grow"></span><button type="button" class="btn" data-cw="close">Kapat</button><button type="button" class="btn primary" data-cw="panel">${ic("cloud", 15)}Bulut panelini aç</button></div>`;
  };

  const body = () => `${stepper()}<div class="cw-body">${[step1, step2, step3, step4][W.step - 1]()}</div>`;

  X.modal(`<h2>${ic("cloud", 20)}Bulut yayını bağla</h2><div id="cwBody"></div>`, (m) => {
    const box = $("#cwBody", m);
    const draw = () => {
      const keep = $("#cwToken", box)?.value;
      box.innerHTML = body();
      const t = $("#cwToken", box);
      if (t) {
        if (keep) t.value = keep;
        t.onkeydown = (e) => {
          if (e.key === "Enter") $('[data-cw="go"]', box)?.click();
        };
      }
    };
    let polling = false;
    const watch = async () => {
      if (polling) return;
      polling = true;
      while (box.isConnected && W.step === 3) {
        await load(X);
        if (visible(X)) paint(X);
        if (!box.isConnected) break;
        const d = C.data || {};
        const cn = d.connecting;
        if (cn) W.seen = true;
        if (d.configured && !cn && W.started && (W.seen || !W.was)) {
          W.step = 4;
          W.token = "";
          X.refresh();
        }
        if ($("#cwToken", box) && !W.started) break;
        draw();
        if (W.step !== 3 || (cn?.error && W.started) || (d.accounts_choice?.length && !cn)) break;
        await new Promise((r) => setTimeout(r, 700));
      }
      polling = false;
    };
    const start = async (req) => {
      W.started = true;
      W.err = "";
      W.seen = false;
      W.was = !!C.data?.configured;
      C.data = { ...(C.data || {}), connecting: { steps: [], error: null }, accounts_choice: null };
      draw();
      try {
        const r = await X.api("/api/cloud/connect", req);
        if (r && typeof r === "object" && ("configured" in r || "connecting" in r || "accounts_choice" in r)) C.data = norm({ ...(C.data || {}), ...r });
      } catch (e) {
        W.err = e.message;
        await load(X);
        if (C.data?.accounts_choice?.length && !C.data.connecting) W.err = "";
        draw();
        return;
      }
      watch();
    };
    m.onclick = X.guard(async (e) => {
      if (e.target === m) {
        X.closeModal();
        return;
      }
      const acc = e.target.closest("[data-cwacc]");
      if (acc && box.contains(acc)) {
        W.pick = acc.getAttribute("data-cwacc");
        draw();
        return;
      }
      const b = e.target.closest("[data-cw]");
      if (!b || !box.contains(b)) return;
      const a = b.getAttribute("data-cw");
      if (a === "close") back();
      else if (a === "next") {
        W.step = Math.min(3, W.step + 1);
        draw();
        if (W.step === 3) setTimeout(() => $("#cwToken", box)?.focus(), 30);
      } else if (a === "prev") {
        W.step = Math.max(1, W.step - 1);
        draw();
      } else if (a === "paste") {
        try {
          const t = (await navigator.clipboard.readText()).trim();
          if (t) $("#cwToken", box).value = t;
        } catch {
          X.toast("Panoya erişilemedi; Ctrl+V ile yapıştır", true);
        }
      } else if (a === "go") {
        const v = ($("#cwToken", box)?.value || "").trim();
        if (!v) {
          X.toast("Önce anahtarı yapıştır", true);
          $("#cwToken", box)?.focus();
          return;
        }
        if (/\s/.test(v) || v.length < 20) {
          X.toast("Bu bir Cloudflare anahtarına benzemiyor; tamamını kopyaladığından emin ol", true);
          return;
        }
        W.token = v;
        await start({ api_token: v });
      } else if (a === "again") await start({ api_token: W.token });
      else if (a === "pick") await start(W.token ? { api_token: W.token, account_id: W.pick } : { account_id: W.pick });
      else if (a === "retoken") {
        W.started = false;
        W.err = "";
        W.token = "";
        W.pick = "";
        draw();
        setTimeout(() => $("#cwToken", box)?.focus(), 30);
      } else if (a === "panel") {
        X.closeModal();
        openCloud(X);
      }
    });
    draw();
    if (W.step === 3 && W.started) watch();
    load(X).then(() => {
      if (!box.isConnected) return;
      const d = C.data || {};
      if (W.step === 1 && d.configured && !d.connecting) {
        W.step = 4;
        draw();
      } else if (W.step === 1 && d.connecting && !d.connecting.error) {
        W.step = 3;
        W.started = true;
        draw();
        watch();
      }
    });
  }, "cw-dlg");
}
