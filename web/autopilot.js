import { ago } from "/web/views.js";
import { schedulerHtml, bindScheduler, relTime } from "/web/schedule.js";
import { durSlider, bindDurSlider } from "/web/durslider.js";
import { targetsHtml, targetsReady, defaultTargets, targetsText, setTargets } from "/web/targets.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const EASE = "cubic-bezier(.22,.9,.24,1)";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const KEY = "sosyal-studyo-autopilot-draft";
const MAX = 30;
const CPS = 14;
const PICK = { id: "autopilot" };
const TONES = ["Eğitici", "Samimi", "Eğlenceli", "Profesyonel", "İlham verici", "Merak uyandıran", "Dramatik"];
const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const DOW = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const MON = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const QUICK = ["09:00", "12:00", "15:00", "18:00", "19:00", "21:00"];
const PH = ["ör. psikolojide yanlış bilinenler", "ör. evde kahve demlerken yapılan hatalar", "ör. küçük işletmeler için Instagram ipuçları", "ör. uzay hakkında şaşırtıcı bilgiler", "ör. 5 dakikada sağlıklı kahvaltı"];
const STATUS = {
  calisiyor: ["Çalışıyor", "run"], onay_bekliyor: ["Onayını bekliyor", "wait"], duraklatildi: ["Duraklatıldı", "pause"],
  bitti: ["Tamamlandı", "done"], iptal: ["İptal edildi", "off"], hata: ["Hata", "err"],
};
const PSTATUS = { sirada: "Sırada", uretimde: "Üretimde", inceleme: "İncelemede", planlandi: "Planlandı", paylasiliyor: "Paylaşılıyor", paylasildi: "Paylaşıldı", hata: "Hata" };
const needsMe = (c) => c.status === "onay_bekliyor" || c.status === "hata" || (c.status === "duraklatildi" && c.hold === "credits");
const statusOf = (c) => (c.status === "duraklatildi" && c.hold === "credits" ? ["Kredi bekliyor", "wait"] : STATUS[c.status] || [c.status, "off"]);
const MODES = [
  { k: "interval", icon: "repeat", t: "Düzenli takvim", s: "Seçtiğin gün ve saatlerde sırayla paylaşılır." },
  { k: "slots", icon: "calendar-check", t: "Belirli saatler", s: "Saatleri tek tek seçersin, videolar sırayla yerleşir." },
  { k: "immediate", icon: "zap", t: "Hazır olunca paylaş", s: "Her video biter bitmez Instagram'da yayınlanır." },
  { k: "review", icon: "inbox", t: "Ben paylaşayım", s: "Videolar İncelemede bekler, paylaşımı sen yaparsın." },
];
const STEPS = [
  { icon: "list", t: "Konular" },
  { icon: "sliders-horizontal", t: "İçerik" },
  { icon: "list-checks", t: "Fikir seçimi" },
  { icon: "calendar-clock", t: "Paylaşım" },
  { icon: "rocket", t: "Özet" },
];
const PIPE = ["Fikir", "Seçim", "Üretim", "Paylaşım"];

const p2 = (n) => String(n).padStart(2, "0");
const hm = (t) => `${p2(t.getHours())}:${p2(t.getMinutes())}`;
const dstr = (t) => `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;
const fmtLocal = (t) => `${dstr(t)}T${hm(t)}`;
const num = (n) => Math.round(n || 0).toLocaleString("tr-TR");
const today = () => dstr(new Date());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function parseT(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(v || "");
  return m ? new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
}
function dayName(t, long = false) {
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - d0) / 864e5);
  if (diff === 0) return "Bugün";
  if (diff === 1) return "Yarın";
  if (diff === -1) return "Dün";
  if (!long && diff > 1 && diff < 7) return DOW[t.getDay()];
  return `${t.getDate()} ${MON[t.getMonth()]} ${long ? DOW[t.getDay()] : DOW[t.getDay()].slice(0, 3)}`;
}
const when = (v) => {
  const t = parseT(v);
  return t ? `${dayName(t)} ${hm(t)}` : "";
};
const nextPick = () => {
  const t = new Date(Date.now() + 864e5);
  t.setHours(19, 0, 0, 0);
  return fmtLocal(t);
};
const pastSlot = (s) => !parseT(s) || parseT(s) - Date.now() < 10 * 60e3;

function done(a, fn) {
  let ran = false;
  const once = () => {
    if (ran) return;
    ran = true;
    fn();
  };
  a.finished.then(once, once);
  setTimeout(once, (a.effect?.getTiming?.().duration || 400) + 400);
}

// ---------- state ----------

let W = null;
const U = { tpl: {}, mode: null, sel: null, detail: null, err: "", sig: "", dsig: "", drawn: "", pick: {}, batches: {}, open: new Set(), preview: null, pkey: "", perr: "", ploading: false, pseq: 0, pT: 0, wbox: null, loadSeq: 0 };

const blank = () => ({
  step: 0, name: "", topics: [{ topic: "", count: 3, template: "" }], duration: 30, tone: "", tmode: "agent", template: "", templates: [], audience: "", notes: "",
  repeat_of: "", repeat_name: "", targets: null,
  review: false, mode: "interval", slots: [], pick: nextPick(), start: today(), days: [0, 1, 2, 3, 4, 5, 6], kind: "times", times: ["12:00", "19:00"], every: 6, win: ["09:00", "23:00"],
});
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (d && Array.isArray(d.topics)) return Object.assign(blank(), d);
  } catch {}
  return blank();
}
function keep() {
  try {
    if (W) localStorage.setItem(KEY, JSON.stringify(W));
  } catch {}
}
function dropDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
function fixDraft() {
  if (!W.topics.length) W.topics = [{ topic: "", count: 3, template: "" }];
  W.topics = W.topics.map((t) => ({ topic: String(t.topic || ""), count: clamp(+t.count || 1, 1, MAX), template: String(t.template || "") }));
  if (!["agent", "single", "mix"].includes(W.tmode)) W.tmode = W.template ? "single" : "agent";
  W.templates = [...new Set((W.templates || []).filter(Boolean))];
  if (!W.start || W.start < today()) W.start = today();
  if (pastSlot(W.pick)) W.pick = nextPick();
  W.step = clamp(W.step | 0, 0, STEPS.length - 1);
  if (!MODES.some((m) => m.k === W.mode)) W.mode = "interval";
}
function hasDraft() {
  const d = W || (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  })();
  return !!d && ((d.topics || []).some((t) => String(t.topic || "").trim()) || d.step > 0);
}

const total = () => W.topics.reduce((n, t) => n + (t.count || 0), 0);
const tplBrief = () => ({ template_mode: W.tmode, template: W.tmode === "single" ? W.template : "", templates: W.tmode === "mix" ? [...W.templates] : [] });
const briefOf = () => ({ duration: W.duration, tone: W.tone, audience: W.audience.trim(), notes: W.notes.trim(), format: "9:16", ...tplBrief() });
const topicsOf = (name = (t) => t.topic.trim()) => W.topics.map((t) => (t.template ? { topic: name(t), count: t.count, template: t.template } : { topic: name(t), count: t.count }));
const publishOf = () => ({
  mode: W.mode,
  slots: W.mode === "slots" ? [...W.slots].sort() : [],
  interval: { start: W.start, times: W.kind === "times" ? [...W.times].sort() : [], every_hours: W.kind === "every" ? W.every : null, window: [...W.win], days: [...W.days].sort() },
});
const tgOf = () => (W.targets ? { targets: W.targets } : {});
const previewBody = () => ({ topics: topicsOf(() => "konu"), brief: { duration: W.duration, format: "9:16", ...tplBrief() }, publish: publishOf(), ...tgOf() });
const planOf = () => (fresh() && Array.isArray(U.preview.templates_plan) ? U.preview.templates_plan : null);
const fresh = () => U.preview && U.pkey === JSON.stringify(previewBody());
const estChars = () => (fresh() && U.preview.chars_est != null ? U.preview.chars_est : total() * W.duration * CPS);
const errorsOf = () => (fresh() && U.preview.errors) || [];
const reservedOf = () => (fresh() && U.preview.reserved_chars) || 0;
const SKIPWARN = /^Instagram bağlı değil|^YouTube bağlı değil|^Tahmini \d+ karakter|paylaşım saati yok; bu videolar İncelemede/;
const creditsOf = (X) => {
  const c = (fresh() && U.preview.credits) || X.S.credits;
  return c && c.left != null ? c : null;
};

// ---------- public ----------

export function renderAutopilot(X) {
  const el = $("#autoView");
  if (!el) return;
  const list = X.S.autopilot || [];
  if (!U.mode) U.mode = list.length ? "detail" : "home";
  if (U.mode === "detail" && (!U.sel || !list.some((c) => c.id === U.sel))) {
    const first = list.find(needsMe) || list[0];
    U.sel = first?.id || null;
    U.detail = null;
    if (!U.sel) U.mode = "home";
  }
  el.innerHTML = `<div class="ap"><aside class="ap-side"></aside><div class="ap-main" id="apMain"></div></div>`;
  const side = $(".ap-side", el);
  side.onclick = (e) => {
    const r = e.target.closest("[data-rep]");
    if (r) {
      e.stopPropagation();
      repeatCampaign(X, r.dataset.rep);
      return;
    }
    const b = e.target.closest("[data-new], [data-c]");
    if (!b) return;
    if (b.dataset.c) openCampaign(X, b.dataset.c);
    else openWizard(X);
  };
  side.onkeydown = (e) => {
    const card = e.target.closest?.(".apc");
    if (!card || e.target !== card || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    openCampaign(X, card.dataset.c);
  };
  drawSide(X);
  renderMain(X);
  U.sig = sideSig(X);
  U.dsig = detSig(X);
}

export function syncAutopilot(X) {
  updatePill(X);
  const el = $("#autoView");
  if (X.S.tab !== "auto" || !el || !$(".ap", el)) return;
  const list = X.S.autopilot || [];
  const s = sideSig(X);
  if (s !== U.sig) {
    U.sig = s;
    drawSide(X);
  }
  if (U.mode === "detail") {
    if (!list.some((c) => c.id === U.sel)) {
      U.mode = null;
      U.sel = null;
      U.detail = null;
      renderAutopilot(X);
      return;
    }
    const d = detSig(X);
    if (d !== U.dsig) {
      U.dsig = d;
      loadDetail(X, U.sel);
    }
  } else if (U.mode === "home" && list.length) {
    U.mode = null;
    renderAutopilot(X);
  }
}

function updatePill(X) {
  const pill = $("#autoPill");
  if (!pill) return;
  const n = (X.S.autopilot || []).filter(needsMe).length;
  pill.className = "pill" + (n ? "" : " hidden");
  pill.textContent = n ? String(n) : "";
  pill.title = n ? `${n} otomatik üretim seni bekliyor` : "";
}

const sideSig = (X) => JSON.stringify([(X.S.autopilot || []).map((c) => [c.id, c.name, c.updated, c.status, c.hold, c.stage, c.progress, c.next]), U.mode === "wiz", hasDraft()]);
const detSig = (X) => {
  if (!U.sel) return "";
  const c = (X.S.autopilot || []).find((x) => x.id === U.sel);
  return JSON.stringify([c && [c.updated, c.status, c.hold, c.stage, c.progress, c.next], (X.S.posts || []).filter((p) => p.autopilot === U.sel).map((p) => [p.id, p.updated, p.status])]);
};

function renderMain(X) {
  const main = $("#apMain");
  if (!main) return;
  closePicker();
  main.closest(".ap").classList.toggle("wiz", U.mode === "wiz");
  main.closest(".ap").classList.toggle("home", U.mode === "home");
  main.onclick = null;
  U.wbox = null;
  if (U.mode === "wiz") return mountWizard(X, main);
  if (U.mode === "detail" && U.sel) {
    if (U.detail?.id === U.sel) drawDetail(X);
    else {
      main.innerHTML = skeletonHtml();
      loadDetail(X, U.sel);
    }
    return;
  }
  main.innerHTML = heroHtml(X);
  main.onclick = (e) => {
    if (e.target.closest("[data-new]")) openWizard(X);
  };
  if (!reduced()) $$(".aph > *", main).forEach((n, k) => n.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: 60 + k * 70, easing: EASE, fill: "backwards" }));
}

function openWizard(X) {
  U.mode = "wiz";
  drawSide(X);
  renderMain(X);
}

function openCampaign(X, id) {
  if (U.mode === "wiz") keep();
  U.mode = "detail";
  if (U.sel !== id) {
    U.sel = id;
    U.detail = null;
  }
  U.dsig = detSig(X);
  drawSide(X);
  renderMain(X);
  if (matchMedia("(max-width: 1150px)").matches) $("#apMain")?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
}

// ---------- side ----------

function drawSide(X) {
  const side = $("#autoView .ap-side");
  if (!side) return;
  const cards = $(".ap-cards", side);
  const sl = cards ? [cards.scrollTop, cards.scrollLeft] : [0, 0];
  side.innerHTML = sideHtml(X);
  const nc = $(".ap-cards", side);
  if (nc) [nc.scrollTop, nc.scrollLeft] = sl;
}

function sideHtml(X) {
  const { ic } = X;
  const list = X.S.autopilot || [];
  const run = list.filter((c) => c.status === "calisiyor").length;
  const wait = list.filter(needsMe).length;
  const draft = hasDraft();
  const sub = list.length ? `${run} çalışıyor${wait ? ` · <span class="ap-attn">${wait} seni bekliyor</span>` : ""}` : "Konu ver, gerisini ajan halletsin";
  return `<div class="ap-brand"><span class="ap-logo">${ic("rocket", 18)}</span><div class="grow"><b>Otopilot</b><div class="sm muted">${sub}</div></div></div>
    <button class="btn primary wide ap-new ${U.mode === "wiz" ? "on" : ""}" data-new>${ic(draft ? "pencil" : "plus", 16)}${draft ? "Taslağa devam et" : "Yeni otomatik üretim"}</button>
    ${list.length ? `<h3 class="side-h">${ic("list", 14)}Otomatik üretimler</h3>` : ""}
    <div class="ap-cards">${list.length ? list.map((c) => cardHtml(X, c)).join("") : `<div class="empty sm">Henüz otomatik üretim yok.</div>`}</div>`;
}

function videosOf(c) {
  return c.progress?.videos || (c.topics || []).reduce((n, t) => n + (t.count || 0), 0);
}

function ringSvg(frac, size, sw) {
  const r = (size - sw) / 2;
  const C = 2 * Math.PI * r;
  const h = size / 2;
  return `<svg class="apr" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${h}" cy="${h}" r="${r}" stroke-width="${sw}" class="apr-bg"/><circle cx="${h}" cy="${h}" r="${r}" stroke-width="${sw}" class="apr-fg" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - clamp(frac, 0, 1))).toFixed(2)}" transform="rotate(-90 ${h} ${h})"/></svg>`;
}

function cardHtml(X, c) {
  const { ic, esc } = X;
  const pr = c.progress || {};
  const tot = videosOf(c);
  const okN = (pr.published || 0) + (pr.scheduled || 0);
  const [label, cls] = statusOf(c);
  return `<div class="apc st-${cls} ${U.mode === "detail" && c.id === U.sel ? "sel" : ""}" data-c="${esc(c.id)}" role="button" tabindex="0">
    <span class="apc-ring">${ringSvg(tot ? okN / tot : 0, 44, 4)}<b>${okN}/${tot}</b></span>
    <span class="grow apc-body">
      <span class="apc-n">${esc(c.name)}</span>
      <span class="apc-s"><i class="apdot"></i>${label}${c.stage && c.status !== "bitti" ? `<span class="apc-st"> · ${esc(c.stage)}</span>` : ""}</span>
      ${c.next?.at ? `<span class="apc-x">${ic("calendar-clock", 12)}Sıradaki: ${when(c.next.at)}</span>` : pr.producing ? `<span class="apc-x">${ic("clapperboard", 12)}${pr.producing} video üretimde</span>` : ""}
    </span>
    <button class="apc-rep" data-rep="${esc(c.id)}" title="Tekrarla: aynı ayarlarla yeni üretim" aria-label="Tekrarla">${ic("copy-plus", 14)}</button>
  </div>`;
}

// ---------- hero ----------

function heroHtml(X) {
  const { ic } = X;
  const flow = [["lightbulb", "Fikirler yazılır", "Her konu için ajan metin kurguları yazar."], ["list-checks", "En iyileri seçilir", "Otomatik ya da senin onayınla."], ["clapperboard", "Videolar üretilir", "Seslendirme, kurgu ve altyazıyla."], ["send", "Planına göre paylaşılır", "Hemen, belirli saatlerde ya da düzenli takvimle."]];
  return `<div class="aph">
    <div class="aph-logo">${ic("rocket", 34)}</div>
    <h2>Konu ver, gerisini otopilot halletsin</h2>
    <p>Konuları ve paylaşım planını bir kez ayarla. Ajan fikirleri yazar, videoları üretir ve takvimine göre Instagram'da paylaşır.</p>
    <div class="aph-flow">${flow.map(([i, t, s], k) => `<div class="aph-f"><span class="aph-fi">${ic(i, 18)}</span><b>${t}</b><span>${s}</span><em>${k + 1}</em></div>`).join("")}</div>
    <button class="btn primary big aph-go" data-new>${ic("rocket", 17)}${hasDraft() ? "Taslağa devam et" : "Yeni otomatik üretim"}</button>
  </div>`;
}

function skeletonHtml() {
  return `<div class="apd apd-skel"><div class="sk sk-h"></div><div class="sk sk-b"></div><div class="sk-row"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div><div class="sk sk-l"></div><div class="sk sk-l"></div><div class="sk sk-l"></div></div>`;
}

// ---------- wizard ----------

function mountWizard(X, main) {
  const { ic, esc, S } = X;
  W ||= loadDraft();
  fixDraft();
  const rm = reduced();
  main.innerHTML = `<div class="apw">
    <div class="apw-head">
      <span class="apw-logo">${ic("rocket", 22)}</span>
      <div class="grow"><h2 class="apw-title">${W.repeat_of ? "Otomatik üretimi tekrarla" : "Yeni otomatik üretim"}</h2><div class="sm muted">Konuları ve planı bir kez ayarla; ajan fikirleri yazsın, videoları üretsin, takvimine göre paylaşsın.</div></div>
      <button class="btn ghost sm apw-reset" data-reset title="Taslağı temizle">${ic("rotate-ccw", 14)}<span class="apw-hide">Baştan</span></button>
      <button class="btn ghost icon" data-close title="Kapat (taslak saklanır)">${ic("x", 18)}</button>
    </div>
    <div class="apw-steps">${STEPS.map((s, i) => `<button class="apw-st" data-go="${i}"><span class="apw-n"><b>${i + 1}</b>${ic("check", 14)}</span><span class="apw-l">${s.t}</span></button>`).join("")}<div class="apw-rail"><i></i></div></div>
    <div class="apw-stage"></div>
    <div class="apw-foot"></div>
  </div>`;
  const box = $(".apw", main);
  const stage = $(".apw-stage", box);
  const foot = $(".apw-foot", box);
  U.wbox = box;
  let sending = false;

  const curPane = () => $(".apw-pane:not(.out)", stage);
  const head = (i, title, hint) => `<div class="apw-q"><span class="apw-qi">${ic(STEPS[i].icon, 19)}</span><div class="grow"><div class="apw-qn">Adım ${i + 1} / ${STEPS.length}</div><h3>${title}</h3><p>${hint}</p></div></div>`;

  // step 1
  const topicsHtml = () => W.topics.map((t, i) => `<div class="apt-row" data-row="${i}">
      <span class="apt-i">${i + 1}</span>
      <input class="apt-topic" data-i="${i}" maxlength="140" placeholder="${esc(PH[i % PH.length])}" value="${esc(t.topic)}">
      ${tchipHtml(t, i)}
      <div class="apt-step"><button data-cnt="${i}" data-d="-1" aria-label="Azalt">${ic("minus", 13)}</button><b>${t.count}</b><span>video</span><button data-cnt="${i}" data-d="1" aria-label="Artır">${ic("plus", 13)}</button></div>
      <button class="btn ghost icon apt-x" data-rm="${i}" title="Kaldır">${ic("x", 15)}</button>
    </div>`).join("");
  const topicOpts = (i) => ({
    value: W.topics[i]?.template || "", cls: "apt-pk", title: "Bu konunun stili", hint: "Seçersen bu konudaki tüm videolar bu stille yapılır.",
    defShort: "Varsayılan", defLabel: "Stil: varsayılan", defIcon: "palette", defSub: styleText(X, tplBrief()), tileIcon: styleText(X, tplBrief()) === FREE ? "wand-sparkles" : "",
  });
  const tchipHtml = (t, i) => pickBtn(X, `topic:${i}`, topicOpts(i));
  const setTopicTpl = (i, id) => {
    if (!W.topics[i]) return;
    W.topics[i].template = id;
    const chip = $(`[data-apk="topic:${i}"]`, curPane());
    if (chip) chip.outerHTML = tchipHtml(W.topics[i], i);
    changed();
  };
  const recentHtml = () => {
    const have = new Set(W.topics.map((t) => t.topic.trim().toLocaleLowerCase("tr")));
    const seen = new Set();
    const list = (S.ideas || []).map((b) => (b.topic || "").trim()).filter((t) => {
      const k = t.toLocaleLowerCase("tr");
      if (!t || have.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, 6);
    return list.length ? `<div class="apt-recent"><span class="sm muted">${ic("lightbulb", 13)}Son konuların:</span>${list.map((t) => `<button data-recent="${esc(t)}">${ic("plus", 12)}${esc(t.length > 42 ? t.slice(0, 40) + "…" : t)}</button>`).join("")}</div>` : "";
  };
  const totalHtml = () => {
    const n = total();
    return `<div class="apt-sum"><b>${n}</b><span>video</span><span class="muted">· ${W.topics.length} konu</span></div>
      <div class="apt-bar ${n > MAX ? "over" : ""}"><i style="width:${Math.min(100, (n / MAX) * 100)}%"></i></div>
      <div class="sm ${n > MAX ? "bad" : "muted"}">${n > MAX ? `En fazla ${MAX} video; ${n - MAX} azalt.` : `En fazla ${MAX} video. Ajan her konu için ayrı bir fikir seti yazar.`}</div>`;
  };
  const syncTopics = () => {
    const pane = curPane();
    if (!pane || +pane.dataset.step !== 0) return;
    const n = total();
    $$(".apt-row", pane).forEach((row, i) => {
      const t = W.topics[i];
      if (!t) return;
      $(".apt-step b", row).textContent = t.count;
      $('[data-d="-1"]', row).disabled = t.count <= 1;
      $('[data-d="1"]', row).disabled = n >= MAX;
      $(".apt-x", row).disabled = W.topics.length < 2;
    });
    $(".apt-total", pane).innerHTML = totalHtml();
    const add = $("[data-add]", pane);
    if (add) add.disabled = n >= MAX;
  };
  const redrawTopics = (focus = -1) => {
    const pane = curPane();
    if (!pane) return;
    closePicker();
    $(".apt-list", pane).innerHTML = topicsHtml();
    const r = $(".apt-recent-w", pane);
    if (r) r.innerHTML = recentHtml();
    syncTopics();
    if (focus >= 0) {
      const inp = $(`.apt-topic[data-i="${focus}"]`, pane);
      inp?.focus();
      const row = inp?.closest(".apt-row");
      if (row && !rm) row.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: EASE });
    }
  };

  // step 2
  const briefOpts = () => {
    const mix = W.tmode === "mix";
    return mix
      ? { multi: true, value: W.templates, cls: "apw-pk", title: "Karışık stiller", hint: "İşaretlediğin stiller videolarda bu sırayla dönüşür." }
      : { value: W.template, cls: "apw-pk", title: "Video stili", hint: "Bütün videolar bu stille yapılır.", defShort: FREE, defSub: "Şablon yok", defLabel: "Stil seç", defIcon: "film", tileIcon: "wand-sparkles" };
  };
  const styleHtml = () => {
    if (W.tmode === "agent") return `<div class="apw-tnote">${ic("wand-sparkles", 14)}<span>${FREE_HINT}.</span></div>`;
    const warn = W.tmode === "mix" ? W.templates.length < 2 && "Karışık için en az 2 stil işaretle." : !W.template && "Bir stil seç.";
    const best = W.tmode === "single" && tplFind(X, W.template)?.best_for;
    return `<div class="apw-pkrow">${pickBtn(X, "brief", briefOpts())}${warn ? `<span class="sm warnline">${ic("info", 13)}${warn}</span>` : best ? `<span class="sm muted apw-best">${esc(best)}</span>` : W.tmode === "mix" ? `<span class="sm muted">Videolar bu sırayla dönüşür.</span>` : ""}</div>`;
  };
  const redrawStyle = () => {
    const pane = curPane();
    if (!pane || +pane.dataset.step !== 1) return;
    $(".apw-tmode", pane).innerHTML = tmodeHtml();
    $(".apw-tplw", pane).innerHTML = styleHtml();
  };
  const tmodeHtml = () => [["agent", "wand-sparkles", FREE, FREE_HINT], ["single", "film", "Tek stil", "Bütün videolar tek bir şablonla"], ["mix", "shuffle", "Karışık", "Seçtiğin şablonlar sırayla dönüşür"]]
    .map(([k, i, t, h]) => `<button data-tmode="${k}" class="${W.tmode === k ? "active" : ""}" title="${h}">${ic(i, 14)}${t}</button>`).join("");
  const setTmode = (m) => {
    if (W.tmode === m) return;
    closePicker();
    if (m === "mix" && !W.templates.length && W.template) W.templates = [W.template];
    if (m === "single" && !W.template && W.templates.length) W.template = W.templates[0];
    W.tmode = m;
    redrawStyle();
    changed();
    if (m !== "agent" && (m === "mix" ? W.templates.length < 2 : !W.template)) {
      const b = $('[data-apk="brief"]', curPane());
      if (b) openPicker(X, b, briefOpts, onBriefPick);
    }
  };
  const onBriefPick = (v) => {
    if (W.tmode === "mix") W.templates = v;
    else if (!v) W.tmode = "agent";
    else W.template = v;
    redrawStyle();
    changed();
  };

  // step 3
  const flowHtml = () => {
    const nodes = [["lightbulb", "Fikir yazılır", "ajan"], ["list-checks", W.review ? "Sen seçersin" : "Ajan seçer", W.review ? "sen" : "ajan"], ["clapperboard", "Video üretilir", "ajan"], ["send", "Paylaşılır", "plan"]];
    return nodes.map(([i, t, who], k) => `<div class="apw-fn ${k === 1 ? (W.review ? "you" : "on") : ""}"><span>${ic(i, 16)}</span><b>${t}</b><em>${who === "sen" ? "Sen" : who === "plan" ? "Planına göre" : "Ajan"}</em></div>${k < 3 ? `<i class="apw-fa">${ic("chevron-right", 14)}</i>` : ""}`).join("");
  };

  // step 4
  const timesHtml = () => {
    const all = [...new Set([...QUICK, ...W.times])].sort();
    return all.map((t) => {
      const on = W.times.includes(t);
      return `<button class="apw-time ${on ? "on" : ""}" data-qt="${t}">${on ? ic("check", 12) : ""}${t}</button>`;
    }).join("");
  };
  const settingsHtml = () => {
    if (W.mode === "immediate") return `<div class="apw-note">${ic("zap", 18)}<div><b>Hazır olan hemen yayınlanır</b><p>Her video biter bitmez, incelemeni beklemeden Instagram'da paylaşılır. Açıklaması boşsa ya da hesap bağlı değilse paylaşılmaz; İncelemede bekler ve bildirim gelir.</p></div></div>`;
    if (W.mode === "review") return `<div class="apw-note">${ic("inbox", 18)}<div><b>Paylaşım sende</b><p>Otopilot fikirleri yazar ve videoları üretir. Hazır olanlar İçerikler › İncelemede listesinde bekler; istediğin zaman planlar ya da paylaşırsın.</p></div></div>`;
    if (W.mode === "slots") {
      const n = total();
      const list = [...W.slots].sort();
      return `<div class="apw-lab">Seçilen saatler <span class="muted">${list.length} saat · ${n} video</span></div>
        <div class="apw-slots">${list.length ? list.map((s, i) => `<span class="apw-slot ${pastSlot(s) ? "bad" : ""}" title="${pastSlot(s) ? "Bu saat geçti" : ""}"><b>${i + 1}</b>${when(s)}<button data-srm="${s}" title="Kaldır">${ic("x", 12)}</button></span>`).join("") : `<div class="sm muted">Henüz saat yok. Aşağıdan gün ve saat seçip <b>Bu saati ekle</b>'ye bas.</div>`}</div>
        ${list.length && list.length < n ? `<div class="apw-hint warn">${ic("info", 13)}<span>${n - list.length} video için saat yok; onlar İncelemede bekler.</span></div>` : list.length > n ? `<div class="apw-hint">${ic("info", 13)}<span>${list.length - n} saat boş kalır.</span></div>` : ""}
        <div class="apw-slotpick">${schedulerHtml(X, PICK, W.pick)}<input type="hidden" id="when" value="${esc(W.pick)}">
          <div class="row end"><button class="btn primary" id="schedBtn" data-ready="1" data-sadd>${ic("calendar-plus", 15)}Bu saati ekle</button></div></div>`;
    }
    const pre = (k, t) => `<button data-dpre="${k}">${t}</button>`;
    return `<div class="apw-grid2">
        <div><div class="apw-lab">Başlangıç günü</div><input type="date" class="apw-start" min="${today()}" value="${esc(W.start)}"></div>
        <div><div class="apw-lab">Sıklık</div><div class="seg apw-kind"><button data-kind="times" class="${W.kind === "times" ? "active" : ""}">${ic("clock", 14)}Belirli saatler</button><button data-kind="every" class="${W.kind === "every" ? "active" : ""}">${ic("timer", 14)}Her N saatte</button></div></div>
      </div>
      <div class="apw-lab">Günler <span class="apw-dpre">${pre("all", "Her gün")}${pre("wk", "Hafta içi")}${pre("we", "Hafta sonu")}</span></div>
      <div class="apw-days">${DAYS.map((d, i) => `<button data-wd="${i}" class="${W.days.includes(i) ? "on" : ""} ${i > 4 ? "we" : ""}">${d}</button>`).join("")}</div>
      ${W.kind === "times" ? `<div class="apw-lab">Saatler <span class="muted">günde ${W.times.length} paylaşım</span></div>
        <div class="apw-times">${timesHtml()}<span class="apw-tadd"><input type="time" class="apw-tin" value="20:30" aria-label="Saat"><button class="btn sm" data-tadd>${ic("plus", 13)}Ekle</button></span></div>`
      : `<div class="apw-lab">Aralık</div>
        <div class="apw-every"><span>Her</span><div class="apt-step"><button data-ev="-1" ${W.every <= 1 ? "disabled" : ""} aria-label="Azalt">${ic("minus", 13)}</button><b>${W.every}</b><span>saatte</span><button data-ev="1" ${W.every >= 24 ? "disabled" : ""} aria-label="Artır">${ic("plus", 13)}</button></div><span>bir,</span>
          <input type="time" class="apw-w0" value="${esc(W.win[0])}" aria-label="Başlangıç saati"><span>ile</span><input type="time" class="apw-w1" value="${esc(W.win[1])}" aria-label="Bitiş saati"><span>arasında</span></div>`}
      <div class="apw-hint">${ic("info", 13)}<span>Saatler video hazır olunca dağıtılır: yavaş biten video saat kaçırmaz, başka paylaşımla çakışan saatler atlanır.</span></div>`;
  };
  const redrawSettings = () => {
    const pane = curPane();
    const set = pane && $(".apw-set", pane);
    if (!set) return;
    set.innerHTML = settingsHtml();
    bindPane(pane);
  };

  // timeline
  const tlNote = (icon, t, s) => `<div class="apw-tln">${ic(icon, 20)}<b>${t}</b><span>${s}</span></div>`;
  const planShown = () => {
    const plan = planOf();
    return plan && plan.some(Boolean) ? plan : null;
  };
  const planStrip = (limit) => {
    const plan = planShown();
    if (!plan) return "";
    return `<div class="apw-tplan"><div class="apw-tplh">${ic("palette", 13)}Stil planı</div><div class="apw-tplg">${plan.slice(0, limit).map((id, i) => `<div><b>${i + 1}</b>${tplBadge(X, id, "xs")}</div>`).join("")}${plan.length > limit ? `<div class="muted sm">+${plan.length - limit}</div>` : ""}</div></div>`;
  };
  const timelineHtml = (limit = 12) => {
    const n = total();
    if (W.mode === "review") return tlNote("inbox", `${n} video İncelemede bekleyecek`, "Paylaşım zamanını sen seçeceksin.") + planStrip(limit);
    if (W.mode === "immediate") return tlNote("zap", `${n} video hazır oldukça paylaşılacak`, "Üretim sırasına göre, her biri bittiği anda.") + planStrip(limit);
    const plan = planShown();
    const pv = U.preview;
    if (!pv) {
      if (U.perr && !U.ploading) return tlNote("triangle-alert", "Önizleme alınamadı", esc(U.perr));
      return `<div class="apw-tlsk">${"<i></i>".repeat(4)}</div>`;
    }
    const slots = (pv.slots || []).slice(0, n);
    const timed = slots.map((s, i) => [s, i]).filter(([s]) => s && parseT(s));
    const rest = n - timed.length;
    if (!timed.length) return tlNote("calendar-clock", "Henüz saat yok", W.mode === "slots" ? "Saat ekledikçe burada görünecek." : "Gün ve saat seç.");
    const first = parseT(timed[0][0]);
    const last = parseT(timed[timed.length - 1][0]);
    const span = Math.round((new Date(last.getFullYear(), last.getMonth(), last.getDate()) - new Date(first.getFullYear(), first.getMonth(), first.getDate())) / 864e5) + 1;
    let out = `<div class="apw-tlh"><span><b>${timed.length}</b> paylaşım</span><span>${span} gün</span><span>${dayName(first)} → ${dayName(last)}</span></div><div class="apw-tll">`;
    let day = "";
    for (const [s, i] of timed.slice(0, limit)) {
      const t = parseT(s);
      const k = dstr(t);
      if (k !== day) {
        day = k;
        out += `<div class="apw-tlg">${dayName(t, true)}</div>`;
      }
      out += `<div class="apw-tli"><span class="apw-tlt">${hm(t)}</span><i class="apw-tld"></i><span class="apw-tlv"><span>${i + 1}. video</span>${plan ? tplBadge(X, plan[i] ?? null, "xs") : ""}</span></div>`;
    }
    out += "</div>";
    if (timed.length > limit) out += `<div class="apw-tlm">+${timed.length - limit} paylaşım daha · son: ${when(timed[timed.length - 1][0])}</div>`;
    if (rest > 0) out += `<div class="apw-hint warn">${ic("info", 13)}<span>${rest} video için saat yok; İncelemede bekler.</span></div>`;
    return out;
  };

  // step 5
  const costHtml = () => {
    const est = estChars();
    const cr = creditsOf(X);
    if (!cr) {
      const has = S.settings?.elevenlabs?.has_key;
      return `<div class="apw-cost warn"><span class="apw-ci">${ic("mic", 18)}</span><div class="grow"><b>Seslendirme ~${num(est)} karakter</b><div class="sm">${has ? "ElevenLabs kredisi okunamadı." : "ElevenLabs bağlı değil; seslendirme yapılamaz."}</div></div><button class="btn sm" data-settings>${ic("settings", 14)}Ayarlar</button></div>`;
    }
    const reserved = reservedOf();
    const left = Math.max(0, cr.left - reserved);
    const fits = est <= left;
    const per = W.duration * CPS;
    const fit = Math.max(0, Math.floor(left / Math.max(1, est / Math.max(1, total()))));
    const pct = left > 0 ? Math.round((est / left) * 100) : 100;
    return `<div class="apw-cost ${fits ? "" : "bad"}">
      <span class="apw-ci">${ic("mic", 18)}</span>
      <div class="grow">
        <div class="apw-crow"><b>Seslendirme ~${num(est)} karakter</b><span class="apw-cpct">${fits ? `kalanın %${pct}'i` : "yetmiyor"}</span></div>
        <div class="apw-meter"><i style="width:${Math.min(100, pct)}%"></i></div>
        <div class="sm apw-cs">${reserved ? `ElevenLabs kalan ${num(cr.left)}, ${num(reserved)} karakteri sıradaki videolara ayrıldı · kullanılabilir <b>${num(left)}</b>` : `ElevenLabs kalan <b>${num(left)}</b>${cr.limit ? ` / ${num(cr.limit)}` : ""} karakter`}${cr.reset_date ? ` · yenilenme ${esc(cr.reset_date)}` : ""} · video başına ~${num(per)}</div>
        ${fits ? "" : `<div class="apw-cwarn">${ic("triangle-alert", 14)}<span>Kredi yetmiyor: ~${num(est)} karakter gerekli, kullanılabilir ${num(left)}. Otopilot sığan ${fit} videoyu üretip duraklar; video sayısını azalt ya da süreyi kısalt.</span></div>`}
      </div>
    </div>`;
  };
  const checksHtml = () => {
    const ig = S.settings?.instagram || {};
    const igOk = ig.has_token && ig.username;
    const agentOn = (S.agents || []).some((a) => a.live && a.live !== "off");
    const items = [];
    const tg = W.targets || defaultTargets(S);
    if (W.mode !== "review" && tg.instagram) items.push(igOk ? ["ok", `Instagram bağlı: @${esc(ig.username)}`, ""] : ["warn", "Instagram bağlı değil", "Videolar üretilir ama paylaşılamaz; İncelemede bekler.", `<button class="btn sm" data-settings>${ic("plug", 13)}Bağla</button>`]);
    if (targetsReady(S) && tg.youtube) items.push(!S.youtube?.connected ? ["warn", "YouTube bağlı değil", "Videolar YouTube'a yüklenmez.", `<button class="btn sm" data-settings>${ic("plug", 13)}Bağla</button>`] : S.youtube.audited === false ? ["info", `YouTube bağlı: ${esc(S.youtube.channel_title || "kanal")}`, "Denetim yok: videolar çoğu projede yine yayınlanır, ama ilk videonun herkese açık olduğunu kontrol et."] : ["ok", `YouTube bağlı: ${esc(S.youtube.channel_title || "kanal")}`, ""]);
    items.push(agentOn ? ["ok", "Ajan bağlı", ""] : ["warn", "Ajan şu an bağlı değil", "İşler sıraya girer; ajan bağlanınca başlar."]);
    items.push(W.review ? ["info", "Fikirler yazılınca onayın beklenecek", "Bildirim gelir; seçimini Otopilot sekmesinden yaparsın."] : ["ok", "Fikirler otomatik seçilecek", ""]);
    items.push(["info", "Ajan kullanım limiti", `${W.topics.length} fikir seti ve ${total()} video üretimi ajanın kullanım limitinden harcar. Limit dolarsa işler sırada bekler.`]);
    if (W.mode !== "review") items.push(["info", "Stüdyo açık kalmalı", "Paylaşım saatlerinde stüdyonun açık olması yeterli (arka planda çalışabilir)."]);
    const errs = errorsOf();
    for (const w of errs) items.unshift(["err", esc(w), "Bunu düzeltmeden otopilot başlatılamaz."]);
    for (const w of (fresh() && U.preview.warnings) || []) if (!errs.includes(w) && !SKIPWARN.test(w)) items.push(["warn", esc(w), ""]);
    const icon = { ok: "circle-check", warn: "triangle-alert", info: "info", err: "circle-x" };
    return items.map(([k, t, s, btn]) => `<div class="apw-ck ${k}">${ic(icon[k], 16)}<div class="grow"><b>${t}</b>${s ? `<span>${s}</span>` : ""}</div>${btn || ""}</div>`).join("");
  };
  const summaryHtml = () => {
    const tpl = `Stil: ${styleText(X, tplBrief())}`;
    const mode = MODES.find((m) => m.k === W.mode);
    const pubLine = W.mode === "interval" ? `${daysText(W.days)} · ${W.kind === "times" ? [...W.times].sort().join(", ") || "saat yok" : `her ${W.every} saatte bir (${W.win[0]}–${W.win[1]})`} · ${dayName(parseT(W.start), true)} başlar`
      : W.mode === "slots" ? `${W.slots.length} saat${W.slots.length ? `: ${[...W.slots].sort().slice(0, 3).map(when).join(", ")}${W.slots.length > 3 ? "…" : ""}` : ""}` : mode.s;
    const rows = [
      ["list", "Konular", `<span class="apw-tags">${W.topics.map((t) => `<span class="tag">${esc(t.topic.trim() || "—")} <b>×${t.count}</b>${t.template ? `<i class="apw-tt">${esc(tplName(X, t.template))}</i>` : ""}</span>`).join("")}</span>`, 0],
      ["sliders-horizontal", "İçerik", `<span class="apw-tags">${[`${W.duration} sn`, W.tone, tpl, W.audience.trim(), W.notes.trim() && `not: ${W.notes.trim().slice(0, 40)}${W.notes.trim().length > 40 ? "…" : ""}`].filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</span>`, 1],
      ["list-checks", "Fikir seçimi", W.review ? "Ben onaylayacağım" : "Ajan otomatik seçecek", 2],
      [mode.icon, "Paylaşım", `<b>${mode.t}</b><div class="sm muted">${esc(pubLine)}</div>`, 3],
    ];
    if (targetsReady(S)) rows.push(["send", "Şurada paylaş", esc(targetsText(W.targets || defaultTargets(S))), 3]);
    return rows.map(([i, l, v, s]) => `<div class="apw-sr"><span class="apw-sl">${ic(i, 14)}${l}</span><span class="apw-sv">${v}</span><button class="apw-edit" data-edit="${s}">${ic("pencil", 12)}Düzenle</button></div>`).join("");
  };

  const paneHtml = (i) => {
    if (i === 0) return head(0, "Hangi konularda video üretilsin?", "Her konu için kaç video istediğini seç. Ajan her konu için fikir yazar, en iyilerini videoya dönüştürür.")
      + `<div class="apt-list apw-anim">${topicsHtml()}</div>
        <button class="apt-add apw-anim" data-add>${ic("plus", 15)}Konu ekle</button>
        <div class="apt-recent-w apw-anim">${recentHtml()}</div>
        <div class="apt-total apw-anim">${totalHtml()}</div>`;
    if (i === 1) return head(1, "Videolar nasıl olsun?", "Bu ayarlar bütün videolarda geçerli. Boş bırakılanları ajan konuya göre belirler.")
      + `<div class="apw-lab apw-anim">Video süresi</div>
        <div class="apw-dur apw-anim">${durSlider("apwDur", W.duration)}</div>
        <div class="sm muted apw-durh">Video başına ~${num(W.duration * CPS)} karakter seslendirme</div>
        <div class="apw-lab apw-anim">Ton</div>
        <div class="chips apw-tone apw-anim">${TONES.map((t) => `<button data-tone="${esc(t)}" class="${W.tone === t ? "active" : ""}">${esc(t)}</button>`).join("")}</div>
        <div class="apw-lab apw-anim">Video stili</div>
        <div class="seg apw-tmode apw-anim">${tmodeHtml()}</div>
        <div class="apw-tplw apw-anim">${styleHtml()}</div>
        <div class="apw-grid2 apw-anim">
          <div><div class="apw-lab">Hedef kitle</div><input class="apw-aud" maxlength="120" placeholder="ör. yeni başlayan içerik üreticileri" value="${esc(W.audience)}"></div>
          <div><div class="apw-lab">Ek not</div><textarea class="apw-notes" rows="2" maxlength="600" placeholder="ör. sayılarla anlatılsın, mizahi olsun, rakip isim geçmesin…">${esc(W.notes)}</textarea></div>
        </div>`;
    if (i === 2) return head(2, "Fikirleri kim seçsin?", "Ajan her konu için fikir yazar. Hangilerinin videoya dönüşeceğine kimin karar vereceğini seç.")
      + `<div class="apw-opts">
          <button class="apw-opt apw-anim ${W.review ? "" : "on"}" data-review="0"><span class="apw-oi">${ic("wand-sparkles", 22)}</span><b>Otomatik seç</b><span>Ajan yazdığı fikirlerden her konu için istediğin kadarını seçer ve beklemeden üretime gönderir.</span><em class="tag">${ic("zap", 12)}En hızlı</em><i class="apw-radio"></i></button>
          <button class="apw-opt apw-anim ${W.review ? "on" : ""}" data-review="1"><span class="apw-oi">${ic("user-check", 22)}</span><b>Ben onaylayayım</b><span>Fikirler yazılınca haber verilir; okuyup seçtiklerin üretilir. Sonrası yine otomatik.</span><em class="tag">${ic("eye", 12)}Tam kontrol</em><i class="apw-radio"></i></button>
        </div>
        <div class="apw-flow apw-anim">${flowHtml()}</div>`;
    if (i === 3) return head(3, "Videolar ne zaman paylaşılsın?", `Videolar hazır oldukça seçtiğin plana göre ${targetsReady(S) ? "seçtiğin yerlerde" : "Instagram'da"} yayınlanır.`)
      + `<div class="apw-modes">${MODES.map((m) => `<button class="apw-mode apw-anim ${W.mode === m.k ? "on" : ""}" data-mode="${m.k}"><span class="apw-mi">${ic(m.icon, 20)}</span><span class="grow"><b>${m.t}</b><span>${m.s}</span></span><i class="apw-radio"></i></button>`).join("")}</div>
        <div class="apw-pub apw-anim">
          <div class="apw-set">${settingsHtml()}</div>
          <div class="apw-tlbox"><div class="apw-tltitle">${ic("calendar-days", 14)}Paylaşım takvimi<span class="apw-tlspin"></span></div><div class="apw-tl">${timelineHtml()}</div></div>
        </div>
        ${targetsReady(S) ? `<div class="apw-tgt apw-anim">${targetsHtml(X, W.targets || defaultTargets(S), { id: "apwTargets" })}<div class="tgt-note">Bu otopilotun ürettiği her video seçtiğin yerlerde paylaşılır.</div></div>` : ""}`;
    return head(4, "Her şey hazır mı?", "Kontrol et, gerekirse düzenle ve otopilotu başlat.")
      + (W.repeat_of ? `<div class="apw-rep apw-anim">${ic("copy-plus", 18)}<div class="grow"><b>Tekrar: ${esc(W.repeat_name || W.repeat_of)}</b><span>Önceki fikirlerden farklı fikirler yazılır. Ayarları istediğin gibi değiştirebilirsin.</span></div><button class="btn ghost icon sm" data-unrep title="Bağımsız yeni üretim olarak başlat">${ic("x", 14)}</button></div>` : "")
      + `<div class="apw-lab apw-anim">Ad <span class="muted">(isteğe bağlı)</span></div>
        <input class="apw-name apw-anim" maxlength="60" placeholder="${esc(W.topics[0]?.topic.trim() || "Otomatik üretim")}" value="${esc(W.name)}">
        <div class="apw-sum apw-anim">${summaryHtml()}</div>
        <div class="apw-costw apw-anim">${costHtml()}</div>
        <div class="apw-sumtl apw-anim"><div class="apw-tltitle">${ic("calendar-days", 14)}İlk paylaşımlar<span class="apw-tlspin"></span></div><div class="apw-tl">${timelineHtml(5)}</div></div>
        <div class="apw-checks apw-anim">${checksHtml()}</div>`;
  };

  const liveHtml = () => {
    const n = total();
    const est = estChars();
    const cr = creditsOf(X);
    const bad = cr && est > cr.left - reservedOf();
    let first = "";
    if (W.mode === "immediate") first = "hazır olunca";
    else if (W.mode === "review") first = "sen paylaşırsın";
    else if (fresh()) {
      const s = (U.preview.slots || []).find((x) => x && parseT(x));
      first = s ? when(s) : "";
    } else if (W.mode === "slots" && W.slots.length) first = when([...W.slots].sort()[0]);
    return `<span>${ic("film", 13)}<b>${n}</b> video</span><span class="${bad ? "bad" : ""}" title="${bad ? "ElevenLabs kredisi yetmiyor" : "Tahmini seslendirme"}">${ic(bad ? "triangle-alert" : "mic", 13)}~${num(est)} karakter</span>${first ? `<span class="apw-lf">${ic("calendar-clock", 13)}${first}</span>` : ""}`;
  };
  const renderFoot = () => {
    if (sending) return;
    const last = W.step === STEPS.length - 1;
    foot.innerHTML = `<button class="btn ghost" data-nav="-1" ${W.step ? "" : "disabled"}>${ic("arrow-left", 15)}<span class="apw-hide">Geri</span></button>
      <div class="apw-live grow">${liveHtml()}</div>
      ${last ? `<button class="btn primary apw-go" data-start ${errorsOf().length ? "disabled" : ""} title="${esc(errorsOf()[0] || "")}">${ic("rocket", 16)}Otopilotu başlat</button>` : `<button class="btn primary" data-nav="1">İleri${ic("arrow-right", 15)}</button>`}`;
  };
  const paintLive = () => {
    if (!box.isConnected) return;
    const live = $(".apw-live", foot);
    if (live) live.innerHTML = liveHtml();
    const go = $("[data-start]", foot);
    if (go && !sending) {
      const er = errorsOf();
      go.disabled = er.length > 0;
      go.title = er[0] || "";
    }
    const pane = curPane();
    if (!pane) return;
    const step = +pane.dataset.step;
    for (const tl of $$(".apw-tl", pane)) {
      tl.innerHTML = timelineHtml(step === 4 ? 5 : 12);
      tl.classList.toggle("stale", !!U.preview && !fresh());
    }
    for (const sp of $$(".apw-tlspin", pane)) sp.innerHTML = U.ploading ? ic("loader-circle", 13, "spin") : "";
    const cost = $(".apw-costw", pane);
    if (cost) cost.innerHTML = costHtml();
    const ck = $(".apw-checks", pane);
    if (ck) ck.innerHTML = checksHtml();
  };
  U.paint = paintLive;

  const syncSteps = () => {
    $$(".apw-st", box).forEach((b, i) => {
      b.classList.toggle("on", i === W.step);
      b.classList.toggle("done", i < W.step);
    });
    $(".apw-rail i", box).style.width = `${(W.step / (STEPS.length - 1)) * 100}%`;
  };

  const bindPane = (pane) => {
    const wrap = $(".apw-slotpick", pane);
    if (wrap) bindPick(X, wrap);
    bindDurSlider($("#apwDur", pane), (v) => {
      W.duration = v;
      const h = $(".apw-durh", pane);
      if (h) h.textContent = `Video başına ~${num(W.duration * CPS)} karakter seslendirme`;
      changed();
    });
  };

  const renderPane = (dir = 0) => {
    closePicker();
    const olds = $$(".apw-pane", stage);
    const pane = document.createElement("div");
    pane.className = "apw-pane";
    pane.dataset.step = W.step;
    pane.innerHTML = paneHtml(W.step);
    stage.append(pane);
    for (const o of olds) {
      o.classList.add("out");
      if (rm || !dir) o.remove();
      else done(o.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dir * 36}px)` }], { duration: 220, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }), () => o.remove());
    }
    if (dir && !rm) {
      pane.animate([{ opacity: 0, transform: `translateX(${dir * 48}px)` }, { opacity: 1, transform: "none" }], { duration: 460, delay: 80, easing: EASE, fill: "backwards" });
      $$(".apw-anim", pane).forEach((n, k) => n.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 360, delay: 150 + k * 35, easing: EASE, fill: "backwards" }));
    }
    bindPane(pane);
    syncSteps();
    renderFoot();
    paintLive();
    if (W.step === 0) syncTopics();
    if (dir) main.scrollTo({ top: 0, behavior: rm ? "auto" : "smooth" });
    if (W.step === 0 && !W.topics[0].topic) setTimeout(() => pane.isConnected && $(".apt-topic", pane)?.focus({ preventScroll: true }), dir && !rm ? 300 : 0);
  };

  const stepErr = (i) => {
    if (i === 0) {
      const k = W.topics.findIndex((t) => !t.topic.trim());
      if (k >= 0) return { step: 0, msg: W.topics.length > 1 ? "Boş konu satırını doldur ya da kaldır" : "Önce bir konu yaz", focus: `.apt-topic[data-i="${k}"]` };
      if (total() > MAX) return { step: 0, msg: `En fazla ${MAX} video olabilir` };
    }
    if (i === 1) {
      if (W.tmode === "single" && !W.template) return { step: 1, msg: "Bir stil seç ya da 'Serbest tasarım'ı kullan" };
      if (W.tmode === "mix" && W.templates.length < 2) return { step: 1, msg: "Karışık için en az 2 stil işaretle" };
    }
    if (i === 3) {
      if (W.mode === "interval") {
        if (!W.days.length) return { step: 3, msg: "En az bir gün seç" };
        if (W.kind === "times" && !W.times.length) return { step: 3, msg: "En az bir saat seç" };
        if (W.kind === "every" && !(W.win[0] && W.win[1] && W.win[0] < W.win[1])) return { step: 3, msg: "Saat aralığının başı sonundan önce olmalı", focus: ".apw-w0" };
        if (!W.start) return { step: 3, msg: "Başlangıç gününü seç", focus: ".apw-start" };
      }
      if (W.mode === "slots") {
        if (!W.slots.length) return { step: 3, msg: "En az bir paylaşım saati ekle" };
        if (W.slots.some(pastSlot)) return { step: 3, msg: "Geçmişte kalan saatleri kaldır" };
      }
    }
    return null;
  };
  const flag = (er) => {
    X.toast(er.msg, true);
    const el = er.focus && $(er.focus, curPane() || box);
    if (!el) return;
    el.focus();
    el.classList.add("apw-err");
    if (!rm) el.animate([{ transform: "none" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "none" }], { duration: 340 });
    setTimeout(() => el.classList.remove("apw-err"), 1600);
  };
  const goStep = (i, dir) => {
    i = clamp(i, 0, STEPS.length - 1);
    if (i === W.step && curPane()) return;
    dir = dir || (i > W.step ? 1 : -1);
    W.step = i;
    keep();
    renderPane(dir);
  };
  const goTo = (i) => {
    for (let k = W.step; k < i; k++) {
      const er = stepErr(k);
      if (er) {
        if (er.step !== W.step) goStep(er.step);
        flag(er);
        return;
      }
    }
    goStep(i);
  };
  const next = () => {
    const er = stepErr(W.step);
    if (er) return flag(er);
    goStep(W.step + 1, 1);
  };

  const changed = (redraw = false) => {
    keep();
    if (redraw) redrawSettings();
    schedulePreview(X);
    paintLive();
  };

  const addRow = (topic = "") => {
    const n = total();
    if (n >= MAX) return X.toast(`En fazla ${MAX} video`, true);
    W.topics.push({ topic, count: Math.min(3, MAX - n), template: "" });
    redrawTopics(W.topics.length - 1);
    changed();
  };
  const removeRow = (i) => {
    if (W.topics.length < 2) return;
    const pane = curPane();
    const row = pane && $(`.apt-row[data-row="${i}"]`, pane);
    const finish = () => {
      W.topics.splice(i, 1);
      redrawTopics();
      changed();
    };
    if (!row || rm) return finish();
    row.style.overflow = "hidden";
    done(row.animate([{ opacity: 1, height: `${row.offsetHeight}px` }, { opacity: 0, height: "0px", paddingTop: "0px", paddingBottom: "0px", marginTop: "-8px" }], { duration: 220, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }), finish);
  };
  const bump = (i, d) => {
    const t = W.topics[i];
    if (!t) return;
    t.count = clamp(t.count + d, 1, MAX - (total() - t.count));
    syncTopics();
    changed();
  };
  const addRecent = (topic) => {
    const empty = W.topics.findIndex((t) => !t.topic.trim());
    if (empty >= 0) {
      W.topics[empty].topic = topic;
      redrawTopics();
      changed();
      return;
    }
    addRow(topic);
  };
  const addSlot = () => {
    const pane = curPane();
    const v = $("#when", $(".apw-slotpick", pane) || pane)?.value || W.pick;
    const t = parseT(v);
    if (!t || pastSlot(v)) return X.toast("En az 10 dakika sonrası için bir saat seç", true);
    if (W.slots.some((s) => Math.abs(parseT(s) - t) < 30 * 60e3)) return X.toast("Bu saate çok yakın bir paylaşım zaten var (30 dk)", true);
    W.slots.push(fmtLocal(t));
    W.slots.sort();
    const nt = new Date(t);
    do nt.setDate(nt.getDate() + 1);
    while (W.slots.some((s) => Math.abs(parseT(s) - nt) < 30 * 60e3));
    W.pick = fmtLocal(nt);
    X.S.when = null;
    changed(true);
    const chip = $$(".apw-slot", curPane()).find((c) => c.textContent.includes(when(fmtLocal(t))));
    if (chip && !rm) chip.animate([{ opacity: 0, transform: "scale(.85)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: EASE });
  };

  const start = X.guard(async (btn) => {
    if (sending) return;
    for (let k = 0; k < STEPS.length - 1; k++) {
      const er = stepErr(k);
      if (er) {
        goStep(er.step);
        flag(er);
        return;
      }
    }
    sending = true;
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${ic("loader-circle", 16, "spin")}Başlatılıyor…`;
    try {
      const body = { name: W.name.trim() || undefined, topics: topicsOf(), brief: briefOf(), review_ideas: W.review, publish: publishOf(), ...(targetsReady(X.S) ? { targets: W.targets || defaultTargets(X.S) } : {}) };
      if (W.repeat_of) body.repeat_of = W.repeat_of;
      const c = await X.api("/api/autopilot", body);
      dropDraft();
      W = null;
      U.preview = null;
      U.pkey = "";
      U.mode = "detail";
      U.sel = c.id;
      U.detail = c.id ? c : null;
      X.toast("Otopilot başladı; ajan fikirleri yazmaya başlıyor");
      await X.refresh();
      renderAutopilot(X);
    } finally {
      sending = false;
      if (btn.isConnected) {
        btn.disabled = false;
        btn.innerHTML = label;
      }
    }
  });

  box.addEventListener("click", (e) => {
    if (e.target.closest("#sched")) return;
    const b = e.target.closest("button");
    if (!b || !box.contains(b) || b.disabled) return;
    const d = b.dataset;
    if (b.hasAttribute("data-close")) {
      keep();
      U.mode = (X.S.autopilot || []).length ? "detail" : "home";
      drawSide(X);
      renderMain(X);
    } else if (b.hasAttribute("data-reset")) {
      X.confirm("Taslak temizlensin mi?", "Bu sihirbazda girdiğin her şey silinir ve baştan başlarsın.", "Temizle", () => {
        W = blank();
        dropDraft();
        U.preview = null;
        U.pkey = "";
        $(".apw-title", box).textContent = "Yeni otomatik üretim";
        renderPane(0);
        drawSide(X);
        schedulePreview(X, 0);
      });
    } else if (d.apk) {
      if (d.apk === "brief") openPicker(X, b, briefOpts, onBriefPick);
      else if (d.apk.startsWith("topic:")) {
        const i = +d.apk.slice(6);
        openPicker(X, b, () => topicOpts(i), (v) => setTopicTpl(i, v));
      }
    } else if (d.tmode) setTmode(d.tmode);
    else if (b.hasAttribute("data-unrep")) {
      W.repeat_of = "";
      W.repeat_name = "";
      keep();
      $(".apw-title", box).textContent = "Yeni otomatik üretim";
      const r = $(".apw-rep", curPane());
      if (r) r.remove();
      drawSide(X);
      X.toast("Bağımsız yeni üretim olarak başlatılacak");
    } else if (d.go != null) goTo(+d.go);
    else if (d.nav) {
      if (+d.nav > 0) next();
      else goStep(W.step - 1, -1);
    } else if (b.hasAttribute("data-start")) start(b);
    else if (b.hasAttribute("data-add")) addRow();
    else if (d.rm != null) removeRow(+d.rm);
    else if (d.cnt != null) bump(+d.cnt, +d.d);
    else if (d.recent != null) addRecent(d.recent);
    else if (d.dur) {
      W.duration = +d.dur;
      $$("[data-dur]", box).forEach((x) => x.classList.toggle("active", +x.dataset.dur === W.duration));
      const h = $(".apw-durh", box);
      if (h) h.textContent = `Video başına ~${num(W.duration * CPS)} karakter seslendirme`;
      changed();
    } else if (d.tone != null) {
      W.tone = W.tone === d.tone ? "" : d.tone;
      $$("[data-tone]", box).forEach((x) => x.classList.toggle("active", x.dataset.tone === W.tone));
      changed();
    }
    else if (d.review != null) {
      W.review = d.review === "1";
      $$("[data-review]", box).forEach((x) => x.classList.toggle("on", (x.dataset.review === "1") === W.review));
      const f = $(".apw-flow", box);
      if (f) f.innerHTML = flowHtml();
      keep();
      paintLive();
    } else if (d.mode) {
      if (W.mode === d.mode) return;
      W.mode = d.mode;
      $$("[data-mode]", box).forEach((x) => x.classList.toggle("on", x.dataset.mode === W.mode));
      changed(true);
      const set = $(".apw-set", curPane());
      if (set && !rm) set.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: EASE });
    } else if (d.wd != null) {
      const i = +d.wd;
      W.days = W.days.includes(i) ? W.days.filter((x) => x !== i) : [...W.days, i].sort();
      b.classList.toggle("on", W.days.includes(i));
      changed();
    } else if (d.dpre) {
      W.days = d.dpre === "all" ? [0, 1, 2, 3, 4, 5, 6] : d.dpre === "wk" ? [0, 1, 2, 3, 4] : [5, 6];
      $$("[data-wd]", box).forEach((x) => x.classList.toggle("on", W.days.includes(+x.dataset.wd)));
      changed();
    } else if (d.kind) {
      if (W.kind === d.kind) return;
      W.kind = d.kind;
      changed(true);
    } else if (d.qt) {
      W.times = W.times.includes(d.qt) ? W.times.filter((x) => x !== d.qt) : [...W.times, d.qt].sort();
      changed(true);
    } else if (b.hasAttribute("data-tadd")) {
      const v = $(".apw-tin", box)?.value;
      if (!/^\d{2}:\d{2}$/.test(v || "")) return X.toast("Geçerli bir saat yaz", true);
      if (!W.times.includes(v)) W.times = [...W.times, v].sort();
      changed(true);
    } else if (d.ev) {
      W.every = clamp(W.every + +d.ev, 1, 24);
      changed(true);
    } else if (b.hasAttribute("data-sadd")) addSlot();
    else if (d.srm) {
      W.slots = W.slots.filter((s) => s !== d.srm);
      changed(true);
    } else if (d.edit != null) goStep(+d.edit, -1);
    else if (b.hasAttribute("data-settings")) X.openSettings();
  });
  box.addEventListener("tgchange", (e) => {
    W.targets = e.detail.value;
    changed();
  });
  box.addEventListener("input", (e) => {
    const t = e.target;
    if (t.matches(".apt-topic")) {
      const k = +t.dataset.i;
      if (W.topics[k]) W.topics[k].topic = t.value;
      t.classList.remove("apw-err");
      keep();
      schedulePreview(X);
    } else if (t.matches(".apw-aud")) {
      W.audience = t.value;
      keep();
    } else if (t.matches(".apw-notes")) {
      W.notes = t.value;
      keep();
    } else if (t.matches(".apw-name")) {
      W.name = t.value;
      keep();
    } else if (t.matches(".apw-start")) {
      if (t.value) {
        W.start = t.value < today() ? today() : t.value;
        changed();
      }
    } else if (t.matches(".apw-w0, .apw-w1")) {
      if (/^\d{2}:\d{2}$/.test(t.value)) {
        W.win[t.matches(".apw-w0") ? 0 : 1] = t.value;
        changed();
      }
    }
  });
  box.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const t = e.target;
    if (t.matches(".apt-topic")) {
      e.preventDefault();
      const k = +t.dataset.i;
      if (!t.value.trim()) return;
      if (k < W.topics.length - 1) $(`.apt-topic[data-i="${k + 1}"]`, curPane())?.focus();
      else if (total() < MAX) addRow();
      else next();
    } else if (t.matches(".apw-tin")) {
      e.preventDefault();
      $("[data-tadd]", box)?.click();
    } else if (t.matches(".apw-name, .apw-aud")) {
      e.preventDefault();
      if (t.matches(".apw-aud")) next();
    }
  });

  renderPane(0);
  schedulePreview(X, 0);
}

const FREE = "Serbest tasarım";
const FREE_HINT = "Şablon yok; ajan her videoyu özgün tasarlar";
const tplFind = (X, id) => (X.S.templates || []).find((t) => t.id === id);
const tplName = (X, id) => tplFind(X, id)?.name || id;

function tplBadge(X, id, cls = "") {
  const { ic, esc } = X;
  if (!id) return `<span class="aptb auto ${cls}" title="${FREE_HINT}">${ic("wand-sparkles", 11)}<span>${FREE}</span></span>`;
  const t = tplFind(X, id);
  return `<span class="aptb ${cls}" title="${esc(t?.name || id)}">${t?.poster ? `<img src="${esc(t.poster)}" alt="" loading="lazy">` : ic("palette", 11)}<span>${esc(t?.name || id)}</span></span>`;
}

function styleText(X, b) {
  const mode = b?.template_mode || ((b?.templates || []).length > 1 ? "mix" : b?.template ? "single" : "agent");
  if (mode === "mix" && (b.templates || []).length) return `Karışık (${b.templates.map((id) => tplName(X, id)).join(", ")})`;
  if (mode === "single" && b.template) return `Tek stil (${tplName(X, b.template)})`;
  return FREE;
}

let PK = null;

const posterImg = (X, id) => {
  const t = tplFind(X, id);
  return t?.poster ? `<img src="${X.esc(t.poster)}" alt="">` : `<i class="apk-noimg">${X.ic("palette", 12)}</i>`;
};

function pickLabel(X, o) {
  const { ic, esc } = X;
  if (o.multi) {
    const ids = o.value || [];
    if (!ids.length) return `${ic("shuffle", 14)}<span class="apk-l">Stilleri seç</span>`;
    return `<span class="apk-stack">${ids.slice(0, 3).map((id) => posterImg(X, id)).join("")}</span><span class="apk-l">Karışık: ${esc(ids.map((id) => tplName(X, id)).join(", "))}</span>`;
  }
  if (o.value) return `${posterImg(X, o.value)}<span class="apk-l">${esc(tplName(X, o.value))}</span>`;
  return `${ic(o.defIcon || "wand-sparkles", 14)}<span class="apk-l">${esc(o.defLabel || "Stil seç")}</span>`;
}

function pickBtn(X, key, o) {
  const set = o.multi ? (o.value || []).length > 0 : !!o.value;
  const open = PK?.key === key;
  return `<button type="button" class="apk ${o.cls || ""} ${set ? "set" : ""} ${open ? "open" : ""}" data-apk="${X.esc(key)}" aria-haspopup="dialog" aria-expanded="${open}" title="${X.esc(o.title || "Video stili")}">${pickLabel(X, o)}${X.ic("chevron-down", 13)}</button>`;
}

function drawPicker() {
  if (!PK) return;
  const { X, pop } = PK;
  const { ic, esc } = X;
  const o = PK.getOpts();
  const g = $(".apk-g", pop);
  const top = g ? g.scrollTop : 0;
  const list = X.S.templates || [];
  const vals = o.multi ? o.value || [] : [];
  pop.innerHTML = `<div class="apk-h"><b>${esc(o.title || "Video stili")}</b>${o.hint ? `<span>${esc(o.hint)}</span>` : ""}</div>
    <div class="apk-g">
      ${o.multi ? "" : `<button type="button" class="apk-t ${o.value ? "" : "on"}" data-v=""><span class="apk-m def">${ic(o.tileIcon || o.defIcon || "wand-sparkles", 18)}</span><span class="apk-n">${esc(o.defShort || o.defLabel || "Varsayılan")}</span>${o.defSub ? `<em>${esc(o.defSub)}</em>` : ""}</button>`}
      ${list.map((t) => {
        const k = vals.indexOf(t.id);
        const on = o.multi ? k >= 0 : o.value === t.id;
        return `<button type="button" class="apk-t ${on ? "on" : ""}" data-v="${esc(t.id)}" aria-pressed="${on}" title="${esc(t.best_for ? `${t.name} · ${t.best_for}` : t.name)}"><span class="apk-m">${t.poster ? `<img src="${esc(t.poster)}" alt="" loading="lazy">${t.preview ? `<video src="${esc(t.preview)}" muted loop playsinline preload="none"></video>` : ""}` : ic("film", 16)}<i class="apk-z" data-z="${esc(t.id)}" title="Büyük ekranda izle">${ic("maximize-2", 11)}</i>${k >= 0 ? `<b class="apk-o">${k + 1}</b>` : ""}</span><span class="apk-n">${esc(t.name)}</span></button>`;
      }).join("")}
    </div>
    ${o.multi ? `<div class="apk-f"><span class="${vals.length < 2 ? "warn" : ""}">${vals.length < 2 ? `En az 2 stil seç (${vals.length} seçili)` : `${vals.length} stil · işaretlediğin sırayla dönüşür`}</span><button type="button" class="btn sm primary" data-done>Tamam</button></div>` : ""}`;
  $(".apk-g", pop).scrollTop = top;
  for (const t of $$(".apk-t", pop)) {
    const v = $("video", t);
    if (!v) continue;
    t.onmouseenter = () => {
      v.play().catch(() => {});
    };
    t.onmouseleave = () => {
      v.pause();
      v.currentTime = 0;
    };
  }
}

function placePicker() {
  if (!PK) return;
  let a = PK.anchor;
  if (!a?.isConnected) {
    a = PK.anchor = document.querySelector(`[data-apk="${CSS.escape(PK.key)}"]`);
    if (!a) return closePicker();
    a.classList.add("open");
    a.setAttribute("aria-expanded", "true");
  }
  const r = a.getBoundingClientRect();
  if ((!r.width && !r.height) || r.bottom < 0 || r.top > innerHeight) return closePicker();
  const pop = PK.pop;
  const w = Math.min(468, innerWidth - 16);
  pop.style.width = `${w}px`;
  pop.style.left = `${Math.round(Math.min(Math.max(8, r.left), innerWidth - w - 8))}px`;
  const below = innerHeight - r.bottom - 14;
  const above = r.top - 14;
  if (below >= 300 || below >= above) {
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.bottom = "";
    pop.style.maxHeight = `${Math.round(below)}px`;
  } else {
    pop.style.top = "";
    pop.style.bottom = `${Math.round(innerHeight - r.top + 6)}px`;
    pop.style.maxHeight = `${Math.round(above)}px`;
  }
}

const pkDown = (e) => {
  if (!PK || e.target.closest(".apk-pop, .tv")) return;
  if (e.target.closest("[data-apk]")?.dataset.apk === PK.key) return;
  closePicker();
};
const pkKey = (e) => {
  if (!PK || e.key !== "Escape" || document.querySelector(".tv")) return;
  e.preventDefault();
  e.stopPropagation();
  closePicker(true);
};
const pkMove = () => placePicker();

function closePicker(focus = false) {
  if (!PK) return;
  const { pop, key } = PK;
  PK = null;
  document.removeEventListener("mousedown", pkDown, true);
  document.removeEventListener("keydown", pkKey, true);
  document.removeEventListener("scroll", pkMove, true);
  removeEventListener("resize", pkMove);
  pop.remove();
  const a = document.querySelector(`[data-apk="${CSS.escape(key)}"]`);
  if (!a) return;
  a.classList.remove("open");
  a.setAttribute("aria-expanded", "false");
  if (focus) a.focus({ preventScroll: true });
}

function openPicker(X, anchor, getOpts, onChange) {
  const key = anchor.dataset.apk;
  if (PK?.key === key) return closePicker(true);
  closePicker();
  const pop = document.createElement("div");
  pop.className = "apk-pop";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", getOpts().title || "Video stili");
  document.body.append(pop);
  PK = { X, key, anchor, pop, getOpts, onChange };
  anchor.classList.add("open");
  anchor.setAttribute("aria-expanded", "true");
  drawPicker();
  placePicker();
  if (!reduced()) pop.animate([{ opacity: 0, transform: "translateY(-6px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 200, easing: EASE });
  ($(".apk-t.on", pop) || $(".apk-t", pop))?.focus({ preventScroll: true });
  document.addEventListener("mousedown", pkDown, true);
  document.addEventListener("keydown", pkKey, true);
  document.addEventListener("scroll", pkMove, true);
  addEventListener("resize", pkMove);
  pop.onclick = (e) => {
    if (!PK) return;
    const z = e.target.closest("[data-z]");
    if (z) {
      e.stopPropagation();
      const media = z.closest(".apk-m");
      import("/web/tplstudio.js").then((m) => m.openTemplateViewer(X, X.S.templates || [], z.dataset.z, media, (id) => {
        if (!PK) return;
        const o = PK.getOpts();
        if (!o.multi) {
          PK.onChange(id);
          closePicker(true);
          return;
        }
        if (!(o.value || []).includes(id)) PK.onChange([...(o.value || []), id]);
        drawPicker();
        placePicker();
      })).catch(() => {});
      return;
    }
    if (e.target.closest("[data-done]")) {
      closePicker(true);
      return;
    }
    const t = e.target.closest("[data-v]");
    if (!t) return;
    const o = PK.getOpts();
    const v = t.dataset.v;
    if (!o.multi) {
      PK.onChange(v);
      closePicker(true);
      return;
    }
    const cur = o.value || [];
    PK.onChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);
    drawPicker();
    placePicker();
    $(`.apk-t[data-v="${CSS.escape(v)}"]`, pop)?.focus({ preventScroll: true });
  };
}

function defaultStyle(X, c, e) {
  const t = (c.topics || [])[e.index] || (c.topics || []).find((x) => x.topic === e.topic);
  if (t?.template) return tplName(X, t.template);
  const b = c.brief || {};
  const mode = b.template_mode || ((b.templates || []).length > 1 ? "mix" : b.template ? "single" : "agent");
  if (mode === "single" && b.template) return tplName(X, b.template);
  if (mode === "mix") return "karışık sıra";
  return FREE;
}

function fromBody(d, id, srcName) {
  const w = blank();
  const b = d.brief || {};
  const p = d.publish || {};
  const iv = p.interval || {};
  Object.assign(w, {
    step: STEPS.length - 1,
    name: d.name || "",
    topics: (d.topics || []).map((t) => ({ topic: String(t.topic || ""), count: +t.count || 1, template: t.template || "" })),
    duration: +b.duration || 30,
    tone: b.tone || "",
    audience: b.audience || "",
    notes: b.notes || "",
    tmode: b.template_mode || ((b.templates || []).length > 1 ? "mix" : b.template ? "single" : "agent"),
    template: b.template || "",
    templates: [...(b.templates || [])],
    review: !!d.review_ideas,
    mode: MODES.some((m) => m.k === p.mode) ? p.mode : "interval",
    slots: (p.slots || []).map((x) => String(x).slice(0, 16)),
    start: iv.start || today(),
    days: Array.isArray(iv.days) ? iv.days.map(Number) : [0, 1, 2, 3, 4, 5, 6],
    kind: iv.every_hours ? "every" : "times",
    times: (iv.times || []).length ? [...iv.times] : ["12:00", "19:00"],
    every: +iv.every_hours || 6,
    win: (iv.window || []).length === 2 ? [...iv.window] : ["09:00", "23:00"],
    repeat_of: d.repeat_of || id,
    repeat_name: d.repeat_name || srcName || "",
    targets: d.targets || null,
  });
  return w;
}

function repeatCampaign(X, id, name) {
  const src = name || (X.S.autopilot || []).find((c) => c.id === id)?.name || id;
  const run = X.guard(async () => {
    const body = await X.api(`/api/autopilot/${encodeURIComponent(id)}/duplicate`, {});
    W = fromBody(body, id, src);
    keep();
    U.preview = null;
    U.pkey = "";
    U.mode = "wiz";
    drawSide(X);
    renderMain(X);
    X.toast("Ayarlar kopyalandı; istediğini değiştirip başlatabilirsin");
  });
  if (hasDraft() && !(W && W.repeat_of === id)) X.confirm("Taslak değiştirilsin mi?", `Yarım kalan otomatik üretim taslağın, <b>${X.esc(src)}</b> ayarlarıyla değiştirilecek.`, "Devam", run);
  else run();
}

function daysText(days) {
  const d = [...(days || [])].map(Number).sort();
  if (d.length === 7) return "Her gün";
  if (d.join() === "0,1,2,3,4") return "Hafta içi";
  if (d.join() === "5,6") return "Hafta sonu";
  return d.map((i) => DAYS[i]).join(", ") || "gün yok";
}

function isolate(root) {
  const moved = [];
  for (const id of ["sched", "when", "schedBtn"])
    for (const el of document.querySelectorAll(`[id="${id}"]`))
      if (!root.contains(el)) {
        el.id = `${id}-aphold`;
        moved.push([el, id]);
      }
  return () => {
    for (const [el, id] of moved) el.id = id;
  };
}

function bindPick(X, wrap) {
  const undo = isolate(wrap);
  try {
    bindScheduler(X, PICK);
  } finally {
    undo();
  }
  if (wrap.dataset.iso) return;
  wrap.dataset.iso = "1";
  let back = null;
  const off = () => {
    back?.();
    back = null;
  };
  const on = () => {
    off();
    back = isolate(wrap);
    setTimeout(off, 0);
  };
  for (const t of ["click", "wheel"]) {
    wrap.addEventListener(t, on, true);
    wrap.addEventListener(t, off);
  }
  wrap.addEventListener("click", () => {
    const v = $("#when", wrap)?.value;
    if (v && W) {
      W.pick = v;
      keep();
    }
  });
}

function schedulePreview(X, delay = 380) {
  clearTimeout(U.pT);
  U.pT = setTimeout(() => runPreview(X), delay);
}

async function runPreview(X) {
  if (!W || !U.wbox?.isConnected) return;
  const body = previewBody();
  const key = JSON.stringify(body);
  if (key === U.pkey && U.preview) return U.paint?.();
  const seq = ++U.pseq;
  U.ploading = true;
  U.paint?.();
  try {
    const r = await X.api("/api/autopilot/preview", body);
    if (seq !== U.pseq) return;
    U.preview = r;
    U.pkey = key;
    U.perr = "";
  } catch (e) {
    if (seq !== U.pseq) return;
    U.preview = null;
    U.pkey = "";
    U.perr = e.message;
  }
  U.ploading = false;
  U.paint?.();
}

// ---------- detail ----------

async function loadDetail(X, id) {
  const seq = ++U.loadSeq;
  try {
    const d = await X.api(`/api/autopilot/${encodeURIComponent(id)}`);
    if (seq !== U.loadSeq || U.sel !== id) return;
    U.detail = d;
    U.err = "";
    if (d.status === "onay_bekliyor") await loadIdeas(X, d);
    else delete U.pick[d.id];
  } catch (e) {
    if (seq !== U.loadSeq || U.sel !== id) return;
    U.err = e.message;
  }
  if (U.mode === "detail" && U.sel === id) drawDetail(X);
}

function pendingBatches(c) {
  const bl = new Map((c.batch_list || []).map((b) => [b.id, b]));
  return (c.batches || []).filter((e) => e.batch && !e.produced && !("selected" in e) && bl.get(e.batch)?.status === "hazir" && !bl.get(e.batch)?.deleted);
}

function ideasOf(c, bid) {
  const b = (c.batch_list || []).find((x) => x.id === bid);
  return (b?.ideas || U.batches[bid]?.ideas || []).filter((i) => i.status !== "uretimde");
}

async function loadIdeas(X, c) {
  const want = pendingBatches(c);
  await Promise.all(want.filter((e) => !(c.batch_list || []).find((x) => x.id === e.batch)?.ideas).map(async (e) => {
    try {
      U.batches[e.batch] = await X.api(`/api/ideas/${encodeURIComponent(e.batch)}`);
    } catch {}
  }));
  if (U.pick[c.id]) return;
  const sel = new Set();
  for (const e of want) {
    const list = ideasOf(c, e.batch).filter((i) => i.status !== "elendi");
    const pre = list.filter((i) => i.status === "secildi");
    (pre.length ? pre : list.slice(0, e.count)).forEach((i) => sel.add(i.id));
  }
  U.pick[c.id] = sel;
}

function merged(X) {
  const sum = (X.S.autopilot || []).find((c) => c.id === U.sel);
  if (!U.detail || U.detail.id !== U.sel) return null;
  const c = { ...(sum || {}), ...U.detail };
  if (!U.detail.progress && sum) c.progress = sum.progress;
  if (U.detail.next === undefined && sum) c.next = sum.next;
  return c;
}

function drawDetail(X) {
  const main = $("#apMain");
  if (!main || U.mode !== "detail") return;
  const c = merged(X);
  if (!c) {
    main.innerHTML = U.err ? `<div class="apd"><div class="errbox">${X.ic("triangle-alert", 15)} ${X.esc(U.err)}</div></div>` : skeletonHtml();
    return;
  }
  const top = main.scrollTop;
  const first = U.drawn !== c.id;
  U.drawn = c.id;
  main.innerHTML = detailHtml(X, c);
  main.scrollTop = first ? 0 : top;
  if (first) closePicker();
  else placePicker();
  if (first && !reduced()) $$(".apd > *", main).forEach((n, k) => n.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: k * 45, easing: EASE, fill: "backwards" }));
  bindDetail(X, main, c);
}

function units(X, c) {
  const live = new Map((X.S.posts || []).map((p) => [p.id, p]));
  const pl = new Map((c.post_list || []).map((p) => [p.id, p]));
  const bl = new Map((c.batch_list || []).map((b) => [b.id, b]));
  const entries = (c.posts || []).filter((x) => !x.gone);
  return (c.topics || []).map((t, i) => {
    const entry = (c.batches || []).find((e) => e.index === i) || (c.batches || []).find((e) => e.index == null && e.topic === t.topic);
    const mine = entries.filter((x) => (entry?.batch && x.batch ? x.batch === entry.batch : x.topic === t.topic));
    const rows = mine.map((x) => ({ ...(pl.get(x.post) || { id: x.post, status: "sirada" }), ...(live.get(x.post) || {}), slot: x.slot ?? pl.get(x.post)?.slot ?? null, action: x.action ?? pl.get(x.post)?.action ?? null }));
    let want = t.count || 0;
    if (c.status === "iptal" || entry?.produced) want = rows.length;
    else if (entry && Array.isArray(entry.selected)) want = entry.selected.length;
    return { topic: t.topic, count: t.count || 0, entry, batch: entry?.batch ? bl.get(entry.batch) : null, rows, left: Math.max(0, want - rows.length) };
  });
}

function pendingState(c, u) {
  const credits = c.status === "duraklatildi" && c.hold === "credits";
  const paused = c.status === "duraklatildi" && !credits;
  const b = u.batch;
  if (!u.entry?.batch) return paused ? ["Duraklatıldı", "pause", 0] : ["Fikir isteği hazırlanıyor", "idle", 0];
  if (!b) return ["Fikirler yazılıyor", "run", 0];
  if (b.status === "hata") return ["Fikirler yazılamadı", "err", 0];
  if (b.status === "sirada") return [paused ? "Duraklatıldı" : "Fikir yazımı sırada", "idle", 0];
  if (b.status === "yaziliyor") return [b.stage || "Fikirler yazılıyor", "run", 0];
  if (c.status === "onay_bekliyor") return ["Seçimini bekliyor", "wait", 1];
  if (credits) return ["ElevenLabs kredisi bekleniyor", "wait", 2];
  if (paused) return ["Duraklatıldı", "pause", 1];
  if (Array.isArray(u.entry.selected)) return ["Üretime gönderiliyor", "run", 2];
  return ["Fikir seçiliyor", "run", 1];
}

function postState(p) {
  const ar = p.after_render;
  if (p.status === "sirada") return { stage: 2, cls: "idle", text: "Üretim sırasında" };
  if (p.status === "uretimde") return { stage: 2, cls: "run", text: p.stage || "Üretiliyor", prog: p.progress || 0 };
  if (p.status === "inceleme") {
    if (ar?.action === "publish") return { stage: 3, cls: "run", text: "Hazır · hemen paylaşılacak" };
    if (ar?.action === "schedule") return { stage: 3, cls: "run", text: `Hazır · ${when(ar.at)} için planlanacak` };
    return { stage: 3, cls: "wait", text: "Hazır · İncelemede seni bekliyor" };
  }
  if (p.status === "planlandi") {
    const t = parseT(p.schedule);
    return { stage: 3, cls: "plan", text: `Paylaşım ${when(p.schedule)}`, sub: t ? relTime(t) : "" };
  }
  if (p.status === "paylasiliyor") return { stage: 3, cls: "run", text: p.stage || "Paylaşılıyor" };
  if (p.status === "paylasildi") return { stage: 4, cls: "done", text: when(p.published?.at) || "Instagram'da yayında" };
  if (p.status === "hata") return { stage: p.video ? 3 : 2, cls: "err", text: p.error || p.stage || "Hata" };
  return { stage: 2, cls: "idle", text: p.stage || p.status || "" };
}

function dotsHtml(stage, cls) {
  return `<div class="apv-pipe">${PIPE.map((t, i) => `<i class="${i < stage ? "d" : i === stage ? `c ${cls}` : ""}" title="${t}"></i>`).join("")}</div>`;
}

function multiRing(parts, total, size, sw) {
  const r = (size - sw) / 2;
  const C = 2 * Math.PI * r;
  const h = size / 2;
  let acc = 0;
  const arcs = parts.map(([v, col]) => {
    if (!v || !total) return "";
    const len = Math.min(v / total, 1 - acc) * C;
    const start = acc * C;
    acc += v / total;
    const gap = len > 6 ? 2 : 0;
    return `<circle cx="${h}" cy="${h}" r="${r}" stroke-width="${sw}" fill="none" stroke="${col}" stroke-linecap="round" stroke-dasharray="${(len - gap).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-start).toFixed(2)}" transform="rotate(-90 ${h} ${h})"/>`;
  }).join("");
  return `<svg class="apr big" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${h}" cy="${h}" r="${r}" stroke-width="${sw}" class="apr-bg"/>${arcs}</svg>`;
}

function modeText(p) {
  const m = p?.mode;
  if (m === "immediate") return "Her video hazır olunca hemen paylaşılır";
  if (m === "review") return "Videolar İncelemede bekler, paylaşımı sen yaparsın";
  if (m === "slots") return `${(p.slots || []).length} belirli saate sırayla`;
  if (m === "interval") {
    const iv = p.interval || {};
    const freq = iv.every_hours ? `her ${iv.every_hours} saatte bir (${(iv.window || []).join("–")})` : (iv.times || []).join(", ");
    return `${daysText(iv.days)} · ${freq}`;
  }
  return "";
}

function detailHtml(X, c) {
  const { ic, esc } = X;
  const pr = c.progress || {};
  const tot = videosOf(c);
  const [label, cls] = statusOf(c);
  const us = units(X, c);
  const acts = [];
  if (["calisiyor", "onay_bekliyor"].includes(c.status)) acts.push(`<button class="btn sm" data-act="pause">${ic("pause", 14)}Duraklat</button>`);
  if (c.status === "duraklatildi") acts.push(`<button class="btn sm primary" data-act="resume">${ic(c.hold === "credits" ? "refresh-cw" : "play", 14)}${c.hold === "credits" ? "Tekrar dene" : "Devam et"}</button>`);
  if (c.status === "hata") acts.push(`<button class="btn sm primary" data-act="resume">${ic("refresh-cw", 14)}Tekrar dene</button>`);
  acts.push(`<button class="btn sm ${["bitti", "iptal"].includes(c.status) ? "primary" : ""}" data-act="repeat" title="Aynı ayarlarla yeni bir üretim başlat">${ic("copy-plus", 14)}Tekrarla</button>`);
  if (!["bitti", "iptal"].includes(c.status)) acts.push(`<button class="btn sm ghost" data-act="cancel">${ic("ban", 14)}İptal</button>`);
  acts.push(`<button class="btn sm ghost icon" data-act="delete" title="Listeden sil">${ic("trash-2", 15)}</button>`);
  const src = c.repeat_of ? c.repeat_name || (X.S.autopilot || []).find((x) => x.id === c.repeat_of)?.name || c.repeat_of : "";
  return `<div class="apd">
    <div class="apd-head">
      <span class="apd-logo st-${cls}">${ic("rocket", 22)}</span>
      <div class="grow"><h2>${esc(c.name)}</h2><div class="apd-sub"><span class="aps st-${cls}"><i></i>${label}</span><span class="sm muted">${esc(c.id)}${c.created ? ` · ${ago(c.created)} başladı` : ""}</span>${src ? `<button class="apd-rep" data-goc="${esc(c.repeat_of)}" title="Önceki üretimi aç">${ic("copy-plus", 12)}Tekrar: ${esc(src)}</button>` : ""}</div></div>
      <div class="apd-act">${acts.join("")}</div>
    </div>
    ${bannerHtml(X, c)}
    ${c.status === "onay_bekliyor" ? approveHtml(X, c) : ""}
    ${pipeHtml(X, c, tot)}
    <div class="apd-grid">
      ${statsHtml(X, c, tot)}
      ${planHtml(X, c)}
    </div>
    <div class="apd-vh"><h3>${ic("film", 14)}Videolar</h3><span class="sm muted">${(c.posts || []).filter((x) => !x.gone).length}/${tot} oluşturuldu</span></div>
    <div class="apd-videos">${us.map((u) => `<div class="apv-g">
        <div class="apv-gh"><b>${esc(u.topic)}</b><span class="tag">${u.count} video</span>${u.entry?.batch ? `<a class="apv-bl" href="#${esc(u.entry.batch)}">${ic("lightbulb", 12)}Fikir seti ${esc(u.entry.batch)}</a>` : ""}</div>
        ${u.rows.map((p) => rowHtml(X, p)).join("")}
        ${Array.from({ length: u.left }, (_, k) => ghostHtml(X, c, u, u.rows.length + k + 1)).join("")}
      </div>`).join("")}</div>
    ${logHtml(X, c)}
  </div>`;
}

function logHtml(X, c) {
  const { ic, esc } = X;
  const items = c.activity || [];
  if (!items.length) return "";
  const pre = `Otopilot · ${c.name}: `;
  const list = U.logAll ? items : items.slice(0, 6);
  return `<div class="apd-log">
    <div class="apd-vh"><h3>${ic("list", 14)}Otopilot günlüğü</h3><span class="sm muted">son ${items.length} kayıt</span></div>
    <div class="timeline apd-tl">${list.map((a) => `<div class="tl k-${esc(a.kind)}"><span class="tdot"></span><div class="grow">${esc(String(a.text || "").replace(pre, ""))}<div class="sm muted">${a.at ? `${new Date(a.at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${ago(a.at)}` : ""}${a.post && a.post !== c.id ? ` · <a href="#${esc(a.post)}" class="postlink">#${esc(a.post)}</a>` : ""}</div></div></div>`).join("")}</div>
    ${items.length > 6 ? `<button class="btn sm ghost" data-logall>${ic(U.logAll ? "chevron-up" : "chevron-down", 14)}${U.logAll ? "Daha az göster" : `Tümünü göster (${items.length})`}</button>` : ""}
  </div>`;
}

function bannerHtml(X, c) {
  const { ic, esc, S } = X;
  const agentOn = (S.agents || []).some((a) => a.live && a.live !== "off");
  const nx = c.next?.at ? ` · Sıradaki paylaşım <b>${when(c.next.at)}</b>${c.next.title ? ` <span class="muted">(${esc(c.next.title)})</span>` : ""}` : "";
  if (c.status === "calisiyor") return `<div class="apd-bn run"><span class="apd-pulse"></span><div class="grow"><b>${esc(c.stage || "Çalışıyor")}</b><div class="sm">${agentOn ? "Ajan bağlı, işler sırayla yürüyor." : "Ajan şu an bağlı değil; işler sırada bekliyor."}${nx}</div></div></div>`;
  if (c.status === "duraklatildi" && c.hold === "credits") return `<div class="apd-bn pause credit">${ic("mic", 18)}<div class="grow"><b>ElevenLabs kredisi yetmiyor</b><div class="sm">${esc(c.stage || "")}${c.stage ? "<br>" : ""}Sığan videolar üretime gönderildi; hazır olanların paylaşımı sürüyor. Kredi yenilenince ya da artınca <b>Tekrar dene</b>'ye bas.</div></div></div>`;
  if (c.status === "duraklatildi") return `<div class="apd-bn pause">${ic("pause", 18)}<div class="grow"><b>Duraklatıldı</b><div class="sm">Yeni fikir, üretim ve otomatik paylaşım planı durdu. Devam edince kaldığı yerden sürer.</div></div></div>`;
  if (c.status === "hata") return `<div class="apd-bn err">${ic("triangle-alert", 18)}<div class="grow"><b>Bir sorun çıktı</b><div class="sm">${esc(c.stage || "")}</div></div></div>`;
  if (c.status === "bitti") return `<div class="apd-bn done">${ic("circle-check", 18)}<div class="grow"><b>Tamamlandı</b><div class="sm">${esc(c.stage || "Tüm videolar planlandı ya da paylaşıldı.")}${nx}</div></div></div>`;
  if (c.status === "iptal") return `<div class="apd-bn off">${ic("ban", 18)}<div class="grow"><b>İptal edildi</b><div class="sm">Yeni fikir ve video üretilmiyor. Hazır videolar İçerikler'de duruyor.</div></div></div>`;
  return "";
}

function pipeHtml(X, c, tot) {
  const { ic } = X;
  const pr = c.progress || {};
  const T = (c.topics || []).length || 1;
  const bl = new Map((c.batch_list || []).map((b) => [b.id, b]));
  const bs = (c.batches || []).map((b) => (b.batch ? bl.get(b.batch) : null));
  const bReady = bs.filter((b) => b?.status === "hazir").length;
  const bErr = bs.some((b) => b?.status === "hata");
  const bProd = (c.batches || []).filter((b) => b.produced).length;
  const made = (c.posts || []).filter((x) => !x.gone).length;
  const credit = c.status === "duraklatildi" && c.hold === "credits";
  const readyN = (pr.ready || 0) + (pr.scheduled || 0) + (pr.published || 0);
  const shared = (pr.scheduled || 0) + (pr.published || 0);
  const review = c.publish?.mode === "review";
  const paused = c.status === "duraklatildi";
  const off = c.status === "iptal";
  const st = (ok, active, special = "") => (off ? "off" : ok ? "done" : special || (active ? (paused ? "pause" : "run") : "idle"));
  const stages = [
    { icon: "lightbulb", t: "Fikirler", s: st(bReady >= T, true, bErr ? "err" : ""), v: bReady / T, d: bReady >= T ? `${T} konunun fikirleri hazır` : `${bReady}/${T} konu yazıldı` },
    { icon: "list-checks", t: "Seçim", s: st(bProd >= T, bReady > bProd, c.status === "onay_bekliyor" ? "wait" : ""), v: bProd / T, d: c.status === "onay_bekliyor" ? "Onayını bekliyor" : made ? `${made} fikir seçildi` : c.review_ideas ? "Senin onayınla" : "Ajan seçer" },
    { icon: "clapperboard", t: "Üretim", s: st(tot > 0 && readyN >= tot, (pr.producing || 0) > 0, credit ? "wait" : ""), v: tot ? readyN / tot : 0, d: credit ? `Kredi bekliyor · ${readyN}/${tot} hazır` : pr.producing ? `${pr.producing} video üretimde · ${readyN}/${tot} hazır` : `${readyN}/${tot} video hazır` },
    review
      ? { icon: "inbox", t: "Paylaşım", s: st(tot > 0 && readyN >= tot && !pr.producing, false), v: tot ? readyN / tot : 0, d: `${pr.ready || 0} video İncelemede · ${pr.published || 0} yayında` }
      : { icon: "send", t: "Paylaşım", s: st(tot > 0 && shared >= tot, readyN > shared || shared > 0), v: tot ? shared / tot : 0, d: `${pr.published || 0} yayında · ${pr.scheduled || 0} planlı` },
  ];
  return `<div class="apd-pipe">${stages.map((s, i) => `<div class="apd-ps ps-${s.s}">
      <div class="apd-psh"><span class="apd-psi">${ic(s.s === "done" ? "check" : s.s === "err" ? "triangle-alert" : s.icon, 16)}</span><b>${s.t}</b>${s.s === "run" ? `<i class="apd-live"></i>` : ""}</div>
      <div class="apd-psd">${s.d}</div>
      <div class="apd-psb"><i style="width:${Math.round(clamp(s.v, 0, 1) * 100)}%"></i></div>
    </div>${i < stages.length - 1 ? `<span class="apd-arrow ${stages[i].s === "done" ? "on" : ""}">${ic("chevron-right", 16)}</span>` : ""}`).join("")}</div>`;
}

function statsHtml(X, c, tot) {
  const pr = c.progress || {};
  const segs = [["published", "Yayında", "var(--green)"], ["scheduled", "Planlı", "#a78bfa"], ["ready", "Hazır", "var(--yellow)"], ["producing", "Üretimde", "var(--blue)"], ["failed", "Hata", "var(--red)"]];
  const okN = (pr.published || 0) + (pr.scheduled || 0);
  const pct = tot ? Math.round((okN / tot) * 100) : 0;
  return `<div class="apd-stats">
    <div class="apd-ring">${multiRing(segs.map(([k, , col]) => [pr[k] || 0, col]), tot, 128, 11)}<div class="apd-ringin"><b>%${pct}</b><span>${okN}/${tot} video<br>planlı ya da yayında</span></div></div>
    <div class="apd-legend">${segs.map(([k, t, col]) => `<div class="${pr[k] ? "" : "zero"}"><i style="background:${col}"></i><span class="grow">${t}</span><b>${pr[k] || 0}</b></div>`).join("")}
      <div class="apd-lt"><span class="grow">Toplam</span><b>${tot}</b></div></div>
  </div>`;
}

function planHtml(X, c) {
  const { ic, esc, S } = X;
  const b = c.brief || {};
  const tpl = `Stil: ${styleText(X, b)}`;
  const up = (c.upcoming || []).map((u) => (typeof u === "string" ? u : u?.at)).filter((u) => u && parseT(u));
  const mode = MODES.find((m) => m.k === c.publish?.mode);
  return `<div class="apd-plan">
    <div class="apd-pr"><span>${ic("list", 13)}Konular</span><div class="apd-tags">${(c.topics || []).map((t) => `<span class="tag">${esc(t.topic)} <b>×${t.count}</b>${t.template ? `<i class="apw-tt">${esc(tplName(X, t.template))}</i>` : ""}</span>`).join("")}</div></div>
    <div class="apd-pr"><span>${ic("sliders-horizontal", 13)}İçerik</span><div class="apd-tags">${[`${b.duration || 30} sn`, b.tone, tpl, b.audience].filter(Boolean).map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div></div>
    <div class="apd-pr"><span>${ic("list-checks", 13)}Seçim</span><div>${c.review_ideas ? "Fikirleri sen onaylarsın" : "Fikirleri ajan seçer"}</div></div>
    <div class="apd-pr"><span>${ic(mode?.icon || "send", 13)}Paylaşım</span><div><b>${mode ? mode.t : "—"}</b><div class="sm muted">${esc(modeText(c.publish))}</div></div></div>
    ${targetsReady(S) ? `<div class="apd-pr"><span>${ic("send", 13)}Şurada paylaş</span><div>${targetsHtml(X, c.targets || defaultTargets(S), { label: false, id: "apdTargets" })}</div></div>` : ""}
    ${up.length ? `<div class="apd-pr"><span>${ic("calendar-days", 13)}Sıradaki saatler</span><div class="apd-tags">${up.slice(0, 6).map((u) => `<span class="apd-chip">${when(u)}</span>`).join("")}${up.length > 6 ? `<span class="sm muted">+${up.length - 6}</span>` : ""}</div></div>` : ""}
  </div>`;
}

function rowHtml(X, p) {
  const { ic, esc } = X;
  const s = postState(p);
  const th = p.has_thumb ? `/media/${encodeURIComponent(p.id)}/thumb.jpg?v=${encodeURIComponent(p.updated || "")}` : "";
  const plan = !["planlandi", "paylasildi", "hata"].includes(p.status) && p.after_render?.action !== "schedule" ? p.slot : null;
  const tp = p.template || p.brief?.template || "";
  const free = !tp && "template" in p && p.status !== "hata";
  return `<div class="apv st-${s.cls}">
    <div class="apv-th" style="${th ? `background-image:url('${th}')` : ""}">${th ? "" : ic(s.cls === "run" && p.status !== "inceleme" ? "loader-circle" : "film", 16, s.cls === "run" && p.status !== "inceleme" ? "spin" : "")}</div>
    <div class="grow apv-mid">
      <div class="apv-t"><span class="apv-id">#${esc(p.id)}</span>${esc(p.title || "Video")}</div>
      <div class="apv-s"><span class="badge b-${esc(p.status)}">${PSTATUS[p.status] || esc(p.status)}</span><span class="apv-tx">${esc(s.text)}${s.sub ? ` <span class="muted">· ${esc(s.sub)}</span>` : ""}</span>${plan ? `<span class="apv-plan">${ic("calendar-clock", 11)}${when(plan)}</span>` : ""}${tp ? tplBadge(X, tp, "xs") : free ? tplBadge(X, null, "xs") : ""}</div>
      ${s.prog != null ? `<div class="bar"><i style="width:${Math.round(s.prog * 100)}%"></i></div>` : ""}
    </div>
    ${dotsHtml(s.stage, s.cls)}
    <button class="btn sm" data-open="${esc(p.id)}" title="İçeriği aç">${ic("external-link", 13)}<span class="apw-hide">Aç</span></button>
  </div>`;
}

function ghostHtml(X, c, u, n) {
  const { esc } = X;
  const [text, cls, stage] = pendingState(c, u);
  return `<div class="apv ghost st-${cls}"><div class="apv-th"><i class="apv-shim"></i></div><div class="grow apv-mid"><div class="apv-t muted">${n}. video</div><div class="apv-s"><span class="apv-tx">${esc(text)}</span></div></div>${dotsHtml(stage, cls)}<span class="apv-pad"></span></div>`;
}

const ideaOpts = (def, value) => ({ value: value || "", cls: "apa-pk", title: "Bu fikrin stili", hint: "Sadece bu video için geçerli.", defShort: "Varsayılan", defLabel: `Varsayılan (${def})`, defIcon: def === FREE ? "wand-sparkles" : "sliders-horizontal", defSub: def });

function approveHtml(X, c) {
  const { ic, esc, S } = X;
  const want = pendingBatches(c);
  const sel = U.pick[c.id] || new Set();
  const tmap = U.tpl[c.id] || {};
  const made = (c.posts || []).filter((x) => !x.gone).length;
  let chars = 0;
  const groups = want.map((e) => {
    const ideas = ideasOf(c, e.batch);
    if (!ideas.length) return `<div class="apa-g"><div class="apa-gh"><b>${esc(e.topic)}</b></div><div class="apa-load">${ic("loader-circle", 14, "spin")}Fikirler yükleniyor…</div></div>`;
    const n = ideas.filter((i) => sel.has(i.id)).length;
    const def = defaultStyle(X, c, e);
    for (const i of ideas) if (sel.has(i.id)) chars += i.chars ?? (i.lines || []).join("").length;
    return `<div class="apa-g">
      <div class="apa-gh"><b>${esc(e.topic)}</b><span class="tag">${e.count} video istendi</span><span class="apa-gc ${n === e.count ? "ok" : n ? "" : "zero"}">${n} seçili</span><span class="grow"></span><a class="apv-bl" href="#${esc(e.batch)}">${ic("lightbulb", 12)}Fikirler'de aç</a></div>
      ${ideas.map((i) => {
        const open = U.open.has(i.id);
        const on = sel.has(i.id);
        return `<div class="apa-i ${on ? "on" : ""} ${i.status === "elendi" ? "rej" : ""}" data-idea="${esc(i.id)}" role="checkbox" aria-checked="${on}" tabindex="0">
          <span class="apa-ck">${ic("check", 13)}</span>
          <div class="grow"><div class="apa-t">${esc(i.title)}</div>${i.hook ? `<div class="apa-h">“${esc(i.hook)}”</div>` : ""}
            ${open ? `<ol class="vlines apa-lines">${(i.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ol>` : ""}</div>
          <span class="apa-side">${pickBtn(X, `idea:${i.id}`, ideaOpts(def, tmap[i.id]))}
          <span class="tag apa-meta">${ic("clock", 12)}${i.duration || ""} sn${i.chars ? ` · ${num(i.chars)} kr.` : ""}</span></span>
          <button class="btn sm ghost" data-read="${esc(i.id)}" title="${open ? "Kapat" : "Kurguyu oku"}">${ic(open ? "chevron-up" : "chevron-down", 14)}</button>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
  const left = S.credits?.left;
  const over = sel.size + made > MAX;
  return `<div class="apa">
    <div class="apa-head"><span class="apa-hi">${ic("user-check", 20)}</span><div class="grow"><b>Fikirler hazır, seçimini bekliyor</b><div class="sm">Beğendiklerini işaretle; seçtiklerin üretime girer, sonrası yine otomatik. Her konu için istediğin sayıda fikir önceden işaretlendi.</div></div></div>
    ${want.length ? groups : `<div class="apa-load">${ic("loader-circle", 14, "spin")}Fikir setleri yükleniyor…</div>`}
    <div class="apa-foot"><span class="apa-sum">${ic("square-check", 16)}<b>${sel.size}</b> fikir seçili · ~${num(chars)} karakter${left != null ? ` <span class="${chars > left ? "bad" : "muted"}">(ElevenLabs kalan ${num(left)})</span>` : ""}${over ? ` <span class="bad">· en fazla ${MAX} video</span>` : ""}</span>
      <span class="grow"></span>
      <button class="btn" data-auto title="Her konu için ilk fikirler seçilir">${ic("list-checks", 15)}Fikirleri ajan seçsin</button>
      <button class="btn primary" data-approve ${sel.size && !over ? "" : "disabled"}>${ic("clapperboard", 15)}Seçilenlerle devam</button></div>
  </div>`;
}

function bindDetail(X, main, c) {
  const { esc } = X;
  if (main._tg) main.removeEventListener("tgchange", main._tg);
  main._tg = X.guard(async (e) => {
    const row = e.target;
    row.classList.add("busy");
    try {
      U.detail = await X.api(`/api/autopilot/${encodeURIComponent(c.id)}/targets`, e.detail.value);
      X.toast(`Paylaşım yerleri: ${targetsText(e.detail.value)} · bu otopilotun videolarına uygulandı`);
    } catch (err) {
      setTargets(row, e.detail.before);
      throw err;
    } finally {
      row.classList.remove("busy");
    }
    drawDetail(X);
    await X.refresh();
  });
  main.addEventListener("tgchange", main._tg);
  const run = async (a, msg) => {
    U.detail = await X.api(`/api/autopilot/${encodeURIComponent(c.id)}/${a}`, {});
    X.toast(msg);
    drawDetail(X);
    await X.refresh();
  };
  const act = X.guard(async (a) => {
    if (a === "repeat") return repeatCampaign(X, c.id, c.name);
    if (a === "cancel")
      return X.confirm("Otomatik üretim iptal edilsin mi?", `<b>${esc(c.name)}</b> için yeni fikir ve video üretilmez, henüz hazır olmayan videolar otomatik paylaşılmaz. Planlanmış ve paylaşılmış videolar etkilenmez.`, "İptal et", X.guard(() => run("cancel", "Otomatik üretim iptal edildi")));
    if (a === "delete")
      return X.confirm("Listeden silinsin mi?", `<b>${esc(c.name)}</b> Otopilot listesinden kaldırılır. Üretilen videolar İçerikler'de kalır.`, "Sil", X.guard(async () => {
        await X.api(`/api/autopilot/${encodeURIComponent(c.id)}/delete`, {});
        U.sel = null;
        U.detail = null;
        U.mode = null;
        X.toast("Otomatik üretim silindi");
        await X.refresh();
        renderAutopilot(X);
      }));
    await run(a, a === "pause" ? "Duraklatıldı" : "Devam ediyor");
  });
  const approve = X.guard(async (ids, btn) => {
    btn.disabled = true;
    try {
      const tmap = U.tpl[c.id] || {};
      const body = { ideas: ids };
      const templates = Object.fromEntries(ids.filter((id) => tmap[id]).map((id) => [id, tmap[id]]));
      if (Object.keys(templates).length) body.templates = templates;
      U.detail = await X.api(`/api/autopilot/${encodeURIComponent(c.id)}/approve`, body);
      delete U.pick[c.id];
      delete U.tpl[c.id];
      X.toast(ids.length ? `${ids.length} fikir üretime gönderiliyor` : "Ajan seçip üretime gönderiyor");
      drawDetail(X);
      await X.refresh();
    } finally {
      if (btn.isConnected) btn.disabled = false;
    }
  });
  const redrawApprove = () => {
    const box = $(".apa", main);
    if (box) box.outerHTML = approveHtml(X, c);
    placePicker();
  };
  main.onclick = (e) => {
    const b = e.target.closest("button, [data-idea]");
    if (!b || !main.contains(b) || b.disabled) return;
    const d = b.dataset;
    if (d.apk) {
      const id = d.apk.slice(5);
      const e2 = pendingBatches(c).find((x) => ideasOf(c, x.batch).some((i) => i.id === id));
      const def = e2 ? defaultStyle(X, c, e2) : FREE;
      openPicker(X, b, () => ideaOpts(def, (U.tpl[c.id] || {})[id]), (v) => {
        const map = (U.tpl[c.id] ||= {});
        if (v) map[id] = v;
        else delete map[id];
        if (v) (U.pick[c.id] ||= new Set()).add(id);
        redrawApprove();
      });
    } else if (d.goc) {
      if ((X.S.autopilot || []).some((x) => x.id === d.goc)) openCampaign(X, d.goc);
      else X.toast("Önceki üretim artık listede yok", true);
    } else if (d.act) act(d.act);
    else if (d.open) {
      X.setTab("posts");
      X.select(d.open);
    } else if (d.read) {
      if (U.open.has(d.read)) U.open.delete(d.read);
      else U.open.add(d.read);
      redrawApprove();
    } else if (d.idea) {
      const set = (U.pick[c.id] ||= new Set());
      if (set.has(d.idea)) set.delete(d.idea);
      else set.add(d.idea);
      redrawApprove();
    } else if (b.hasAttribute("data-logall")) {
      U.logAll = !U.logAll;
      drawDetail(X);
    } else if (b.hasAttribute("data-approve")) approve([...(U.pick[c.id] || [])], b);
    else if (b.hasAttribute("data-auto")) approve([], b);
  };
  main.onkeydown = (e) => {
    const row = e.target.closest?.("[data-idea]");
    if (!row || e.target !== row || (e.key !== " " && e.key !== "Enter")) return;
    e.preventDefault();
    const id = row.dataset.idea;
    const set = (U.pick[c.id] ||= new Set());
    if (set.has(id)) set.delete(id);
    else set.add(id);
    redrawApprove();
    $(`[data-idea="${CSS.escape(id)}"]`, main)?.focus();
  };
}
