import { postTargets } from "/web/targets.js";
import { ttOn } from "/web/tiktok.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const DOW = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const DOW_LONG = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MON = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const TIMES = ["09:00", "12:00", "15:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
const HOT = new Set(["12:00", "19:00", "21:00"]);
const STRIP = 21;

const p2 = (n) => String(n).padStart(2, "0");
const hm = (t) => `${p2(t.getHours())}:${p2(t.getMinutes())}`;
const dayKey = (t) => `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
const dayStr = (t) => `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
const startOfDay = (t) => new Date(t.getFullYear(), t.getMonth(), t.getDate());
const addDays = (t, n) => new Date(t.getFullYear(), t.getMonth(), t.getDate() + n);
const fmt = (t) => `${dayStr(t)}T${hm(t)}`;

function parse(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || "");
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

export function relTime(t) {
  const ms = t - Date.now();
  if (ms < 60000) return "";
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d} gün${h ? ` ${h} saat` : ""} sonra`;
  if (h) return `${h} saat${mm ? ` ${mm} dk` : ""} sonra`;
  return `${mm} dk sonra`;
}

function longDate(t) {
  const diff = Math.round((startOfDay(t) - startOfDay(new Date())) / 864e5);
  const tag = diff === 0 ? "Bugün, " : diff === 1 ? "Yarın, " : "";
  return `${tag}${t.getDate()} ${MON[t.getMonth()]} ${DOW_LONG[t.getDay()]}`;
}

function busyMap(S, id) {
  const out = {};
  for (const p of S.posts || []) {
    if (p.id === id) continue;
    const at = p.status === "paylasildi" ? p.published?.at : p.status === "planlandi" ? p.schedule : null;
    if (!at) continue;
    const t = new Date(at);
    if (isNaN(t)) continue;
    (out[dayKey(t)] ||= []).push({ p, t });
  }
  for (const k in out) out[k].sort((a, b) => a.t - b.t);
  return out;
}

function ui(S, id) {
  if (S.schedUI?.id !== id) S.schedUI = { id, open: false, month: null, sl: 0 };
  return S.schedUI;
}

export function plannedHtml(X, d) {
  const { ic } = X;
  const t = parse(d.schedule) || new Date(d.schedule);
  const rel = relTime(t);
  const tg = postTargets(X.S, d);
  const ytOnly = !tg.instagram;
  const names = [!ytOnly && "Instagram", (ytOnly || tg.youtube) && "YouTube", ttOn(d) && "TikTok"].filter(Boolean);
  const last = names.pop();
  const where = `${names.length ? `${names.join(", ")} ve ` : ""}${last}${last === "TikTok" ? "'ta" : "'da"}`;
  return `<div class="splanned">
      <div class="sp-ic">${ic("calendar-check", 20)}</div>
      <div class="grow"><b>${longDate(t)} · ${hm(t)}</b>
        <div class="sm">${where} otomatik paylaşılacak${rel ? ` · ${rel}` : ytOnly ? " · YouTube'a yükleniyor ya da yayına giriyor" : " · zamanı geldi, sırada"}</div></div>
      <button class="btn sm" id="unschedBtn">${ic("x", 14)}Planı kaldır</button>
    </div>`;
}

export function schedulerHtml(X, d, value) {
  const { S, ic, esc } = X;
  const U = ui(S, d.id);
  const now = new Date();
  const today = startOfDay(now);
  const sel = parse(value) || now;
  const selKey = dayKey(sel);
  const past = sel - now < 60000;
  const busy = busyMap(S, d.id);
  const dots = (k) => (busy[k] ? `<span class="sdots">${busy[k].slice(0, 3).map((e) => `<i class="${e.p.status}"></i>`).join("")}</span>` : "");
  const tip = (k) => (busy[k] ? busy[k].map((e) => `${hm(e.t)} · ${e.p.title}`).join("\n") : "");
  const days = [...Array(STRIP)].map((_, i) => addDays(today, i));
  const inStrip = days.some((t) => dayKey(t) === selKey);
  const label = (i, t) => (i === 0 ? "Bugün" : i === 1 ? "Yarın" : DOW[t.getDay()]);
  const same = busy[selKey] || [];
  const near = same.filter((e) => Math.abs(e.t - sel) < 2 * 3600e3);
  const hh = sel.getHours();
  const mi = sel.getMinutes();

  const strip = days.map((t, i) => {
    const k = dayKey(t);
    return `<button type="button" class="sday ${k === selKey ? "sel" : ""} ${t.getDay() % 6 === 0 ? "we" : ""} ${t.getDate() === 1 && i ? "mstart" : ""}" data-day="${dayStr(t)}" title="${esc(tip(k))}">
      <span class="sd-w">${label(i, t)}</span><b>${t.getDate()}</b><span class="sd-m">${MON[t.getMonth()].slice(0, 3)}</span>${dots(k)}</button>`;
  }).join("");

  let month = "";
  if (U.open) {
    const base = U.month || new Date(sel.getFullYear(), sel.getMonth(), 1);
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7));
    const rows = Math.ceil(((first.getDay() + 6) % 7 + new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()) / 7);
    const canPrev = first > new Date(today.getFullYear(), today.getMonth(), 1);
    let cells = "";
    for (let i = 0; i < rows * 7; i++) {
      const t = addDays(start, i);
      const k = dayKey(t);
      cells += `<button type="button" class="smd ${t.getMonth() !== base.getMonth() ? "other" : ""} ${k === dayKey(today) ? "today" : ""} ${k === selKey ? "sel" : ""} ${t.getDay() % 6 === 0 ? "we" : ""}" data-day="${dayStr(t)}" ${t < today ? "disabled" : ""} title="${esc(tip(k))}">${t.getDate()}${dots(k)}</button>`;
    }
    month = `<div class="smonth">
      <div class="smh"><button type="button" class="btn icon sm ghost" data-mon="-1" ${canPrev ? "" : "disabled"}>${ic("chevron-left", 15)}</button>
        <b>${MON[base.getMonth()]} ${base.getFullYear()}</b>
        <button type="button" class="btn icon sm ghost" data-mon="1">${ic("chevron-right", 15)}</button></div>
      <div class="smg">${["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"].map((x) => `<span class="smw">${x}</span>`).join("")}${cells}</div>
      <div class="smleg sm"><span><i class="planlandi"></i>Planlı</span><span><i class="paylasildi"></i>Paylaşıldı</span></div>
    </div>`;
  }

  const times = TIMES.map((tm) => {
    const [h, m] = tm.split(":").map(Number);
    const off = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate(), h, m) - now < 60000;
    return `<button type="button" class="stime ${h === hh && m === mi ? "sel" : ""} ${HOT.has(tm) ? "hot" : ""}" data-time="${tm}" ${off ? "disabled" : ""}>${HOT.has(tm) ? ic("flame", 12) : ""}${tm}</button>`;
  }).join("");

  return `<div class="sched ${past ? "past" : ""}" id="sched" data-past="${past ? 1 : 0}">
    <div class="ssum">
      <div class="ssum-cal"><span>${MON[sel.getMonth()].slice(0, 3)}</span><b>${sel.getDate()}</b><i>${DOW[sel.getDay()]}</i></div>
      <div class="grow">
        <div class="ssum-t">${longDate(sel)}</div>
        <div class="ssum-s ${past ? "bad" : ""}">${past ? `${ic("triangle-alert", 13)}Geçmiş bir zaman seçili; ileri bir gün ya da saat seç` : `${ic("clock", 13)}${relTime(sel)}`}</div>
      </div>
      <div class="ssum-h">${p2(hh)}<span>:</span>${p2(mi)}</div>
    </div>

    <div class="slabel"><span>${ic("calendar-days", 13)}Gün</span>
      <button type="button" class="btn sm ghost ${U.open ? "on" : ""}" id="schedCalBtn">${ic(U.open ? "chevron-up" : "calendar-days", 14)}${U.open ? "Takvimi kapat" : !inStrip ? `${sel.getDate()} ${MON[sel.getMonth()].slice(0, 3)} · Takvim` : "Takvimden seç"}</button></div>
    <div class="sdays" id="schedDays">${strip}</div>
    ${month}

    <div class="slabel"><span>${ic("clock", 13)}Saat</span><span class="sm muted shint">${ic("flame", 12)}Öğle ve akşam saatleri genelde daha çok izlenir</span></div>
    <div class="stimes">${times}
      <div class="sstep" title="Saati ince ayarla (üzerinde fare tekerleği de çalışır)">
        <button type="button" data-step="h" data-d="-1" aria-label="Saat geri">${ic("minus", 12)}</button><b data-wheel="h">${p2(hh)}</b><button type="button" data-step="h" data-d="1" aria-label="Saat ileri">${ic("plus", 12)}</button>
        <span class="sep">:</span>
        <button type="button" data-step="m" data-d="-5" aria-label="Dakika geri">${ic("minus", 12)}</button><b data-wheel="m">${p2(mi)}</b><button type="button" data-step="m" data-d="5" aria-label="Dakika ileri">${ic("plus", 12)}</button>
      </div>
    </div>
    ${same.length ? `<div class="sbusy ${near.length ? "warn" : ""}">${ic(near.length ? "triangle-alert" : "calendar-clock", 14)}<span>${near.length ? "Bu saate yakın başka bir paylaşım var:" : "Bu gün takvimde:"} ${same.map((e) => `<b>${hm(e.t)}</b> ${esc(e.p.title)}`).join(" · ")}</span></div>` : ""}
  </div>`;
}

export function bindScheduler(X, d) {
  const box = $("#sched");
  const hidden = $("#when");
  if (!box || !hidden) return;
  const { S } = X;
  const U = ui(S, d.id);
  const strip = $("#schedDays", box);
  strip.scrollLeft = U.sl;
  const selEl = $(".sday.sel", strip);
  if (selEl) {
    const r = selEl.getBoundingClientRect();
    const sr = strip.getBoundingClientRect();
    if (sr.width && (r.left < sr.left || r.right > sr.right)) strip.scrollLeft += r.left - sr.left - sr.width / 2 + r.width / 2;
  }
  const sb = $("#schedBtn");
  if (sb) sb.disabled = sb.dataset.ready !== "1" || box.dataset.past === "1";

  const cur = () => parse(hidden.value) || new Date();
  const set = (t) => {
    U.sl = strip.scrollLeft;
    S.when = { id: d.id, v: fmt(t) };
    hidden.value = S.when.v;
    box.outerHTML = schedulerHtml(X, d, hidden.value);
    bindScheduler(X, d);
  };
  const nextSlot = (day) => {
    const t = new Date(Date.now() + 60 * 60 * 1000);
    t.setMinutes(0, 0, 0);
    return t > day ? t : day;
  };

  box.onclick = (e) => {
    const t = cur();
    const day = e.target.closest("[data-day]");
    if (day && !day.disabled) {
      const [y, m, dd] = day.dataset.day.split("-").map(Number);
      let n = new Date(y, m - 1, dd, t.getHours(), t.getMinutes());
      if (n - Date.now() < 60000) n = nextSlot(n);
      if (U.open && n.getMonth() !== (U.month || t).getMonth()) U.month = new Date(n.getFullYear(), n.getMonth(), 1);
      return set(n);
    }
    const tm = e.target.closest("[data-time]");
    if (tm && !tm.disabled) {
      const [h, mi] = tm.dataset.time.split(":").map(Number);
      return set(new Date(t.getFullYear(), t.getMonth(), t.getDate(), h, mi));
    }
    const st = e.target.closest("[data-step]");
    if (st) return step(st.dataset.step, +st.dataset.d);
    const mon = e.target.closest("[data-mon]");
    if (mon && !mon.disabled) {
      const b = U.month || new Date(t.getFullYear(), t.getMonth(), 1);
      U.month = new Date(b.getFullYear(), b.getMonth() + +mon.dataset.mon, 1);
      return set(t);
    }
    if (e.target.closest("#schedCalBtn")) {
      U.open = !U.open;
      U.month = new Date(t.getFullYear(), t.getMonth(), 1);
      return set(t);
    }
  };
  const step = (k, n) => {
    const t = cur();
    if (k === "h") t.setHours(t.getHours() + n);
    else t.setMinutes(Math.round(t.getMinutes() / 5) * 5 + n);
    set(t);
  };
  for (const w of $$("[data-wheel]", box))
    w.onwheel = (e) => {
      e.preventDefault();
      step(w.dataset.wheel, (e.deltaY > 0 ? -1 : 1) * (w.dataset.wheel === "h" ? 1 : 5));
    };
  strip.onwheel = (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };
  strip.onscroll = () => (U.sl = strip.scrollLeft);
}
