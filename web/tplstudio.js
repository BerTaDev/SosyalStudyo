const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const EASE = "cubic-bezier(.22,.9,.24,1)";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pad2 = (n) => String(n).padStart(2, "0");
const done = (a, fn) => {
  let ran = false;
  const once = () => {
    if (ran) return;
    ran = true;
    fn();
  };
  a.finished.then(once, once);
  setTimeout(once, (a.effect?.getTiming?.().duration || 500) + 400);
};

function unload(v) {
  v.pause();
  v.removeAttribute("src");
  v.load();
}

function radiusOf(el) {
  return parseFloat(getComputedStyle(el).borderTopLeftRadius) || 8;
}

function shown(el) {
  if (!el?.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
  return r;
}

// ---------- viewer ----------

export function openTemplateViewer(X, templates, startId, fromEl, onPick) {
  const { ic, esc } = X;
  const list = (templates || []).filter((t) => t && t.id);
  if (!list.length) return null;
  const n = list.length;
  const rm = reduced();
  const pool = new Map();
  const prevFocus = document.activeElement;
  const mediaCls = fromEl?.classList?.[0] || "";
  const hosted = !!fromEl?.closest?.("[data-t]");
  let idx = Math.max(0, list.findIndex((t) => t.id === startId));
  let cur = null;
  let muted = true;
  let closing = false;
  let raf = 0;
  let sig = "";
  let sec = -2;
  let idleT = 0;
  let fold = "";
  let swiped = false;
  let down = null;

  const root = document.createElement("div");
  root.className = "tv" + (n < 2 ? " single" : "");
  root.tabIndex = -1;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Şablon önizleme");
  root.innerHTML = `<div class="tv-back" data-bg></div>
    <div class="tv-main" data-bg>
      <button class="tv-nav l" data-act="prev" title="Önceki (←)" aria-label="Önceki">${ic("chevron-left", 26)}</button>
      <div class="tv-player">
        <div class="tv-slides"></div>
        <div class="tv-pulse"></div>
        <div class="tv-ctl">
          <button data-act="play" title="Oynat / durdur (Boşluk)"></button>
          <button data-act="restart" title="Baştan oynat">${ic("rotate-ccw", 16)}</button>
          <span class="tv-time"></span>
          <button data-act="mute" title="Ses (M)"></button>
        </div>
        <div class="tv-prog" data-act="seek"><i></i></div>
      </div>
      <aside class="tv-info"></aside>
      <button class="tv-nav r" data-act="next" title="Sonraki (→)" aria-label="Sonraki">${ic("chevron-right", 26)}</button>
    </div>
    <div class="tv-strip" data-bg><div class="tv-thumbs">${list.map((t, i) => `<button class="tv-th" data-i="${i}" title="${esc(t.name)}">${t.poster ? `<img src="${esc(t.poster)}" alt="" draggable="false">` : ic("film", 18)}</button>`).join("")}</div></div>
    <button class="tv-x" data-act="close" title="Kapat (Esc)" aria-label="Kapat">${ic("x", 20)}</button>`;
  document.body.append(root);

  const player = $(".tv-player", root);
  const slides = $(".tv-slides", root);
  const info = $(".tv-info", root);
  const strip = $(".tv-strip", root);
  const thumbs = $(".tv-thumbs", root);
  const ctl = $(".tv-ctl", root);
  const progBox = $(".tv-prog", root);
  const prog = $(".tv-prog i", root);
  const timeEl = $(".tv-time", root);
  const pulse = $(".tv-pulse", root);
  const playBtn = $('[data-act="play"]', root);
  const muteBtn = $('[data-act="mute"]', root);
  const restartBtn = $('[data-act="restart"]', root);

  const locate = (id) => {
    if (id === startId && fromEl?.isConnected) return fromEl;
    if (!hosted || !mediaCls) return null;
    for (const h of document.querySelectorAll(`[data-t="${CSS.escape(id)}"]`)) {
      if (root.contains(h)) continue;
      const m = h.querySelector("." + CSS.escape(mediaCls));
      if (shown(m)) return m;
    }
    return null;
  };

  const freshVideo = (t) => {
    const v = document.createElement("video");
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.disablePictureInPicture = true;
    v.setAttribute("playsinline", "");
    if (t.poster) v.poster = t.poster;
    v.src = t.preview;
    return v;
  };
  const takeVideo = (t) => {
    const v = pool.get(t.id);
    if (!v) return freshVideo(t);
    pool.delete(t.id);
    if (v.currentTime) v.currentTime = 0;
    return v;
  };
  const neighbours = () => {
    const s = new Set([list[(idx + 1) % n].id, list[(idx - 1 + n) % n].id]);
    s.delete(list[idx].id);
    return s;
  };
  const slideFor = (t) => {
    const s = document.createElement("div");
    s.className = "tv-slide";
    s.dataset.id = t.id;
    if (t.preview) s.append(takeVideo(t));
    else s.innerHTML = `<div class="tv-ph${t.poster ? "" : " bare"}">${t.poster ? `<img src="${esc(t.poster)}" alt="">` : ""}<div class="tv-ph-in">${ic("loader-circle", 26, "spin")}<b>Önizleme hazırlanıyor</b><span>Hazır olunca burada oynayacak</span></div></div>`;
    return s;
  };
  const release = (s) => {
    const v = $("video", s);
    if (v) {
      v.pause();
      const id = s.dataset.id;
      if (!closing && neighbours().has(id) && !pool.has(id)) pool.set(id, v);
      else unload(v);
    }
    s.remove();
  };
  const preload = () => {
    if (closing) return;
    const keep = neighbours();
    for (const [id, v] of pool) {
      if (keep.has(id)) continue;
      unload(v);
      pool.delete(id);
    }
    for (const id of keep) {
      const t = list.find((x) => x.id === id);
      if (t.poster) new Image().src = t.poster;
      if (t.preview && !pool.has(id) && !$$(".tv-slide", slides).some((s) => s.dataset.id === id)) pool.set(id, freshVideo(t));
    }
  };

  const video = () => cur && $("video", cur);
  const playCur = () => {
    const v = video();
    if (!v) return;
    v.muted = muted;
    v.play()?.catch?.(() => {});
  };
  const syncCtl = () => {
    const v = video();
    player.classList.toggle("novideo", !v);
    player.classList.toggle("paused", !v || v.paused);
    playBtn.innerHTML = ic(v && !v.paused ? "pause" : "play", 17);
    muteBtn.innerHTML = ic(muted ? "volume-x" : "volume-2", 17);
    for (const b of [playBtn, muteBtn, restartBtn]) b.disabled = !v;
  };
  const tick = () => {
    const v = video();
    const d = v?.duration;
    const ok = v && d && isFinite(d);
    prog.style.transform = `scaleX(${ok ? Math.min(1, v.currentTime / d) : 0})`;
    const s = `${!!v}${v?.paused}${muted}`;
    if (s !== sig) {
      sig = s;
      syncCtl();
    }
    const sc = ok ? Math.floor(v.currentTime) : -1;
    if (sc !== sec) {
      sec = sc;
      timeEl.textContent = ok ? `${fmt(v.currentTime)} / ${fmt(d)}` : "";
    }
    raf = requestAnimationFrame(tick);
  };
  const flash = (name) => {
    pulse.innerHTML = ic(name, 30);
    if (!rm) pulse.animate([{ opacity: 1, transform: "scale(.8)" }, { opacity: 0, transform: "scale(1.35)" }], { duration: 600, easing: "cubic-bezier(.2,.6,.3,1)" });
  };
  const wake = () => {
    player.classList.remove("idle");
    clearTimeout(idleT);
    idleT = setTimeout(() => {
      const v = video();
      if (v && !v.paused && !ctl.matches(":hover") && !closing) player.classList.add("idle");
    }, 2200);
  };
  const togglePlay = () => {
    const v = video();
    if (!v) return;
    if (v.paused) playCur();
    else v.pause();
    flash(v.paused ? "pause" : "play");
    wake();
  };
  const toggleMute = () => {
    muted = !muted;
    const v = video();
    if (v) v.muted = muted;
    flash(muted ? "volume-x" : "volume-2");
    wake();
  };
  const restart = () => {
    const v = video();
    if (!v) return;
    v.currentTime = 0;
    playCur();
    flash("rotate-ccw");
  };
  const seek = (e) => {
    const v = video();
    if (!v || !v.duration || !isFinite(v.duration)) return;
    const r = progBox.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.duration;
    wake();
  };

  const infoHtml = (t) => {
    const tags = (t.tags || []).filter(Boolean).map((g) => `<span class="chip">${esc(g)}</span>`).join("");
    return `<div class="tv-info-top">
        <div class="tv-kicker"><span>Video stili</span><span class="tv-count">${pad2(idx + 1)} / ${pad2(n)}</span></div>
        ${t.custom ? `<span class="tv-own-badge">${ic("star", 12)}Senin şablonun</span>` : ""}
        <h2>${esc(t.name || t.id)}</h2>
        ${t.description ? `<p class="tv-desc">${esc(t.description)}</p>` : ""}
        ${t.best_for ? `<div class="tv-for">${ic("sparkles", 15)}<div><span>En uygun:</span> ${esc(t.best_for)}</div></div>` : ""}
        ${tags ? `<div class="tv-tags">${tags}</div>` : ""}
      </div>
      <div class="tv-acts">
        ${t.custom ? `<div class="tv-own">
          <div class="tv-own-row"><button class="btn" data-act="note">${ic("pencil", 15)}Düzeltme iste</button><button class="btn ghost danger" data-act="del">${ic("trash-2", 15)}Sil</button></div>
          <div class="tv-fold" data-fold="note"><div><div class="tv-fold-in">
            <textarea rows="3" placeholder="Neyi değiştirelim? ör. başlık daha büyük olsun, geçişler yumuşasın…"></textarea>
            <div class="row end"><button class="btn ghost sm" data-act="fold-close">Vazgeç</button><button class="btn primary sm" data-act="note-send">${ic("send", 14)}Gönder</button></div>
          </div></div></div>
          <div class="tv-fold" data-fold="del"><div><div class="tv-fold-in tv-confirm">
            <div class="row">${ic("triangle-alert", 16)}<span class="grow">Bu şablon kalıcı olarak silinsin mi?</span></div>
            <div class="row end"><button class="btn ghost sm" data-act="fold-close">Vazgeç</button><button class="btn sm tv-danger" data-act="del-ok">${ic("trash-2", 14)}Evet, sil</button></div>
          </div></div></div>
        </div>` : ""}
        <button class="btn primary big wide" data-act="pick">${ic("check", 18)}Bu stili seç</button>
        <div class="tv-keys"><span><kbd>←</kbd><kbd>→</kbd>gezin</span><span><kbd>Boşluk</kbd>oynat</span><span><kbd>Esc</kbd>kapat</span></div>
      </div>`;
  };
  const renderInfo = (dir = 0) => {
    fold = "";
    info.innerHTML = infoHtml(list[idx]);
    info.scrollTop = 0;
    if (!dir || rm) return;
    $$(".tv-info-top > *", info).forEach((k, i) =>
      k.animate([{ opacity: 0, transform: `translateX(${dir * 22}px)` }, { opacity: 1, transform: "none" }], { duration: 480, delay: 60 + i * 38, easing: EASE, fill: "backwards" }));
  };
  const setFold = (name) => {
    fold = name && fold !== name ? name : "";
    for (const f of $$(".tv-fold", info)) f.classList.toggle("open", f.dataset.fold === fold);
    for (const b of $$(".tv-own-row [data-act]", info)) b.classList.toggle("on", b.dataset.act === fold);
    if (fold === "note") setTimeout(() => $('.tv-fold[data-fold="note"] textarea', info)?.focus({ preventScroll: true }), 160);
  };
  const syncStrip = (smooth) => {
    $$(".tv-th", thumbs).forEach((b, i) => b.classList.toggle("on", i === idx));
    const b = thumbs.children[idx];
    if (b) thumbs.scrollTo({ left: b.offsetLeft - thumbs.clientWidth / 2 + b.offsetWidth / 2, behavior: smooth && !rm ? "smooth" : "auto" });
  };

  const go = (i, dir) => {
    if (closing || n < 2) return;
    i = ((i % n) + n) % n;
    if (i === idx) return;
    dir = dir || (i > idx ? 1 : -1);
    idx = i;
    const old = cur;
    cur = slideFor(list[idx]);
    slides.append(cur);
    playCur();
    if (old) {
      const cs = getComputedStyle(old);
      const t0 = cs.transform;
      const o0 = cs.opacity;
      old.getAnimations().forEach((a) => a.cancel());
      old.classList.add("out");
      const D = rm ? 200 : 640;
      const out = rm ? [{ opacity: o0 }, { opacity: 0 }] : [{ transform: t0, opacity: o0, filter: "brightness(1)" }, { transform: `translateX(${-dir * 34}%) scale(.86)`, opacity: 0, filter: "brightness(.4)" }];
      done(old.animate(out, { duration: D, easing: EASE, fill: "forwards" }), () => release(old));
      cur.animate(rm ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: `translateX(${dir * 100}%)` }, { transform: "none" }], { duration: D, easing: EASE });
    }
    sig = "";
    renderInfo(dir);
    syncStrip(true);
    preload();
    wake();
  };

  const openAnim = () => {
    if (rm) {
      root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
      return;
    }
    $(".tv-back", root).animate([{ opacity: 0, backdropFilter: "blur(0px) saturate(1)" }, { opacity: 1, backdropFilter: "blur(18px) saturate(1.25)" }], { duration: 560, easing: "cubic-bezier(.2,.7,.3,1)" });
    const o = locate(list[idx].id);
    const from = shown(o);
    if (from) {
      const to = player.getBoundingClientRect();
      const sx = from.width / to.width;
      const sy = from.height / to.height;
      const r = radiusOf(o);
      o.style.visibility = "hidden";
      done(player.animate([
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${sx}, ${sy})`, borderRadius: `${r / sx}px / ${r / sy}px` },
        { transform: "none", borderRadius: "18px" },
      ], { duration: 660, easing: EASE }), () => (o.style.visibility = ""));
    } else {
      player.animate([{ opacity: 0, transform: "translateY(28px) scale(.95)", transformOrigin: "50% 50%" }, { opacity: 1, transform: "none", transformOrigin: "50% 50%" }], { duration: 520, easing: EASE });
    }
    const enter = (el, kf, delay, duration = 580) => el?.animate(kf, { duration, delay, easing: EASE, fill: "backwards" });
    enter(info, [{ opacity: 0, transform: "translateX(32px)" }, { opacity: 1, transform: "none" }], 180);
    enter(strip, [{ opacity: 0, transform: "translateY(36px)" }, { opacity: 1, transform: "none" }], 240);
    for (const el of $$(".tv-nav, .tv-x", root)) enter(el, [{ opacity: 0, transform: "scale(.7)" }, { opacity: 1, transform: "none" }], 300, 460);
    enter(ctl, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], 460, 460);
    enter(progBox, [{ opacity: 0 }, { opacity: 1 }], 460, 460);
  };

  const close = (opts = {}) => {
    if (closing) return;
    closing = true;
    root.classList.add("closing");
    document.removeEventListener("keydown", onKey, true);
    clearTimeout(idleT);
    const D = rm ? 170 : 480;
    const fade = (el, d) => el && el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], { duration: d, easing: "ease-out", fill: "forwards" });
    fade($(".tv-back", root), D);
    for (const el of [info, strip, ctl, progBox, ...$$(".tv-nav, .tv-x", root)]) fade(el, D * 0.5);
    const o = rm || opts.fade ? null : locate(list[idx].id);
    const to = shown(o);
    let a;
    if (to) {
      const t0 = getComputedStyle(player).transform;
      player.getAnimations().forEach((x) => x.cancel());
      const L = player.getBoundingClientRect();
      const sx = to.width / L.width;
      const sy = to.height / L.height;
      const r = radiusOf(o);
      a = player.animate([
        { transform: t0, borderRadius: "18px", opacity: 1 },
        { opacity: 1, offset: 0.7 },
        { transform: `translate(${to.left - L.left}px, ${to.top - L.top}px) scale(${sx}, ${sy})`, borderRadius: `${r / sx}px / ${r / sy}px`, opacity: 0 },
      ], { duration: D + 80, easing: "cubic-bezier(.32,.72,.24,1)", fill: "forwards" });
    } else {
      a = player.animate([{ opacity: 1, transform: "none", transformOrigin: "50% 50%" }, { opacity: 0, transform: "translateY(18px) scale(.95)", transformOrigin: "50% 50%" }], { duration: D * 0.8, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" });
    }
    done(a, () => {
      cancelAnimationFrame(raf);
      for (const v of $$("video", root)) unload(v);
      for (const v of pool.values()) unload(v);
      pool.clear();
      root.remove();
      if (prevFocus?.isConnected) prevFocus.focus?.({ preventScroll: true });
    });
  };

  const sendNote = X.guard(async (btn) => {
    const t = list[idx];
    const ta = $('.tv-fold[data-fold="note"] textarea', info);
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      throw new Error("Neyin değişmesini istediğini yaz");
    }
    btn.disabled = true;
    try {
      await X.api(`/api/templates/${encodeURIComponent(t.id)}/note`, { text });
      ta.value = "";
      setFold("");
      X.toast("Düzeltme isteğin ajana iletildi");
      X.refresh();
    } finally {
      btn.disabled = false;
    }
  });
  const removeTpl = X.guard(async (btn) => {
    const t = list[idx];
    btn.disabled = true;
    try {
      await X.api(`/api/templates/${encodeURIComponent(t.id)}/delete`, {});
      X.toast(`"${t.name}" silindi`);
      X.refresh();
      close({ fade: true });
    } finally {
      btn.disabled = false;
    }
  });

  const onAct = (name, e, el) => {
    if (name === "close") close();
    else if (name === "prev") go(idx - 1, -1);
    else if (name === "next") go(idx + 1, 1);
    else if (name === "play") togglePlay();
    else if (name === "mute") toggleMute();
    else if (name === "restart") restart();
    else if (name === "seek") seek(e);
    else if (name === "pick") {
      const id = list[idx].id;
      onPick?.(id);
      close();
    } else if (name === "note" || name === "del") setFold(name);
    else if (name === "fold-close") setFold("");
    else if (name === "note-send") sendNote(el);
    else if (name === "del-ok") removeTpl(el);
  };

  function onKey(e) {
    if (closing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (fold) setFold("");
      else close();
      return;
    }
    if (e.target?.closest?.("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "ArrowLeft") go(idx - 1, -1);
    else if (k === "ArrowRight") go(idx + 1, 1);
    else if (k === " " || k === "k" || k === "K") togglePlay();
    else if (k === "m" || k === "M") toggleMute();
    else if (k === "Home") go(0, -1);
    else if (k === "End") go(n - 1, 1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  root.addEventListener("click", (e) => {
    if (closing) return;
    const a = e.target.closest("[data-act]");
    if (a) return onAct(a.dataset.act, e, a);
    const th = e.target.closest(".tv-th");
    if (th) return go(+th.dataset.i);
    if (e.target.closest(".tv-slides")) {
      if (swiped) swiped = false;
      else togglePlay();
      return;
    }
    if (e.target.hasAttribute?.("data-bg")) close();
  });
  player.addEventListener("pointermove", wake);
  player.addEventListener("pointerleave", () => {
    clearTimeout(idleT);
    idleT = setTimeout(() => video() && !video().paused && player.classList.add("idle"), 700);
  });
  player.addEventListener("pointerdown", (e) => {
    swiped = false;
    down = e.target.closest(".tv-ctl, .tv-prog") ? null : [e.clientX, e.clientY];
  });
  player.addEventListener("pointerup", (e) => {
    if (!down) return;
    const dx = e.clientX - down[0];
    const dy = e.clientY - down[1];
    down = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiped = true;
      go(idx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    }
  });

  cur = slideFor(list[idx]);
  slides.append(cur);
  const srcV = fromEl?.querySelector?.("video");
  const v0 = video();
  if (v0 && srcV && !srcV.paused && srcV.currentTime > 0.05) v0.currentTime = srcV.currentTime;
  playCur();
  renderInfo(0);
  syncStrip(false);
  syncCtl();
  raf = requestAnimationFrame(tick);
  document.addEventListener("keydown", onKey, true);
  root.focus({ preventScroll: true });
  openAnim();
  setTimeout(preload, rm ? 0 : 700);
  wake();
  return { close, go: (id) => go(list.findIndex((t) => t.id === id)) };
}

// ---------- wizard ----------

const QS = [
  { key: "name", icon: "pencil", label: "Ad", type: "text", q: "Şablonun adı ne olsun?", hint: "Stil listesinde bu adla görünecek." },
  { key: "purpose", icon: "list", label: "İçerik türü", type: "multi", q: "Hangi içerikler için?", hint: "Birden fazla seçebilirsin.",
    opts: ["Eğitim/ipucu", "Ürün tanıtımı", "Liste", "Haber/duyuru", "Motivasyon/alıntı", "İstatistik", "Hikâye anlatımı", "Kampanya/indirim"] },
  { key: "mood", icon: "sparkles", label: "Hava", type: "single", q: "Nasıl bir hava?", hint: "İzleyen ilk saniyede ne hissetsin?",
    opts: ["Enerjik", "Sakin", "Lüks/premium", "Eğlenceli", "Ciddi/kurumsal", "Retro", "Fütüristik", "Samimi"] },
  { key: "background", icon: "image", label: "Zemin", type: "single", q: "Zemin nasıl olsun?", hint: "Yazıların ve öğelerin arkasında ne dursun?",
    opts: ["Koyu", "Açık", "Canlı renkli", "Gradyan", "Doku (kâğıt, beton, kumaş)", "Fotoğraf/bulanık"] },
  { key: "typography", icon: "type", label: "Yazı stili", type: "single", q: "Yazılar nasıl görünsün?", hint: "Başlıkların ve metinlerin karakteri.",
    opts: ["Kalın ve büyük", "İnce ve zarif", "Serif/klasik", "El yazısı", "Teknik/mono"] },
  { key: "motion", icon: "move", label: "Hareket", type: "single", q: "Hareketler nasıl olsun?", hint: "Geçişlerin ve animasyonların temposu.",
    opts: ["Hızlı ve sert kesmeler", "Akıcı ve yumuşak", "Minimal ve yavaş", "Glitch/bozulma", "3B/derinlik"] },
  { key: "elements", icon: "shapes", label: "Öğeler", type: "multi", q: "Ekranda neler olsun?", hint: "Birden fazla seçebilirsin.",
    opts: ["Büyük numaralar", "Şekiller/ikonlar", "Grafik/sayı", "İlerleme çubuğu", "El çizimi", "Parçacık/ışık", "Logo alanı", "Fotoğraf çerçevesi"] },
  { key: "colors", icon: "palette", label: "Renkler", type: "colors", q: "Hangi renkler?", hint: "En fazla 3 renk seç ya da seçimi ajana bırak." },
  { key: "desc", icon: "message-square-text", label: "Açıklama", type: "textarea", q: "Aklındakini anlat", hint: "Kafandaki videoyu birkaç cümleyle tarif et; ayrıntı arttıkça isabet artar." },
  { key: "summary", icon: "list-checks", label: "Özet", type: "summary", q: "Her şey doğru mu?", hint: "Kontrol et, gerekirse düzenle ve gönder." },
];
const LAST = QS.length - 1;
const ANSWER_KEYS = ["purpose", "mood", "background", "typography", "motion", "elements"];
const PALETTE = ["#FF6A3D", "#0E1116", "#E1306C", "#4C8DFF", "#F2C14E", "#2BC46A"];

let W = null;
let wzUi = null;

const blankWizard = () => ({ mode: "q", step: 0, back: false, name: "", pick: {}, other: {}, autoColors: true, colors: ["#FF6A3D", "#0E1116"],
  desc: "", items: [], links: "", similarity: "ilham", refNote: "" });

const answerOf = (s) => {
  const o = (W.other[s.key] || "").trim();
  if (s.type === "multi") return [...(W.pick[s.key] || []), ...(o ? [o] : [])];
  if (s.type === "single") return o || W.pick[s.key] || "";
  return "";
};
const answered = (i) => {
  const s = QS[i];
  if (s.type === "text") return !!W.name.trim();
  if (s.type === "textarea") return !!W.desc.trim();
  if (s.type === "colors") return !W.autoColors;
  if (s.type === "summary") return false;
  const a = answerOf(s);
  return Array.isArray(a) ? a.length > 0 : !!a;
};
const linkLines = () => W.links.split(/\n+/).map((x) => x.trim()).filter(Boolean);
const isLink = (u) => /^https?:\/\/\S+\.\S+$/i.test(u) || /^(www\.)?[\w-]+(\.[\w-]+)+\/\S*$/i.test(u);
const linkList = () => linkLines().filter(isLink);
const refText = () => {
  const parts = [];
  if (W.items.length) parts.push(`${W.items.length} görsel`);
  const l = linkList().length;
  if (l) parts.push(`${l} bağlantı`);
  if (parts.length) parts.push(W.similarity === "birebir" ? "Birebir benzesin" : "İlham alsın");
  return parts.join(" · ");
};
const hostOf = (u) => {
  try {
    const x = new URL(/^https?:/i.test(u) ? u : "https://" + u);
    return (x.hostname.replace(/^www\./, "") + x.pathname).replace(/\/$/, "");
  } catch {
    return u;
  }
};

function uploadRef(it) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.setRequestHeader("X-Filename", encodeURIComponent(it.name));
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      it.pct = e.loaded / e.total;
      wzUi?.bar(it);
    };
    xhr.onload = () => {
      let j = {};
      try {
        j = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 && j.id) Object.assign(it, { id: j.id, name: j.name || it.name, url: j.url || "", pct: 1 });
      else it.err = j.error || "yükleme hatası";
      wzUi?.thumb(it);
      resolve();
    };
    xhr.onerror = () => {
      it.err = "bağlantı hatası";
      wzUi?.thumb(it);
      resolve();
    };
    xhr.send(it.file);
  });
}

export function openTemplateWizard(X) {
  const { ic, esc } = X;
  W ||= blankWizard();
  const rm = reduced();

  const html = `<div class="tw-head">
      <div class="tw-title">
        <span class="tw-logo">${ic("wand-sparkles", 21)}</span>
        <div class="grow"><h2>Kendi şablonunu oluştur</h2><div class="sm muted">Tarif et ya da örnek göster; ajan yeni bir video stili tasarlasın. Hazır olunca stil listesinde görünür.</div></div>
        <button class="btn ghost icon" data-close title="Kapat">${ic("x", 18)}</button>
      </div>
      <div class="seg tw-modes">
        <button data-mode="q">${ic("message-square-text", 16)}Sorularla anlat<i class="tw-has" data-has="q"></i></button>
        <button data-mode="ref">${ic("images", 16)}Referans ver<i class="tw-has" data-has="ref"></i></button>
      </div>
    </div>
    <div class="tw-body">
      <section class="tw-sec" data-sec="q">
        <div class="tw-dots">${QS.map((s, i) => `<button class="tw-dot" data-step="${i}" title="${esc(s.label)}" aria-label="${esc(s.label)}"></button>`).join("")}<span class="tw-dotn"></span></div>
        <div class="tw-stage"></div>
      </section>
      <section class="tw-sec" data-sec="ref">
        <div class="tw-rgrid">
          <div>
            <div class="tw-lab">Şablonun adı <span class="req">*</span></div>
            <input class="tw-name" maxlength="60" placeholder="ör. Neon Liste" value="${esc(W.name)}">
            <div class="tw-lab">Görseller <span class="muted">(ekran görüntüsü, kapak, beğendiğin bir kare…)</span></div>
            <div class="drop tw-drop" role="button" tabindex="0">${ic("upload", 22)}<b>Görsel ekle</b><span class="sm muted">Sürükle-bırak, tıkla ya da Ctrl+V ile yapıştır</span></div>
            <input type="file" class="tw-file" accept="image/*" multiple hidden>
            <div class="tw-refs"></div>
          </div>
          <div>
            <div class="tw-lab">Video bağlantıları <span class="muted">(her satır bir bağlantı)</span></div>
            <textarea class="tw-links" rows="4" placeholder="Instagram, YouTube ya da TikTok video bağlantısı…">${esc(W.links)}</textarea>
            <div class="tw-lchips"></div>
            <div class="tw-lab">Ne kadar benzesin?</div>
            <div class="seg tw-sim">
              <button data-sim="birebir"><b>Birebir benzesin</b><span>Düzen, yazı ve hareketler örneğe yakın olsun</span></button>
              <button data-sim="ilham"><b>İlham alsın</b><span>Havasını alsın, kendi yorumunu katsın</span></button>
            </div>
            <div class="tw-lab">Kısa not</div>
            <textarea class="tw-rnote" rows="3" placeholder="Örnekte neyi sevdin? ör. yazıların giriş şekli, renk geçişleri…">${esc(W.refNote)}</textarea>
          </div>
        </div>
      </section>
    </div>
    <div class="tw-foot"></div>`;

  X.modal(html, (m) => {
    const box = m.classList?.contains("dialog") ? m : $(".dialog.tw", m) || m;
    const body = $(".tw-body", box);
    const stage = $(".tw-stage", box);
    const refsEl = $(".tw-refs", box);
    const foot = $(".tw-foot", box);
    let sending = false;
    let autoT = 0;

    const curPane = () => $(".tw-pane:not(.out)", stage);

    const colorsHtml = () => W.colors.map((c, i) => `<div class="tw-sw"><input type="color" data-ci="${i}" value="${c}" title="Renk seç"><code>${c.toUpperCase()}</code>${W.colors.length > 1 ? `<button class="tw-swx" data-crm="${i}" title="Kaldır">${ic("x", 13)}</button>` : ""}</div>`).join("")
      + (W.colors.length < 3 ? `<button class="tw-add" data-cadd>${ic("plus", 15)}Renk ekle</button>` : "");
    const palStyle = () => (W.autoColors ? "" : `background:${W.colors.length > 1 ? `linear-gradient(100deg, ${W.colors.map((c, i) => `${c} ${Math.round((i / (W.colors.length - 1)) * 100)}%`).join(", ")})` : W.colors[0]}`);
    const paintPal = () => {
      const p = $(".tw-pal", curPane() || box);
      if (!p) return;
      p.className = "tw-pal" + (W.autoColors ? " auto" : "");
      p.style.cssText = palStyle();
      p.firstElementChild.textContent = W.autoColors ? "Ajan konuya uygun renkleri seçecek" : "";
    };

    const summaryHtml = () => {
      const empty = `<span class="muted">—</span>`;
      const val = (s) => {
        if (s.type === "text") return W.name.trim() ? `<b>${esc(W.name.trim())}</b>` : `<span class="tw-miss">${ic("triangle-alert", 13)}Ad gerekli</span>`;
        if (s.type === "textarea") return W.desc.trim() ? `<span class="tw-clamp">${esc(W.desc.trim())}</span>` : empty;
        if (s.type === "colors") return W.autoColors ? `<span class="tag">${ic("wand-sparkles", 12)}Ajan seçsin</span>` : `<span class="tw-tags">${W.colors.map((c) => `<span class="tag"><i class="sw" style="background:${c}"></i>${c.toUpperCase()}</span>`).join("")}</span>`;
        const a = answerOf(s);
        const arr = Array.isArray(a) ? a : a ? [a] : [];
        return arr.length ? `<span class="tw-tags">${arr.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</span>` : empty;
      };
      const rt = refText();
      return `<div class="tw-sum">${QS.slice(0, LAST).map((s, i) => `<div class="tw-sr"><span class="tw-sl">${ic(s.icon, 14)}${s.label}</span><span class="tw-sv">${val(s)}</span><button class="tw-edit" data-edit="${i}">${ic("pencil", 12)}Düzenle</button></div>`).join("")}
        <div class="tw-sr"><span class="tw-sl">${ic("images", 14)}Referanslar</span><span class="tw-sv">${rt ? esc(rt) : empty}</span><button class="tw-edit" data-mode="ref">${ic(rt ? "pencil" : "plus", 12)}${rt ? "Düzenle" : "Ekle"}</button></div></div>`;
    };

    const paneHtml = (i) => {
      const s = QS[i];
      const head = `<div class="tw-q"><span class="tw-qi">${ic(s.icon, 19)}</span><div class="grow"><div class="tw-qn">${i < LAST ? `Soru ${i + 1} / ${LAST}` : "Son adım"}</div><h3>${s.q}</h3><p>${s.hint}</p></div></div>`;
      if (s.type === "text") return head + `<input class="tw-name tw-big" maxlength="60" placeholder="ör. Neon Liste, Sakin Bilgi Kartı" value="${esc(W.name)}">
          <div class="tw-how">${[["message-square-text", "Sorulara cevap ver ya da örnek göster"], ["bot", "Ajan yeni stili tasarlar ve önizlemesini çıkarır"], ["layout-grid", "Stil listesinde seçmeye hazır olur"]]
            .map(([n, t], k) => `<div><span>${ic(n, 16)}</span><b>${k + 1}</b>${t}</div>`).join("")}</div>`;
      if (s.type === "single" || s.type === "multi") {
        const cur = W.pick[s.key];
        const on = (o) => (s.type === "multi" ? (cur || []).includes(o) : cur === o);
        return head + `<div class="chips tw-chips">${s.opts.map((o) => `<button data-o="${esc(o)}" class="${on(o) ? "active" : ""}">${ic("check", 14)}${esc(o)}</button>`).join("")}</div>
          <div class="tw-other"><span>Başka:</span><input class="tw-oth" placeholder="${s.type === "multi" ? "Listede olmayan bir şey ekle…" : "Kendi cevabını yaz…"}" value="${esc(W.other[s.key] || "")}"></div>`;
      }
      if (s.type === "colors") return head + `<label class="switch"><input type="checkbox" class="tw-auto" ${W.autoColors ? "checked" : ""}><span></span>Ajan seçsin</label>
          <div class="tw-colors ${W.autoColors ? "off" : ""}">${colorsHtml()}</div>
          <div class="tw-pal ${W.autoColors ? "auto" : ""}" style="${palStyle()}"><span>${W.autoColors ? "Ajan konuya uygun renkleri seçecek" : ""}</span></div>`;
      if (s.type === "textarea") return head + `<textarea class="tw-desc" rows="8" placeholder="ör. Koyu zeminde neon çizgiler; her madde ekrana sertçe girip hafifçe titresin, sonda büyük bir soru işareti belirsin…">${esc(W.desc)}</textarea>
          <div class="tw-tip">${ic("lightbulb", 14)}<span>Giriş nasıl başlasın, yazılar nasıl belirsin, video nasıl bitsin? Aklına gelen her ayrıntı işe yarar.</span></div>`;
      return head + summaryHtml();
    };

    const syncDots = () => {
      $$(".tw-dot", box).forEach((d, i) => {
        d.classList.toggle("on", i === W.step);
        d.classList.toggle("done", i !== W.step && answered(i));
      });
      $(".tw-dotn", box).textContent = W.step < LAST ? `${W.step + 1} / ${LAST}` : "Özet";
    };
    const hasQ = () => QS.slice(1, LAST).some((_, i) => answered(i + 1));
    const hasRef = () => W.items.length > 0 || linkList().length > 0 || !!W.refNote.trim();
    const syncHas = () => {
      $('[data-has="q"]', box).classList.toggle("on", hasQ());
      $('[data-has="ref"]', box).classList.toggle("on", hasRef());
    };
    const renderFoot = () => {
      if (sending) return;
      if (W.mode === "ref") {
        const rt = refText();
        foot.innerHTML = `<span class="grow sm muted">${rt ? esc(rt) : "Görsel ya da bağlantı ekle; sorulara verdiğin cevaplar da birlikte gönderilir."}</span><button class="btn primary" data-send>${ic("send", 15)}Gönder</button>`;
        return;
      }
      const last = W.step === LAST;
      foot.innerHTML = `<button class="btn ghost" data-nav="-1" ${W.step ? "" : "disabled"}>${ic("arrow-left", 15)}Geri</button><span class="grow"></span>`
        + (!last && W.step > 0 && !W.back ? `<button class="btn ghost sm" data-step="${LAST}">Özete atla</button>` : "")
        + (last ? `<button class="btn primary" data-send>${ic("send", 15)}Gönder</button>` : `<button class="btn primary" data-nav="1">${W.back ? "Özete dön" : "İleri"}${ic(W.back ? "list-checks" : "arrow-right", 15)}</button>`);
    };

    const renderPane = (dir = 0) => {
      clearTimeout(autoT);
      const olds = $$(".tw-pane:not(.out)", stage);
      const pane = document.createElement("div");
      pane.className = "tw-pane";
      pane.dataset.step = W.step;
      pane.innerHTML = paneHtml(W.step);
      stage.append(pane);
      for (const o of olds) {
        o.classList.add("out");
        if (rm || !dir) o.remove();
        else done(o.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${-dir * 40}px)` }], { duration: 240, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }), () => o.remove());
      }
      if (dir && !rm) {
        pane.animate([{ opacity: 0, transform: `translateX(${dir * 52}px)` }, { opacity: 1, transform: "none" }], { duration: 480, delay: 90, easing: EASE, fill: "backwards" });
        $$(".tw-chips button, .tw-sw, .tw-add, .tw-sr, .tw-how > div", pane).forEach((b, k) =>
          b.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 380, delay: 170 + k * 26, easing: EASE, fill: "backwards" }));
      }
      body.scrollTop = 0;
      syncDots();
      syncHas();
      renderFoot();
      const f = $(".tw-name, .tw-desc", pane);
      if (f) setTimeout(() => f.isConnected && W.mode === "q" && f.focus({ preventScroll: true }), dir && !rm ? 320 : 0);
    };
    const goStep = (i, dir) => {
      i = Math.max(0, Math.min(LAST, i));
      if (i === W.step && curPane()) return;
      dir = dir || (i > W.step ? 1 : -1);
      if (i === LAST) W.back = false;
      W.step = i;
      renderPane(dir);
    };
    const next = () => goStep(W.back ? LAST : W.step + 1, 1);

    const setMode = (mode, anim = true) => {
      W.mode = mode;
      $$(".tw-modes [data-mode]", box).forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
      for (const s of $$(".tw-sec", box)) s.classList.toggle("hidden", s.dataset.sec !== mode);
      const sec = $(`.tw-sec[data-sec="${mode}"]`, box);
      if (anim && !rm) sec.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 400, easing: EASE });
      body.scrollTop = 0;
      if (mode === "q") syncDots();
      renderFoot();
    };

    const thumbHtml = (it) => `<img src="${esc(it.local || it.url)}" alt="">${it.id ? "" : it.err ? `<span class="tw-rst bad" title="${esc(it.err)}">${ic("triangle-alert", 12)}Hata</span>` : `<span class="tw-rst"><i style="width:${Math.round(it.pct * 100)}%"></i></span>`}`;
    const refEl = (it) => {
      const d = document.createElement("div");
      d.className = "tw-ref" + (it.err ? " err" : "");
      d.dataset.u = it.uid;
      d.innerHTML = `<div class="tw-rth">${thumbHtml(it)}</div>
        <input class="tw-rn" data-u="${it.uid}" placeholder="Bu görselde ne önemli? (renk, yazı, düzen…)" value="${esc(it.note)}">
        <button class="btn ghost icon" data-rm="${it.uid}" title="Kaldır">${ic("x", 15)}</button>`;
      return d;
    };
    wzUi = {
      bar: (it) => {
        const i = $(`.tw-ref[data-u="${it.uid}"] .tw-rst i`, box);
        if (i) i.style.width = `${Math.round(it.pct * 100)}%`;
      },
      thumb: (it) => {
        const el = $(`.tw-ref[data-u="${it.uid}"]`, box);
        if (!el) return;
        el.classList.toggle("err", !!it.err);
        $(".tw-rth", el).innerHTML = thumbHtml(it);
      },
    };
    const addFiles = (files) => {
      const all = [...(files || [])];
      const imgs = all.filter((f) => /^image\//.test(f.type));
      if (!imgs.length) {
        if (all.length) X.toast("Sadece görsel eklenebilir", true);
        return;
      }
      if (W.mode !== "ref") setMode("ref");
      for (const f of imgs) {
        const it = { uid: Math.random().toString(36).slice(2), file: f, name: f.name || "yapistirilan.png", local: URL.createObjectURL(f), pct: 0, note: "", id: "", url: "", err: "" };
        it.p = uploadRef(it);
        W.items.push(it);
        const el = refEl(it);
        refsEl.append(el);
        if (!rm) el.animate([{ opacity: 0, transform: "translateY(10px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 340, easing: EASE });
      }
      if (all.length > imgs.length) X.toast("Görsel olmayan dosyalar atlandı", true);
      syncHas();
      renderFoot();
    };
    const removeRef = (uid) => {
      const it = W.items.find((x) => x.uid === uid);
      if (!it) return;
      W.items = W.items.filter((x) => x !== it);
      if (it.local) setTimeout(() => URL.revokeObjectURL(it.local), 1000);
      const el = $(`.tw-ref[data-u="${uid}"]`, box);
      syncHas();
      renderFoot();
      if (!el) return;
      if (rm) return el.remove();
      const h = el.offsetHeight;
      el.style.overflow = "hidden";
      done(el.animate([{ height: `${h}px`, opacity: 1, marginBottom: "0px" }, { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", marginBottom: "-8px" }], { duration: 260, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" }), () => el.remove());
    };
    const drawLinks = () => {
      $(".tw-lchips", box).innerHTML = linkLines().map((u) => {
        const ok = isLink(u);
        const icon = !ok ? "triangle-alert" : /instagram\./i.test(u) ? "instagram" : /youtu\.?be|tiktok\./i.test(u) ? "film" : "link";
        return `<span class="tag${ok ? "" : " tw-bad"}" title="${esc(ok ? u : "Bağlantı gibi görünmüyor: " + u)}">${ic(icon, 12)}<span>${esc(ok ? hostOf(u) : u)}</span></span>`;
      }).join("");
    };
    const syncSim = () => $$(".tw-sim [data-sim]", box).forEach((b) => b.classList.toggle("active", b.dataset.sim === W.similarity));

    const syncChips = (pane) => {
      const s = QS[+pane.dataset.step];
      const cur = W.pick[s.key];
      for (const c of $$(".tw-chips button", pane)) c.classList.toggle("active", s.type === "multi" ? (cur || []).includes(c.dataset.o) : cur === c.dataset.o);
    };
    const pickChip = (b) => {
      const pane = b.closest(".tw-pane");
      const step = +pane.dataset.step;
      const s = QS[step];
      const o = b.dataset.o;
      if (s.type === "multi") {
        const a = (W.pick[s.key] ||= []);
        const k = a.indexOf(o);
        if (k < 0) a.push(o);
        else a.splice(k, 1);
      } else {
        const was = W.pick[s.key] === o;
        W.pick[s.key] = was ? "" : o;
        if (!was) {
          W.other[s.key] = "";
          const oth = $(".tw-oth", pane);
          if (oth) oth.value = "";
          clearTimeout(autoT);
          autoT = setTimeout(() => box.isConnected && W.mode === "q" && W.step === step && next(), 420);
        }
      }
      syncChips(pane);
      syncDots();
      syncHas();
    };
    const recolor = () => {
      const p = curPane();
      const c = p && $(".tw-colors", p);
      if (c) c.innerHTML = colorsHtml();
      paintPal();
      syncDots();
      syncHas();
    };
    const flagName = () => {
      const el = W.mode === "ref" ? $('.tw-sec[data-sec="ref"] .tw-name', box) : null;
      if (!el) {
        if (W.mode !== "q") setMode("q");
        goStep(0, -1);
        return;
      }
      el.focus();
      el.classList.add("tw-err");
      if (!rm) el.animate([{ transform: "none" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-3px)" }, { transform: "none" }], { duration: 340 });
      setTimeout(() => el.classList.remove("tw-err"), 1600);
    };

    const submit = X.guard(async (btn) => {
      if (sending) return;
      const name = W.name.trim();
      const answers = {};
      for (const s of QS) {
        if (!ANSWER_KEYS.includes(s.key)) continue;
        const a = answerOf(s);
        if (Array.isArray(a) ? a.length : a) answers[s.key] = a;
      }
      const something = Object.keys(answers).length > 0 || !W.autoColors;
      answers.colors = W.autoColors ? "ajan seçsin" : W.colors.slice(0, 3);
      const links = linkList();
      const description = [W.desc.trim(), W.refNote.trim()].filter(Boolean).join("\n\n");
      if (!name) {
        flagName();
        throw new Error("Şablona bir ad ver");
      }
      if (!something && !description && !W.items.length && !links.length) throw new Error("Biraz ipucu ver: soruları yanıtla, aklındakini anlat ya da referans ekle");
      sending = true;
      const label = btn.innerHTML;
      btn.disabled = true;
      try {
        if (W.items.some((it) => !it.id && !it.err)) {
          btn.innerHTML = `${ic("loader-circle", 15, "spin")}Görseller yükleniyor…`;
          await Promise.all(W.items.map((it) => it.p));
        }
        if (W.items.some((it) => it.err)) throw new Error("Yüklenemeyen görselleri kaldırıp tekrar dene");
        btn.innerHTML = `${ic("loader-circle", 15, "spin")}Gönderiliyor…`;
        await X.api("/api/tpl-requests", {
          name, answers, description, links, similarity: W.similarity,
          uploads: W.items.map((it) => ({ id: it.id, name: it.name, note: it.note.trim() })),
        });
        for (const it of W.items) if (it.local) URL.revokeObjectURL(it.local);
        W = null;
        wzUi = null;
        X.toast("Şablon isteğin sıraya girdi; ajan tasarlayınca stil listesinde görünecek");
        X.closeModal();
        X.refresh();
      } finally {
        sending = false;
        if (btn.isConnected) {
          btn.disabled = false;
          btn.innerHTML = label;
        }
      }
    });

    box.addEventListener("click", (e) => {
      if (e.target.closest("label, input")) e.stopPropagation();
      const b = e.target.closest("button, .tw-drop");
      if (!b || !box.contains(b) || b.disabled) return;
      if (b.matches(".tw-drop")) return $(".tw-file", box).click();
      const d = b.dataset;
      if (d.mode) setMode(d.mode);
      else if (d.step != null) goStep(+d.step);
      else if (d.nav) (+d.nav > 0 ? next() : goStep(W.step - 1, -1));
      else if (d.edit != null) {
        W.back = true;
        goStep(+d.edit, -1);
      } else if (d.o != null) pickChip(b);
      else if (b.hasAttribute("data-cadd")) {
        if (W.colors.length < 3) W.colors.push(PALETTE.find((c) => !W.colors.includes(c)) || "#FFFFFF");
        recolor();
      } else if (d.crm != null) {
        W.colors.splice(+d.crm, 1);
        recolor();
      } else if (d.sim) {
        W.similarity = d.sim;
        syncSim();
        renderFoot();
      } else if (d.rm) removeRef(d.rm);
      else if (b.hasAttribute("data-send")) submit(b);
    });
    box.addEventListener("input", (e) => {
      const t = e.target;
      if (t.matches(".tw-name")) {
        W.name = t.value;
        for (const o of $$(".tw-name", box)) if (o !== t) o.value = t.value;
      } else if (t.matches(".tw-oth")) {
        const pane = t.closest(".tw-pane");
        const s = QS[+pane.dataset.step];
        W.other[s.key] = t.value;
        if (s.type === "single" && t.value.trim() && W.pick[s.key]) {
          W.pick[s.key] = "";
          syncChips(pane);
        }
      } else if (t.matches(".tw-desc")) W.desc = t.value;
      else if (t.matches("[data-ci]")) {
        W.colors[+t.dataset.ci] = t.value;
        t.nextElementSibling.textContent = t.value.toUpperCase();
        paintPal();
      } else if (t.matches(".tw-links")) {
        W.links = t.value;
        drawLinks();
        renderFoot();
      } else if (t.matches(".tw-rnote")) W.refNote = t.value;
      else if (t.matches(".tw-rn")) {
        const it = W.items.find((x) => x.uid === t.dataset.u);
        if (it) it.note = t.value;
        return;
      } else return;
      syncDots();
      syncHas();
    });
    box.addEventListener("change", (e) => {
      const t = e.target;
      if (t.matches(".tw-auto")) {
        W.autoColors = t.checked;
        $(".tw-colors", t.closest(".tw-pane"))?.classList.toggle("off", W.autoColors);
        paintPal();
        syncDots();
        syncHas();
      } else if (t.matches(".tw-file")) {
        addFiles(t.files);
        t.value = "";
      }
    });
    box.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || W.mode !== "q") return;
      const t = e.target;
      if ((t.matches(".tw-pane .tw-name, .tw-pane .tw-oth") && !e.shiftKey) || (t.matches(".tw-desc") && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        next();
      }
    });
    const drop = $(".tw-drop", box);
    drop.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), $(".tw-file", box).click()));
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add("over");
    };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      addFiles(e.dataTransfer.files);
    };
    const prevPaste = X.onPaste;
    X.onPaste = (e) => {
      if (!box.isConnected) {
        X.onPaste = prevPaste;
        return prevPaste?.(e);
      }
      const files = [...(e.clipboardData?.files || [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    };

    for (const it of W.items) refsEl.append(refEl(it));
    drawLinks();
    syncSim();
    setMode(W.mode, false);
    renderPane(0);
    if (W.mode === "ref") setTimeout(() => $('.tw-sec[data-sec="ref"] .tw-name', box)?.focus({ preventScroll: true }), 0);
  }, "tw");
}

// ---------- request cards ----------

export function tplRequestCards(X, requests) {
  const { ic, esc } = X;
  const phase = `animation-delay:-${(Date.now() % 1800) / 1000}s`;
  return (requests || []).filter((r) => r && r.id && r.status !== "hazir" && !r.deleted).map((r) => {
    const pct = Math.round(Math.max(0, Math.min(1, +r.progress || 0)) * 100);
    const st = r.status === "hata" ? "hata" : r.status === "yapiliyor" ? "yapiliyor" : "sirada";
    const line = st === "hata" ? "Hata" : st === "yapiliyor" ? `${esc(r.stage || "Tasarlanıyor")} · %${pct}` : "Sırada";
    const tip = st === "hata" ? r.error || "Bir sorun çıktı" : r.stage || "";
    const mark = st === "hata" ? ic("triangle-alert", 22) : st === "yapiliyor" ? `${ic("loader-circle", 20, "spin")}<b>%${pct}</b>` : ic("hourglass", 20);
    return `<div class="tpl tpl-req ${st}" data-req="${esc(r.id)}" tabindex="0" title="${esc(tip)}">
      <div class="tpl-media tpl-req-media">
        <div class="tpl-skel"><i></i><i></i><i></i><i></i></div>
        ${st === "hata" ? "" : `<div class="tpl-shim" style="${phase}"></div>`}
        <div class="tpl-req-mark">${mark}</div>
        <span class="tpl-req-tag">${ic("wand-sparkles", 11)}Yeni stil</span>
      </div>
      <div class="tpl-name">${esc(r.name || "Benim şablonum")}</div>
      <div class="tpl-for">${line}</div>
      ${st === "hata"
        ? `<div class="tpl-req-err">${esc(r.error || "Bir sorun çıktı")}</div><button type="button" class="tpl-req-del" data-req-del="${esc(r.id)}">${ic("trash-2", 12)}Sil</button>`
        : `<div class="bar"><i style="width:${pct}%;${st === "sirada" ? phase : ""}"></i></div>`}
    </div>`;
  }).join("");
}

export function bindRequestCards(X, rootEl) {
  if (!rootEl) return;
  for (const b of rootEl.querySelectorAll("[data-req-del]")) {
    b.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = b.dataset.reqDel;
      const name = b.closest("[data-req]")?.querySelector(".tpl-name")?.textContent || id;
      const run = X.guard(async () => {
        await X.api(`/api/tpl-requests/${encodeURIComponent(id)}/delete`, {});
        X.toast("Şablon isteği silindi");
        X.refresh();
      });
      if (X.confirm) X.confirm("Şablon isteği silinsin mi?", `"${X.esc(name)}" isteği listeden kaldırılacak.`, "Sil", run);
      else if (confirm(`"${name}" isteği silinsin mi?`)) run();
    };
  }
}
