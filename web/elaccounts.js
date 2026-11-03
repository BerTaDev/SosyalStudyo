import { claudeSetupBtn } from "/web/claudesetup.js";

const $ = (s, r = document) => r.querySelector(s);
const PLAN = { free: "Ücretsiz", starter: "Starter", creator: "Creator", pro: "Pro", scale: "Scale", business: "Business" };
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("tr-TR"));

export function elAccountsHtml(X) {
  const { ic } = X;
  return `<div class="ela" id="elAccts">
      <div class="ela-head"><b>${ic("users", 15)}ElevenLabs hesapları</b><span class="ela-total" id="elTotal"></span></div>
      <div class="ela-list" id="elList"><div class="muted sm ela-empty">${ic("loader-circle", 14, "spin")} Hesaplar yükleniyor…</div></div>
      <div class="ela-strat"><span class="sm muted">Önce hangisi kullanılsın?</span>
        <div class="seg sm" id="elStrat"><button type="button" data-st="most">${ic("battery-full", 13)}En çok kredisi olan</button><button type="button" data-st="order">${ic("list-ordered", 13)}Listedeki sırayla</button></div></div>
      <div class="ela-note">${ic("shuffle", 13)}<span>Bir hesabın kredisi biterse, anahtarı çalışmazsa ya da seçili ses o hesapta yoksa seslendirme kendiliğinden sıradaki hesaba geçer. Bir videonun bütün sesi mümkünse aynı hesaptan çıkar.</span></div>
      <div class="ela-add">
        <div class="ela-addrow"><input id="elNewName" placeholder="Hesap adı (isteğe bağlı)" maxlength="40" autocomplete="off">
          <input id="elNewKey" type="password" placeholder="API anahtarı (sk_…)" autocomplete="off" spellcheck="false">
          <button type="button" class="btn primary" id="elAdd">${ic("plus", 15)}Hesap ekle</button></div>
        <div class="ela-addnote"><span class="sm muted grow">Anahtar eklenmeden önce ElevenLabs'te denenir; yalnızca bu bilgisayarda saklanır ve bir daha gösterilmez.</span>${claudeSetupBtn("elevenlabs", "Claude ile kur", "ghost")}</div>
      </div>
    </div>`;
}

function rowHtml(X, a, d, i, n) {
  const { ic, esc } = X;
  const pct = a.limit ? Math.max(0, Math.min(100, (a.left / a.limit) * 100)) : 0;
  const low = a.left != null && a.limit && a.left / a.limit < 0.1;
  const live = d.pinned === a.id;
  const sub = !a.enabled ? "Kapalı · seslendirmede kullanılmaz"
    : a.error ? `${ic("triangle-alert", 12)} ${esc(a.error)}`
    : `<b>${num(a.left)}</b> / ${num(a.limit)} kredi kaldı${a.reset_date ? ` · ${esc(a.reset_date)} yenilenir` : ""}`;
  return `<div class="ela-row ${a.enabled ? "" : "off"} ${a.error && a.enabled ? "bad" : ""}" data-id="${esc(a.id)}">
      <div class="ela-ord"><button type="button" data-a="up" ${i === 0 ? "disabled" : ""} title="Yukarı taşı">${ic("chevron-up", 14)}</button><button type="button" data-a="down" ${i === n - 1 ? "disabled" : ""} title="Aşağı taşı">${ic("chevron-down", 14)}</button></div>
      <div class="ela-main">
        <div class="ela-top"><span class="ela-num">${i + 1}</span><b class="ela-name" data-name>${esc(a.name)}</b>${a.plan ? `<span class="ela-plan ${a.plan === "free" ? "free" : ""}">${esc(PLAN[a.plan] || a.plan)}</span>` : ""}<span class="ela-hint">${esc(a.hint || "")}</span>${live ? `<span class="ela-live">${ic("mic", 11)} son kullanılan</span>` : ""}</div>
        <div class="ela-bar ${low ? "low" : ""}"><i style="width:${a.enabled && !a.error ? pct : 0}%"></i></div>
        <div class="ela-sub ${a.error && a.enabled ? "bad" : ""}">${sub}</div>
      </div>
      <button type="button" class="ela-sw ${a.enabled ? "on" : ""}" data-a="enable" role="switch" aria-checked="${a.enabled}" title="${a.enabled ? "Kapat" : "Aç"}"><i></i></button>
      <button type="button" class="btn icon sm ghost" data-a="rename" title="Adını değiştir">${ic("pencil", 14)}</button>
      <button type="button" class="btn icon sm ghost" data-a="delete" title="Hesabı kaldır">${ic("trash-2", 14)}</button>
    </div>`;
}

export function bindElAccounts(X, m, onChange) {
  const { ic, api, toast, guard } = X;
  let d = null;
  const draw = () => {
    const list = $("#elList", m);
    if (!list || !d) return;
    const n = d.accounts.length;
    list.innerHTML = n ? d.accounts.map((a, i) => rowHtml(X, a, d, i, n)).join("")
      : `<div class="ela-empty">${ic("mic-off", 18)}<b>Henüz hesap yok</b><span>Aşağıya bir ElevenLabs API anahtarı ekle.</span></div>`;
    const on = d.accounts.filter((a) => a.enabled).length;
    $("#elTotal", m).innerHTML = d.total?.left != null ? `Toplam <b>${num(d.total.left)}</b> kredi · ${on}/${n} hesap açık` : n ? `${on}/${n} hesap açık` : "";
    for (const b of m.querySelectorAll("#elStrat [data-st]")) b.classList.toggle("active", b.dataset.st === d.strategy);
    $("#elStrat", m).closest(".ela-strat").classList.toggle("hidden", n < 2);
  };
  const load = async (fresh) => {
    try {
      d = await api(`/api/eleven/accounts${fresh ? "?fresh=1" : ""}`);
    } catch (e) {
      $("#elList", m).innerHTML = `<div class="ela-empty bad">${ic("triangle-alert", 16)}${X.esc(e.message)}</div>`;
      return;
    }
    draw();
  };
  const changed = async (next, msg) => {
    d = next;
    draw();
    if (msg) toast(msg);
    await X.refresh();
    onChange?.();
  };
  $("#elStrat", m).onclick = guard(async (e) => {
    const b = e.target.closest("[data-st]");
    if (!b || b.dataset.st === d?.strategy) return;
    await changed(await api("/api/eleven/strategy", { strategy: b.dataset.st }), b.dataset.st === "most" ? "Önce en çok kredisi olan hesap kullanılacak" : "Hesaplar listedeki sırayla kullanılacak");
  });
  $("#elList", m).onclick = guard(async (e) => {
    const btn = e.target.closest("[data-a]");
    const row = e.target.closest("[data-id]");
    if (!btn || !row) return;
    const id = row.dataset.id;
    const a = d.accounts.find((x) => x.id === id);
    const act = btn.dataset.a;
    if (act === "rename") {
      const nameEl = row.querySelector("[data-name]");
      const inp = document.createElement("input");
      inp.className = "ela-rename";
      inp.value = a.name;
      inp.maxLength = 40;
      nameEl.replaceWith(inp);
      inp.focus();
      inp.select();
      let done = false;
      const save = async (ok) => {
        if (done) return;
        done = true;
        const v = inp.value.trim();
        if (!ok || !v || v === a.name) return draw();
        try {
          await changed(await api(`/api/eleven/accounts/${id}/rename`, { value: v }), "Hesap adı değişti");
        } catch (err) {
          toast(err.message, true);
          draw();
        }
      };
      inp.onkeydown = (ev) => {
        if (ev.key === "Enter") save(true);
        if (ev.key === "Escape") save(false);
      };
      inp.onblur = () => save(true);
      return;
    }
    if (act === "delete") {
      if (!btn.classList.contains("arm")) {
        btn.classList.add("arm");
        btn.innerHTML = `${ic("trash-2", 13)}Kaldır?`;
        btn.title = "Anahtar bu bilgisayardan silinir; ElevenLabs hesabına bir şey olmaz. Onaylamak için tekrar bas.";
        setTimeout(() => btn.isConnected && btn.classList.contains("arm") && draw(), 4000);
        return;
      }
      const next = await api(`/api/eleven/accounts/${id}/delete`, {});
      await changed(next);
      const gone = next.removed_id || null;
      toast(`"${a.name}" kaldırıldı`, false, gone ? { label: "Geri al", fn: async () => changed(await api(`/api/eleven/accounts/${gone}/restore`, {}), `"${a.name}" geri alındı`) } : null);
      return;
    }
    if (act === "enable") return changed(await api(`/api/eleven/accounts/${id}/enable`, { value: !a.enabled }), a.enabled ? "Hesap kapatıldı" : "Hesap açıldı");
    return changed(await api(`/api/eleven/accounts/${id}/${act}`, {}));
  });
  const add = guard(async () => {
    const key = $("#elNewKey", m).value.trim();
    if (!key) return toast("Önce API anahtarını yapıştır", true);
    if (!key.startsWith("sk_") && !/^[0-9a-f]{32}$/i.test(key))
      return toast("Bu bir API anahtarına benzemiyor. Asıl anahtar sk_ ile başlar ve yalnızca oluşturulduğu an bir kez gösterilir; listedeki kimliği (ID) değil, o değeri yapıştır.", true);
    const b = $("#elAdd", m);
    b.disabled = true;
    b.innerHTML = `${ic("loader-circle", 15, "spin")}Deneniyor…`;
    try {
      const next = await api("/api/eleven/accounts", { key, name: $("#elNewName", m).value.trim() });
      $("#elNewKey", m).value = "";
      $("#elNewName", m).value = "";
      await changed(next, "Hesap eklendi");
    } finally {
      b.disabled = false;
      b.innerHTML = `${ic("plus", 15)}Hesap ekle`;
    }
  });
  $("#elAdd", m).onclick = add;
  $("#elNewKey", m).onkeydown = (e) => {
    if (e.key === "Enter") add();
  };
  load(false);
}
