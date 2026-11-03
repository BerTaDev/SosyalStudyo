const LIVE = { ready: "Bulutta · bilgisayar kapalıyken de paylaşılır", preparing: "Bulut paylaşıma hazırlıyor", publishing: "Bulut şu an paylaşıyor" };

export function cloudState(S, p) {
  const sc = S.cloud;
  if (!sc?.configured || !p || p.targets?.instagram === false) return null;
  const c = p.cloud;
  const st = c?.state;
  if (p.status === "paylasildi") return p.published?.cloud || st === "published" ? { icon: "cloud-check", cls: "ok", label: "Buluttan paylaşıldı" } : null;
  if (p.status !== "planlandi" && p.status !== "paylasiliyor") return null;
  if (st === "uploading") {
    const pct = c.upload?.pct;
    return { icon: "cloud-upload", cls: "up", label: `Buluta yükleniyor${pct != null ? ` · %${Math.round(pct)}` : ""}` };
  }
  if (LIVE[st]) return { icon: "cloud-check", cls: "ok", label: LIVE[st] };
  if (st === "error" && !c.local) return { icon: "cloud-alert", cls: "bad", label: `Bulutta hata${c.error ? `: ${c.error}` : ""}` };
  if (st === "error") return { icon: "cloud-alert", cls: "bad", label: `Buluta yüklenemedi${c.error ? `: ${c.error}` : ""} · bilgisayardan paylaşılacak` };
  if (st === "published") return { icon: "cloud-check", cls: "ok", label: "Buluttan paylaşıldı" };
  const reels = (p.kind || "reels") === "reels";
  const why = !sc.enabled ? "Bulut yayını kapalı" : !reels ? "Bu tür buluta yüklenmez" : c?.reason || "Bulutta değil";
  return { icon: "cloud-off", cls: "off", label: `${why} · paylaşım saatinde bilgisayar açık olmalı`, can: !!sc.enabled && reels && p.status === "planlandi" };
}

export function cloudMark(X, p, size = 12) {
  const s = cloudState(X.S, p);
  return s ? `<span class="cmark ${s.cls}" title="${X.esc(s.label)}">${X.ic(s.icon, size)}</span>` : "";
}
