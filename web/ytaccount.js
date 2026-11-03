import { ago } from "/web/views.js";
import { engageHtml } from "/web/engage.js";
import { claudeSetupBtn } from "/web/claudesetup.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const nf = (v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR"));
const cf = (v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR", { notation: "compact", maximumFractionDigits: 1 }));
const p2 = (n) => String(n).padStart(2, "0");
const CLIENT_TTL = 60000;
const THUMB_UP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
const PRIV = { public: ["globe", "Herkese açık", "pub"], private: ["lock", "Gizli", "priv"], unlisted: ["link", "Liste dışı", "unl"], scheduled: ["calendar-clock", "Planlandı", "sch"] };
const FILTERS = [["all", "Tümü", () => true], ["studio", "Stüdyodan", (v) => !!v.studio], ["public", "Herkese açık", (v) => v.privacy === "public"], ["hidden", "Yayında değil", (v) => v.privacy !== "public"]];

const Z = { ch: null, chP: null, vids: null, vidsP: null, missing: false, filter: "all" };

const thumbUp = (size) => `<span class="icw">${THUMB_UP.replace("<svg", `<svg width="${size}" height="${size}" class="ic"`)}</span>`;

function dur(s) {
  if (s == null) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${p2(m)}:${p2(s % 60)}` : `${m}:${p2(s % 60)}`;
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
  return t.toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function dateText(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (isNaN(t)) return "";
  return Date.now() - t < 30 * 864e5 ? ago(iso) : t.toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
}

async function get(path, fresh) {
  try {
    const r = await fetch(`/api/yt/${path}${fresh ? (path.includes("?") ? "&" : "?") + "fresh=1" : ""}`, { cache: "no-store" });
    if (r.status === 404) {
      Z.missing = true;
      return { ok: false, missing: true, error: { code: "missing", message: "" } };
    }
    const d = await r.json().catch(() => null);
    if (!d || typeof d !== "object") throw new Error(`HTTP ${r.status}`);
    if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : `HTTP ${r.status}`);
    Z.missing = false;
    return d;
  } catch (e) {
    return { ok: false, error: { code: "error", message: /fetch/i.test(e.message) ? "Stüdyo sunucusuna ulaşılamadı" : e.message } };
  }
}

function load(key, path, fresh) {
  if (Z[key + "P"] && !fresh) return Z[key + "P"];
  const hit = Z[key];
  if (hit?.ok && !fresh && Date.now() - hit.at < CLIENT_TTL) return Promise.resolve(hit);
  const p = get(path, fresh)
    .then((r) => {
      r.at = Date.now();
      Z[key] = r;
      return r;
    })
    .finally(() => {
      if (Z[key + "P"] === p) Z[key + "P"] = null;
    });
  Z[key + "P"] = p;
  return p;
}

export const ytChannel = (fresh = false) => load("ch", "channel", fresh);
const ytVideos = (fresh = false) => load("vids", "videos", fresh);
export const ytMissing = () => Z.missing;

export function ytCardInfo(X) {
  const b = X.S.youtube || {};
  const c = Z.ch?.ok ? Z.ch.data : null;
  return {
    avatar: c?.avatar || null,
    name: c?.title || b.channel_title || "YouTube",
    stats: c ? [[c.subscribers, "abone", c.subscribers_hidden], [c.videos, "video"], [c.views, "görüntülenme"]] : [],
    warn: !!b.needs_reconnect || Z.ch?.error?.code === "reconnect" || Z.ch?.warning?.code === "reconnect",
    note: Z.missing ? "yeniden başlatınca açılır" : null,
    tip: Z.missing ? "YouTube kanal sayfası stüdyo yeniden başlatılınca açılacak" : null,
  };
}

function skeleton() {
  return `<div class="ytacc" aria-busy="true"><div class="ya-banner ya-sk"></div>
    <div class="ya-skh"><span class="ya-sk av"></span><div class="grow"><span class="ya-sk l1"></span><span class="ya-sk l2"></span><span class="ya-sk l3"></span></div></div>
    <div class="ya-bar"><span class="ya-sk" style="height:30px;width:280px"></span></div>
    <div class="ya-grid">${Array.from({ length: 6 }, () => `<div class="ya-v"><span class="ya-sk tile"></span><span class="ya-sk ln"></span></div>`).join("")}</div></div>`;
}

function drawOff(X, pane, b) {
  const { ic } = X;
  pane.innerHTML = `<div class="ytacc"><div class="ya-empty"><span class="ya-logo">${ic("youtube", 34)}</span>
    <h3>YouTube kanalı bağlı değil</h3>
    <p>Bağlayınca kanalının videolarını ve Shorts'larını görüntülenme, beğeni ve yorum sayılarıyla burada görürsün. Planladığın Reels'ler aynı saatte Shorts olarak da yayınlanabilir.</p>
    <div class="row" style="justify-content:center"><button class="btn yt" id="yaConnect">${ic("plug", 15)}${b.configured ? "Kanalı bağla" : "Ayarlar'dan bağla"}</button>${claudeSetupBtn("youtube")}</div></div></div>`;
  $("#yaConnect", pane).onclick = () => X.openSettings("youtube");
}

function drawMissing(X, pane) {
  const { ic } = X;
  pane.innerHTML = `<div class="ytacc"><div class="ya-empty calm"><span class="ya-logo">${ic("youtube", 34)}</span>
    <h3>YouTube kanal sayfası birazdan burada</h3>
    <p>Bu görünüm stüdyo yeniden başlatılınca açılacak. YouTube paylaşımların her zamanki gibi çalışmaya devam ediyor.</p>
    ${Z.go ? `<button class="btn" id="yaBack">${ic("instagram", 15)}Instagram'a dön</button>` : ""}</div></div>`;
  const back = $("#yaBack", pane);
  if (back) back.onclick = () => Z.go("instagram");
}

function errBox(X, err, title) {
  const { ic, esc } = X;
  const head = err.code === "reconnect" ? "YouTube bağlantısı yenilenmeli" : err.code === "quota" ? "YouTube günlük API kotası doldu" : title;
  return `<div class="fix ya-err">${ic(err.code === "quota" ? "hourglass" : "triangle-alert", 22)}<div><b>${head}</b><p class="sm">${esc(err.message || "")}</p>
    <div class="row"><button class="btn sm" data-ya="retry">${ic("refresh-cw", 14)}Tekrar dene</button>${err.code === "reconnect" ? `<button class="btn sm yt" data-ya="reconnect">${ic("plug", 14)}Yeniden bağlan</button>` : ""}</div></div></div>`;
}

function tile(X, v) {
  const { ic, esc } = X;
  const [pi, pt, pc] = PRIV[v.privacy] || PRIV.private;
  const hi = esc(v.thumb_hi || v.thumb || "");
  const lo = esc(v.thumb || v.thumb_hi || "");
  const pic = !v.thumb ? ic("youtube", 28) : v.short ? `<img src="${hi}" alt="" loading="lazy" decoding="async">` : `<img class="bg" src="${lo}" alt="" loading="lazy"><img class="fg" src="${hi}" alt="" loading="lazy" decoding="async">`;
  const meta = v.privacy === "scheduled" ? `${ic("calendar-clock", 12)}<span>${esc(when(v.publish_at))}</span>` : `<span>${esc(dateText(v.published_at))}</span>`;
  return `<div class="ya-v">
    <button class="ya-th ${v.short ? "" : "wide"} ${v.thumb ? "" : "noimg"}" data-open="${esc(v.id)}" title="${esc(v.title)}">${pic}
      <span class="ya-pv ${pc}">${ic(pi, 12)}${pt}</span>${v.duration ? `<span class="ya-dur">${dur(v.duration)}</span>` : ""}
      ${v.processing ? `<span class="ya-proc">${ic("loader-circle", 11, "spin")}İşleniyor</span>` : ""}
      <span class="ya-ov"><span title="Görüntülenme">${ic("eye", 13)}${cf(v.views)}</span><span title="Beğeni">${thumbUp(13)}${cf(v.likes)}</span><span title="Yorum">${ic("message-circle", 13)}${cf(v.comments)}</span></span>
    </button>
    <div class="ya-t" title="${esc(v.title)}">${esc(v.title || "Başlıksız video")}</div>
    <div class="ya-m">${meta}${v.studio ? `<a href="#${esc(v.studio.id)}" class="ya-st" title="${esc(v.studio.title || "")}">${ic("film", 11)}Stüdyo #${esc(v.studio.id)}</a>` : ""}</div>
  </div>`;
}

function gridHtml(X) {
  const { ic } = X;
  const r = Z.vids;
  if (!r) return "";
  if (!r.ok) return errBox(X, r.error, "Videolar alınamadı");
  const items = r.data.items || [];
  if (!items.length)
    return `<div class="ya-gridempty">${ic("clapperboard", 28)}<b>Kanalda henüz video yok</b><span class="sm">Planladığın Reels'ler YouTube'a yüklendikçe Shorts olarak burada görünecek.</span></div>`;
  const f = FILTERS.find((x) => x[0] === Z.filter) || FILTERS[0];
  const list = items.filter(f[2]);
  return (list.length ? `<div class="ya-grid">${list.map((v) => tile(X, v)).join("")}</div>` : `<div class="ya-gridempty sm">Bu filtrede video yok.</div>`) +
    (r.data.next ? `<div class="ya-more"><button class="btn" data-ya="more">${ic("chevron-down", 15)}Daha fazla video</button></div>` : "");
}

function filtersHtml() {
  const items = Z.vids?.ok ? Z.vids.data.items || [] : [];
  if (!items.length) return "";
  return `<div class="ya-filt">${FILTERS.map(([k, t, fn]) => {
    const n = items.filter(fn).length;
    return k !== "all" && !n ? "" : `<button data-yf="${k}" class="${Z.filter === k ? "active" : ""}">${t}<i>${n}</i></button>`;
  }).join("")}</div>`;
}

function notesHtml(X) {
  const { ic, esc } = X;
  const c = Z.ch;
  const out = [];
  const items = Z.vids?.ok ? Z.vids.data.items || [] : [];
  if (c.needs_reconnect || X.S.youtube?.needs_reconnect)
    out.push(`<div class="ya-note warn">${ic("unplug", 16)}<span class="grow">YouTube bağlantısı yenilenmeli. Yenileyene kadar yeni yüklemeler bekler.</span><button class="btn sm yt" data-ya="reconnect">${ic("plug", 13)}Yeniden bağlan</button></div>`);
  const warn = c.warning || Z.vids?.warning;
  if (warn && warn.code !== "reconnect")
    out.push(`<div class="ya-note warn">${ic("history", 16)}<span class="grow">Son alınan bilgiler gösteriliyor · ${esc(warn.message)}</span></div>`);
  if (c.audited === false && items.some((v) => v.studio && v.privacy_raw === "private" && v.privacy !== "scheduled"))
    out.push(`<div class="ya-note">${ic("shield-check", 16)}<span class="grow">Google, denetimden geçmemiş projelerle yüklenen videoları gizli tutabilir. Çoğu projede videolar yine de herkese açık yayınlanıyor; aşağıdaki listeden videolarının görünürlüğünü kontrol et.</span><button class="btn sm" data-ya="audit">Denetim</button></div>`);
  return out.join("");
}

function draw(X, pane) {
  const { ic, esc } = X;
  const ch = Z.ch;
  if (!ch?.ok) {
    pane.innerHTML = `<div class="ytacc">${errBox(X, ch?.error || { message: "" }, "YouTube'dan kanal bilgisi alınamadı")}</div>`;
    return bind(X, pane);
  }
  const c = ch.data;
  const cost = (ch.cost?.channel || 1) + (ch.cost?.videos || 2);
  const q = ch.quota;
  const tip = `YouTube'dan yeniden alır · ${cost} birim kota${q ? ` (bugün ${nf(q.used)} / ${nf(q.limit)} kullanıldı)` : ""}`;
  const banner = c.banner_wide || c.banner;
  const created = c.created_at ? new Date(c.created_at).toLocaleDateString("tr-TR", { month: "long", year: "numeric" }) : "";
  pane.innerHTML = `<div class="ytacc">
    <div class="ya-banner ${banner ? "" : "none"}">${banner ? `<img src="${esc(banner)}" alt="" data-raw="${esc(c.banner || "")}">` : ""}</div>
    <div class="ya-head">
      <span class="ya-av" style="${c.avatar ? `background-image:url('${esc(c.avatar)}')` : ""}">${c.avatar ? "" : esc((c.title || "?")[0].toUpperCase())}</span>
      <div class="grow">
        <div class="row wrap ya-titlerow"><h2>${esc(c.title)}</h2>
          <a class="btn sm yt" href="${esc(c.url)}" target="_blank" rel="noopener">${ic("youtube", 14)}Kanalı aç</a>
          <a class="btn sm" href="${esc(c.studio_url)}" target="_blank" rel="noopener">${ic("external-link", 14)}YouTube Studio</a>
          <button class="btn sm ghost" data-ya="refresh" title="${esc(tip)}">${ic("refresh-cw", 14)}Yenile</button></div>
        <div class="ya-handle">${c.handle ? `<span>${esc(c.handle)}</span>` : ""}${created ? `<span>${esc(created)} tarihinde katıldı</span>` : ""}</div>
        <div class="acc-stats ya-stats"><span><b>${c.subscribers_hidden ? "gizli" : nf(c.subscribers)}</b> abone</span><span><b>${nf(c.videos)}</b> video</span><span><b>${nf(c.views)}</b> görüntülenme</span></div>
        ${c.description ? `<div class="ya-desc" title="Tamamını göster">${esc(c.description)}</div>` : ""}
      </div>
    </div>
    ${c.totals ? engageHtml(X, { views: c.totals.views, likes: c.totals.likes, comments: c.totals.comments }, { count: c.totals.videos, cls: "yt", note: "YouTube paylaşım ve kaydetme sayılarını uygulamalarla paylaşmıyor." }) : ""}
    ${notesHtml(X)}
    <div class="ya-bar">${filtersHtml()}<span class="grow"></span>${ch.fetched_at ? `<span class="ya-upd" title="${esc(new Date(ch.fetched_at).toLocaleString("tr-TR"))}">Güncellendi ${esc(ago(ch.fetched_at))}</span>` : ""}</div>
    <div id="yaGrid">${gridHtml(X)}</div>
  </div>`;
  const img = $(".ya-banner img", pane);
  if (img)
    img.onerror = () => {
      const raw = img.dataset.raw;
      if (raw && img.getAttribute("src") !== raw) img.src = raw;
      else {
        img.parentElement.classList.add("none");
        img.remove();
      }
    };
  const desc = $(".ya-desc", pane);
  if (desc) desc.onclick = () => desc.classList.toggle("open");
  bind(X, pane);
}

function redrawGrid(X, pane) {
  const g = $("#yaGrid", pane);
  if (!g) return draw(X, pane);
  g.innerHTML = gridHtml(X);
  const bar = $(".ya-filt", pane);
  if (bar) bar.outerHTML = filtersHtml();
}

function bind(X, pane) {
  pane.onclick = async (e) => {
    const f = e.target.closest("[data-yf]");
    if (f) {
      Z.filter = f.dataset.yf;
      return redrawGrid(X, pane);
    }
    const o = e.target.closest("[data-open]");
    if (o) {
      const v = (Z.vids?.data?.items || []).find((x) => x.id === o.dataset.open);
      if (v) openVideo(X, v);
      return;
    }
    const a = e.target.closest("[data-ya]");
    if (!a) return;
    const act = a.dataset.ya;
    if (act === "reconnect") return X.openSettings("youtube");
    if (act === "audit") return X.openSettings("youtube-audit");
    if (act === "refresh" || act === "retry") {
      a.disabled = true;
      a.innerHTML = `${X.ic("loader-circle", 14, "spin")}${act === "refresh" ? "Yenileniyor…" : "Deneniyor…"}`;
      await renderYtAccount(X, pane, true, { go: Z.go, after: Z.after });
      return;
    }
    if (act === "more") {
      const next = Z.vids?.data?.next;
      if (!next) return;
      a.disabled = true;
      a.innerHTML = `${X.ic("loader-circle", 15, "spin")}Yükleniyor…`;
      const r = await get(`videos?page=${encodeURIComponent(next)}`);
      if (!r.ok) {
        X.toast(r.error?.message || "Videolar alınamadı", true);
        a.disabled = false;
        a.innerHTML = `${X.ic("chevron-down", 15)}Daha fazla video`;
        return;
      }
      const seen = new Set(Z.vids.data.items.map((v) => v.id));
      Z.vids.data.items.push(...r.data.items.filter((v) => !seen.has(v.id)));
      Z.vids.data.next = r.data.next;
      redrawGrid(X, pane);
    }
  };
}

function playerHtml(X, v) {
  const { ic, esc } = X;
  const poster = v.thumb_hi || v.thumb || "";
  const file = v.studio && (X.S.posts || []).find((p) => p.id === v.studio.id)?.video;
  if (file) return `<video src="/media/${esc(v.studio.id)}/${encodeURIComponent(file)}" poster="${esc(poster)}" controls autoplay playsinline></video>`;
  if (v.privacy === "public" || v.privacy === "unlisted")
    return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0&playsinline=1&modestbranding=1" title="${esc(v.title || "YouTube")}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  return `${poster ? `<img src="${esc(poster)}" alt="">` : ""}<a class="ya-play" href="${esc(v.url)}" target="_blank" rel="noopener" title="YouTube'da izle">${ic("play", 26)}</a>`;
}

function openVideo(X, v) {
  const { ic, esc } = X;
  const [pi, pt, pc] = PRIV[v.privacy] || PRIV.private;
  const at = v.privacy === "scheduled" ? v.publish_at : v.published_at;
  const line = v.privacy === "scheduled" ? `Yayın: ${when(at)}` : at ? new Date(at).toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const audited = Z.ch?.audited !== false;
  let hint = "";
  if (v.privacy === "scheduled") hint = `<div class="ya-hint sch">YouTube bu videoyu ${esc(when(v.publish_at))} herkese açacak; bilgisayar kapalı olsa da yayınlanır.${audited ? "" : " Denetimsiz projelerde gizli kalabilir; yayından sonra kontrol et."}</div>`;
  else if (v.privacy_raw === "private" && v.studio && !audited) hint = `<div class="ya-hint">Bu video gizli: Google, denetimden geçmemiş projelerin yüklediği videoları gizli tutabiliyor. YouTube Studio'dan elle herkese açık yapmayı dene; olmazsa denetim başvurusu gerekir.</div>`;
  X.modal(`<div class="mdl ya-mdl">
    <div class="mdl-media ya-mm ${v.short ? "" : "wide"}">${playerHtml(X, v)}</div>
    <div class="mdl-side">
      <div class="row"><span class="grow sm muted">${esc(line)}${v.studio ? ` · <a href="#${esc(v.studio.id)}" data-close>Stüdyo #${esc(v.studio.id)}</a>` : ""}</span><button class="btn icon ghost" data-close>${ic("x")}</button></div>
      <h3 class="ya-mt">${esc(v.title || "Başlıksız video")}</h3>
      <div class="row wrap"><span class="ya-pv inline ${pc}">${ic(pi, 12)}${pt}</span>${v.short ? `<span class="badge">Shorts</span>` : ""}${v.duration ? `<span class="badge">${dur(v.duration)}</span>` : ""}${v.processing ? `<span class="badge">${ic("loader-circle", 11, "spin")}İşleniyor</span>` : ""}</div>
      ${hint}
      <div class="row wrap"><a class="btn sm yt" href="${esc(v.url)}" target="_blank" rel="noopener">${ic("youtube", 14)}YouTube'da izle</a><a class="btn sm" href="${esc(v.studio_url)}" target="_blank" rel="noopener">${ic("pencil", 14)}Studio'da düzenle</a></div>
      <h4>${ic("list-checks", 13)}İstatistikler</h4>
      <div class="kpis sm4"><div class="kpi"><b>${nf(v.views)}</b><span>Görüntülenme</span></div><div class="kpi"><b>${nf(v.likes)}</b><span>Beğeni</span></div><div class="kpi"><b>${nf(v.comments)}</b><span>Yorum</span></div></div>
      <div class="sm muted">İzlenme süresi, kitle ve gelir ayrıntıları YouTube Studio'da.</div>
      ${v.description ? `<h4>${ic("file-text", 13)}Açıklama</h4><div class="mcap">${esc(v.description)}</div>` : ""}
    </div></div>`, null, "wide");
}

export async function renderYtAccount(X, pane, fresh = false, opts = {}) {
  Z.go = opts.go || Z.go;
  Z.after = opts.after || Z.after;
  const b = X.S.youtube || {};
  if (!b.connected) {
    Z.ch = Z.vids = null;
    drawOff(X, pane, b);
    return "off";
  }
  const have = Z.ch?.ok && Z.vids && !Z.vids.missing;
  if (have && !fresh) draw(X, pane);
  else if (!have) pane.innerHTML = skeleton();
  if (have && !fresh && Z.vids.ok && Date.now() - Z.ch.at < CLIENT_TTL && Date.now() - Z.vids.at < CLIENT_TTL) return "ok";
  const [ch] = await Promise.all([ytChannel(fresh), ytVideos(fresh)]);
  if (ch.missing) {
    drawMissing(X, pane);
    return "missing";
  }
  draw(X, pane);
  Z.after?.();
  return "ok";
}
