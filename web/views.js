let TS = null;
const tsReady = import("/web/tplstudio.js").then((m) => (TS = m)).catch(() => null);

import { durSlider, bindDurSlider, estHtml } from "/web/durslider.js";
import { pickVideoForTemplate } from "/web/totemplate.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const FORMATS = [["9:16", "Reels / Hikâye"], ["4:5", "Gönderi"], ["1:1", "Kare"], ["16:9", "Yatay"]];
const TONES = ["Eğitici", "Samimi", "Eğlenceli", "Profesyonel", "İlham verici", "Merak uyandıran", "Dramatik"];
const STYLES = ["Minimal", "Canlı ve renkli", "Koyu sinematik", "Pastel", "Retro", "Kurumsal", "El çizimi"];
const CTAS = ["Takip et", "Kaydet", "Yorum yaz", "Paylaş", "Profildeki link"];
const KIND = { new: "Yeni video", note: "Revizyon", caption: "Açıklama", ideas: "Fikir yazımı" };
const DRAFT_KEY = "sosyal-studyo-draft";
const RS_ICON = { png: "image", html: "globe", text: "file-text" };
const webUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
const hostOf = (u) => {
  try {
    return new URL(u).host.replace(/^www\./, "");
  } catch {
    return u || "";
  }
};

function blankDraft() {
  return { concept: "", title: "", audience: "", points: "", duration: 30, format: "9:16", tone: "", style: "", autoColors: true,
    colors: ["#FF6A3D", "#E1306C", "#0E1116"], voiceover: true, subtitles: true, music: "auto", cta: "Takip et", ctaCustom: "", links: "", refs: [],
    template: "", mode: "new", source: null, research: [] };
}

function loadDraft() {
  try {
    return Object.assign(blankDraft(), JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"));
  } catch {
    return blankDraft();
  }
}

function saveDraft(d) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {}
}

export function ago(iso) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 50) return "az önce";
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  if (s < 86400) return `${Math.round(s / 3600)} sa önce`;
  return `${Math.round(s / 86400)} gün önce`;
}

function since(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} sn` : s < 3600 ? `${Math.floor(s / 60)} dk ${s % 60} sn` : `${Math.floor(s / 3600)} sa ${Math.floor((s % 3600) / 60)} dk`;
}

// ---------- create ----------

function tplGridHtml(X, d) {
  const { S, ic, esc } = X;
  return `<button class="tpl ${d.template ? "" : "active"}" data-t=""><div class="tpl-auto">${ic("wand-sparkles", 26)}<span>Serbest tasarım</span></div><div class="tpl-name">Şablonsuz, özgün</div></button>
    ${(S.templates || []).map((t) => `<button class="tpl ${d.template === t.id ? "active" : ""}" data-t="${t.id}" title="${esc(t.description || "")}">
      <div class="tpl-media">${t.poster ? `<img src="${t.poster}" alt=""><video src="${t.preview}" muted loop playsinline preload="none"></video>` : `<div class="tpl-auto">${ic("film", 24)}</div>`}
        ${t.custom ? `<span class="tpl-own">Senin</span>` : ""}<span class="tpl-zoom" data-zoom="${t.id}" title="Büyük ekranda izle">${ic("maximize-2", 14)}</span></div>
      <div class="tpl-name">${esc(t.name)}</div><div class="tpl-for">${esc(t.best_for || "")}</div></button>`).join("")}
    ${TS ? TS.tplRequestCards(X, (S.tpl_requests || []).filter((r) => r.status !== "hazir")) : ""}
    <button class="tpl tpl-new" data-new-tpl><div class="tpl-auto">${ic("circle-plus", 28)}<span>Kendi şablonunu oluştur</span></div><div class="tpl-name">Yeni şablon</div><div class="tpl-for">Sorularla anlat ya da referans ver</div></button>
    <button class="tpl tpl-new" data-from-video><div class="tpl-auto">${ic("copy-plus", 28)}<span>Videodan şablon al</span></div><div class="tpl-name">Videodan al</div><div class="tpl-for">Beğendiğin bir videonun stilini kaydet</div></button>`;
}

function bindTplGrid(X) {
  const grid = $("#cTpl");
  if (!grid) return;
  for (const card of $$(".tpl", grid)) {
    const v = $("video", card);
    if (!v) continue;
    card.onmouseenter = () => v.play().catch(() => {});
    card.onmouseleave = () => {
      v.pause();
      v.currentTime = 0;
    };
  }
  TS?.bindRequestCards(X, grid);
}

export function refreshTplGrid(X) {
  const grid = $("#cTpl");
  if (!grid || !X.S.draft) return;
  grid.innerHTML = tplGridHtml(X, X.S.draft);
  bindTplGrid(X);
}

const mmss = (v) => `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, "0")}`;

function uploadMedia(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name || "kayit"));
    xhr.setRequestHeader("X-Allow-Video", "1");
    xhr.setRequestHeader("X-Allow-Audio", "1");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let j = {};
      try {
        j = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 && j.id) resolve(j);
      else reject(new Error(j.error || "yükleme hatası"));
    };
    xhr.onerror = () => reject(new Error("bağlantı hatası"));
    xhr.send(file);
  });
}

function mediaDuration(url, kind) {
  return new Promise((resolve) => {
    const m = document.createElement(kind);
    m.preload = "metadata";
    m.onloadedmetadata = () => resolve(Number.isFinite(m.duration) ? m.duration : null);
    m.onerror = () => resolve(null);
    m.src = url;
  });
}

function sourceHtml(X, d) {
  const { S, ic, esc } = X;
  const s = d.source;
  if (S.srcUp) {
    return `<div class="srcbox up"><div class="srcup-h">${ic("upload", 15)}<b>${esc(S.srcUp.name)}</b><span class="grow"></span><i id="srcPct">${Math.round(S.srcUp.pct * 100)}%</i></div>
      <div class="srcbar"><i id="srcBar" style="width:${Math.round(S.srcUp.pct * 100)}%"></i></div></div>`;
  }
  if (!s) {
    return `<label class="drop srcdrop" id="srcDrop">${ic("file-audio", 22)}<b>Ses ya da video yükle</b>
      <span class="sm muted">Sürükle-bırak ya da tıkla · mp3, wav, m4a · mp4, mov, webm · en fazla 10 dakika</span>
      <input type="file" id="srcFile" accept="audio/*,video/*,.m4a,.opus" hidden></label>`;
  }
  const video = s.kind === "video";
  return `<div class="srcbox">
    <div class="srcmedia ${video ? "v" : "a"}">${video ? `<video src="${s.url}" controls preload="metadata" playsinline></video>` : `<audio src="${s.url}" controls preload="metadata"></audio>`}</div>
    <div class="srcmeta"><span class="srck">${ic(video ? "film" : "mic", 14)}${video ? "Video" : "Ses kaydı"}</span><b title="${esc(s.name)}">${esc(s.name)}</b>
      <span class="muted">${s.duration ? mmss(s.duration) : ""}</span><span class="grow"></span>
      <button class="btn ghost sm" id="srcDel">${ic("x", 14)}Değiştir</button></div>
    ${video ? `<div class="seg srcvis" id="cVisual"><button data-v="1" class="${s.visual !== false ? "active" : ""}">${ic("layers", 14)}Videonun üstüne ekle</button><button data-v="0" class="${s.visual === false ? "active" : ""}">${ic("mic", 14)}Sadece sesini kullan</button></div>
      <div class="sm muted">${s.visual !== false ? "Görüntü aynen kalır; altyazı, başlıklar ve grafikler videonun üstüne eklenir." : "Videonun sesi seslendirme olur; görselleri ajan baştan tasarlar."}</div>` : `<div class="sm muted">Kaydın seslendirme olarak kullanılır; görselleri ajan konuşmaya göre tasarlar.</div>`}
  </div>`;
}

const sttBusy = (s) => s && (s.state === "installing" || s.state === "downloading");
const gb = (b) => (b < 1e9 ? `${Math.round(b / 1e6).toLocaleString("tr-TR")} MB` : `${(b / 1e9).toLocaleString("tr-TR", { maximumFractionDigits: 2 })} GB`);
const sttText = (s) => (s.state === "installing" ? "Bileşen kuruluyor…" : `${gb(s.done)} / ${gb(s.total || s.size)} · %${Math.round((s.done / (s.total || s.size)) * 100)}`);

function sttHtml(X) {
  const { S, ic, esc } = X;
  const s = S.stt;
  if (!s || s.ready) return "";
  const busy = sttBusy(s);
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const resume = !busy && s.done > 0 && s.state !== "error";
  return `<div class="sttbox ${busy ? "busy" : ""}">
    <div class="stt-h"><span class="stt-i">${ic("download", 18)}</span><div class="grow"><b>Konuşma tanıma modeli gerekli</b>
      <div class="sm muted">Hazır sesi yazıya dökmek için bir kerelik indirme (~${gb(s.size)}). Bilgisayarında çalışır, kredi harcamaz.</div></div>
      ${busy ? `<button class="btn ghost sm" id="sttCancel" ${s.state === "installing" ? "disabled" : ""}>${ic("x", 14)}İptal</button>` : `<button class="btn primary sm" id="sttGo">${ic("download", 14)}${resume ? "Devam et" : "İndir"}</button>`}</div>
    ${busy ? `<div class="srcbar ${s.state === "installing" ? "indet" : ""}"><i id="sttBar" style="width:${pct}%"></i></div><div class="sm muted" id="sttTxt">${sttText(s)}</div>` : ""}
    ${s.state === "error" ? `<div class="warnline sm">${ic("triangle-alert", 13)} ${esc(s.error || "indirme başarısız")}</div>` : ""}
  </div>`;
}

function watchStt(X) {
  const { S } = X;
  clearTimeout(S.sttTimer);
  S.sttTimer = null;
  const tick = async () => {
    let s = null;
    try {
      s = await (await fetch("/api/stt")).json();
    } catch {}
    if (!s) return;
    const prev = S.stt;
    S.stt = s;
    if (sttBusy(s)) S.sttTimer = setTimeout(tick, 1000);
    if (S.tab !== "create" || S.draft?.mode !== "source") return;
    if (!prev || prev.ready !== s.ready || prev.state !== s.state) return renderCreate(X);
    const bar = $("#sttBar");
    if (bar) bar.style.width = `${s.total ? Math.round((s.done / s.total) * 100) : 0}%`;
    const t = $("#sttTxt");
    if (t) t.textContent = sttText(s);
  };
  tick();
}

function bindStt(X) {
  const { S, api, guard } = X;
  const go = $("#sttGo");
  if (go) {
    go.onclick = guard(async () => {
      S.stt = await api("/api/stt/install", {});
      renderCreate(X);
      watchStt(X);
    });
  }
  const stop = $("#sttCancel");
  if (stop) {
    stop.onclick = guard(async () => {
      await api("/api/stt/cancel", {});
    });
  }
}

function researchPaneHtml(X, d) {
  const { ic, esc } = X;
  const items = d.research || [];
  if (!items.length) return "";
  return `<div class="pane"><h3>${ic("library", 14)}Araştırma <span class="grow muted sm">${items.length} kaynak</span></h3>
    <div class="rsl" id="rsList">${items.map((r, i) => {
      const url = webUrl(r.url);
      return `<div class="rsi"><span class="rsk">${ic(RS_ICON[r.kind] || "file-text", 15)}</span>
        <div class="grow rsb"><b title="${esc(r.title || "")}">${esc(r.title || "Adsız")}</b>
          ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="sm" title="${esc(url)}">${esc(hostOf(url))}</a>` : ""}
          ${r.excerpt && r.excerpt !== r.title ? `<div class="sm muted rsx">${esc(r.excerpt)}</div>` : ""}
          ${r.note ? `<div class="sm rsn">${esc(r.note)}</div>` : ""}</div>
        <button class="btn ghost icon" data-rdel="${i}" title="Kaldır">${ic("x", 15)}</button></div>`;
    }).join("")}</div>
    <div class="sm muted" style="margin-top:8px">Tarayıcıdan gönderdiğin sayfalar ve notlar burada; ajan videoyu hazırlarken bunları okur. Ekran görüntüleri görsel referanslara eklenir.</div></div>`;
}

export function addResearchToDraft(X, payload) {
  const d = (X.S.draft ||= loadDraft());
  d.refs ||= [];
  d.research ||= [];
  let added = 0;
  for (const r of payload?.refs || []) {
    if (d.refs.some((x) => x.id === r.id || (r.rid && x.rid === r.rid))) continue;
    d.refs.push({ id: r.id, name: r.name, url: r.url, note: r.note || "", use: !!r.use, rid: r.rid || null });
    added++;
  }
  for (const r of payload?.research || []) {
    if (d.research.some((x) => x.id === r.id)) continue;
    d.research.push({ id: r.id, kind: r.kind, title: r.title || "", url: r.url || "", excerpt: r.excerpt || "", note: r.note || "" });
    added++;
  }
  saveDraft(d);
  if (X.S.tab === "create") renderCreate(X);
  return added;
}

export function renderCreate(X) {
  const { S, ic, esc, api, toast, guard } = X;
  const el = $("#createView");
  const d = (S.draft ||= loadDraft());
  const n = S.settings.narrator || {};
  const left = S.credits?.left;
  const src = d.mode === "source";
  const footage = src && d.source?.kind === "video" && d.source.visual !== false;
  const chips = (id, list, cur) => `<div class="chips" id="${id}">${list.map((t) => `<button data-v="${esc(t)}" class="${cur === t ? "active" : ""}">${esc(t)}</button>`).join("")}</div>`;
  el.innerHTML = `<div class="create">
    <div class="cform">
      <h2>${ic("sparkles", 20)}Yeni video</h2>
      <div class="seg cmode" id="cMode"><button data-v="new" class="${src ? "" : "active"}">${ic("pen-line", 14)}Sıfırdan yaz</button><button data-v="source" class="${src ? "active" : ""}">${ic("file-audio", 14)}Hazır ses / video</button></div>
      ${src ? `<div class="srcwrap">${sttHtml(X)}${sourceHtml(X, d)}</div>` : ""}
      <label>Konsept ${src ? `<span class="muted">(isteğe bağlı)</span>` : `<span class="req">*</span>`}</label>
      <textarea id="cConcept" rows="${src ? 3 : 6}" placeholder="${src ? "Videoda neler öne çıksın? ör. rakamları büyük yazıyla göster, ürün adını vurgula, sonda takip çağrısı…" : "Videonun fikri: ne anlatılacak, nasıl bir akış, sonunda ne olacak…"}">${esc(d.concept)}</textarea>
      <div class="grid2">
        <div><label>Başlık</label><input id="cTitle" placeholder="Boş kalırsa konseptten alınır" value="${esc(d.title)}"></div>
        <div><label>Hedef kitle</label><input id="cAudience" placeholder="ör. yeni başlayan içerik üreticileri" value="${esc(d.audience)}"></div>
      </div>
      <label>Mutlaka geçmesi gerekenler <span class="muted">(her satır bir madde)</span></label>
      <textarea id="cPoints" rows="3" placeholder="3 ipucu: tutarlılık, kanca, kaydetme çağrısı">${esc(d.points)}</textarea>
      <div class="grid2">
        <div><label>Süre</label>${src ? `<div class="srcdur">${d.source?.duration ? `${ic("timer", 14)}Kaynak kadar · <b>${mmss(d.source.duration)}</b></div>${estHtml(Math.round(d.source.duration), false)}` : `${ic("timer", 14)}Dosya yüklenince belirlenir</div>`}` : durSlider("cDur", d.duration)}</div>
        <div><label>Format</label><div class="seg" id="cFormat">${FORMATS.map(([v, t]) => `<button data-v="${v}" class="${d.format === v ? "active" : ""}" title="${t}"><span class="ratio r${v.replace(":", "x")}"></span>${v}</button>`).join("")}</div></div>
      </div>
      ${footage ? `<label>Video stili</label><div class="srcnote">${ic("layers", 15)}<span>Görüntü senin videon olduğu için şablon kullanılmaz; yazı ve grafikler videonun üstüne, aşağıdaki ton ve renklere göre eklenir.</span></div>` : `<label>Video stili <span class="muted">(üzerine gelince örnek oynar, ${ic("maximize-2", 12)} ile büyük ekranda izle)</span></label>
      <div class="tpls" id="cTpl">${tplGridHtml(X, d)}</div>`}
      <label>Ton</label>${chips("cTone", TONES, d.tone)}
      <label>Görsel stil</label>${chips("cStyle", STYLES, d.style)}
      <label>Renkler</label>
      <div class="row wrap">
        <label class="switch"><input type="checkbox" id="cAuto" ${d.autoColors ? "checked" : ""}><span></span>Ajan seçsin</label>
        <div class="row colors ${d.autoColors ? "off" : ""}" id="cColors">${d.colors.map((c, i) => `<label class="swatch" title="${["Ana renk", "İkinci renk", "Arka plan"][i]}"><input type="color" data-i="${i}" value="${c}"><span>${["Ana", "İkinci", "Zemin"][i]}</span></label>`).join("")}</div>
      </div>
      <div class="grid3">
        <div><label>Seslendirme</label>${src ? `<div class="srcvoice">${ic("mic", 14)}Hazır ses</div>` : `<label class="switch"><input type="checkbox" id="cVoice" ${d.voiceover ? "checked" : ""}><span></span>${n.name ? `ElevenLabs · ${esc(n.name)}` : "ElevenLabs"}</label>`}</div>
        <div><label>Altyazı</label><label class="switch"><input type="checkbox" id="cSubs" ${d.subtitles ? "checked" : ""}><span></span>Kelime kelime</label></div>
        <div><label>Müzik</label><div class="seg" id="cMusic"><button data-v="auto" class="${d.music === "auto" ? "active" : ""}">Ajan seçsin</button><button data-v="none" class="${d.music === "none" ? "active" : ""}">Müziksiz</button></div></div>
      </div>
      <label>Kapanış çağrısı</label>${chips("cCta", CTAS, d.ctaCustom ? "" : d.cta)}
      <input id="cCtaCustom" placeholder="ya da kendi cümlen: ör. Ücretsiz rehber için profildeki linke tıkla" value="${esc(d.ctaCustom)}" style="margin-top:8px">
    </div>
    <div class="cside">
      <div class="pane"><h3>${ic("image", 14)}Görsel referanslar <span class="grow muted sm">${d.refs.length ? d.refs.length + " görsel" : ""}</span></h3>
        <label class="drop" id="drop">${ic("upload", 22)}<b>Görsel ekle</b><span class="sm muted">Sürükle-bırak, tıkla ya da Ctrl+V ile yapıştır</span><input type="file" id="cFiles" accept="image/*" multiple hidden></label>
        <div class="refs" id="refList">${d.refs.map((r, i) => `<div class="ref" data-i="${i}">
          <a href="${r.url}" target="_blank"><img src="${r.url}" alt=""></a>
          <div class="grow stack">
            <input class="rnote" data-i="${i}" placeholder="Bu görselde ne önemli? (renk, yazı stili, düzen…)" value="${esc(r.note || "")}">
            <div class="seg sm"><button data-use="0" data-i="${i}" class="${r.use ? "" : "active"}">Stil referansı</button><button data-use="1" data-i="${i}" class="${r.use ? "active" : ""}">Videoda kullan</button></div>
          </div>
          <button class="btn ghost icon" data-del="${i}" title="Kaldır">${ic("x", 15)}</button></div>`).join("")}</div>
        <div class="sm muted" style="margin-top:8px"><b>Stil referansı:</b> ajan renk, tipografi ve düzeni buna göre kurar. <b>Videoda kullan:</b> görsel (logo, ürün, fotoğraf) videoya yerleştirilir.</div>
      </div>
      ${researchPaneHtml(X, d)}
      <div class="pane"><h3>${ic("link", 14)}Referans bağlantıları</h3>
        <textarea id="cLinks" rows="3" placeholder="Beğendiğin videolar, örnek hesaplar… (her satır bir bağlantı)">${esc(d.links)}</textarea></div>
      <div class="pane send">
        ${src ? `<div class="row"><span class="grow">${ic("mic", 15)} Seslendirme</span><b>Hazır ses · 0 kredi</b></div>
        <div class="row sm muted"><span class="grow">Konuşma yerelde yazıya dökülür; altyazı ve sahneler senin sesine oturur.</span></div>` : `<div class="row"><span class="grow">${ic("mic", 15)} Tahmini seslendirme</span><b>~${d.voiceover ? d.duration * 15 : 0} karakter</b></div>
        ${left != null ? `<div class="row sm ${d.voiceover && d.duration * 15 > left ? "warnline" : "muted"}"><span class="grow">ElevenLabs kalan</span>${left.toLocaleString("tr-TR")} karakter</div>` : ""}
        ${d.voiceover && !n.voice_id ? `<div class="warnline sm">${ic("triangle-alert", 13)} Ayarlar'dan anlatıcı sesi seç</div>` : ""}`}
        <button class="btn primary wide big" id="cGo">${ic("send", 17)}Ajanlara gönder</button>
        <button class="btn ghost wide sm" id="cReset">Formu temizle</button>
      </div>
    </div>
  </div>`;

  const sync = () => {
    d.concept = $("#cConcept").value;
    d.title = $("#cTitle").value;
    d.audience = $("#cAudience").value;
    d.points = $("#cPoints").value;
    d.links = $("#cLinks").value;
    d.ctaCustom = $("#cCtaCustom").value;
    d.autoColors = $("#cAuto").checked;
    if ($("#cVoice")) d.voiceover = $("#cVoice").checked;
    d.subtitles = $("#cSubs").checked;
    $$("#cColors input").forEach((c) => (d.colors[+c.dataset.i] = c.value));
    $$(".rnote").forEach((c) => (d.refs[+c.dataset.i].note = c.value));
    saveDraft(d);
  };
  el.oninput = sync;
  el.onchange = (e) => {
    if (e.target.id === "srcFile") return;
    sync();
    if (["cAuto", "cVoice"].includes(e.target.id)) renderCreate(X);
  };
  const seg = (id, key, cast = (v) => v) =>
    ($(`#${id}`).onclick = (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      d[key] = d[key] === cast(b.dataset.v) && ["tone", "style"].includes(key) ? "" : cast(b.dataset.v);
      if (key === "cta") d.ctaCustom = "";
      sync();
      renderCreate(X);
    });
  if (!src) {
    bindDurSlider($("#cDur"), (v) => {
      d.duration = v;
      sync();
      renderCreate(X);
    });
  }
  $("#cMode").onclick = (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b || b.dataset.v === d.mode) return;
    sync();
    d.mode = b.dataset.v;
    saveDraft(d);
    renderCreate(X);
  };
  if (src) {
    bindSource(X, d);
    bindStt(X);
    if (!S.stt || (!S.stt.ready && !S.sttTimer)) watchStt(X);
  }
  seg("cFormat", "format");
  seg("cTone", "tone");
  seg("cStyle", "style");
  seg("cMusic", "music");
  seg("cCta", "cta");
  const pick = (id) => {
    sync();
    d.template = id;
    saveDraft(d);
    renderCreate(X);
  };
  if (!footage) $("#cTpl").onclick = (e) => {
    const zoom = e.target.closest("[data-zoom]");
    if (zoom) {
      e.stopPropagation();
      return TS ? TS.openTemplateViewer(X, S.templates || [], zoom.dataset.zoom, zoom.closest(".tpl").querySelector(".tpl-media"), pick) : toast("Büyük ekran izleyici yükleniyor, birazdan tekrar dene");
    }
    if (e.target.closest("[data-new-tpl]")) return TS ? TS.openTemplateWizard(X) : toast("Şablon oluşturucu yükleniyor, birazdan tekrar dene");
    if (e.target.closest("[data-from-video]")) return pickVideoForTemplate(X, () => renderCreate(X));
    if (e.target.closest("[data-req]")) return;
    const b = e.target.closest("[data-t]");
    if (b) pick(b.dataset.t);
  };
  if (!footage) bindTplGrid(X);
  if (!TS && !footage) tsReady.then((m) => m && refreshTplGrid(X));
  $("#refList").onclick = (e) => {
    const del = e.target.closest("[data-del]");
    const use = e.target.closest("[data-use]");
    if (del) d.refs.splice(+del.dataset.del, 1);
    else if (use) d.refs[+use.dataset.i].use = use.dataset.use === "1";
    else return;
    saveDraft(d);
    renderCreate(X);
  };
  const rsList = $("#rsList");
  if (rsList) {
    rsList.onclick = (e) => {
      const del = e.target.closest("[data-rdel]");
      if (!del) return;
      d.research.splice(+del.dataset.rdel, 1);
      saveDraft(d);
      renderCreate(X);
    };
  }
  const add = guard(async (files) => {
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    sync();
    for (const f of imgs) {
      const r = await fetch("/api/uploads", { method: "POST", headers: { "X-Filename": encodeURIComponent(f.name || "yapistirilan.png") }, body: f });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "yükleme hatası");
      d.refs.push({ id: j.id, name: j.name, url: j.url, note: "", use: false });
    }
    saveDraft(d);
    renderCreate(X);
    toast(`${imgs.length} görsel eklendi`);
  });
  $("#cFiles").onchange = (e) => add(e.target.files);
  const drop = $("#drop");
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add("over");
  };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    add(e.dataTransfer.files);
  };
  X.onPaste = (e) => {
    if (S.tab !== "create") return;
    const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
    if (files.length) {
      e.preventDefault();
      add(files);
    }
  };
  $("#cReset").onclick = () => {
    if (!confirm("Form temizlensin mi?")) return;
    S.draft = blankDraft();
    saveDraft(S.draft);
    renderCreate(X);
  };
  $("#cGo").onclick = guard(async () => {
    sync();
    if (src && S.srcUp) throw new Error("Dosya yükleniyor, bitmesini bekle");
    if (src && !d.source) throw new Error("Önce hazır ses ya da videoyu yükle");
    if (src && S.stt && !S.stt.ready) throw new Error("Önce konuşma tanıma modelini indir");
    if (!src && !d.concept.trim()) {
      $("#cConcept").focus();
      throw new Error("Konsept boş olamaz");
    }
    const brief = {
      format: d.format, tone: d.tone, style: d.style, audience: d.audience.trim(),
      key_points: d.points.split("\n").map((x) => x.trim()).filter(Boolean),
      colors: d.autoColors ? [] : d.colors, voiceover: d.voiceover, subtitles: d.subtitles,
      music: d.music === "none" ? "müziksiz" : "ajan seçsin", cta: d.ctaCustom.trim() || d.cta,
      links: d.links.split("\n").map((x) => x.trim()).filter(Boolean),
      template: footage ? "" : d.template || "",
    };
    const body = { concept: d.concept, title: d.title, duration: d.duration, brief, refs: d.refs.map((r) => ({ id: r.id, name: r.name, note: r.note, use: r.use })), research: (d.research || []).map((r) => r.id) };
    if (src) body.source = { id: d.source.id, name: d.source.name, visual: d.source.visual !== false };
    const p = await api("/api/posts", body);
    S.draft = blankDraft();
    saveDraft(S.draft);
    toast("Ajanlara gönderildi");
    X.setTab("posts");
    X.select(p.id);
  });
}

function bindSource(X, d) {
  const { S, toast } = X;
  const box = $("#srcDrop");
  const take = async (files) => {
    const f = [...(files || [])].find((x) => /^(audio|video)\//.test(x.type) || /\.(m4a|opus|mp3|wav|ogg|flac|aac|mp4|mov|m4v|webm)$/i.test(x.name));
    if (!f) return toast("Ses ya da video dosyası seç", true);
    S.srcUp = { name: f.name, pct: 0 };
    renderCreate(X);
    try {
      const j = await uploadMedia(f, (pct) => {
        S.srcUp.pct = pct;
        const bar = $("#srcBar");
        if (bar) bar.style.width = `${Math.round(pct * 100)}%`;
        const t = $("#srcPct");
        if (t) t.textContent = `${Math.round(pct * 100)}%`;
      });
      const kind = /\.(mp4|mov|m4v|webm)$/i.test(j.id) ? "video" : "audio";
      const dur = await mediaDuration(j.url, kind);
      S.srcUp = null;
      if (dur && dur > 600) {
        renderCreate(X);
        return toast(`Bu dosya ${mmss(dur)}; en fazla 10 dakika olabilir`, true);
      }
      d.source = { id: j.id, name: j.name, url: j.url, kind, duration: dur, visual: true };
      if (!d.title.trim()) d.title = j.name.replace(/\.[^.]+$/, "").slice(0, 60);
      saveDraft(d);
      renderCreate(X);
      toast(kind === "video" ? "Video yüklendi" : "Ses kaydı yüklendi");
    } catch (e) {
      S.srcUp = null;
      renderCreate(X);
      toast(e.message, true);
    }
  };
  if (box) {
    $("#srcFile").onchange = (e) => take(e.target.files);
    box.ondragover = (e) => {
      e.preventDefault();
      box.classList.add("over");
    };
    box.ondragleave = () => box.classList.remove("over");
    box.ondrop = (e) => {
      e.preventDefault();
      box.classList.remove("over");
      take(e.dataTransfer.files);
    };
  }
  const del = $("#srcDel");
  if (del) {
    del.onclick = () => {
      d.source = null;
      saveDraft(d);
      renderCreate(X);
    };
  }
  const vis = $("#cVisual");
  if (vis) {
    vis.onclick = (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      d.source.visual = b.dataset.v === "1";
      saveDraft(d);
      renderCreate(X);
    };
  }
}

// ---------- AI panel ----------

export function renderAI(X) {
  const { S, ic, esc } = X;
  const el = $("#aiView");
  const scroll = $(".feed", el)?.scrollTop || 0;
  const title = (id) => S.posts.find((p) => p.id === id)?.title || (S.ideas || []).find((b) => b.id === id)?.topic || (id ? `#${id}` : "");
  const card = (a) => {
        const p = S.posts.find((x) => x.id === a.post);
        const st = a.live === "working" ? ["work", "Çalışıyor"] : a.live === "watching" ? ["ok", "Hazır, iş bekliyor"] : ["off", "Bağlı değil"];
        return `<div class="agent-card ${st[0]}">
          <div class="row"><span class="ag-ic">${ic("bot", 20)}</span><div class="grow"><b>${esc(a.name)}</b><div class="sm">${st[1]}</div></div>${a.live === "working" ? `<span class="sm muted">${since(a.since)}</span>` : ""}</div>
          ${a.live === "working" && p ? `<div class="now"><div class="sm muted">Şu an</div><div class="step">${ic("loader-circle", 14, "spin")} ${esc(a.text || p.stage || "")}</div>
            <a href="#${p.id}" class="sm postlink">#${p.id} · ${esc(p.title)}</a><div class="bar"><i style="width:${Math.round((p.progress || 0) * 100)}%"></i></div></div>` : ""}
        </div>`;
  };
  const on = S.agents.filter((a) => a.live === "working" || a.live === "watching");
  const off = S.agents.filter((a) => !on.includes(a));
  const agents = (on.length ? on.map(card).join("") : `<div class="empty sm">Bağlı ajan yok. Ajan oturumu <code>studio.py wait</code> ile iş beklemeye başlayınca burada görünür.</div>`)
    + (off.length ? `<details class="ag-off"${S.aiOffOpen ? " open" : ""}><summary>${ic("unplug", 14)}${off.length} ajan bağlı değil</summary><div class="stack">${off.map(card).join("")}</div></details>` : "");
  const q = S.queue || [];
  const queue = q.length
    ? `<ol class="queue">${q.map((j, i) => `<li><span class="qn">${i + 1}</span><div class="grow"><span class="badge q-${j.kind}">${KIND[j.kind]}</span> <a href="#${j.post}" class="postlink">${esc(j.title)}</a><div class="sm muted">${ago(j.since)} eklendi</div></div></li>`).join("")}</ol>`
    : `<div class="empty sm">Sırada iş yok.</div>`;
  const icons = { claim: "bot", stage: "loader-circle", step: "chevron-right", done: "circle-check", error: "triangle-alert", queue: "plus", schedule: "calendar-clock", publish: "send", info: "message-circle" };
  const feed = (S.activity || []).length
    ? (S.activity || []).map((a, i) => `<div class="act k-${a.kind}${i < (S.freshActivity || 0) ? " fresh" : ""}">
        <span class="aic">${ic(icons[a.kind] || "chevron-right", 14)}</span>
        <div class="grow"><div>${esc(a.text)}</div><div class="sm muted">${a.agent ? esc(a.agent) + " · " : ""}${a.post ? `<a href="#${a.post}" class="postlink">#${a.post} ${esc(title(a.post))}</a> · ` : ""}${new Date(a.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div></div></div>`).join("")
    : `<div class="empty sm">Henüz etkinlik yok.</div>`;
  el.innerHTML = `<div class="ai">
    <div class="ai-col">
      <h3>${ic("bot", 15)}Ajanlar</h3><div class="stack">${agents}</div>
      <h3 style="margin-top:22px">${ic("list", 15)}Sıradaki işler <span class="muted">${q.length || ""}</span></h3>${queue}
    </div>
    <div class="ai-col feed-col">
      <h3>${ic("eye", 15)}Canlı akış <span class="live-dot"></span></h3>
      <div class="feed">${feed}</div>
    </div>
  </div>`;
  $(".feed", el).scrollTop = scroll;
  const offBox = $(".ag-off", el);
  if (offBox) offBox.ontoggle = () => (S.aiOffOpen = offBox.open);
}
