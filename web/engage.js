const nf = (v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR"));
const cf = (v) => (v == null ? "—" : Number(v).toLocaleString("tr-TR", { notation: "compact", maximumFractionDigits: 1 }));
export const ENGAGE = [["views", "eye", "Görüntülenme"], ["likes", "heart", "Beğeni"], ["comments", "message-circle", "Yorum"],
  ["shares", "share-2", "Paylaşım"], ["saves", "bookmark", "Kaydetme"]];

export function engageHtml(X, t, { title = "Videolarındaki etkileşimler", count = null, unit = "video", cls = "", note = "" } = {}) {
  const { ic, esc } = X;
  const keys = ENGAGE.filter(([k]) => t && t[k] != null);
  if (!keys.length) return "";
  return `<div class="tka-totw eng ${cls}"><div class="tka-toth">${ic("activity", 13)}<span>${esc(title)}</span>${count != null ? `<i>${nf(count)} ${esc(unit)} toplamı</i>` : ""}</div>
    <div class="tka-tot">${keys.map(([k, i, label]) => `<div class="tka-tc ${k}" title="${label}: ${nf(t[k])}"><span class="tka-ti">${ic(i, 16)}</span><div><b>${cf(t[k])}</b><span>${label}</span></div></div>`).join("")}</div>
    ${note ? `<div class="tka-totn">${ic("info", 12)}${esc(note)}</div>` : ""}</div>`;
}
