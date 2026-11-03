const BUSY = { ffmpeg: ["downloading", "extracting"], tiktok: ["installing"], whisper: ["installing", "downloading"] };
const API = {
  "ffmpeg-install": "/api/components/ffmpeg/install",
  "ffmpeg-cancel": "/api/components/ffmpeg/cancel",
  "tiktok-install": "/api/components/tiktok/install",
  "stt-install": "/api/stt/install",
  "stt-cancel": "/api/stt/cancel",
};
const MB = (b) => `${Math.round((b || 0) / 1e6).toLocaleString("tr-TR")} MB`;
const GB = (b) => `${((b || 0) / 1e9).toFixed(1).replace(".", ",")} GB`;
const running = (st, k) => !!st?.[k] && BUSY[k].includes(st[k].state);
const busy = (st) => Object.keys(BUSY).some((k) => running(st, k));

function bar(done, total) {
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  return `<div class="cmp-bar"><i style="width:${pct.toFixed(1)}%"></i></div><small class="cmp-prog">${MB(done)} / ${MB(total)} · %${Math.floor(pct)}</small>`;
}

function row(X, { icon, title, opt, ok, warn, text, extra = "", actions = "" }) {
  const { ic } = X;
  const cls = ok ? "ok" : warn ? "warn" : "bad";
  const badge = ok ? `${ic("circle-check", 13)}Hazır` : warn ? `${ic("circle-dashed", 13)}Kurulu değil` : `${ic("triangle-alert", 13)}Eksik`;
  return `<div class="cmp-row ${cls}"><span class="cmp-ic">${ic(icon, 18)}</span>
    <div class="cmp-main"><div class="cmp-title"><b>${title}</b>${opt ? "<small>isteğe bağlı</small>" : ""}<span class="cmp-st ${cls}">${badge}</span></div>
    <span class="cmp-text">${text}</span>${extra}${actions ? `<div class="cmp-acts">${actions}</div>` : ""}</div></div>`;
}

function rows(X, st) {
  const { ic, esc } = X;
  const claudeBtn = (topic) => `<button type="button" class="btn sm cs-btn" data-claude-setup="${topic}">${ic("bot", 13)}Claude ile kur</button>`;
  const btn = (a, label, icon, cls = "") => `<button type="button" class="btn sm ${cls}" data-cmp="${a}">${ic(icon, 13)}${label}</button>`;
  const err = (e) => (e ? `<span class="cmp-err">${esc(e)}</span>` : "");
  const spin = (t) => `<span class="cmp-busy">${ic("loader-circle", 13, "spin")}${t}</span>`;
  const out = [];

  const e = st.engine;
  const pip = e.missing.map((m) => m.toLowerCase()).join(" ");
  out.push(row(X, {
    icon: "film", title: "Video motoru", ok: e.ok,
    text: e.ok ? `Python ${esc(e.python)} · numpy, scipy, soundfile, Pillow${e.bundled ? " · stüdyoyla birlikte kuruldu" : ""}`
      : [e.missing.length ? `Eksik Python paketleri: <b>${esc(e.missing.join(", "))}</b>` : "", e.node ? "" : "Node.js bulunamadı"].filter(Boolean).join(" · "),
    extra: !e.ok && e.missing.length && !e.bundled ? `<code class="cmp-cmd">python -m pip install ${esc(pip)}</code>` : "",
    actions: e.ok ? "" : claudeBtn("bilesenler"),
  }));

  const f = st.ffmpeg;
  const fRun = running(st, "ffmpeg");
  out.push(row(X, {
    icon: "clapperboard", title: "ffmpeg ve ffprobe", ok: f.ok,
    text: f.ok ? (f.local ? "Stüdyonun kendi klasöründe kurulu." : "Bu bilgisayarda kurulu.")
      : `Videoları kodlamak ve sürelerini ölçmek için gerekli${f.ffmpeg && !f.ffprobe ? " (ffprobe eksik)" : ""}. Bir kez indirilir, yaklaşık ${MB(f.size)}.`,
    extra: fRun ? (f.state === "extracting" ? spin("Paketten çıkarılıyor…") : `${spin("İndiriliyor…")}${bar(f.done, f.total)}`) : err(f.error),
    actions: f.ok ? "" : fRun ? (f.state === "downloading" ? btn("ffmpeg-cancel", "Durdur", "x") : "") : `${btn("ffmpeg-install", f.error ? "Tekrar dene" : "İndir", "download", "primary")}${claudeBtn("bilesenler")}`,
  }));

  const b = st.browser;
  out.push(row(X, {
    icon: "globe", title: "Tarayıcı", ok: b.ok,
    text: b.ok ? `${esc(b.name)} bulundu; videolar görünmez bir tarayıcı penceresinde çizilir.` : "Videolar görünmez bir Microsoft Edge ya da Google Chrome penceresinde çizilir; ikisi de bulunamadı. Microsoft Edge'i kur.",
    actions: b.ok ? "" : claudeBtn("bilesenler"),
  }));

  const t = st.tiktok;
  const tRun = running(st, "tiktok");
  out.push(row(X, {
    icon: "music", title: "TikTok yükleme", opt: true, ok: t.ok, warn: !t.ok,
    text: t.ok ? "Playwright kurulu; TikTok yüklemeleri bu bilgisayardaki tarayıcıyla yapılır."
      : t.package ? "Playwright kurulu ama Edge ya da Chrome bulunamadı." : "TikTok'a otomatik yüklemek için Playwright paketi gerekir (yaklaşık 50 MB).",
    extra: tRun ? spin("Kuruluyor… birkaç dakika sürebilir") : err(t.error),
    actions: t.ok || tRun ? "" : `${t.package ? "" : btn("tiktok-install", t.error ? "Tekrar dene" : "Kur", "download")}${claudeBtn("bilesenler")}`,
  }));

  const w = st.whisper;
  const wRun = running(st, "whisper");
  out.push(row(X, {
    icon: "captions", title: "Konuşma tanıma", opt: true, ok: w.ready, warn: !w.ready,
    text: w.ready ? "Model hazır; hazır ses ya da video ile video yapılabilir." : `Hazır ses / video ile video yapmak için gerekir. Bir kez indirilir, yaklaşık ${GB(w.size)}.`,
    extra: wRun ? (w.state === "installing" ? spin("Bileşen kuruluyor…") : `${spin("İndiriliyor…")}${bar(w.done, w.total)}`) : err(w.error),
    actions: w.ready ? "" : wRun ? btn("stt-cancel", "Durdur", "x") : btn("stt-install", w.error ? "Tekrar dene" : "İndir", "download"),
  }));

  const c = st.claude;
  out.push(row(X, {
    icon: "bot", title: "Claude Code", ok: c.ok, warn: !c.ok,
    text: c.ok ? `Video ajanları Claude Code ile çalışır; ${c.cli ? "bu bilgisayarda kurulu" : "ayar klasörü bulundu"}.` : "Video ajanları Claude Code ile çalışır; bu bilgisayarda bulunamadı.",
    actions: claudeBtn("ajanlar"),
  }));
  return out.join("");
}

function body(X, st, error) {
  const { ic, esc } = X;
  const head = `<div class="cmp-lead"><span>Stüdyonun video üretmek için kullandığı parçalar. Eksik olanları buradan kurabilirsin.</span><button type="button" class="btn sm ghost" data-cmp="refresh">${ic("refresh-cw", 13)}Yenile</button></div>`;
  if (!st) return error ? `${head}<div class="cmp-err">${esc(error)}</div>` : `<div class="sm muted">${ic("loader-circle", 13, "spin")} Durum alınıyor…</div>`;
  return head + rows(X, st);
}

function mark(root, st) {
  if (!root || !st) return;
  const need = st.engine.ok && st.ffmpeg.ok && st.browser.ok;
  const d = root.querySelector("[data-comp-dot]");
  if (d) d.className = `st-dot ${need ? "ok" : "warn"}`;
  const s = root.querySelector("[data-comp-sub]");
  if (s) s.textContent = need ? "Hepsi hazır" : !st.ffmpeg.ok ? "ffmpeg eksik" : "Eksik var";
}

function mount(X, box, root) {
  if (!box) return;
  let st = null;
  let error = null;
  let timer = null;
  const draw = () => {
    if (!box.isConnected) return;
    box.innerHTML = body(X, st, error);
    mark(root, st);
  };
  const load = async () => {
    try {
      st = await X.api("/api/components");
      error = null;
    } catch (e) {
      error = e.message;
    }
    draw();
    clearTimeout(timer);
    if (busy(st)) timer = setTimeout(() => box.isConnected && load(), 1000);
  };
  box.onclick = X.guard(async (e) => {
    const b = e.target.closest("[data-cmp]");
    if (!b || b.disabled) return;
    b.disabled = true;
    if (b.dataset.cmp !== "refresh") await X.api(API[b.dataset.cmp], {});
    await load();
  });
  load();
}

export function componentsTab() {
  return ["sComp", "Bileşenler", "package", "<span data-comp-sub>Kurulum durumu</span>", '<i class="st-dot" data-comp-dot></i>'];
}

export function componentsSettingsHtml() {
  return `<fieldset id="sComp"><legend>Bileşenler</legend><div class="cmp" data-comp-box></div></fieldset>`;
}

export function bindComponentsSettings(X, m, section) {
  mount(X, m.querySelector("#sComp [data-comp-box]"), m);
  if (section === "bilesenler") m.querySelector('[data-st="sComp"]')?.click();
}

export function initComponents(X) {
  setTimeout(async () => {
    let st;
    try {
      st = await X.api("/api/components");
    } catch {
      return;
    }
    if (!st.hint) return;
    const show = (n) => {
      const md = document.getElementById("modal");
      if (md && !md.classList.contains("hidden")) {
        if (n < 40) setTimeout(() => show(n + 1), 3000);
        return;
      }
      X.api("/api/components/hint", {}).catch(() => {});
      X.modal(`<div class="st-head"><h2>${X.ic("package", 20)}Kurulum durumu</h2></div>
        <div class="cmp-intro">Video üretmek için gereken <b>ffmpeg</b> bu bilgisayarda bulunamadı. Aşağıdan tek tıkla indirebilirsin. Bu pencere bir daha kendiliğinden açılmaz; sonra <b>Ayarlar › Bileşenler</b> bölümünden de bakabilirsin.</div>
        <div class="cmp" data-comp-box></div>
        <div class="foot"><button class="btn" data-close>Kapat</button></div>`, (m) => mount(X, m.querySelector("[data-comp-box]"), m), "cmp-dialog");
    };
    show(0);
  }, 2500);
}
