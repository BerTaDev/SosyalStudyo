import { ytMark } from "/web/youtube.js";
import { ttMark, ttState, ttOn, confirmTtOff } from "/web/tiktok.js";

const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const PLATFORMS = [
  { id: "instagram", name: "Instagram", icon: "instagram" },
  { id: "youtube", name: "YouTube", icon: "youtube" },
];

const T = { X: null, wired: false };

export const targetsReady = (S) => !!S?.settings?.default_targets;

export function defaultTargets(S) {
  const d = S?.settings?.default_targets;
  const yt = S?.youtube?.connected ? (d ? !!d.youtube : S.settings?.youtube?.auto !== false) : null;
  return { instagram: d ? d.instagram !== false : true, youtube: yt };
}

export function postTargets(S, p) {
  if (p?.targets) return { instagram: p.targets.instagram !== false, youtube: p.targets.youtube ?? null };
  return { instagram: true, youtube: p?.youtube && typeof p.youtube === "object" && S?.youtube?.connected ? p.youtube.enabled !== false : null };
}

export function targetsText(t, p) {
  const names = PLATFORMS.filter((pl) => t?.[pl.id]).map((pl) => pl.name);
  if (ttOn(p)) names.push("TikTok");
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ve ${names[names.length - 1]}` : names[0] || "";
}

function avail(S, id, kind) {
  if (id === "youtube") {
    if ((kind || "reels") !== "reels") return { na: "YouTube'a yalnızca Reels videoları gönderilir" };
    if (!S?.youtube?.connected) return { na: "YouTube bağlı değil · Ayarlar'dan bağla" };
    if (S.youtube.needs_reconnect) return { warn: "YouTube bağlantısı yenilenmeli (Ayarlar > YouTube)" };
    if (S.youtube.audited === false) return { warn: "Denetimsiz projelerde YouTube videoları gizli kalabilir; ilk videonu kontrol et" };
  }
  if (id === "instagram") {
    const ig = S?.settings?.instagram || {};
    if (!(ig.has_token && ig.username)) return { warn: "Instagram bağlı değil · Ayarlar'dan bağla" };
  }
  return {};
}

function chipTitle(pl, on, st) {
  if (st.na) return st.na;
  return `${pl.name} · ${on ? "paylaşılacak (kapatmak için tıkla)" : "paylaşılmayacak (açmak için tıkla)"}${st.warn ? `\n${st.warn}` : ""}`;
}

function chipHtml(X, pl, on, st, mini) {
  return `<button type="button" class="tgt-c p-${pl.id}${on ? " on" : ""}${st.na ? " na" : ""}${st.warn ? " warn" : ""}" data-tg="${pl.id}" aria-pressed="${on}"${st.na ? ' aria-disabled="true"' : ""} title="${X.esc(chipTitle(pl, on, st))}" data-tip="${X.esc(st.warn || "")}">${X.ic(pl.icon, mini ? 13 : 14)}${mini ? "" : `<span>${pl.name}</span>`}<i class="tgt-ck">${X.ic(on ? "check" : "plus", 10)}</i></button>`;
}

function tkLock(p) {
  const st = p?.tiktok?.state;
  if (st === "uploading") return "TikTok'a yükleniyor; bitince değiştirebilirsin";
  if (st === "published") return "TikTok'ta yayın saati geldi; artık değiştirilemez";
  if (p?.status === "paylasildi" || p?.status === "paylasiliyor") return "Paylaşılan içerikte TikTok değiştirilemez";
  return "";
}

function tkTitle(on, lock, state) {
  if (lock) return `TikTok · ${lock}`;
  return `TikTok · ${on ? "paylaşılacak (kapatmak için tıkla)" : "paylaşılmayacak (açmak için tıkla)"}${state ? `\n${state}` : ""}`;
}

function tkChipHtml(X, p, mini) {
  try {
    if (!p?.tiktok || typeof p.tiktok !== "object") return "";
    const on = ttOn(p);
    const lock = tkLock(p);
    const s = ttState(X.S, p);
    const warn = s && (s.cls === "bad" || s.cls === "wait") ? s.label : "";
    return `<button type="button" class="tgt-c p-tiktok${on ? " on" : ""}${lock ? " lock" : ""}${warn ? " warn" : ""}" data-tk="${X.esc(p.id)}" aria-pressed="${on}"${lock ? ' aria-disabled="true"' : ""} title="${X.esc(tkTitle(on, lock, s?.label))}">${X.ic("music", mini ? 13 : 14)}${mini ? "" : "<span>TikTok</span>"}<i class="tgt-ck">${X.ic(on ? "check" : "plus", 10)}</i></button>`;
  } catch {
    return "";
  }
}

function setTk(b, on) {
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", String(on));
  b.title = tkTitle(on, "", "");
  const ck = b.querySelector(".tgt-ck");
  if (ck && T.X) ck.innerHTML = T.X.ic(on ? "check" : "plus", 10);
}

function tkClick(X, b) {
  const row = b.closest("[data-tgt]");
  if (row?.classList.contains("busy")) return;
  const pid = b.dataset.tk;
  const p = [(X.S.posts || []).find((x) => x.id === pid), X.S.detail?.id === pid ? X.S.detail : null].find((x) => x?.tiktok && typeof x.tiktok === "object");
  if (!p) return;
  const lock = tkLock(p);
  if (lock) {
    shake(b);
    return X.toast(lock, true);
  }
  const want = !b.classList.contains("on");
  const go = X.guard(async () => {
    setTk(b, want);
    row?.classList.add("busy");
    let det;
    try {
      det = await X.api(`/api/posts/${pid}/tiktok`, { enabled: want });
    } catch (err) {
      setTk(b, !want);
      throw err;
    } finally {
      row?.classList.remove("busy");
    }
    if (X.S.detail?.id === pid && det && typeof det === "object" && det.id === pid) X.S.detail = det;
    X.toast(want ? "Bu video TikTok'ta da planlanacak" : "Bu video TikTok'ta planlanmayacak");
    await X.refresh();
    (b.isConnected ? b : document).dispatchEvent(new CustomEvent("tkchange", { bubbles: true, detail: { pid, enabled: want, det } }));
  });
  if (!want) return confirmTtOff(X, p, go);
  go();
}

export function targetsHtml(X, value, opts = {}) {
  wire(X);
  const v = value || defaultTargets(X.S);
  const kind = opts.kind || "reels";
  const chips = PLATFORMS.map((pl) => {
    const st = avail(X.S, pl.id, kind);
    return chipHtml(X, pl, !st.na && !!v[pl.id], st, opts.mini);
  }).join("") + (opts.post ? tkChipHtml(X, opts.post, opts.mini) : "");
  const label = opts.mini || opts.label === false ? "" : `<span class="tgt-l">${X.ic("send", 13)}${X.esc(opts.label || "Şurada paylaş")}</span>`;
  return `<div class="tgt${opts.mini ? " mini" : ""}${opts.cls ? ` ${opts.cls}` : ""}" data-tgt${opts.id ? ` id="${opts.id}"` : ""} data-kind="${X.esc(kind)}"${opts.attrs ? ` ${opts.attrs}` : ""}>${label}${chips}</div>`;
}

export function readTargets(root) {
  const row = root?.matches?.("[data-tgt]") ? root : root?.querySelector?.("[data-tgt]");
  if (!row) return null;
  const out = {};
  for (const b of $$("[data-tg]", row)) out[b.dataset.tg] = b.classList.contains("na") ? null : b.classList.contains("on");
  return out;
}

function setChip(b, on) {
  const pl = PLATFORMS.find((x) => x.id === b.dataset.tg);
  b.classList.toggle("on", on);
  b.setAttribute("aria-pressed", String(on));
  if (pl) b.title = chipTitle(pl, on, { warn: b.dataset.tip });
  const ck = b.querySelector(".tgt-ck");
  if (ck && T.X) ck.innerHTML = T.X.ic(on ? "check" : "plus", 10);
}

export function setTargets(row, value) {
  if (!row || !value) return;
  for (const b of $$("[data-tg]", row)) if (!b.classList.contains("na") && b.dataset.tg in value) setChip(b, !!value[b.dataset.tg]);
}

function shake(b) {
  b.classList.remove("shake");
  void b.offsetWidth;
  b.classList.add("shake");
}

function wire(X) {
  T.X = X;
  if (T.wired) return;
  T.wired = true;
  document.addEventListener("click", (e) => {
    const k = e.target.closest?.("[data-tk]");
    if (k?.closest("[data-tgt]")) {
      e.preventDefault();
      if (T.X) tkClick(T.X, k);
      return;
    }
    const b = e.target.closest?.("[data-tg]");
    const row = b?.closest("[data-tgt]");
    if (!row) return;
    e.preventDefault();
    if (row.classList.contains("busy")) return;
    if (b.classList.contains("na")) {
      shake(b);
      return T.X?.toast(b.title, true);
    }
    const on = !b.classList.contains("on");
    if (!on && !$$("[data-tg].on", row).some((x) => x !== b)) {
      shake(b);
      return T.X?.toast("En az bir paylaşım yeri seçili kalmalı", true);
    }
    const before = readTargets(row);
    setChip(b, on);
    row.dispatchEvent(new CustomEvent("tgchange", { bubbles: true, detail: { id: b.dataset.tg, on, value: readTargets(row), before } }));
  });
}

export function targetIcons(X, p, size = 12) {
  const yt = ytMark(X, p, size);
  let tk = "";
  try {
    tk = ttMark(X, p, size);
  } catch {}
  const placed = ["planlandi", "paylasiliyor", "paylasildi"].includes(p?.status) || !!p?.after_render?.action;
  if (!placed) return yt + tk;
  const t = postTargets(X.S, p);
  const done = p.status === "paylasildi";
  const ig = t.instagram ? `<span class="tmark ig${done ? " done" : ""}" title="${done ? "Instagram'da paylaşıldı" : "Instagram'da paylaşılacak"}">${X.ic("instagram", size)}</span>` : "";
  const y = yt || (t.youtube ? `<span class="ytmark q" title="YouTube Shorts olarak da paylaşılacak">${X.ic("youtube", size)}</span>` : "");
  const k = tk || (!done && ttOn(p) ? `<span class="ttmark q" title="TikTok'ta da planlanacak">${X.ic("music", size)}</span>` : "");
  return ig + y + k;
}

export async function saveTargets(X, ids, value) {
  const list = [].concat(ids);
  if (list.length === 1) {
    await X.api(`/api/posts/${list[0]}/targets`, value);
    return { updated: list, skipped: [] };
  }
  return X.api("/api/posts/targets", { ids: list, ...value });
}

export function confirmYtRemoval(X, p, value, go, revert) {
  const y = p?.youtube || {};
  if (value?.youtube === false && (y.state === "scheduled" || y.state === "uploading")) {
    revert?.();
    X.confirm("YouTube'daki video silinsin mi?", `Bu video ${y.state === "uploading" ? "şu an YouTube'a yükleniyor" : "YouTube'a yüklendi ve planlı"}. YouTube'u kapatırsan YouTube'dan silinir.`, "Kapat ve sil", go);
    return;
  }
  go();
}
