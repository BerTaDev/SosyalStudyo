import { claudeSetupBtn } from "/web/claudesetup.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const STUDIO = "https://www.tiktok.com/tiktokstudio/content";
const PIP = "python -m pip install playwright";
const VIS = ["Herkes", "Arkadaşlar"];
const EV_IC = { error: ["triangle-alert", "bad"], warn: ["triangle-alert", "warn"], ok: ["circle-check", "ok"], published: ["circle-check", "ok"], uploaded: ["calendar-check", "blue"], scheduled: ["calendar-check", "blue"], upload: ["upload", "blue"], login: ["key-round", "blue"], captcha: ["shield-alert", "warn"], info: ["info", ""] };
const JOB = { queued: ["hourglass", "Sırada", "q"], uploading: ["loader-circle", "Yükleniyor", "up"], scheduled: ["calendar-check", "Planlandı", "sch"], published: ["circle-check", "Yayın saati geldi", "ok"], error: ["triangle-alert", "Hata", "bad"] };

const T = { data: null, err: null, missing: false, loading: null, tried: false, wired: false, chipSig: null, sumSig: null, cardBusy: false, timer: null };

const p2 = (n) => String(n).padStart(2, "0");
const hm = (t) => `${p2(t.getHours())}:${p2(t.getMinutes())}`;
const brName = (b) => (b === "chrome" ? "Chrome" : "Edge");

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

function load() {
  if (!T.loading)
    T.loading = fetch("/api/tiktok", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) {
          T.missing = true;
          T.data = null;
          T.err = null;
          return;
        }
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || typeof d !== "object") throw new Error(d?.error || `HTTP ${r.status}`);
        T.missing = false;
        T.data = d;
        T.err = null;
      })
      .catch((e) => {
        T.err = e.message;
      })
      .finally(() => {
        T.loading = null;
      });
  return T.loading;
}

async function post(X, path, body = {}) {
  const r = await X.api(path, body);
  if (r && typeof r === "object" && "logged_in" in r) {
    T.data = r;
    T.missing = false;
    T.err = null;
  } else await load();
  return T.data;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {}
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.append(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    ta.remove();
  }
}

function wire(X) {
  if (T.wired) return;
  T.wired = true;
  const chip = $("#ttChip");
  if (chip) chip.onclick = () => X.openSettings("tiktok");
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tt]");
    if (!b) return;
    e.preventDefault();
    const a = b.dataset.tt;
    const pid = b.dataset.pid;
    if (a === "settings") return X.openSettings("tiktok");
    if (a !== "now" || !pid || b.disabled) return;
    X.guard(async () => {
      b.disabled = true;
      try {
        const det = await X.api(`/api/posts/${pid}/tiktok/now`, {});
        applyDetail(X, pid, det);
        X.toast("TikTok'a yükleme yeniden denenecek");
        await X.refresh();
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    })();
  });
}

// ---------- marks ----------

export const TT_STUDIO = STUDIO;

export const ttOn = (p) => !!p?.tiktok && typeof p.tiktok === "object" && p.tiktok.enabled !== false;

export function ttState(S, p) {
  const t = p?.tiktok;
  if (!t || typeof t !== "object") return null;
  const st = t.state;
  if (st === "uploading") return { cls: "up", label: "TikTok'a yükleniyor" };
  if (st === "scheduled" && t.code === "changed") return { cls: "wait", label: t.enabled === false ? "TikTok'ta hâlâ planlı · TikTok Studio'dan sil" : "Saat/açıklama değişti · TikTok Studio'dan güncelle" };
  if (st === "scheduled") {
    const at = when(t.at || p.schedule);
    return { cls: "sch", label: `TikTok'ta planlandı${at ? ` · ${at}` : ""}` };
  }
  if (st === "published") return { cls: "ok", label: "TikTok'ta yayın saati geldi" };
  if (t.enabled === false) return null;
  if (st === "error") {
    const msg = t.error || t.note || "";
    const why = t.code === "captcha" ? "TikTok güvenlik doğrulaması istedi" : t.code === "login" ? "TikTok oturumu kapanmış" : t.code === "late" ? "TikTok · paylaşım saati geçti" : "TikTok hatası";
    return { cls: "bad", label: `${why}${msg ? `: ${msg}` : ""}` };
  }
  if (st === "queued") {
    const ahead = +(T.data?.ahead_days ?? 7) || 7;
    const start = (Date.parse(p.schedule || t.at || "") || 0) - ahead * 864e5;
    const sub = t.code === "wait" && start > Date.now() ? `${when(new Date(start).toISOString())} civarı planlanacak` : t.code === "wait" && t.note ? t.note : "birazdan planlanacak";
    return { cls: "q", label: `TikTok için sırada · ${sub}` };
  }
  if (p.status === "planlandi") return { cls: "q", label: "TikTok için sıraya alınıyor" };
  return null;
}

export function ttMark(X, p, size = 12) {
  const s = ttState(X.S, p);
  return s ? `<span class="ttmark ${s.cls}" title="${X.esc(s.label)}">${X.ic("music", size)}</span>` : "";
}

export function confirmTtOff(X, p, go) {
  const t = p?.tiktok;
  if (t?.state !== "scheduled") return go();
  const w = when(t.at || p.schedule);
  X.confirm("TikTok kapatılsın mı?", `Bu video TikTok'ta${w ? ` <b>${X.esc(w)}</b> için` : ""} planlı. Kapatırsan TikTok'taki plan kendiliğinden silinmez; silmek için <a href="${STUDIO}" target="_blank" rel="noopener">TikTok Studio</a>'yu kullan.`, "Kapat", go);
}

// ---------- top-bar chip ----------

export function renderTtChip(X, b) {
  const has = !!b && typeof b === "object";
  X.S.tiktok = has ? b : null;
  wire(X);
  try {
    syncCard(X);
  } catch {}
  const el = $("#ttChip");
  if (!el) return;
  const sig = JSON.stringify(X.S.tiktok);
  if (T.chipSig === sig) return;
  T.chipSig = sig;
  if (!has || !b.available) {
    el.className = "chip tk-chip hidden";
    el.innerHTML = "";
    return;
  }
  const li = b.logged_in;
  let cls = li === true ? "ok" : li === false && b.auto ? "warn" : "";
  let tail = "";
  const lines = [li === true ? "TikTok · giriş yapıldı" : li === false ? "TikTok · giriş yapılmadı, giriş için tıkla" : "TikTok · oturum henüz kontrol edilmedi"];
  if (li === true) lines.push(b.auto ? "Planlanan Reels videoları TikTok'ta da planlanır" : "Otomatik TikTok planlaması kapalı");
  if (b.uploading) {
    cls += " up";
    tail += `<b class="tk-n" title="Yükleniyor">${+b.uploading}</b>`;
    lines.push(`${+b.uploading} video TikTok'a yükleniyor`);
  }
  if (b.queued) lines.push(`${+b.queued} video TikTok için sırada`);
  if (b.errors) {
    cls = `${cls.replace(/\b(ok|warn)\b/g, "")} bad`;
    tail += `<b class="tk-n bad" title="Hata">${+b.errors}</b>`;
    lines.push(`${+b.errors} videoda TikTok hatası`);
  }
  el.className = `chip tk-chip ${cls.trim()}`.trim();
  el.innerHTML = `${X.ic("music", 15)}${tail}${li === true ? `<span class="dot"></span>` : ""}`;
  el.title = lines.join("\n");
}

export function ttTabSub(S) {
  const b = S?.tiktok;
  if (!b) return "Hazırlanıyor";
  if (!b.available) return "Kurulum gerekli";
  return b.logged_in === true ? "Giriş yapıldı" : b.logged_in === false ? "Giriş yapılmadı" : "Kontrol edilmedi";
}

// ---------- publish pane card ----------

function applyDetail(X, pid, det) {
  const d = X.S.detail;
  if (!d || d.id !== pid || !det || typeof det !== "object" || det.id !== pid) return;
  d.tiktok = det.tiktok ?? null;
  drawCard(X, d);
}

function cardSig(X, d) {
  const b = X.S.tiktok;
  return JSON.stringify([b?.available, b?.logged_in, d.status, d.schedule, d.tiktok ?? null, T.data?.ahead_days]);
}

function drawCard(X, d) {
  const w = d && $(`.tkw[data-tkw="${d.id}"]`);
  if (!w) return;
  const sig = cardSig(X, d);
  if (w.getAttribute("data-sig") === sig) return;
  w.setAttribute("data-sig", sig);
  w.innerHTML = cardInner(X, d);
  bindTtCard(X, d);
}

function syncCard(X) {
  const b = X.S.tiktok;
  const sig = JSON.stringify(b ? [b.available, b.logged_in, b.uploading, b.queued, b.errors] : null);
  const changed = T.sumSig !== null && T.sumSig !== sig;
  T.sumSig = sig;
  const d = X.S.detail;
  if (!d) return;
  drawCard(X, d);
  if (!changed || T.cardBusy || !$(`.tkw[data-tkw="${d.id}"]`)) return;
  T.cardBusy = true;
  X.api(`/api/posts/${d.id}`)
    .then((det) => applyDetail(X, d.id, det))
    .catch(() => {})
    .finally(() => (T.cardBusy = false));
}

function statusHtml(X, d, t) {
  const { ic, esc } = X;
  const line = (cls, icon, title, sub = "", act = "", spin = false, below = false) =>
    `<div class="ytc-line ${cls}"><span class="ytc-ic">${ic(icon, 15, spin ? "spin" : "")}</span><div class="grow"><b>${title}</b>${sub ? `<span>${sub}</span>` : ""}${act && below ? `<div class="ytc-act below">${act}</div>` : ""}</div>${act && !below ? `<div class="ytc-act">${act}</div>` : ""}</div>`;
  const btn = (a, label, icon, cls = "") => `<button type="button" class="btn sm ${cls}" data-tt="${a}" data-pid="${esc(d.id)}">${ic(icon, 13)}${label}</button>`;
  const studio = `<a class="btn sm" href="${STUDIO}" target="_blank" rel="noopener">${ic("external-link", 13)}TikTok Studio</a>`;
  const st = t.state;
  const at = t.at || d.schedule;
  if (st === "uploading") return line("up", "loader-circle", "TikTok'a yükleniyor…", esc(t.note && !/^TikTok'a yükleniyor$/i.test(t.note) ? t.note : "Video TikTok Studio'ya yüklenip planlanıyor; birkaç dakika sürebilir."), "", true);
  if (st === "scheduled" && t.code === "changed")
    return t.enabled === false
      ? line("warn", "triangle-alert", "TikTok'ta hâlâ planlı", `Bu içerikte TikTok'u kapattın, ama TikTok'taki plan${at ? ` (${esc(when(at))})` : ""} kendiliğinden silinmez. TikTok Studio'dan sil.`, studio, false, true)
      : line("warn", "pencil", "Saat/açıklama değişti; TikTok Studio'dan güncelle", `TikTok'taki plan${at ? ` (${esc(when(at))})` : ""} kendiliğinden değişmez. Yeni saati ve açıklamayı TikTok Studio'da elle düzelt.`, studio, false, true);
  if (st === "scheduled") return line("sch", "calendar-check", `TikTok'ta planlandı${when(at) ? ` · ${esc(when(at))}` : ""}`,"Saati gelince TikTok kendisi yayınlar; bilgisayarın kapalı olabilir.", studio);
  if (st === "published") return line("ok", "circle-check", "TikTok'ta yayın saati geldi", `${at ? `${esc(when(at))} · ` : ""}Videoyu TikTok Studio'dan kontrol edebilirsin.`, studio);
  if (st === "error") {
    const login = t.code === "login" || t.code === "captcha";
    const title = t.code === "captcha" ? "TikTok güvenlik doğrulaması istedi" : t.code === "login" ? "TikTok oturumu kapanmış" : t.code === "late" ? "Paylaşım saati geçti" : "TikTok'a yüklenemedi";
    const msg = esc(t.error || t.note || "Bilinmeyen hata");
    if (login) return line("bad", "triangle-alert", title, `${msg}${/[.!?…]$/.test(msg) ? "" : "."} Ayarlar › TikTok'tan yeniden giriş yapınca kendiliğinden tekrar denenir.`, btn("settings", "Giriş yap", "key-round"), false, true);
    if (t.code === "late") return line("bad", "clock", title, msg);
    return line("bad", "triangle-alert", title, msg, btn("now", "Tekrar dene", "refresh-cw"));
  }
  if (t.enabled === false) return line("off", "eye-off", "TikTok'ta planlanmayacak", "Açarsan aynı saatte TikTok'ta da yayınlanır.");
  if (st === "queued") {
    const ahead = +(T.data?.ahead_days ?? 7) || 7;
    const ts = Date.parse(d.schedule || at || "");
    const start = ts ? ts - ahead * 864e5 : 0;
    const sub = t.code === "wait" && start > Date.now() ? `${when(new Date(start).toISOString())} civarı TikTok'ta planlanacak (yayından ${ahead} gün önce).` : t.code === "wait" && t.note ? `${t.note}.` : "Birazdan TikTok'a yüklenip planlanacak.";
    return line("q", "hourglass", "Sırada", esc(sub));
  }
  if (d.status === "planlandi") return line("q", "loader-circle", "TikTok için sıraya alınıyor…", "", "", true);
  return line("idle", "calendar-clock", "Planlayınca TikTok'ta da planlanır", "Seçtiğin saatte TikTok'ta da yayınlanır.");
}

export function ttCardHtml(X, d) {
  try {
    wire(X);
    if (!d || (d.kind || "reels") !== "reels") return "";
    return `<div class="tkw" data-tkw="${X.esc(d.id)}" data-sig="${X.esc(cardSig(X, d))}">${cardInner(X, d)}</div>`;
  } catch {
    return "";
  }
}

function cardInner(X, d) {
  const { S, ic, esc } = X;
  const b = S.tiktok;
  const t = d.tiktok && typeof d.tiktok === "object" ? d.tiktok : null;
  const published = d.status === "paylasildi";
  if (!t) {
    if (!b || published || (b.available && b.logged_in === true)) return "";
    return `<div class="ytc-hint tkc-hint">${ic("music", 15)}<span>Aynı videoyu TikTok'ta da planlamak için <a href="#" data-tt="settings">Ayarlar › TikTok</a>'tan ${b.available ? "giriş yap" : "kurulumu tamamla"}.</span></div>`;
  }
  const st = t.state;
  if (published && !st) return "";
  if (!T.data && !T.tried) {
    T.tried = true;
    load().then(() => {
      try {
        drawCard(X, X.S.detail);
      } catch {}
    });
  }
  const live = st === "scheduled" || st === "uploading" || st === "published";
  const off = t.enabled === false && !live;
  const canToggle = !published && st !== "uploading" && st !== "published";
  const vis = t.visibility || T.data?.visibility || "Herkes";
  return `<div class="tkc ${off ? "off" : ""}" data-tkc="${esc(d.id)}">
    <div class="tkc-head"><span class="tkc-logo">${ic("music", 17)}</span><div class="grow"><b>TikTok</b><span>Görünürlük: ${esc(vis)}</span></div>
      ${canToggle ? `<label class="switch" title="${t.enabled !== false ? "Bu videoyu TikTok'ta planlama" : "Bu videoyu TikTok'ta da planla"}"><input type="checkbox" id="tkOn" ${t.enabled !== false ? "checked" : ""}><span></span></label>` : ""}</div>
    <div class="tkc-st">${statusHtml(X, d, t)}</div>
  </div>`;
}

export function bindTtCard(X, d) {
  try {
    const card = d && $(`.tkc[data-tkc="${d.id}"]`);
    const on = card && $("#tkOn", card);
    if (!on) return;
    const t = d.tiktok || {};
    on.onchange = () => {
      const want = on.checked;
      const send = X.guard(async () => {
        on.disabled = true;
        try {
          const det = await X.api(`/api/posts/${d.id}/tiktok`, { enabled: want });
          applyDetail(X, d.id, det);
          X.toast(want ? "Bu video TikTok'ta da planlanacak" : "Bu video TikTok'ta planlanmayacak");
          await X.refresh();
          document.dispatchEvent(new CustomEvent("tkchange", { detail: { pid: d.id, enabled: want, det } }));
        } finally {
          if (on.isConnected) on.disabled = false;
        }
      });
      if (!want && t.state === "scheduled") {
        on.checked = true;
        return confirmTtOff(X, d, send);
      }
      send();
    };
  } catch {}
}

// ---------- settings ----------

function eventsHtml(X, d, open) {
  const { ic, esc } = X;
  const ev = (Array.isArray(d.events) ? d.events : []).slice(0, 10);
  if (!ev.length) return "";
  return `<details class="yts-ev tks-ev" data-k="ev" ${open ? "open" : ""}><summary>Son TikTok işlemleri</summary><ul>${ev.map((e) => {
    const [icon, cls] = EV_IC[e.kind] || ["music", ""];
    return `<li class="${cls}">${ic(icon, 13)}<span class="grow">${esc(e.text)}</span><span class="sm muted">${esc(when(e.at))}</span></li>`;
  }).join("")}</ul></details>`;
}

function jobsHtml(X, d) {
  const { ic, esc } = X;
  const jobs = (Array.isArray(d.jobs) ? d.jobs : []).slice(0, 8);
  if (!jobs.length) return "";
  return `<div class="tks-jobs"><div class="tks-jh">TikTok planları</div>${jobs.map((j) => {
    const changed = j.code === "changed" && j.state === "scheduled";
    const [icon, label, cls] = changed ? ["pencil", "Stüdyoda değişti · TikTok Studio'dan güncelle", "warn"] : JOB[j.state] || ["music", "", ""];
    const sub = j.state === "error" ? j.error || j.note || label : [label, j.at ? when(j.at) : ""].filter(Boolean).join(" · ");
    const th = typeof j.thumb === "string" && /^(\/|https?:)/.test(j.thumb) ? j.thumb.replace(/['"()\\]/g, "") : "";
    return `<button type="button" class="tks-job ${cls}" data-tta="open" data-pid="${esc(j.pid)}" title="İçeriği aç"><span class="tks-th" ${th ? `style="background-image:url('${th}')"` : ""}>${th ? "" : ic("film", 14)}</span><span class="grow"><b>${esc(j.title || j.pid)}</b><small>${esc(sub)}</small></span><span class="tks-js">${ic(icon, 14, j.state === "uploading" ? "spin" : "")}</span></button>`;
  }).join("")}</div>`;
}

function riskHtml(X, open) {
  const { ic } = X;
  return `<details class="help tks-risk" data-k="risk" ${open ? "open" : ""}><summary><b>Bilmen gerekenler</b> <span class="sm muted">· riskler ve sınırlar</span></summary>
    <ul class="tks-list">
      <li>${ic("shield-alert", 13)}<span>TikTok'un kullanım şartları otomatik kullanıma izin vermiyor; küçük de olsa hesabın kısıtlanma riski var.</span></li>
      <li>${ic("lock", 13)}<span>TikTok güvenlik doğrulaması (captcha) gösterirse stüdyo durur ve senden yeniden giriş yapmanı ister.</span></li>
      <li>${ic("pencil", 13)}<span>Video TikTok'ta planlandıktan sonra stüdyoda saatini ya da açıklamasını değiştirirsen TikTok'taki plan kendiliğinden değişmez; <a href="${STUDIO}" target="_blank" rel="noopener">TikTok Studio</a>'dan güncellemen gerekir.</span></li>
      <li>${ic("key-round", 13)}<span>Şifren stüdyoya yazılmaz; oturum yalnızca bu bilgisayardaki ayrı bir tarayıcı profilinde saklanır.</span></li>
    </ul></details>`;
}

export function ttSettingsHtml(X) {
  return `<fieldset id="sTt"><legend>TikTok</legend><div id="sTtBody" class="tks"><div class="sm muted" style="margin-top:10px">${X.ic("loader-circle", 13, "spin")} Durum alınıyor…</div></div></fieldset>`;
}

export function bindTtSettings(X, m, section) {
  const box = $("#sTtBody", m);
  if (!box) return;
  const { ic, esc } = X;
  const L = { ev: true, risk: false, login: null };
  const act = (a, label, icon, cls = "", dis = false) => `<button type="button" class="btn sm ${cls}" data-tta="${a}" ${dis ? "disabled" : ""}>${ic(icon, 13)}${label}</button>`;
  const body = () => {
    if (T.missing)
      return `<div class="yts-note">${ic("info", 16)}<div class="grow"><b>TikTok desteği yükleniyor</b><span>Stüdyo güncellenip yeniden başlatılınca TikTok ayarları burada görünür.</span></div>${act("reload", "Tekrar dene", "refresh-cw")}</div>`;
    const d = T.data;
    if (!d) return `<div class="yts-note bad">${ic("triangle-alert", 16)}<div class="grow"><b>TikTok bilgisi alınamadı</b><span>${esc(T.err || "")}</span></div>${act("reload", "Tekrar dene", "refresh-cw")}</div>`;
    const ahead = +d.ahead_days || 7;
    const lead = `<div class="yts-lead">Planlanan Reels videoların aynı saatte TikTok'ta da yayınlansın. Stüdyo videoyu yayın saatinden en fazla <b>${ahead} gün önce</b> TikTok Studio'ya yükler ve TikTok'un kendi planlayıcısıyla planlar; saati gelince TikTok kendisi yayınlar, yayın anında bilgisayarın kapalı olabilir. Saate 20 dakikadan az kaldıysa video hemen paylaşılır.</div>`;
    if (!d.available)
      return `${lead}
        <div class="yts-warn">${ic("triangle-alert", 18)}<div class="grow"><b>Bir kez kurulum gerekli</b><span>TikTok Studio'yu görünmez bir tarayıcıda açmak için gereken Playwright paketi${d.browser ? "" : " ya da uygun bir tarayıcı"} bu bilgisayarda bulunamadı.</span></div></div>
        <ol class="yts-steps">
          <li><div><b>Paketi kur.</b> Komut istemini aç ve şunu çalıştır:<div class="tks-cmd"><code>${PIP}</code>${act("copy", "Kopyala", "copy")}</div></div></li>
          <li><div><b>Tarayıcı:</b> Microsoft Edge ya da Google Chrome kurulu olmalı. Windows'ta Edge zaten yüklü gelir.</div></li>
          <li><div><b>Stüdyoyu yeniden başlat,</b> sonra aşağıdan tekrar kontrol et.</div></li>
        </ol>
        <div class="row wrap" style="margin-top:10px">${act("reload", "Tekrar kontrol et", "refresh-cw")}${claudeSetupBtn("tiktok")}</div>
        ${riskHtml(X, L.risk)}${eventsHtml(X, d, L.ev)}`;
    const br = brName(d.browser);
    const li = d.logged_in;
    const sub = li === true ? [`${br} ile giriş yapıldı`, d.checked_at ? `${when(d.checked_at)} kontrol edildi` : ""].filter(Boolean).join(" · ") : li === false ? "Giriş yapılmadı ya da oturum kapandı" : "Oturum henüz kontrol edilmedi";
    const badge = li === true ? ["", "circle-check", "Bağlı"] : li === false ? ["warn", "triangle-alert", "Giriş yok"] : ["off", "circle-dashed", "Bilinmiyor"];
    const wait = d.login_running
      ? `<div class="yts-wait">${ic("loader-circle", 18, "spin")}<div class="grow"><b>Açılan ${br} penceresinde giriş yap, bitince pencereyi kapat</b><span>Telefon, e-posta ya da Google gibi istediğin yöntemle giriş yapabilirsin. Pencereyi kapatınca stüdyo oturumu kendiliğinden kontrol eder.</span></div></div>`
      : L.login
        ? `<div class="yts-wait">${ic("loader-circle", 18, "spin")}<div class="grow"><b>Oturum kontrol ediliyor…</b><span>Bu birkaç saniye sürebilir.</span></div></div>`
        : "";
    const busy = d.busy && !d.login_running && !L.login ? `<span class="sm muted tks-busy">${ic("loader-circle", 13, "spin")} TikTok'ta bir işlem sürüyor…</span>` : "";
    return `${lead}
      <div class="yts-ch tks-acc"><span class="tks-av">${ic("music", 20)}</span>
        <div class="grow"><b>TikTok hesabı</b><span>${esc(sub)}</span></div>
        <span class="yts-ok ${badge[0]}">${ic(badge[1], 13)}${badge[2]}</span></div>
      ${wait}
      <div class="row wrap tks-btns">${act("login", "TikTok'a giriş yap", "key-round", li === true ? "" : "primary", d.login_running || !!L.login)}${act("check", "Bağlantıyı kontrol et", "refresh-cw", "", d.login_running || !!L.login || d.busy)}${li === true ? "" : claudeSetupBtn("tiktok", "Claude ile kur", "ghost")}${busy}</div>
      <label class="check yts-opt"><input type="checkbox" id="sTtAuto" ${d.auto ? "checked" : ""}><span>Planlanan Reels videolarını TikTok'ta da planla<small>Her içeriğin paylaşım bölümünden tek tek de açıp kapatabilirsin. Önce tek bir videoyla denemen önerilir.</small></span></label>
      <label for="sTtVis">TikTok'ta kimler görebilsin?</label>
      <select id="sTtVis">${VIS.map((v) => `<option value="${v}" ${(d.visibility || "Herkes") === v ? "selected" : ""}>${v}</option>`).join("")}</select>
      <div class="sm muted tks-hint">TikTok, “Sadece siz” görünürlüğüyle planlamaya izin vermiyor.</div>
      ${jobsHtml(X, d)}
      ${riskHtml(X, L.risk)}
      ${eventsHtml(X, d, L.ev)}`;
  };
  const draw = () => {
    if (!box.isConnected) return;
    const fe = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
    box.innerHTML = body();
    bindInputs();
    if (fe) $("#" + fe, box)?.focus();
    tick();
  };
  const finishLogin = () => {
    const ok = T.data?.logged_in === true;
    L.login = null;
    X.toast(ok ? "TikTok'a giriş yapıldı" : "TikTok girişi algılanmadı; tekrar dene", !ok);
    X.refresh();
  };
  const tick = () => {
    clearTimeout(T.timer);
    const d = T.data;
    if (!d || (!d.login_running && !d.busy && !L.login)) return;
    T.timer = setTimeout(async () => {
      if (!box.isConnected) return;
      const before = JSON.stringify(T.data);
      await load();
      if (!box.isConnected) return;
      const n = T.data;
      if (L.login && n && !n.login_running) {
        L.login.until ||= Date.now() + 60000;
        if ((n.checked_at && n.checked_at !== L.login.from) || Date.now() > L.login.until) {
          finishLogin();
          return draw();
        }
      }
      if (JSON.stringify(T.data) !== before) draw();
      else tick();
    }, d.login_running ? 3000 : 4000);
  };
  const bindInputs = () => {
    const on = (sel, fn) => {
      const el = $(sel, box);
      if (el)
        el.onchange = X.guard(async () => {
          try {
            await fn(el);
          } finally {
            draw();
          }
        });
    };
    on("#sTtAuto", async (el) => {
      await post(X, "/api/tiktok/settings", { auto: el.checked });
      X.toast(el.checked ? "Planlanan Reels videoları TikTok'ta da planlanacak" : "Otomatik TikTok planlaması kapatıldı");
      X.refresh();
    });
    on("#sTtVis", async (el) => {
      await post(X, "/api/tiktok/settings", { visibility: el.value });
      X.toast(`TikTok görünürlüğü: ${el.value}`);
      X.refresh();
    });
    for (const det of $$("details[data-k]", box)) det.ontoggle = () => (L[det.dataset.k] = det.open);
  };
  box.onclick = X.guard(async (e) => {
    const b = e.target.closest("[data-tta]");
    if (!b || b.disabled) return;
    const a = b.dataset.tta;
    if (a === "copy") {
      await copyText(PIP);
      return X.toast("Komut kopyalandı");
    }
    if (a === "open") {
      const pid = b.dataset.pid;
      X.closeModal();
      if (X.S.tab !== "posts") X.setTab("posts");
      return X.select(pid);
    }
    b.disabled = true;
    try {
      if (a === "reload") await load();
      else if (a === "login") {
        b.innerHTML = `${ic("loader-circle", 13, "spin")}Açılıyor…`;
        const from = T.data?.checked_at || null;
        const r = await post(X, "/api/tiktok/login", {});
        if (r?.login_running) L.login = { from, until: 0 };
      } else if (a === "check") {
        b.innerHTML = `${ic("loader-circle", 13, "spin")}Kontrol ediliyor…`;
        const r = await post(X, "/api/tiktok/check", {});
        const li = r?.logged_in;
        X.toast(li === true ? "TikTok oturumu açık" : li === false ? "TikTok oturumu yok; giriş yap" : "TikTok oturumu kontrol edilemedi", li !== true);
      }
    } finally {
      draw();
      if (a !== "reload") X.refresh();
    }
  });
  if (T.data || T.missing) draw();
  load().then(() => {
    if (T.data?.login_running && !L.login) L.login = { from: T.data.checked_at || null, until: 0 };
    draw();
    if (section === "tiktok") $("#sTt", m)?.scrollIntoView({ block: "start" });
  });
}
