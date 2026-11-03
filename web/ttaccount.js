import { ago } from "/web/views.js";
import { claudeSetupBtn } from "/web/claudesetup.js";

const $ = (s, el = document) => el.querySelector(s);
const nf = (v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR"));
const cf = (v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR", { notation: "compact", maximumFractionDigits: 1 }));
const p2 = (n) => String(n).padStart(2, "0");
const TTL = 5 * 60000;
const RETRY = 60000;
const CONTENT = "https://www.tiktok.com/tiktokstudio/content";
const STATE = { scheduled: ["calendar-clock", "Planlandı", "sch"], public: ["globe", "Yayında", "pub"], limited: ["eye-off", "Sınırlı", "lim"] };
const VIS = { Herkes: "globe", Arkadaşlar: "users", "Sadece siz": "lock", Gizli: "lock" };
const IX = [["views", "eye", "Görüntülenme"], ["likes", "heart", "Beğeni"], ["comments", "message-circle", "Yorum"], ["shares", "share-2", "Paylaşım"], ["saves", "bookmark", "Kaydetme"]];
const RAIL = [["likes", "heart", "Beğeni"], ["comments", "message-circle", "Yorum"], ["saves", "bookmark", "Kaydetme"], ["shares", "share-2", "Paylaşım"]];
const FILTERS = [["all", "Tümü", () => true], ["studio", "Stüdyodan", (v) => !!v.studio], ["scheduled", "Planlandı", (v) => v.state === "scheduled"],
  ["public", "Yayında", (v) => v.state === "public"], ["limited", "Sınırlı", (v) => v.state === "limited"]];

const Z = { r: null, err: null, at: 0, failAt: 0, p: null, filter: "all", after: null };
const wired = new WeakSet();

function dur(s) {
  if (!s) return "";
  const m = Math.floor(s / 60);
  return `${m}:${p2(s % 60)}`;
}

function when(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - d0) / 864e5);
  const hm = `${p2(t.getHours())}:${p2(t.getMinutes())}`;
  if (days === 0) return `bugün ${hm}`;
  if (days === 1) return `yarın ${hm}`;
  if (days === -1) return `dün ${hm}`;
  return t.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function dateText(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (isNaN(t)) return "";
  return Date.now() - t < 30 * 864e5 ? ago(iso) : t.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
}

async function get(fresh) {
  try {
    const r = await fetch(`/api/tiktok/account${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
    if (r.status === 404) return { ok: false, error: { code: "missing", message: "Bu görünüm stüdyo yeniden başlatılınca açılacak." } };
    const d = await r.json().catch(() => null);
    if (!d || typeof d !== "object") throw new Error(`HTTP ${r.status}`);
    if (!r.ok && d.ok !== false) throw new Error(typeof d.error === "string" ? d.error : `HTTP ${r.status}`);
    return d;
  } catch (e) {
    return { ok: false, error: { code: "error", message: /fetch/i.test(e.message) ? "Stüdyo sunucusuna ulaşılamadı" : e.message } };
  }
}

function load(fresh = false) {
  if (Z.p) return Z.p;
  if (!fresh && Z.r?.ok && Date.now() - Z.at < TTL) return Promise.resolve(Z.r);
  if (!fresh && Z.r && !Z.r.ok && Date.now() - Z.failAt < RETRY) return Promise.resolve(Z.r);
  const p = get(fresh)
    .then((r) => {
      if (r.ok) {
        Z.r = r;
        Z.err = null;
        Z.at = Date.now();
      } else if (Z.r?.ok) {
        Z.err = r.error || { code: "error", message: "" };
        Z.failAt = Date.now();
      } else {
        Z.r = r;
        Z.failAt = Date.now();
      }
      return Z.r;
    })
    .finally(() => {
      if (Z.p === p) Z.p = null;
    });
  Z.p = p;
  return p;
}

export const ttPrefetch = () => load();

export function ttCardInfo(X) {
  const d = Z.r?.ok ? Z.r.data : null;
  const p = d?.profile || {};
  return {
    avatar: p.avatar || null,
    name: p.username ? "@" + p.username : p.nickname || "TikTok",
    stats: d ? [[p.followers, "takipçi"], [p.likes, "beğeni"], [d.totals?.views, "görüntülenme"]] : [],
    warn: Z.err?.code === "login" || Z.r?.error?.code === "login",
    note: !d && Z.p ? "yükleniyor…" : null,
    tip: p.nickname && p.username ? p.nickname : null,
  };
}

const studioThumb = (X, v) => {
  const p = v.studio && (X.S.posts || []).find((x) => x.id === v.studio.id);
  return p?.has_thumb ? `/media/${p.id}/thumb.jpg?v=${encodeURIComponent(p.updated || "")}` : "";
};

function pic(X, v, size) {
  const { ic, esc } = X;
  const alt = studioThumb(X, v);
  const src = v.cover || alt;
  return `<span class="tka-ph">${ic("music", size)}</span>${src ? `<img src="${esc(src)}"${alt && alt !== src ? ` data-alt="${esc(alt)}"` : ""} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}`;
}

function skeleton(X) {
  const { ic } = X;
  return `<div class="tkacc" aria-busy="true">
    <div class="tka-skh"><span class="tka-sk av"></span><div class="grow"><span class="tka-sk l1"></span><span class="tka-sk l2"></span><span class="tka-sk l3"></span></div></div>
    <div class="tka-loading">${ic("loader-circle", 15, "spin")}<span>TikTok'tan hesap bilgileri alınıyor… İlk açılış 10-20 saniye sürebilir.</span></div>
    <div class="tka-tot">${Array.from({ length: 5 }, () => `<span class="tka-sk tc"></span>`).join("")}</div>
    <div class="tka-grid">${Array.from({ length: 6 }, () => `<div class="tka-v"><span class="tka-sk tile"></span><span class="tka-sk ln"></span></div>`).join("")}</div></div>`;
}

function drawOff(X, pane) {
  const { ic } = X;
  pane.innerHTML = `<div class="tkacc"><div class="tka-empty"><span class="tka-logo">${ic("music", 34)}</span>
    <h3>TikTok hesabı bağlı değil</h3>
    <p>Bağlayınca TikTok videolarını görüntülenme, beğeni, yorum, paylaşım ve kaydetme sayılarıyla burada görürsün. Planladığın Reels'ler TikTok'a da planlanabilir.</p>
    <div class="row" style="justify-content:center"><button class="btn tka-go" data-tka="login">${ic("plug", 15)}Ayarlar'dan bağla</button>${claudeSetupBtn("tiktok")}</div></div></div>`;
}

function errBox(X, err) {
  const { ic, esc } = X;
  const [icon, head] = { login: ["key-round", "TikTok oturumu kapalı"], busy: ["hourglass", "TikTok şu an meşgul"], missing: ["clock", "TikTok hesap sayfası birazdan burada"] }[err.code] || ["triangle-alert", "TikTok'tan bilgi alınamadı"];
  const btn = err.code === "login"
    ? `<button class="btn tka-go" data-tka="login">${ic("key-round", 15)}TikTok'a giriş yap</button>`
    : err.code === "missing" ? "" : `<button class="btn" data-tka="retry">${ic("refresh-cw", 15)}Tekrar dene</button>`;
  return `<div class="tka-empty${err.code === "login" ? "" : " calm"}"><span class="tka-logo">${ic(icon, 32)}</span><h3>${head}</h3>${err.message ? `<p>${esc(err.message)}</p>` : ""}${btn}</div>`;
}

function stateBadge(X, v, inline = false) {
  const [i, t, c] = STATE[v.state] || STATE.limited;
  return `<span class="tka-pv ${c}${inline ? " inline" : ""}">${X.ic(i, 12)}${t}</span>`;
}

function rail(X, v) {
  const { ic } = X;
  return `<span class="tka-rail">${RAIL.map(([k, i, t]) => `<span title="${t}: ${nf(v[k])}">${ic(i, 15)}<b>${cf(v[k])}</b></span>`).join("")}</span>`;
}

function studioLink(X, v, cls = "tka-st") {
  if (!v.studio) return "";
  const { ic, esc } = X;
  return `<a href="#${esc(v.studio.id)}" class="${cls}" data-studio="${esc(v.studio.id)}" title="${esc(v.studio.title || "")}">${ic("film", 11)}Stüdyo #${esc(v.studio.id)}</a>`;
}

function tile(X, v) {
  const { ic, esc } = X;
  const title = (v.desc || "").split("\n")[0].trim();
  const meta = v.state === "scheduled" ? `<span class="tka-when sch">${ic("calendar-clock", 12)}${esc(when(v.at))}</span>` : `<span class="tka-when">${esc(dateText(v.at))}</span>`;
  return `<div class="tka-v">
    <button class="tka-th" data-open="${esc(v.id)}" title="${esc(v.desc || "")}">${pic(X, v, 28)}
      ${stateBadge(X, v)}${v.duration ? `<span class="tka-dur">${dur(v.duration)}</span>` : ""}
      ${rail(X, v)}
      <span class="tka-ov"><span title="Görüntülenme: ${nf(v.views)}">${ic("eye", 14)}${cf(v.views)}</span></span>
    </button>
    <div class="tka-t">${esc(title || "Açıklamasız video")}</div>
    <div class="tka-m">${meta}${v.visibility ? `<span class="tka-vis" title="Kimler görebilir">${ic(VIS[v.visibility] || "lock", 11)}${esc(v.visibility)}</span>` : ""}${studioLink(X, v)}</div>
  </div>`;
}

const listOf = () => (Z.r?.ok ? Z.r.data.items || [] : []);

function gridHtml(X) {
  const { ic } = X;
  const items = listOf();
  if (!items.length)
    return `<div class="tka-gridempty">${ic("clapperboard", 28)}<b>Hesapta henüz video yok</b><span class="sm">TikTok'a yüklediğin ya da planladığın videolar burada görünecek.</span></div>`;
  const f = FILTERS.find((x) => x[0] === Z.filter) || FILTERS[0];
  const list = items.filter(f[2]);
  return list.length ? `<div class="tka-grid">${list.map((v) => tile(X, v)).join("")}</div>` : `<div class="tka-gridempty sm">Bu filtrede video yok.</div>`;
}

function filtersHtml() {
  const items = listOf();
  if (!items.length) return "";
  return `<div class="tka-filt">${FILTERS.map(([k, t, fn]) => {
    const n = items.filter(fn).length;
    return k !== "all" && !n ? "" : `<button data-tf="${k}" class="${Z.filter === k ? "active" : ""}">${t}<i>${n}</i></button>`;
  }).join("")}</div>`;
}

function totalsHtml(X, d) {
  const { ic } = X;
  const items = d.items || [];
  if (!items.length) return "";
  const t = d.totals || {};
  const sum = (k) => t[k] ?? items.reduce((a, v) => a + (v[k] || 0), 0);
  const sch = items.filter((v) => v.state === "scheduled").length;
  return `<div class="tka-totw"><div class="tka-toth">${ic("activity", 13)}<span>Videolarındaki etkileşimler</span><i>${nf(items.length)} video toplamı</i></div>
    <div class="tka-tot">${IX.map(([k, i, label]) => `<div class="tka-tc ${k}" title="${label}: ${nf(sum(k))}"><span class="tka-ti">${ic(i, 16)}</span><div><b>${cf(sum(k))}</b><span>${label}</span></div></div>`).join("")}</div>
    ${sch ? `<div class="tka-totn">${ic("calendar-clock", 12)}${sch === items.length ? "Videoların henüz yayınlanmadı" : `${nf(sch)} video planlandı`}; sayılar yayından sonra dolmaya başlar.</div>` : ""}</div>`;
}

function notesHtml(X) {
  const { ic, esc } = X;
  const out = [];
  const e = Z.err;
  if (e)
    out.push(`<div class="tka-note warn">${ic(e.code === "login" ? "key-round" : "history", 16)}<span class="grow">Son alınan bilgiler gösteriliyor · ${esc(e.message || "TikTok bilgileri yenilenemedi")}</span>${e.code === "login" ? `<button class="btn sm tka-go" data-tka="login">${ic("key-round", 13)}Giriş yap</button>` : `<button class="btn sm" data-tka="retry">${ic("refresh-cw", 13)}Tekrar dene</button>`}</div>`);
  else if (Z.r?.warning) out.push(`<div class="tka-note warn">${ic("history", 16)}<span class="grow">Son alınan bilgiler gösteriliyor · ${esc(Z.r.warning)}</span></div>`);
  return out.join("");
}

function draw(X, pane) {
  const { ic, esc } = X;
  const r = Z.r;
  if (!r?.ok) {
    pane.innerHTML = `<div class="tkacc">${errBox(X, r?.error || { code: "error", message: "" })}</div>`;
    return;
  }
  const d = r.data;
  const p = d.profile || {};
  const name = p.nickname || p.username || "TikTok";
  const busy = !!Z.p;
  const upd = r.fetched_at ? new Date(r.fetched_at) : null;
  pane.innerHTML = `<div class="tkacc">
    <div class="tka-head">
      <span class="tka-av"><b>${esc((name.replace(/^@/, "")[0] || "?").toUpperCase())}</b>${p.avatar ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer">` : ""}</span>
      <div class="grow">
        <div class="row wrap tka-titlerow"><h2>${esc(name)}${p.verified ? `<span class="tka-ver" title="Onaylı hesap">${ic("badge-check", 18)}</span>` : ""}</h2>
          ${p.url ? `<a class="btn sm tka-go" href="${esc(p.url)}" target="_blank" rel="noopener">${ic("music", 14)}TikTok'ta aç</a>` : ""}
          <a class="btn sm" href="${esc(p.studio_url || "https://www.tiktok.com/tiktokstudio")}" target="_blank" rel="noopener">${ic("external-link", 14)}TikTok Studio</a>
          <button class="btn sm ghost" data-tka="refresh" title="TikTok'tan yeniden alır; 10-20 saniye sürebilir"${busy ? " disabled" : ""}>${busy ? `${ic("loader-circle", 14, "spin")}Yenileniyor…` : `${ic("refresh-cw", 14)}Yenile`}</button></div>
        <div class="tka-handle">${p.username ? `<span>@${esc(p.username)}</span>` : ""}${p.private ? `<span class="tka-priv">${ic("lock", 12)}Gizli hesap</span>` : ""}</div>
        <div class="acc-stats tka-stats"><span><b>${nf(p.following)}</b> takip</span><span><b>${nf(p.followers)}</b> takipçi</span><span><b>${nf(p.likes)}</b> beğeni</span><span><b>${nf(p.videos)}</b> video</span></div>
        ${p.bio ? `<div class="tka-bio" title="Tamamını göster">${esc(p.bio)}</div>` : ""}
      </div>
    </div>
    ${notesHtml(X)}
    ${totalsHtml(X, d)}
    <div class="tka-bar">${filtersHtml()}<span class="grow"></span>${upd && !isNaN(upd) ? `<span class="tka-upd" title="${esc(upd.toLocaleString("tr-TR"))}">Güncellendi ${esc(ago(r.fetched_at))}</span>` : ""}</div>
    <div id="tkaGrid">${gridHtml(X)}</div>
  </div>`;
  const bio = $(".tka-bio", pane);
  if (bio) bio.onclick = () => bio.classList.toggle("open");
}

function redrawGrid(X, pane) {
  const g = $("#tkaGrid", pane);
  if (!g) return draw(X, pane);
  g.innerHTML = gridHtml(X);
  const bar = $(".tka-filt", pane);
  if (bar) bar.outerHTML = filtersHtml();
}

function imgFail(img) {
  if (!(img instanceof HTMLImageElement) || !img.closest(".tkacc, .tka-mdl")) return;
  const alt = img.dataset.alt;
  if (alt && img.getAttribute("src") !== alt) {
    img.removeAttribute("data-alt");
    img.src = alt;
    return;
  }
  img.remove();
}

function goStudio(X, id, modal = false) {
  if (!(X.S.posts || []).some((p) => p.id === id)) return X.toast(`Stüdyo #${id} bulunamadı; silinmiş olabilir`, true);
  if (modal) X.closeModal();
  if (X.S.tab !== "posts") X.setTab("posts");
  if (X.S.sel !== id) X.select(id);
}

function wire(X, pane) {
  if (wired.has(pane)) return;
  wired.add(pane);
  pane.addEventListener("error", (e) => imgFail(e.target), true);
}

function bind(X, pane) {
  pane.onclick = async (e) => {
    const st = e.target.closest("[data-studio]");
    if (st) {
      e.preventDefault();
      return goStudio(X, st.dataset.studio);
    }
    const f = e.target.closest("[data-tf]");
    if (f) {
      Z.filter = f.dataset.tf;
      return redrawGrid(X, pane);
    }
    const o = e.target.closest("[data-open]");
    if (o) {
      const v = listOf().find((x) => x.id === o.dataset.open);
      if (v) openVideo(X, v);
      return;
    }
    const a = e.target.closest("[data-tka]");
    if (!a) return;
    const act = a.dataset.tka;
    if (act === "login") return X.openSettings("tiktok");
    if (act === "refresh" || act === "retry") {
      a.disabled = true;
      a.innerHTML = `${X.ic("loader-circle", 14, "spin")}${act === "refresh" ? "Yenileniyor…" : "Deneniyor…"}`;
      await renderTtAccount(X, pane, true);
    }
  };
}

function playerHtml(X, v) {
  const { ic, esc } = X;
  const file = v.studio && (X.S.posts || []).find((p) => p.id === v.studio.id)?.video;
  if (file) return `<video src="/media/${esc(v.studio.id)}/${encodeURIComponent(file)}" poster="${esc(v.cover || studioThumb(X, v) || "")}" controls autoplay playsinline></video>`;
  if (v.state === "public" && v.id)
    return `<iframe src="https://www.tiktok.com/player/v1/${encodeURIComponent(v.id)}?autoplay=1&music_info=1&description=0&rel=0" title="TikTok" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
  return `${pic(X, v, 40)}${v.url ? `<a class="tka-play" href="${esc(v.url)}" target="_blank" rel="noopener" title="TikTok'ta izle">${ic("play", 26)}</a>` : ""}`;
}

function openVideo(X, v) {
  const { ic, esc } = X;
  const at = v.at ? new Date(v.at) : null;
  const line = v.state === "scheduled" ? `Yayın: ${when(v.at)}` : at && !isNaN(at) ? at.toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const hint = v.state === "scheduled" ? `<div class="tka-hint">TikTok bu videoyu ${esc(when(v.at))} kendisi yayınlayacak; bilgisayarın açık olması gerekmez.</div>` : "";
  X.modal(`<div class="mdl tka-mdl">
    <div class="mdl-media tka-mm">${playerHtml(X, v)}</div>
    <div class="mdl-side">
      <div class="row"><span class="grow sm muted">${esc(line)}</span>${studioLink(X, v, "tka-st")}<button class="btn icon ghost" data-close>${ic("x")}</button></div>
      <div class="row wrap">${stateBadge(X, v, true)}${v.visibility ? `<span class="badge">${ic(VIS[v.visibility] || "lock", 11)}${esc(v.visibility)}</span>` : ""}${v.duration ? `<span class="badge">${dur(v.duration)}</span>` : ""}</div>
      ${hint}
      <div class="row wrap">${v.url ? `<a class="btn sm tka-go" href="${esc(v.url)}" target="_blank" rel="noopener">${ic("music", 14)}TikTok'ta izle</a>` : ""}<a class="btn sm" href="${CONTENT}" target="_blank" rel="noopener">${ic("external-link", 14)}TikTok Studio</a></div>
      <h4>${ic("list-checks", 13)}Etkileşimler</h4>
      <div class="kpis sm4 tka-kpis">${IX.map(([k, i, t]) => `<div class="kpi ${k}"><b>${ic(i, 15)}${nf(v[k])}</b><span>${t}</span></div>`).join("")}</div>
      <div class="sm muted">İzlenme süresi, kitle ve trafik kaynakları TikTok Studio'da.</div>
      ${v.desc ? `<h4>${ic("file-text", 13)}Açıklama</h4><div class="mcap">${esc(v.desc)}</div>` : ""}
    </div></div>`, (m) => {
    for (const img of m.querySelectorAll(".tka-mm img")) {
      img.loading = "eager";
      img.onerror = () => imgFail(img);
    }
    const s = $("[data-studio]", m);
    if (s)
      s.onclick = (e) => {
        e.preventDefault();
        goStudio(X, s.dataset.studio, true);
      };
  }, "wide");
}

export async function renderTtAccount(X, pane, fresh = false, opts = {}) {
  Z.after = opts.after || Z.after;
  wire(X, pane);
  bind(X, pane);
  if (!X.S.tiktok?.logged_in) {
    if (!Z.p) Object.assign(Z, { r: null, err: null, at: 0, failAt: 0 });
    drawOff(X, pane);
    return "off";
  }
  const have = !!Z.r?.ok;
  const due = fresh || !Z.r || (have ? Date.now() - Z.at > TTL : Date.now() - Z.failAt > RETRY);
  if (!due && !Z.p) {
    draw(X, pane);
    return have ? "ok" : "error";
  }
  const p = load(fresh);
  if (have) draw(X, pane);
  else pane.innerHTML = skeleton(X);
  Z.after?.();
  await p;
  if (!pane.isConnected) return "gone";
  if (!X.S.tiktok?.logged_in) drawOff(X, pane);
  else draw(X, pane);
  Z.after?.();
  return Z.r?.ok ? "ok" : "error";
}
