import { ago } from "/web/views.js";
import { durSlider, bindDurSlider } from "/web/durslider.js";
import { targetsHtml, targetsReady, defaultTargets } from "/web/targets.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const TONES = ["Eğitici", "Samimi", "Eğlenceli", "Profesyonel", "İlham verici", "Merak uyandıran", "Dramatik"];
const BSTATUS = { sirada: "Sırada", yaziliyor: "Yazılıyor", hazir: "Hazır", hata: "Hata" };
const ISTATUS = { yeni: "Yeni", secildi: "Seçildi", elendi: "Elendi", uretimde: "Üretimde" };
const FILTERS = [["all", "Tümü"], ["yeni", "Yeni"], ["secildi", "Seçilenler"], ["elendi", "Elenenler"], ["uretimde", "Üretimde"]];
const KEY = "sosyal-studyo-idea-draft";

function draft() {
  try {
    return Object.assign({ topic: "", count: 10, duration: 30, tone: "", audience: "", notes: "", template: "" }, JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return { topic: "", count: 10, duration: 30, tone: "", audience: "", notes: "" };
  }
}
function keep(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
}

export async function loadBatch(X, id) {
  const b = await X.api(`/api/ideas/${id}`);
  X.S.batch = b;
  return b;
}

const tplOf = (S, id) => (S.templates || []).find((t) => t.id === id);

function tplChip(X, b, i) {
  const { S, ic, esc } = X;
  const own = i.template && tplOf(S, i.template);
  const set = b.brief?.template && tplOf(S, b.brief.template);
  const t = own || set;
  const label = own ? own.name : set ? `Set: ${set.name}` : "Stil: ajan";
  return `<button class="tchip ${own ? "set" : ""}" data-tpl="${i.id}" title="Bu kurgunun video stili">${t?.poster ? `<img src="${t.poster}" alt="">` : ic("palette", 12)}${esc(label)}</button>`;
}

function closeTplPop() {
  for (const p of $$(".tpop")) {
    p._off?.();
    p.remove();
  }
}

function openTplPop(X, o, anchor, onPick) {
  const { S, ic, esc } = X;
  closeTplPop();
  const pop = document.createElement("div");
  pop.className = "tpop";
  const info = (t) => (t ? `<b>${esc(t.name)}</b>${t.best_for ? ` · ${esc(t.best_for)}` : ""}` : esc(o.defaultHint || "Hazır şablon kullanılmaz; ajan bu konuya özel, her seferinde farklı bir tasarım yapar."));
  pop.innerHTML = `<div class="tpop-h">Video stili${o.title ? `<span class="sm muted"> · ${esc(o.title)}</span>` : ""}</div>
    <div class="tpop-grid">
      <button class="tpop-it ${o.current ? "" : "on"}" data-t=""><div class="tpop-m tauto">${ic(o.defaultIcon || "wand-sparkles", 18)}</div><span>${esc(o.defaultLabel || "Serbest tasarım")}</span></button>
      ${(S.templates || []).map((t) => `<button class="tpop-it ${o.current === t.id ? "on" : ""}" data-t="${t.id}"><div class="tpop-m">${t.poster ? `<img src="${t.poster}" alt="" loading="lazy"><video src="${t.preview}" muted loop playsinline preload="none"></video>` : ic("film", 16)}${t.custom ? `<i class="tmini-own">Senin</i>` : ""}<span class="tpop-zoom" data-zoom="${t.id}" title="Büyük ekranda izle">${ic("maximize-2", 11)}</span></div><span>${esc(t.name)}</span></button>`).join("")}
    </div>
    <div class="tpop-info sm">${info(tplOf(S, o.current))}</div>`;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const left = o.alignLeft ? r.left : r.right - pop.offsetWidth;
  pop.style.left = `${Math.max(10, Math.min(innerWidth - pop.offsetWidth - 10, left))}px`;
  pop.style.top = `${r.bottom + pop.offsetHeight + 10 < innerHeight ? r.bottom + 6 : Math.max(10, r.top - pop.offsetHeight - 6)}px`;
  for (const it of $$(".tpop-it", pop)) {
    const v = $("video", it);
    it.onmouseenter = () => {
      $(".tpop-info", pop).innerHTML = info(tplOf(S, it.dataset.t));
      v?.play().catch(() => {});
    };
    it.onmouseleave = () => {
      $(".tpop-info", pop).innerHTML = info(tplOf(S, o.current));
      if (v) {
        v.pause();
        v.currentTime = 0;
      }
    };
  }
  pop.onclick = (e) => {
    const zoom = e.target.closest("[data-zoom]");
    if (zoom) {
      e.stopPropagation();
      const from = zoom.closest(".tpop-m");
      const open = (m) => m?.openTemplateViewer(X, S.templates || [], zoom.dataset.zoom, from, (id) => {
        closeTplPop();
        onPick(id);
      });
      if (TS) open(TS);
      else tsReady.then(open);
      return;
    }
    const it = e.target.closest("[data-t]");
    if (!it) return;
    closeTplPop();
    onPick(it.dataset.t);
  };
  const outside = (e) => {
    if (!pop.contains(e.target) && !e.target.closest("[data-tpl], #iTplSel, .tv")) closeTplPop();
  };
  const key = (e) => {
    if (e.key === "Escape" && !document.querySelector(".tv")) closeTplPop();
  };
  pop._off = () => {
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", key, true);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", key, true);
  }, 0);
}

let TS = null;
const tsReady = import("/web/tplstudio.js").then((m) => (TS = m)).catch(() => null);

function tplSelect(X, cur) {
  const { S, ic, esc } = X;
  const sel = tplOf(S, cur);
  return `<button class="tsel" id="iTplSel" type="button">
      <span class="tsel-m">${sel?.poster ? `<img src="${sel.poster}" alt="">` : ic("wand-sparkles", 15)}</span>
      <span class="tsel-t"><b>${sel ? esc(sel.name) : "Serbest tasarım"}</b><span>${sel ? esc(sel.best_for || "") : "Şablon yok; ajan her videoyu özgün tasarlar"}</span></span>
      ${ic("chevron-down", 15)}</button>`;
}

export function renderIdeas(X) {
  const { S, ic, esc } = X;
  const el = $("#ideasView");
  const d = (S.ideaDraft ||= draft());
  const scroll = $(".ideas-main", el)?.scrollTop || 0;
  const batches = S.ideas || [];
  const b = S.batch && batches.some((x) => x.id === S.batch.id) ? S.batch : null;
  const agentOn = S.agents.some((a) => a.live !== "off");
  const seg = (id, vals, cur, fmt = (v) => v) => `<div class="seg" id="${id}">${vals.map((v) => `<button data-v="${v}" class="${cur === v ? "active" : ""}">${fmt(v)}</button>`).join("")}</div>`;

  const side = `<div class="ideas-side">
    <div class="pane finder">
      <h3>${ic("lightbulb", 15)}İçerik fikri bul</h3>
      <textarea id="iTopic" rows="3" placeholder="Konu: ör. küçük işletmeler için Instagram ipuçları, evde kahve demleme, yapay zekâ ile verimlilik…">${esc(d.topic)}</textarea>
      <label>Kaç fikir</label>${seg("iCount", [5, 10, 15, 20], d.count)}
      <label>Süre</label>${durSlider("iDur", d.duration)}
      <label>Ton</label><div class="chips" id="iTone">${TONES.map((t) => `<button data-v="${esc(t)}" class="${d.tone === t ? "active" : ""}">${esc(t)}</button>`).join("")}</div>
      <label>Video stili</label>${tplSelect(X, d.template)}
      <label>Hedef kitle</label><input id="iAud" placeholder="ör. yeni başlayan içerik üreticileri" value="${esc(d.audience)}">
      <label>Ek not</label><textarea id="iNotes" rows="2" placeholder="ör. sayılarla anlatılsın, mizahi olsun, rakip isim geçmesin…">${esc(d.notes)}</textarea>
      <button class="btn primary wide big" id="iGo">${ic("lightbulb", 17)}İçerik fikri bul</button>
      ${agentOn ? "" : `<div class="sm warnline" style="margin-top:6px">${ic("triangle-alert", 13)} Ajan bağlı değil; istek sıraya girer.</div>`}
    </div>
    <h3 class="side-h">${ic("list", 14)}Fikir setleri</h3>
    <div class="cards">${batches.length ? batches.map((x) => `<div class="card batch ${b && x.id === b.id ? "sel" : ""}" data-b="${x.id}">
        <div class="grow"><div class="row" style="justify-content:space-between"><span class="sm muted">${x.id} · ${ago(x.created)}</span><span class="badge bs-${x.status}">${BSTATUS[x.status] || x.status}</span></div>
        <div class="t">${esc(x.topic)}</div>
        <div class="s">${x.counts.total}/${x.requested} kurgu${x.counts.selected ? ` · ${x.counts.selected} seçili` : ""}${x.counts.produced ? ` · ${x.counts.produced} üretimde` : ""}</div></div></div>`).join("") : `<div class="empty sm">Henüz fikir seti yok. Bir konu yaz ve "İçerik fikri bul"a bas.</div>`}</div>
  </div>`;

  let main;
  if (!b) {
    main = `<div class="empty" style="padding-top:120px">${ic("lightbulb", 40)}<p>Konu yaz, ajan senin için metin kurguları yazsın.<br>Okuyup beğendiklerini seç, videolarını yapsın.</p></div>`;
  } else {
    const items = b.ideas.filter((i) => S.ideaFilter === "all" || !S.ideaFilter || i.status === S.ideaFilter);
    const sel = b.ideas.filter((i) => i.status === "secildi");
    const chars = sel.reduce((n, i) => n + i.lines.join(" ").length, 0);
    const left = S.credits?.left;
    const br = b.brief || {};
    const writing = ["sirada", "yaziliyor"].includes(b.status);
    main = `<div class="ideas-head">
        <div class="grow"><h2>${esc(b.topic)}</h2>
          <div class="tags">${br.template ? `<span class="tag">${ic("palette", 12)}${esc((S.templates || []).find((t) => t.id === br.template)?.name || br.template)}</span>` : ""}${br.duration ? `<span class="tag">${ic("clock", 12)}${br.duration} sn</span>` : ""}${br.tone ? `<span class="tag">${esc(br.tone)}</span>` : ""}${br.audience ? `<span class="tag">${esc(br.audience)}</span>` : ""}${br.notes ? `<span class="tag" title="${esc(br.notes)}">not: ${esc(br.notes.slice(0, 40))}${br.notes.length > 40 ? "…" : ""}</span>` : ""}</div></div>
        <button class="btn" id="iMore" ${writing ? "disabled" : ""}>${ic("plus", 15)}5 fikir daha</button>
        <button class="btn ghost icon" id="iDel" title="Seti sil">${ic("trash-2")}</button>
      </div>
      ${writing ? `<div class="progress"><div class="row">${ic("loader-circle", 15, "spin")}<b class="grow">${esc(b.stage || "")}</b><span class="sm muted">${b.agent ? esc(b.agent) : agentOn ? "ajan alacak" : "ajan bağlı değil"}</span></div></div>` : ""}
      ${b.status === "hata" ? `<div class="errbox">${ic("triangle-alert", 15)} ${esc(b.stage || "")}</div>` : ""}
      <div class="row wrap ideas-tools">
        <div class="filters">${FILTERS.map(([k, t]) => `<button data-f="${k}" class="${(S.ideaFilter || "all") === k ? "active" : ""}">${t} ${k === "all" ? b.ideas.length : b.ideas.filter((i) => i.status === k).length}</button>`).join("")}</div>
        <span class="grow"></span>
        <button class="btn sm ghost" id="iOpenAll">${ic(S.ideaAllOpen ? "chevron-up" : "chevron-down", 14)}${S.ideaAllOpen ? "Hepsini kapat" : "Hepsini aç"}</button>
      </div>
      <div class="idea-list">${items.length ? items.map((i) => ideaCard(X, b, i)).join("") : `<div class="empty sm">${writing ? "Kurgular yazılınca burada görünecek." : "Bu filtrede fikir yok."}</div>`}</div>
      ${sel.length ? `<div class="ideas-bar"><span>${ic("square-check", 16)}<b>${sel.length}</b> kurgu seçili · seslendirme ~${chars.toLocaleString("tr-TR")} karakter${left != null ? ` <span class="${chars > left ? "warnline" : "muted"}">(ElevenLabs kalan ${left.toLocaleString("tr-TR")})</span>` : ""}</span><span class="grow"></span><button class="btn primary big" id="iProduce">${ic("clapperboard", 17)}Seçilenlerin videosunu yap</button></div>` : ""}`;
  }
  el.innerHTML = `<div class="ideas">${side}<div class="ideas-main">${main}</div></div>`;
  $(".ideas-main", el).scrollTop = scroll;
  bind(X, el, d, b);
}

function ideaCard(X, b, i) {
  const { S, ic, esc } = X;
  const open = S.ideaAllOpen || S.ideaOpen?.has(i.id);
  const editing = S.ideaEdit === i.id;
  const n = i.id.split("-").pop();
  const head = `<div class="idea-head">
      <span class="inum">${n}</span>
      <div class="grow"><div class="ititle">${esc(i.title)}${i.edited ? ` <span class="sm muted">(düzenlendi)</span>` : ""}</div>
        ${i.angle ? `<div class="sm muted">${esc(i.angle)}</div>` : ""}</div>
      ${i.status === "uretimde" ? "" : tplChip(X, b, i)}
      <span class="tag">${ic("clock", 12)}${i.duration} sn</span>
      <span class="badge is-${i.status}">${ISTATUS[i.status]}</span>
      ${i.status === "uretimde" ? "" : `<button class="btn icon pick ${i.status === "secildi" ? "on" : ""}" data-pick="${i.id}" title="${i.status === "secildi" ? "Seçimi kaldır" : "Seç"}">${ic(i.status === "secildi" ? "square-check" : "square", 18)}</button>`}
    </div>`;
  if (editing) {
    return `<div class="idea editing" data-i="${i.id}">${head}
      <label>Başlık</label><input class="eTitle" value="${esc(i.title)}">
      <label>Kanca (ilk 1-2 saniye)</label><input class="eHook" value="${esc(i.hook)}">
      <label>Seslendirme metni (her satır bir cümle)</label><textarea class="eLines" rows="${Math.min(14, i.lines.length + 2)}">${esc(i.lines.join("\n"))}</textarea>
      <label>Açıklama</label><textarea class="eCap" rows="3">${esc(i.caption)}</textarea>
      <label>Hashtag'ler</label><input class="eTags" value="${esc(i.hashtags)}">
      <div class="row end" style="margin-top:10px"><button class="btn" data-cancel="${i.id}">Vazgeç</button><button class="btn primary" data-save="${i.id}">${ic("check", 15)}Kaydet</button></div>
    </div>`;
  }
  const chars = i.lines.join(" ").length;
  return `<div class="idea ${i.status}" data-i="${i.id}">${head}
    ${i.hook ? `<div class="hook">“${esc(i.hook)}”</div>` : ""}
    ${open ? `<div class="idea-body">
        <div><h4>${ic("mic", 13)}Seslendirme <span class="muted">· ${chars} karakter</span></h4><ol class="vlines">${i.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ol></div>
        ${i.scenes.length ? `<div><h4>${ic("film", 13)}Sahne planı</h4><ol class="scenes">${i.scenes.map((s) => `<li><div>${esc(s.visual)}</div>${s.text ? `<div class="stext">Ekranda: “${esc(s.text)}”</div>` : ""}</li>`).join("")}</ol></div>` : ""}
        ${i.caption ? `<div class="full"><h4>${ic("message-circle", 13)}Açıklama</h4><div class="cap">${esc(i.caption)}${i.hashtags ? `<div class="muted">${esc(i.hashtags)}</div>` : ""}</div></div>` : ""}
        ${i.why ? `<div class="full why">${ic("info", 13)} ${esc(i.why)}</div>` : ""}
      </div>` : ""}
    <div class="row idea-foot">
      <button class="btn sm ghost" data-open="${i.id}">${ic(open ? "chevron-up" : "chevron-down", 14)}${open ? "Kapat" : "Kurguyu oku"}</button>
      <span class="grow"></span>
      ${i.status === "uretimde" ? `<a class="btn sm" href="#${i.post}">${ic("external-link", 14)}İçerik #${i.post}</a>` : `
        <button class="btn sm ghost" data-edit="${i.id}">${ic("pencil", 14)}Düzenle</button>
        ${i.status === "elendi" ? `<button class="btn sm ghost" data-st="${i.id}" data-v="yeni">${ic("rotate-ccw", 14)}Geri al</button>` : `<button class="btn sm ghost" data-st="${i.id}" data-v="elendi">${ic("ban", 14)}Ele</button>`}
        <button class="btn sm" data-one="${i.id}">${ic("clapperboard", 14)}Videoya dönüştür</button>`}
    </div>
  </div>`;
}

function bind(X, el, d, b) {
  const { S, api, toast, guard } = X;
  const save = () => {
    d.topic = $("#iTopic", el).value;
    d.audience = $("#iAud", el).value;
    d.notes = $("#iNotes", el).value;
    keep(d);
  };
  const choose = (id) => {
    save();
    d.template = id;
    keep(d);
    renderIdeas(X);
  };
  $("#iTplSel", el).onclick = (e) => openTplPop(X, { current: d.template, alignLeft: true }, e.currentTarget, choose);
  for (const id of ["iTopic", "iAud", "iNotes"]) $("#" + id, el).oninput = save;
  const pick = (id, key, cast = (v) => v, toggle = false) =>
    ($("#" + id, el).onclick = (e) => {
      const btn = e.target.closest("[data-v]");
      if (!btn) return;
      save();
      d[key] = toggle && d[key] === cast(btn.dataset.v) ? "" : cast(btn.dataset.v);
      keep(d);
      renderIdeas(X);
    });
  pick("iCount", "count", Number);
  bindDurSlider($("#iDur", el), (v) => {
    save();
    d.duration = v;
    keep(d);
  });
  pick("iTone", "tone", String, true);
  $("#iGo", el).onclick = guard(async () => {
    save();
    if (!d.topic.trim()) {
      $("#iTopic", el).focus();
      throw new Error("Önce bir konu yaz");
    }
    const nb = await api("/api/ideas", { topic: d.topic, count: d.count, brief: { duration: d.duration, tone: d.tone, audience: d.audience.trim(), notes: d.notes.trim(), format: "9:16", template: d.template } });
    d.topic = "";
    d.notes = "";
    keep(d);
    S.batch = nb;
    S.ideaFilter = "all";
    await X.refresh();
    toast(`${nb.requested} fikir için ajana gönderildi`);
  });
  for (const c of $$("[data-b]", el))
    c.onclick = guard(async () => {
      S.ideaEdit = null;
      await loadBatch(X, c.dataset.b);
      renderIdeas(X);
    });
  if (!b) return;
  const refresh = (nb) => {
    S.batch = nb;
    renderIdeas(X);
  };
  const setStatus = guard(async (id, v) => refresh(await api(`/api/ideas/${b.id}/item`, { id, status: v })));
  el.onclick = async (e) => {
    const t = e.target.closest("button, a");
    if (!t || !el.contains(t)) return;
    if (t.dataset.f) {
      S.ideaFilter = t.dataset.f;
      renderIdeas(X);
    } else if (t.dataset.pick) {
      const i = b.ideas.find((x) => x.id === t.dataset.pick);
      setStatus(i.id, i.status === "secildi" ? "yeni" : "secildi");
    } else if (t.dataset.tpl) {
      const i = b.ideas.find((x) => x.id === t.dataset.tpl);
      const set = b.brief?.template && tplOf(S, b.brief.template);
      openTplPop(X, { current: i.template, title: i.title, defaultLabel: set ? `Setin stili (${set.name})` : "Serbest tasarım", defaultIcon: set ? "rotate-ccw" : "wand-sparkles", defaultHint: set ? `Setin stili kullanılır: ${set.name}.` : "" }, t, guard(async (tpl) => {
        refresh(await api(`/api/ideas/${b.id}/item`, { id: i.id, template: tpl }));
        toast(tpl ? `Stil: ${tplOf(S, tpl)?.name || tpl}` : "Stil varsayılana döndü");
      }));
    } else if (t.dataset.st) setStatus(t.dataset.st, t.dataset.v);
    else if (t.dataset.open) {
      S.ideaOpen ||= new Set();
      if (S.ideaAllOpen) {
        S.ideaAllOpen = false;
        S.ideaOpen = new Set(b.ideas.map((x) => x.id));
      }
      S.ideaOpen.has(t.dataset.open) ? S.ideaOpen.delete(t.dataset.open) : S.ideaOpen.add(t.dataset.open);
      renderIdeas(X);
    } else if (t.dataset.edit) {
      S.ideaEdit = t.dataset.edit;
      renderIdeas(X);
    } else if (t.dataset.cancel) {
      S.ideaEdit = null;
      renderIdeas(X);
    } else if (t.dataset.save) {
      const card = t.closest(".idea");
      await guard(async () => {
        const nb = await api(`/api/ideas/${b.id}/item`, {
          id: t.dataset.save, title: $(".eTitle", card).value, hook: $(".eHook", card).value,
          lines: $(".eLines", card).value, caption: $(".eCap", card).value, hashtags: $(".eTags", card).value,
        });
        S.ideaEdit = null;
        refresh(nb);
        toast("Kurgu güncellendi");
      })();
    } else if (t.dataset.one) produce([t.dataset.one]);
  };
  $("#iOpenAll", el).onclick = (e) => {
    e.stopPropagation();
    S.ideaAllOpen = !S.ideaAllOpen;
    if (!S.ideaAllOpen) S.ideaOpen = new Set();
    renderIdeas(X);
  };
  const more = $("#iMore", el);
  if (more)
    more.onclick = guard(async (e) => {
      e.stopPropagation();
      refresh(await api(`/api/ideas/${b.id}/more`, { count: 5 }));
      toast("5 fikir daha istendi");
    });
  $("#iDel", el).onclick = (e) => {
    e.stopPropagation();
    X.confirm("Fikir seti silinsin mi?", `“${X.esc(b.topic)}” listeden kaldırılacak. Üretime gönderilmiş videolar etkilenmez.`, "Sil", guard(async () => {
      await api(`/api/ideas/${b.id}/delete`, {});
      S.batch = null;
      await X.refresh();
    }));
  };
  const prod = $("#iProduce", el);
  if (prod)
    prod.onclick = (e) => {
      e.stopPropagation();
      produce(b.ideas.filter((i) => i.status === "secildi").map((i) => i.id));
    };

  function produce(ids) {
    const { ic, esc } = X;
    const list = b.ideas.filter((i) => ids.includes(i.id));
    const chars = list.reduce((n, i) => n + i.lines.join(" ").length, 0);
    const left = S.credits?.left;
    const tpls = S.templates || [];
    const setTpl = b.brief?.template && tplOf(S, b.brief.template);
    const pick = Object.fromEntries(list.map((i) => [i.id, i.template || ""]));
    const useTg = targetsReady(S);
    let tgAll = defaultTargets(S);
    const tgRow = {};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const opts = (cur) => `<option value="">${setTpl ? `Setin stili (${esc(setTpl.name)})` : "Serbest tasarım"}</option>${tpls.map((t) => `<option value="${t.id}" ${cur === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}`;
    const poster = (id) => {
      const t = tplOf(S, id) || setTpl;
      return t?.poster ? `<img src="${t.poster}" alt="">` : ic("wand-sparkles", 14);
    };
    const rows = () => list.map((i) => `<div class="pd-row"><div class="pd-pv" data-pv="${i.id}">${poster(pick[i.id])}</div><div class="grow"><div class="pd-t">${esc(i.title)}</div><div class="sm muted">${i.lines.join(" ").length} karakter · ${i.duration} sn</div></div>${useTg && list.length > 1 ? targetsHtml(X, tgRow[i.id] || tgAll, { mini: true, attrs: `data-rowtg="${i.id}"` }) : ""}<select data-row="${i.id}">${opts(pick[i.id])}</select></div>`).join("");
    X.modal(`<h2>${ic("clapperboard", 20)}${list.length} kurgunun videosu yapılsın mı?</h2>
      ${list.length > 1 ? `<div class="pd-bulk"><span class="sm muted">Hepsine:</span><select id="pdAll"><option value="-">Stil seç…</option>${opts("")}</select><button class="btn sm" id="pdMix" title="Her videoya farklı bir stil ver">${ic("shuffle", 14)}Karışık dağıt</button></div>` : ""}
      ${useTg ? `<div class="pd-tg">${targetsHtml(X, tgAll, { id: "pdTargets" })}${list.length > 1 ? `<span class="sm muted">Satırlardan tek tek de değiştirebilirsin</span>` : ""}</div>` : ""}
      <div class="pd-list" id="pdList">${rows()}</div>
      <div class="help">Her biri ayrı içerik olarak üretim sırasına girer; ajan onayladığın metni aynen seslendirir. Tahmini ElevenLabs kullanımı <b>~${chars.toLocaleString("tr-TR")}</b> karakter${left != null ? `, kalan <b>${left.toLocaleString("tr-TR")}</b>` : ""}.${left != null && chars > left ? `<br><b>Kredi yetmeyebilir; yetmeyenler hata ile durur.</b>` : ""}</div>
      <div class="foot"><button class="btn" data-close>Vazgeç</button><button class="btn primary" id="pdGo">${ic("clapperboard", 15)}Üretime gönder</button></div>`, (m) => {
      const redraw = () => {
        $("#pdList", m).innerHTML = rows();
      };
      m.addEventListener("tgchange", (e) => {
        const row = e.target.closest("[data-rowtg]");
        if (row) {
          tgRow[row.dataset.rowtg] = e.detail.value;
          return;
        }
        tgAll = e.detail.value;
        for (const k of Object.keys(tgRow)) delete tgRow[k];
        redraw();
      });
      m.onchange = (e) => {
        const s = e.target.closest("[data-row]");
        if (s) {
          pick[s.dataset.row] = s.value;
          $(`[data-pv="${s.dataset.row}"]`, m).innerHTML = poster(s.value);
        }
        if (e.target.id === "pdAll" && e.target.value !== "-") {
          for (const i of list) pick[i.id] = e.target.value;
          redraw();
        }
      };
      const mix = $("#pdMix", m);
      if (mix)
        mix.onclick = () => {
          const pool = tpls.filter((t) => !t.custom).map((t) => t.id).sort(() => Math.random() - 0.5);
          const all = [...pool, ...tpls.filter((t) => t.custom).map((t) => t.id)];
          list.forEach((i, k) => (pick[i.id] = all[k % all.length]));
          $("#pdAll", m).value = "-";
          redraw();
        };
      $("#pdGo", m).onclick = guard(async () => {
        $("#pdGo", m).disabled = true;
        const templates = Object.fromEntries(Object.entries(pick).filter(([, v]) => v));
        const tg = useTg ? { targets: tgAll, item_targets: Object.fromEntries(Object.entries(tgRow).filter(([, v]) => !same(v, tgAll))) } : {};
        const r = await api(`/api/ideas/${b.id}/produce`, { items: ids, templates, ...tg });
        X.closeModal();
        refresh(r.batch);
        toast(`${r.posts.length} video üretim sırasına girdi`);
        X.refresh();
      });
    }, "prod-dlg");
  }
}
