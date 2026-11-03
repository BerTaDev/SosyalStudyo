const $ = (s, el = document) => el.querySelector(s);
const host = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const CAPS = [["region", "crop", "Alan", "Fareyle bir alan seç, görüntüsü panoya eklensin (Ctrl+Shift+S)"], ["visible", "monitor", "Ekran", "Görünen ekranın görüntüsünü al"],
  ["full", "scroll-text", "Tam sayfa", "Sayfanın tamamının görüntüsünü al"], ["html", "code", "HTML", "Sayfanın HTML'ini ve metnini kaydet"],
  ["selection", "text-select", "Seçim", "Sayfada fareyle seçtiğin metni kaydet"]];
const LABEL = { region: "seçilen alan", visible: "ekran görüntüsü", full: "tam sayfa görüntüsü", html: "sayfa HTML'i", selection: "seçili metin" };
const AST = { sirada: ["wait", "Ajan bekleniyor"], calisiyor: ["work", "Çalışıyor"], duraklatildi: ["pause", "Duraklatıldı"], inceleme: ["review", "Kontrolünü bekliyor"],
  bitti: ["done", "Bitti"], iptal: ["off", "İptal edildi"] };
const LIVE = new Set(["sirada", "calisiyor", "duraklatildi", "inceleme"]);
const SH = window.studioShell?.bw || null;

const B = { st: null, side: true, panel: "pano", items: [], sel: new Set(), job: null, selecting: false, built: false, freeze: false, nKey: "",
  nShow: false, timer: null, ticking: false, beat: 0, ag: { jobs: [], active: null, desktop: false }, view: null, agTimer: null };

// ---------- gate (no desktop window) ----------

async function gate(X) {
  const el = $("#browserView");
  const { ic, esc } = X;
  let s = {};
  try {
    s = await (await fetch("/api/desktop")).json();
  } catch {}
  const busy = s.state === "installing";
  const btn = busy ? `<div class="bwg-busy"><span class="bw-dots"><i></i><i></i><i></i></span>Kuruluyor… bir iki dakika sürebilir</div>`
    : s.installed ? `<button class="btn primary big" id="bwgOpen">${ic("external-link", 17)}Masaüstü penceresinde aç</button>`
      : `<button class="btn primary big" id="bwgGo">${ic("download", 17)}${s.error ? "Tekrar dene" : "İndir ve kur"}</button>`;
  el.innerHTML = `<div class="bwg"><div class="bwg-card">
    <span class="bwg-ic">${ic("globe", 30)}</span>
    <h2>Tarayıcı masaüstü penceresinde çalışır</h2>
    <p>Gerçek, gömülü tarayıcı için Sosyal Stüdyo'nun masaüstü penceresi gerekir. ${s.installed ? "Bileşen kurulu; pencereyi açman yeterli." : `Bir kerelik ~110 MB indirme (diskte ~${s.size_mb || 380} MB).`}</p>
    <ul><li>${ic("check", 15)}Kalıcı oturum ve çerezler, çoklu sekme</li><li>${ic("check", 15)}Alan, ekran, tam sayfa, HTML ve seçim kaydı</li>
      <li>${ic("check", 15)}Senin yerine gezip kaydeden araştırma ajanı</li></ul>
    ${btn}
    ${s.error && !busy ? `<div class="warnline sm">${ic("triangle-alert", 13)} ${esc(s.error)}</div>` : ""}
    ${s.installed ? `<div class="sm muted">Açılınca bu pencereyi kapatabilirsin; masaüstü kısayolu da artık o pencereyi açar.</div>` : ""}
  </div></div>`;
  const go = $("#bwgGo");
  if (go) {
    go.onclick = X.guard(async () => {
      await X.api("/api/desktop/install", {});
      B.waitInstall = true;
      gate(X);
    });
  }
  if (B.waitInstall && s.installed && !busy) {
    B.waitInstall = false;
    X.toDesktop("tarayici");
  }
  const open = $("#bwgOpen");
  if (open) {
    open.onclick = X.guard(() => X.toDesktop("tarayici"));
  }
  if (busy) setTimeout(() => X.S.tab === "browser" && gate(X), 2000);
}

// ---------- shell ----------

function shell(X) {
  const { ic } = X;
  return `<div class="bw native">
    <div class="bw-tabs" id="bwTabs"></div>
    <div class="bw-bar">
      <button class="bw-btn" data-nav="back" title="Geri (Alt+←)">${ic("arrow-left", 17)}</button>
      <button class="bw-btn" data-nav="forward" title="İleri (Alt+→)">${ic("arrow-right", 17)}</button>
      <button class="bw-btn" data-nav="reload" title="Yenile (F5)">${ic("rotate-cw", 16)}</button>
      <form class="bw-addr" id="bwAddrForm">${ic("globe", 15)}<input id="bwAddr" placeholder="Google'da ara ya da adres yaz" spellcheck="false" autocomplete="off"></form>
      <div class="bw-caps" id="bwCaps">${CAPS.map(([m, i, t, h]) => `<button data-cap="${m}" title="${h}">${ic(i, 15)}<span class="lbl">${t}</span></button>`).join("")}</div>
      <button class="bw-btn bw-pano" id="bwSideBtn" title="Pano ve araştırma ajanı">${ic("notebook-pen", 17)}<i id="bwCount"></i></button>
    </div>
    <div class="bw-load" id="bwLoad"></div>
    <div class="bw-body">
      <div class="bw-screen" id="bwScreen" tabindex="0">
        <img id="bwImg" class="off" draggable="false" alt="">
        <div class="bw-hint hidden" id="bwHint">${ic("crop", 14)}Görüntüsü alınacak alanı fareyle çiz · Esc ile vazgeç</div>
        <div class="bw-sel hidden" id="bwSel"></div>
      </div>
      <aside class="bw-side" id="bwSide">
        <div class="bw-seg" id="bwSeg"><button data-p="pano">${ic("notebook-pen", 14)}Pano <i id="bwSegN"></i></button><button data-p="ajan">${ic("bot", 14)}Araştırma ajanı <i class="ag-dot" id="bwAgDot"></i></button></div>
        <div class="bw-pane" data-pane="pano">
          <div class="bw-sh"><span class="muted sm" id="bwSideN"></span><span class="grow"></span>
            <button class="bw-btn sm" id="bwNoteBtn" title="Kendi notunu ekle">${ic("sticky-note", 15)}</button>
            <button class="bw-btn sm" id="bwSideX" title="Paneli gizle">${ic("panel-right", 15)}</button></div>
          <div class="bw-filter hidden" id="bwFilter"></div>
          <div class="bw-note hidden" id="bwNoteBox"><textarea id="bwNoteTxt" rows="3" placeholder="Kendi notun: fikir, rakam, alıntı…"></textarea>
            <div class="row"><button class="btn primary sm" id="bwNoteSave">Kaydet</button><button class="btn ghost sm" id="bwNoteCancel">Vazgeç</button></div></div>
          <div class="bw-items" id="bwItems"></div>
          <div class="bw-sf"><label class="bw-all"><input type="checkbox" id="bwAll">Tümü</label><span class="grow"></span>
            <button class="btn ghost sm" id="bwDel" title="Seçilenleri sil">${ic("trash-2", 14)}</button>
            <button class="btn primary sm" id="bwSend">${ic("send", 14)}<span id="bwSendT">Oluştur'a gönder</span></button></div>
        </div>
        <div class="bw-pane hidden" data-pane="ajan"><div class="ag" id="bwAgent"></div></div>
      </aside>
    </div>
  </div>`;
}

function renderTabs(X) {
  const { ic, esc } = X;
  const st = B.st;
  $("#bwTabs").innerHTML = `${(st?.tabs || []).map((t) => {
    const h = host(t.url);
    const fav = t.favicon || (h ? `https://${h}/favicon.ico` : "");
    const icon = t.agent ? `<span class="bw-agt" title="Araştırma ajanının sekmesi">${ic("bot", 13)}</span>`
      : fav ? `<img class="bw-fav" src="${esc(fav)}" alt="" onerror="this.replaceWith(document.createElement('i'))">` : ic("globe", 13);
    return `<div class="bw-tab ${t.id === st.active ? "on" : ""} ${t.loading ? "loading" : ""}" data-tab="${t.id}" title="${esc(t.title || t.url)}">${icon}<span>${esc(t.title || h || "Yeni sekme")}</span><button data-close="${t.id}" title="Sekmeyi kapat (Ctrl+W)">${ic("x", 13)}</button></div>`;
  }).join("")}<button class="bw-new" id="bwNew" title="Yeni sekme (Ctrl+T)">${ic("plus", 16)}</button>`;
}

function applyState(X, st) {
  const prev = B.st;
  B.st = st;
  if (!prev || prev.active !== st.active || JSON.stringify(prev.tabs) !== JSON.stringify(st.tabs)) renderTabs(X);
  const tab = st.tabs.find((t) => t.id === st.active);
  const addr = $("#bwAddr");
  if (tab && document.activeElement !== addr) addr.value = tab.url.startsWith("about:") ? "" : tab.url;
  $("#bwLoad").classList.toggle("on", !!tab?.loading);
  $('[data-nav="back"]').classList.toggle("dim", !tab?.canBack);
  $('[data-nav="forward"]').classList.toggle("dim", !tab?.canForward);
}

async function act(X, fn) {
  try {
    const st = await fn();
    if (st && st.tabs) applyState(X, st);
    return st;
  } catch (e) {
    X.toast(e.message, true);
  }
}

// ---------- native view placement ----------

function covered(r) {
  const screen = $("#bwScreen");
  for (const el of document.querySelectorAll("[data-covers]")) {
    const b = el.getBoundingClientRect();
    if (b.width && b.height && b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom) return true;
  }
  for (const fx of [0.03, 0.5, 0.97]) {
    for (const fy of [0.03, 0.5, 0.97]) {
      const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (el && !screen.contains(el)) return true;
    }
  }
  return false;
}

async function showSnapshot() {
  const snap = await SH.snapshot().catch(() => null);
  const img = $("#bwImg");
  if (snap) img.src = snap;
  img.classList.toggle("off", !snap);
  return snap;
}

async function tick(X) {
  if (B.ticking) return;
  B.ticking = true;
  try {
    const r = $("#bwScreen").getBoundingClientRect();
    const here = X.S.tab === "browser";
    if (++B.beat % 18 === 0) B.nKey = "";
    const show = here && !B.freeze && r.width > 40 && r.height > 40 && !covered(r);
    if (B.nShow && !show && here && !B.freeze) await showSnapshot();
    const key = [show, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join();
    if (key !== B.nKey) {
      B.nKey = key;
      await SH.layout({ x: r.left, y: r.top, w: r.width, h: r.height, show });
    }
    if (show && !B.nShow) setTimeout(() => B.nShow && $("#bwImg").classList.add("off"), 120);
    B.nShow = show;
    if (!here) {
      clearInterval(B.timer);
      B.timer = null;
    }
  } finally {
    B.ticking = false;
  }
}

// ---------- research board ----------

function itemHtml(X, it) {
  const { ic, esc } = X;
  const h = host(it.url);
  const thumb = it.kind === "png" ? `<a class="bw-th" href="/research/${encodeURIComponent(it.file)}" target="_blank" title="Büyük aç"><img src="${it.thumb || `/research/${encodeURIComponent(it.file)}`}" alt="" loading="lazy"></a>`
    : `<span class="bw-ki k-${it.kind}">${ic(it.kind === "html" ? "code" : it.url ? "text-select" : "sticky-note", 16)}</span>`;
  return `<div class="bw-it ${B.sel.has(it.id) ? "on" : ""}" data-id="${it.id}">
    <label class="bw-ck"><input type="checkbox" data-ck="${it.id}" ${B.sel.has(it.id) ? "checked" : ""}></label>
    ${thumb}
    <div class="bw-ib"><b title="${esc(it.title || "")}">${it.job ? `<span class="bw-jb" title="Araştırma ajanı kaydetti">${ic("bot", 11)}</span>` : ""}${esc(it.title || (it.kind === "text" ? "Not" : "Sayfa"))}</b>
      ${h ? `<a class="bw-host" href="${esc(it.url)}" target="_blank">${esc(h)}</a>` : ""}
      ${it.excerpt && it.kind !== "png" ? `<p>${esc(it.excerpt)}</p>` : ""}
      <input class="bw-in" data-note="${it.id}" placeholder="Not ekle…" value="${esc(it.note || "")}"></div>
    <button class="bw-x" data-del="${it.id}" title="Sil">${ic("x", 13)}</button></div>`;
}

function renderItems(X) {
  const n = B.items.length;
  for (const id of [...B.sel]) if (!B.items.some((i) => i.id === id)) B.sel.delete(id);
  $("#bwItems").innerHTML = n ? B.items.map((it) => itemHtml(X, it)).join("")
    : `<div class="bw-empty">${X.ic("notebook-pen", 26)}<b>Pano boş</b><span>Üstteki <b>Alan</b>, <b>Ekran</b>, <b>Tam sayfa</b>, <b>HTML</b> ya da <b>Seçim</b> düğmeleriyle bilgi topla ya da araştırma ajanına görev ver. Sonra seçip Oluştur'a gönder.</span></div>`;
  $("#bwSideN").textContent = n ? `${n} öğe` : "";
  $("#bwCount").textContent = n || "";
  $("#bwSegN").textContent = n || "";
  $("#bwAll").checked = n > 0 && B.sel.size === n;
  $("#bwSend").disabled = !B.sel.size;
  $("#bwDel").disabled = !B.sel.size;
  $("#bwSendT").textContent = B.sel.size ? `Oluştur'a gönder (${B.sel.size})` : "Oluştur'a gönder";
  const f = $("#bwFilter");
  f.classList.toggle("hidden", !B.job);
  if (B.job) f.innerHTML = `${X.ic("bot", 13)}<span class="grow">Ajan görevi <b>${B.job}</b> kayıtları</span><button class="btn ghost sm" id="bwFilterX">Tümünü göster</button>`;
}

async function loadItems(X) {
  try {
    const d = await (await fetch(`/api/research${B.job ? `?job=${B.job}` : ""}`)).json();
    B.items = d.items || [];
  } catch {
    B.items = [];
  }
  renderItems(X);
}

function setSide(open) {
  B.side = open;
  $("#browserView .bw").classList.toggle("noside", !open);
  try {
    localStorage.setItem("sosyal-bw-side", open ? "1" : "0");
  } catch {}
}

function setPanel(X, p) {
  B.panel = p;
  for (const b of document.querySelectorAll("#bwSeg [data-p]")) b.classList.toggle("on", b.dataset.p === p);
  for (const el of document.querySelectorAll("#bwSide [data-pane]")) el.classList.toggle("hidden", el.dataset.pane !== p);
  if (!B.side) setSide(true);
  if (p === "ajan") renderAgent(X);
}

async function cropRegion(X, box) {
  const img = $("#bwImg");
  const r = $("#bwScreen").getBoundingClientRect();
  const k = img.naturalWidth / r.width;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(box.w * k));
  c.height = Math.max(1, Math.round(box.h * k));
  c.getContext("2d").drawImage(img, box.x * k, box.y * k, box.w * k, box.h * k, 0, 0, c.width, c.height);
  const tab = B.st?.tabs.find((t) => t.id === B.st.active) || {};
  return X.api("/api/research/add", { kind: "png", title: tab.title || tab.url || "", url: tab.url || "", data: c.toDataURL("image/png") });
}

async function capture(X, mode, rect) {
  if (!B.st?.active) return;
  const btn = $(`[data-cap="${mode}"]`);
  btn?.classList.add("busy");
  try {
    const it = mode === "region" ? await cropRegion(X, rect) : await X.api("/api/research/add", await SH.capture(B.st.active, mode));
    $("#bwScreen").classList.remove("flash");
    void $("#bwScreen").offsetWidth;
    $("#bwScreen").classList.add("flash");
    if (B.panel !== "pano") setPanel(X, "pano");
    if (!B.side) setSide(true);
    await loadItems(X);
    if (it?.id) {
      B.sel.add(it.id);
      renderItems(X);
      $(`.bw-it[data-id="${it.id}"]`)?.classList.add("new");
    }
    X.toast(`Panoya eklendi: ${LABEL[mode]}`);
  } catch (e) {
    X.toast(e.message, true);
  } finally {
    btn?.classList.remove("busy");
  }
}

async function setSelecting(on) {
  if (on) {
    if (!(await showSnapshot())) return;
    B.freeze = true;
  } else {
    B.freeze = false;
    B.nKey = "";
  }
  B.selecting = on;
  $("#bwScreen").classList.toggle("selecting", on);
  $("#bwHint").classList.toggle("hidden", !on);
  $('[data-cap="region"]').classList.toggle("on", on);
  if (!on) $("#bwSel").classList.add("hidden");
  if (on) $("#bwScreen").focus();
}

// ---------- research agent ----------

function agentLog(X, job) {
  const { esc } = X;
  const rows = (job.log || []).slice(-80);
  if (!rows.length) return `<div class="ag-empty-log">${job.status === "sirada" ? "Ajan görevi alınca adımlar burada görünecek." : "Henüz adım yok."}</div>`;
  return rows.map((l) => `<div class="ag-l k-${esc(l.kind || "info")}"><span class="ag-t">${new Date(l.at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span><span>${esc(l.text)}</span></div>`).join("");
}

function currentJob() {
  return (B.view && B.ag.jobs.find((j) => j.id === B.view)) || B.ag.active;
}

function renderAgent(X) {
  const box = $("#bwAgent");
  if (!box || B.panel !== "ajan") return;
  const { ic, esc } = X;
  const ag = B.ag;
  const job = currentJob();
  const keepTask = $("#agTask")?.value || "";
  const keepCmd = $("#agCmd")?.value || "";
  const old = $("#agLog");
  const stick = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 30;
  const scroll = old?.scrollTop || 0;
  if (!job) {
    const past = ag.jobs.filter((j) => !LIVE.has(j.status)).slice(0, 6);
    box.innerHTML = `<div class="ag-new">
      <div class="ag-hero">${ic("bot", 22)}<div><b>Araştırma ajanı</b><span>Ne araştırılsın? Ajan bu tarayıcıda arar, sayfaları gezer, istediğin kısımları panoya kaydeder ve sonunda senin kontrolünü bekler.</span></div></div>
      <textarea id="agTask" rows="5" placeholder="ör. 2026'da Instagram Reels algoritması hakkında güvenilir 5 kaynak bul; önemli rakamları ve alıntıları kaydet, en açıklayıcı grafiğin ekran görüntüsünü al">${esc(keepTask)}</textarea>
      <button class="btn primary wide" id="agStart">${ic("play", 15)}Görevi başlat</button>
      ${ag.desktop ? "" : `<div class="warnline sm">${ic("triangle-alert", 13)} Masaüstü penceresiyle bağlantı bekleniyor…</div>`}
      <div class="sm muted">Görev, Yapay Zeka sekmesinde açık olan bir ajana gider. İstediğin an duraklatabilir, iptal edebilir ya da ek komut verebilirsin.</div>
      ${past.length ? `<div class="ag-past"><div class="ag-ph">Önceki görevler</div>${past.map((j) => `<button class="ag-pj" data-view="${j.id}"><span class="ag-chip s-${AST[j.status]?.[0] || "off"}">${AST[j.status]?.[1] || j.status}</span><span class="grow">${esc(j.task)}</span></button>`).join("")}</div>` : ""}
    </div>`;
  } else {
    const [cls, label] = AST[job.status] || ["off", job.status];
    const live = LIVE.has(job.status);
    const items = (job.items || []).length;
    box.innerHTML = `<div class="ag-job">
      <div class="ag-head"><span class="ag-chip s-${cls}">${cls === "work" ? `<span class="ag-pulse"></span>` : ""}${label}</span><span class="muted sm">${job.id}</span><span class="grow"></span>
        ${B.view ? `<button class="bw-btn sm" id="agBack" title="Kapat">${ic("x", 14)}</button>` : ""}</div>
      <div class="ag-task">${esc(job.task)}</div>
      ${live && job.status !== "inceleme" ? `<div class="ag-ctl">${job.status === "duraklatildi" ? `<button class="btn primary sm" data-ag="resume">${ic("play", 14)}Devam et</button>` : `<button class="btn ghost sm" data-ag="pause">${ic("pause", 14)}Duraklat</button>`}
        <button class="btn ghost sm" data-ag="cancel">${ic("square", 13)}İptal</button></div>` : ""}
      ${job.status === "inceleme" ? `<div class="ag-review"><b>${ic("badge-check", 15)}Ajan bitirdi, kontrolünü bekliyor</b>${job.summary ? `<p>${esc(job.summary)}</p>` : ""}
        <div class="row wrap"><button class="btn primary sm" data-ag="done">${ic("check", 14)}Onayla, bitir</button><button class="btn ghost sm" data-ag="items">${ic("notebook-pen", 14)}Kaydedilenler (${items})</button><button class="btn ghost sm" data-ag="cancel">İptal</button></div></div>`
        : items ? `<button class="ag-items" data-ag="items">${ic("notebook-pen", 14)}<span class="grow">Kaydedilenler</span><b>${items}</b></button>` : ""}
      <div class="ag-log" id="agLog">${agentLog(X, job)}</div>
      ${live ? `<form class="ag-cmd" id="agCmdForm"><input id="agCmd" placeholder="${job.status === "inceleme" ? "Devam etmesi için yeni komut yaz…" : "Ajana ek komut ver…"}" autocomplete="off" value="${esc(keepCmd)}"><button class="btn primary sm" title="Gönder">${ic("send", 14)}</button></form>`
        : `<button class="btn ghost sm wide" id="agNew">${ic("plus", 14)}Yeni görev</button>`}
    </div>`;
    const log = $("#agLog");
    if (log) log.scrollTop = stick ? log.scrollHeight : scroll;
  }
  bindAgent(X);
}

function bindAgent(X) {
  const start = $("#agStart");
  if (start) {
    start.onclick = X.guard(async () => {
      const task = $("#agTask").value.trim();
      if (!task) {
        $("#agTask").focus();
        throw new Error("Önce görevi yaz");
      }
      await X.api("/api/webagent/new", { task });
      $("#agTask").value = "";
      B.view = null;
      await pollAgent(X, true);
      X.toast("Görev ajana gönderildi");
    });
    $("#agTask").onkeydown = (e) => e.stopPropagation();
  }
  const cmdForm = $("#agCmdForm");
  if (cmdForm) {
    cmdForm.onsubmit = X.guard(async (e) => {
      e.preventDefault();
      const text = $("#agCmd").value.trim();
      const job = currentJob();
      if (!text || !job) return;
      await X.api(`/api/webagent/${job.id}/command`, { text });
      $("#agCmd").value = "";
      await pollAgent(X, true);
      X.toast("Komut ajana iletildi");
    });
    $("#agCmd").onkeydown = (e) => e.stopPropagation();
  }
  for (const b of document.querySelectorAll("#bwAgent [data-ag]")) {
    b.onclick = X.guard(async () => {
      const job = currentJob();
      if (!job) return;
      const a = b.dataset.ag;
      if (a === "items") {
        B.job = job.id;
        setPanel(X, "pano");
        return loadItems(X);
      }
      if (a === "cancel") {
        return X.confirm("Görev iptal edilsin mi?", "Ajan durur; o ana kadar kaydedilenler panoda kalır.", "İptal et", X.guard(async () => {
          await X.api(`/api/webagent/${job.id}/cancel`, {});
          await pollAgent(X, true);
        }));
      }
      await X.api(`/api/webagent/${job.id}/${a}`, {});
      await pollAgent(X, true);
      if (a === "done") X.toast("Görev tamamlandı");
    });
  }
  for (const b of document.querySelectorAll("#bwAgent [data-view]")) {
    b.onclick = () => {
      B.view = b.dataset.view;
      renderAgent(X);
    };
  }
  const back = $("#agBack");
  if (back) {
    back.onclick = () => {
      B.view = null;
      renderAgent(X);
    };
  }
  const nw = $("#agNew");
  if (nw) {
    nw.onclick = () => {
      B.view = null;
      B.ag.active = null;
      renderAgent(X);
      $("#agTask")?.focus();
    };
  }
}

async function pollAgent(X, force = false) {
  let d;
  try {
    d = await (await fetch("/api/webagent")).json();
  } catch {
    return;
  }
  const prev = JSON.stringify(B.ag);
  const before = B.ag.active?.items?.length || 0;
  B.ag = { jobs: d.jobs || [], active: d.active || null, desktop: !!d.desktop };
  const dot = $("#bwAgDot");
  if (dot) dot.className = `ag-dot ${B.ag.active ? `s-${AST[B.ag.active.status]?.[0] || "off"}` : ""}`;
  if (force || JSON.stringify(B.ag) !== prev) {
    const typing = !force && document.activeElement && ["agTask", "agCmd"].includes(document.activeElement.id);
    if (!typing) renderAgent(X);
    if ((B.ag.active?.items?.length || 0) !== before) loadItems(X);
  }
}

function watchAgent(X) {
  clearInterval(B.agTimer);
  B.agTimer = setInterval(() => {
    if (X.S.tab !== "browser") {
      clearInterval(B.agTimer);
      B.agTimer = null;
      return;
    }
    pollAgent(X);
  }, 1500);
  pollAgent(X);
}

// ---------- wiring ----------

function bind(X) {
  const screen = $("#bwScreen");
  const sel = $("#bwSel");
  let drag = null;
  screen.addEventListener("mousedown", (e) => {
    if (!B.selecting) return;
    e.preventDefault();
    const r = screen.getBoundingClientRect();
    drag = { x0: e.clientX - r.left, y0: e.clientY - r.top };
    Object.assign(sel.style, { left: `${drag.x0}px`, top: `${drag.y0}px`, width: "0px", height: "0px" });
    sel.classList.remove("hidden");
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const r = screen.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const y = Math.max(0, Math.min(r.height, e.clientY - r.top));
    Object.assign(sel.style, { left: `${Math.min(x, drag.x0)}px`, top: `${Math.min(y, drag.y0)}px`, width: `${Math.abs(x - drag.x0)}px`, height: `${Math.abs(y - drag.y0)}px` });
  });
  window.addEventListener("mouseup", (e) => {
    if (!drag) return;
    const r = screen.getBoundingClientRect();
    const x1 = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const y1 = Math.max(0, Math.min(r.height, e.clientY - r.top));
    const box = { x: Math.min(x1, drag.x0), y: Math.min(y1, drag.y0), w: Math.abs(x1 - drag.x0), h: Math.abs(y1 - drag.y0) };
    drag = null;
    if (box.w < 8 || box.h < 8) {
      setSelecting(false);
      return X.toast("Alan çok küçük, biraz daha büyük çiz", true);
    }
    capture(X, "region", box).finally(() => setSelecting(false));
  });
  screen.addEventListener("keydown", (e) => {
    if (B.selecting && e.key === "Escape") {
      e.preventDefault();
      setSelecting(false);
    }
  });
  new ResizeObserver(() => tick(X)).observe(screen);
  const wake = () => {
    if (X.S.tab !== "browser") return;
    B.nKey = "";
    if (!B.timer) B.timer = setInterval(() => tick(X), 110);
    tick(X);
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("focus", wake);

  $("#bwTabs").addEventListener("click", (e) => {
    const close = e.target.closest("[data-close]");
    if (close) return act(X, () => SH.close(close.dataset.close));
    if (e.target.closest("#bwNew")) return act(X, () => SH.open());
    const t = e.target.closest("[data-tab]");
    if (t && t.dataset.tab !== B.st?.active) act(X, () => SH.activate(t.dataset.tab)).then(() => SH.focus());
  });
  $("#bwTabs").addEventListener("auxclick", (e) => {
    const t = e.target.closest("[data-tab]");
    if (t && e.button === 1) act(X, () => SH.close(t.dataset.tab));
  });
  $("#bwTabs").addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  for (const b of document.querySelectorAll("#browserView [data-nav]")) b.addEventListener("click", () => act(X, () => SH.nav(B.st?.active, b.dataset.nav)).then(() => SH.focus()));
  $("#bwAddrForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#bwAddr").value.trim();
    if (!v) return;
    $("#bwAddr").blur();
    act(X, () => SH.nav(B.st?.active, "go", v)).then(() => SH.focus());
  });
  $("#bwAddr").addEventListener("focus", () => $("#bwAddr").select());
  $("#bwAddr").addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") SH.focus();
  });
  $("#bwCaps").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cap]");
    if (!b || b.classList.contains("busy")) return;
    if (b.dataset.cap === "region") return setSelecting(!B.selecting);
    if (B.selecting) setSelecting(false);
    capture(X, b.dataset.cap);
  });
  $("#bwSideBtn").addEventListener("click", () => setSide(!B.side));
  $("#bwSideX").addEventListener("click", () => setSide(false));
  $("#bwSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (b) setPanel(X, b.dataset.p);
  });
  $("#bwNoteBtn").addEventListener("click", () => {
    $("#bwNoteBox").classList.toggle("hidden");
    $("#bwNoteTxt").focus();
  });
  $("#bwNoteCancel").addEventListener("click", () => $("#bwNoteBox").classList.add("hidden"));
  $("#bwNoteTxt").addEventListener("keydown", (e) => e.stopPropagation());
  $("#bwNoteSave").addEventListener("click", X.guard(async () => {
    const text = $("#bwNoteTxt").value.trim();
    if (!text) return;
    const it = await X.api("/api/research/note", { text, title: "", url: "" });
    $("#bwNoteTxt").value = "";
    $("#bwNoteBox").classList.add("hidden");
    if (it?.id) B.sel.add(it.id);
    await loadItems(X);
    X.toast("Not panoya eklendi");
  }));
  $("#bwFilter").addEventListener("click", (e) => {
    if (!e.target.closest("#bwFilterX")) return;
    B.job = null;
    loadItems(X);
  });
  const items = $("#bwItems");
  items.addEventListener("change", (e) => {
    const ck = e.target.closest("[data-ck]");
    if (ck) {
      if (ck.checked) B.sel.add(ck.dataset.ck);
      else B.sel.delete(ck.dataset.ck);
      return renderItems(X);
    }
    const note = e.target.closest("[data-note]");
    if (note) X.api(`/api/research/${note.dataset.note}/update`, { note: note.value }).then(() => {
      const it = B.items.find((i) => i.id === note.dataset.note);
      if (it) it.note = note.value;
    }).catch((er) => X.toast(er.message, true));
  });
  items.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && e.target.matches("[data-note]")) e.target.blur();
  });
  items.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      return X.api("/api/research/delete", { ids: [del.dataset.del] }).then(() => {
        B.sel.delete(del.dataset.del);
        return loadItems(X);
      }).catch((er) => X.toast(er.message, true));
    }
    const row = e.target.closest(".bw-it");
    if (row && !e.target.closest("a, input, label, button")) {
      const id = row.dataset.id;
      if (B.sel.has(id)) B.sel.delete(id);
      else B.sel.add(id);
      renderItems(X);
    }
  });
  $("#bwAll").addEventListener("change", (e) => {
    B.sel = new Set(e.target.checked ? B.items.map((i) => i.id) : []);
    renderItems(X);
  });
  $("#bwDel").addEventListener("click", () => {
    const ids = [...B.sel];
    if (!ids.length) return;
    X.confirm("Seçilenler silinsin mi?", `${ids.length} öğe panodan kalıcı olarak silinir.`, "Sil", X.guard(async () => {
      await X.api("/api/research/delete", { ids });
      B.sel.clear();
      await loadItems(X);
    }));
  });
  $("#bwSend").addEventListener("click", X.guard(async () => {
    const ids = B.items.filter((i) => B.sel.has(i.id)).map((i) => i.id);
    if (!ids.length) return;
    const payload = await X.api("/api/research/send", { ids });
    const views = await import("/web/views.js");
    views.addResearchToDraft(X, payload);
    X.setTab("create");
    X.toast(`${ids.length} öğe Oluştur ekranına eklendi`);
  }));
  SH.onState((st) => applyState(X, st));
  SH.onCommand((c) => {
    if (c.type === "address") {
      if (X.S.tab !== "browser") X.setTab("browser");
      $("#bwAddr").focus();
      $("#bwAddr").select();
    } else if (c.type === "capture") {
      if (c.mode === "region") setSelecting(true);
      else capture(X, c.mode);
    } else if (c.type === "agent") {
      pollAgent(X, true);
    }
  });
}

export function openBrowser(X) {
  if (!SH) return gate(X);
  const el = $("#browserView");
  if (!B.built) {
    el.innerHTML = shell(X);
    B.built = true;
    try {
      B.side = localStorage.getItem("sosyal-bw-side") !== "0";
    } catch {}
    $("#browserView .bw").classList.toggle("noside", !B.side);
    bind(X);
    setPanel(X, "pano");
  }
  loadItems(X);
  SH.state().then((st) => applyState(X, st)).catch(() => {});
  B.nKey = "";
  clearInterval(B.timer);
  B.timer = setInterval(() => tick(X), 110);
  tick(X);
  watchAgent(X);
}
