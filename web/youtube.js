import { claudeSetupBtn } from "/web/claudesetup.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const MB = 1048576;
const LINKS = {
  project: "https://console.cloud.google.com/projectcreate",
  api: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  auth: "https://console.cloud.google.com/auth/overview",
  audience: "https://console.cloud.google.com/auth/audience",
  branding: "https://console.cloud.google.com/auth/branding",
  clients: "https://console.cloud.google.com/auth/clients",
  dashboard: "https://console.cloud.google.com/home/dashboard",
  audit: "https://support.google.com/youtube/contact/yt_api_form",
  studio: "https://studio.youtube.com",
};
const AUDIT_PROMPT = [
  `Sosyal Stüdyo uygulamamın YouTube bağlantısı için "YouTube API Services Audit and Quota Extension Form" (${LINKS.audit}) başvurusunu yapmama adım adım yardım eder misin? Teknik biri değilim. Her seferinde tek bir bölüm anlat, ben "tamam" deyince sonrakine geç. Form İngilizce; her alana ne yazacağımı İngilizce olarak hazırla, ne anlama geldiğini Türkçe açıkla.`,
  ``,
  `Neden: Google, denetimden geçmemiş projelerle API üzerinden yüklenen videoları YouTube'da gizli (private) tutabiliyor. Denetimden geçince planlanan videoların herkese açık yayınlanması garanti altına alınıyor.`,
  ``,
  `Uygulama hakkında: Sosyal Stüdyo, kendi bilgisayarımda çalışan, yalnızca benim kullandığım bir masaüstü aracı. Kendi YouTube kanalıma, kendi ürettiğim kısa videoları (Shorts) planlanan saatte yükler. Kullanılan uç noktalar: videos.insert (yükleme, status.publishAt ile zamanlama), videos.update (saat/başlık güncelleme), videos.delete (iptal edilen ve henüz yayınlanmamış plan), videos.list (durum kontrolü), channels.list (kanal adı). Kimlik doğrulama: OAuth 2.0 (Desktop app istemcisi). Başka kullanıcı yok, para kazanılmıyor, reklam yok. Günde en fazla birkaç video.`,
  ``,
  `Formun bölümleri: 1) Request type, 2) Organization and contact information (bireysel başvuru: "As an individual user", "Independent Developer/Sole Proprietor"), 3) Business model (target audience: Internal Users / Individual Content Creators, monetization: Free service), 4) API client overview (ad "YouTube" kelimesi içermemeli; Primary Access URL, Privacy Policy URL, Terms of Service URL; publicly accessible: No), 5) Use cases (Google Cloud project number, "Video Uploading & Account Management", OAuth: yes, beklenen kullanım), zorunlu kanıtlar: gizlilik politikası ekran görüntüleri (YouTube bölümü, Google Gizlilik Politikası linki, veri silme), ana sayfanın ekran görüntüsü (gizlilik linki ve YouTube markası görünür), kullanım şartları; 6) ek belgeler (uygulamanın YouTube ekranlarının görüntüleri ya da kısa ekran kaydı), 7) onaylar ve gönderim.`,
  ``,
  `Gizlilik politikası sayfasında olması gerekenler: YouTube API Services kullanıldığının açıkça yazılması, YouTube Terms of Service (https://www.youtube.com/t/terms) ve Google Privacy Policy (https://policies.google.com/privacy) linkleri, hangi verinin neden kullanıldığı ve yalnızca bu bilgisayarda saklandığı, erişimin https://security.google.com/settings/security/permissions üzerinden nasıl geri alınacağı, verilerin nasıl silineceği ve iletişim e-postası.`,
  ``,
  `Çok önemli: Adres, ad-soyad gibi kişisel bilgileri ve dosya yüklemelerini forma ben kendim gireceğim. Google şifremi, Client secret'ımı ya da herhangi bir anahtarı benden isteme. Formu benim yerime gönderme; "Submit"e ben basacağım.`,
].join("\n");

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    t.style.cssText = "position:fixed;opacity:0";
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
}

async function copyAudit(X) {
  await copyText(AUDIT_PROMPT);
  X.toast("Denetim başvurusu yardım metni panoya kopyalandı; yeni bir Claude oturumuna yapıştır");
}

const AHEAD = [[168, "7 gün önce (önerilen)"], [72, "3 gün önce"], [36, "36 saat önce"], [24, "1 gün önce"]];
const CATS = [["22", "Kişiler ve Bloglar"], ["27", "Eğitim"], ["24", "Eğlence"], ["28", "Bilim ve Teknoloji"], ["26", "Nasıl Yapılır ve Stil"]];
const FINAL = new Set(["published", "private_locked"]);
const EV_IC = { error: ["triangle-alert", "bad"], warn: ["triangle-alert", "warn"], published: ["circle-check", "ok"], ok: ["circle-check", "ok"], upload: ["upload", "blue"], uploaded: ["youtube", "blue"], scheduled: ["youtube", "blue"], connect: ["plug", "blue"], sync: ["refresh-cw", ""], delete: ["trash-2", ""], cancel: ["circle-x", ""], info: ["info", ""], quota: ["hourglass", "warn"] };
const WAIT_MS = 15 * 60 * 1000;

const Y = { data: null, err: null, missing: false, loading: null, chipSig: null, wired: false, draft: null, refocus: null, wait: null, waitTimer: null, redraw: null, kit: null, kitMissing: false, kitLoading: null, kitStep: 0, kitTimer: null, siteTimer: null };

const p2 = (n) => String(n).padStart(2, "0");
const fx = (n, max = 1) => Number(n || 0).toLocaleString("tr-TR", { maximumFractionDigits: max });
const hm = (t) => `${p2(t.getHours())}:${p2(t.getMinutes())}`;
const bytes = (s) => new TextEncoder().encode(s || "").length;

function when(iso) {
  if (!iso) return "";
  const t = new Date(iso);
  if (isNaN(t)) return "";
  const d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - d0) / 864e5);
  if (days === 0) return `bugün ${hm(t)}`;
  if (days === 1) return `yarın ${hm(t)}`;
  if (days === -1) return `dün ${hm(t)}`;
  return t.toLocaleString("tr-TR", { day: "numeric", month: "long", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function dur(s) {
  s = Math.max(1, Math.round(+s || 0));
  if (s < 60) return `${s} sn`;
  if (s < 3600) return `${Math.round(s / 60)} dk`;
  return `${Math.floor(s / 3600)} sa ${Math.round((s % 3600) / 60)} dk`;
}

function load() {
  if (!Y.loading)
    Y.loading = fetch("/api/youtube", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) {
          Y.missing = true;
          Y.data = null;
          Y.err = null;
          return;
        }
        const d = await r.json().catch(() => null);
        if (!r.ok || !d) throw new Error(d?.error || `HTTP ${r.status}`);
        Y.missing = false;
        Y.data = d;
        Y.err = null;
      })
      .catch((e) => {
        Y.err = e.message;
      })
      .finally(() => {
        Y.loading = null;
      });
  return Y.loading;
}

function loadKit() {
  if (!Y.kitLoading)
    Y.kitLoading = fetch("/api/youtube/audit-kit", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) {
          Y.kitMissing = true;
          Y.kit = null;
          return;
        }
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || typeof d !== "object") throw new Error(d?.error || `HTTP ${r.status}`);
        Y.kitMissing = false;
        Y.kit = d;
      })
      .catch(() => {
        if (!Y.kit) Y.kitMissing = true;
      })
      .finally(() => {
        Y.kitLoading = null;
      });
  return Y.kitLoading;
}

function wire(X) {
  if (Y.wired) return;
  Y.wired = true;
  const chip = $("#ytChip");
  if (chip) chip.onclick = () => X.openSettings("youtube");
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-yt]");
    if (!b) return;
    e.preventDefault();
    const a = b.dataset.yt;
    const pid = b.dataset.pid;
    if (a === "settings") return X.openSettings("youtube");
    if (a === "audit") return X.openSettings("youtube-audit");
    if (a === "manual") return manualDialog(X, pid);
    if (a === "unmanual")
      return X.confirm("Elle paylaşım işareti kaldırılsın mı?", "YouTube'daki videona dokunulmaz. Planlıysa stüdyo bu içeriği yeniden YouTube'a yüklemeye çalışır; videoyu kendin yüklediysen iki kopya olabilir.", "İşareti kaldır", X.guard(async () => {
        const det = await X.api(`/api/posts/${pid}/youtube/unmanual`, {});
        if (X.S.detail?.id === pid) X.S.detail = det;
        X.toast("Elle paylaşım işareti kaldırıldı");
        await X.refresh();
      }));
    X.guard(async () => {
      b.disabled = true;
      try {
        if (a === "retry") {
          await X.api(`/api/posts/${pid}/youtube/retry`, {});
          X.toast("YouTube yüklemesi yeniden denenecek");
        } else if (a === "now") {
          await X.api(`/api/posts/${pid}/youtube/upload-now`, {});
          X.toast("YouTube'a yükleme başlıyor");
        }
        await X.refresh();
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    })();
  });
}

// ---------- marks ----------

export function ytState(S, p) {
  const y = p?.youtube;
  if (!y || !S?.youtube?.connected) return null;
  const st = y.state;
  if (y.manual && (st === "scheduled" || st === "published"))
    return st === "scheduled" && Date.parse(y.at || "") > Date.now() ? { cls: "sch", label: `YouTube'da elle planlandı · ${when(y.at)}` } : { cls: "ok", label: "YouTube'da elle paylaşıldı" };
  if (st === "deleted" && y.code === "missing" && y.enabled !== false) return { cls: "bad", label: "Video YouTube'da bulunamadı" };
  if (!st || st === "deleted") return null;
  if (y.enabled === false && !FINAL.has(st)) return null;
  if (st === "queued") return y.code === "quota" ? { cls: "wait", label: y.note || y.error || "YouTube kotası doldu · kota yenilenince yüklenecek" } : { cls: "q", label: y.note || "YouTube Shorts · yüklenmek için sırada" };
  if (st === "uploading") {
    const pct = y.progress?.pct;
    return { cls: "up", label: `YouTube'a yükleniyor${pct != null ? ` · %${Math.round(pct)}` : ""}` };
  }
  if (st === "scheduled") return { cls: "sch", label: `YouTube'da planlandı${y.at ? ` · ${when(y.at)}` : ""} · ${S.youtube.audited ? "bilgisayar kapalıyken de yayınlanır" : "denetimsiz projelerde gizli kalabilir"}` };
  if (st === "published") return { cls: "ok", label: "YouTube Shorts'ta yayında" };
  if (st === "private_locked") return { cls: "lock", label: "YouTube'da gizli kaldı · denetim gerekli" };
  if (st === "error") return { cls: "bad", label: `YouTube hatası${y.error ? `: ${y.error}` : ""}` };
  return null;
}

export function ytMark(X, p, size = 12) {
  const s = ytState(X.S, p);
  return s ? `<span class="ytmark ${s.cls}" title="${X.esc(s.label)}">${X.ic("youtube", size)}</span>` : "";
}

// ---------- top-bar chip ----------

export function renderYtChip(X, b) {
  X.S.youtube = b || null;
  Y.polled = true;
  wire(X);
  patchCards(X);
  const el = $("#ytChip");
  if (!el) return;
  const sig = JSON.stringify(b || null);
  if (Y.chipSig === sig) return;
  Y.chipSig = sig;
  if (!b) {
    el.className = "chip yt-chip hidden";
    el.innerHTML = "";
    return;
  }
  let cls = "";
  let tail = "";
  let title = b.configured ? "YouTube kanalı bağlı değil · bağlamak için tıkla" : "YouTube bağlı değil · Shorts paylaşımı için tıkla";
  if (b.connected) {
    const left = b.uploads_left;
    const ch = b.channel_title ? `YouTube · ${b.channel_title}` : "YouTube bağlı";
    const quota = left != null ? (left > 0 ? `bugün ${left} video daha yüklenebilir` : "bugünkü kota doldu, kalanlar yarın yüklenir") : "";
    if (b.needs_reconnect) {
      cls = "warn";
      title = `${ch} · bağlantı yenilenmeli, yüklemeler bekliyor`;
    } else if (b.errors) {
      cls = "bad";
      title = `${ch} · ${b.errors} videoda hata`;
    } else {
      cls = left === 0 ? "warn" : "ok";
      title = [ch, quota].filter(Boolean).join(" · ");
    }
    if (b.uploading) {
      cls += " up";
      tail = `<b class="yc-n" title="Yükleniyor">${b.uploading}</b>`;
      title = `${b.uploading} video YouTube'a yükleniyor · ${title}`;
    }
    if (b.errors) tail += `<b class="yc-n bad" title="Hata">${b.errors}</b>`;
    if (!b.audited) title += "\nDenetim yok: çoğu projede videolar yine yayınlanır, ama gizli kalabilir";
  }
  el.className = `chip yt-chip ${cls}`;
  el.innerHTML = `${X.ic("youtube", 15)}${tail}${b.connected ? `<span class="dot"></span>` : ""}`;
  el.title = title;
}

// ---------- publish pane card ----------

function viewOf(X, d) {
  const raw = d?.youtube && typeof d.youtube === "object" ? d.youtube : {};
  const sum = (X.S.posts || []).find((p) => p.id === d.id)?.youtube;
  const v = { ...raw, ...(sum || {}) };
  if (v.enabled == null) v.enabled = raw.enabled ?? Y.data?.auto ?? true;
  if (!v.video_id) v.video_id = raw.video_id || null;
  return v;
}

function rawText(d, key, def) {
  const y = d?.youtube && typeof d.youtube === "object" ? d.youtube : {};
  const v = y[key];
  if (!v) return "";
  if (!("default_title" in y) && !("description" in y) && key === "title" && v === def) return "";
  return v;
}

function defTitle(d) {
  return d?.youtube?.default_title || String(d?.title || "").replace(/[<>]/g, "").slice(0, 100);
}

function defDesc(d) {
  if (d?.youtube?.default_description) return d.youtube.default_description;
  const cap = String(d?.caption_full || "").trim();
  return /#shorts\b/i.test(cap) ? cap : `${cap}${cap ? "\n\n" : ""}#Shorts`;
}

function progText(pr) {
  if (!pr) return "";
  const pct = Math.max(0, Math.min(100, +pr.pct || 0));
  return `%${fx(pct, 0)}${pr.total ? ` · ${fx((pr.sent || 0) / MB, 1)} / ${fx(pr.total / MB, 1)} MB` : ""}${pr.eta != null && pct < 100 ? ` · ~${dur(pr.eta)}` : ""}`;
}

function statusHtml(X, d, v, b) {
  const { ic, esc } = X;
  const line = (cls, icon, title, sub = "", act = "", spin = false, below = false) =>
    `<div class="ytc-line ${cls}"><span class="ytc-ic">${ic(icon, 15, spin ? "spin" : "")}</span><div class="grow"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}${act && below ? `<div class="ytc-act below">${act}</div>` : ""}</div>${act && !below ? `<div class="ytc-act">${act}</div>` : ""}</div>`;
  const btn = (a, label, icon, cls = "") => `<button type="button" class="btn sm ${cls}" data-yt="${a}" data-pid="${esc(d.id)}">${ic(icon, 13)}${label}</button>`;
  const link = (href, label, icon = "external-link") => `<a class="btn sm" href="${esc(href)}" target="_blank" rel="noopener">${ic(icon, 13)}${label}</a>`;
  const st = v.state;
  const studio = v.video_id ? `${LINKS.studio}/video/${encodeURIComponent(v.video_id)}/edit` : "";
  if (v.manual && (st === "published" || st === "scheduled")) {
    const acts = `${v.url ? link(v.url, "Shorts'u aç", "youtube") : ""}${btn("unmanual", "İşareti kaldır", "rotate-ccw", "ghost")}`;
    const later = st === "scheduled" && Date.parse(v.at || "") > Date.now();
    return later
      ? line("sch", "youtube", `YouTube'da elle planlandı · ${esc(when(v.at))}`, "Kendin yükledin; stüdyo bu videoya dokunmaz, yalnızca yayına girip girmediğini takip eder.", acts)
      : line("ok", "circle-check", "YouTube'da elle paylaşıldı", v.video_id ? "Kendin yükledin; stüdyo bu videoya dokunmaz." : "Kendin yükledin; stüdyo bu içeriği YouTube'a yüklemeyecek.", acts);
  }
  if (st === "published") return line("ok", "circle-check", "YouTube'da yayında", v.at ? esc(when(v.at)) : "", v.url ? link(v.url, "Shorts'u aç", "youtube") : "");
  if (st === "private_locked")
    return line("lock", "lock", "Gizli kaldı — denetim gerekli", "Google bu projeyle yüklenen videoları gizli tutuyor; denetim başvurusu gerekiyor (Ayarlar → YouTube → Denetim kiti). Bu sırada YouTube Studio'da görünürlüğü elle <b>Herkese açık</b> yapmayı deneyebilirsin.", `${studio ? link(studio, "Studio'da aç") : ""}${btn("audit", "Denetim nedir?", "info", "ghost")}`, false, true);
  if (b.needs_reconnect) return line("warn", "plug", "Google bağlantısı yenilenmeli", "Yeniden bağlanana kadar YouTube yüklemeleri bekler.", btn("settings", "Yeniden bağlan", "refresh-cw"));
  if (v.enabled === false) return line("off", "eye-off", "YouTube'a yüklenmeyecek", "Açarsan aynı saatte Shorts olarak da paylaşılır.");
  if (st === "uploading")
    return `<div class="ytc-line up" data-ytup="${esc(d.id)}"><span class="ytc-ic">${ic("upload", 15)}</span><div class="grow"><b>YouTube'a yükleniyor <span class="ytc-p">${progText(v.progress)}</span></b><div class="ytc-bar"><i style="width:${Math.max(0, Math.min(100, +v.progress?.pct || 0))}%"></i></div><span>${d.status === "planlandi" ? "Yükleme bitince saatinde YouTube kendisi yayınlar." : "Yükleme bitince hemen yayınlanır."}</span></div></div>`;
  const studioBtn = studio ? link(studio, "Studio'da aç") : "";
  if (st === "scheduled" && /ayarlanıyor/i.test(v.note || "")) return line("sch", "youtube", "YouTube'a yüklendi", "Yayın saati ayarlanıyor…", studioBtn);
  if (st === "scheduled" && /yayına giriyor/i.test(v.note || "")) return line("sch", "youtube", "YouTube'da yayına giriyor", "Durum birkaç dakika içinde güncellenir.", studioBtn);
  if (st === "scheduled")
    return line("sch", "youtube", `YouTube'da planlandı · ${esc(when(v.at || d.schedule))}`, b.audited === false ? "Saati gelince YouTube yayınlar. Projen denetimden geçmediyse, yayından sonra videonun herkese açık olduğunu kontrol et." : "Saati gelince YouTube kendisi yayınlar; bilgisayarın kapalı olabilir.", studioBtn);
  if (st === "error") return line("bad", "triangle-alert", "YouTube'a yüklenemedi", esc(v.error || "Bilinmeyen hata"), btn("retry", "Tekrar dene", "refresh-cw"));
  if (st === "deleted" && v.code === "missing") return line("warn", "triangle-alert", "Video YouTube'da bulunamadı", esc(v.error || "YouTube Studio'dan silinmiş olabilir."), btn("retry", "Yeniden yükle", "upload"));
  if (st === "queued" && v.code === "quota") {
    const r = Y.data?.quota?.resets_at;
    const msg = String(v.note || v.error || "").replace(/^kota doldu[\s,.:;—–-]*/i, "");
    return line("wait", "hourglass", "Kota doldu", esc(msg ? msg[0].toLocaleUpperCase("tr-TR") + msg.slice(1) : `Günlük YouTube kotası ${r ? `${when(r)} yenilenince` : "yenilenince"} yüklenecek.`));
  }
  if (st === "queued" && v.code === "reconnect") return line("warn", "plug", "Bağlantı bekleniyor", "YouTube bağlantısı yenilenince yüklenecek.", btn("settings", "Ayarlar", "settings"));
  if (st === "queued") {
    const ahead = +(Y.data?.upload_ahead_hours ?? 36);
    const t = Date.parse(d.schedule || "");
    const later = t && t - Date.now() > ahead * 3600e3;
    const sub = v.code === "wait" && v.note ? `${v.note}.` : later ? `Paylaşım saatine ${ahead} saat kala YouTube'a yüklenecek.` : "Birazdan YouTube'a yüklenecek.";
    return line("q", "hourglass", "Sırada", esc(sub), btn("now", "Şimdi yükle", "upload"));
  }
  if (d.status === "planlandi") return line("q", "loader-circle", "YouTube için sıraya alınıyor…", "", "", true);
  if (d.targets?.instagram === false) return line("idle", "calendar-clock", "Planlayınca YouTube'a yüklenir", "Seçtiğin saatte YouTube Shorts olarak yayınlanır.");
  return line("idle", "calendar-clock", "Planlayınca YouTube'a da yüklenir", "Instagram için seçtiğin saatte Shorts olarak da yayınlanır.");
}

function stSig(v, b) {
  return JSON.stringify([v.state, v.code, v.error, v.note, v.url, v.at, v.enabled, v.video_id, v.manual, !!b?.needs_reconnect, b?.audited]);
}

function shapeSig(X, d) {
  const b = X.S.youtube;
  if (!b) return "none";
  if (!b.connected) return "off";
  const v = viewOf(X, d);
  const published = d.status === "paylasildi";
  return JSON.stringify([b.channel_title, v.enabled, published, FINAL.has(v.state), published && (!v.state || v.state === "deleted"), !!v.manual, canManual(v, published)]);
}

function patchCards(X) {
  const b = X.S.youtube;
  for (const w of $$(".ytw[data-ytw]")) {
    const pid = w.getAttribute("data-ytw");
    const d = X.S.detail?.id === pid ? X.S.detail : null;
    if (!d) continue;
    const shape = shapeSig(X, d);
    if (w.getAttribute("data-shape") !== shape) {
      w.setAttribute("data-shape", shape);
      w.innerHTML = cardInner(X, d);
      bindYtCard(X, d);
      continue;
    }
    const el = $(".ytc[data-ytc]", w);
    if (!el || !b?.connected) continue;
    const v = viewOf(X, d);
    const sig = stSig(v, b);
    const box = $("[data-ytst]", el);
    if (box && el.getAttribute("data-sig") !== sig) {
      el.setAttribute("data-sig", sig);
      box.innerHTML = statusHtml(X, d, v, b);
      continue;
    }
    const up = $("[data-ytup]", el);
    if (!up || !v.progress) continue;
    const bar = $(".ytc-bar i", up);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, +v.progress.pct || 0))}%`;
    const t = $(".ytc-p", up);
    if (t) t.textContent = progText(v.progress);
  }
}

export function ytCardHtml(X, d) {
  wire(X);
  if (!d || (d.kind || "reels") !== "reels") return "";
  return `<div class="ytw" data-ytw="${X.esc(d.id)}" data-shape="${X.esc(shapeSig(X, d))}">${cardInner(X, d)}</div>`;
}

function cardInner(X, d) {
  const { S, ic, esc } = X;
  const b = S.youtube;
  if (!b) return "";
  const published = d.status === "paylasildi";
  if (!b.connected) return published ? "" : `<div class="ytc-hint">${ic("youtube", 15)}<span>Aynı videoyu YouTube Shorts'a da paylaşmak için kanalını <a href="#" data-yt="settings">Ayarlar</a>'dan bağla.</span></div>`;
  const v = viewOf(X, d);
  const st = v.state;
  if (published && (!st || st === "deleted")) return "";
  if (!Y.data && !Y.loading) load();
  const fe = document.activeElement;
  Y.refocus = fe && /^yt(Title|Desc)$/.test(fe.id) && fe.closest(`.ytc[data-ytc="${d.id}"]`) ? { id: fe.id, s: fe.selectionStart, e: fe.selectionEnd } : null;
  if (Y.draft && Y.draft.pid !== d.id) Y.draft = null;
  const canEdit = !published && !FINAL.has(st) && !v.manual;
  const canToggle = canEdit && !S.settings?.default_targets;
  const editable = canEdit && v.enabled !== false;
  const dt = defTitle(d);
  const rt = rawText(d, "title", dt);
  const rd = rawText(d, "description", "");
  const dr = Y.draft;
  const title = dr ? dr.title : rt;
  const desc = dr ? dr.desc : rd;
  const open = dr ? dr.open : !!rd;
  const live = st === "scheduled" || st === "uploading";
  const edOpen = !!dr || Y.edOpen === d.id || !!Y.refocus;
  return `<div class="ytc ${v.enabled === false && !FINAL.has(st) ? "off" : ""}" data-ytc="${esc(d.id)}" data-sig="${esc(stSig(v, b))}">
    <div class="ytc-head"><span class="ytc-logo">${ic("youtube", 17)}</span><div class="grow"><b>YouTube Shorts</b><span>${esc(b.channel_title || "YouTube kanalı")}</span></div>
      ${canToggle ? `<label class="switch" title="${v.enabled ? "Bu videoyu YouTube'a yükleme" : "Bu videoyu YouTube Shorts olarak da paylaş"}"><input type="checkbox" id="ytOn" ${v.enabled ? "checked" : ""}><span></span></label>` : ""}</div>
    <div class="ytc-st" data-ytst>${statusHtml(X, d, v, b)}</div>
    ${editable ? `<details class="ytc-edw" ${edOpen ? "open" : ""}><summary>${ic("pencil", 13)}YouTube başlığı ve açıklaması <span class="sm muted">· ${rt || rd ? "özel" : "içerikten otomatik"}</span></summary><div class="ytc-ed">
      <div class="ytc-l"><label for="ytTitle">Başlık</label><span class="counter" id="ytTCount"></span></div>
      <input id="ytTitle" maxlength="100" autocomplete="off" placeholder="${esc(dt)}" value="${esc(title)}" data-orig="${esc(rt)}">
      <details class="ytc-desc" ${open ? "open" : ""}><summary>Açıklama <span class="sm muted">${rd ? "· özel açıklama" : "· Instagram açıklaması + #Shorts"}</span></summary>
        <textarea id="ytDesc" rows="4" placeholder="${esc(defDesc(d))}" data-orig="${esc(rd)}">${esc(desc)}</textarea>
        <div class="ytc-l"><span class="sm muted">Boş bırakırsan Instagram açıklaması kullanılır.</span><span class="counter" id="ytDCount"></span></div>
      </details>
      <div class="ytc-foot"><span class="sm muted grow" id="ytHint">${live ? "Kaydedince YouTube'daki video da güncellenir." : "Başlık boşsa içerik başlığı kullanılır."}</span><button type="button" class="btn sm primary" id="ytSave" disabled>${ic("check", 13)}Kaydet</button></div>
    </div></details>` : ""}
    ${canManual(v, published) ? `<div class="ytc-man"><span class="sm muted grow">Bu videoyu YouTube'a kendin yüklediysen işaretle.</span><button type="button" class="btn sm" data-yt="manual" data-pid="${esc(d.id)}">${ic("youtube", 13)}YouTube'a elle yükledim</button></div>` : ""}
  </div>`;
}

function canManual(v, published) {
  return !published && !v.manual && !v.video_id && v.enabled !== false && v.state !== "uploading";
}

function manualDialog(X, pid) {
  const { ic } = X;
  X.modal(`<h2>${ic("youtube", 20)}YouTube'da elle paylaşıldı</h2><div>Videoyu YouTube'a kendin yüklediysen işaretle; stüdyo bu içeriği YouTube'a bir daha yüklemez. Linki eklersen stüdyo videonun yayına girip girmediğini de takip eder.</div><label>YouTube linki (isteğe bağlı)</label><input id="ytmLink" placeholder="https://youtube.com/shorts/…" autocomplete="off"><div class="foot"><button class="btn" data-close>Vazgeç</button><button class="btn primary" id="ytmOk">${ic("check", 14)}İşaretle</button></div>`, (m) => {
    const inp = $("#ytmLink", m);
    const ok = $("#ytmOk", m);
    inp.onkeydown = (e) => {
      if (e.key === "Enter") ok.click();
    };
    ok.onclick = X.guard(async () => {
      ok.disabled = true;
      try {
        const det = await X.api(`/api/posts/${pid}/youtube/manual`, { link: inp.value.trim() });
        if (X.S.detail?.id === pid) X.S.detail = det;
        X.closeModal();
        X.toast("YouTube'da elle paylaşıldı olarak işaretlendi");
        await X.refresh();
      } finally {
        if (ok.isConnected) ok.disabled = false;
      }
    });
    setTimeout(() => inp.focus(), 30);
  });
}

export function bindYtCard(X, d) {
  const card = d && $(`.ytc[data-ytc="${d.id}"]`);
  if (!card) return;
  const on = $("#ytOn", card);
  const v = viewOf(X, d);
  if (on)
    on.onchange = () => {
      const want = on.checked;
      const send = X.guard(async () => {
        on.disabled = true;
        try {
          await X.api(`/api/posts/${d.id}/youtube`, { enabled: want });
          Y.draft = null;
          X.toast(want ? "Bu video YouTube Shorts olarak da paylaşılacak" : "Bu video YouTube'a yüklenmeyecek");
          await X.refresh();
        } finally {
          if (on.isConnected) on.disabled = false;
        }
      });
      if (!want && (v.state === "scheduled" || v.state === "uploading")) {
        on.checked = true;
        X.confirm("YouTube'daki video silinsin mi?", `Bu video ${v.state === "uploading" ? "şu an YouTube'a yükleniyor" : `YouTube'a yüklendi ve <b>${X.esc(when(v.at || d.schedule))}</b> için planlı`}. Kapatırsan YouTube'dan silinir; Instagram planı değişmez.`, "Kapat ve sil", send);
        return;
      }
      send();
    };
  const t = $("#ytTitle", card);
  const ds = $("#ytDesc", card);
  const save = $("#ytSave", card);
  if (!t || !ds || !save) return;
  const edw = $(".ytc-edw", card);
  if (edw) edw.ontoggle = () => (Y.edOpen = edw.open ? d.id : Y.edOpen === d.id ? null : Y.edOpen);
  const det = $(".ytc-desc", card);
  const upd = () => {
    const n = t.value.length;
    const tc = $("#ytTCount", card);
    tc.textContent = `${n} / 100`;
    tc.className = "counter" + (n > 100 ? " over" : "");
    const db = bytes(ds.value);
    const dc = $("#ytDCount", card);
    dc.textContent = ds.value ? `${fx(db, 0)} / 5.000 bayt` : "";
    dc.className = "counter" + (db > 5000 ? " over" : "");
    const dirty = t.value !== t.dataset.orig || ds.value !== ds.dataset.orig;
    save.disabled = !dirty || db > 5000;
    Y.draft = dirty ? { pid: d.id, title: t.value, desc: ds.value, open: det.open } : null;
    const bad = /[<>]/.test(t.value + ds.value);
    const hint = $("#ytHint", card);
    hint.classList.toggle("warn", bad);
    hint.textContent = bad ? "< ve > işaretleri YouTube'da kaldırılır." : v.state === "scheduled" || v.state === "uploading" ? "Kaydedince YouTube'daki video da güncellenir." : "Başlık boşsa içerik başlığı kullanılır.";
  };
  t.oninput = ds.oninput = upd;
  det.ontoggle = () => {
    if (Y.draft) Y.draft.open = det.open;
  };
  t.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!save.disabled) save.click();
    }
  };
  save.onclick = X.guard(async () => {
    save.disabled = true;
    try {
      await X.api(`/api/posts/${d.id}/youtube`, { title: t.value.trim(), description: ds.value.trim() });
      t.dataset.orig = t.value;
      ds.dataset.orig = ds.value;
      Y.draft = null;
      X.toast(v.state === "scheduled" ? "Kaydedildi; YouTube'daki video da güncellenecek" : "YouTube bilgileri kaydedildi");
      await X.refresh();
    } finally {
      if (save.isConnected) upd();
    }
  });
  upd();
  const rf = Y.refocus;
  Y.refocus = null;
  const fe = rf && $("#" + rf.id, card);
  if (fe) {
    fe.focus();
    try {
      fe.setSelectionRange(rf.s, rf.e);
    } catch {}
  }
}

// ---------- settings ----------

function guideHtml(X) {
  const { ic } = X;
  const a = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  const u = (t) => `<b class="yt-ui">${t}</b>`;
  return `<ol class="yts-steps">
    <li><div><b>Proje oluştur.</b> ${a(LINKS.project, "Google Cloud Console")}'u YouTube kanalının bağlı olduğu Google hesabıyla aç. ${u("Project name")} alanına bir ad yaz (ör. Sosyal Stüdyo) → ${u("Create")}. Kart ya da ödeme istemez.</div></li>
    <li><div><b>YouTube API'yi aç.</b> ${a(LINKS.api, "YouTube Data API v3")} sayfasında üstte yeni projenin seçili olduğunu kontrol et → ${u("Enable")}.</div></li>
    <li><div><b>İzin ekranını kur.</b> ${a(LINKS.auth, "Google Auth Platform")} → ${u("Get started")}:
      <ul class="yts-sl"><li>${u("App name")}: bir ad (ör. Sosyal Stüdyo), ${u("User support email")}: e-postan → ${u("Next")}</li>
        <li>${u("Audience")}: ${u("External")} → ${u("Next")}</li>
        <li>${u("Contact information")}: e-postan → ${u("Next")}</li>
        <li>Kutuyu işaretle → ${u("Continue")} → ${u("Create")}</li></ul></div></li>
    <li><div><b>Kanal hesabını ekle.</b> ${a(LINKS.audience, "Audience")} sayfasında ${u("Test users")} → ${u("Add users")} → YouTube kanalının bağlı olduğu Google hesabının e-postası → ${u("Save")}.
      <div class="yts-why">${ic("info", 13)}<span><b>Bilmen gereken:</b> Proje "Testing" durumundayken Google bağlantıyı 7 günde bir yeniler; stüdyo o zaman "Yeniden bağlan" der, tek tıkla düzelir. Kalıcı bağlantı için ${u("Branding")} sayfasında ana sayfa ve gizlilik politikası linklerini doldurup ${u("Publish app")} ile <b>In production</b> yapmak gerekir.</span></div></div></li>
    <li><div><b>Anahtar oluştur.</b> ${a(LINKS.clients, "Clients")} → ${u("Create client")} → ${u("Application type")}: ${u("Desktop app")} → bir ad yaz → ${u("Create")}.</div></li>
    <li><div><b>Kopyala, yapıştır.</b> Açılan penceredeki ${u("Client ID")} ve ${u("Client secret")} değerlerini aşağıya yapıştır → <b>Kaydet</b>. Gizli anahtar sonradan tam görünmeyebilir; kaybedersen istemcinin sayfasında ${u("Add secret")} ile yenisini oluştur.</div></li>
  </ol>`;
}

function claudeRow(X) {
  return `<div class="yts-claude">${claudeSetupBtn("youtube")}<span class="sm muted">Claude seni adım adım yönlendirsin: hazır bir kurulum metni açılır, kopyalayıp Claude'a gönderirsin.</span></div>`;
}

function warnHtml() {
  const u = (t) => `<b class="yt-ui">${t}</b>`;
  return `<ol class="yts-steps sm">
    <li><div>YouTube kanalının bağlı olduğu <b>Google hesabını</b> seç.</div></li>
    <li><div><b>"Google hasn't verified this app"</b> (Google bu uygulamayı doğrulamadı) uyarısı çıkar. Uygulama senin kendi projen olduğu için bu normaldir: ${u("Advanced")} (Gelişmiş) → ${u("Go to … (unsafe)")} (… sitesine git) bağlantısına bas.</div></li>
    <li><div>Birden fazla kanalın varsa paylaşım yapılacak <b>kanalı</b> seç, izin ekranında ${u("Continue")} (Devam) de.</div></li>
    <li><div><b>"YouTube bağlandı"</b> yazısını görünce o sekmeyi kapat; stüdyo kendiliğinden algılar.</div></li>
  </ol>`;
}

function clientForm(X, edit) {
  const { ic } = X;
  return `<div class="yts-form">
    <label for="sYtId">Client ID</label><input id="sYtId" autocomplete="off" spellcheck="false" placeholder="1234567890-abc….apps.googleusercontent.com">
    <label for="sYtSecret">Client secret</label><input id="sYtSecret" type="password" autocomplete="off" spellcheck="false" placeholder="${edit ? "Yenisini yapıştır" : "GOCSPX-…"}">
    <div class="yts-ferr" id="sYtErr"></div>
    <div class="row" style="margin-top:10px"><span class="grow sm muted">Bilgiler yalnızca bu bilgisayarda (settings.json) saklanır.</span>${edit ? `<button type="button" class="btn" data-yta="edit-no">Vazgeç</button>` : ""}<button type="button" class="btn primary" data-yta="client">${ic("check", 15)}Kaydet</button></div>
  </div>`;
}

function waitHtml(X) {
  const { ic, esc } = X;
  const w = Y.wait;
  if (!w) return "";
  if (w.expired)
    return `<div class="yts-wait done">${ic("clock", 18)}<div class="grow"><b>Süre doldu</b><span>Google'dan onay gelmedi. Tekrar bağlanmayı dene.</span></div><button type="button" class="btn sm" data-yta="wait-no">Tamam</button></div>`;
  return `<div class="yts-wait">${ic("loader-circle", 18, "spin")}<div class="grow"><b>Google'da izin bekleniyor…</b>
    <span>${w.blocked ? "Tarayıcı yeni sekmeyi engelledi; aşağıdaki bağlantıyla Google sayfasını aç." : "Açılan sekmede hesabını seç ve izin ver."} Bitince burası kendiliğinden güncellenir.</span>
    <a href="${esc(w.url)}" target="_blank" rel="noopener">${ic("external-link", 12)}${w.blocked ? "Google sayfasını aç" : "Sekme açılmadıysa buradan aç"}</a></div>
    <button type="button" class="btn sm" data-yta="wait-no">Vazgeç</button></div>`;
}

function stopWait() {
  clearTimeout(Y.waitTimer);
  Y.waitTimer = null;
  Y.wait = null;
}

function watchConnect(X) {
  clearTimeout(Y.waitTimer);
  const step = async () => {
    const w = Y.wait;
    if (!w || w.expired) return;
    await load();
    const d = Y.data;
    if (d?.connected && !d.needs_reconnect) {
      stopWait();
      X.toast(`YouTube bağlandı${d.channel?.title ? `: ${d.channel.title}` : ""}`);
      Y.redraw?.();
      X.refresh();
      return;
    }
    if (Date.now() > w.until) {
      w.expired = true;
      Y.redraw?.();
      return;
    }
    Y.waitTimer = setTimeout(step, 2000);
  };
  Y.waitTimer = setTimeout(step, 2000);
}

async function startConnect(X) {
  const win = window.open("about:blank", "_blank");
  let r;
  try {
    r = await X.api("/api/youtube/auth", {});
  } catch (e) {
    win?.close();
    throw e;
  }
  if (!r?.url) {
    win?.close();
    throw new Error("Google bağlantı adresi alınamadı");
  }
  let blocked = !win || win.closed;
  if (!blocked) {
    try {
      win.opener = null;
      win.location.href = r.url;
    } catch {
      blocked = true;
    }
  }
  Y.wait = { url: r.url, until: Date.now() + WAIT_MS, blocked };
  watchConnect(X);
}

function quotaHtml(X, d) {
  const q = d.quota || {};
  const limit = +q.limit || 10000;
  const used = Math.max(0, +q.used || 0);
  const cost = +q.insert_cost || 1600;
  const left = q.uploads_left ?? Math.max(0, Math.floor((limit - 200 - used) / cost));
  const pct = Math.min(100, (used / limit) * 100);
  const lvl = left === 0 ? "bad" : pct >= 70 ? "warn" : "ok";
  return `<div class="yts-quota">
    <div class="row"><b>Bugünkü kota</b><span class="grow"></span><span class="yts-left ${lvl}">${left > 0 ? `bugün ${left} video daha` : "bugünlük doldu"}</span></div>
    <div class="yts-meter"><i class="${lvl}" style="width:${pct.toFixed(1)}%"></i></div>
    <div class="sm muted">${fx(used, 0)} / ${fx(limit, 0)} birim · bir video ${fx(cost, 0)} birim${q.resets_at ? ` · yenilenme ${X.esc(when(q.resets_at))}` : ""}</div>
  </div>`;
}

function auditHtml(X, d) {
  const { ic } = X;
  const ok = !!d.audited;
  const kit = !ok && Y.kit && !Y.kitMissing ? kitCard(X, d) : "";
  return `<div class="yts-audit ${ok ? "ok" : ""}" id="sYtAudit">
    <div class="yts-audit-h">${ic(ok ? "shield-check" : "shield-alert", 16)}<b>${ok ? "Proje denetimden geçti" : "Denetim · isteğe bağlı, önerilir"}</b></div>
    ${ok ? `<p>Videolar planlanan saatte herkese açık yayınlanır.</p>`
      : `<p>Google'ın kuralına göre, denetimden (audit) geçmemiş projelerle yüklenen videolar YouTube'da <b>gizli</b> tutulabilir. Çoğu projede videolar denetimsiz de planlanan saatte herkese açık yayınlanıyor, ama <b>her projede böyle olmayabilir</b> ve Google kuralı her an uygulamaya başlayabilir.</p>
      <div class="yts-check">${ic("eye", 14)}<span><b>İlk videonu kontrol et:</b> İlk YouTube videon yayın saatinden sonra herkese açık göründüyse projende sorun yok demektir. Gizli kaldıysa stüdyo seni uyarır; o zaman denetim başvurusu gerekir.</span></div>
      <p>Başvuru ücretsiz ama uğraştırıcı ve cevabı birkaç hafta sürebilir. Zorunlu değil; ileride sorun yaşamamak için yine de yapman önerilir.</p>
      ${kit || `<div class="yts-need"><b>Başvuru için gerekenler</b><ul>
        <li>${ic("globe", 12)}Herkese açık bir ana sayfa, <b>gizlilik politikası</b> ve <b>kullanım şartları</b> sayfası (YouTube bölümüyle)</li>
        <li>${ic("image", 12)}Bu sayfaların ve stüdyonun YouTube ekranlarının görüntüleri</li>
        <li>${ic("hash", 12)}Google Cloud proje numarası, ad-soyad ve adres</li></ul></div>`}
      <div class="row wrap"><a class="btn sm" href="${LINKS.audit}" target="_blank" rel="noopener">${ic("external-link", 13)}Denetim formunu aç</a><button type="button" class="btn sm" data-yta="audit-claude">${ic("bot", 13)}Claude ile yap</button><a class="btn sm ghost" href="${LINKS.studio}" target="_blank" rel="noopener">${ic("youtube", 13)}YouTube Studio</a></div>`}
    <label class="check yts-opt"><input type="checkbox" id="sYtAudited" ${ok ? "checked" : ""}><span>Denetim onaylandı<small>Google'dan onay e-postası geldiyse işaretle.</small></span></label>
  </div>`;
}

// ---------- audit kit ----------

const KIT_STEPS = [["globe", "Sayfaların"], ["shield-check", "Google'da kalıcı yap"], ["images", "Ekran görüntüleri"], ["clipboard-list", "Formu doldur"], ["send", "Gönder ve bekle"]];
const KIT_SEC = { 1: "Başvuru türü", 2: "Kişi ve iletişim bilgileri", 3: "İş modeli", 4: "Uygulama bilgileri", 5: "Kullanım ve zorunlu kanıtlar", 6: "Ek belgeler", 7: "Onaylar ve gönderim" };
const KIT_DEST = { "1-ana-sayfa.png": "Homepage Screenshot", "2-gizlilik.png": "Privacy Policy Screenshots", "3-sartlar.png": "Terms of Service Documentation", "4-studyo-youtube-ayarlari.png": "Additional evidence", "5-studyo-paylasim-karti.png": "Additional evidence" };
const KIT_KIND = { text: ["copy", "Kopyala"], choice: ["mouse-pointer-click", "Seç"], check: ["square-check", "İşaretle"], self: ["pencil", "Sen yaz"], file: ["paperclip", "Dosya yükle"], skip: ["minus", "Boş bırak"] };
const KIT_ALIAS = { manual: "self", upload: "file" };
const BRAND_KEY = "sosyal-yt-kit-branding";
const uiw = (t) => `<b class="yt-ui">${t}</b>`;

function day(iso) {
  const t = new Date(iso || "");
  return isNaN(t) ? "" : t.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
}

function brandMark(on) {
  try {
    if (on === undefined) return localStorage.getItem(BRAND_KEY) === "1";
    if (on) localStorage.setItem(BRAND_KEY, "1");
    else localStorage.removeItem(BRAND_KEY);
  } catch {}
  return !!on;
}

function kitPublished(k) {
  const s = k?.site || {};
  return !!(s.configured && s.pushed_at && s.urls?.home);
}

function kitDone(k, d) {
  const ev = k.evidence || [];
  const req = ev.filter((e) => /^(home|privacy|terms)$/.test(e.key) || /^[123]-/.test(e.file || ""));
  const shots = (req.length ? req : ev).length > 0 && (req.length ? req : ev).every((e) => e.ready);
  return [kitPublished(k), !!k.branding_done || brandMark(), shots, !!k.project_number, !!k.submitted_at || !!d?.audited];
}

function kitFirst(k, d) {
  const i = kitDone(k, d).indexOf(false);
  return i < 0 ? 5 : i + 1;
}

function kitKind(a) {
  const k = KIT_ALIAS[a.kind] || a.kind;
  if (k === "skip") return k;
  if (k === "self" || a.manual || a.self) return "self";
  if (k === "file" || a.file) return "file";
  if (KIT_KIND[k]) return k;
  return a.value ? "text" : "self";
}

function kitCard(X, d) {
  const { ic, esc } = X;
  const k = Y.kit;
  const done = kitDone(k, d);
  const n = done.filter(Boolean).length;
  if (k.submitted_at)
    return `<div class="kit-sent">${ic("mail", 18)}<div class="grow"><b>Başvuru gönderildi · ${esc(day(k.submitted_at))} · Google'ın e-postası bekleniyor</b><span>Onay e-postası gelince aşağıdaki kutuyu işaretle.</span></div><button type="button" class="btn sm" data-yta="kit-open">${ic("list-checks", 13)}Kiti aç</button></div>`;
  return `<div class="kit-cta"><div class="kit-cta-t"><b>Denetim kiti ile adım adım başvur</b><span>Sayfaların yayınlanır, ekran görüntüleri hazırlanır, formun cevapları kopyalamaya hazır gelir.</span>
      <div class="kit-dots" title="${n}/5 adım tamam">${done.map((x) => `<i class="${x ? "on" : ""}"></i>`).join("")}<small>${n ? `${n}/5 adım tamam` : "5 adım"}</small></div></div>
    <button type="button" class="btn primary" data-yta="kit-open">${ic("list-checks", 15)}Denetim kitini aç</button></div>`;
}

function copyBtn(X, K, value) {
  if (!value) return `<button type="button" class="btn sm kit-copy" disabled>${X.ic("copy", 13)}<span>Kopyala</span></button>`;
  const i = K.vals.push(String(value)) - 1;
  return `<button type="button" class="btn sm kit-copy" data-yta="kit-copy" data-ci="${i}">${X.ic("copy", 13)}<span>Kopyala</span></button>`;
}

function valBox(X, value) {
  const v = String(value ?? "");
  return `<code class="kit-val ${v.length > 110 || v.includes("\n") ? "long" : ""}">${v ? X.esc(v) : "—"}</code>`;
}

function copyRow(X, K, label, value, note = "") {
  return `<div class="kit-row"><div class="kit-rl">${uiw(X.esc(label))}${note ? `<span>${note}</span>` : ""}</div><div class="kit-rv">${valBox(X, value)}${copyBtn(X, K, value)}</div></div>`;
}

function kitHead(X, n, why, done) {
  const [icon, title] = KIT_STEPS[n - 1];
  return `<div class="kit-h"><span class="kit-hic">${X.ic(icon, 18)}</span><div class="grow"><small>Adım ${n} / 5</small><h3>${title}</h3></div>${done ? `<span class="yts-ok">${X.ic("circle-check", 13)}Tamam</span>` : ""}</div>
    <div class="kit-why">${X.ic("lightbulb", 14)}<span>${why}</span></div>`;
}

function kitNeedPages(X, what) {
  return `<div class="yts-note">${X.ic("info", 16)}<div class="grow"><b>Önce sayfalarını yayınla</b><span>${what}</span></div><button type="button" class="btn sm" data-yta="kit-go" data-step="1">1. adıma git</button></div>`;
}

function kitLinks(X, K, s) {
  const { ic, esc } = X;
  const u = s.urls || {};
  const row = (icon, t, url, tr) => `<div class="kit-link">${ic(icon, 16)}<div class="grow"><b>${t}</b><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></div>
    <div class="kit-la">${tr ? `<a class="btn sm ghost" href="${esc(tr)}" target="_blank" rel="noopener" title="Türkçe sürümü aç">TR</a>` : ""}${copyBtn(X, K, url)}<a class="btn sm" href="${esc(url)}" target="_blank" rel="noopener">${ic("external-link", 13)}Aç</a></div></div>`;
  const meta = [s.pushed_at ? `${when(s.pushed_at)} yayınlandı` : "", u.domain].filter(Boolean).join(" · ");
  return `<div class="kit-ok">${ic("circle-check", 18)}<div class="grow"><b>Sayfaların yayında</b><span>${esc(meta)}</span></div></div>
    <div class="kit-links">${u.home ? row("house", "Ana sayfa", u.home, u.home_tr) : ""}${u.privacy ? row("file-text", "Gizlilik politikası", u.privacy, u.privacy_tr) : ""}${u.terms ? row("scale", "Kullanım şartları", u.terms, u.terms_tr) : ""}</div>
    <div class="kit-hint">${ic("eye", 13)}<span>Bir göz at: adın, e-postan ve YouTube bölümü görünmeli. <b>TR</b> Türkçe sürümü açar; Google İngilizce sürüme bakar.</span></div>`;
}

function kitPages(X, d, K, done) {
  const { ic, esc } = X;
  const k = Y.kit;
  const s = k.site || {};
  const pub = kitPublished(k);
  const cloudOn = !!s.supported || (typeof s.connected === "boolean" ? s.connected : !!X.S.cloud?.configured);
  const why = `Google, başvuruda herkese açık bir <b>ana sayfa</b>, <b>gizlilik politikası</b> ve <b>kullanım şartları</b> sayfası ister. Web siten olmasa da olur: stüdyo bu üç sayfayı senin Cloudflare hesabındaki bulut servisinde İngilizce ve Türkçe yayınlar.`;
  let main;
  if (!s.supported)
    main = cloudOn
      ? `<div class="yts-warn">${ic("rocket", 18)}<div class="grow"><b>Bulut servisini güncelle</b><span>Sayfalar bulut servisinin yeni sürümüyle yayınlanır. Bulut yayın sekmesinde <b>Güncelle</b>'ye bas; videoların ve planların korunur. Sonra buraya dön.</span></div><button type="button" class="btn sm primary" data-yta="kit-cloud">${ic("cloud", 13)}Bulut servisini güncelle</button></div>`
      : `<div class="yts-warn">${ic("cloud-off", 18)}<div class="grow"><b>Önce bulut yayını kur</b><span>Sayfalar senin ücretsiz Cloudflare hesabında yayınlanır. Bulut yayın sekmesinden birkaç dakikada kurulur; sonra buraya dön.</span></div><button type="button" class="btn sm primary" data-yta="kit-cloud">${ic("cloud", 13)}Bulut yayına git</button></div>`;
  else {
    const name = s.owner_name || s.suggest?.owner_name || X.S.settings?.display_name || "";
    const form = `${s.push_error && !pub ? `<div class="yts-note bad">${ic("triangle-alert", 16)}<div class="grow"><b>Son yayın denemesi olmadı</b><span>${esc(s.push_error)}</span></div></div>` : ""}<div class="kit-form">
      <label for="kitName">Ad Soyad ya da marka adı</label><input id="kitName" autocomplete="name" maxlength="80" placeholder="ör. Ayşe Yılmaz" value="${esc(name)}">
      <label for="kitEmail">E-posta</label><input id="kitEmail" type="email" autocomplete="email" maxlength="120" placeholder="ornek@eposta.com" value="${esc(s.email || "")}">
      <div class="kit-hint">${ic("eye", 13)}<span>Bu ikisi sayfalarda iletişim bilgisi olarak herkese görünür. Adres ya da telefon yazılmaz.</span></div>
      <div class="yts-ferr" id="kitSiteErr">${esc(K.siteErr || "")}</div>
      <div class="row kit-fa"><span class="grow"></span><button type="button" class="btn primary" data-yta="kit-site">${ic(pub ? "refresh-cw" : "rocket", 15)}${pub ? "Sayfaları güncelle" : "Sayfaları yayınla"}</button></div></div>`;
    main = pub ? `${kitLinks(X, K, s)}<details class="kit-more" data-k="site" ${K.open.has("site") || K.siteErr ? "open" : ""}><summary>Adı ya da e-postayı değiştir</summary>${form}</details>` : form;
  }
  return kitHead(X, 1, why, done) + main;
}

function kitBrand(X, d, K, done) {
  const { ic } = X;
  const k = Y.kit;
  const u = (kitPublished(k) && k.site.urls) || {};
  const ext = (href, label) => `<a class="btn sm" href="${href}" target="_blank" rel="noopener">${ic("external-link", 13)}${label}</a>`;
  const why = `Projen şu an <b>Testing</b> durumunda; bu yüzden Google YouTube bağlantısını 7 günde bir koparıyor. Branding sayfasına sayfalarının linklerini girip uygulamayı <b>In production</b> yapınca bağlantı kalıcı olur. Denetim başvurusu için de bu gerekli.`;
  return `${kitHead(X, 2, why, done)}
    ${kitPublished(k) ? "" : kitNeedPages(X, "Buraya yapıştıracağın linkler 1. adımda hazırlanır.")}
    <ol class="yts-steps kit-ol">
      <li><div><b>Branding sayfasını aç.</b> Üstte YouTube için açtığın projenin seçili olduğundan emin ol.<div class="kit-act">${ext(LINKS.branding, "Branding sayfasını aç")}</div></div></li>
      <li><div><b>Linkleri yapıştır.</b> ${uiw("App domain")} bölümündeki kutulara sırayla yapıştır; alan adı için ${uiw("Authorized domains")} altında ${uiw("+ Add domain")}'e bas. En altta ${uiw("Save")}.
        ${copyRow(X, K, "Application home page", u.home, "Ana sayfa")}
        ${copyRow(X, K, "Application privacy policy link", u.privacy, "Gizlilik politikası")}
        ${copyRow(X, K, "Application terms of service link", u.terms, "Kullanım şartları")}
        ${copyRow(X, K, "Authorized domains", u.domain, "Alan adı, başında https:// olmadan")}</div></li>
      <li><div><b>Yayına al.</b> ${uiw("Audience")} sayfasında ${uiw("Publishing status")} altındaki ${uiw("Publish app")}'e, sonra ${uiw("Confirm")}'e bas. Durum <b>In production</b> olur.<div class="kit-act">${ext(LINKS.audience, "Audience sayfasını aç")}</div>
        <div class="yts-why">${ic("info", 13)}<span>Bağlanırken "Google hasn't verified this app" uyarısı çıkmaya devam edebilir; kendi projen olduğu için normaldir. Bağlantı bu hafta yine koparsa bir kez <b>Yeniden bağlan</b> de; sonrası kalıcıdır.</span></div></div></li>
    </ol>
    <label class="check yts-opt kit-confirm"><input type="checkbox" id="kitBrand" ${done ? "checked" : ""}><span>Yaptım, Audience sayfasında "In production" yazıyor<small>Bu işaret yalnızca senin takibin için; Google'a bir şey gönderilmez.</small></span></label>`;
}

function kitShotSrc(e) {
  return e.url || `/api/youtube/audit-kit/shots/${encodeURIComponent(e.file)}`;
}

function kitShots(X) {
  const { ic, esc } = X;
  const k = Y.kit;
  const sh = k.shots || {};
  const ev = k.evidence || [];
  const total = +sh.total || ev.length || 5;
  const n = typeof sh.done === "number" ? sh.done : (sh.files || []).length + (sh.skipped || []).length;
  const pct = Math.round(Math.min(1, n / total) * 100);
  const ready = ev.filter((e) => e.ready).length;
  const all = ev.length > 0 && ready === ev.length;
  const noBrowser = k.browser === false;
  const why = (f) => (sh.running ? null : (sh.skipped || []).find((x) => x.file === f)?.reason);
  const manual = `<div class="kit-hint">${ic("info", 13)}<span>Elle almak için: sayfayı tarayıcıda aç, <b>Win + Shift + S</b> ile ekranı yakala ve aşağıdaki dosya adıyla klasöre kaydet.</span></div>`;
  const head = sh.running
    ? `<div class="kit-run">${ic("loader-circle", 18, "spin")}<div class="grow"><b>Görüntüler hazırlanıyor… ${Math.min(n, total)} / ${total}</b><div class="ytc-bar"><i style="width:${pct}%"></i></div><span>${sh.current ? `${esc(sh.current)} · ` : ""}Tarayıcı arka planda sayfaları açıp fotoğraflıyor; ekranında bir şey açılmaz.</span></div></div>`
    : sh.error
      ? `<div class="yts-note bad">${ic("triangle-alert", 16)}<div class="grow"><b>${ready ? "Bazı görüntüler alınamadı" : "Görüntüler hazırlanamadı"}</b><span>${esc(sh.error)}</span></div></div>${manual}`
      : noBrowser
        ? `<div class="yts-warn">${ic("triangle-alert", 18)}<div class="grow"><b>Edge ya da Chrome bulunamadı</b><span>Stüdyo görüntüleri bu tarayıcılardan biriyle çeker. Birini kurabilir ya da görüntüleri elle alabilirsin.</span></div></div>${manual}`
        : "";
  const go = sh.running ? "" : `<button type="button" class="btn ${all ? "" : "primary"}" data-yta="kit-shots" ${kitPublished(k) && !noBrowser ? "" : "disabled"}>${ic(ready ? "refresh-cw" : "camera", 15)}${sh.error ? "Tekrar dene" : ready ? "Yeniden hazırla" : "Görüntüleri hazırla"}</button>`;
  const cards = ev.map((e) => {
    const dest = e.dest || e.field || KIT_DEST[e.file] || "";
    const src = kitShotSrc(e);
    const miss = !e.ready && why(e.file);
    return `<div class="kit-shot ${e.ready ? "ok" : miss ? "miss" : ""}">
      ${e.ready ? `<a class="kit-th" href="${esc(src)}" target="_blank" rel="noopener" title="Büyük aç"><img src="${esc(src)}" alt="" loading="lazy">${ic("image", 22)}</a>` : `<span class="kit-th">${ic("image", 22)}</span>`}
      <span class="kit-tick" title="${e.ready ? "Hazır" : "Bekliyor"}">${ic(e.ready ? "circle-check" : miss ? "triangle-alert" : "circle-dashed", 16)}</span>
      <div class="kit-sb"><b>${esc(e.label || e.file)}</b><span class="kit-file">${esc(e.file)}</span>${dest ? `<span class="kit-dest">${ic("paperclip", 11)}${esc(dest)}</span>` : ""}${miss ? `<span class="kit-miss">${esc(miss)}</span>` : ""}</div></div>`;
  }).join("");
  return `${head}<div class="row wrap kit-fa">${go}<button type="button" class="btn" data-yta="kit-folder">${ic("folder-open", 15)}Klasörü aç</button><span class="grow"></span>${ev.length ? `<span class="sm muted">${ready} / ${ev.length} hazır</span>` : ""}</div>
    ${ev.length ? `<div class="kit-shots">${cards}</div>` : ""}`;
}

function kitShotsStep(X, d, K, done) {
  const why = `Formda sayfalarının ve stüdyonun YouTube ekranlarının görüntüleri isteniyor. Stüdyo bunları bilgisayarındaki Edge ya da Chrome ile arka planda kendisi çeker ve bir klasöre koyar; sen 4. adımda forma yüklersin.`;
  return `${kitHead(X, 3, why, done)}${kitPublished(Y.kit) ? "" : kitNeedPages(X, "Ekran görüntüleri yayındaki sayfalardan çekilir.")}<div id="kitShots">${kitShots(X)}</div>`;
}

function kitField(X, K, a) {
  const { ic, esc } = X;
  const kind = kitKind(a);
  const [icon, label] = KIT_KIND[kind];
  const note = a.note ? `<span class="kit-fn">${esc(a.note)}</span>` : "";
  const head = `<div class="kit-fl"><b>${esc(a.field)}</b>${kind === "text" ? "" : `<span class="kit-tag ${kind}">${ic(icon, 11)}${label}</span>`}</div>`;
  if (kind === "file") {
    const ev = Y.kit.evidence || [];
    const files = String(a.file || a.value || "").split(/\s*[,;]\s*/).filter(Boolean);
    return `<div class="kit-f file">${head}${note}<div class="kit-files">${files.map((f) => {
      const ok = ev.find((e) => e.file === f)?.ready;
      return `<span class="kit-fchip ${ok ? "ok" : ""}">${ic(ok ? "circle-check" : "circle-dashed", 13)}${esc(f)}</span>`;
    }).join("")}<button type="button" class="btn sm ghost" data-yta="kit-folder">${ic("folder-open", 13)}Klasörü aç</button></div></div>`;
  }
  if (kind === "skip" || (kind === "self" && !a.value)) return `<div class="kit-f ${kind}">${head}${note}</div>`;
  return `<div class="kit-f ${kind}">${head}${note}<div class="kit-rv">${valBox(X, a.value)}${copyBtn(X, K, a.value)}</div></div>`;
}

function kitUploads(X) {
  const { ic, esc } = X;
  const ev = Y.kit.evidence || [];
  if (!ev.length) return "";
  return `<div class="kit-up"><div class="kit-upt">${ic("paperclip", 15)}<b class="grow">Formdaki dosya kutuları</b><button type="button" class="btn sm ghost" data-yta="kit-folder">${ic("folder-open", 13)}Klasörü aç</button></div>
    ${ev.map((e) => `<div class="kit-upr">${uiw(esc(e.dest || e.field || KIT_DEST[e.file] || e.label || ""))}${ic("arrow-left", 13)}<span class="kit-fchip ${e.ready ? "ok" : ""}">${ic(e.ready ? "circle-check" : "circle-dashed", 13)}${esc(e.file)}</span></div>`).join("")}</div>`;
}

function kitForm(X, d, K, done) {
  const { ic, esc } = X;
  const k = Y.kit;
  const pn = k.project_number || "";
  const why = `Google'ın formu İngilizce ve uzun. Aşağıda her bölümün cevabı hazır: <b>Kopyala</b>'ya bas, formdaki aynı adlı kutuya yapıştır. Ad ve adres gibi kişisel bilgileri <b>sen yazarsın</b>; stüdyo bunları istemez ve saklamaz.`;
  const pnBox = pn && !K.editPn
    ? `<div class="kit-pn ok">${ic("hash", 18)}<div class="grow"><small>Google Cloud proje numarası</small><code>${esc(pn)}</code></div>${copyBtn(X, K, pn)}<button type="button" class="btn sm ghost" data-yta="kit-pn-edit">Değiştir</button></div>`
    : `<div class="kit-pn"><label for="kitProj">Google Cloud proje numarası</label>
      <div class="kit-pnr"><input id="kitProj" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="24" placeholder="ör. 123456789012" value="${esc(pn)}"><button type="button" class="btn primary" data-yta="kit-pn">${ic("check", 15)}Kaydet</button>${pn ? `<button type="button" class="btn ghost" data-yta="kit-pn-no">Vazgeç</button>` : ""}</div>
      <div class="yts-ferr" id="kitPnErr">${esc(K.pnErr || "")}</div>
      <div class="kit-hint">${ic("info", 13)}<span><b>Nerede?</b> <a href="${LINKS.dashboard}" target="_blank" rel="noopener">Google Cloud panosunu</a> aç, üstten YouTube projeni seç. ${uiw("Project info")} kartındaki ${uiw("Project number")} yalnızca rakamdır; ${uiw("Project ID")} ile karıştırma.</span></div></div>`;
  const groups = [];
  for (const a of k.answers || []) {
    const key = String(a.section ?? "");
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, items: [] }));
    g.items.push(a);
  }
  const secs = groups.map((g, i) => {
    const m = /^\s*(\d+)\s*[.):-]?\s*(.*)$/.exec(g.key);
    const no = m ? m[1] : String(i + 1);
    const title = (m ? m[2] : g.key) || KIT_SEC[no] || `Bölüm ${no}`;
    const kinds = g.items.map(kitKind);
    const nSelf = kinds.filter((x) => x === "self").length;
    const nFile = kinds.filter((x) => x === "file").length;
    const id = `s${no}`;
    return `<details class="kit-sec" data-k="${esc(id)}" ${K.open.has(id) ? "open" : ""}><summary><span class="kit-sn">${esc(no)}</span><span class="grow"><b>${esc(title)}</b><small>${KIT_SEC[no] ? `${KIT_SEC[no]} · ` : ""}${g.items.length} alan</small></span>${nSelf ? `<span class="kit-tag self" title="Senin yazacağın alan">${ic("pencil", 11)}${nSelf}</span>` : ""}${nFile ? `<span class="kit-tag file" title="Dosya yüklenecek alan">${ic("paperclip", 11)}${nFile}</span>` : ""}${ic("chevron-down", 16)}</summary>
      <div class="kit-fields">${g.items.map((a) => kitField(X, K, a)).join("")}</div></details>`;
  }).join("");
  const hasFile = (k.answers || []).some((a) => kitKind(a) === "file");
  const tag = (kind, text) => `<span><span class="kit-tag ${kind}">${ic(KIT_KIND[kind][0], 11)}${KIT_KIND[kind][1]}</span>${text}</span>`;
  return `${kitHead(X, 4, why, done)}${pnBox}
    <div class="kit-formbar"><div class="grow"><b>Formu yeni sekmede aç</b><span>Bu pencereyi açık tut; cevapları buradan kopyalayıp yapıştır.</span></div><a class="btn ${pn ? "primary" : ""}" href="${esc(k.form_url || LINKS.audit)}" target="_blank" rel="noopener">${ic("external-link", 15)}Formu aç</a></div>
    ${secs ? `<div class="kit-legend">${tag("text", "kutuya yapıştır")}${tag("choice", "listeden seç")}${tag("check", "kutuyu işaretle")}${tag("self", "kendin doldur")}${tag("file", "klasörden yükle")}</div>${secs}` : `<div class="yts-note">${ic("info", 16)}<div class="grow"><b>Hazır cevaplar alınamadı</b><span>Stüdyoyu yeniden başlatıp tekrar dene.</span></div></div>`}
    ${hasFile ? "" : kitUploads(X)}
    <div class="yts-claude"><button type="button" class="btn sm" data-yta="audit-claude">${ic("bot", 14)}Claude ile yap</button><span class="sm muted">Takıldığın bir alan olursa: formu birlikte doldurmak için hazır bir metni panoya kopyalar.</span></div>`;
}

function kitSend(X, d, K, done) {
  const { ic, esc } = X;
  const k = Y.kit;
  const sent = k.submitted_at;
  const why = `Formun en altındaki onay kutularını okuyup işaretledikten sonra ${uiw("Submit")}'e sen basarsın. Google genelde birkaç gün ile birkaç hafta içinde e-postayla döner; bazen ek bilgi ister.`;
  const approved = `<label class="check yts-opt kit-confirm"><input type="checkbox" id="sYtAudited" ${d.audited ? "checked" : ""}><span>Denetim onaylandı<small>Google'dan onay e-postası geldiyse işaretle.</small></span></label>`;
  if (d.audited) return `${kitHead(X, 5, why, true)}<div class="kit-ok big">${ic("badge-check", 22)}<div class="grow"><b>Denetim onaylandı</b><span>Videoların planlanan saatte herkese açık yayınlanır. Kit işini bitirdi.</span></div></div>${approved}`;
  return `${kitHead(X, 5, why, done)}
    <div class="kit-check"><b>Göndermeden önce</b><ul>
      <li>${ic("check", 13)}Yıldızlı (*) bütün alanlar dolu</li>
      <li>${ic("check", 13)}Üç zorunlu dosya yüklendi: ana sayfa, gizlilik, şartlar</li>
      <li>${ic("check", 13)}Proje numarası doğru${k.project_number ? `: <b class="kit-num">${esc(k.project_number)}</b>` : ""}</li>
      <li>${ic("check", 13)}En alttaki onay kutularını okuyup işaretledin</li></ul>
      <a class="btn sm" href="${esc(k.form_url || LINKS.audit)}" target="_blank" rel="noopener">${ic("external-link", 13)}Formu aç</a></div>
    <label class="check yts-opt kit-confirm"><input type="checkbox" id="kitSent" ${sent ? "checked" : ""}><span>Başvuruyu gönderdim<small>${sent ? `${esc(day(sent))} tarihinde işaretlendi.` : "Gönderdikten sonra işaretle; stüdyo beklediğini hatırlar."}</small></span></label>
    ${sent ? `<div class="kit-sent">${ic("mail", 18)}<div class="grow"><b>Başvuru gönderildi · ${esc(day(sent))} · Google'ın e-postası bekleniyor</b><span>Yanıt formdaki e-posta adresine gelir. Google soru sorarsa cevapları bu kitteki bilgilerle yazabilirsin. Onay gelince aşağıdaki kutuyu işaretle.</span></div></div>` : ""}
    ${approved}`;
}

function kitHtml(X, d, K) {
  const { ic } = X;
  const k = Y.kit;
  K.vals = [];
  const done = kitDone(k, d);
  const n = done.filter(Boolean).length;
  const st = Math.min(5, Math.max(1, K.step || 1));
  const steps = [kitPages, kitBrand, kitShotsStep, kitForm, kitSend];
  return `<div class="kit" id="sYtKit">
    <div class="kit-top"><button type="button" class="kit-back" data-yta="kit-close">${ic("arrow-left", 15)}Geri</button><div class="grow"><b>Denetim kiti</b><span>YouTube API denetim başvurusu · ${n}/5 adım tamam</span></div></div>
    <ol class="kit-steps">${KIT_STEPS.map(([, t], i) => `<li class="${i + 1 === st ? "on" : ""} ${done[i] ? "done" : ""}"><button type="button" data-yta="kit-go" data-step="${i + 1}" title="${t}" ${i + 1 === st ? 'aria-current="step"' : ""}><span class="kit-n">${done[i] ? ic("check", 15) : i + 1}</span><span class="kit-sl">${t}</span></button></li>`).join("")}</ol>
    <section class="kit-body">${steps[st - 1](X, d, K, done[st - 1])}</section>
    <div class="kit-nav">${st > 1 ? `<button type="button" class="btn" data-yta="kit-go" data-step="${st - 1}">${ic("chevron-left", 15)}Önceki adım</button>` : ""}<span class="grow"></span>${st < 5 ? `<button type="button" class="btn ${done[st - 1] ? "primary" : ""}" data-yta="kit-go" data-step="${st + 1}">Sonraki adım${ic("chevron-right", 15)}</button>` : `<button type="button" class="btn" data-yta="kit-close">${ic("check", 15)}Kiti kapat</button>`}</div>
  </div>`;
}

function eventsHtml(X, d) {
  const { ic, esc } = X;
  const ev = [...(d.events || [])].sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 8);
  if (!ev.length) return "";
  return `<details class="yts-ev"><summary>Son YouTube işlemleri</summary><ul>${ev.map((e) => {
    const [icon, cls] = EV_IC[e.kind] || ["youtube", ""];
    return `<li class="${cls}">${ic(icon, 13)}<span class="grow">${esc(e.text)}</span><span class="sm muted">${esc(when(e.at))}</span></li>`;
  }).join("")}</ul></details>`;
}

export function ytSettingsHtml(X) {
  return `<fieldset id="sYt"><legend>YouTube Shorts</legend><div id="sYtBody" class="yts"><div class="sm muted" style="margin-top:10px">${X.ic("loader-circle", 13, "spin")} Durum alınıyor…</div></div></fieldset>`;
}

export function bindYtSettings(X, m, section) {
  const box = $("#sYtBody", m);
  if (!box) return;
  const { ic, esc } = X;
  const L = { ask: false, edit: false, kit: null };
  const act = (a, label, icon, cls = "") => `<button type="button" class="btn sm ${cls}" data-yta="${a}">${ic(icon, 13)}${label}</button>`;
  const body = () => {
    if (Y.missing)
      return `<div class="yts-note">${ic("info", 16)}<div><b>YouTube Shorts paylaşımı eklendi</b><span>Stüdyoyu yeniden başlatınca kullanılabilir.</span></div></div>`;
    const d = Y.data;
    if (!d) return `<div class="yts-note bad">${ic("triangle-alert", 16)}<div class="grow"><b>YouTube bilgisi alınamadı</b><span>${esc(Y.err || "")}</span></div>${act("reload", "Tekrar dene", "refresh-cw")}</div>`;
    if (!d.configured)
      return `<div class="yts-lead">Planlanan Reels videoların aynı saatte YouTube kanalında <b>Shorts</b> olarak da yayınlansın. Video yayın saatinden <b>7 gün önce</b> YouTube'a yüklenir ve YouTube'da saatini bekler; saati gelince YouTube kendisi yayınlar. Yayın anında bilgisayarın kapalı olabilir, bu 7 gün içinde bir kez açık olması yeter.</div>
        <div class="yts-free">${ic("circle-check", 16)}<div><b>Ücretsiz, bir kez kurulur (yaklaşık 10 dakika)</b><span>Kendi Google hesabında küçük bir proje açıp iki bilgi kopyalayacaksın. Kart istemez.</span></div></div>
        ${guideHtml(X)}${claudeRow(X)}${clientForm(X, false)}`;
    if (!d.connected)
      return `<div class="yts-st">${ic("key-round", 15)}<b>İstemci kayıtlı</b><span class="muted">· kanal henüz bağlı değil</span></div>
        ${Y.wait ? waitHtml(X) : `<div class="yts-connect"><button type="button" class="btn primary yts-g" data-yta="connect">${ic("youtube", 16)}Google ile bağlan</button><span class="sm muted">Yeni sekmede Google açılır.</span></div>`}
        <div class="yts-sub"><b>Açılan sekmede:</b>${warnHtml()}</div>
        ${L.edit ? clientForm(X, true) : `<details class="help"><summary><b>Kurulum adımları</b></summary>${guideHtml(X)}</details>
        <div class="row" style="margin-top:8px">${claudeSetupBtn("youtube", "Claude ile kur", "ghost")}<span class="grow"></span>${act("edit", "İstemci bilgilerini değiştir", "key-round", "ghost")}</div>`}`;
    if (L.kit && Y.kit) return kitHtml(X, d, L.kit);
    L.kit = null;
    if (!Y.kit && !Y.kitMissing && !Y.kitLoading) loadKit().then(() => Y.kit && !L.kit && draw());
    const ch = d.channel || {};
    return `${d.needs_reconnect ? `<div class="yts-warn">${ic("triangle-alert", 18)}<div class="grow"><b>Google bağlantısı sona erdi</b><span>Yeniden bağlanana kadar YouTube yüklemeleri bekler. Bu genelde izin ekranı "Testing" durumunda kaldığında 7 gün sonra olur: Google Cloud'da ${`<a href="${LINKS.audience}" target="_blank" rel="noopener">Audience</a>`} sayfasında <b>In production</b> olduğundan emin ol.</span></div>${Y.wait ? "" : act("connect", "Yeniden bağlan", "refresh-cw", "primary")}</div>${Y.wait ? waitHtml(X) + `<div class="yts-sub">${warnHtml()}</div>` : ""}` : ""}
      <div class="yts-ch"><span class="yts-av" ${ch.thumb ? `style="background-image:url('${esc(ch.thumb)}')"` : ""}>${ch.thumb ? "" : esc((ch.title || "Y")[0].toUpperCase())}</span>
        <div class="grow"><b>${esc(ch.title || "YouTube kanalı")}</b><span>${esc([ch.handle, d.connected_at ? `${when(d.connected_at)} bağlandı` : ""].filter(Boolean).join(" · "))}</span></div>
        <span class="yts-ok ${d.needs_reconnect ? "warn" : ""}">${ic(d.needs_reconnect ? "triangle-alert" : "circle-check", 13)}${d.needs_reconnect ? "Yenilenmeli" : "Bağlı"}</span></div>
      ${quotaHtml(X, d)}
      <label class="check yts-opt"><input type="checkbox" id="sYtAuto" ${d.auto !== false ? "checked" : ""}><span>Planlanan Reels videolarını YouTube Shorts olarak da paylaş<small>Önce tek bir videoyla dene; herkese açık yayınlandıysa bunu açman güvenli. Her içeriğin paylaşım bölümünden tek tek de açıp kapatabilirsin.</small></span></label>
      <label for="sYtAhead">YouTube'a ne zaman yüklensin?</label><select id="sYtAhead">${AHEAD.map(([h, t]) => `<option value="${h}" ${+(d.upload_ahead_hours || 168) === h ? "selected" : ""}>${t}</option>`).join("")}${AHEAD.some(([h]) => h === +(d.upload_ahead_hours || 168)) ? "" : `<option value="${+d.upload_ahead_hours}" selected>Yayından ${+d.upload_ahead_hours} saat önce</option>`}</select>
      <div class="sm muted yts-ahead">Video bu süre içinde YouTube'a yüklenir ve YouTube'da saatini bekler; yayın anında bilgisayarın kapalı olabilir, ama bu süre içinde bir kez açık olmalı. Plan sonradan değişirse stüdyo YouTube'daki saati de günceller.</div>
      <label for="sYtCat">Kategori</label><select id="sYtCat">${CATS.map(([k, t]) => `<option value="${k}" ${String(d.category || "22") === k ? "selected" : ""}>${t}</option>`).join("")}${CATS.some(([k]) => k === String(d.category || "22")) ? "" : `<option value="${esc(d.category)}" selected>Kategori ${esc(d.category)}</option>`}</select>
      <label class="check yts-opt"><input type="checkbox" id="sYtSyn" ${d.synthetic ? "checked" : ""}><span>Yapay/gerçekçi değiştirilmiş içerik<small>Videoda gerçek gibi görünen ama yapay olarak üretilmiş ya da değiştirilmiş kişi, yer veya olay varsa aç; YouTube izleyiciye bir etiket gösterir.</small></span></label>
      ${auditHtml(X, d)}
      <div class="row wrap" style="margin-top:12px">${act("sync", "Şimdi eşitle", "refresh-cw")}<span class="grow"></span>${act("disc", "Bağlantıyı kes", "unplug", "ghost")}</div>
      ${L.ask ? `<div class="tr-confirm" style="margin-top:10px">${ic("triangle-alert", 20)}<div class="grow"><b>YouTube bağlantısı kesilsin mi?</b>
        <div class="sm">Yeni yüklemeler durur. YouTube'a önceden yüklenmiş videolar kanalında kalır.</div>
        <label class="check yts-opt"><input type="checkbox" id="sYtRevoke" checked><span>Google hesabındaki izni de geri al</span></label>
        <div class="row" style="gap:6px;margin-top:8px">${act("disc-no", "Vazgeç", "x")}${act("disc-yes", "Bağlantıyı kes", "unplug", "danger")}</div></div></div>` : ""}
      ${eventsHtml(X, d)}`;
  };
  const draw = () => {
    if (!box.isConnected) {
      if (Y.redraw === draw) Y.redraw = null;
      return;
    }
    const keep = $$("input[id]:not([type=checkbox]), textarea[id]", box).map((el) => [el.id, el.value]);
    const fe = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
    const ev = $(".yts-ev", box)?.open;
    const gd = $("details.help", box)?.open;
    box.innerHTML = body();
    for (const [id, val] of keep) {
      const el = $("#" + id, box);
      if (el && val) el.value = val;
    }
    if (ev && $(".yts-ev", box)) $(".yts-ev", box).open = true;
    if (gd && $("details.help", box)) $("details.help", box).open = true;
    if (fe) $("#" + fe, box)?.focus();
    bindInputs();
  };
  const setOpt = async (patch, msg) => {
    const r = await X.api("/api/youtube/settings", patch);
    if (r && typeof r === "object" && "configured" in r) Y.data = r;
    else await load();
    X.toast(msg);
    draw();
    X.refresh();
  };
  const saveClient = async () => {
    const id = $("#sYtId", box);
    const sec = $("#sYtSecret", box);
    const err = $("#sYtErr", box);
    const cid = id.value.replace(/\s+/g, "");
    const cs = sec.value.replace(/\s+/g, "");
    err.textContent = "";
    id.classList.remove("bad");
    sec.classList.remove("bad");
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(cid)) {
      err.textContent = cid ? "Client ID “.apps.googleusercontent.com” ile bitmeli. Tamamını kopyaladığından emin ol." : "Client ID'yi yapıştır.";
      id.classList.add("bad");
      return id.focus();
    }
    if (!cs) {
      err.textContent = "Client secret'ı yapıştır.";
      sec.classList.add("bad");
      return sec.focus();
    }
    try {
      const r = await X.api("/api/youtube/client", { client_id: cid, client_secret: cs });
      if (r && typeof r === "object" && "configured" in r) Y.data = r;
      else await load();
    } catch (e) {
      err.textContent = e.message;
      return;
    }
    id.value = sec.value = "";
    L.edit = false;
    X.toast("YouTube istemcisi kaydedildi; şimdi Google ile bağlan");
    if (!Y.data?.configured) await load();
    draw();
    X.refresh();
  };
  const bindInputs = () => {
    const on = (sel, fn) => {
      const el = $(sel, box);
      if (el) el.onchange = X.guard(async () => fn(el));
    };
    on("#sYtAuto", (el) => setOpt({ auto: el.checked }, el.checked ? "Planlanan Reels videoları YouTube'a da yüklenecek" : "Otomatik YouTube paylaşımı kapatıldı"));
    on("#sYtCat", (el) => setOpt({ category: el.value }, "YouTube kategorisi kaydedildi"));
    on("#sYtAhead", (el) => setOpt({ upload_ahead_hours: +el.value }, `Videolar yayından ${AHEAD.find(([h]) => h === +el.value)?.[1].replace(/ \(.*\)$/, "").toLowerCase() || `${el.value} saat önce`} YouTube'a yüklenecek`));
    on("#sYtSyn", (el) => setOpt({ synthetic: el.checked }, el.checked ? "Videolar yapay içerik olarak işaretlenecek" : "Yapay içerik işareti kapatıldı"));
    on("#sYtAudited", (el) => setOpt({ audited: el.checked }, el.checked ? "Denetim onaylandı olarak işaretlendi" : "Denetim işareti kaldırıldı"));
    for (const sel of ["#sYtId", "#sYtSecret"]) {
      const el = $(sel, box);
      if (el)
        el.onkeydown = (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          X.guard(saveClient)();
        };
    }
    if (!L.kit) return;
    on("#kitBrand", (el) => {
      brandMark(el.checked);
      draw();
    });
    on("#kitSent", async (el) => {
      try {
        setKit(await X.api("/api/youtube/audit-kit", { submitted: el.checked }));
        if (!Y.kit?.answers) await loadKit();
        X.toast(el.checked ? "Başvuru gönderildi olarak işaretlendi" : "Gönderildi işareti kaldırıldı");
      } finally {
        draw();
      }
    });
    for (const [sel, act] of [["#kitName", "kit-site"], ["#kitEmail", "kit-site"], ["#kitProj", "kit-pn"]]) {
      const el = $(sel, box);
      if (el)
        el.onkeydown = (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          $(`[data-yta="${act}"]`, box)?.click();
        };
    }
    for (const det of $$("details[data-k]", box))
      det.ontoggle = () => {
        if (!L.kit) return;
        if (det.open) L.kit.open.add(det.dataset.k);
        else L.kit.open.delete(det.dataset.k);
      };
    shotImgs();
    L.kit.sig = siteSig();
    watchSite();
    if (Y.kit?.shots?.running) pollShots();
  };
  const siteSig = () => JSON.stringify([!!Y.kit?.site?.supported, kitPublished(Y.kit), !!X.S.cloud?.configured]);
  const watchSite = () => {
    clearTimeout(Y.siteTimer);
    if (!L.kit || L.kit.step !== 1 || Y.kit?.site?.supported) return;
    Y.siteTimer = setTimeout(async () => {
      if (!box.isConnected || !L.kit) return;
      if (box.offsetParent) await loadKit();
      if (!box.isConnected || !L.kit) return;
      if (siteSig() !== L.kit.sig) return draw();
      watchSite();
    }, 3000);
  };
  const shotImgs = () => {
    for (const img of $$(".kit-th img", box)) {
      img.onerror = () => img.remove();
      if (img.complete && !img.naturalWidth) img.remove();
    }
  };
  const setKit = (r) => {
    if (r && typeof r === "object" && Array.isArray(r.answers)) Y.kit = r;
  };
  const toTop = () => {
    const sb = box.closest(".st-body");
    if (sb) sb.scrollTop = 0;
  };
  const openKit = async (step) => {
    if (!Y.kit) await loadKit();
    if (!Y.kit || !box.isConnected) return;
    L.kit = { step: step || Y.kitStep || kitFirst(Y.kit, Y.data), open: new Set(), vals: [] };
    draw();
    toTop();
  };
  const pollShots = () => {
    clearTimeout(Y.kitTimer);
    Y.kitTimer = setTimeout(async () => {
      if (!box.isConnected || !L.kit) return;
      await loadKit();
      if (!box.isConnected || !L.kit) return;
      const sh = Y.kit?.shots || {};
      if (sh.running) {
        const el = $("#kitShots", box);
        if (el) {
          el.innerHTML = kitShots(X);
          shotImgs();
        }
        return pollShots();
      }
      draw();
      if (sh.error) X.toast((Y.kit.evidence || []).some((e) => e.ready) ? "Bazı ekran görüntüleri alınamadı" : "Ekran görüntüleri hazırlanamadı", true);
      else X.toast("Ekran görüntüleri hazır");
    }, 1000);
  };
  const publishSite = async (b) => {
    const K = L.kit;
    const name = ($("#kitName", box)?.value || "").trim();
    const email = ($("#kitEmail", box)?.value || "").trim();
    K.siteErr = "";
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      K.siteErr = !name ? "Adını ya da marka adını yaz." : email ? "E-posta adresi eksik ya da hatalı görünüyor." : "E-posta adresini yaz.";
      draw();
      return $(!name ? "#kitName" : "#kitEmail", box)?.focus();
    }
    const err = $("#kitSiteErr", box);
    if (err) err.textContent = "";
    b.innerHTML = `${X.ic("loader-circle", 15, "spin")}Yayınlanıyor…`;
    try {
      await X.api("/api/site", { owner_name: name, email });
    } catch (e) {
      K.siteErr = e.message;
      return draw();
    }
    await loadKit();
    K.open.delete("site");
    X.toast("Sayfaların yayınlandı");
    draw();
  };
  const saveProject = async () => {
    const K = L.kit;
    const raw = ($("#kitProj", box)?.value || "").trim();
    const pn = raw.replace(/[\s-]/g, "");
    K.pnErr = "";
    if (!/^\d{5,24}$/.test(pn)) {
      K.pnErr = raw ? "Proje numarası yalnızca rakamlardan oluşur. Project ID'yi değil, Project number'ı yapıştır." : "Proje numarasını yapıştır.";
      draw();
      return $("#kitProj", box)?.focus();
    }
    try {
      setKit(await X.api("/api/youtube/audit-kit", { project_number: pn }));
    } catch (e) {
      K.pnErr = e.message;
      return draw();
    }
    if (Y.kit?.project_number !== pn) await loadKit();
    K.editPn = false;
    X.toast("Proje numarası kaydedildi");
    draw();
  };
  const kitCopy = async (b) => {
    const v = L.kit?.vals?.[+b.dataset.ci];
    if (v == null) return;
    await copyText(v);
    clearTimeout(b._t);
    b._html ||= b.innerHTML;
    b.classList.add("done");
    b.innerHTML = `${X.ic("check", 13)}<span>Kopyalandı</span>`;
    b._t = setTimeout(() => {
      if (!b.isConnected) return;
      b.classList.remove("done");
      b.innerHTML = b._html;
    }, 1800);
  };
  const kitAction = async (a, b) => {
    if (a === "kit-open") return openKit();
    if (a === "kit-close") {
      L.kit = null;
      clearTimeout(Y.kitTimer);
      clearTimeout(Y.siteTimer);
      draw();
      return $("#sYtAudit", box)?.scrollIntoView({ block: "center" });
    }
    const K = L.kit;
    if (!K) return;
    if (a === "kit-copy") return kitCopy(b);
    if (a === "kit-go") {
      K.step = Y.kitStep = Math.min(5, Math.max(1, +b.dataset.step || 1));
      K.siteErr = K.pnErr = "";
      draw();
      return toTop();
    }
    if (a === "kit-cloud") return $('#stNav [data-st="sCloud"]', m)?.click();
    if (a === "kit-pn-edit" || a === "kit-pn-no") {
      K.editPn = a === "kit-pn-edit";
      K.pnErr = "";
      draw();
      return K.editPn && $("#kitProj", box)?.focus();
    }
    b.disabled = true;
    try {
      if (a === "kit-site") await publishSite(b);
      else if (a === "kit-pn") await saveProject();
      else if (a === "kit-folder") await X.api("/api/youtube/audit-kit/open-folder", {});
      else if (a === "kit-shots") {
        b.innerHTML = `${X.ic("loader-circle", 15, "spin")}Başlatılıyor…`;
        try {
          setKit(await X.api("/api/youtube/audit-kit/screenshots", {}));
        } finally {
          if (!Y.kit?.shots?.running) await loadKit();
          draw();
        }
        if (Y.kit?.shots?.running) pollShots();
      }
    } finally {
      if (b.isConnected) b.disabled = false;
    }
  };
  box.onclick = X.guard(async (e) => {
    const b = e.target.closest("[data-yta]");
    if (!b) return;
    const a = b.dataset.yta;
    if (a.startsWith("kit-")) return kitAction(a, b);
    if (a === "client") return saveClient();
    if (a === "audit-claude") return copyAudit(X);
    if (a === "edit" || a === "edit-no") {
      L.edit = a === "edit";
      draw();
      if (L.edit) $("#sYtId", box)?.focus();
      return;
    }
    if (a === "disc" || a === "disc-no") {
      L.ask = a === "disc";
      return draw();
    }
    if (a === "wait-no") {
      stopWait();
      return draw();
    }
    b.disabled = true;
    try {
      if (a === "connect") await startConnect(X);
      else if (a === "reload") await load();
      else if (a === "sync") {
        const r = await X.api("/api/youtube/sync", {});
        if (r && typeof r === "object" && "configured" in r) Y.data = r;
        else await load();
        X.toast("YouTube durumu eşitlendi");
      } else if (a === "disc-yes") {
        const revoke = !!$("#sYtRevoke", box)?.checked;
        const r = await X.api("/api/youtube/disconnect", { revoke });
        if (r && typeof r === "object" && "configured" in r) Y.data = r;
        else await load();
        L.ask = false;
        stopWait();
        X.toast("YouTube bağlantısı kesildi");
      }
    } finally {
      draw();
      X.refresh();
    }
  });
  Y.redraw = draw;
  const sSave = $("#sSave", m);
  if (sSave)
    sSave.addEventListener("click", () => {
      const id = $("#sYtId", box)?.value.replace(/\s+/g, "");
      const cs = $("#sYtSecret", box)?.value.replace(/\s+/g, "");
      if (id && cs && /\.apps\.googleusercontent\.com$/.test(id))
        X.api("/api/youtube/client", { client_id: id, client_secret: cs }).then(() => X.toast("YouTube istemcisi kaydedildi")).catch((err) => X.toast(err.message, true));
    });
  const jump = () => {
    if (section === "youtube") $("#sYt", m)?.scrollIntoView({ block: "start" });
    if (section === "youtube-audit") ($("#sYtAudit", m) || $("#sYt", m))?.scrollIntoView({ block: "center" });
  };
  jump();
  const nav = $("#stNav", m);
  if (nav)
    nav.addEventListener("click", (e) => {
      if (L.kit && e.target.closest('[data-st="sYt"]')) loadKit().then(draw);
    });
  if (Y.polled && !X.S.youtube) {
    Y.missing = true;
    Y.data = null;
    draw();
    return;
  }
  load().then(async () => {
    const kitP = Y.data?.connected ? loadKit() : null;
    if (section === "youtube-kit" && kitP) {
      await kitP;
      if (Y.kit) return openKit();
    }
    draw();
    jump();
    if (section?.startsWith?.("youtube")) setTimeout(jump, 700);
    kitP?.then(() => !L.kit && draw());
  });
}
