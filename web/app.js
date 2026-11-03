import { ICONS } from "/web/icons.js";
import { renderCreate, renderAI, ago, refreshTplGrid } from "/web/views.js";
import { renderIdeas, loadBatch } from "/web/ideas.js";
import { renderAutopilot, syncAutopilot } from "/web/autopilot.js";
import { renderAccount, postStats, openComposer, syncAccounts } from "/web/account.js";
import { handleNotifications, toggleBellPanel, notifySettingsHtml, bindNotifySettings } from "/web/notify.js";
import { renderClaudeChip, toggleClaudePanel } from "/web/claude.js";
import { renderCloudChip, openCloud, cloudBadgeHtml, cloudCovers, cloudSettingsHtml, bindCloudSettings } from "/web/cloudview.js";
import { schedulerHtml, bindScheduler, plannedHtml, relTime } from "/web/schedule.js";
import { renderPlanner, planPill } from "/web/planner.js";
import { cloudMark } from "/web/cloudmark.js";
import { renderYtChip, ytCardHtml, bindYtCard, ytSettingsHtml, bindYtSettings } from "/web/youtube.js";
import { renderTtChip, ttCardHtml, bindTtCard, ttSettingsHtml, bindTtSettings, ttTabSub, ttOn } from "/web/tiktok.js";
import { renderLiveButton, toggleLive } from "/web/livejobs.js";
import { initStatus } from "/web/statusbar.js";
import { applyTheme, themeSettingsHtml, bindThemeSettings } from "/web/theme.js";
import { initContextMenu } from "/web/ctxmenu.js";
import { openBrowser } from "/web/browser.js";
import { elAccountsHtml, bindElAccounts } from "/web/elaccounts.js";
import { openTrash, trashPost, renderTrashButton } from "/web/trash.js";
import { initSound, playToggle } from "/web/sound.js";
import { saveAsTemplate } from "/web/totemplate.js";
import { initOturum } from "/web/oturum.js";
import { initClaudeSetup, claudeSetupBtn } from "/web/claudesetup.js";
import { initUpdate, updateSettingsTab, updateSettingsHtml, bindUpdateSettings } from "/web/update.js";
import { initComponents, componentsTab, componentsSettingsHtml, bindComponentsSettings } from "/web/components.js";
import { targetsHtml, readTargets, setTargets, postTargets, defaultTargets, targetsReady, targetIcons, targetsText, confirmYtRemoval } from "/web/targets.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function ic(name, size = 16, cls = "") {
  const svg = (ICONS[name] || "").replace("<svg", `<svg width="${size}" height="${size}" class="ic"`);
  return `<span class="icw ${cls}">${svg}</span>`;
}
function hydrate(root = document) {
  for (const el of $$("[data-ic]", root)) {
    el.innerHTML = ic(el.dataset.ic, +(el.dataset.size || 16));
    el.removeAttribute("data-ic");
  }
}

const STATUS = { sirada: "Sırada", uretimde: "Üretimde", inceleme: "İncelemede", planlandi: "Planlandı", paylasiliyor: "Paylaşılıyor", paylasildi: "Paylaşıldı", hata: "Hata" };
const FILTERS = [["all", "Tümü"], ["active", "Üretimde"], ["inceleme", "İncelemede"], ["planlandi", "Planlı"], ["paylasildi", "Paylaşıldı"]];
const S = { posts: [], agents: [], credits: {}, settings: {}, sel: null, detail: null, filter: "all", tab: "posts", month: null, dirty: false, sig: "" };

async function api(path, body, opts = {}) {
  const r = await fetch(path, body === undefined ? opts : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}
function toast(text, err = false, action = null) {
  const t = $("#toast");
  t.textContent = text;
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-act";
    b.textContent = action.label;
    b.onclick = () => {
      t.classList.add("hidden");
      guard(action.fn)();
    };
    t.append(b);
  }
  t.className = "toast" + (err ? " err" : "");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), err ? 6000 : action ? 7000 : 3000);
}
const guard = (fn) => async (...a) => {
  try {
    await fn(...a);
  } catch (e) {
    toast(e.message, true);
  }
};

const fmtDate = (iso, withTime = true) => (iso ? new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "long", weekday: withTime ? "short" : undefined, hour: withTime ? "2-digit" : undefined, minute: withTime ? "2-digit" : undefined }) : "");
const fmtSec = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const badge = (st) => `<span class="badge b-${st}">${STATUS[st] || st}</span>`;
const thumbUrl = (p) => (p.has_thumb ? `/media/${p.id}/thumb.jpg?v=${encodeURIComponent(p.updated)}` : "");

// ---------- polling ----------

async function takeDraftInbox() {
  if (S.inboxBusy) return;
  S.inboxBusy = true;
  try {
    const { refs } = await api("/api/draft/inbox/take", {});
    if (refs?.length) {
      const views = await import("/web/views.js");
      const n = views.addResearchToDraft(X, { refs, research: [] });
      if (n) toast(`${n} görsel referans Oluştur'a eklendi`);
    }
  } catch {}
  S.inboxBusy = false;
}
async function poll() {
  try {
    const d = await api("/api/state");
    if (d.draft_inbox) takeDraftInbox();
    S.posts = d.posts;
    S.agents = d.agents;
    S.credits = d.credits;
    S.settings = d.settings;
    S.queue = d.queue;
    const top = S.activity?.[0];
    const idx = top ? d.activity.findIndex((a) => a.at === top.at && a.text === top.text) : 0;
    S.freshActivity = idx > 0 ? idx : 0;
    S.activity = d.activity;
    S.ideas = d.ideas || [];
    S.autopilot = d.autopilot || [];
    S.notifications = d.notifications;
    S.notify_settings = d.notify_settings;
    S.trashCount = d.trash || 0;
    renderTrashButton(X);
    const reqSig = JSON.stringify((d.tpl_requests || []).map((r) => [r.id, r.status, r.progress, r.stage]));
    S.tpl_requests = d.tpl_requests || [];
    if (reqSig !== S.reqSig) {
      const doneNow = S.reqSig !== undefined;
      S.reqSig = reqSig;
      if (doneNow && S.tab === "create") loadTemplates().then(() => refreshTplGrid(X));
    }
    handleNotifications(X, d.notifications, d.notify_settings);
    S.account = d.claude?.account || "main";
    S.accounts = d.claude?.accounts || [S.account];
    renderClaudeChip(X, d.claude);
    renderCloudChip(X, d.cloud);
    renderYtChip(X, d.youtube);
    renderTtChip(X, d.tiktok);
    syncAccounts(X);
    renderTop();
    renderList();
    planPill(S);
    if (S.tab === "calendar") renderCalendar();
    if (S.tab === "ai") renderAI(X);
    if (S.tab === "ideas") await syncIdeas();
    syncAutopilot(X);
    const cur = S.posts.find((p) => p.id === S.sel);
    if (cur && cur.updated !== S.detail?.updated) await loadDetail(S.sel);
    if (!cur && S.sel) {
      S.sel = null;
      S.detail = null;
      renderDetail();
    }
  } catch (e) {
    const lb = $("#liveBtn");
    lb.dataset.sig = "";
    lb.className = "live-btn bad";
    lb.innerHTML = `${ic("unplug", 15)}<span class="lj-t">Sunucu kapalı</span>`;
    lb.title = "Stüdyo sunucusuna ulaşılamıyor";
  }
}

async function loadTemplates() {
  try {
    S.templates = await api("/api/templates");
  } catch {
    S.templates ||= [];
  }
}

async function syncIdeas(force = false) {
  const cur = S.batch && S.ideas.find((b) => b.id === S.batch.id);
  if (cur && cur.updated !== S.batch.updated) await loadBatch(X, cur.id);
  if (!S.batch && S.ideas.length && force) await loadBatch(X, S.ideas[0].id);
  const sig = JSON.stringify([S.ideas.map((b) => [b.id, b.updated]), S.batch?.updated, S.agents.map((a) => a.live), S.credits?.left]);
  const typing = document.activeElement && document.querySelector("#ideasView")?.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
  if (!force && (sig === S.ideaSig || S.ideaEdit || typing)) return;
  S.ideaSig = sig;
  renderIdeas(X);
}

function renderTop() {
  renderLiveButton(X);
  const pill = $("#aiPill");
  const busy = S.agents.some((a) => a.live === "working");
  const qn = (S.queue || []).length;
  pill.classList.toggle("hidden", !busy && !qn);
  pill.className = "pill" + (!busy && !qn ? " hidden" : "") + (busy ? " busy" : "");
  pill.textContent = qn ? String(qn) : "•";
  pill.title = `${busy ? "Ajan çalışıyor" : ""}${qn ? ` · sırada ${qn} iş` : ""}`;
  const c = S.credits || {};
  const cel = $("#credits");
  if (c.left != null) {
    cel.className = "chip " + (c.left < 1500 ? "warn" : "ok");
    cel.innerHTML = `${ic("mic", 14)}<span class="ct-x">ElevenLabs </span>${c.left.toLocaleString("tr-TR")}<span class="ct-x"> kredi</span>`;
    const accs = (c.accounts || []).filter((a) => a.enabled);
    cel.title = `ElevenLabs · toplam ${c.left.toLocaleString("tr-TR")} kredi kaldı${accs.length > 1 ? `\n${accs.map((a) => `${a.name}: ${a.left != null ? a.left.toLocaleString("tr-TR") + " kredi" : "bağlanamadı"}`).join("\n")}` : `\nKullanılan ${c.used} / ${c.limit}${c.reset_date ? " · yenilenme " + c.reset_date : ""}`}`;
  } else {
    cel.className = "chip " + (S.settings.elevenlabs?.has_key ? "bad" : "");
    const elText = S.settings.elevenlabs?.has_key ? "ElevenLabs bağlanamadı" : "ElevenLabs bağlı değil";
    cel.innerHTML = `${ic("mic", 14)}<span class="ct-x">${elText}</span>`;
    cel.title = c.error || elText;
  }
  const ig = S.settings.instagram || {};
  const igel = $("#igchip");
  igel.className = "chip " + (ig.has_token && ig.username ? "ok" : "");
  igel.innerHTML = `${ic("instagram", 14)}<span class="ct-x">${ig.has_token && ig.username ? "@" + esc(ig.username) : "Bağlı değil"}</span>`;
  igel.title = ig.has_token && ig.username ? `Instagram · @${ig.username}` : "Instagram bağlı değil";
}

function filtered() {
  return S.posts.filter((p) => S.filter === "all" || (S.filter === "active" ? ["sirada", "uretimde", "hata"].includes(p.status) : p.status === S.filter));
}

function renderList() {
  $("#filters").innerHTML = FILTERS.map(([k, t]) => {
    const n = k === "all" ? S.posts.length : S.posts.filter((p) => (k === "active" ? ["sirada", "uretimde", "hata"].includes(p.status) : p.status === k)).length;
    return `<button data-f="${k}" class="${S.filter === k ? "active" : ""}">${t} ${n}</button>`;
  }).join("");
  const list = filtered();
  const sig = JSON.stringify([list.map((p) => [p.id, p.updated, p.cloud?.state, p.youtube?.state, p.youtube?.enabled, p.targets?.instagram, p.targets?.youtube, p.tiktok?.state, p.tiktok?.enabled, p.tiktok?.code]), S.sel, S.cloud?.configured, S.cloud?.enabled, S.youtube?.connected]);
  if (sig === S.sig) return;
  S.sig = sig;
  $("#postList").innerHTML = list.length
    ? list.map((p) => {
        const th = thumbUrl(p);
        const sub = p.status === "planlandi" ? `${ic("calendar-clock", 12)} ${fmtDate(p.schedule)}` : p.status === "paylasildi" ? `Yayında · ${fmtDate(p.published?.at, false)}` : esc(p.stage || "");
        const bar = ["sirada", "uretimde"].includes(p.status) ? `<div class="bar"><i style="width:${Math.round((p.progress || 0) * 100)}%"></i></div>` : "";
        return `<div class="card ${p.id === S.sel ? "sel" : ""}" data-id="${p.id}">
          <div class="thumb" style="${th ? `background-image:url('${th}')` : ""}">${th ? "" : ic(p.status === "sirada" ? "hourglass" : "film", 20)}</div>
          <div class="grow"><div class="row" style="justify-content:space-between"><span class="sm muted">#${p.id}</span><span class="cbad">${cloudMark(X, p, 14)}${targetIcons(X, p, 14)}${badge(p.status)}</span></div>
          <div class="t">${esc(p.title)}</div><div class="s row">${sub}</div>${bar}</div>
          <button class="cdel" data-del="${p.id}" title="Çöp kutusuna taşı">${ic("trash-2", 14)}</button></div>`;
      }).join("")
    : `<div class="empty">${S.posts.length ? "Bu filtrede içerik yok." : "Henüz içerik yok.<br>Yeni içerik ile bir konsept yaz; ajanlar üretmeye başlasın."}</div>`;
}

async function loadDetail(id) {
  const d = await api(`/api/posts/${id}`);
  if (S.sel !== id) return;
  S.detail = d;
  renderDetail();
}

// ---------- detail ----------

function videoSrc(d) {
  return d.video ? `/media/${d.id}/${d.video}?v=${encodeURIComponent(d.updated)}` : "";
}

const KIND_LABEL = { reels: "Reels", image: "Fotoğraf", carousel: "Kaydırmalı gönderi", story: "Hikâye" };
const KIND_ICON = { reels: "clapperboard", image: "image", carousel: "gallery-horizontal-end", story: "circle-plus" };
const isVid = (f) => /\.(mp4|mov|m4v|webm)$/i.test(f || "");
const fileUrl = (d, f) => `/media/${d.id}/${encodeURIComponent(f)}?v=${encodeURIComponent(d.updated)}`;
const avatarHtml = (st, handle) => `<span class="avatar" ${st.avatar ? `style="background-image:url('${st.avatar}')"` : ""}>${st.avatar ? "" : esc(handle[0]?.toUpperCase() || "K")}</span>`;

function feedScreen(d, files, st, handle, capFull) {
  const i = S.car?.id === d.id ? Math.min(S.car.i, files.length - 1) : 0;
  return `<div class="igfeed">
    <div class="feed-head">${ic("chevron-left", 22)}<b>Gönderiler</b></div>
    <div class="feed-top">${avatarHtml(st, handle)}<b class="grow">${esc(handle)}</b>${ic("ellipsis", 18)}</div>
    <div class="feed-media">
      <div class="track" id="carTrack" style="transform:translateX(-${i * 100}%)">${files.map((f) => (isVid(f) ? `<video src="${fileUrl(d, f)}" muted loop autoplay playsinline></video>` : `<img src="${fileUrl(d, f)}" alt="">`)).join("")}</div>
      ${files.length > 1 ? `<span class="car-n" id="carN">${i + 1}/${files.length}</span><button class="car-btn l" id="carPrev">${ic("chevron-left", 16)}</button><button class="car-btn r" id="carNext">${ic("chevron-right", 16)}</button>` : ""}
    </div>
    <div class="feed-act">${ic("heart", 22)}${ic("message-circle", 22)}${ic("send", 21)}${files.length > 1 ? `<span class="dots" id="carDots">${files.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</span>` : `<span class="grow"></span>`}${ic("bookmark", 21)}</div>
    <div class="feed-cap"><b>${esc(handle)}</b> <span id="igcap">${esc(capFull) || '<span style="opacity:.6">Açıklama burada görünecek</span>'}</span></div>
  </div>`;
}

function storyScreen(d, src, files, st, handle) {
  const f = files[0];
  return `${src ? `<video id="vid" data-pid="${d.id}" data-src="${esc(src)}" src="${esc(src)}" playsinline loop preload="metadata"></video>`
      : f ? `<img class="story-bg" src="${fileUrl(d, f)}" alt=""><img class="story-img" src="${fileUrl(d, f)}" alt="">` : `<div class="ph">${ic("image", 34)}<div>Görsel yok</div></div>`}
    <div class="story-top"><div class="story-bar"><i></i></div><div class="ig-user">${avatarHtml(st, handle)}${esc(handle)}<span class="when">şimdi</span></div></div>
    ${src ? `<div class="bigplay" id="bigplay">${ic("play", 54)}</div>` : ""}
    <div class="story-reply"><span>Mesaj gönder</span>${ic("heart", 22)}${ic("send", 21)}</div>`;
}

function kindPane(d) {
  const files = d.media || (d.video ? [d.video] : []);
  return `<div class="pane"><h3>${ic(KIND_ICON[d.kind] || "image", 14)}${KIND_LABEL[d.kind] || "Paylaşım"}<span class="grow muted sm" style="text-transform:none;letter-spacing:0">${files.length} dosya · elle yüklendi</span></h3>
    <div class="refthumbs">${files.map((f, i) => `<a href="${fileUrl(d, f)}" target="_blank">${isVid(f) ? `<video src="${fileUrl(d, f)}" muted preload="metadata"></video>` : `<img src="${fileUrl(d, f)}" alt="">`}<span>${i + 1}</span></a>`).join("")}</div></div>`;
}

function renderDetail() {
  const el = $("#detail");
  const d = S.detail;
  if (!d) {
    el.innerHTML = `<div class="empty" style="padding-top:120px">${ic("clapperboard", 40)}<p>Soldan bir içerik seç ya da <b>Yeni içerik</b> ile başla.</p></div>`;
    return;
  }
  const keepCap = S.dirty && $("#cap") ? { cap: $("#cap").value, tags: $("#tags").value } : null;
  const keep = S.prevId === d.id ? ["note", "capHint"].map((id) => [id, $("#" + id)?.value]).filter(([, v]) => v) : [];
  const focus = document.activeElement?.id;
  if (S.prevId !== d.id) {
    el.classList.remove("enter");
    void el.offsetWidth;
    el.classList.add("enter");
    clearTimeout(S.enterT);
    S.enterT = setTimeout(() => el.classList.remove("enter"), 450);
  }
  S.prevId = d.id;
  const v = $("#vid");
  const vstate = v && v.dataset.pid === d.id ? { t: v.currentTime, paused: v.paused, src: v.dataset.src } : null;
  const st = S.settings;
  const handle = st.instagram?.username || st.channel || "kullanici";
  const kind = d.kind || "reels";
  const files = d.media || [];
  const src = kind === "reels" ? videoSrc(d) : kind === "story" && isVid(files[0]) ? fileUrl(d, files[0]) : "";
  const active = ["sirada", "uretimde"].includes(d.status);
  const working = d.status === "uretimde" ? (d.agent ? `${esc(d.agent)} çalışıyor` : "") : "";
  const capFull = d.caption_full || "";

  el.innerHTML = `
  <div class="dhead">
    <input class="title" id="title" value="${esc(d.title)}">
    ${badge(d.status)}
    ${d.video && !d.manual && d.project ? `<button class="btn ghost tplsave" id="tplBtn" title="Bu videonun görsel dilini yeni bir stil olarak kaydet">${ic("copy-plus", 15)}Şablon olarak kaydet</button>` : ""}
    <button class="btn ghost icon" id="delBtn" title="Çöp kutusuna taşı">${ic("trash-2")}</button>
  </div>
  ${active || d.busy.length ? `<div class="progress"><div class="row"><b class="grow">${esc(d.stage || "")}</b><span class="muted sm">${working}</span></div><div class="bar"><i style="width:${Math.round((d.progress || 0) * 100)}%"></i></div></div>` : ""}
  ${d.error ? `<div class="errbox row"><span class="grow">${ic("triangle-alert", 15)} ${esc(d.error)}</span><button class="btn sm" id="retryBtn">${ic("refresh-cw", 14)}Tekrar dene</button></div>` : ""}
  <div class="dgrid">
    <div class="phone-wrap">
      <div class="phone"><div class="screen k-${kind}">
        ${kind === "image" || kind === "carousel" ? feedScreen(d, files, st, handle, capFull) : kind === "story" ? storyScreen(d, src, files, st, handle) : `${src ? `<video id="vid" data-pid="${d.id}" data-src="${esc(src)}" src="${esc(src)}" playsinline loop preload="metadata"></video>` : `<div class="ph">${active ? ic("loader-circle", 34, "spin") : ic("film", 34)}<div>${active ? "Video hazırlanıyor…" : "Video yok"}</div><div class="sm">${esc(d.stage || "")}</div></div>`}
        <div class="shade"></div>
        <div class="ig-top"><span>Reels</span>${ic("camera", 22)}</div>
        ${src ? `<div class="bigplay" id="bigplay">${ic("play", 54)}</div>` : ""}
        <div class="ig-rail">
          <div>${ic("heart", 26)}<span>—</span></div><div>${ic("message-circle", 26)}<span>—</span></div><div>${ic("send", 25)}</div><div>${ic("ellipsis", 22)}</div><span class="disc"></span>
        </div>
        <div class="ig-bottom">
          <div class="ig-user"><span class="avatar" ${st.avatar ? `style="background-image:url('${st.avatar}')"` : ""}>${st.avatar ? "" : esc(handle[0]?.toUpperCase() || "K")}</span>${esc(handle)}<span class="follow">Takip et</span></div>
          <div class="ig-cap" id="igcap">${esc(capFull) || '<span style="opacity:.6">Açıklama burada görünecek</span>'}</div>
          <div class="ig-music">${ic("music", 13)}${esc(st.display_name || handle)} · Orijinal ses</div>
        </div>`}
      </div></div>
      ${src ? `<div class="vctl"><button class="btn icon" id="playBtn">${ic("play")}</button><input type="range" id="seek" min="0" max="1000" value="0"><span class="sm muted" id="tcode">0:00</span><button class="btn icon" id="muteBtn" title="Ses">${ic("volume-2")}</button></div>
      ${kind === "reels" ? `<div class="cover-row">${d.has_thumb ? `<img src="/media/${d.id}/thumb.jpg?v=${encodeURIComponent(d.updated)}" alt="">` : ""}<div class="grow sm muted">Kapak karesi: ${((d.thumb_offset || 0) / 1000).toFixed(1)} sn</div><button class="btn sm" id="coverBtn">${ic("image", 14)}Bu kareyi kapak yap</button></div>` : ""}` : ""}
    </div>
    <div>${paneOrder(d).join("")}</div>
  </div>`;
  hydrate(el);
  bindDetail(d, vstate);
  bindYtCard(X, d);
  bindTtCard(X, d);
  if (d.published?.id) postStats(X, d, $("#igStats")).catch(() => {});
  if (keepCap) {
    $("#cap").value = keepCap.cap;
    $("#tags").value = keepCap.tags;
    $("#capSave").disabled = false;
    updateCounter();
  }
  for (const [id, v] of keep) if ($("#" + id)) $("#" + id).value = v;
  if (focus && $("#" + focus) && /^(note|cap|tags|capHint|when)$/.test(focus)) $("#" + focus).focus();
}

const FOLD_KEY = "sosyal-fold";
const FOLD_DEF = { brief: true, voice: true, activity: true };

function foldMap() {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function folded(k) {
  const m = foldMap();
  return k in m ? !!m[k] : !!FOLD_DEF[k];
}

function setFold(k, on) {
  const m = foldMap();
  m[k] = on;
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(m));
  } catch {}
}

function foldPane(key, icon, title, sum, body, extra = "") {
  return `<div class="pane${folded(key) ? " folded" : ""}" data-fold="${key}"><h3>${ic(icon, 14)}${title}${extra}${sum ? `<span class="fold-sum">${esc(sum)}</span>` : ""}<span class="fold-chev">${ic("chevron-down", 15)}</span></h3>${body}</div>`;
}

function paneOrder(d) {
  const ready = !!(d.video || (d.media || []).length) && !["sirada", "uretimde"].includes(d.status);
  const head = d.manual ? [kindPane(d)] : [briefPane(d), voicePane(d)];
  const notes = d.manual ? [] : [notesPane(d)];
  return ready ? [publishPane(d), captionPane(d), ...notes, ...head, activityPane(d)] : [...head, ...notes, captionPane(d), publishPane(d), activityPane(d)];
}

function briefPane(d) {
  const b = d.brief || {};
  const tags = [];
  if (b.format) tags.push(`${ic("film", 13)}${esc(b.format)}`);
  tags.push(`${ic("clock", 13)}${d.duration} sn`);
  if (b.tone) tags.push(esc(b.tone));
  if (b.style) tags.push(esc(b.style));
  const src = d.source;
  if (src) tags.push(`${ic(src.kind === "video" ? "film" : "mic", 13)}${src.kind === "video" ? (src.visual ? "Hazır video · üstüne" : "Hazır videonun sesi") : "Hazır ses"}`);
  else if (b.voiceover === false) tags.push("seslendirme yok");
  if (b.subtitles === false) tags.push("altyazı yok");
  if (b.music) tags.push(`${ic("music", 13)}${esc(b.music)}`);
  if (b.cta) tags.push(`Çağrı: ${esc(b.cta)}`);
  const colors = (b.colors || []).map((c) => `<span class="sw" style="background:${esc(c)}" title="${esc(c)}"></span>`).join("");
  const refs = d.refs || [];
  return foldPane("brief", "pencil", "Brif", d.concept || "", `<div class="concept">${esc(d.concept)}</div>
    <div class="tags">${tags.map((t) => `<span class="tag">${t}</span>`).join("")}${colors ? `<span class="tag">${colors}</span>` : ""}</div>
    ${b.audience ? `<div class="sm" style="margin-top:8px"><span class="muted">Hedef kitle:</span> ${esc(b.audience)}</div>` : ""}
    ${(b.key_points || []).length ? `<ul class="points">${b.key_points.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${(b.links || []).length ? `<div class="sm" style="margin-top:6px">${b.links.map((l) => `<a href="${esc(l)}" target="_blank">${esc(l)}</a>`).join("<br>")}</div>` : ""}
    ${src ? `<div class="srcplay">${src.kind === "video" && src.visual ? `<video src="/media/${d.id}/kaynak/${encodeURIComponent(src.file)}" controls preload="metadata" playsinline></video>` : `<audio src="/media/${d.id}/kaynak/${encodeURIComponent(src.file)}" controls preload="metadata"></audio>`}<div class="sm muted">${esc(src.name)}</div></div>` : ""}
    ${refs.length ? `<div class="refthumbs">${refs.map((r) => `<a href="/media/${d.id}/refs/${encodeURIComponent(r.file)}" target="_blank" title="${esc(r.note || r.name)}"><img src="/media/${d.id}/refs/${encodeURIComponent(r.file)}" alt=""><span>${r.use ? "Videoda" : "Stil"}</span></a>`).join("")}</div>` : ""}
    ${(d.research || []).length ? `<div class="rsdl"><div class="sm muted">${ic("library", 13)}Araştırma</div>${d.research.map((r) => `<div class="rsd"${r.note ? ` title="${esc(r.note)}"` : ""}><span class="rsk">${ic({ png: "image", html: "globe" }[r.kind] || "file-text", 13)}</span>${/^https?:\/\//i.test(r.url || "") ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="grow">${esc(r.title || r.url)}</a>` : `<span class="grow">${esc(r.title || r.id)}</span>`}${(r.files || []).map((f) => `<a class="rsf" href="/media/${d.id}/arastirma/${encodeURIComponent(f)}" target="_blank" title="${esc(f)}">${{ txt: "metin", html: "sayfa", png: "görüntü" }[f.split(".").pop()] || esc(f)}</a>`).join("")}</div>`).join("")}</div>` : ""}
    ${d.project_path ? `<div class="sm muted" style="margin-top:8px" title="${esc(d.project_path)}">${esc(d.project)}</div>` : ""}`);
}

function activityPane(d) {
  const items = d.activity || [];
  if (!items.length) return "";
  return foldPane("activity", "list", "İşlem geçmişi", `${items.length} kayıt`, `<div class="timeline">${items.map((a) => `<div class="tl k-${a.kind}"><span class="tdot"></span><div class="grow">${esc(a.text)}<div class="sm muted">${a.agent ? esc(a.agent) + " · " : ""}${new Date(a.at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${ago(a.at)}</div></div></div>`).join("")}</div>`);
}

function voicePane(d) {
  const name = S.settings.narrator?.name || "";
  const lines = d.voice_lines || [];
  return foldPane("voice", "mic", "Seslendirme", lines.length ? `${lines.length} satır` : "", `
    ${lines.length ? `<div class="lines">${lines.map((l) => `<div class="line"><button class="btn icon sm" data-line="${l.id}" data-snd="line:${d.id}:${l.id}" ${l.audio ? "" : "disabled"} title="Dinle">${ic("play", 13)}</button><span class="tm">${fmtSec(l.start)}</span><span class="grow">${esc(l.text)}</span></div>`).join("")}</div>` : `<div class="muted">${d.status === "sirada" ? "Ajan işe başlayınca metin yazılıp seslendirilecek." : "Henüz seslendirme yok."}</div>`}`, ` <span class="muted sm fold-sub">ElevenLabs · ${esc(name)}</span>`);
}

function captionPane(d) {
  const pending = d.caption_request;
  return foldPane("caption", "message-circle", "Açıklama", (d.caption || "").split("\n")[0], `
    ${d.kind === "story" ? `<div class="sm muted" style="margin-bottom:8px">${ic("info", 13)} Hikâyelerde açıklama görünmez; bu alan sadece not olarak kalır.</div>` : ""}
    <textarea id="cap" rows="5" maxlength="2200" placeholder="Açıklama…">${esc(d.caption || "")}</textarea>
    <input id="tags" style="width:100%;margin-top:8px" placeholder="#hashtag #hashtag" value="${esc(d.hashtags || "")}">
    <div class="row" style="margin-top:9px">
      <span class="counter" id="counter"></span><span class="grow"></span>
      ${pending ? `<span class="sm">${ic("loader-circle", 14, "spin")} ${S.agents.some((a) => a.live !== "off") ? "Ajan açıklama yazıyor…" : "Ajan bağlanınca yazılacak"}</span><button class="btn sm ghost" id="capCancel">İptal</button>`
        : `<input id="capHint" placeholder="İstek (isteğe bağlı): daha kısa, soru ile bitsin…" style="width:260px" class="sm"><button class="btn" id="capGen">${ic("sparkles", 15)}Açıklama üret</button>`}
      <button class="btn primary" id="capSave" disabled>${ic("check", 15)}Kaydet</button>
    </div>`);
}

function defaultSlot() {
  const t = new Date(Date.now() + 60 * 60 * 1000);
  t.setMinutes(0, 0, 0);
  const p = (n) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:00`;
}

function whenValue(d) {
  return S.when?.id === d.id ? S.when.v : (d.schedule || defaultSlot()).slice(0, 16);
}

function afterRenderHtml(d, tg = postTargets(S, d)) {
  const ar = d.after_render;
  const where = targetsReady(S) ? targetsText(tg) : "";
  if (ar?.action) {
    const t = ar.at ? new Date(ar.at) : null;
    return `<div class="sauto on">
      <div class="sp-ic">${ic(ar.action === "publish" ? "send" : "calendar-clock", 18)}</div>
      <div class="grow"><b>${ar.action === "publish" ? "Video bitince hemen paylaşılacak" : `Video bitince ${fmtDate(ar.at)} için planlanacak`}</b>
        <div class="sm">${ar.action === "schedule" && t && relTime(t) ? `${relTime(t)} · ` : ""}Hazır olunca incelemeyi beklemeden otomatik yapılır${where ? ` · ${esc(where)}` : ""}${ar.by ? ` · ${esc(ar.by)}` : ""}</div></div>
      <button class="btn sm" id="arCancel">${ic("x", 14)}İptal</button>
    </div>`;
  }
  return `<div class="sauto">
    <div class="sm muted" style="margin-bottom:8px">${ic("wand-sparkles", 13)} Video henüz hazır değil. Bitince ne olsun?</div>
    <div class="row wrap">
      <button class="btn primary" id="arSched">${ic("calendar-clock", 15)}Video bitince bu saate planla</button>
      <button class="btn ${tg.instagram ? "ig" : "ytonly"}" id="arPub">${ic(tg.instagram ? "send" : "youtube", 15)}Video bitince hemen paylaş</button>
    </div>
    <div class="sm muted" style="margin-top:6px">${tg.instagram ? "Açıklama boşsa ya da Instagram bağlı değilse otomatik paylaşılmaz" : "YouTube bağlı değilse otomatik paylaşılmaz"}; içerik İncelemede bekler ve bildirim gelir. Seçtiğin saat video bitmeden geçerse, video hazır olunca hemen paylaşılır${tg.instagram ? " (6 saate kadar)" : ""}.</div>
  </div>`;
}

function pubTargets() {
  const t = readTargets($("#pubTargets"));
  return t ? { targets: t } : {};
}

function targetsRowHtml(d, tg) {
  if (!targetsReady(S) || d.status === "paylasiliyor") return "";
  const tk = ttOn(d);
  const n = !!tg.instagram + !!tg.youtube + tk;
  const note = !tg.instagram ? (tk ? "YouTube Shorts ve TikTok'ta paylaşılır" : "Yalnızca YouTube Shorts olarak paylaşılır") : n > 1 ? `Aynı saatte ${n === 2 ? "iki" : "üç"} yerde de paylaşılır` : "";
  return `<div class="tgt-row">${targetsHtml(X, tg, { kind: d.kind, id: "pubTargets", post: d })}${note ? `<span class="tgt-note">${esc(note)}</span>` : ""}</div>`;
}

function publishedHtml(d) {
  const pub = d.published;
  const yp = pub.platforms?.youtube;
  if (yp && !pub.id && !pub.permalink && !pub.manual)
    return `<div class="pane"><h3>${ic("youtube", 14)}Paylaşım</h3><div class="row"><span class="grow">${ic("circle-check", 16)} ${yp.state === "private_locked" ? "YouTube'a yüklendi, gizli kaldı" : "YouTube'da paylaşıldı"} · ${fmtDate(pub.at)}</span></div>${ytCardHtml(X, d)}${ttCardHtml(X, d)}</div>`;
  return `<div class="pane"><h3>${ic("instagram", 14)}Paylaşım</h3><div class="row"><span class="grow">${ic("circle-check", 16)} ${pub.manual ? "Elle paylaşıldı" : "Instagram'da yayında"} · ${fmtDate(pub.at)}</span>${pub.permalink ? `<a class="btn" href="${esc(pub.permalink)}" target="_blank">${ic("external-link", 14)}Gönderiyi aç</a>` : ""}</div>${ytCardHtml(X, d)}${ttCardHtml(X, d)}${pub.id ? `<div id="igStats" style="margin-top:12px"><span class="sm muted">${ic("loader-circle", 13, "spin")} Instagram istatistikleri yükleniyor…</span></div>` : ""}</div>`;
}

function publishPane(d) {
  const ig = S.settings.instagram || {};
  if (d.status === "paylasildi" && d.published) return publishedHtml(d);
  const tg = postTargets(S, d);
  const probs = (tg.instagram ? d.problems || [] : []).filter((x) => x !== "video hazır değil");
  const ready = !!(d.video || (d.media || []).length);
  const warn = [];
  if (!ready) warn.push("Video henüz hazır değil");
  probs.forEach((p) => warn.push(p.charAt(0).toUpperCase() + p.slice(1)));
  const planned = d.status === "planlandi";
  const edited = S.when?.id === d.id && S.when.v !== (d.schedule || "").slice(0, 16);
  const shut = planned && S.resched !== d.id && !edited;
  return `<div class="pane"><h3>${ic("calendar-clock", 14)}Paylaşım planı</h3>
    ${planned ? plannedHtml(X, d) : ""}
    ${tg.instagram ? cloudBadgeHtml(X, d) : ""}
    ${d.status === "paylasiliyor" ? `<div class="row" style="margin-bottom:10px">${ic("loader-circle", 15, "spin")} ${esc(d.stage)}</div>` : ""}
    <div id="schedWrap"${shut ? ` class="hidden"` : ""}>${schedulerHtml(X, d, whenValue(d))}</div>
    <input type="hidden" id="when" value="${whenValue(d)}">
    ${targetsRowHtml(d, tg)}
    ${ready ? `<div class="row wrap sactions">
      ${shut ? `<button class="btn" id="reschedBtn">${ic("calendar-clock", 15)}Saati değiştir</button>` : ""}
      <button class="btn primary${shut ? " hidden" : ""}" id="schedBtn" data-ready="1">${ic("calendar-check", 15)}${planned ? "Saati güncelle" : "Bu saate planla"}</button>
      <span class="grow"></span>
      <button class="btn ${tg.instagram ? "ig" : "ytonly"}" id="pubBtn" ${!probs.length && d.status !== "paylasiliyor" ? "" : "disabled"}>${ic(tg.instagram ? "send" : "youtube", 15)}Şimdi paylaş</button>
    </div>` : afterRenderHtml(d, tg)}
    ${warn.length ? `<div class="warns">${warn.map((w) => `<div>${ic("triangle-alert", 13)}${esc(w)}</div>`).join("")}</div>` : ""}
    ${!ig.has_token && tg.instagram ? `<div class="sm muted" style="margin-top:8px">Instagram hesabını <a href="#" id="igLink">Ayarlar</a>'dan bağla.</div>` : ""}
    ${!tg.instagram ? `<div class="sm muted" style="margin-top:8px">Video YouTube'a yüklenince yayını saatinde YouTube kendisi yapar; yüklemeye kadar stüdyonun açık olması yeterli.</div>` : cloudCovers(d) ? "" : `<div class="sm muted" style="margin-top:8px">Planlanan saatte stüdyonun açık olması yeterli (arka planda çalışabilir).</div>`}
    ${ytCardHtml(X, d)}
    ${ttCardHtml(X, d)}
    <details class="manual" id="manualBox"${S.manOpen === d.id ? " open" : ""}><summary>${ic("download", 14)}Elle paylaşım <span class="sm muted">· videoyu ve altyazıyı indir, açıklamayı kopyala, paylaşıldı olarak işaretle</span></summary>
      <div class="row wrap" style="margin-top:8px">
        ${d.video ? `<a class="btn sm" href="/media/${d.id}/${d.video}" download="${esc(d.title)}.mp4">${ic("download", 14)}Videoyu indir</a>` : (d.media || []).length ? d.media.map((f, i) => `<a class="btn sm" href="/media/${d.id}/${encodeURIComponent(f)}" download="${esc(d.title)}-${i + 1}${f.slice(f.lastIndexOf("."))}">${ic("download", 14)}${d.media.length > 1 ? i + 1 : "İndir"}</a>`).join("") : `<button class="btn sm" disabled>${ic("download", 14)}Videoyu indir</button>`}
        ${d.video && d.subs ? `<a class="btn sm" href="/api/posts/${d.id}/altyazi.srt" download="${esc(d.title)}.srt" title="Altyazı dosyası (SRT): YouTube, CapCut ve video oynatıcılar açar">${ic("captions", 14)}Altyazı (.srt)</a><a class="btn sm" href="/api/posts/${d.id}/altyazi.vtt" download="${esc(d.title)}.vtt" title="Altyazı dosyası (WebVTT)">.vtt</a>` : ""}
        <button class="btn sm" id="copyCap">${ic("copy", 14)}Açıklamayı kopyala</button>
        <span class="grow"></span>
        <button class="btn sm" id="manualBtn" ${ready ? "" : "disabled"}>${ic("check", 14)}Elle paylaştım</button>
      </div></details>
  </div>`;
}

function notesPane(d) {
  const msgs = d.messages || [];
  return foldPane("notes", "bot", "Ajana not / revizyon", msgs.length ? `${msgs.length} mesaj` : "", `
    ${msgs.length ? `<div class="msgs" id="msgs">${msgs.map((m) => `<div class="msg ${m.author}"><div class="who">${m.author === "user" ? "Sen" : "Asistan" + (m.agent ? " · " + esc(m.agent) : "")} · ${fmtDate(m.at)}</div>${esc(m.text)}</div>`).join("")}</div>` : `<div class="muted sm" style="margin-bottom:8px">Videoda değişmesini istediğin bir şey varsa yaz; ajan yeniden düzenler.</div>`}
    <div class="row"><textarea id="note" rows="2" placeholder="Örn: girişteki yazı daha büyük olsun, 12. saniyedeki geçiş hızlansın…"></textarea><button class="btn primary" id="noteBtn">${ic("send", 15)}</button></div>`);
}

function updateCounter() {
  const cap = $("#cap");
  if (!cap) return;
  const full = (cap.value.trim() + (($("#tags").value.trim() && "\n\n" + $("#tags").value.trim()) || "")).trim();
  const tags = (full.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  const c = $("#counter");
  c.textContent = `${full.length} / 2200 karakter · ${tags} / 30 hashtag`;
  c.className = "counter" + (full.length > 2200 || tags > 30 ? " over" : "");
  const igcap = $("#igcap");
  if (igcap) igcap.textContent = full || "Açıklama burada görünecek";
}

function bindDetail(d, vstate) {
  const save = guard(async (patch) => {
    S.detail = await api(`/api/posts/${d.id}/update`, patch);
  });
  $("#title").onchange = (e) => save({ title: e.target.value });
  const tb = $("#tplBtn");
  if (tb) tb.onclick = () => saveAsTemplate(X, S.posts.find((p) => p.id === d.id) || d);
  $("#delBtn").onclick = () =>
    trashPost(X, d, () => {
      S.sel = null;
      S.detail = null;
      renderDetail();
    });
  const retry = $("#retryBtn");
  if (retry) retry.onclick = guard(async () => { S.detail = await api(`/api/posts/${d.id}/retry`, {}); renderDetail(); });

  const v = $("#vid");
  if (v) {
    const playIc = () => {
      $("#playBtn").innerHTML = ic(v.paused ? "play" : "pause");
      $("#bigplay")?.classList.toggle("hidden", !v.paused);
    };
    v.onclick = () => (v.paused ? v.play() : v.pause());
    v.onplay = v.onpause = playIc;
    $("#playBtn").onclick = () => (v.paused ? v.play() : v.pause());
    $("#muteBtn").onclick = () => {
      v.muted = !v.muted;
      $("#muteBtn").innerHTML = ic(v.muted ? "x" : "volume-2");
    };
    v.ontimeupdate = () => {
      if (v.duration) $("#seek").value = Math.round((v.currentTime / v.duration) * 1000);
      $("#tcode").textContent = `${fmtSec(v.currentTime)} / ${fmtSec(v.duration || 0)}`;
    };
    $("#seek").oninput = (e) => {
      if (v.duration) v.currentTime = (e.target.value / 1000) * v.duration;
    };
    if (vstate && vstate.src === v.dataset.src) {
      v.currentTime = vstate.t;
      if (!vstate.paused) v.play().catch(() => {});
    }
    const cb = $("#coverBtn");
    if (cb) cb.onclick = () => save({ thumb_offset: Math.round(v.currentTime * 1000) }).then(() => toast("Kapak karesi ayarlandı"));
  }
  const igc = $("#igcap");
  if (igc) igc.onclick = (e) => e.currentTarget.classList.toggle("open");
  const track = $("#carTrack");
  if (track) {
    const n = track.children.length;
    const go = (step) => {
      const i = Math.max(0, Math.min(n - 1, (S.car?.id === d.id ? S.car.i : 0) + step));
      S.car = { id: d.id, i };
      track.style.transform = `translateX(-${i * 100}%)`;
      $("#carN").textContent = `${i + 1}/${n}`;
      $$("#carDots i").forEach((dot, k) => dot.classList.toggle("on", k === i));
    };
    if ($("#carPrev")) {
      $("#carPrev").onclick = () => go(-1);
      $("#carNext").onclick = () => go(1);
    }
  }

  for (const b of $$("[data-line]")) b.onclick = () => playToggle(`/proj/${d.id}/voice/tts/${b.dataset.line}.wav?v=${encodeURIComponent(d.updated)}`, b.dataset.snd);

  const cap = $("#cap");
  const tags = $("#tags");
  const dirty = () => {
    S.dirty = cap.value !== (d.caption || "") || tags.value !== (d.hashtags || "");
    $("#capSave").disabled = !S.dirty;
    updateCounter();
  };
  cap.oninput = tags.oninput = dirty;
  updateCounter();
  $("#capSave").onclick = guard(async () => {
    S.detail = await api(`/api/posts/${d.id}/update`, { caption: cap.value, hashtags: tags.value });
    S.dirty = false;
    renderDetail();
    toast("Açıklama kaydedildi");
  });
  const gen = $("#capGen");
  if (gen)
    gen.onclick = guard(async () => {
      if (S.dirty) await api(`/api/posts/${d.id}/update`, { caption: cap.value, hashtags: tags.value });
      S.dirty = false;
      S.detail = await api(`/api/posts/${d.id}/caption-request`, { hint: $("#capHint").value });
      renderDetail();
      toast("Açıklama isteği ajana gönderildi");
    });
  const cc = $("#capCancel");
  if (cc) cc.onclick = guard(async () => { S.detail = await api(`/api/posts/${d.id}/caption-cancel`, {}); renderDetail(); });

  const resched = $("#reschedBtn");
  if (resched)
    resched.onclick = () => {
      S.resched = d.id;
      $("#schedWrap")?.classList.remove("hidden");
      $("#schedBtn")?.classList.remove("hidden");
      resched.remove();
    };
  const mbox = $("#manualBox");
  if (mbox) mbox.ontoggle = () => (S.manOpen = mbox.open ? d.id : null);
  const sched = $("#schedBtn");
  if (sched)
    sched.onclick = guard(async () => {
      if (S.dirty) {
        await api(`/api/posts/${d.id}/update`, { caption: cap.value, hashtags: tags.value });
        S.dirty = false;
      }
      S.detail = await api(`/api/posts/${d.id}/schedule`, { at: $("#when").value, ...pubTargets() });
      S.when = null;
      S.resched = null;
      renderDetail();
      toast(`Planlandı: ${fmtDate(S.detail.schedule)}${S.detail.targets && targetsReady(S) ? ` · ${targetsText(postTargets(S, S.detail), S.detail)}` : ""}`);
    });
  bindScheduler(X, d);
  const tgRow = $("#pubTargets");
  if (tgRow)
    tgRow.addEventListener("tgchange", (e) => {
      const { value, before } = e.detail;
      const send = guard(async () => {
        setTargets(tgRow, value);
        tgRow.classList.add("busy");
        try {
          S.detail = await api(`/api/posts/${d.id}/targets`, value);
          renderDetail();
          await poll();
        } catch (err) {
          setTargets(tgRow, before);
          throw err;
        } finally {
          tgRow.classList.remove("busy");
        }
      });
      confirmYtRemoval(X, d, value, send, () => setTargets(tgRow, before));
    });
  const arSave = (body, msg) =>
    guard(async () => {
      S.detail = await api(`/api/posts/${d.id}/after-render`, body);
      renderDetail();
      toast(msg);
    });
  const arS = $("#arSched");
  if (arS) arS.onclick = () => arSave({ action: "schedule", at: $("#when").value, ...pubTargets() }, "Video bitince planlanacak")();
  const arP = $("#arPub");
  if (arP)
    arP.onclick = () => {
      const t = pubTargets();
      const ytOnly = t.targets?.instagram === false;
      confirmDialog("Video bitince hemen paylaşılsın mı?", `Video hazır olduğunda <b>incelemeni beklemeden</b> ${esc(t.targets ? targetsText(t.targets) : "Instagram")}'da yayınlanacak.${ytOnly ? "" : " Açıklama boşsa paylaşılmaz."}`, "Evet, otomatik paylaş", arSave({ action: "publish", ...t }, "Video bitince hemen paylaşılacak"));
    };
  const arC = $("#arCancel");
  if (arC) arC.onclick = arSave({ action: "" }, "Otomatik işlem iptal edildi");
  const un = $("#unschedBtn");
  if (un) un.onclick = guard(async () => { S.detail = await api(`/api/posts/${d.id}/unschedule`, {}); renderDetail(); });
  const pub = $("#pubBtn");
  if (pub)
    pub.onclick = () => {
      const t = pubTargets();
      const where = t.targets ? targetsText(t.targets) : "Instagram";
      const kindName = KIND_LABEL[d.kind || "reels"] || "Paylaşım";
      confirmDialog("Şimdi paylaşılsın mı?", `Bu ${esc(kindName)} hemen <b>${esc(where)}</b>'da yayınlanacak. Bu işlem geri alınamaz.<div class="help" style="white-space:pre-wrap">${esc(d.caption_full)}</div>`, "Paylaş", guard(async () => {
        if (S.dirty) {
          await api(`/api/posts/${d.id}/update`, { caption: cap.value, hashtags: tags.value });
          S.dirty = false;
        }
        S.detail = await api(`/api/posts/${d.id}/publish`, t);
        renderDetail();
        toast(t.targets?.instagram === false ? "YouTube'a yükleniyor; yüklenince hemen yayınlanır" : "Paylaşım başladı");
      }));
    };
  const copy = $("#copyCap");
  if (copy)
    copy.onclick = guard(async () => {
      const full = (cap.value.trim() + (tags.value.trim() ? "\n\n" + tags.value.trim() : "")).trim();
      await navigator.clipboard.writeText(full);
      toast("Açıklama panoya kopyalandı");
    });
  const manual = $("#manualBtn");
  if (manual)
    manual.onclick = () =>
      modal(`<h2>${ic("check", 20)}Elle paylaşıldı olarak işaretle</h2><div>Gönderiyi kendin paylaştıysan işaretle; takvimde paylaşıldı görünür.</div><label>Gönderi bağlantısı (isteğe bağlı)</label><input id="mLink" placeholder="https://www.instagram.com/reel/…"><div class="foot"><button class="btn" data-close>Vazgeç</button><button class="btn primary" id="mOk">İşaretle</button></div>`, (m) => {
        $("#mOk", m).onclick = guard(async () => {
          S.detail = await api(`/api/posts/${d.id}/manual`, { link: $("#mLink", m).value });
          closeModal();
          renderDetail();
          toast("Paylaşıldı olarak işaretlendi");
        });
      });
  const igl = $("#igLink");
  if (igl) igl.onclick = (e) => { e.preventDefault(); openSettings("instagram"); };

  const noteBtn = $("#noteBtn");
  if (noteBtn) noteBtn.onclick = guard(async () => {
    const t = $("#note").value.trim();
    if (!t) return;
    S.detail = await api(`/api/posts/${d.id}/message`, { text: t });
    renderDetail();
    toast("Not ajana iletildi");
  });
  const msgs = $("#msgs");
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// ---------- dialogs ----------

function modal(html, onReady, cls = "") {
  const m = $("#modal");
  m.innerHTML = `<div class="dialog ${cls}">${html}</div>`;
  m.classList.remove("hidden");
  hydrate(m);
  m.onclick = (e) => {
    if (e.target === m) closeModal();
  };
  for (const b of $$("[data-close]", m)) b.onclick = closeModal;
  onReady?.(m);
}
function closeModal() {
  $("#modal").classList.add("hidden");
  $("#modal").innerHTML = "";
}
function confirmDialog(title, body, okText, onOk) {
  modal(`<h2>${title}</h2><div>${body}</div><div class="foot"><button class="btn" data-close>Vazgeç</button><button class="btn primary" id="okBtn">${okText}</button></div>`, (m) => {
    $("#okBtn", m).onclick = async () => {
      closeModal();
      await onOk();
    };
  });
}

const EL_PERMS = [["Text to Speech", "Access", "seslendirme üretmek"], ["Voices", "Read", "ses listesi ve örnek dinleme"], ["User", "Read", "kalan kredi göstergesi"]];
const IG_PERMS = [["instagram_basic", "profil, paylaşımlar, hesap bilgisi"], ["instagram_content_publish", "Reels, fotoğraf, kaydırmalı ve hikâye paylaşmak"],
  ["instagram_manage_comments", "yorumları okumak, yanıtlamak, gizlemek, silmek; etiketlenmeler"], ["instagram_manage_messages", "DM okumak ve yanıtlamak"],
  ["instagram_manage_insights", "görüntülenme, erişim, izlenme süresi istatistikleri"]];

function permTable(rows) {
  return `<table class="perm">${rows.map((r) => `<tr>${r.map((c, i) => `<td>${i === 0 ? `<code>${esc(c)}</code>` : esc(c)}</td>`).join("")}</tr>`).join("")}</table>`;
}

async function openSettings(section) {
  const st = S.settings;
  const ig = st.instagram || {};
  const n = st.narrator || {};
  const dot = (on, warn) => `<i class="st-dot ${on ? "ok" : warn ? "warn" : ""}"></i>`;
  const cl = S.cloud || {};
  const tabs = [
    ["sKanal", "Kanal", "user", "", ""],
    ["sNotify", "Bildirimler", "bell", "", ""],
    ["sVoiceSet", "Seslendirme", "mic", "ElevenLabs", dot(st.elevenlabs?.has_key, true)],
    ["sIg", "Instagram", "instagram", ig.has_token && ig.username ? `@${esc(ig.username)}` : "Bağlı değil", dot(ig.has_token && ig.username)],
    ["sYt", "YouTube", "youtube", S.youtube?.connected ? esc(S.youtube.channel_title || "Bağlı") : "Bağlı değil", dot(S.youtube?.connected, S.youtube?.needs_reconnect)],
    ["sTt", "TikTok", "music", ttTabSub(S), dot(S.tiktok?.logged_in === true, S.tiktok?.logged_in === false)],
    ["sCloud", "Bulut yayın", "cloud", "Cloudflare", dot(cl.configured && cl.enabled, cl.configured)],
    ["sLook", "Görünüm", "palette", "Tema ve efektler", ""],
    updateSettingsTab(),
    componentsTab(),
  ];
  modal(`<div class="st-head"><h2>${ic("settings", 20)}Ayarlar</h2></div>
    <div class="st-wrap"><nav class="st-nav" id="stNav">${tabs.map(([id, t, icon, sub, d]) => `<button type="button" class="st-tab" data-st="${id}">${ic(icon, 16)}<span class="grow"><b>${t}</b>${sub ? `<small>${sub}</small>` : ""}</span>${d}</button>`).join("")}</nav>
    <div class="st-body" id="stBody">
    <fieldset id="sKanal"><legend>Kanal</legend>
      <label>Profil fotoğrafı (önizlemede görünür)</label>
      <div class="row"><span class="avatar big" style="${st.avatar ? `background-image:url('${st.avatar}')` : ""}">${st.avatar ? "" : esc((st.channel || "K")[0].toUpperCase())}</span>
        <label class="btn">${ic("upload", 15)}${st.avatar ? "Değiştir" : "Fotoğraf yükle"}<input type="file" id="sAvatar" accept="image/*" hidden></label>
        ${st.avatar ? `<button class="btn ghost" id="sAvatarDel">Kaldır</button>` : ""}<span class="sm muted">Instagram bağlanınca oradaki fotoğraf da alınır.</span></div>
      <label>Kullanıcı adı (önizlemede ve video sonunda görünür)</label><input id="sChannel" placeholder="kullaniciadi" value="${esc(st.channel || "")}">
      <label>Görünen ad</label><input id="sName" placeholder="Marka ya da isim" value="${esc(st.display_name || "")}">
      <label>Varsayılan hashtag'ler (yeni içeriklere eklenir)</label><input id="sTags" value="${esc(st.default_hashtags || "")}">
      ${targetsReady(S) ? `<label>Varsayılan paylaşım yerleri (yeni planlarda seçili gelir)</label>${targetsHtml(X, defaultTargets(S), { label: false, id: "sTargets", cls: "st-tgt" })}<div class="sm muted" style="margin-top:6px">Her içerikte ya da planlarken ayrıca değiştirebilirsin. YouTube seçimi, YouTube ayarlarındaki otomatik Shorts seçeneğiyle aynıdır.</div>` : ""}
    </fieldset>
    ${notifySettingsHtml(X, S.notify_settings || { enabled: true, kinds: {} })}
    <fieldset id="sVoiceSet"><legend>Seslendirme (ElevenLabs)</legend>
      ${elAccountsHtml(X)}
      <details class="help"><summary><b>Anahtar nasıl alınır, hangi izinler gerekir?</b></summary> elevenlabs.io › Developers › API Keys › Create API Key. "Restrict Key" açıksa şu üçünü aç, diğerleri "No Access" kalabilir:
        ${permTable(EL_PERMS)}Kısıtlama kapalıysa anahtar zaten her şeye erişir. "Credit limit" boş kalabilir ya da aylık harcama sınırı yazılabilir. Her hesap için kendi anahtarını oluşturup yukarıya ayrı ayrı ekle.</details>
      <div class="sm muted" style="margin-top:8px">Tüm videolarda aynı anlatıcı kullanılır.</div>
      <label>Ses</label>
      <input type="hidden" id="sVoice" value="${esc(n.voice_id || "")}">
      <div class="seg sm vtabs" id="sVoiceTabs"><button type="button" data-vt="fav">Favoriler</button><button type="button" data-vt="free">Ücretsiz sesler</button><button type="button" data-vt="paid">Ücretli plan sesleri</button></div>
      <div class="vlist" id="sVoiceList"><div class="muted sm" style="padding:10px">Sesler yükleniyor…</div></div>
      <div id="sVoiceWarn"></div>
      <label>Model</label><select id="sModel"><option value="eleven_v3">Eleven v3 (en doğal, duygulu)</option><option value="eleven_multilingual_v2">Multilingual v2 (daha tutarlı)</option></select>
      <label>Kararlılık</label><select id="sStab"><option value="0">Yaratıcı</option><option value="0.5">Doğal</option><option value="1">Sağlam</option></select>
      <label>Konuşma hızı <b id="sSpeedV"></b></label>
      <div class="row"><span class="sm muted">Yavaş</span><input type="range" id="sSpeed" min="0.7" max="1.2" step="0.05" class="grow"><span class="sm muted">Hızlı</span></div>
      <div class="sm muted">Yeni seslendirmelerde geçerli olur. Hazır videolar değişmez.</div>
    </fieldset>
    <fieldset id="sIg"><legend>Instagram</legend>
      ${ig.has_token && ig.username ? `<div class="ig-card" id="sIgCard"><span class="ig-av" style="${st.avatar ? `background-image:url('${st.avatar}')` : ""}">${st.avatar ? "" : esc(ig.username[0].toUpperCase())}</span>
        <div class="grow"><b>@${esc(ig.username)}</b><span id="sIgSub">Instagram hesabı</span></div><span class="ig-ok">${ic("circle-check", 13)}Bağlı</span></div>`
        : `<div class="ig-card off">${ic("instagram", 20)}<div class="grow"><b>Instagram bağlı değil</b><span>Aşağıdaki adımlarla erişim anahtarını oluşturup bağla.</span></div></div>`}
      <label>Erişim anahtarı (access token)</label>
      <div class="row"><input id="sToken" type="password" class="grow" placeholder="${ig.has_token ? "Kayıtlı (değiştirmek için yenisini yapıştır)" : "EAA… ile başlayan anahtar"}" autocomplete="off"><button class="btn" id="sTest">${ic("plug", 15)}Bağlan</button>${ig.has_token ? `<button class="btn ghost" id="sDisc">Kes</button>` : ""}</div>
      <div class="row" style="margin-top:8px">${claudeSetupBtn("instagram")}<span class="sm muted">Adımları Claude'la birlikte yap; anahtarı yine buraya sen yapıştırırsın.</span></div>
      <div class="help"><b>Gereken Meta izinleri</b>${ig.has_token ? ` <span id="sPermState" class="sm">kontrol ediliyor…</span>` : ""}
        <table class="perm" id="sPerms">${IG_PERMS.map(([k, t]) => `<tr data-perm="${k}"><td><code>${k}</code></td><td>${esc(t)}</td><td class="pst"></td></tr>`).join("")}</table>
        <b>Nasıl bağlanır?</b><ol>
        <li>Instagram hesabını <b>Profesyonel</b> (İşletme ya da İçerik üreticisi) yap.</li>
        <li><a href="https://business.facebook.com/settings" target="_blank">business.facebook.com</a> → İşletme portföyü → <b>Hesaplar › Instagram hesapları</b> → hesabını ekle (doğrulama isteyebilir).</li>
        <li><a href="https://developers.facebook.com/apps" target="_blank">developers.facebook.com/apps</a> → Uygulama oluştur (İşletme türü, aynı portföy) → <b>Instagram</b> ürünü → "API setup with Facebook login".</li>
        <li><b>Facebook Login for Business › Yapılandırmalar</b> → yeni yapılandırma: anahtar türü <b>Sistem kullanıcısı</b>, süre <b>Hiçbir zaman dolmaz</b>, izinler: yukarıdaki beş izin.</li>
        <li>İşletme ayarları → <b>Kullanıcılar › Sistem kullanıcıları</b> → yönetici sistem kullanıcısı → uygulamayı ve Instagram hesabını varlık olarak ata → <b>Anahtar oluştur</b> → bu yapılandırmayı seç.</li>
        <li>Çıkan anahtarı buraya yapıştır, <b>Bağlan</b>'a bas. Bu anahtarın süresi dolmaz.</li>
      </ol><b>DM için ayrıca</b> telefonda Instagram → Ayarlar ve hareketler → Mesajlar ve hikâye yanıtları → Mesaj kontrolleri → Bağlı araçlar → <b>Mesajlara erişime izin ver</b>.
      <div style="margin-top:6px">Anahtar yalnızca bu bilgisayarda (settings.json) saklanır.</div></div>
    </fieldset>
    ${ytSettingsHtml(X)}
    ${ttSettingsHtml(X)}
    ${cloudSettingsHtml(X)}
    ${themeSettingsHtml(X)}
    ${updateSettingsHtml()}
    ${componentsSettingsHtml()}
    </div></div>
    <div class="foot"><button class="btn" data-close>Kapat</button><button class="btn primary" id="sSave">${ic("check", 15)}Kaydet</button></div>`, async (m) => {
    const SECTION_TAB = { notify: "sNotify", cloud: "sCloud", youtube: "sYt", "youtube-audit": "sYt", "youtube-kit": "sYt", tiktok: "sTt", voice: "sVoiceSet", instagram: "sIg", channel: "sKanal", look: "sLook" };
    const showTab = (id) => {
      if (!$("#" + id, m)) id = "sKanal";
      for (const f of $$("#stBody > fieldset", m)) f.classList.toggle("on", f.id === id);
      for (const b of $$("#stNav [data-st]", m)) b.classList.toggle("on", b.dataset.st === id);
      $("#stBody", m).scrollTop = 0;
      try {
        localStorage.setItem("sosyal-settings-tab", id);
      } catch {}
    };
    let first = SECTION_TAB[section];
    if (!first)
      try {
        first = localStorage.getItem("sosyal-settings-tab");
      } catch {}
    showTab(first || "sKanal");
    bindThemeSettings(m);
    $("#stNav", m).onclick = (e) => {
      const b = e.target.closest("[data-st]");
      if (b) showTab(b.dataset.st);
    };
    if (ig.has_token && ig.username)
      api("/api/ig/profile").then((res) => {
        const card = $("#sIgCard", m);
        const pr = res?.data || res;
        if (!card || !pr || pr.error || res?.ok === false) return;
        if (pr.profile_picture_url) {
          const av = $(".ig-av", card);
          av.style.backgroundImage = `url('${pr.profile_picture_url}')`;
          av.textContent = "";
        }
        const bits = [pr.name, pr.followers_count != null ? `${Number(pr.followers_count).toLocaleString("tr-TR")} takipçi` : "", pr.media_count != null ? `${pr.media_count} gönderi` : ""].filter(Boolean);
        if (bits.length) $("#sIgSub", card).textContent = bits.join(" · ");
      }).catch(() => {});
    $("#sAvatar", m).onchange = guard(async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = await fetch("/api/avatar", { method: "POST", headers: { "X-Filename": encodeURIComponent(f.name) }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "yükleme hatası");
      S.settings = j;
      toast("Profil fotoğrafı güncellendi");
      openSettings();
      renderDetail();
    });
    const avDel = $("#sAvatarDel", m);
    if (avDel)
      avDel.onclick = guard(async () => {
        S.settings = await api("/api/avatar/delete", {});
        openSettings();
        renderDetail();
      });
    const getNotify = bindNotifySettings(X, m);
    let tgDirty = false;
    m.addEventListener("tgchange", (e) => {
      if (e.target.id === "sTargets") tgDirty = true;
    });
    if (section === "notify") $("#sNotify", m).scrollIntoView({ block: "start" });
    bindCloudSettings(X, m, section);
    bindYtSettings(X, m, section);
    bindTtSettings(X, m, section);
    bindUpdateSettings(X, m);
    bindComponentsSettings(X, m, section);
    const sp = $("#sSpeed", m);
    sp.value = String(n.speed ?? 1);
    const spv = () => ($("#sSpeedV", m).textContent = `${Number(sp.value).toFixed(2).replace(".", ",")}x`);
    sp.oninput = spv;
    spv();
    $("#sModel", m).value = n.model || "eleven_v3";
    $("#sStab", m).value = String(n.stability ?? 0.5);
    let voices = [];
    let freePlan = false;
    let groups = { free: [], paid: [] };
    const loadVoices = async (fresh) => {
      try {
        voices = await api(`/api/voices${fresh ? "?fresh=1" : ""}`);
        if (voices.error) throw new Error(voices.error);
        voices.sort((a, b) => (/turk|istanbul/i.test(b.info + b.name) - /turk|istanbul/i.test(a.info + a.name)) || a.name.localeCompare(b.name));
      } catch (e) {
        voices = [];
      }
      freePlan = S.credits?.plan === "free";
      groups = { free: voices.filter((v) => v.category === "premade"), paid: voices.filter((v) => v.category !== "premade") };
    };
    await loadVoices(false);
    let favs = (S.settings.voice_favorites || []).filter((id) => !voices.length || voices.some((v) => v.id === id));
    const favList = () => favs.map((id) => voices.find((v) => v.id === id)).filter(Boolean);
    let vtab = favs.length ? "fav" : groups.paid.some((v) => v.id === n.voice_id) && !freePlan ? "paid" : "free";
    let audio = null;
    let playing = null;
    const drawVoices = () => {
      const sel = $("#sVoice", m).value;
      for (const b of $$("#sVoiceTabs [data-vt]", m)) {
        const k = b.dataset.vt;
        b.classList.toggle("active", k === vtab);
        b.innerHTML = k === "fav" ? `${ic("star", 13)} Favoriler (${favs.length})` : k === "free" ? `${ic("circle-check", 13)} Ücretsiz planda çalışanlar (${groups.free.length})` : `${ic(freePlan ? "lock" : "library", 13)} ${freePlan ? "Creator+ plan gerekir" : "Kütüphane sesleri"} (${groups.paid.length})`;
      }
      const isLocked = (v) => freePlan && v.category !== "premade";
      const locked = vtab === "paid" && freePlan;
      const list = vtab === "fav" ? favList() : groups[vtab];
      $("#sVoiceList", m).innerHTML = !voices.length
        ? `<div class="muted sm" style="padding:10px">${S.settings.elevenlabs?.has_key ? "Ses listesi alınamadı." : "Önce ElevenLabs API anahtarını kaydet."}</div>`
        : vtab === "fav" && !list.length ? `<div class="vnote">${ic("star", 13)} Henüz favori ses yok. Beğendiğin sesin yanındaki yıldıza bas; burada toplanır.</div>`
        : `${vtab === "free" ? `<div class="vnote">${ic("info", 13)} ElevenLabs'in hazır sesleri: her planda çalışır, hepsi Türkçe konuşabilir (vurgu sese göre biraz değişir).</div>` : locked ? `<div class="vnote warnv">${ic("lock", 13)} Bağlı hesap ücretsiz planda: bu sesler ancak Creator ve üstü plan anahtarıyla çalışır.</div>` : ""}
          ${list.map((v) => `<div class="vrow ${v.id === sel ? "sel" : ""} ${isLocked(v) ? "locked" : ""}" data-v="${v.id}">
            <button type="button" class="btn icon sm" data-play="${v.id}" title="Örnek dinle">${ic(playing === v.id ? "square" : "play", 13)}</button>
            <div class="grow"><b>${esc(v.name.split(" - ")[0])}</b><div class="sm muted">${esc([v.name.split(" - ")[1], v.info, v.gender].filter(Boolean).join(" · "))}</div></div>
            ${isLocked(v) ? `<span class="badge">${ic("lock", 11)} Creator+</span>` : v.id === sel ? `<span class="vsel">${ic("circle-check", 16)} Seçili</span>` : ""}
            <button type="button" class="vfav ${favs.includes(v.id) ? "on" : ""}" data-fav="${v.id}" title="${favs.includes(v.id) ? "Favorilerden çıkar" : "Favorilere ekle"}">${ic("star", 16)}</button></div>`).join("")}`;
      const cur = groups.paid.find((v) => v.id === sel);
      $("#sVoiceWarn", m).innerHTML = cur && freePlan ? `<div class="fix" style="margin-top:8px">${ic("triangle-alert", 18)}<div><b>Seçili ses (${esc(cur.name.split(" - ")[0])}) bu anahtarla çalışmaz</b><p>ElevenLabs hesabın ücretsiz planda. "Ücretsiz planda çalışanlar" sekmesinden bir ses seç ya da Creator ve üstü bir planın anahtarını gir.</p></div></div>` : "";
    };
    $("#sVoiceTabs", m).onclick = (e) => {
      const b = e.target.closest("[data-vt]");
      if (!b) return;
      vtab = b.dataset.vt;
      drawVoices();
    };
    $("#sVoiceList", m).onclick = async (e) => {
      const fav = e.target.closest("[data-fav]");
      if (fav) {
        const id = fav.dataset.fav;
        const on = !favs.includes(id);
        favs = on ? [...favs, id] : favs.filter((x) => x !== id);
        drawVoices();
        try {
          S.settings = await api("/api/settings", { voice_favorites: favs });
          toast(on ? "Favorilere eklendi" : "Favorilerden çıkarıldı");
        } catch (err) {
          toast(err.message, true);
        }
        return;
      }
      const pl = e.target.closest("[data-play]");
      if (pl) {
        const v = voices.find((x) => x.id === pl.dataset.play);
        audio?.pause();
        if (playing === v.id) playing = null;
        else if (v?.preview) {
          audio = new Audio(v.preview);
          const done = () => {
            if (playing !== v.id) return;
            playing = null;
            drawVoices();
          };
          audio.onended = done;
          audio.onpause = done;
          audio.play();
          playing = v.id;
        }
        return drawVoices();
      }
      const row = e.target.closest("[data-v]");
      if (!row || row.classList.contains("locked")) return;
      $("#sVoice", m).value = row.dataset.v;
      drawVoices();
    };
    drawVoices();
    bindElAccounts(X, m, async () => {
      await loadVoices(true);
      drawVoices();
    });
    if (ig.has_token)
      api("/api/instagram/permissions").then((r) => {
        const state = $("#sPermState", m);
        if (!state) return;
        if (!r.granted) return (state.textContent = r.error ? "kontrol edilemedi" : "");
        const missing = IG_PERMS.filter(([k]) => !r.granted.includes(k));
        state.innerHTML = missing.length ? `<span class="bad">${missing.length} izin eksik, anahtarı bu izinlerle yeniden oluştur</span>` : `<span class="ok">bağlı anahtarda hepsi var</span>`;
        for (const row of $$("[data-perm]", m))
          row.querySelector(".pst").innerHTML = r.granted.includes(row.dataset.perm) ? `<span class="ok">${ic("circle-check", 14)}</span>` : `<span class="bad">${ic("circle-x", 14)}</span>`;
      }).catch(() => {});
    $("#sTest", m).onclick = guard(async () => {
      const me = await api("/api/instagram/test", { token: $("#sToken", m).value.trim() });
      toast(`Bağlandı: @${me.username}`);
      await poll();
      openSettings();
    });
    const disc = $("#sDisc", m);
    if (disc) disc.onclick = guard(async () => { await api("/api/instagram/disconnect", {}); await poll(); openSettings(); });
    $("#sSave", m).onclick = guard(async () => {
      const vid = $("#sVoice", m).value;
      const v = voices.find((x) => x.id === vid);
      await api("/api/settings", {
        channel: $("#sChannel", m).value.replace(/^@/, "").trim(),
        display_name: $("#sName", m).value.trim(),
        default_hashtags: $("#sTags", m).value.trim(),
        ...(tgDirty && $("#sTargets", m) ? { default_targets: readTargets($("#sTargets", m)) } : {}),
        narrator: { voice_id: vid, name: v ? v.name.split(" - ")[0].trim() : vid ? n.name : "", model: $("#sModel", m).value, stability: parseFloat($("#sStab", m).value), speed: parseFloat($("#sSpeed", m).value) },
        notifications: getNotify(),
      });
      closeModal();
      toast("Ayarlar kaydedildi");
      await poll();
    });
  }, "settings");
}

// ---------- calendar ----------

function renderCalendar() {
  renderPlanner(X);
}

// ---------- wiring ----------

function select(id) {
  if (S.dirty && !confirm("Kaydedilmemiş açıklama değişikliği var. Yine de geçilsin mi?")) return;
  S.dirty = false;
  S.sel = id;
  S.detail = null;
  S.sig = "";
  renderList();
  loadDetail(id).catch((e) => toast(e.message, true));
  location.hash = id;
}
function setTab(tab) {
  S.tab = tab;
  for (const b of $$(".tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
  const was = S.shownTab || "posts";
  S.shownTab = tab;
  for (const v of ["posts", "create", "ideas", "browser", "auto", "account", "calendar", "ai"]) $(`#${v}View`).classList.toggle("hidden", tab !== v);
  if (was && was !== tab) {
    const view = $(`#${tab}View`);
    view.classList.remove("enter");
    void view.offsetWidth;
    view.classList.add("enter");
  }
  if (tab === "account") renderAccount(X).catch((e) => toast(e.message, true));
  if (tab === "calendar") renderCalendar();
  if (tab === "browser") openBrowser(X);
  if (tab === "create") loadTemplates().then(() => renderCreate(X));
  if (tab === "ai") renderAI(X);
  if (tab === "ideas") loadTemplates().then(() => syncIdeas(true)).catch((e) => toast(e.message, true));
  if (tab === "auto") loadTemplates().then(() => { if (S.tab === "auto") renderAutopilot(X); }).catch((e) => toast(e.message, true));
}

const X = { S, ic, esc, api, toast, guard, setTab, toDesktop: (p) => toDesktop(p), select: (id) => select(id), refresh: () => poll(), closeModal: () => closeModal(), confirm: (...a) => confirmDialog(...a), modal: (...a) => modal(...a), openSettings: (s) => openSettings(s) };

hydrate();
$("#newBtn").onclick = () => setTab("create");
$("#upBtn").onclick = () => openComposer(X);
$("#ideaBtn").onclick = () => {
  setTab("ideas");
  setTimeout(() => $("#iTopic")?.focus(), 50);
};
$("#liveBtn").onclick = () => toggleLive(X, { claude: () => toggleClaudePanel(X), cloud: () => openCloud(X) });
document.addEventListener("paste", (e) => X.onPaste?.(e));
$("#settingsBtn").onclick = () => openSettings();
$("#bellBtn").onclick = () => toggleBellPanel(X);
$("#claudeChip").onclick = () => toggleClaudePanel(X);
$("#cloudChip").onclick = () => openCloud(X);
$("#igchip").onclick = () => openSettings("instagram");
$("#credits").onclick = () => openSettings("voice");
initStatus(X);
applyTheme();
initOturum(X);
initClaudeSetup(X);
initUpdate(X);
initComponents(X);
initContextMenu(X, {
  open: (id) => {
    if (S.tab !== "posts") setTab("posts");
    select(id);
  },
  trash: (p) => trashPost(X, p, () => { if (S.sel === p.id) { S.sel = null; S.detail = null; renderDetail(); } }),
  settings: () => openSettings(),
  foldAll: (on) => {
    for (const p of $$("#detail .pane[data-fold]")) {
      p.classList.toggle("folded", on);
      setFold(p.dataset.fold, on);
    }
  },
});
$("#detail").addEventListener("click", (e) => {
  const h = e.target.closest(".pane[data-fold] > h3");
  if (!h || e.target.closest("button, a, input")) return;
  const p = h.parentElement;
  const on = !p.classList.contains("folded");
  p.classList.toggle("folded", on);
  setFold(p.dataset.fold, on);
});
for (const b of $$(".tabs button")) b.onclick = () => setTab(b.dataset.tab);
$("#filters").onclick = (e) => {
  const f = e.target.closest("[data-f]");
  if (!f) return;
  S.filter = f.dataset.f;
  S.sig = "";
  renderList();
};
$("#postList").onclick = (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    const p = S.posts.find((x) => x.id === del.dataset.del);
    if (p) trashPost(X, p, () => { if (S.sel === p.id) { S.sel = null; S.detail = null; renderDetail(); } });
    return;
  }
  const c = e.target.closest(".card");
  if (c) select(c.dataset.id);
};
$("#trashBtn").onclick = () => openTrash(X);
document.addEventListener("tkchange", (e) => {
  if (S.detail && S.detail.id === e.detail?.pid) renderDetail();
});
initSound(X);
document.addEventListener("keydown", (e) => e.key === "Escape" && closeModal());
async function syncPrefs() {
  const own = (k) => k.startsWith("sosyal") && !k.startsWith("sosyal-ui-");
  try {
    if (!window.studioShell) {
      if (localStorage.getItem("sosyal-ui-pushed")) return;
      const prefs = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (own(k)) prefs[k] = localStorage.getItem(k);
      }
      if (!Object.keys(prefs).length) return;
      await api("/api/uiprefs", { prefs });
      localStorage.setItem("sosyal-ui-pushed", "1");
      return;
    }
    const d = await api("/api/uiprefs");
    if (!d.updated || String(d.updated) === localStorage.getItem("sosyal-ui-pulled")) return;
    let changed = false;
    for (const [k, v] of Object.entries(d.prefs || {})) {
      if (own(k) && localStorage.getItem(k) !== v) {
        localStorage.setItem(k, v);
        changed = true;
      }
    }
    localStorage.setItem("sosyal-ui-pulled", String(d.updated));
    if (changed) location.reload();
  } catch {}
}
async function toDesktop(page = "") {
  await syncPrefs();
  await api("/api/desktop/open", { page });
  window.close();
  setTimeout(() => {
    if (document.getElementById("handoff")) return;
    const d = document.createElement("div");
    d.id = "handoff";
    d.innerHTML = `<div class="handoff-card">${ic("monitor", 30)}<b>Stüdyo masaüstü penceresinde açık</b><span>Her şey orada devam ediyor; bu pencereyi kapatabilirsin.</span><button class="btn primary">${ic("external-link", 15)}Masaüstü penceresine geç</button></div>`;
    d.querySelector("button").onclick = () => api("/api/desktop/open", {}).catch(() => {});
    document.body.appendChild(d);
  }, 400);
}
async function preferDesktop() {
  if (window.studioShell || location.hostname !== "127.0.0.1") return;
  try {
    if ((await api("/api/desktop")).installed) await toDesktop(location.hash === "#tarayici" ? "tarayici" : "");
  } catch {}
}
syncPrefs().then(preferDesktop);
window.addEventListener("focus", () => {
  if (window.studioShell) syncPrefs();
});
function settingsRoute() {
  const m = /^#ayarlar(?:\/([\w-]+))?\/?$/.exec(location.hash);
  if (!m) return false;
  history.replaceState(null, "", location.pathname + location.search + (S.sel ? `#${S.sel}` : ""));
  openSettings(m[1]);
  return true;
}
window.addEventListener("hashchange", () => {
  if (settingsRoute()) return;
  const id = location.hash.slice(1);
  if (id === "tarayici") {
    history.replaceState(null, "", location.pathname + location.search);
    setTab("browser");
    return;
  }
  if (/^F\d+$/.test(id) && S.ideas.some((b) => b.id === id)) {
    loadBatch(X, id).then(() => setTab("ideas"));
    return;
  }
  if (!id || !S.posts.some((p) => p.id === id)) return;
  if (S.tab !== "posts") setTab("posts");
  if (id !== S.sel) select(id);
});
renderDetail();
await poll();
if (location.hash === "#tarayici") {
  history.replaceState(null, "", location.pathname + location.search);
  setTab("browser");
} else if (!settingsRoute() && location.hash.slice(1) && S.posts.some((p) => p.id === location.hash.slice(1))) select(location.hash.slice(1));
setInterval(poll, 2000);
