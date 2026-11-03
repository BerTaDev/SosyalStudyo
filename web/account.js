import { ago } from "/web/views.js";
import { engageHtml } from "/web/engage.js";
import { claudeSetupBtn } from "/web/claudesetup.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const nf = (v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR"));
const TABS = [["posts", "Paylaşımlar", "layout-grid"], ["comments", "Yorumlar", "message-circle"], ["dms", "Mesajlar", "send"], ["tags", "Etiketlenmeler", "at-sign"],
  ["stats", "İstatistikler", "list-checks"], ["rivals", "Rakipler", "users"]];
const CKINDS = [["image", "Fotoğraf", "image", "Tek görsel. Akışta 4:5 ile 1,91:1 arasına kırpılır."], ["carousel", "Kaydırmalı", "gallery-horizontal-end", "2-10 görsel ya da video. Hepsi ilk görselin oranına kırpılır; sırayı oklarla değiştirebilirsin."],
  ["reels", "Reels", "clapperboard", "Tek video, dikey (9:16) önerilir. 3 saniye ile 15 dakika arası."], ["story", "Hikâye", "circle-plus", "Tek görsel ya da video, 24 saat görünür. Hikâyelerde açıklama gösterilmez."]];
const LIMITS = { image: [1, 1], carousel: [2, 10], reels: [1, 1], story: [1, 1] };
const METRICS = [["views", "Görüntülenme"], ["reach", "Erişim"], ["accounts_engaged", "Etkileşen hesap"], ["total_interactions", "Toplam etkileşim"],
  ["likes", "Beğeni"], ["comments", "Yorum"], ["shares", "Paylaşım"], ["saves", "Kaydetme"], ["follows_and_unfollows", "Takip"], ["profile_links_taps", "Bağlantı tıklaması"]];
const MEDIA_METRICS = [["views", "Görüntülenme"], ["reach", "Erişim"], ["likes", "Beğeni"], ["comments", "Yorum"], ["shares", "Paylaşım"], ["saved", "Kaydetme"],
  ["ig_reels_avg_watch_time", "Ort. izlenme"], ["total_interactions", "Etkileşim"]];

async function ig(X, path, fresh) {
  return X.api(`/api/ig/${path}${fresh ? (path.includes("?") ? "&" : "?") + "fresh=1" : ""}`);
}

// ---------- platform switcher ----------

const PLAT_KEY = "sosyal-accounts";
let ytProm = null;
let ytM = null;
const ytLoad = () =>
  (ytProm ||= import("/web/ytaccount.js")
    .then((m) => (ytM = m))
    .catch(() => {
      ytProm = null;
      return null;
    }));
let ttProm = null;
let ttM = null;
const ttLoad = () =>
  (ttProm ||= import("/web/ttaccount.js")
    .then((m) => (ttM = m))
    .catch(() => {
      ttProm = null;
      return null;
    }));

const PLATFORMS = [
  { id: "instagram", name: "Instagram", icon: "instagram", on: (S) => !!S.settings.instagram?.has_token, info: igInfo, render: (X, fresh) => renderIg(X, fresh), prefetch: igPrefetch },
  { id: "youtube", name: "YouTube", icon: "youtube", on: (S) => !!S.youtube?.connected, warn: (S) => !!S.youtube?.needs_reconnect, render: renderYt,
    info: (X) => ytM?.ytCardInfo(X) || { name: X.S.youtube?.channel_title || "YouTube", stats: [] }, prefetch: () => ytLoad().then((m) => m?.ytChannel()) },
  { id: "tiktok", name: "TikTok", icon: "music", on: (S) => !!S.tiktok?.logged_in, warn: (S) => S.tiktok?.logged_in === false, render: renderTt,
    info: (X) => ttM?.ttCardInfo(X) || { name: "TikTok", stats: [] }, prefetch: () => ttLoad().then((m) => m?.ttPrefetch()) },
];

function igInfo(X) {
  const { S } = X;
  const p = S.acc?.profile?.ok ? S.acc.profile.data : null;
  const user = p?.username || S.settings.instagram?.username;
  const v = viewsOf(S.acc);
  const stats = p ? [[p.followers_count, "takipçi"], [p.media_count, "gönderi"]] : [];
  if (p && v != null) stats.push([v, "görüntülenme"]);
  return { avatar: p?.profile_picture_url || S.settings.avatar, name: user ? "@" + user : "Instagram", stats };
}

const viewsOf = (A) => (A?.views?.ok ? A.views.data.views : null);

function igViews(X, fresh) {
  const A = (X.S.acc ||= { tab: "posts" });
  if (A.viewsBusy || (A.views && !fresh)) return;
  A.viewsBusy = true;
  ig(X, "views", fresh)
    .then((r) => {
      A.views = r;
      drawSwitch(X);
      const box = $('[data-pane="instagram"] #igEng');
      if (box) box.innerHTML = igEngage(X, A);
      const el = $('[data-pane="instagram"] .acc-views');
      const v = viewsOf(A);
      if (el && v != null) {
        el.innerHTML = `<b>${nf(v)}</b> görüntülenme`;
        el.classList.remove("hidden");
      }
    })
    .catch(() => {})
    .finally(() => (A.viewsBusy = false));
}

function igEngage(X, A) {
  const d = A?.views?.ok ? A.views.data : null;
  if (!d) return "";
  const missing = d.media && d.counted < d.media ? `${d.media - d.counted} gönderinin istatistiği alınamadı` : "";
  return engageHtml(X, { views: d.views, likes: d.likes, comments: d.comments, shares: d.shares, saves: d.saves },
    { title: "Gönderilerindeki etkileşimler", count: d.media, unit: "gönderi", cls: "ig", note: missing });
}

async function igPrefetch(X) {
  const A = (X.S.acc ||= { tab: "posts" });
  if (!A.profile) {
    const r = await ig(X, "profile");
    A.profile ||= r;
  }
  if (A.profile?.ok) igViews(X);
}

function shell() {
  const el = $("#accountView");
  if (!$("#accSwitch", el))
    el.innerHTML = `<div class="accs" id="accSwitch"></div>${PLATFORMS.filter((p) => !p.soon).map((p) => `<div class="acc-pane hidden" data-pane="${p.id}"></div>`).join("")}`;
  return el;
}

const paneOf = (id) => $(`[data-pane="${id}"]`, shell());

function showPane(id) {
  for (const el of $$("[data-pane]", shell())) el.classList.toggle("hidden", el.dataset.pane !== id);
}

const connSig = (S) => PLATFORMS.filter((p) => !p.soon).map((p) => `${p.id}:${p.on(S) ? 1 : 0}${p.warn?.(S) ? 1 : 0}`).join("|");

function pickPlat(X) {
  const { S } = X;
  const ok = PLATFORMS.filter((p) => !p.soon);
  if (S.accPick && ok.some((p) => p.id === S.accPick)) return S.accPick;
  let saved = null;
  try {
    saved = localStorage.getItem(PLAT_KEY);
  } catch {}
  const sp = ok.find((p) => p.id === saved);
  if (sp && sp.on(S)) return sp.id;
  return (ok.find((p) => p.on(S)) || sp || ok[0]).id;
}

function choose(X, id) {
  X.S.accPick = id;
  try {
    localStorage.setItem(PLAT_KEY, id);
  } catch {}
  renderAccount(X).catch((e) => X.toast(e.message, true));
}

function drawSwitch(X) {
  const box = $("#accSwitch");
  if (!box) return;
  const { S, ic, esc } = X;
  const num = (v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR", { notation: "compact", maximumFractionDigits: 1 }));
  box.innerHTML = PLATFORMS.map((p) => {
    if (p.soon)
      return `<div class="accsw soon" data-plat="${p.id}" title="${p.name} bağlantısı yakında geliyor" aria-disabled="true"><span class="accsw-av">${ic(p.icon, 20)}</span>
        <div class="accsw-main"><span class="accsw-name">${p.name}</span><span class="accsw-sub"><span class="accsw-soon">Yakında</span></span></div></div>`;
    const on = p.on(S);
    const inf = on ? p.info(X) : { stats: [] };
    const warn = on && !!(p.warn?.(S) || inf.warn);
    const sel = S.accShown === p.id;
    const img = on && inf.avatar;
    const state = !on ? "Bağlı değil" : warn ? "yeniden bağlanmalı" : inf.note || "bağlı";
    return `<div class="accsw ${on ? "on" : "off"}${warn ? " warn" : ""}${sel ? " sel" : ""}" data-plat="${p.id}" role="button" tabindex="0" aria-pressed="${sel}"${inf.tip ? ` title="${esc(inf.tip)}"` : ""}>
      <span class="accsw-av${img ? " img" : ""}" style="${img ? `background-image:url('${esc(inf.avatar)}')` : ""}">${img ? `<span class="accsw-pf">${ic(p.icon, 11)}</span>` : ic(p.icon, 20)}</span>
      <div class="accsw-main"><span class="accsw-name">${esc(on ? inf.name : p.name)}</span>
        <span class="accsw-sub"><i class="accsw-dot"></i><span>${on ? `${p.name} · ` : ""}${esc(state)}</span></span>
        ${on && inf.stats.length ? `<span class="accsw-stats">${inf.stats.map(([v, t, hid]) => `<span><b>${hid ? "gizli" : num(v)}</b> ${t}</span>`).join("")}</span>` : ""}</div>
      ${!on || warn ? `<button class="btn sm${on ? "" : " primary"}" data-connect="${p.id}">${ic("plug", 13)}${on ? "Yeniden bağla" : "Bağla"}</button>` : ""}
    </div>`;
  }).join("");
  const cur = $(".accsw.sel", box);
  if (cur && box.scrollWidth > box.clientWidth) {
    const b = box.getBoundingClientRect();
    const r = cur.getBoundingClientRect();
    if (r.left < b.left || r.right > b.right) box.scrollLeft += r.left - b.left - 12;
  }
  box.onclick = (e) => {
    const c = e.target.closest("[data-connect]");
    if (c) return X.openSettings(c.dataset.connect);
    const card = e.target.closest(".accsw[role=button]");
    if (card && card.dataset.plat !== S.accShown) choose(X, card.dataset.plat);
  };
  box.onkeydown = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".accsw[role=button]")) {
      e.preventDefault();
      choose(X, e.target.dataset.plat);
    }
  };
}

async function renderYt(X, fresh) {
  const pane = paneOf("youtube");
  const m = await ytLoad();
  if (!m) {
    pane.innerHTML = `<div class="empty">${X.ic("youtube", 30)}<p>YouTube görünümü yüklenemedi. Sayfayı yenileyip tekrar dene.</p></div>`;
    return;
  }
  const r = await m.renderYtAccount(X, pane, fresh, { go: (id) => choose(X, id), after: () => drawSwitch(X) });
  if (r === "missing" && !X.S.accPick && X.S.accShown === "youtube") {
    X.S.accShown = "instagram";
    showPane("instagram");
    drawSwitch(X);
    return renderIg(X, fresh);
  }
  drawSwitch(X);
}

async function renderTt(X, fresh) {
  const pane = paneOf("tiktok");
  const m = await ttLoad();
  if (!m) {
    pane.innerHTML = `<div class="empty">${X.ic("music", 30)}<p>TikTok görünümü yüklenemedi. Sayfayı yenileyip tekrar dene.</p></div>`;
    return;
  }
  await m.renderTtAccount(X, pane, fresh, { after: () => drawSwitch(X) });
  drawSwitch(X);
}

export function syncAccounts(X) {
  const { S } = X;
  if (S.tab !== "account" || !$("#accSwitch")) return;
  const sig = connSig(S);
  if (sig === S.accSig) return;
  if (S.acc && sig.split("|")[0] !== (S.accSig || "").split("|")[0]) S.acc.profile = S.acc.media = S.acc.views = null;
  S.accSig = sig;
  renderAccount(X).catch(() => {});
}

export async function renderAccount(X, fresh = false) {
  const { S } = X;
  shell();
  const id = pickPlat(X);
  S.accShown = id;
  S.accSig = connSig(S);
  showPane(id);
  drawSwitch(X);
  for (const p of PLATFORMS)
    if (p.id !== id && !p.soon && p.prefetch && p.on(S))
      p.prefetch(X)
        .then(() => drawSwitch(X))
        .catch(() => {});
  await PLATFORMS.find((p) => p.id === id).render(X, fresh);
}

function fixCard(X, err, kind) {
  const { ic } = X;
  if (err.code === "dm_disabled")
    return `<div class="fix">${ic("unplug", 22)}<div><b>Mesajlara erişim kapalı</b><p>Instagram'ın uygulama dışından mesajları okumasına izin vermen gerekiyor:</p>
      <ol><li>Telefonda Instagram → <b>Ayarlar ve hareketler</b></li><li><b>Mesajlar ve hikâye yanıtları</b> → <b>Mesaj kontrolleri</b></li><li><b>Bağlı araçlar</b> → <b>Mesajlara erişime izin ver</b>'i aç</li></ol>
      <p class="muted sm">Açtıktan sonra "Yenile"ye bas. Instagram, mesaj yanıtlarına sadece karşı tarafın son mesajından sonraki 24 saat içinde izin verir.</p></div></div>`;
  if (err.code === "permission")
    return `<div class="fix">${ic("triangle-alert", 22)}<div><b>${kind === "stats" ? "İstatistik izni gerekiyor" : "Bu bölüm için izin gerekiyor"}</b>
      <p>Meta'daki uygulama yapılandırmasına <b>instagram_manage_insights</b> izni eklenip anahtar yenilenmeli. Birlikte 2 dakikada ekleyebiliriz; asistana "istatistik iznini ekleyelim" demen yeterli.</p></div></div>`;
  return `<div class="fix">${ic("triangle-alert", 22)}<div><b>Instagram'dan bilgi alınamadı</b><p class="sm">${X.esc(err.message || "")}</p></div></div>`;
}

async function renderIg(X, fresh = false) {
  const { S, ic, esc } = X;
  const el = paneOf("instagram");
  const A = (S.acc ||= { tab: "posts" });
  const igs = S.settings.instagram || {};
  if (!igs.has_token) {
    el.innerHTML = `<div class="empty" style="padding-top:80px">${ic("instagram", 40)}<p>Instagram hesabı bağlı değil.</p><div class="row" style="justify-content:center"><button class="btn primary" id="aSet">${ic("settings", 15)}Ayarlar'dan bağla</button>${claudeSetupBtn("instagram")}</div></div>`;
    $("#aSet", el).onclick = () => X.openSettings("instagram");
    return;
  }
  if (!A.profile || fresh) {
    if (!A.profile) el.innerHTML = `<div class="empty" style="padding-top:80px">${ic("loader-circle", 30, "spin")}<p>Hesap yükleniyor…</p></div>`;
    A.profile = await ig(X, "profile", fresh);
    drawSwitch(X);
  }
  if (!A.profile.ok) {
    el.innerHTML = `<div class="acc">${fixCard(X, A.profile.error)}</div>`;
    return;
  }
  igViews(X, fresh);
  const p = A.profile.data;
  const views = viewsOf(A);
  const avatar = p.profile_picture_url || S.settings.avatar;
  el.innerHTML = `<div class="acc">
    <div class="acc-head">
      <span class="acc-av" style="${avatar ? `background-image:url('${esc(avatar)}')` : ""}">${avatar ? "" : esc((p.username || "?")[0].toUpperCase())}</span>
      <div class="grow">
        <div class="row"><h2>@${esc(p.username)}</h2><button class="btn sm primary" id="aNew">${ic("upload", 14)}Yeni paylaşım</button><button class="btn sm ig" id="aOpenIg" title="Instagram'ın kendi sürümü ayrı bir pencerede açılır: akış, Keşfet, hikâyeler, beğeni ve takip">${ic("instagram", 14)}Instagram'ı aç</button><button class="btn sm ghost" id="aRefresh">${ic("refresh-cw", 14)}Yenile</button></div>
        <div class="acc-stats"><span><b>${nf(p.media_count)}</b> gönderi</span><span><b>${nf(p.followers_count)}</b> takipçi</span><span><b>${nf(p.follows_count)}</b> takip</span><span class="acc-views${views == null ? " hidden" : ""}" title="Tüm gönderilerinin toplam görüntülenmesi">${views == null ? "" : `<b>${nf(views)}</b> görüntülenme`}</span></div>
        ${p.name ? `<div class="acc-name">${esc(p.name)}</div>` : ""}${p.biography ? `<div class="acc-bio">${esc(p.biography)}</div>` : ""}${p.website ? `<a href="${esc(p.website)}" target="_blank" class="sm">${esc(p.website)}</a>` : ""}
      </div>
    </div>
    <div id="igEng">${igEngage(X, A)}</div>
    <div class="acc-tabs">${TABS.map(([k, t, i]) => `<button data-at="${k}" class="${A.tab === k ? "active" : ""}">${ic(i, 15)}${t}</button>`).join("")}</div>
    <div id="accBody"><div class="empty">${ic("loader-circle", 26, "spin")}</div></div>
  </div>`;
  $("#aRefresh", el).onclick = () => renderIg(X, true);
  $("#aNew", el).onclick = () => openComposer(X);
  $("#aOpenIg", el).onclick = X.guard(async () => {
    await X.api("/api/open-instagram", {});
    X.toast("Instagram ayrı pencerede açılıyor");
  });
  for (const b of $$("[data-at]", el))
    b.onclick = () => {
      A.tab = b.dataset.at;
      renderIg(X);
    };
  const body = $("#accBody", el);
  try {
    if (A.tab === "posts") await renderPosts(X, body, fresh);
    else if (A.tab === "comments") await renderComments(X, body, fresh);
    else if (A.tab === "dms") await renderDms(X, body, fresh);
    else if (A.tab === "tags") await renderTags(X, body, fresh);
    else if (A.tab === "rivals") await renderRivals(X, body, fresh);
    else await renderStats(X, body, fresh);
  } catch (e) {
    body.innerHTML = fixCard(X, { message: e.message });
  }
}

// ---------- posts ----------

async function renderPosts(X, body, fresh) {
  const { S, ic, esc } = X;
  const A = S.acc;
  if (!A.media || fresh) A.media = await ig(X, "media", fresh);
  if (!A.media.ok) return (body.innerHTML = fixCard(X, A.media.error));
  const items = A.media.data.items;
  body.innerHTML = items.length
    ? `<div class="grid">${items.map((m) => `<button class="tile" data-m="${m.id}">
        <img src="${esc(m.thumbnail_url || m.media_url || "")}" alt="" loading="lazy">
        ${m.media_product_type === "REELS" ? `<span class="kind">${ic("clapperboard", 14)}</span>` : m.media_type === "VIDEO" ? `<span class="kind">${ic("film", 14)}</span>` : ""}
        ${m.studio_post ? `<span class="studio">Stüdyo #${m.studio_post}</span>` : ""}
        <span class="ov">${m.views != null ? `<span class="ov-views" title="İzlenme">${ic(m.media_type === "VIDEO" ? "play" : "eye", 14)}${nf(m.views)}</span>` : ""}${ic("heart", 14)}${nf(m.like_count)} ${ic("message-circle", 14)}${nf(m.comments_count)}</span></button>`).join("")}</div>
      ${A.media.data.after ? `<div class="center" style="margin-top:14px"><button class="btn" id="aMore">Daha fazla</button></div>` : ""}`
    : `<div class="empty">Henüz paylaşım yok.</div>`;
  for (const t of $$("[data-m]", body)) t.onclick = () => openMedia(X, t.dataset.m);
  const more = $("#aMore", body);
  if (more)
    more.onclick = X.guard(async () => {
      const r = await ig(X, `media?after=${encodeURIComponent(A.media.data.after)}`);
      if (!r.ok) throw new Error(r.error.message);
      A.media.data.items.push(...r.data.items);
      A.media.data.after = r.data.after;
      renderPosts(X, body);
    });
}

export async function openMedia(X, mid, fresh = false) {
  const { ic, esc } = X;
  X.modal(`<div class="mdl-load">${ic("loader-circle", 28, "spin")}</div>`, null, "wide");
  const r = await ig(X, `media/${mid}`, fresh);
  if (!r.ok) return X.modal(fixCard(X, r.error), null, "wide");
  const { media: m, insights, insights_error, comments, studio_post } = r.data;
  const video = m.media_type === "VIDEO";
  const stats = insights
    ? `<div class="kpis sm4">${MEDIA_METRICS.filter(([k]) => insights[k] != null).map(([k, t]) => `<div class="kpi"><b>${k === "ig_reels_avg_watch_time" ? (insights[k] / 1000).toFixed(1).replace(".", ",") + " sn" : nf(insights[k])}</b><span>${t}</span></div>`).join("")}</div>`
    : `<div class="kpis sm4"><div class="kpi"><b>${nf(m.like_count)}</b><span>Beğeni</span></div><div class="kpi"><b>${nf(m.comments_count)}</b><span>Yorum</span></div></div>${insights_error ? fixCard(X, insights_error, "stats") : ""}`;
  X.modal(`<div class="mdl">
    <div class="mdl-media">${video ? `<video src="${esc(m.media_url || "")}" poster="${esc(m.thumbnail_url || "")}" controls playsinline></video>` : `<img src="${esc(m.media_url || "")}" alt="">`}</div>
    <div class="mdl-side">
      <div class="row"><span class="grow sm muted">${new Date(m.timestamp).toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}${studio_post ? ` · <a href="#${studio_post}" data-close>Stüdyo #${studio_post}</a>` : ""}</span>
        <a class="btn sm" href="${esc(m.permalink)}" target="_blank">${ic("external-link", 14)}Instagram</a><button class="btn icon ghost" data-close>${ic("x")}</button></div>
      ${m.caption ? `<div class="mcap">${esc(m.caption)}</div>` : ""}
      <h4>${ic("list-checks", 13)}İstatistikler</h4>${stats}
      <div class="sm muted" style="margin-top:6px">Instagram kimlerin beğendiğini paylaşmıyor; sadece beğeni sayısı görünür.</div>
      <h4>${ic("message-circle", 13)}Yorumlar <span class="muted">${nf(m.comments_count)}</span></h4>
      <div class="clist">${commentRows(X, comments || [])}</div>
      <div class="row"><input id="mNew" class="grow" placeholder="Yorum yaz…"><button class="btn primary" id="mSend">${ic("send", 15)}</button></div>
    </div></div>`, (box) => {
    bindComments(X, box, () => openMedia(X, mid, true));
    $("#mSend", box).onclick = X.guard(async () => {
      const text = $("#mNew", box).value.trim();
      if (!text) return;
      const res = await X.api(`/api/ig/media/${mid}/comment`, { message: text });
      if (!res.ok) throw new Error(res.error.message);
      X.toast("Yorum gönderildi");
      openMedia(X, mid, true);
    });
  }, "wide");
}

function commentRows(X, list, withMedia = false) {
  const { ic, esc } = X;
  if (!list.length) return `<div class="muted sm">Henüz yorum yok.</div>`;
  const row = (c, reply = false) => `<div class="cm ${reply ? "reply" : ""} ${c.hidden ? "hid" : ""}" data-c="${c.id}">
    <span class="cav">${esc((c.username || "?")[0].toUpperCase())}</span>
    <div class="grow"><div><b>@${esc(c.username || "?")}</b> ${esc(c.text || "")}</div>
      <div class="sm muted">${ago(c.timestamp)}${c.like_count ? ` · ${c.like_count} beğeni` : ""}${c.hidden ? " · gizli" : ""}
        ${reply ? "" : `· <a href="#" data-reply="${c.id}">Yanıtla</a>`} · <a href="#" data-hide="${c.id}" data-v="${c.hidden ? 0 : 1}">${c.hidden ? "Göster" : "Gizle"}</a> · <a href="#" data-del="${c.id}">Sil</a></div>
      ${reply ? "" : `<div class="row rbox hidden" id="rb-${c.id}"><input class="grow" placeholder="@${esc(c.username || "")} kullanıcısına yanıt…"><button class="btn sm primary" data-send="${c.id}">Gönder</button></div>`}
    </div>
    ${withMedia && c.media ? `<a href="#" class="cthumb" data-open="${c.media.id}"><img src="${esc(c.media.thumbnail_url || c.media.media_url || "")}" alt=""></a>` : ""}
  </div>${((c.replies || {}).data || []).map((r) => row(r, true)).join("")}`;
  return list.map((c) => row(c)).join("");
}

function bindComments(X, box, reload) {
  box.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-reply],[data-hide],[data-del],[data-send],[data-open]");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.reply) {
      const rb = $(`#rb-${a.dataset.reply}`, box);
      rb.classList.toggle("hidden");
      $("input", rb)?.focus();
    } else if (a.dataset.open) openMedia(X, a.dataset.open);
    else
      await X.guard(async () => {
        let res;
        if (a.dataset.send) {
          const text = $("input", a.closest(".rbox")).value.trim();
          if (!text) return;
          res = await X.api(`/api/ig/comment/${a.dataset.send}/reply`, { message: text });
        } else if (a.dataset.hide) res = await X.api(`/api/ig/comment/${a.dataset.hide}/hide`, { hide: a.dataset.v === "1" });
        else {
          if (!confirm("Yorum Instagram'dan kalıcı olarak silinsin mi?")) return;
          res = await X.api(`/api/ig/comment/${a.dataset.del}/delete`, {});
        }
        if (!res.ok) throw new Error(res.error.message);
        X.toast("Tamam");
        reload();
      })();
  });
}

// ---------- comments ----------

async function renderComments(X, body, fresh) {
  const A = X.S.acc;
  A.comments = await ig(X, "comments", fresh);
  if (!A.comments.ok) return (body.innerHTML = fixCard(X, A.comments.error));
  body.innerHTML = `<div class="sm muted" style="margin-bottom:10px">Son paylaşımlarındaki yorumlar, en yeni üstte.</div><div class="clist big">${commentRows(X, A.comments.data, true)}</div>`;
  bindComments(X, body, () => renderComments(X, body, true));
}

// ---------- DMs ----------

async function renderDms(X, body, fresh) {
  const { S, ic, esc } = X;
  const A = S.acc;
  A.convs = await ig(X, "conversations", fresh);
  if (!A.convs.ok) return (body.innerHTML = fixCard(X, A.convs.error));
  const list = A.convs.data;
  body.innerHTML = `<div class="dms"><div class="dlist">${list.length ? list.map((c) => `<button class="dconv ${A.thread === c.id ? "sel" : ""}" data-conv="${c.id}">
      <span class="cav">${esc((c.with.username || "?")[0].toUpperCase())}</span><div class="grow"><b>@${esc(c.with.username || "?")}</b><div class="sm muted">${c.last_from_me ? "Sen: " : ""}${esc((c.last || "").slice(0, 60))}</div></div><span class="sm muted">${ago(c.updated)}</span></button>`).join("") : `<div class="muted sm">Henüz mesaj yok.</div>`}</div>
    <div class="dthread" id="dThread"><div class="empty sm">Bir konuşma seç.</div></div></div>`;
  for (const b of $$("[data-conv]", body))
    b.onclick = () => {
      A.thread = b.dataset.conv;
      $$("[data-conv]", body).forEach((x) => x.classList.toggle("sel", x === b));
      openThread(X, $("#dThread", body), b.dataset.conv);
    };
  if (A.thread && list.some((c) => c.id === A.thread)) openThread(X, $("#dThread", body), A.thread);
}

async function openThread(X, box, cid, fresh = false) {
  const { ic, esc } = X;
  box.innerHTML = `<div class="empty">${ic("loader-circle", 22, "spin")}</div>`;
  const r = await ig(X, `conversations/${encodeURIComponent(cid)}`, fresh);
  if (!r.ok) return (box.innerHTML = fixCard(X, r.error));
  const t = r.data;
  box.innerHTML = `<div class="dhead row"><b class="grow">@${esc(t.with.username || "?")}</b><button class="btn sm ghost" id="dOpenIg" title="Konuşmayı Instagram'ın kendi penceresinde aç">${ic("external-link", 14)}Instagram'da aç</button></div>
    <div class="dmsgs">${t.messages.map((m) => `<div class="bub ${m.mine ? "me" : ""}">${esc(m.text || (m.attachments ? "[ek]" : ""))}<span>${new Date(m.at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>`).join("")}</div>
    <div id="dWarn"></div>
    <div class="row"><input id="dText" class="grow" placeholder="Mesaj yaz…"><button class="btn primary" id="dSend">${ic("send", 15)}</button></div>`;
  $("#dOpenIg", box).onclick = X.guard(async () => {
    await X.api("/api/open-instagram", { path: "direct/inbox/" });
    X.toast("Instagram mesajları ayrı pencerede açılıyor");
  });
  $("#dText", box).onkeydown = (e) => {
    if (e.key === "Enter") $("#dSend", box).click();
  };
  const msgs = $(".dmsgs", box);
  msgs.scrollTop = msgs.scrollHeight;
  $("#dSend", box).onclick = X.guard(async () => {
    const text = $("#dText", box).value.trim();
    if (!text) return;
    const res = await X.api(`/api/ig/conversations/${encodeURIComponent(cid)}/send`, { text });
    if (!res.ok && res.error.code === "dm_window") {
      $("#dWarn", box).innerHTML = `<div class="fix">${ic("clock", 20)}<div><b>Instagram bu yanıta şimdilik izin vermiyor</b>
        <p>Instagram, uygulamalardan gelen yanıtlara sadece karşı tarafın <b>mesaj erişimini açtıktan sonra</b> yazdığı bir mesajdan itibaren 24 saat izin veriyor. Erişimi açmadan önce gelen mesajlar bu süreyi başlatmaz.</p>
        <p>Karşı taraf yeni bir mesaj yazınca buradan yanıtlayabilirsin. Beklemek istemezsen <a href="#" id="dWarnIg">Instagram'da yanıtla</a>.</p>
        <p class="sm muted">Meta uygulaman geliştirme modunda olduğu için, uygulamada rolü olmayan kişilere yanıt da engellenebilir. Herkese yanıt için uygulamanın canlıya alınması (Meta onayı) gerekir.</p></div></div>`;
      $("#dWarnIg", box).onclick = (e) => {
        e.preventDefault();
        $("#dOpenIg", box).click();
      };
      return;
    }
    if (!res.ok) throw new Error(res.error.message);
    openThread(X, box, cid, true);
  });
}

// ---------- stats ----------

function reachChart(X, series) {
  if (!series.length) return "";
  const W = 720, H = 200, pad = 28, gap = 2;
  const max = Math.max(1, ...series.map((s) => s.value));
  const bw = (W - pad * 2) / series.length - gap;
  const bars = series.map((s, i) => {
    const h = Math.max(2, ((H - pad * 2) * s.value) / max);
    const x = pad + i * (bw + gap);
    const y = H - pad - h;
    const label = new Date(s.date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
    return `<g class="bar" data-tip="${label}: ${nf(s.value)} erişim"><rect x="${x - gap / 2}" y="${pad}" width="${bw + gap}" height="${H - pad * 2}" fill="transparent"/><path d="M${x},${H - pad} V${y + 4} q0,-4 4,-4 h${Math.max(0, bw - 8)} q4,0 4,4 V${H - pad} Z" fill="var(--accent)"/></g>`;
  }).join("");
  const first = new Date(series[0].date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  const last = new Date(series[series.length - 1].date).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  return `<div class="pane chart"><h3>Günlük erişim</h3>
    <svg viewBox="0 0 ${W} ${H}" class="rchart"><line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" stroke="var(--line)"/>
      <text x="${pad}" y="${pad - 10}" class="ax">${nf(max)}</text>${bars}
      <text x="${pad}" y="${H - 8}" class="ax">${first}</text><text x="${W - pad}" y="${H - 8}" class="ax" text-anchor="end">${last}</text></svg>
    <div class="ctip hidden"></div></div>`;
}

async function renderStats(X, body, fresh) {
  const { S, ic, esc } = X;
  const A = S.acc;
  A.days ||= 7;
  const [ins, top] = await Promise.all([ig(X, `insights?days=${A.days}`, fresh), ig(X, "top", fresh)]);
  if (!ins.ok) return (body.innerHTML = fixCard(X, ins.error, "stats"));
  const tot = ins.data.totals || {};
  body.innerHTML = `<div class="row" style="margin-bottom:12px"><div class="seg" id="aDays">${[7, 30].map((d) => `<button data-d="${d}" class="${A.days === d ? "active" : ""}">Son ${d} gün</button>`).join("")}</div></div>
    <div class="kpis">${METRICS.filter(([k]) => tot[k] != null).map(([k, t]) => `<div class="kpi"><b>${nf(tot[k])}</b><span>${t}</span></div>`).join("")}</div>
    ${reachChart(X, ins.data.series || [])}
    <div class="pane"><h3>${ic("film", 14)}En çok izlenen paylaşımlar</h3>${top.ok ? `<table class="ttable"><thead><tr><th></th><th>Paylaşım</th><th>Görüntülenme</th><th>Erişim</th><th>Beğeni</th><th>Yorum</th><th>Paylaşım</th><th>Kaydetme</th></tr></thead><tbody>
      ${top.data.map((m) => `<tr data-m="${m.id}"><td><img src="${esc(m.thumbnail_url || m.media_url || "")}" alt=""></td><td>${esc((m.caption || "").split("\n")[0].slice(0, 50))}</td><td>${nf(m.insights.views)}</td><td>${nf(m.insights.reach)}</td><td>${nf(m.insights.likes)}</td><td>${nf(m.insights.comments)}</td><td>${nf(m.insights.shares)}</td><td>${nf(m.insights.saved)}</td></tr>`).join("")}</tbody></table>` : fixCard(X, top.error, "stats")}</div>`;
  for (const b of $$("[data-d]", body))
    b.onclick = () => {
      A.days = +b.dataset.d;
      renderStats(X, body);
    };
  for (const r of $$("tr[data-m]", body)) r.onclick = () => openMedia(X, r.dataset.m);
  const tip = $(".ctip", body);
  for (const g of $$(".bar", body)) {
    g.onmouseenter = (e) => {
      tip.textContent = g.dataset.tip;
      tip.classList.remove("hidden");
    };
    g.onmousemove = (e) => {
      const box = g.closest(".chart").getBoundingClientRect();
      tip.style.left = `${e.clientX - box.left + 12}px`;
      tip.style.top = `${e.clientY - box.top - 10}px`;
    };
    g.onmouseleave = () => tip.classList.add("hidden");
  }
}

export async function postStats(X, d, slot) {
  if (!slot || !d.published?.id) return;
  const r = await ig(X, `media/${d.published.id}`);
  if (!slot.isConnected) return;
  if (!r.ok) {
    slot.innerHTML = `<span class="sm muted">İstatistik alınamadı: ${X.esc(r.error.message)}</span>`;
    return;
  }
  const m = r.data.media;
  const ins = r.data.insights || {};
  const cells = [["views", "Görüntülenme", ins.views], ["likes", "Beğeni", ins.likes ?? m.like_count], ["comments", "Yorum", ins.comments ?? m.comments_count],
    ["shares", "Paylaşım", ins.shares], ["saved", "Kaydetme", ins.saved], ["reach", "Erişim", ins.reach]].filter((c) => c[2] != null);
  slot.innerHTML = `<div class="kpis sm4">${cells.map(([, t, v]) => `<div class="kpi"><b>${nf(v)}</b><span>${t}</span></div>`).join("")}</div>
    <div class="row" style="margin-top:6px"><a href="#" class="sm" id="psOpen">Yorumları ve ayrıntıları aç</a>${r.data.insights_error ? `<span class="sm muted">· görüntülenme ve erişim için istatistik izni gerekiyor</span>` : ""}</div>`;
  slot.querySelector("#psOpen").onclick = (e) => {
    e.preventDefault();
    openMedia(X, d.published.id);
  };
}

// ---------- composer ----------

export function openComposer(X, kind = "image") {
  const { ic, esc } = X;
  const C = { kind, items: [] };
  X.modal(`<h2>${ic("upload", 20)}Yeni paylaşım</h2>
    <div class="seg" id="cpKind">${CKINDS.map(([k, t, i]) => `<button data-k="${k}">${ic(i, 15)}${t}</button>`).join("")}</div>
    <div class="sm muted" id="cpHint" style="margin-top:8px"></div>
    <div class="cp">
      <div>
        <div class="drop" id="cpDrop">${ic("upload", 22)}<b>Dosyaları sürükle, yapıştır ya da tıkla</b><span class="sm muted" id="cpAccept"></span></div>
        <input type="file" id="cpIn" multiple hidden>
        <div class="cp-list" id="cpList"></div>
      </div>
      <div>
        <label>Açıklama</label><textarea id="cpCap" rows="8" maxlength="2200" placeholder="Gönderi açıklaması…"></textarea>
        <label>Hashtag'ler</label><input id="cpTags" value="${esc(X.S.settings.default_hashtags || "")}">
        <div class="counter" id="cpCount" style="margin-top:6px"></div>
      </div>
    </div>
    <div class="foot"><span class="grow sm muted" style="align-self:center">Sonraki adımda önizleme, planlama ve paylaşım var.</span><button class="btn" data-close>Vazgeç</button><button class="btn primary" id="cpGo">${ic("check", 15)}Hazırla</button></div>`, (m) => {
    const bar = (it) => {
      const i = $(`[data-u="${it.uid}"] .st i`, m);
      if (i) i.style.width = `${Math.round(it.pct * 100)}%`;
    };
    const count = () => {
      const full = ($("#cpCap", m).value.trim() + ($("#cpTags", m).value.trim() ? "\n\n" + $("#cpTags", m).value.trim() : "")).trim();
      const tags = (full.match(/#[\p{L}\p{N}_]+/gu) || []).length;
      const c = $("#cpCount", m);
      c.textContent = `${full.length} / 2200 karakter · ${tags} / 30 hashtag`;
      c.className = "counter" + (full.length > 2200 || tags > 30 ? " over" : "");
    };
    const draw = () => {
      for (const b of $$("[data-k]", m)) b.classList.toggle("active", b.dataset.k === C.kind);
      $("#cpHint", m).textContent = CKINDS.find((x) => x[0] === C.kind)[3];
      const vidOk = C.kind !== "image";
      const imgOk = C.kind !== "reels";
      const max = LIMITS[C.kind][1];
      $("#cpIn", m).accept = [imgOk ? "image/*" : "", vidOk ? "video/mp4,video/quicktime,.mp4,.mov,.m4v" : ""].filter(Boolean).join(",");
      $("#cpIn", m).multiple = max > 1;
      $("#cpAccept", m).textContent = `${imgOk ? "Görsel (jpg, png, webp)" : ""}${imgOk && vidOk ? " · " : ""}${vidOk ? "Video (mp4, mov)" : ""} · ${max > 1 ? `en fazla ${max} dosya` : "tek dosya"}`;
      $("#cpList", m).innerHTML = C.items.map((it, i) => `<div class="cp-item ${it.err ? "err" : ""}" data-u="${it.uid}" title="${esc(it.err || it.file.name)}">
          ${it.video ? `<video src="${it.local}" muted preload="metadata"></video>` : `<img src="${it.local}" alt="">`}
          ${C.items.length > 1 ? `<span class="n">${i + 1}</span>` : ""}${it.video ? `<span class="vk">${ic("film", 12)}</span>` : ""}
          ${it.id ? "" : it.err ? `<span class="st bad">${ic("triangle-alert", 12)} hata</span>` : `<span class="st"><i style="width:${Math.round(it.pct * 100)}%"></i></span>`}
          <div class="acts">${C.items.length > 1 ? `<button data-mv="${i}" data-d="-1" ${i ? "" : "disabled"}>${ic("chevron-left", 13)}</button><button data-mv="${i}" data-d="1" ${i < C.items.length - 1 ? "" : "disabled"}>${ic("chevron-right", 13)}</button>` : ""}<button data-rm="${i}" title="Kaldır">${ic("x", 13)}</button></div>
        </div>`).join("");
      $("#cpCap", m).placeholder = C.kind === "story" ? "Hikâyelerde açıklama görünmez (isteğe bağlı not)" : "Gönderi açıklaması…";
      count();
    };
    const upload = (it) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/uploads");
      xhr.setRequestHeader("X-Filename", encodeURIComponent(it.file.name || "yapistirilan.png"));
      xhr.setRequestHeader("X-Allow-Video", "1");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          it.pct = e.loaded / e.total;
          bar(it);
        }
      };
      xhr.onload = () => {
        let j = {};
        try {
          j = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status === 200 && j.id) it.id = j.id;
        else {
          it.err = j.error || "yükleme hatası";
          X.toast(`${it.file.name}: ${it.err}`, true);
        }
        if (m.isConnected) draw();
      };
      xhr.onerror = () => {
        it.err = "bağlantı hatası";
        if (m.isConnected) draw();
      };
      xhr.send(it.file);
    };
    const add = (files) => {
      const max = LIMITS[C.kind][1];
      for (const f of files) {
        const video = /^video\//.test(f.type) || /\.(mp4|mov|m4v)$/i.test(f.name);
        if (!video && !/^image\//.test(f.type)) {
          X.toast(`${f.name}: desteklenmeyen dosya`, true);
          continue;
        }
        if (C.items.length >= max) {
          if (max > 1) {
            X.toast(`En fazla ${max} dosya eklenebilir`, true);
            break;
          }
          C.items = [];
        }
        const it = { uid: Math.random().toString(36).slice(2), file: f, video, local: URL.createObjectURL(f), pct: 0 };
        C.items.push(it);
        upload(it);
      }
      draw();
    };
    $("#cpKind", m).onclick = (e) => {
      const b = e.target.closest("[data-k]");
      if (!b) return;
      C.kind = b.dataset.k;
      C.items = C.items.slice(0, LIMITS[C.kind][1]);
      draw();
    };
    $("#cpList", m).onclick = (e) => {
      const mv = e.target.closest("[data-mv]");
      const rm = e.target.closest("[data-rm]");
      if (mv) {
        const i = +mv.dataset.mv;
        const j = i + +mv.dataset.d;
        [C.items[i], C.items[j]] = [C.items[j], C.items[i]];
      } else if (rm) C.items.splice(+rm.dataset.rm, 1);
      else return;
      draw();
    };
    const drop = $("#cpDrop", m);
    drop.onclick = () => $("#cpIn", m).click();
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add("over");
    };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      add([...e.dataTransfer.files]);
    };
    $("#cpIn", m).onchange = (e) => {
      add([...e.target.files]);
      e.target.value = "";
    };
    const prevPaste = X.onPaste;
    X.onPaste = (e) => {
      if (!m.isConnected) {
        X.onPaste = prevPaste;
        return prevPaste?.(e);
      }
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    };
    $("#cpCap", m).oninput = count;
    $("#cpTags", m).oninput = count;
    $("#cpGo", m).onclick = X.guard(async () => {
      const [lo] = LIMITS[C.kind];
      if (C.items.length < lo) throw new Error(C.kind === "carousel" ? "Kaydırmalı gönderi için en az 2 dosya ekle" : "Önce bir dosya ekle");
      if (C.items.some((it) => it.err)) throw new Error("Hatalı dosyaları kaldır");
      if (C.items.some((it) => !it.id)) throw new Error("Yüklemeler bitince tekrar dene");
      if (C.kind === "reels" && !C.items[0].video) throw new Error("Reels için video seç (görsel için Fotoğraf)");
      if (C.kind === "image" && C.items[0].video) throw new Error("Video için Reels'i seç");
      const btn = $("#cpGo", m);
      btn.disabled = true;
      btn.innerHTML = `${ic("loader-circle", 15, "spin")}Hazırlanıyor…`;
      try {
        const d = await X.api("/api/posts/manual", { kind: C.kind, uploads: C.items.map((it) => it.id), caption: $("#cpCap", m).value, hashtags: $("#cpTags", m).value });
        X.onPaste = prevPaste;
        X.closeModal();
        X.setTab("posts");
        X.select(d.id);
        X.refresh();
        X.toast("Hazır: önizle, planla ya da hemen paylaş");
      } finally {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.innerHTML = `${ic("check", 15)}Hazırla`;
        }
      }
    });
    draw();
  });
}

// ---------- tags ----------

async function renderTags(X, body, fresh) {
  const { S, ic, esc } = X;
  const r = await ig(X, "tags", fresh);
  if (!r.ok) return (body.innerHTML = fixCard(X, r.error));
  body.innerHTML = `<div class="sm muted" style="margin-bottom:10px">Seni fotoğrafında etiketleyen ya da açıklamasında @${esc(S.acc.profile.data.username)} diye anan paylaşımlar.</div>` +
    (r.data.length
      ? `<div class="grid">${r.data.map((m) => `<a class="tile" href="${esc(m.permalink || "#")}" target="_blank" title="${esc((m.caption || "").slice(0, 200))}">
          ${m.media_type === "VIDEO" ? `<video src="${esc(m.media_url || "")}" muted preload="metadata"></video><span class="kind">${ic("film", 14)}</span>` : `<img src="${esc(m.media_url || "")}" alt="" loading="lazy">`}
          <span class="studio">@${esc(m.username || "?")}</span>
          <span class="ov">${ic("heart", 14)}${nf(m.like_count)} ${ic("message-circle", 14)}${nf(m.comments_count)}<span class="grow"></span><span class="sm" style="font-weight:400">${ago(m.timestamp)}</span></span></a>`).join("")}</div>`
      : `<div class="empty">${ic("at-sign", 30)}<p>Henüz seni etiketleyen ya da anan bir paylaşım yok.</p></div>`);
}

// ---------- rivals ----------

function growth(x) {
  if (x.growth == null) return `<span class="sm muted" title="Takipçi sayısı her gün kaydedilir; değişim ertesi gün görünür">ölçülüyor</span>`;
  const since = new Date(x.growth_since).toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
  return `<span class="${x.growth > 0 ? "up" : x.growth < 0 ? "down" : "muted"}" title="${since} tarihinden beri">${x.growth > 0 ? "+" : ""}${nf(x.growth)}</span>`;
}

const dec = (v, pre = "") => (v == null ? "—" : pre + Number(v).toLocaleString("tr-TR", { maximumFractionDigits: 2 }));

async function renderRivals(X, body, fresh) {
  const { S, ic, esc } = X;
  const A = S.acc;
  const r = await ig(X, "rivals", fresh);
  if (!r.ok) return (body.innerHTML = fixCard(X, r.error));
  const rows = r.data;
  const cav = (x) => `<span class="cav" style="${x.profile_picture_url ? `background-image:url('${esc(x.profile_picture_url)}')` : ""}">${x.profile_picture_url ? "" : esc((x.username || "?")[0].toUpperCase())}</span>`;
  body.innerHTML = `<div class="row" style="margin-bottom:8px"><input id="rvName" class="grow" placeholder="Rakip ya da örnek aldığın hesap: kullanıcı adı veya profil bağlantısı"><button class="btn primary" id="rvAdd">${ic("user-plus", 15)}İzlemeye al</button></div>
    <div class="sm muted" style="margin-bottom:12px">Sadece İşletme ya da İçerik üreticisi hesaplar izlenebilir. Ortalamalar son 12 paylaşımdan hesaplanır; takipçi değişimi her gün kaydedilir. Satıra tıkla, son paylaşımlarını gör.</div>
    <div class="pane" style="padding:4px 8px"><table class="ttable rv"><thead><tr><th>Hesap</th><th>Takipçi</th><th>Son 7 gün</th><th>Gönderi</th><th>Haftada</th><th>Ort. beğeni</th><th>Ort. yorum</th><th title="(ortalama beğeni + yorum) / takipçi">Etkileşim</th><th></th></tr></thead><tbody>
    ${rows.map((x) => x.ok
      ? `<tr data-rv="${esc(x.username)}" class="${x.me ? "me" : ""} ${A.rv === x.username ? "sel" : ""}">
          <td><div class="row">${cav(x)}<div><b>@${esc(x.username)}</b>${x.me ? ` <span class="badge">sen</span>` : ""}<div class="sm muted">${esc(x.name || "")}</div></div></div></td>
          <td>${nf(x.followers_count)}</td><td>${growth(x)}</td><td>${nf(x.media_count)}</td><td>${dec(x.per_week)}</td><td>${nf(x.avg_likes)}</td><td>${dec(x.avg_comments)}</td><td>${dec(x.engagement, "%")}</td>
          <td>${x.me ? "" : `<button class="btn icon ghost" data-rm="${esc(x.username)}" title="İzlemeyi bırak">${ic("x", 14)}</button>`}</td></tr>`
      : `<tr><td><div class="row">${cav(x)}<b>@${esc(x.username)}</b></div></td><td colspan="7" class="sm muted">${esc(x.error.message)}</td><td><button class="btn icon ghost" data-rm="${esc(x.username)}" title="Kaldır">${ic("x", 14)}</button></td></tr>`).join("")}
    </tbody></table>${rows.length < 2 ? `<div class="empty sm" style="padding:16px">${ic("users", 22)}<div>Yukarıya bir hesap adı yazıp karşılaştırmaya başla.</div></div>` : ""}</div>
    <div id="rvPosts"></div>`;
  const showPosts = (name) => {
    const x = rows.find((y) => y.username === name && y.ok);
    const box = $("#rvPosts", body);
    if (!x) return (box.innerHTML = "");
    const media = x.media || [];
    const best = Math.max(0, ...media.map((m) => (m.like_count || 0) + (m.comments_count || 0)));
    box.innerHTML = `<h3 class="rv-h">@${esc(x.username)} · son ${media.length} paylaşım</h3>${x.biography ? `<div class="sm muted" style="margin:-4px 0 10px;white-space:pre-wrap">${esc(x.biography)}</div>` : ""}
      <div class="grid">${media.map((m) => `<a class="tile" href="${esc(m.permalink || "#")}" target="_blank" title="${esc((m.caption || "").slice(0, 200))}">
        <img src="${esc(m.thumbnail_url || m.media_url || "")}" alt="" loading="lazy">
        ${m.media_product_type === "REELS" ? `<span class="kind">${ic("clapperboard", 14)}</span>` : m.media_type === "CAROUSEL_ALBUM" ? `<span class="kind">${ic("gallery-horizontal-end", 14)}</span>` : ""}
        ${best && (m.like_count || 0) + (m.comments_count || 0) === best ? `<span class="studio">${ic("trending-up", 12)} En iyisi</span>` : ""}
        <span class="ov">${ic("heart", 14)}${m.like_count == null ? "gizli" : nf(m.like_count)} ${ic("message-circle", 14)}${nf(m.comments_count)}<span class="grow"></span><span class="sm" style="font-weight:400">${ago(m.timestamp)}</span></span></a>`).join("")}</div>`;
  };
  for (const tr of $$("tr[data-rv]", body))
    tr.onclick = (e) => {
      if (e.target.closest("[data-rm]")) return;
      A.rv = tr.dataset.rv;
      $$("tr[data-rv]", body).forEach((y) => y.classList.toggle("sel", y === tr));
      showPosts(A.rv);
    };
  for (const b of $$("[data-rm]", body))
    b.onclick = X.guard(async () => {
      if (!confirm(`@${b.dataset.rm} izlemeden çıkarılsın mı?`)) return;
      const res = await X.api("/api/ig/rivals/remove", { username: b.dataset.rm });
      if (!res.ok) throw new Error(res.error.message);
      renderRivals(X, body, true);
    });
  const addBtn = $("#rvAdd", body);
  const doAdd = X.guard(async () => {
    const name = $("#rvName", body).value.trim();
    if (!name) return;
    addBtn.disabled = true;
    addBtn.innerHTML = `${ic("loader-circle", 15, "spin")}Aranıyor…`;
    try {
      const res = await X.api("/api/ig/rivals/add", { username: name });
      if (!res.ok) throw new Error(res.error.message);
      A.rv = res.data[res.data.length - 1];
      X.toast("İzlemeye alındı");
      await renderRivals(X, body, true);
    } finally {
      if (addBtn.isConnected) {
        addBtn.disabled = false;
        addBtn.innerHTML = `${ic("user-plus", 15)}İzlemeye al`;
      }
    }
  });
  addBtn.onclick = doAdd;
  $("#rvName", body).onkeydown = (e) => {
    if (e.key === "Enter") doAdd();
  };
  if (A.rv) showPosts(A.rv);
}
