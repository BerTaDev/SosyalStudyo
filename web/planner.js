import { renderCloudView, planModeSeg } from "/web/cloudview.js";
import { cloudMark, cloudState } from "/web/cloudmark.js";
import { ytState } from "/web/youtube.js";
import { ttState, TT_STUDIO } from "/web/tiktok.js";
import { targetsHtml, targetsReady, postTargets, defaultTargets, targetIcons, saveTargets, setTargets, confirmYtRemoval } from "/web/targets.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const DOW = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const DOW_LONG = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const MON = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const H0 = 0;
const H1 = 24;
const RH = 34;
const TIME_CHIPS = ["09:00", "12:00", "15:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
const HOT = new Set(["12:00", "19:00", "21:00"]);
const RHYTHMS = [
  { id: "1", name: "Günde 1", times: ["19:00"], every: 1 },
  { id: "2", name: "Günde 2", times: ["12:00", "19:00"], every: 1 },
  { id: "3", name: "Günde 3", times: ["12:00", "18:00", "21:00"], every: 1 },
  { id: "e2", name: "2 günde 1", times: ["19:00"], every: 2 },
];
const PREF_KEY = "sosyal-planner";

const p2 = (n) => String(n).padStart(2, "0");
const hm = (t) => `${p2(t.getHours())}:${p2(t.getMinutes())}`;
const dayKey = (t) => `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
const dayStr = (t) => `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
const startOfDay = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate());
const addDays = (t, n) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + n);
const monday = (t) => addDays(startOfDay(t), -((t.getDay() + 6) % 7));
const dowIdx = (t) => (t.getDay() + 6) % 7;
const local = (t) => `${dayStr(t)}T${hm(t)}`;
const thumb = (p) => (p.has_thumb ? `/media/${p.id}/thumb.jpg?v=${encodeURIComponent(p.updated)}` : "");
const parseDay = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function prefs() {
  const def = { view: "week", rhythm: "1", times: ["19:00"], every: 1, days: [0, 1, 2, 3, 4, 5, 6], gap: 3 };
  try {
    return Object.assign(def, JSON.parse(localStorage.getItem(PREF_KEY) || "{}"));
  } catch {
    return def;
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {}
}

function relDay(t) {
  const diff = Math.round((startOfDay(t) - startOfDay(new Date())) / 864e5);
  if (diff === 0) return "Bugün";
  if (diff === 1) return "Yarın";
  if (diff === -1) return "Dün";
  if (diff > 1 && diff < 7) return DOW_LONG[dowIdx(t)];
  return `${t.getDate()} ${MON[t.getMonth()].slice(0, 3)} ${DOW[dowIdx(t)]}`;
}
const when = (t) => `${relDay(t)} ${hm(t)}`;

function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)} dk önce`;
  if (m < 1440) return `${Math.round(m / 60)} saat önce`;
  return `${Math.round(m / 1440)} gün önce`;
}

function classify(S) {
  const g = { waiting: [], producing: [], planned: [], published: [], problem: [] };
  for (const p of S.posts || []) {
    if (p.status === "planlandi" || p.status === "paylasiliyor") g.planned.push(p);
    else if (p.status === "paylasildi") g.published.push(p);
    else if (p.status === "hata") g.problem.push(p);
    else if (p.status === "inceleme") (p.after_render?.action ? g.producing : g.waiting).push(p);
    else if (["sirada", "uretimde"].includes(p.status)) g.producing.push(p);
  }
  g.waiting.sort((a, b) => a.created.localeCompare(b.created));
  g.planned.sort((a, b) => (a.schedule || "").localeCompare(b.schedule || ""));
  return g;
}

function events(S) {
  const out = [];
  for (const p of S.posts || []) {
    if ((p.status === "planlandi" || p.status === "paylasiliyor") && p.schedule) out.push({ p, t: new Date(p.schedule), kind: p.status });
    else if (p.status === "paylasildi" && p.published?.at) out.push({ p, t: new Date(p.published.at), kind: "paylasildi" });
    else if (p.after_render?.action === "schedule" && p.after_render.at) out.push({ p, t: new Date(p.after_render.at), kind: "ghost" });
  }
  const live = out.filter((e) => e.kind !== "paylasildi");
  for (const e of live) e.clash = live.some((o) => o !== e && Math.abs(o.t - e.t) < 2 * 3600e3);
  return out.sort((a, b) => a.t - b.t);
}

function occupied(S, skip) {
  return events(S).filter((e) => e.kind !== "paylasildi" && !skip?.has(e.p.id)).map((e) => e.t);
}

export function suggest(S, n, opt, skip) {
  const taken = occupied(S, skip);
  const out = [];
  const now = Date.now();
  let day = startOfDay(opt.start || new Date());
  const times = [...opt.times].sort();
  for (let i = 0; out.length < n && i < 400; i++, day = addDays(day, 1)) {
    if (!opt.days.includes(dowIdx(day))) continue;
    if (opt.every > 1 && out.length && Math.round((startOfDay(day) - startOfDay(out[out.length - 1])) / 864e5) < opt.every) continue;
    let placed = false;
    for (const tm of times) {
      if (out.length >= n) break;
      if (opt.every > 1 && placed) break;
      const [h, m] = tm.split(":").map(Number);
      const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      if (t - now < 15 * 60000) continue;
      if (taken.some((x) => Math.abs(x - t) < opt.gap * 3600e3)) continue;
      taken.push(t);
      out.push(t);
      placed = true;
    }
  }
  return out;
}

function quickSlot(S, p) {
  const pr = prefs();
  return suggest(S, 1, { times: pr.times, days: pr.days, every: 1, gap: pr.gap }, new Set([p.id]))[0];
}

function stat(ic, icon, n, label, sub, cls = "") {
  return `<div class="pl-stat ${cls}"><div class="pl-stat-ic">${ic(icon, 18)}</div><div><b>${n}</b><span>${label}</span>${sub ? `<i>${sub}</i>` : ""}</div></div>`;
}

export function renderPlanner(X, force = false) {
  const { S, ic, esc } = X;
  const el = $("#calendarView");
  if (!el) return;
  if (S.planMode === "cloud") return renderCloudView(X, el, force);
  const pr = prefs();
  S.plan ||= { view: pr.view, anchor: null };
  const g = classify(S);
  const evs = events(S);
  const sel = S.planSel;
  const sig = JSON.stringify([S.plan, (S.posts || []).map((p) => [p.id, p.status, p.schedule, p.updated, p.after_render, p.cloud?.state, p.youtube?.state, p.youtube?.enabled, p.targets, p.tiktok?.state, p.tiktok?.enabled, p.tiktok?.code]), S.cloud?.configured, S.cloud?.enabled, S.youtube?.connected, new Date().getHours(), sel ? [...sel] : null]);
  if (!force && (sig === S.planSig || S.planDrag || $(".pl-pop") || !$("#modal").classList.contains("hidden"))) return;
  S.planSig = sig;
  const scroll = $(".pl-week-body", el)?.scrollTop;
  const sideScroll = $(".pl-side", el)?.scrollTop || 0;

  const now = new Date();
  const today = startOfDay(now);
  const in7 = evs.filter((e) => e.kind !== "paylasildi" && e.t >= now && e.t < addDays(today, 7));
  const emptyDays = [...Array(7)].map((_, i) => addDays(today, i)).filter((d) => !in7.some((e) => dayKey(e.t) === dayKey(d))).length;
  const clashes = evs.filter((e) => e.clash && e.t >= now).length / 2;
  const pub30 = g.published.filter((p) => p.published?.at && now - new Date(p.published.at) < 30 * 864e5).length;
  const next = g.planned.find((p) => p.schedule && new Date(p.schedule) >= now);
  const autoCount = g.producing.filter((p) => p.after_render?.action).length;

  const stats = `<div class="pl-stats">
    ${stat(ic, "inbox", g.waiting.length, "Planlanmayı bekliyor", g.waiting.length ? "Sürükle ya da Akıllı planla" : "Hepsi yerinde", g.waiting.length ? "warn" : "ok")}
    ${stat(ic, "calendar-check", g.planned.length, "Planlı", next ? `Sıradaki: ${when(new Date(next.schedule))}` : "Planlı video yok", "blue")}
    ${stat(ic, "clapperboard", g.producing.length, "Üretimde", autoCount ? `${autoCount} tanesi bitince otomatik` : g.producing.length ? "Bitince burada görünür" : "", "")}
    ${stat(ic, "calendar-range", in7.length, "Önümüzdeki 7 gün", emptyDays ? `${emptyDays} boş gün` : "Her gün dolu", emptyDays >= 4 ? "warn" : "ok")}
    ${stat(ic, "send", pub30, "Son 30 günde paylaşıldı", "", "green")}
  </div>`;

  const pick = (p) => (sel ? `data-pick="${p.id}"` : "");
  const picked = (p) => (sel?.has(p.id) ? " picked" : "");
  const box = (p) => (sel ? `<span class="pl-sel">${sel.has(p.id) ? ic("check", 12) : ""}</span>` : "");
  const waitCard = (p) => {
    const s = quickSlot(S, p);
    return `<div class="pl-card${picked(p)}" draggable="true" data-drag="${p.id}" ${pick(p)}>${box(p)}
      <div class="pl-thumb" style="${thumb(p) ? `background-image:url('${thumb(p)}')` : ""}">${thumb(p) ? "" : ic("film", 16)}</div>
      <div class="grow">
        <div class="pl-ct">${esc(p.title)}</div>
        <div class="pl-cs">#${p.id}${p.duration ? ` · ${Math.round(p.duration)} sn` : ""} · ${ago(p.updated)}${p.autopilot ? ` · ${ic("rocket", 11)}` : ""}</div>
        ${p.no_caption ? `<div class="pl-warn">${ic("triangle-alert", 12)}Açıklama boş</div>` : p.stage?.startsWith("Otomatik paylaşılamadı") ? `<div class="pl-warn">${ic("triangle-alert", 12)}${esc(p.stage)}</div>` : ""}
        <div class="pl-cact">${s ? `<button class="btn sm pl-quick" data-quick="${p.id}" data-at="${local(s)}" title="Önerilen boş saat">${ic("calendar-plus", 13)}${when(s)}</button>` : ""}<button class="btn sm ghost icon" data-open="${p.id}" title="İçeriği aç">${ic("external-link", 13)}</button></div>
      </div>
      <span class="pl-grip">${ic("grip-vertical", 14)}</span>
    </div>`;
  };
  const prodCard = (p) => {
    const ar = p.after_render;
    const plan = ar?.action === "publish" ? `${ic("send", 12)}Bitince hemen paylaşılacak` : ar?.action === "schedule" ? `${ic("calendar-clock", 12)}Bitince ${when(new Date(ar.at))}` : `${ic("circle-dashed", 12)}Bitince İncelemede bekleyecek`;
    return `<div class="pl-card prod${picked(p)}" data-open="${p.id}" ${pick(p)}>${box(p)}
      <div class="pl-thumb" style="${thumb(p) ? `background-image:url('${thumb(p)}')` : ""}">${thumb(p) ? "" : ic("loader-circle", 16, p.status === "uretimde" ? "spin" : "")}</div>
      <div class="grow"><div class="pl-ct">${esc(p.title)}</div>
        <div class="pl-cs">${p.status === "sirada" ? "Sırada" : p.status === "inceleme" ? "Hazır, otomatik işleniyor" : esc(p.stage || "Üretimde")}</div>
        ${p.status === "uretimde" ? `<div class="pl-prog"><i style="width:${Math.round((p.progress || 0) * 100)}%"></i></div>` : ""}
        <div class="pl-auto ${ar?.action ? "on" : ""}">${plan}${p.autopilot ? ` · ${ic("rocket", 11)} Otopilot` : ""}</div></div>
    </div>`;
  };
  const probCard = (p) => `<div class="pl-card prob${picked(p)}" ${p.video || p.media?.length ? `draggable="true" data-drag="${p.id}"` : ""} ${pick(p)}>${box(p)}
      <div class="pl-thumb" style="${thumb(p) ? `background-image:url('${thumb(p)}')` : ""}">${thumb(p) ? "" : ic("triangle-alert", 16)}</div>
      <div class="grow"><div class="pl-ct">${esc(p.title)}</div>
        <div class="pl-cs bad">${esc(p.error || p.stage || "Hata")}</div>
        <div class="pl-cact"><button class="btn sm ghost" data-open="${p.id}">${ic("external-link", 13)}Aç</button>${p.video || p.media?.length ? `<span class="sm muted">ya da takvime sürükle</span>` : ""}</div></div>
    </div>`;

  const side = `<aside class="pl-side">
    <button class="btn primary wide pl-smart" id="plSmart" ${g.waiting.length ? "" : "disabled"}>${ic("wand-sparkles", 16)}Akıllı planla${g.waiting.length ? ` (${g.waiting.length})` : ""}</button>
    <div class="pl-sec"><h4>${ic("inbox", 13)}Planlanmayı bekleyenler <span class="pl-n">${g.waiting.length}</span></h4>
      ${g.waiting.length ? g.waiting.map(waitCard).join("") : `<div class="pl-empty">${ic("circle-check", 18)}Hazır olup planlanmamış video yok.</div>`}</div>
    ${g.problem.length ? `<div class="pl-sec"><h4 class="bad">${ic("triangle-alert", 13)}İlgini bekleyenler <span class="pl-n">${g.problem.length}</span></h4>${g.problem.map(probCard).join("")}</div>` : ""}
    <div class="pl-sec"><h4>${ic("clapperboard", 13)}Üretimde <span class="pl-n">${g.producing.length}</span></h4>
      ${g.producing.length ? g.producing.map(prodCard).join("") : `<div class="pl-empty sm">Üretilen video yok.</div>`}</div>
  </aside>`;

  const view = S.plan.view;
  let range;
  let grid;
  if (view === "week") {
    const start = S.plan.anchor ? startOfDay(new Date(S.plan.anchor)) : today;
    const days = [...Array(7)].map((_, i) => addDays(start, i));
    const end = days[6];
    range = start.getMonth() === end.getMonth() ? `${start.getDate()}–${end.getDate()} ${MON[end.getMonth()]} ${end.getFullYear()}` : `${start.getDate()} ${MON[start.getMonth()].slice(0, 3)} – ${end.getDate()} ${MON[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`;
    const rows = H1 - H0;
    const col = (d) => {
      const k = dayKey(d);
      const list = evs.filter((e) => dayKey(e.t) === k);
      const lanes = [];
      const placed = list.map((e) => {
        const top = Math.max(0, (e.t.getHours() + e.t.getMinutes() / 60 - H0) * RH);
        let lane = lanes.findIndex((end) => end <= top);
        if (lane < 0) lane = lanes.length;
        lanes[lane] = top + RH - 2;
        return { e, top, lane };
      });
      const n = Math.max(1, lanes.length);
      const isToday = k === dayKey(today);
      const past = d < today;
      const nowTop = (now.getHours() + now.getMinutes() / 60 - H0) * RH;
      return `<div class="pl-col ${isToday ? "today" : ""} ${past ? "past" : ""}" data-col="${dayStr(d)}">
        ${isToday && nowTop > 0 ? `<div class="pl-pastfill" style="height:${Math.min(rows * RH, nowTop)}px"></div><div class="pl-now" style="top:${nowTop}px"></div>` : ""}
        ${!past && !list.some((e) => e.kind !== "paylasildi") ? `<div class="pl-emptyday">${ic("plus", 14)}Boş gün</div>` : ""}
        ${placed.map(({ e, top, lane }) => evHtml(X, e, `top:${top}px;left:calc(${(lane / n) * 100}% + 3px);width:calc(${100 / n}% - 6px)`, false, sel)).join("")}
      </div>`;
    };
    grid = `<div class="pl-week">
      <div class="pl-week-head"><span></span>${days.map((d) => {
        const k = dayKey(d);
        const cnt = evs.filter((e) => dayKey(e.t) === k).length;
        return `<div class="pl-dh ${k === dayKey(today) ? "today" : ""} ${d < today ? "past" : ""} ${dowIdx(d) >= 5 ? "we" : ""}"><span>${DOW[dowIdx(d)]}</span><b>${d.getDate()}</b>${cnt ? `<i>${cnt}</i>` : ""}</div>`;
      }).join("")}</div>
      <div class="pl-week-body"><div class="pl-week-grid" style="height:${rows * RH}px">
        <div class="pl-hours">${[...Array(rows)].map((_, i) => `<span style="top:${i * RH}px">${p2(H0 + i)}:00</span>`).join("")}</div>
        ${days.map(col).join("")}
      </div></div>
    </div>`;
  } else {
    const base = S.plan.anchor ? new Date(S.plan.anchor) : now;
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const start = monday(first);
    const weeks = Math.ceil((dowIdx(first) + new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) / 7);
    range = `${MON[first.getMonth()]} ${first.getFullYear()}`;
    let cells = "";
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(start, i);
      const k = dayKey(d);
      const list = evs.filter((e) => dayKey(e.t) === k);
      cells += `<div class="pl-mday ${d.getMonth() !== first.getMonth() ? "other" : ""} ${k === dayKey(today) ? "today" : ""} ${d < today ? "past" : ""}" data-mday="${dayStr(d)}">
        <span class="pl-mn">${d.getDate()}</span>
        ${list.slice(0, 4).map((e) => evHtml(X, e, "", true, sel)).join("")}${list.length > 4 ? `<span class="pl-more">+${list.length - 4} daha</span>` : ""}
      </div>`;
    }
    grid = `<div class="pl-month"><div class="pl-mhead">${DOW.map((x) => `<span>${x}</span>`).join("")}</div><div class="pl-mgrid">${cells}</div></div>`;
  }

  const hints = [];
  if (g.waiting.length) hints.push(`<button class="pl-hint warn" data-hint="smart">${ic("inbox", 13)}${g.waiting.length} video planlanmayı bekliyor</button>`);
  if (emptyDays && g.waiting.length) hints.push(`<span class="pl-hint">${ic("calendar-x", 13)}Önümüzdeki 7 günde ${emptyDays} boş gün</span>`);
  if (clashes >= 1) hints.push(`<span class="pl-hint bad">${ic("triangle-alert", 13)}${Math.round(clashes)} çakışma: 2 saatten yakın paylaşımlar</span>`);
  if (!hints.length) hints.push(`<span class="pl-hint ok">${ic("circle-check", 13)}Plan düzenli görünüyor</span>`);

  const canSel = targetsReady(S);
  const selbar = sel ? selBarHtml(X, sel) : "";
  el.innerHTML = `<div class="pl${sel ? " selecting" : ""}">
    ${stats}
    <div class="pl-body">
      ${side}
      <section class="pl-main">
        <div class="pl-bar">
          ${planModeSeg(X, "cal")}
          <div class="row"><button class="btn icon sm" data-nav="-1">${ic("chevron-left", 16)}</button><button class="btn sm" data-nav="0">Bugün</button><button class="btn icon sm" data-nav="1">${ic("chevron-right", 16)}</button><h2>${range}</h2></div>
          <span class="grow"></span>
          <div class="pl-hints">${hints.join("")}</div>
          ${canSel ? `<button class="btn sm ${sel ? "primary" : ""}" data-selmode title="Birden fazla içeriği seçip paylaşım yerlerini toplu değiştir">${ic(sel ? "check" : "list-checks", 14)}${sel ? "Bitti" : "Seç"}</button>` : ""}
          <div class="seg sm"><button data-view="week" class="${view === "week" ? "active" : ""}">Hafta</button><button data-view="month" class="${view === "month" ? "active" : ""}">Ay</button></div>
        </div>
        ${selbar}
        ${grid}
        <div class="pl-legend sm"><span><i class="planlandi"></i>Planlı</span><span><i class="ghost"></i>Video bitince planlanacak</span><span><i class="paylasildi"></i>Paylaşıldı</span><span><i class="clash"></i>Çakışma</span><span class="pl-lgm">${ic("instagram", 12)}Instagram</span><span class="pl-lgm">${ic("youtube", 12)}YouTube</span><span class="pl-lgm">${ic("music", 12)}TikTok</span><span class="muted">Bekleyen bir videoyu takvimde istediğin saate sürükle; planlı videoları sürükleyerek taşı.</span></div>
      </section>
    </div>
  </div>`;
  const wb = $(".pl-week-body", el);
  if (wb) wb.scrollTop = scroll ?? Math.min(Math.max(now.getHours() - 2, 8), 15) * RH;
  $(".pl-side", el).scrollTop = sideScroll;
  bind(X, el);
}

function evHtml(X, e, style, compact = false, sel = null) {
  const { ic, esc } = X;
  const p = e.p;
  const drag = e.kind === "planlandi" || e.kind === "ghost";
  const can = sel && e.kind !== "paylasildi";
  return `<div class="pl-ev ${e.kind} ${e.clash ? "clash" : ""} ${compact ? "compact" : ""}${can && sel.has(p.id) ? " picked" : ""}" data-ev="${p.id}" ${can ? `data-pick="${p.id}"` : ""} ${drag ? `draggable="true" data-drag="${p.id}"` : ""} style="${style}" title="${esc(`${hm(e.t)} · ${p.title}`)}">
    ${can ? `<span class="pl-sel">${sel.has(p.id) ? ic("check", 9) : ""}</span>` : ""}${!compact && !can && thumb(p) ? `<span class="pl-evth" style="background-image:url('${thumb(p)}')"></span>` : ""}
    <span class="pl-evt">${hm(e.t)}</span><span class="pl-evn">${esc(p.title)}</span><span class="pl-evbs">${cloudMark(X, p, compact ? 10 : 12)}${targetIcons(X, p, compact ? 10 : 12)}${p.autopilot ? `<span class="pl-evb">${ic("rocket", 10)}</span>` : ""}${e.kind === "ghost" ? `<span class="pl-evb">${ic("hourglass", 10)}</span>` : ""}</span>
  </div>`;
}

const BULK = [
  ["yt-add", "youtube", "YouTube'a da ekle", { youtube: true }, "Seçilenler YouTube Shorts olarak da paylaşılacak"],
  ["yt-only", "youtube", "Yalnızca YouTube", { instagram: false, youtube: true }, "Seçilenler yalnızca YouTube'da paylaşılacak"],
  ["ig-add", "instagram", "Instagram'a ekle", { instagram: true }, "Seçilenler Instagram'da da paylaşılacak"],
  ["yt-rm", "x", "YouTube'dan çıkar", { youtube: false }, "Seçilenler YouTube'a yüklenmeyecek"],
  ["ig-rm", "x", "Instagram'dan çıkar", { instagram: false }, "Seçilenler Instagram'da paylaşılmayacak"],
];

function selectable(S) {
  const g = classify(S);
  return [...g.planned, ...g.waiting, ...g.producing, ...g.problem].filter((p) => p.status !== "paylasiliyor").map((p) => p.id);
}

function selBarHtml(X, sel) {
  const { ic, S } = X;
  const n = sel.size;
  const all = selectable(S);
  const yt = !!S.youtube?.connected;
  return `<div class="pl-selbar"><b>${n ? `${n} içerik seçili` : "Takvimden ya da soldan içerik seç"}</b>
    <button class="btn sm ghost" data-selall>${ic("list-checks", 13)}${n && n === all.length ? "Seçimi temizle" : `Tümünü seç (${all.length})`}</button>
    <span class="grow"></span>
    ${BULK.filter(([k]) => yt || !k.startsWith("yt-") || k === "yt-rm").map(([k, icon, label]) => `<button class="btn sm${k === "yt-add" ? " primary" : ""}" data-bulk="${k}" ${n ? "" : "disabled"}>${ic(icon, 13)}${label}</button>`).join("")}
  </div>`;
}

async function runBulk(X, key) {
  const { S, toast } = X;
  const b = BULK.find((x) => x[0] === key);
  const ids = [...(S.planSel || [])];
  if (!b || !ids.length) return;
  const go = async () => {
    try {
      const r = await X.api("/api/posts/targets", { ids, ...b[3] });
      const sk = r.skipped || [];
      const why = [...new Set(sk.map((x) => x.reason))].slice(0, 2).join("; ");
      toast(sk.length ? `${r.updated.length} içerik güncellendi, ${sk.length} atlandı: ${why}` : `${b[4]} (${r.updated.length})`, !!sk.length && !r.updated.length);
    } catch (e) {
      toast(e.message, true);
    }
    await X.refresh();
    renderPlanner(X, true);
  };
  const live = ids.map((id) => S.posts.find((p) => p.id === id)).filter((p) => b[3].youtube === false && ["scheduled", "uploading"].includes(p?.youtube?.state));
  if (live.length) X.confirm("YouTube'daki videolar silinsin mi?", `Seçilenlerden ${live.length} tanesi YouTube'a yüklendi. YouTube'dan çıkarırsan bu videolar YouTube'dan silinir.`, "Çıkar ve sil", go);
  else go();
}

async function scheduleAt(X, id, t) {
  const { S, api, toast } = X;
  const p = S.posts.find((x) => x.id === id);
  if (!p) return;
  if (t - Date.now() < 60000) return toast("Geçmiş bir saate planlanamaz", true);
  try {
    if (p.status === "sirada" || p.status === "uretimde" || (p.after_render?.action && p.status !== "inceleme")) {
      await api(`/api/posts/${id}/after-render`, { action: "schedule", at: local(t) });
      toast(`Video bitince ${when(t)} için planlanacak`);
    } else {
      await api(`/api/posts/${id}/schedule`, { at: local(t) });
      toast(`Planlandı: ${when(t)} · ${p.title}`);
    }
    await X.refresh();
    S.planSig = "";
    renderPlanner(X, true);
  } catch (e) {
    toast(e.message, true);
  }
}

function bind(X, el) {
  const { S, api, toast } = X;
  const root = $(".pl", el);
  root.onclick = async (e) => {
    if (e.target.closest("[data-selmode]")) {
      S.planSel = S.planSel ? null : new Set();
      return renderPlanner(X, true);
    }
    if (S.planSel) {
      if (e.target.closest("[data-selall]")) {
        const all = selectable(S);
        S.planSel = S.planSel.size === all.length ? new Set() : new Set(all);
        return renderPlanner(X, true);
      }
      const bk = e.target.closest("[data-bulk]");
      if (bk) return runBulk(X, bk.dataset.bulk);
      const pk = e.target.closest("[data-pick]");
      if (pk) {
        e.stopPropagation();
        const id = pk.dataset.pick;
        S.planSel.has(id) ? S.planSel.delete(id) : S.planSel.add(id);
        return renderPlanner(X, true);
      }
    }
    const pm = e.target.closest("[data-plmode]");
    if (pm) {
      S.planMode = pm.dataset.plmode;
      return renderPlanner(X, true);
    }
    const nav = e.target.closest("[data-nav]");
    if (nav) {
      const d = +nav.dataset.nav;
      const base = S.plan.anchor ? new Date(S.plan.anchor) : new Date();
      S.plan.anchor = d === 0 ? null : (S.plan.view === "week" ? addDays(base, 7 * d) : new Date(base.getFullYear(), base.getMonth() + d, 1)).toISOString();
      return renderPlanner(X, true);
    }
    const v = e.target.closest("[data-view]");
    if (v) {
      S.plan.view = v.dataset.view;
      const pr = prefs();
      pr.view = S.plan.view;
      savePrefs(pr);
      return renderPlanner(X, true);
    }
    const q = e.target.closest("[data-quick]");
    if (q) {
      e.stopPropagation();
      const [d, t] = q.dataset.at.split("T");
      const [h, m] = t.split(":").map(Number);
      const day = parseDay(d);
      return scheduleAt(X, q.dataset.quick, new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m));
    }
    if (e.target.closest("#plSmart") || e.target.closest('[data-hint="smart"]')) return openSmart(X);
    const ev = e.target.closest("[data-ev]");
    if (ev) return openPop(X, ev.dataset.ev, ev);
    const op = e.target.closest("[data-open]");
    if (op) {
      X.setTab("posts");
      return X.select(op.dataset.open);
    }
    const empty = e.target.closest(".pl-emptyday");
    if (empty) {
      const g = classify(S);
      if (!g.waiting.length) return toast("Planlanmayı bekleyen video yok");
      const day = parseDay(empty.closest("[data-col]").dataset.col);
      const pr = prefs();
      const s = suggest(S, 1, { start: day, times: pr.times, days: [dowIdx(day)], every: 1, gap: pr.gap })[0];
      if (!s || dayKey(s) !== dayKey(day)) return toast("Bu günde uygun boş saat yok; takvime sürükleyerek saat seç", true);
      return scheduleAt(X, g.waiting[0].id, s);
    }
  };

  let ind = null;
  const clearInd = () => {
    ind?.remove();
    ind = null;
    for (const c of $$(".drop", root)) c.classList.remove("drop");
  };
  root.ondragstart = (e) => {
    const d = e.target.closest("[data-drag]");
    if (!d) return;
    S.planDrag = d.dataset.drag;
    e.dataTransfer.setData("text/plain", d.dataset.drag);
    e.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => d.classList.add("dragging"));
    root.classList.add("is-dragging");
  };
  root.ondragend = (e) => {
    e.target.closest?.("[data-drag]")?.classList.remove("dragging");
    root.classList.remove("is-dragging");
    S.planDrag = null;
    clearInd();
  };
  const colTime = (col, y) => {
    const r = col.getBoundingClientRect();
    const hours = Math.max(0, Math.min(H1 - H0 - 0.5, (y - r.top) / RH));
    const mins = Math.round((hours * 60) / 30) * 30;
    const day = parseDay(col.dataset.col);
    return { t: new Date(day.getFullYear(), day.getMonth(), day.getDate(), H0, mins), top: (mins / 60) * RH };
  };
  root.ondragover = (e) => {
    if (!S.planDrag) return;
    const col = e.target.closest("[data-col]");
    const md = e.target.closest("[data-mday]");
    if (!col && !md) return;
    e.preventDefault();
    if (col) {
      const { t, top } = colTime(col, e.clientY);
      const past = t - Date.now() < 60000;
      if (!ind || ind.parentNode !== col) {
        clearInd();
        ind = document.createElement("div");
        ind.className = "pl-drop";
        col.append(ind);
      }
      ind.style.top = `${top}px`;
      ind.classList.toggle("bad", past);
      ind.textContent = past ? "Geçmiş saat" : `${DOW[dowIdx(t)]} ${hm(t)}`;
      e.dataTransfer.dropEffect = past ? "none" : "move";
    } else {
      if (!md.classList.contains("drop")) {
        clearInd();
        md.classList.add("drop");
      }
    }
  };
  root.ondragleave = (e) => {
    if (!root.contains(e.relatedTarget)) clearInd();
  };
  root.ondrop = (e) => {
    const id = e.dataTransfer.getData("text/plain") || S.planDrag;
    const col = e.target.closest("[data-col]");
    const md = e.target.closest("[data-mday]");
    if (!id || (!col && !md)) return;
    e.preventDefault();
    clearInd();
    S.planDrag = null;
    if (col) return scheduleAt(X, id, colTime(col, e.clientY).t);
    const day = parseDay(md.dataset.mday);
    const pr = prefs();
    const s = suggest(S, 1, { start: day, times: pr.times, days: [dowIdx(day)], every: 1, gap: 0 }, new Set([id]))[0];
    if (!s || dayKey(s) !== dayKey(day)) return toast("Bu gün için ileri bir saat kalmadı", true);
    scheduleAt(X, id, s);
  };
}

function openPop(X, id, anchor) {
  const { S, ic, esc, api, toast } = X;
  closePop();
  const p = S.posts.find((x) => x.id === id);
  if (!p) return;
  const ev = events(S).find((e) => e.p.id === id);
  const pop = document.createElement("div");
  pop.className = "pl-pop";
  const status = ev?.kind === "ghost" ? `${ic("hourglass", 13)}Video bitince planlanacak` : p.status === "paylasildi" ? `${ic("circle-check", 13)}Paylaşıldı` : p.status === "paylasiliyor" ? `${ic("loader-circle", 13, "spin")}Paylaşılıyor` : `${ic("calendar-check", 13)}Planlı`;
  const cs = cloudState(S, p);
  const ys = ytState(S, p);
  let ts = null;
  try {
    ts = ttState(S, p);
  } catch {}
  pop.innerHTML = `<div class="pl-pop-top"><div class="pl-thumb lg" style="${thumb(p) ? `background-image:url('${thumb(p)}')` : ""}">${thumb(p) ? "" : ic("film", 18)}</div>
      <div class="grow"><div class="pl-ct">${esc(p.title)}</div><div class="pl-pop-st ${ev?.kind || ""}">${status}</div>
        ${ev ? `<div class="pl-pop-t">${relDay(ev.t)}, ${ev.t.getDate()} ${MON[ev.t.getMonth()]} · <b>${hm(ev.t)}</b></div>` : ""}
        ${cs ? `<div class="pl-pop-cl ${cs.cls}">${ic(cs.icon, 13)}<span>${esc(cs.label)}</span></div>` : ""}
        ${ys ? `<div class="pl-pop-cl yt-${ys.cls}">${ic("youtube", 13)}<span>${esc(ys.label)}</span></div>` : ""}
        ${ts ? `<div class="pl-pop-cl tt-${ts.cls}">${ic("music", 13)}<span>${esc(ts.label)}</span></div>` : ""}
        ${ev?.clash ? `<div class="pl-warn">${ic("triangle-alert", 12)}2 saatten yakın başka paylaşım var</div>` : ""}
        ${p.autopilot ? `<div class="sm muted">${ic("rocket", 11)} Otopilot</div>` : ""}</div></div>
    ${targetsReady(S) && (p.status === "planlandi" || ev?.kind === "ghost") ? targetsHtml(X, postTargets(S, p), { kind: p.kind, id: "popTargets", post: p }) : ""}
    <div class="pl-pop-act">
      <button class="btn sm" data-a="open">${ic("external-link", 13)}İçeriği aç</button>
      ${p.status === "planlandi" ? `<button class="btn sm" data-a="unplan">${ic("calendar-x", 13)}Planı kaldır</button>` : ""}
      ${cs?.can ? `<button class="btn sm" data-a="cloud">${ic("cloud-upload", 13)}Buluta yükle</button>` : ""}
      ${ev?.kind === "ghost" ? `<button class="btn sm" data-a="unauto">${ic("x", 13)}Otomatik planı iptal et</button>` : ""}
      ${p.published?.permalink ? `<a class="btn sm" href="${esc(p.published.permalink)}" target="_blank">${ic("instagram", 13)}Instagram'da aç</a>` : ""}
      ${ys && p.youtube?.url && (p.youtube.state === "published" || p.youtube.state === "private_locked") ? `<a class="btn sm" href="${esc(p.youtube.url)}" target="_blank">${ic("youtube", 13)}YouTube'da aç</a>` : ""}
      ${ts && (p.tiktok.state === "scheduled" || p.tiktok.state === "published") ? `<a class="btn sm" href="${TT_STUDIO}" target="_blank" rel="noopener">${ic("music", 13)}TikTok Studio</a>` : ""}
    </div>
    ${p.status === "planlandi" || ev?.kind === "ghost" ? `<div class="sm muted pl-pop-tip">Saati değiştirmek için takvimde sürükle.</div>` : ""}`;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  pop.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2))}px`;
  pop.style.top = `${r.bottom + h + 12 < innerHeight ? r.bottom + 8 : Math.max(10, r.top - h - 8)}px`;
  const row = $("#popTargets", pop);
  if (row)
    row.addEventListener("tgchange", (e) => {
      const { value, before } = e.detail;
      const send = X.guard(async () => {
        setTargets(row, value);
        row.classList.add("busy");
        try {
          await saveTargets(X, id, value);
        } catch (err) {
          setTargets(row, before);
          row.classList.remove("busy");
          throw err;
        }
        await X.refresh();
        closePop();
        renderPlanner(X, true);
        const again = $(`.pl [data-ev="${id}"]`);
        if (again) openPop(X, id, again);
      });
      confirmYtRemoval(X, p, value, send, () => setTargets(row, before));
    });
  if (row)
    row.addEventListener("tkchange", () => {
      if (!row.isConnected) return;
      closePop();
      renderPlanner(X, true);
      const again = $(`.pl [data-ev="${id}"]`);
      if (again) openPop(X, id, again);
    });
  pop.onclick = X.guard(async (e) => {
    const a = e.target.closest("[data-a]")?.dataset.a;
    if (!a) return;
    if (a === "open") {
      closePop();
      X.setTab("posts");
      return X.select(id);
    }
    if (a === "unplan") await api(`/api/posts/${id}/unschedule`, {});
    if (a === "unauto") await api(`/api/posts/${id}/after-render`, { action: "" });
    if (a === "cloud") await api(`/api/cloud/jobs/${id}/upload`, {});
    closePop();
    toast(a === "unplan" ? "Plan kaldırıldı; video bekleyenlere döndü" : a === "cloud" ? "Buluta yükleniyor; ilerlemeyi Bulut panelinde görebilirsin" : "Otomatik plan iptal edildi");
    await X.refresh();
    renderPlanner(X, true);
  });
  const outside = (e) => {
    if (!pop.isConnected) return document.removeEventListener("mousedown", outside, true);
    if (!pop.contains(e.target) && !e.target.closest("[data-ev]")) closePop();
  };
  const esc2 = (e) => {
    if (e.key === "Escape") closePop();
  };
  pop._off = () => {
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", esc2, true);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", esc2, true);
  }, 0);
}

function closePop() {
  for (const p of $$(".pl-pop")) {
    p._off?.();
    p.remove();
  }
}

function openSmart(X) {
  const { S, ic, esc, api, toast } = X;
  closePop();
  const waiting = classify(S).waiting;
  if (!waiting.length) return toast("Planlanmayı bekleyen video yok");
  const pr = prefs();
  const st = { ids: new Set(waiting.map((p) => p.id)), order: waiting.map((p) => p.id), rhythm: pr.rhythm, times: [...pr.times], every: pr.every, days: [...pr.days], gap: pr.gap, start: 0 };
  const useTg = targetsReady(S);
  const tgs = waiting.map((p) => JSON.stringify(postTargets(S, p)));
  st.mixed = !tgs.every((x) => x === tgs[0]);
  st.targets = st.mixed ? defaultTargets(S) : postTargets(S, waiting[0]);
  const own = () => st.mixed && !st.touched;
  const reels = (p) => (p.kind || "reels") === "reels";
  const eff = (p) => (own() ? postTargets(S, p) : st.targets);
  const fits = (p) => !useTg || eff(p).instagram || reels(p);
  const tgIcons = (p) => (useTg && fits(p) ? `<span class="sm-tgi">${eff(p).instagram ? ic("instagram", 12) : ""}${eff(p).youtube && reels(p) ? ic("youtube", 12) : ""}</span>` : "");
  const starts = [...Array(14)].map((_, i) => addDays(startOfDay(new Date()), i));

  const plan = () => {
    const list = st.order.filter((id) => st.ids.has(id) && fits(S.posts.find((x) => x.id === id) || {}));
    const slots = suggest(S, list.length, { start: starts[st.start], times: st.times, days: st.days, every: st.every, gap: st.gap }, new Set(list));
    return list.map((id, i) => ({ p: S.posts.find((x) => x.id === id), t: slots[i] }));
  };

  const body = () => {
    const rows = plan();
    const ok = rows.filter((r) => r.t);
    const first = ok[0]?.t;
    const last = ok[ok.length - 1]?.t;
    const map = new Map(rows.map((r) => [r.p.id, r.t]));
    return `<div class="sm-grid">
      <div class="sm-opts">
        <label>Sıklık</label>
        <div class="seg sm" data-g="rhythm">${RHYTHMS.map((r) => `<button data-v="${r.id}" class="${st.rhythm === r.id ? "active" : ""}">${r.name}</button>`).join("")}</div>
        <label>Saatler <span class="muted">(birden fazla seçebilirsin)</span></label>
        <div class="chips sm-times" data-g="times">${TIME_CHIPS.map((t) => `<button data-v="${t}" class="${st.times.includes(t) ? "active" : ""}">${HOT.has(t) ? ic("flame", 11) : ""}${t}</button>`).join("")}</div>
        <label>Günler</label>
        <div class="sm-days" data-g="days">${DOW.map((d, i) => `<button data-v="${i}" class="${st.days.includes(i) ? "active" : ""} ${i >= 5 ? "we" : ""}">${d}</button>`).join("")}</div>
        <label>Başlangıç</label>
        <div class="sm-start" data-g="start">${starts.map((d, i) => `<button data-v="${i}" class="${st.start === i ? "active" : ""}"><span>${i === 0 ? "Bugün" : i === 1 ? "Yarın" : DOW[dowIdx(d)]}</span><b>${d.getDate()}</b></button>`).join("")}</div>
        <label>Diğer paylaşımlarla arasında en az</label>
        <div class="seg sm" data-g="gap">${[1, 2, 3, 4, 6].map((h) => `<button data-v="${h}" class="${st.gap === h ? "active" : ""}">${h} saat</button>`).join("")}</div>
        ${useTg ? `<label>Şurada paylaş</label><div class="sm-tg">${targetsHtml(X, st.targets, { label: false, id: "smTargets" })}${own() ? `<div class="sm muted">Videolar kendi paylaşım yerleriyle planlanır; burada seçim yaparsan hepsine uygulanır.</div>` : ""}</div>` : ""}
        <div class="sm-tip">${ic("flame", 12)}Öğle (12:00) ve akşam (19:00–21:00) saatleri genelde daha çok izlenir. Düzenli paylaşım, tek seferde çok paylaşımdan daha iyi sonuç verir.</div>
      </div>
      <div class="sm-prev">
        <div class="sm-prev-h"><b>Önizleme</b><span class="sm muted">${ok.length ? `${ok.length} video · ${relDay(first)} – ${relDay(last)}` : "Seçili video yok"}</span></div>
        <div class="sm-list">${st.order.map((id, i) => {
          const p = S.posts.find((x) => x.id === id);
          const on = st.ids.has(id);
          const t = map.get(id);
          return `<div class="sm-row ${on ? "" : "off"}">
            <button class="sm-chk ${on ? "on" : ""}" data-tog="${id}" title="${on ? "Plandan çıkar" : "Plana ekle"}">${ic(on ? "square-check" : "square", 17)}</button>
            <div class="pl-thumb" style="${thumb(p) ? `background-image:url('${thumb(p)}')` : ""}">${thumb(p) ? "" : ic("film", 14)}</div>
            <div class="grow"><div class="pl-ct">${esc(p.title)}</div>${!fits(p) ? `<div class="pl-warn">${ic("triangle-alert", 11)}Bu tür yalnızca Instagram'da paylaşılabilir</div>` : p.no_caption && (!useTg || eff(p).instagram) ? `<div class="pl-warn">${ic("triangle-alert", 11)}Açıklama boş, paylaşım saatinde paylaşılamaz</div>` : ""}</div>${tgIcons(p)}
            <div class="sm-when">${on && fits(p) ? (t ? `<span>${relDay(t)}</span><b>${hm(t)}</b>` : `<span class="bad">Yer yok</span>`) : `<span class="muted">—</span>`}</div>
            <div class="sm-move"><button data-mv="${id}" data-d="-1" ${i ? "" : "disabled"} title="Öne al">${ic("chevron-up", 13)}</button><button data-mv="${id}" data-d="1" ${i < st.order.length - 1 ? "" : "disabled"} title="Sona al">${ic("chevron-down", 13)}</button></div>
          </div>`;
        }).join("")}</div>
      </div>
    </div>
    <div class="foot"><span class="grow sm muted">Var olan planlara dokunulmaz; boş saatlere yerleştirilir.</span><button class="btn" data-close>Vazgeç</button><button class="btn primary" id="smApply" ${ok.length ? "" : "disabled"}>${ic("calendar-check", 15)}${ok.length} videoyu planla</button></div>`;
  };

  X.modal(`<h2>${ic("wand-sparkles", 20)}Akıllı planla</h2><div class="sm-sub muted">Bekleyen videolarını seçtiğin düzene göre en uygun boş saatlere yerleştirir. Önce önizlemeye bak, sonra uygula.</div><div id="smBody">${body()}</div>`, (m) => {
    m.addEventListener("tgchange", (e) => {
      st.targets = e.detail.value;
      st.touched = true;
      const sc = $(".sm-list", m)?.scrollTop || 0;
      $("#smBody", m).innerHTML = body();
      $(".sm-list", m).scrollTop = sc;
      for (const b of $$("[data-close]", m)) b.onclick = X.closeModal;
    });
    const redraw = () => {
      const sc = $(".sm-list", m)?.scrollTop || 0;
      $("#smBody", m).innerHTML = body();
      $(".sm-list", m).scrollTop = sc;
      for (const b of $$("[data-close]", m)) b.onclick = X.closeModal;
    };
    m.onclick = async (e) => {
      if (e.target === m) return X.closeModal();
      const b = e.target.closest("[data-v]");
      const grp = b?.closest("[data-g]")?.dataset.g;
      if (grp === "rhythm") {
        const r = RHYTHMS.find((x) => x.id === b.dataset.v);
        Object.assign(st, { rhythm: r.id, times: [...r.times], every: r.every });
      } else if (grp === "times") {
        const v = b.dataset.v;
        st.times = st.times.includes(v) ? st.times.filter((x) => x !== v) : [...st.times, v].sort();
        if (!st.times.length) st.times = [v];
        st.rhythm = "";
      } else if (grp === "days") {
        const v = +b.dataset.v;
        st.days = st.days.includes(v) ? st.days.filter((x) => x !== v) : [...st.days, v].sort();
        if (!st.days.length) st.days = [v];
      } else if (grp === "start") st.start = +b.dataset.v;
      else if (grp === "gap") st.gap = +b.dataset.v;
      const tog = e.target.closest("[data-tog]");
      if (tog) st.ids.has(tog.dataset.tog) ? st.ids.delete(tog.dataset.tog) : st.ids.add(tog.dataset.tog);
      const mv = e.target.closest("[data-mv]");
      if (mv) {
        const i = st.order.indexOf(mv.dataset.mv);
        const j = i + +mv.dataset.d;
        if (j >= 0 && j < st.order.length) [st.order[i], st.order[j]] = [st.order[j], st.order[i]];
      }
      if (grp || tog || mv) {
        savePrefs({ ...prefs(), rhythm: st.rhythm, times: st.times, every: st.every, days: st.days, gap: st.gap });
        return redraw();
      }
      if (e.target.closest("#smApply")) {
        const rows = plan().filter((r) => r.t);
        const btn = $("#smApply", m);
        btn.disabled = true;
        let done = 0;
        const fails = [];
        for (const r of rows) {
          btn.innerHTML = `${ic("loader-circle", 15, "spin")}Planlanıyor ${done + 1}/${rows.length}`;
          try {
            await api(`/api/posts/${r.p.id}/schedule`, useTg && !own() ? { at: local(r.t), targets: reels(r.p) ? st.targets : { instagram: true } } : { at: local(r.t) });
            done++;
          } catch (err) {
            fails.push(`${r.p.title}: ${err.message}`);
          }
        }
        X.closeModal();
        toast(fails.length ? `${done} video planlandı, ${fails.length} planlanamadı: ${fails[0]}` : `${done} video planlandı`, !!fails.length);
        await X.refresh();
        renderPlanner(X, true);
      }
    };
  }, "smart-plan");
}

export function planPill(S) {
  const el = document.querySelector("#planPill");
  if (!el) return;
  const n = classify(S).waiting.length + (S.posts || []).filter((p) => p.status === "hata").length;
  el.textContent = n;
  el.classList.toggle("hidden", !n);
}
