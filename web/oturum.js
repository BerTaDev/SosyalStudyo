const $ = (s, r = document) => r.querySelector(s);
const HUES = [18, 330, 262, 205, 160, 45, 290, 190];
const O = { list: [], current: 0, open: false, busy: false, menu: null, edit: null, adding: false, going: null };
let X = null;

const cur = () => O.list.find((o) => o.id === O.current) || O.list[0];
const initial = (name) => (String(name || "?").trim()[0] || "?").toLocaleUpperCase("tr-TR");

function avatar(o, size) {
  const box = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.46)}px;--h:${HUES[o.id % HUES.length]}`;
  const img = o.avatar ? `<img src="${X.esc(o.avatar)}" alt="">` : "";
  return `<span class="ot-av${img ? "" : " ini"}" style="${box}" data-ini="${X.esc(initial(o.name))}">${img || X.esc(initial(o.name))}</span>`;
}

function fixImages(root) {
  for (const img of root.querySelectorAll(".ot-av img")) {
    img.addEventListener("error", () => {
      const av = img.parentElement;
      av.classList.add("ini");
      av.textContent = av.dataset.ini;
    }, { once: true });
  }
}

function subline(o) {
  if (!o.running && o.id !== O.current) return "Başlatılıyor…";
  const a = o.accounts || {};
  const parts = [];
  if (a.instagram) parts.push(`IG @${a.instagram}`);
  if (a.youtube) parts.push(`YT ${a.youtube}`);
  if (a.tiktok) parts.push(`TT @${a.tiktok}`);
  return parts.join(" · ") || "Hesap bağlanmadı";
}

function renderBtn() {
  const b = $("#otBtn");
  const o = cur();
  if (!b || !o) return;
  b.innerHTML = `${avatar(o, 22)}<span class="ot-name">${X.esc(o.name)}</span>${X.ic("chevron-down", 14, "ot-chev")}`;
  b.title = `Oturum: ${o.name}`;
  b.classList.toggle("open", O.open);
  fixImages(b);
  const plain = o.home && O.list.length < 2 && o.name === "Ana stüdyo";
  document.title = plain ? "Sosyal Stüdyo" : `${o.name} · Sosyal Stüdyo`;
}

function rowHtml(o) {
  const me = o.id === O.current;
  if (O.edit === o.id) {
    return `<form class="ot-row edit" data-id="${o.id}">${avatar(o, 32)}<input class="ot-in" maxlength="40" value="${X.esc(o.name)}" autocomplete="off">` +
      `<button class="btn primary sm" type="submit">Kaydet</button></form>`;
  }
  const going = O.going === o.id;
  const acts = O.menu === o.id ? `<div class="ot-acts"><button class="btn sm" data-act="rename">${X.ic("pencil", 13)}Yeniden adlandır</button>` +
    (!o.home && !me ? `<button class="btn sm danger" data-act="delete">${X.ic("trash-2", 13)}Sil</button>` : "") + `</div>` : "";
  return `<div class="ot-row${me ? " cur" : ""}${o.running || me ? "" : " off"}${O.menu === o.id ? " menu" : ""}" data-id="${o.id}" tabindex="0">` +
    `${avatar(o, 32)}<span class="ot-tx"><b><span>${X.esc(o.name)}</span>${o.home ? `<i class="ot-tag">Ana</i>` : ""}</b>` +
    `<small>${going ? "Geçiliyor…" : X.esc(subline(o))}</small></span>` +
    (me ? `<span class="ot-ok">${X.ic("check", 16)}</span>` : going ? `<span class="bw-dots"><i></i><i></i><i></i></span>` : "") +
    `<button class="ot-more" type="button" data-act="menu" title="Seçenekler">${X.ic("ellipsis", 16)}</button>${acts}</div>`;
}

function renderPop() {
  const p = $("#otPop");
  if (!p) return;
  const foot = O.busy ? `<div class="ot-busy"><span class="bw-dots"><i></i><i></i><i></i></span>Oturum hazırlanıyor…</div>`
    : O.adding ? `<form class="ot-add"><input class="ot-in" id="otNew" maxlength="40" placeholder="Oturum adı, ör. İkinci kanal" autocomplete="off"><button class="btn primary sm" type="submit">Oluştur</button></form>`
    : `<button class="ot-new" type="button" data-act="add">${X.ic("plus", 15)}Yeni oturum</button>`;
  p.innerHTML = `<div class="ot-head">Oturumlar<span>Her oturumun kendi hesapları, içerikleri ve tarayıcısı var</span></div>` +
    `<div class="ot-list">${O.list.map(rowHtml).join("")}</div><div class="ot-foot">${foot}</div>`;
  fixImages(p);
  const edit = $(".ot-row.edit .ot-in", p);
  if (edit) {
    edit.focus();
    edit.select();
  } else if (O.adding && !O.busy) $("#otNew", p)?.focus();
}

async function load() {
  try {
    const d = await X.api("/api/oturumlar");
    O.list = d.list || [];
    O.current = d.current ?? 0;
  } catch {}
}

function go(o, force = false) {
  if (!o || (!force && o.id === O.current)) return closePop();
  O.going = o.id;
  renderPop();
  const hash = X.S.tab === "browser" ? "#tarayici" : "";
  location.assign(`${location.protocol}//${location.hostname}:${o.port}/${hash}`);
}

async function create(name) {
  name = name.trim();
  if (!name) return $("#otNew")?.focus();
  O.busy = true;
  renderPop();
  try {
    const d = await X.api("/api/oturumlar", { name });
    O.list.push(d.oturum);
    O.busy = false;
    go(d.oturum, true);
  } catch (e) {
    O.busy = false;
    renderPop();
    X.toast(e.message, true);
  }
}

async function rename(id, name) {
  name = name.trim();
  const o = O.list.find((x) => x.id === id);
  O.edit = null;
  if (!o || !name || name === o.name) return renderPop();
  try {
    const d = await X.api(`/api/oturumlar/${id}`, { name });
    Object.assign(o, d.oturum);
    X.toast("Oturum adı değişti");
  } catch (e) {
    X.toast(e.message, true);
  }
  renderPop();
  renderBtn();
}

function remove(o) {
  closePop();
  X.confirm("Oturumu sil", `<p>“${X.esc(o.name)}” oturumu kapatılıp listeden kaldırılacak.</p><p class="muted">İçindeki gönderiler ve bağlantılar silinmez; ana stüdyo klasöründe <code>oturumlar\\_silinen</code> altına taşınır.</p>`, "Sil", async () => {
    try {
      await X.api(`/api/oturumlar/${o.id}/delete`, {});
      O.list = O.list.filter((x) => x.id !== o.id);
      renderBtn();
      X.toast(`“${o.name}” oturumu kaldırıldı`);
    } catch (e) {
      X.toast(e.message, true);
    }
  });
}

function onClick(e) {
  const row = e.target.closest(".ot-row");
  const o = row && O.list.find((x) => x.id === +row.dataset.id);
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "add") {
    O.adding = true;
    O.menu = O.edit = null;
    return renderPop();
  }
  if (!o) return;
  if (act === "menu") {
    O.menu = O.menu === o.id ? null : o.id;
    return renderPop();
  }
  if (act === "rename") {
    O.edit = o.id;
    O.menu = null;
    return renderPop();
  }
  if (act === "delete") return remove(o);
  if (!row.classList.contains("edit") && !e.target.closest("button, input")) go(o);
}

function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  if (f.classList.contains("ot-add")) return create($("#otNew", f).value);
  if (f.classList.contains("edit")) return rename(+f.dataset.id, $(".ot-in", f).value);
}

function outside(e) {
  if (O.busy || e.target.closest("#otPop, #otBtn, #modal")) return;
  closePop();
}

function openPop() {
  const b = $("#otBtn");
  const r = b.getBoundingClientRect();
  const p = document.createElement("div");
  p.id = "otPop";
  p.dataset.covers = "";
  p.style.left = `${Math.max(8, r.left)}px`;
  p.style.top = `${r.bottom + 8}px`;
  p.onclick = onClick;
  p.onsubmit = onSubmit;
  p.onkeydown = (e) => {
    if (e.key === "Enter" && e.target.classList.contains("ot-row")) e.target.click();
  };
  document.body.append(p);
  O.open = true;
  renderBtn();
  renderPop();
  p.getBoundingClientRect();
  p.classList.add("in");
  document.addEventListener("pointerdown", outside, true);
  load().then(() => {
    if (!O.open) return;
    renderBtn();
    if (O.edit === null && !O.adding) renderPop();
  });
}

function closePop() {
  $("#otPop")?.remove();
  O.open = false;
  O.menu = O.edit = null;
  O.adding = false;
  document.removeEventListener("pointerdown", outside, true);
  renderBtn();
}

export async function initOturum(x) {
  X = x;
  const b = $("#otBtn");
  if (!b) return;
  b.onclick = () => (O.open ? closePop() : openPop());
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !O.open || O.busy) return;
    if (O.edit !== null || O.adding || O.menu !== null) {
      O.edit = O.menu = null;
      O.adding = false;
      return renderPop();
    }
    closePop();
  });
  await load();
  renderBtn();
}
