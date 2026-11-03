import { ICONS } from "/web/icons.js";

const STOPS = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180, 240, 300, 360, 420, 480, 540, 600];
const MARKS = [15, 30, 60, 120, 300, 600];
const CHARS_PER_SEC = 15;
const LONG = 120;

const idx = (v) => STOPS.reduce((best, s, i) => (Math.abs(s - v) < Math.abs(STOPS[best] - v) ? i : best), 0);
const clampV = (v) => STOPS[idx(+v || 30)];
const pct = (v) => (idx(v) / (STOPS.length - 1)) * 100;
const markLabel = (m) => (m < 60 ? `${m} sn` : `${m / 60} dk`);
const nf = (n) => Math.round(n).toLocaleString("tr-TR");
const ic = (name, size = 13) => `<span class="icw">${(ICONS[name] || "").replace("<svg", `<svg width="${size}" height="${size}" class="ic"`)}</span>`;

function fmt(v) {
  if (v < 60) return { n: `${v}`, u: "sn" };
  const m = Math.floor(v / 60);
  const s = v % 60;
  return { n: s ? `${m}:${String(s).padStart(2, "0")}` : `${m}`, u: s ? "dk" : "dakika" };
}

function hint(v) {
  const kind = v <= 25 ? "Kısa ve vurucu" : v <= 45 ? "Dengeli anlatım" : v <= 75 ? "Detaylı anlatım" : v <= 180 ? "Uzun, derinlemesine anlatım" : "Belgesel uzunluğunda";
  return `${kind} · ~${nf(v * 2.3)} kelime`;
}

export function estimate(v) {
  const mins = 7 + (4 * v) / 60;
  return { low: Math.max(5, Math.round(mins * 0.75)), high: Math.round(mins * 1.4), credits: v * CHARS_PER_SEC };
}

const span = (e) => `${e.low}–${e.high} dk`;

export function estHtml(v, voice = true) {
  const e = estimate(v);
  const cost = voice ? ` ve ~${nf(e.credits)} ElevenLabs kredisi harcar` : "";
  const warn = v > LONG
    ? `<div class="dsl-warn">${ic("triangle-alert", 14)}<span><b>Uzun video.</b> Üretimi yaklaşık ${span(e)} sürer${cost}; Claude kullanım limitini de hızlı tüketir.${v > 180 ? " 3 dakikadan uzun videolar YouTube'da Shorts değil normal video olarak yayınlanır." : ""}</span></div>`
    : "";
  const credit = voice
    ? `<span title="Seslendirme için harcanacak tahmini ElevenLabs kredisi">${ic("mic")}~<b>${nf(e.credits)}</b> kredi</span>`
    : `<span title="Hazır ses kullanılır, ElevenLabs'a gidilmez">${ic("mic")}<b>Kredi harcanmaz</b></span>`;
  return `<div class="dsl-est"><span title="Ajanın videoyu hazırlayıp render etmesi için tahmini süre">${ic("timer")}Tahmini üretim <b>${span(e)}</b></span>${credit}</div>${warn}`;
}

export function durSlider(id, value) {
  const v = clampV(value);
  const f = fmt(v);
  return `<div class="dsl${v > LONG ? " long" : ""}" id="${id}" style="--p:${pct(v)}%">
    <div class="dsl-top"><span class="dsl-val"><b>${f.n}</b><i>${f.u}</i></span><span class="dsl-hint">${hint(v)}</span></div>
    <div class="dsl-track"><div class="dsl-rail"><div class="dsl-fill"></div></div>
      <input type="range" min="0" max="${STOPS.length - 1}" step="1" value="${idx(v)}" aria-label="Video süresi"></div>
    <div class="dsl-marks">${MARKS.map((m) => `<button type="button" data-mark="${m}" class="${m === v ? "on" : ""}" style="left:${pct(m)}%">${markLabel(m)}</button>`).join("")}</div>
    <div class="dsl-info">${estHtml(v)}</div>
  </div>`;
}

export function bindDurSlider(root, onChange) {
  const el = root?.classList?.contains("dsl") ? root : root?.querySelector(".dsl");
  if (!el) return;
  const input = el.querySelector("input");
  const value = () => STOPS[+input.value] ?? 30;
  const paint = (v) => {
    const f = fmt(v);
    el.style.setProperty("--p", `${pct(v)}%`);
    el.classList.toggle("long", v > LONG);
    el.querySelector(".dsl-val b").textContent = f.n;
    el.querySelector(".dsl-val i").textContent = f.u;
    el.querySelector(".dsl-hint").textContent = hint(v);
    el.querySelector(".dsl-info").innerHTML = estHtml(v);
    for (const b of el.querySelectorAll("[data-mark]")) b.classList.toggle("on", +b.dataset.mark === v);
  };
  input.oninput = (e) => {
    e.stopPropagation();
    paint(value());
  };
  input.onchange = (e) => {
    e.stopPropagation();
    onChange(value());
  };
  el.querySelector(".dsl-marks").onclick = (e) => {
    const b = e.target.closest("[data-mark]");
    if (!b) return;
    e.stopPropagation();
    const v = +b.dataset.mark;
    input.value = idx(v);
    paint(v);
    onChange(v);
  };
}
