const $ = (s, el = document) => el.querySelector(s);

const STATUS = { sirada: "Sıradaydı", uretimde: "Üretimdeydi", inceleme: "İncelemedeydi", planlandi: "Planlıydı", paylasiliyor: "Paylaşılıyordu", paylasildi: "Paylaşılmıştı", hata: "Hatalıydı" };

const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const thumb = (p) => (p.has_thumb ? `/media/${p.id}/thumb.jpg?v=${encodeURIComponent(p.updated)}` : "");

function ago(iso) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 60) return `${Math.max(1, m)} dk önce`;
  if (m < 1440) return `${Math.round(m / 60)} saat önce`;
  return `${Math.round(m / 1440)} gün önce`;
}

export function renderTrashButton(X) {
  const b = $("#trashBtn");
  if (!b) return;
  const n = X.S.trashCount || 0;
  b.innerHTML = `${X.ic("trash-2", 14)}Çöp kutusu${n ? ` <span class="tb-n">${n}</span>` : ""}`;
}

export async function trashPost(X, p, after) {
  const { api, toast, esc } = X;
  const go = async () => {
    await api(`/api/posts/${p.id}/delete`, {});
    after?.();
    await X.refresh();
    toast(`"${p.title}" çöp kutusuna taşındı`, false, {
      label: "Geri al",
      fn: async () => {
        await api(`/api/posts/${p.id}/restore`, {});
        await X.refresh();
        toast("Geri alındı");
      },
    });
  };
  const warn = p.status === "paylasildi" ? "Instagram'daki gönderi <b>silinmez</b>; sadece stüdyodan kaldırılır." : p.status === "planlandi" ? "Paylaşım planı da iptal edilir." : p.status === "uretimde" ? "Ajan bu video üzerinde çalışıyor; iş yarıda kalır." : p.status === "paylasiliyor" ? "Şu an paylaşılıyor; paylaşım tamamlanabilir." : "";
  if (warn) X.confirm("Çöp kutusuna taşınsın mı?", `"${esc(p.title)}" çöp kutusuna taşınacak. ${warn}<div class="sm muted" style="margin-top:8px">Çöp kutusundan istediğin zaman geri alabilirsin.</div>`, "Çöp kutusuna taşı", X.guard(go));
  else await X.guard(go)();
}

export async function openTrash(X) {
  const { ic, esc, api, toast } = X;
  let items = [];
  const body = () => {
    const total = items.reduce((n, p) => n + (p.size || 0), 0);
    return items.length
      ? `<div class="tr-head"><span class="muted sm">${items.length} içerik · ${mb(total)} yer kaplıyor</span><span class="grow"></span><button class="btn sm danger" id="trEmpty">${ic("trash-2", 14)}Çöp kutusunu boşalt</button></div>
        <div class="tr-list">${items.map((p) => `<div class="tr-row" data-id="${p.id}">
          <div class="tr-thumb" style="${thumb(p) ? `background-image:url('${thumb(p)}')` : ""}">${thumb(p) ? "" : ic("film", 16)}</div>
          <div class="grow"><div class="tr-t">${esc(p.title)}</div>
            <div class="sm muted">#${p.id} · ${ago(p.deleted_at)} silindi · ${mb(p.size || 0)}${p.prev_status ? ` · ${STATUS[p.prev_status] || p.prev_status}` : ""}</div></div>
          <button class="btn sm" data-restore="${p.id}">${ic("rotate-ccw", 14)}Geri al</button>
          <button class="btn sm ghost icon danger-ic" data-purge="${p.id}" title="Kalıcı olarak sil">${ic("x", 15)}</button>
        </div>`).join("")}</div>
        <div class="sm muted" style="margin-top:10px">Kalıcı silinen içeriğin videosu, sesi ve proje dosyaları diskten tamamen silinir; geri alınamaz. Instagram'daki gönderilere dokunulmaz.</div>`
      : `<div class="tr-empty">${ic("trash-2", 34)}<p>Çöp kutusu boş.</p><div class="sm muted">Beğenmediğin bir videoyu listedeki çöp kutusu simgesiyle buraya taşıyabilirsin.</div></div>`;
  };
  X.modal(`<h2>${ic("trash-2", 20)}Çöp kutusu</h2><div id="trBody"><div class="empty">${ic("loader-circle", 22, "spin")}</div></div><div class="foot"><button class="btn" data-close>Kapat</button></div>`, async (m) => {
    const load = async () => {
      items = await api("/api/trash");
      $("#trBody", m).innerHTML = body();
    };
    const confirmIn = (title, text, okText, fn) => {
      const box = $("#trBody", m);
      const prev = box.innerHTML;
      box.innerHTML = `<div class="tr-confirm">${ic("triangle-alert", 22)}<div class="grow"><b>${title}</b><div class="sm">${text}</div></div></div><div class="row end" style="margin-top:12px"><button class="btn" id="trNo">Vazgeç</button><button class="btn danger" id="trYes">${okText}</button></div>`;
      $("#trNo", m).onclick = () => {
        box.innerHTML = prev;
      };
      $("#trYes", m).onclick = X.guard(async () => {
        $("#trYes", m).disabled = true;
        await fn();
      });
    };
    m.onclick = X.guard(async (e) => {
      if (e.target === m) return X.closeModal();
      const r = e.target.closest("[data-restore]");
      if (r) {
        r.disabled = true;
        await api(`/api/posts/${r.dataset.restore}/restore`, {});
        toast("Geri alındı; içerik listede");
        await load();
        return X.refresh();
      }
      const pg = e.target.closest("[data-purge]");
      if (pg) {
        const p = items.find((x) => x.id === pg.dataset.purge);
        return confirmIn("Kalıcı olarak silinsin mi?", `"${esc(p.title)}" ve dosyaları (${mb(p.size || 0)}) diskten silinecek. Bu işlem geri alınamaz.`, "Kalıcı sil", async () => {
          const res = await api(`/api/posts/${p.id}/purge`, {});
          toast(`Kalıcı olarak silindi · ${mb(res.freed || 0)} yer açıldı`);
          await load();
          X.refresh();
        });
      }
      if (e.target.closest("#trEmpty")) {
        const total = items.reduce((n, p) => n + (p.size || 0), 0);
        return confirmIn("Çöp kutusu boşaltılsın mı?", `${items.length} içerik ve dosyaları (${mb(total)}) diskten silinecek. Bu işlem geri alınamaz.`, "Hepsini kalıcı sil", async () => {
          const res = await api("/api/trash/empty", {});
          toast(`${res.count} içerik kalıcı olarak silindi · ${mb(res.freed || 0)} yer açıldı`);
          await load();
          X.refresh();
        });
      }
    });
    try {
      await load();
    } catch (err) {
      $("#trBody", m).innerHTML = `<div class="errbox">${esc(err.message)}</div>`;
    }
  }, "trash-dlg");
}
