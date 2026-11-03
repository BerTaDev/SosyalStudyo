const $ = (s, r = document) => r.querySelector(s);
const KIND = { new: "Yeni video", note: "Revizyon", caption: "Açıklama", ideas: "Fikir yazımı", template: "Şablon" };

function since(iso) {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 60 ? `${s} sn` : s < 3600 ? `${Math.floor(s / 60)} dk` : `${Math.floor(s / 3600)} sa ${Math.floor((s % 3600) / 60)} dk`;
}

const accTag = (a) => (!a || a === "main" ? "Ana" : a.toUpperCase());

function groups(S) {
  const active = S.accounts || [S.account || "main"];
  const mine = (a) => active.includes(a.account || "main");
  const work = S.agents.filter((a) => a.live === "working");
  const ready = S.agents.filter((a) => a.live === "watching" && mine(a));
  const idle = S.agents.filter((a) => a.live !== "off" && a.live !== "working" && !mine(a));
  const stale = S.agents.filter((a) => a.stale);
  return { work, ready, idle, stale, queue: S.queue || [], uploads: S.cloud?.uploading || 0 };
}

export function renderLiveButton(X) {
  const { S, ic } = X;
  const el = $("#liveBtn");
  if (!el) return;
  const g = groups(S);
  const q = g.queue.length;
  let icon = ic("activity", 15);
  let mark = `<i class="lj-dot ok"></i>`;
  let tip = `${g.ready.length} ajan hazır`;
  if (g.work.length) {
    icon = ic("loader-circle", 15, "spin");
    mark = `<b class="lj-n">${g.work.length}</b>`;
    tip = g.work.map((a) => `${a.name}: ${a.text || "çalışıyor"}`).join("\n");
  } else if (!g.ready.length) {
    icon = ic("bot", 15);
    mark = `<i class="lj-dot warn"></i>`;
    tip = "Hiçbir ajan iş beklemiyor; istekler sıraya girer";
  }
  const html = `${icon}<span class="lj-t">Anlık işler</span>${mark}${q ? `<b class="lj-n q">+${q}</b>` : ""}${g.stale.length ? `<b class="lj-n bad" title="Yanıt vermeyen ajan">!</b>` : ""}`;
  if (el.dataset.sig !== html) {
    el.dataset.sig = html;
    el.innerHTML = html;
  }
  el.className = `live-btn${g.work.length ? " work" : !g.ready.length ? " warn" : ""}${$("#livePop") ? " open" : ""}`;
  el.title = `${tip}${q ? `\nSırada ${q} iş` : ""}${g.stale.length ? `\n${g.stale.length} ajan yanıt vermiyor` : ""}${g.idle.length ? `\n${g.idle.length} ajan kapalı hesapta boşta` : ""}`;
  const pop = $("#livePop");
  if (pop) drawPop(X, pop);
}

function drawPop(X, pop) {
  const { S, ic, esc } = X;
  const g = groups(S);
  const post = (id) => S.posts.find((p) => p.id === id);
  const title = (id) => post(id)?.title || (S.ideas || []).find((b) => b.id === id)?.topic || "";
  const role = (a) => ((a.only || []).includes("ideas") ? "Fikir ajanı" : "Video ajanı");
  const sec = (icon, name, n, body) => `<section class="lj-sec"><h4>${ic(icon, 13)}${name}<span class="lj-c">${n}</span></h4>${body}</section>`;
  const work = g.work.map((a) => {
    const p = post(a.post);
    return `<div class="lj-row work">
        <span class="lj-av">${ic("loader-circle", 16, "spin")}</span>
        <div class="grow"><div class="lj-name">${esc(a.name)}<span class="lj-tag">${accTag(a.account)}</span><span class="lj-time">${since(a.since)}</span></div>
          <div class="lj-txt">${esc(a.text || p?.stage || "Çalışıyor")}</div>
          ${a.post ? `<a href="#${esc(a.post)}" class="lj-link" data-lj-close>#${esc(a.post)} · ${esc(title(a.post))}</a>` : ""}
          ${p && p.progress != null && ["sirada", "uretimde"].includes(p.status) ? `<div class="lj-bar"><i style="width:${Math.round((p.progress || 0) * 100)}%"></i></div>` : ""}</div>
      </div>`;
  }).join("");
  const ready = g.ready.map((a) => `<div class="lj-row"><span class="lj-av ok"><i class="lj-dot ok"></i></span>
      <div class="grow lj-one"><span class="lj-name">${esc(a.name)}</span><span class="lj-role">${role(a)}</span></div><span class="lj-tag">${accTag(a.account)}</span></div>`).join("");
  const queue = g.queue.map((j, i) => `<div class="lj-row"><span class="lj-qn">${i + 1}</span>
      <div class="grow lj-one"><span class="lj-kind k-${esc(j.kind)}">${KIND[j.kind] || esc(j.kind)}</span><a href="#${esc(j.post)}" class="lj-link" data-lj-close>${esc(j.title || "")}</a></div><span class="lj-time">${since(j.since)}</span></div>`).join("");
  const idle = g.idle.length ? `<div class="lj-idle">${ic("moon", 13)}<span class="grow">${g.idle.map((a) => esc(a.name)).join(", ")}</span><span class="lj-tag">${[...new Set(g.idle.map((a) => accTag(a.account)))].join(", ")}</span></div>
      <div class="lj-note">Bu hesaplar kapalı; iş almazlar. Claude panelinden açabilirsin.</div>` : "";
  const stale = g.stale.map((a) => `<div class="lj-row"><span class="lj-av bad">${ic("unplug", 15)}</span>
      <div class="grow"><div class="lj-name">${esc(a.name)}<span class="lj-tag">${accTag(a.account)}</span><span class="lj-time">${since(a.seen)} önce</span></div>
        <div class="lj-txt bad">Yanıt vermiyor${a.post ? ` · #${esc(a.post)} ${esc(title(a.post))}` : ""}</div>
        <div class="lj-note0">Oturumu kapanmış olabilir. Bu videoya yazdığın notları artık iş bekleyen başka bir ajan alır.</div></div></div>`).join("");
  const cloud = g.uploads ? `<button type="button" class="lj-row lj-btnrow" data-lj="cloud"><span class="lj-av up">${ic("cloud-upload", 15)}</span>
      <div class="grow lj-one"><span class="lj-name">${g.uploads} video buluta yükleniyor</span></div>${ic("chevron-right", 14)}</button>` : "";
  const parts = [];
  if (work) parts.push(sec("loader-circle", "Çalışıyor", g.work.length, work));
  if (stale) parts.push(sec("unplug", "Yanıt vermiyor", g.stale.length, stale));
  if (cloud) parts.push(sec("cloud", "Bulut", g.uploads, cloud));
  if (queue) parts.push(sec("list", "Sırada bekleyen", g.queue.length, queue));
  if (ready) parts.push(sec("circle-check", "Hazır, iş bekliyor", g.ready.length, ready));
  if (idle) parts.push(sec("moon", "Boşta", g.idle.length, idle));
  const empty = !g.work.length && !g.ready.length
    ? `<div class="lj-empty">${ic("bot", 22)}<b>Ajan bağlı değil</b><span>İstekler sıraya girer; bir ajan bağlanınca başlar.</span></div>` : "";
  const sum = [g.work.length && `${g.work.length} çalışıyor`, g.ready.length && `${g.ready.length} hazır`, g.queue.length && `${g.queue.length} sırada`].filter(Boolean).join(" · ");
  const html = `<div class="lj-head"><b>${ic("activity", 15)}Anlık işler</b><span class="lj-sum">${sum}</span></div>
    <div class="lj-body">${empty}${parts.join("")}</div>
    <div class="lj-foot"><button type="button" class="btn sm ghost" data-lj="claude">${ic("gauge", 14)}Hesaplar ve ajanlar</button><button type="button" class="btn sm ghost" data-lj="ai">${ic("eye", 14)}Canlı akış</button></div>`;
  if (pop.dataset.sig === html) return;
  pop.dataset.sig = html;
  const body = $(".lj-body", pop);
  const top = body ? body.scrollTop : 0;
  pop.innerHTML = html;
  $(".lj-body", pop).scrollTop = top;
}

function place(pop) {
  const b = $("#liveBtn").getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.top = `${b.bottom + 8}px`;
  pop.style.left = `${Math.max(10, Math.min(innerWidth - w - 10, b.right - w))}px`;
}

export function closeLive() {
  const p = $("#livePop");
  if (!p) return;
  p._off?.();
  p.remove();
  $("#liveBtn")?.classList.remove("open");
}

export function toggleLive(X, hooks) {
  if ($("#livePop")) return closeLive();
  const pop = document.createElement("div");
  pop.id = "livePop";
  document.body.append(pop);
  drawPop(X, pop);
  place(pop);
  $("#liveBtn").classList.add("open");
  requestAnimationFrame(() => pop.classList.add("in"));
  pop.onclick = (e) => {
    const a = e.target.closest("[data-lj]")?.dataset.lj;
    if (e.target.closest("[data-lj-close]")) return closeLive();
    if (!a) return;
    closeLive();
    if (a === "ai") X.setTab("ai");
    else if (a === "claude") hooks.claude();
    else if (a === "cloud") hooks.cloud();
  };
  const outside = (e) => {
    if (!pop.contains(e.target) && !e.target.closest("#liveBtn")) closeLive();
  };
  const key = (e) => e.key === "Escape" && closeLive();
  const resize = () => place(pop);
  pop._off = () => {
    document.removeEventListener("mousedown", outside, true);
    document.removeEventListener("keydown", key, true);
    removeEventListener("resize", resize);
  };
  setTimeout(() => {
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", key, true);
    addEventListener("resize", resize);
  }, 0);
}
