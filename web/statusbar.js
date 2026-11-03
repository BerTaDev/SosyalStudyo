const $ = (s, r = document) => r.querySelector(s);
const NAMES = { igchip: ["Instagram", "instagram"], ytChip: ["YouTube", "youtube"], ttChip: ["TikTok", "music"], credits: ["Seslendirme · ElevenLabs", "mic"],
  claudeChip: ["Claude kullanımı", "gauge"], cloudChip: ["Bulut yayın", "cloud"] };
const LEVEL_TXT = { ok: "Çalışıyor", warn: "Dikkat", bad: "Sorun var", "": "Bağlı değil" };
let X0 = null;
let cur = null;

const level = (el) => ["bad", "warn", "ok"].find((c) => el.classList.contains(c)) || "";

function grabTitle(el) {
  const t = el.getAttribute("title");
  if (!t) return;
  el.dataset.tip = t;
  el.setAttribute("aria-label", t);
  el.removeAttribute("title");
  if (cur === el) draw(el);
}

function draw(el) {
  const { ic, esc } = X0;
  const [name, icon] = NAMES[el.id] || [el.id, "info"];
  const lv = level(el);
  const lines = (el.dataset.tip || "").split("\n").filter(Boolean);
  let tip = $("#statTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "statTip";
    document.body.append(tip);
  }
  tip.innerHTML = `<div class="stt-head"><span class="stt-ic ${lv}">${ic(icon, 15)}</span><b>${esc(name)}</b><span class="sp-lv ${lv}">${LEVEL_TXT[lv]}</span></div>
    ${lines.length ? `<div class="stt-body">${lines.map((t) => `<div>${esc(t)}</div>`).join("")}</div>` : ""}
    <div class="stt-foot">${ic("mouse-pointer-click", 12)}Ayrıntılar için tıkla</div>`;
  const b = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.top = `${b.bottom + 10}px`;
  tip.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, b.left + b.width / 2 - w / 2))}px`;
  tip.style.setProperty("--ax", `${Math.round(b.left + b.width / 2 - parseFloat(tip.style.left))}px`);
  requestAnimationFrame(() => tip.classList.add("in"));
}

function hide() {
  cur = null;
  $("#statTip")?.remove();
}

export function initStatus(X) {
  X0 = X;
  const box = $(".top-stat");
  if (!box) return;
  for (const el of box.querySelectorAll(".chip")) grabTitle(el);
  new MutationObserver((list) => {
    for (const m of list) {
      const el = m.target.closest?.(".chip");
      if (el && el.hasAttribute("title")) grabTitle(el);
    }
  }).observe(box, { subtree: true, attributes: true, attributeFilter: ["title"] });
  box.addEventListener("mouseover", (e) => {
    const el = e.target.closest(".chip");
    if (!el || el === cur) return;
    cur = el;
    draw(el);
  });
  box.addEventListener("mouseleave", hide);
  box.addEventListener("click", hide, true);
  addEventListener("blur", hide);
}
