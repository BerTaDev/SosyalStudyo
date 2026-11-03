import { ago } from "/web/views.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const NKINDS = [["dm", "Yeni mesajlar", "send"], ["comment", "Yeni yorumlar", "message-circle"], ["follow", "Yeni takipçiler", "user-plus"],
  ["ready", "Video hazır", "clapperboard"], ["published", "Instagram'da yayınlandı", "instagram"], ["error", "Hatalar", "triangle-alert"],
  ["ideas", "Metin kurguları hazır", "lightbulb"], ["template", "Şablon hazır", "palette"], ["agent", "Ajan yanıtları ve açıklamalar", "bot"],
  ["autopilot", "Otopilot", "rocket"]];
const ICON = Object.fromEntries(NKINDS.map(([k, , i]) => [k, i]));
const SHOW_MS = 7000;
let last = null;

export const isMuted = (ns) => !!ns?.mute_until && new Date(ns.mute_until) > new Date();

export function muteText(ns) {
  if (!isMuted(ns)) return "";
  const d = new Date(ns.mute_until);
  const today = d.toDateString() === new Date().toDateString();
  return `${today ? "" : d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" }) + " "}${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}'e kadar sessiz`;
}

export function muteUntil(choice) {
  if (choice === "off") return "";
  const d = new Date();
  if (choice === "1h") d.setHours(d.getHours() + 1);
  else if (choice === "8h") d.setHours(d.getHours() + 8);
  else {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  }
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

export function go(X, link = {}) {
  const { S } = X;
  if (link.post) {
    X.setTab("posts");
    X.select(link.post);
  } else if (link.ideas) location.hash = link.ideas;
  else if (link.tab === "account") {
    S.acc = { ...(S.acc || {}), tab: link.sub || "posts" };
    if (link.conv) S.acc.thread = link.conv;
    X.setTab("account");
  } else if (link.tab) X.setTab(link.tab);
}

function stack() {
  let el = $("#nstack");
  if (!el) {
    el = document.createElement("div");
    el.id = "nstack";
    document.body.append(el);
  }
  return el;
}

function close(card) {
  if (card._gone) return;
  card._gone = true;
  card.classList.add("out");
  setTimeout(() => card.remove(), 260);
}

function showToast(X, n) {
  const { ic, esc } = X;
  const box = stack();
  const card = document.createElement("div");
  card.className = `ntoast k-${n.kind}`;
  card.innerHTML = `<span class="nic">${ic(ICON[n.kind] || "bell", 18)}</span>
    <div class="grow"><b>${esc(n.title)}</b>${n.text ? `<div class="ntext">${esc(n.text)}</div>` : ""}<div class="nwhen">şimdi</div></div>
    <button class="nx" title="Kapat">${ic("x", 14)}</button><i class="nbar"></i>`;
  box.prepend(card);
  while (box.children.length > 4) close(box.lastElementChild);
  requestAnimationFrame(() => card.classList.add("in"));
  let left = SHOW_MS;
  let started = Date.now();
  let timer = setTimeout(() => close(card), left);
  const bar = $(".nbar", card);
  bar.style.animationDuration = `${SHOW_MS}ms`;
  card.onmouseenter = () => {
    clearTimeout(timer);
    left -= Date.now() - started;
    bar.style.animationPlayState = "paused";
  };
  card.onmouseleave = () => {
    started = Date.now();
    timer = setTimeout(() => close(card), Math.max(800, left));
    bar.style.animationPlayState = "running";
  };
  card.onclick = (e) => {
    close(card);
    if (e.target.closest(".nx")) return;
    X.api("/api/notifications/read", { ids: [n.id] }).catch(() => {});
    go(X, n.link);
  };
}

function desktop(X, n) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const d = new Notification(n.title, { body: n.text || "", icon: "/web/icon-192.png", tag: `ss-${n.id}` });
    d.onclick = () => {
      window.focus();
      go(X, n.link);
      d.close();
    };
  } catch {}
}

export function handleNotifications(X, data, ns) {
  if (!data) return;
  renderBell(X, data, ns);
  if (last === null) {
    last = data.last;
    return;
  }
  const fresh = data.items.filter((i) => i.id > last).reverse();
  last = Math.max(last, data.last);
  if (!ns?.enabled || isMuted(ns)) return;
  for (const n of fresh) {
    if (ns.kinds?.[n.kind] === false) continue;
    showToast(X, n);
    if (ns.desktop && document.hidden) desktop(X, n);
  }
}

function renderBell(X, data, ns) {
  const b = $("#bellBtn");
  if (!b) return;
  const off = !ns?.enabled || isMuted(ns);
  const sig = `${data.unread}|${off}`;
  if (b.dataset.sig === sig) return;
  b.dataset.sig = sig;
  b.innerHTML = `${X.ic(off ? "bell-off" : "bell", 17)}${data.unread ? `<b class="nbadge">${data.unread > 99 ? "99+" : data.unread}</b>` : ""}`;
  b.title = off ? (isMuted(ns) ? `Bildirimler ${muteText(ns)}` : "Anlık bildirimler kapalı") : "Bildirimler";
  b.classList.toggle("muted-bell", off);
}

async function saveNotify(X, patch) {
  await X.api("/api/settings", { notifications: patch });
  await X.refresh();
}

export function toggleBellPanel(X) {
  const { S, ic, esc } = X;
  const open = $("#npanel");
  if (open) return open.remove();
  const data = S.notifications || { items: [], unread: 0 };
  const ns = S.notify_settings || {};
  const p = document.createElement("div");
  p.id = "npanel";
  p.innerHTML = `<div class="nphead"><b class="grow">Bildirimler</b>
      <button class="btn icon ghost sm" id="npRead" title="Tümünü okundu say">${ic("check-check", 16)}</button>
      <button class="btn icon ghost sm" id="npMute" title="Sessize al">${ic(isMuted(ns) ? "bell-off" : "moon", 16)}</button>
      <button class="btn icon ghost sm" id="npSet" title="Bildirim ayarları">${ic("sliders-horizontal", 16)}</button></div>
    ${isMuted(ns) ? `<div class="npmuted">${ic("bell-off", 14)}<span class="grow">${esc(muteText(ns))}</span><a href="#" id="npUnmute">Sesi aç</a></div>` : !ns.enabled ? `<div class="npmuted">${ic("bell-off", 14)}<span class="grow">Anlık bildirimler kapalı</span><a href="#" id="npOn">Aç</a></div>` : ""}
    <div class="npmenu hidden" id="npMenu">${[["1h", "1 saat"], ["8h", "8 saat"], ["morning", "Yarın sabaha kadar"], ["off", "Susturmayı kapat"]].map(([k, t]) => `<button data-mute="${k}">${t}</button>`).join("")}</div>
    <div class="nplist">${data.items.length ? data.items.map((n) => `<button class="npitem ${n.read ? "" : "unread"} k-${n.kind}" data-n="${n.id}">
        <span class="nic">${ic(ICON[n.kind] || "bell", 16)}</span><div class="grow"><b>${esc(n.title)}</b>${n.text ? `<div class="ntext">${esc(n.text)}</div>` : ""}<div class="nwhen">${ago(n.at)}</div></div></button>`).join("")
      : `<div class="empty sm">${ic("bell", 24)}<div>Henüz bildirim yok.</div></div>`}</div>
    ${data.items.length ? `<div class="npfoot"><a href="#" id="npClear">Hepsini temizle</a></div>` : ""}`;
  document.body.append(p);
  requestAnimationFrame(() => p.classList.add("in"));
  const outside = (e) => {
    if (!p.contains(e.target) && !e.target.closest("#bellBtn")) {
      p.remove();
      document.removeEventListener("mousedown", outside);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
  $("#npRead", p).onclick = X.guard(async () => {
    await X.api("/api/notifications/read", {});
    await X.refresh();
    p.remove();
  });
  $("#npMute", p).onclick = () => $("#npMenu", p).classList.toggle("hidden");
  for (const b of $$("[data-mute]", p))
    b.onclick = X.guard(async () => {
      await saveNotify(X, { mute_until: muteUntil(b.dataset.mute) });
      p.remove();
      X.toast(b.dataset.mute === "off" ? "Bildirimler açık" : "Bildirimler susturuldu");
    });
  const un = $("#npUnmute", p);
  if (un) un.onclick = X.guard(async (e) => {
    e.preventDefault();
    await saveNotify(X, { mute_until: "" });
    p.remove();
  });
  const on = $("#npOn", p);
  if (on) on.onclick = X.guard(async (e) => {
    e.preventDefault();
    await saveNotify(X, { enabled: true });
    p.remove();
  });
  $("#npSet", p).onclick = () => {
    p.remove();
    X.openSettings("notify");
  };
  const clear = $("#npClear", p);
  if (clear) clear.onclick = X.guard(async (e) => {
    e.preventDefault();
    await X.api("/api/notifications/clear", {});
    await X.refresh();
    p.remove();
  });
  $(".nplist", p).onclick = (e) => {
    const it = e.target.closest("[data-n]");
    if (!it) return;
    const n = data.items.find((x) => String(x.id) === it.dataset.n);
    X.api("/api/notifications/read", { ids: [n.id] }).then(() => X.refresh()).catch(() => {});
    p.remove();
    go(X, n.link);
  };
}

export function notifySettingsHtml(X, ns) {
  const { ic, esc } = X;
  return `<fieldset id="sNotify"><legend>Bildirimler</legend>
    <label class="check"><input type="checkbox" id="nEnabled" ${ns.enabled ? "checked" : ""}> Anlık bildirimleri sağ altta göster</label>
    <label>Sessize al ${isMuted(ns) ? `<b class="sm" style="color:var(--accent2)">· ${esc(muteText(ns))}</b>` : ""}</label>
    <div class="seg sm" id="nMute">${[["off", "Açık"], ["1h", "1 saat"], ["8h", "8 saat"], ["morning", "Yarın sabaha kadar"]].map(([k, t]) => `<button type="button" data-m="${k}" class="${(k === "off") === !isMuted(ns) && k === "off" ? "active" : ""}">${t}</button>`).join("")}</div>
    <label class="check"><input type="checkbox" id="nDesktop" ${ns.desktop ? "checked" : ""}> Pencere arka plandayken Windows bildirimi de göster</label>
    <label>Hangi bildirimler gelsin?</label>
    <div class="nkinds">${NKINDS.map(([k, t, i]) => `<label class="check"><input type="checkbox" data-nk="${k}" ${ns.kinds?.[k] !== false ? "checked" : ""}>${ic(i, 14)} ${t}</label>`).join("")}</div>
    <div class="sm muted" style="margin-top:8px">${ic("info", 13)} Yeni yorum, mesaj ve takipçiler birkaç dakikada bir Instagram'dan kontrol edilir. Bildirim geçmişi zil simgesinde durur.</div>
  </fieldset>`;
}

export function bindNotifySettings(X, m) {
  let mute = null;
  for (const b of $$("#nMute [data-m]", m))
    b.onclick = () => {
      mute = b.dataset.m;
      $$("#nMute [data-m]", m).forEach((x) => x.classList.toggle("active", x === b));
    };
  $("#nDesktop", m).onchange = async (e) => {
    if (!e.target.checked || !("Notification" in window)) return;
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission !== "granted") {
      e.target.checked = false;
      X.toast("Windows bildirimi için tarayıcı izni verilmedi", true);
    }
  };
  return () => {
    const out = { enabled: $("#nEnabled", m).checked, desktop: $("#nDesktop", m).checked,
      kinds: Object.fromEntries($$("[data-nk]", m).map((c) => [c.dataset.nk, c.checked])) };
    if (mute) out.mute_until = muteUntil(mute);
    return out;
  };
}
