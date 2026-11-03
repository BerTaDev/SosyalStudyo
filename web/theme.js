const KEY = "sosyal-theme";
const DEF = "gunbatimi";
export const THEMES = [
  { id: "gunbatimi", name: "Gün Batımı", desc: "Turuncu, pembe ve mor sıcak ışıklar", c: ["#ff6a3d", "#e1306c", "#7c3aed"], bg: "#100d13" },
  { id: "aurora", name: "Aurora", desc: "Mor ve turkuaz kuzey ışıkları", c: ["#8b5cf6", "#14b8a6", "#3b82f6"], bg: "#0a0e15" },
  { id: "okyanus", name: "Okyanus", desc: "Derin mavi, sakin ve ferah", c: ["#0ea5e9", "#2563eb", "#06b6d4"], bg: "#07101b" },
  { id: "neon", name: "Neon", desc: "Pembe ve camgöbeği gece ışıkları", c: ["#ec4899", "#22d3ee", "#a855f7"], bg: "#0b0912" },
  { id: "orman", name: "Orman", desc: "Zümrüt yeşili, dingin", c: ["#10b981", "#84cc16", "#0d9488"], bg: "#09110d" },
  { id: "gece", name: "Gece", desc: "Simsiyah ve sade, hafif ışık", c: ["#ff6a3d", "#5a5a6e", "#3c3c50"], bg: "#060607" },
  { id: "klasik", name: "Klasik", desc: "Eski düz görünüm, efekt yok", c: ["#ff6a3d", "#2e3239", "#24272d"], bg: "#141519", flat: true },
];

export function themePrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function save(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

function stars(el, n, alpha) {
  const dots = [];
  for (let i = 0; i < n; i++) dots.push(`${(Math.random() * 100).toFixed(2)}vw ${(Math.random() * 100).toFixed(2)}vh 0 0 rgba(var(--star), ${(alpha * (0.5 + Math.random() * 0.5)).toFixed(2)})`);
  el.style.boxShadow = dots.join(",");
}

function ensureBg() {
  if (document.querySelector(".bgfx")) return;
  const bg = document.createElement("div");
  bg.className = "bgfx";
  bg.setAttribute("aria-hidden", "true");
  bg.innerHTML = `<i class="b b1"></i><i class="b b2"></i><i class="b b3"></i><i class="st st1"></i><i class="st st2"></i><i class="st st3"></i><i class="grain"></i>`;
  document.body.prepend(bg);
  stars(bg.querySelector(".st1"), 34, 0.7);
  stars(bg.querySelector(".st2"), 26, 0.6);
  stars(bg.querySelector(".st3"), 12, 0.55);
}

export function applyTheme(p = themePrefs()) {
  const t = THEMES.find((x) => x.id === p.theme) || THEMES.find((x) => x.id === DEF);
  const root = document.documentElement;
  root.dataset.theme = t.id;
  root.classList.toggle("fx", !t.flat);
  root.classList.toggle("still", p.motion === false);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bg);
  if (!t.flat) ensureBg();
}

export function setTheme(patch) {
  const p = { ...themePrefs(), ...patch };
  save(p);
  applyTheme(p);
  for (const c of document.querySelectorAll("#thGrid [data-th]")) c.classList.toggle("on", c.dataset.th === p.theme);
  const mo = document.querySelector("#thMotion");
  if (mo) mo.checked = p.motion !== false;
}

export function themeSettingsHtml(X) {
  const { ic, esc } = X;
  const p = themePrefs();
  const cur = (THEMES.find((x) => x.id === p.theme) || THEMES[0]).id;
  return `<fieldset id="sLook"><legend>Görünüm</legend>
    <div class="sm muted">Bir temaya tıkla, hemen uygulanır. Seçimin bu tarayıcıda saklanır.</div>
    <div class="th-grid" id="thGrid">${THEMES.map((t) => `<button type="button" class="th-card${t.id === cur ? " on" : ""}" data-th="${t.id}">
      <span class="th-prev" style="background:${t.bg}">${t.c.map((c) => `<i style="background:radial-gradient(closest-side, ${c}${t.flat ? "55" : "aa"}, transparent)"></i>`).join("")}<b style="background:${t.c[0]};color:${t.c[0]}"></b></span>
      <span class="th-name">${esc(t.name)}<span class="th-ok">${ic("circle-check", 15)}</span></span><span class="th-desc">${esc(t.desc)}</span></button>`).join("")}</div>
    <label class="th-opt"><input type="checkbox" id="thMotion" ${p.motion === false ? "" : "checked"}><span class="grow"><b>Hareketli arka plan ve parıltılar</b><div class="sm muted">Kapatırsan renkler kalır, ışıklar ve parıltılar durur. Yavaş bilgisayarlarda kapatabilirsin.</div></span></label>
  </fieldset>`;
}

export function bindThemeSettings(m) {
  const grid = m.querySelector("#thGrid");
  if (!grid) return;
  grid.onclick = (e) => {
    const b = e.target.closest("[data-th]");
    if (!b) return;
    const p = { ...themePrefs(), theme: b.dataset.th };
    save(p);
    applyTheme(p);
    for (const c of grid.querySelectorAll("[data-th]")) c.classList.toggle("on", c === b);
  };
  const mo = m.querySelector("#thMotion");
  if (mo)
    mo.onchange = () => {
      const p = { ...themePrefs(), motion: mo.checked };
      save(p);
      applyTheme(p);
    };
}
