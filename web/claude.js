import { ago } from "/web/views.js";
import { claudeSetupBtn } from "/web/claudesetup.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function label(l) {
  const s = String(l || "");
  if (/5-hour|5 saat/i.test(s)) return "5 saatlik oturum (tüm modeller)";
  const m = s.match(/weekly\s*·\s*(.+)/i);
  if (m) return `Haftalık · sadece ${m[1]}`;
  if (/weekly/i.test(s)) return "Haftalık (tüm modeller)";
  return s;
}

function until(iso) {
  if (!iso) return "";
  const ms = new Date(iso) - new Date();
  if (ms <= 0) return "sıfırlandı";
  const m = Math.round(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  return `${d ? d + " gün " : ""}${h ? h + " sa " : ""}${!d ? mm + " dk" : ""}`.trim() + " sonra sıfırlanır";
}

const level = (p) => (p >= 90 ? "bad" : p >= 70 ? "warn" : "ok");

const tag = (id) => id.toUpperCase();

function nextName(st, acc, video) {
  const used = new Set(st.agent_names || []);
  const base = `${video ? "Sosyal Ajan" : "Sosyal Fikir Ajanı"}${acc.id === "main" ? "" : ` ${tag(acc.id)}`}`;
  if (acc.id === "main" && video) {
    for (let n = 1; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
  }
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const c = acc.id === "main" ? `${base} ${n}` : `${base}-${n}`;
    if (!used.has(c)) return c;
  }
}

function agentPrompt(dir, acc, kind, name, cli = "python -X utf8 studio.py") {
  const video = kind === "video";
  return [
    `Sen "${name}"sın: Sosyal Stüdyo'nun ${video ? "video ajanı" : "fikir ve açıklama ajanı"}sın ve "${acc.name}" hesabında çalışıyorsun. Başka video ajanları da aynı anda çalışabilir; kuyruk her işi tek ajana verir, sadece sana verilen işe dokun.`,
    `Klasör: ${dir}`,
    `1. AJAN_TALIMAT.md dosyasını baştan sona oku ve aynen uygula${video ? "" : " (senin için: \"Fikir ajanı rolü\", \"İş: ideas\", \"İş: caption\", \"Video stili şablonları\", \"Kurallar\")"}.`,
    `2. Her komutta --agent "${name}" kullan. wait ve usage-report komutlarına ayrıca --account ${acc.id} ekle. Bekleme komutun (Bash run_in_background ile):`,
    `   ${cli} wait --agent "${name}"${video ? "" : " --only ideas,caption"} --account ${acc.id}`,
    `3. Döngünün 0. adımında get_session("self") ile birlikte mcp__ccd_session_mgmt__get_usage da çağır; dosyaya {"plan": <get_usage.plan>, "session": {...}} yaz ve usage-report --account ${acc.id} ile bildir. Böylece stüdyo bu hesabın limitini de görür.`,
    `4. Döngüyü kendiliğinden bırakma. Kullanıcıyla Türkçe konuş.${video ? "" : " Video yapma, motor ve render dosyalarına dokunma."}`,
  ].join("\n");
}

async function copyText(X, text, label, where) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
  }
  X.toast(`${label} kopyalandı; ${where} içindeki yeni oturuma yapıştır`);
}

function pctOf(u) {
  const w = (u?.windows || []).find((x) => /5/.test(x.label || ""));
  return w ? w.percentUsed : null;
}

function accountHtml(X, st, ui) {
  const { ic, esc } = X;
  const active = st.accounts.find((a) => a.active) || st.accounts[0];
  const setup = st.accounts.find((a) => a.id === ui.setup) || (active.id !== "main" && !active.agents.length ? active : null);
  const removing = st.accounts.find((a) => a.id === ui.removing);
  return `<div class="cpacc">
    <div class="cpacc-h">${ic("arrow-left-right", 14)}Hangi hesapların ajanları iş alsın?</div>
    <div class="cpacc-opts">${st.accounts.map((a) => {
      const pc = pctOf(a.usage);
      return `<div class="cpacc-card ${a.active ? "active" : ""}" data-acc="${a.id}" role="button" tabindex="0">
        <span class="cpacc-top"><b>${esc(a.name)}</b>${pc != null ? `<i class="${level(pc)}">%${pc}</i>` : ""}</span>
        <span class="cpacc-ag ${a.agents.length ? "on" : ""}"><span class="dot ${a.agents.length ? "on" : ""}"></span>${a.agents.length ? `${a.agents.length} ajan hazır` : "Ajan açık değil"}</span>
        <span class="cpacc-on ${a.active ? "" : "off"}">${ic(a.active ? "circle-check" : "circle-pause", 12)}${a.active ? "İş alıyor" : "Kapalı"}</span>
        <span class="cpacc-tools">
          ${a.launcher ? `<button class="btn icon sm ghost" data-open="${a.id}" title="Bu Claude'u aç">${ic("external-link", 13)}</button>` : ""}
          <button class="btn icon sm ghost" data-setup="${a.id}" title="Bu hesaba ajan ekle">${ic("user-plus", 13)}</button>
          ${a.id !== "main" ? `<button class="btn icon sm ghost danger-ic" data-remove="${a.id}" title="Bu oturumu çıkar">${ic("trash-2", 13)}</button>` : ""}
        </span>
      </div>`;
    }).join("")}
      <div class="cpacc-card add" id="cpAddCard" role="button" tabindex="0">${ui.adding ? `
        <span class="cpacc-top"><b>Yeni oturum</b></span>
        <input id="cpAddName" placeholder="Ad (ör. Session ${st.accounts.length + 1})" maxlength="40">
        <span class="row" style="gap:6px"><button class="btn sm primary" id="cpAddGo">${ic("plus", 13)}Ekle</button><button class="btn sm ghost" id="cpAddNo">Vazgeç</button></span>`
        : `${ic("plus", 18)}<b>Yeni oturum ekle</b><span class="sm muted">Başka bir Claude hesabı için ayrı uygulama</span>`}</div>
    </div>
    ${removing ? `<div class="tr-confirm" style="margin-top:10px">${ic("triangle-alert", 20)}<div class="grow"><b>"${esc(removing.name)}" çıkarılsın mı?</b>
        <div class="sm">Stüdyo bu hesabın ajanlarına artık iş vermez${removing.active ? "; yeni işler ana hesaba geçer" : ""}. Açık ajan oturumlarını o uygulamada kendin kapatabilirsin.</div>
        <label class="cpdel"><input type="checkbox" id="cpDelFiles"> Profil klasörünü ve masaüstü kısayolunu da sil <span>(o uygulamadaki Claude girişi ve sohbet geçmişi silinir, geri alınamaz)</span></label>
        <div class="row" style="gap:6px;margin-top:8px"><button class="btn sm" id="cpRemNo">Vazgeç</button><button class="btn sm danger" id="cpRemGo" data-id="${removing.id}">${ic("trash-2", 13)}Çıkar</button></div></div></div>` : ""}
    ${st.accounts.filter((a) => a.active && !a.agents.length).map((a) => `<div class="cppend sm">${ic("triangle-alert", 13)} ${esc(a.name)} açık ama içinde çalışan ajan yok.</div>`).join("")}
    <div class="sm muted" style="margin-top:6px">Kartlara tıklayarak hesapları aç/kapat. <b>Birden fazla hesap açıksa videolar aynı anda üretilir</b>; her ajan sıradan ayrı bir video alır. Aynı hesaba ikinci bir video ajanı da ekleyebilirsin (kartın üstündeki ${ic("user-plus", 12)}). Kapalı hesapların ajanları boşta bekler, limit harcamaz.</div>
    ${setup ? `<div class="cps2">
      <b>${ic("user-plus", 14)}${esc(setup.name)}: yeni ajan ekle</b>
      <ol>
        <li><span>${setup.id === "main" ? "Bu ana Claude uygulamasında" : `${esc(setup.name)} uygulamasını aç ve orada kullanacağın Claude hesabıyla giriş yap; sonra`} Code sekmesine geç.</span>${setup.launcher ? `<button class="btn sm" data-open="${setup.id}">${ic("external-link", 13)}${esc(setup.name)}'i aç</button>` : ""}</li>
        <li><span>Code sekmesinde yeni bir oturum başlat, klasör olarak <code>SosyalStudyo</code>'yu seç ve izinleri "atla" modunda aç.</span></li>
        <li><span>Yeni bir video ajanı için bu metni yeni oturuma yapıştırıp gönder (ajanın adı: <b>${esc(nextName(st, setup, true))}</b>). Aynı anda daha çok video için bunu tekrarla.</span><button class="btn sm" data-copy="video" data-acc-id="${setup.id}">${ic("copy", 13)}Video ajanı metnini kopyala</button></li>
        <li><span>Fikirler beklemesin diye ayrı bir oturumda fikir ajanı da açabilirsin.</span><button class="btn sm" data-copy="ideas" data-acc-id="${setup.id}">${ic("copy", 13)}Fikir ajanı metnini kopyala</button></li>
      </ol>
      <div class="sm muted">Ajan bağlanınca kartındaki ajan sayısı artar. Her video ajanı aynı anda bir video üretir; ElevenLabs kredisi ve Claude limiti de buna göre daha hızlı harcanır.</div>
      <div class="cps2-claude">${claudeSetupBtn("ajanlar", "Claude ile kur", "ghost")}<span class="sm muted">Takılırsan Claude seni adım adım yönlendirsin.</span></div>
    </div>` : ""}
  </div>`;
}

export function renderClaudeChip(X, b) {
  const el = $("#claudeChip");
  if (!el) return;
  const p = b?.percent;
  const sig = `${p}|${b?.pending}|${b?.updated}|${b?.account}|${(b?.accounts || []).join(",")}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const deg = Math.round(((p ?? 0) / 100) * 360);
  el.className = `chip claude-chip ${p == null ? "" : level(p)}`;
  el.innerHTML = `<span class="cring" style="--deg:${deg}deg"></span><span class="ct-x">Claude</span>${(b?.accounts || []).length > 1 ? ` <span class="cs2">${b.accounts.length} HESAP</span>` : b?.account && b.account !== "main" ? ` <span class="cs2">${b.account.toUpperCase()}</span>` : ""} ${p == null ? "—" : "%" + p}${b?.pending ? ` ${X.ic("loader-circle", 12, "spin")}` : ""}`;
  el.title = p == null ? "Claude kullanım bilgisi henüz yok" : `5 saatlik oturum limitinin %${p}'i kullanıldı · ${until(b.resetsAt)}`;
}

export async function toggleClaudePanel(X) {
  const open = $("#cpanel");
  if (open) return open.remove();
  const p = document.createElement("div");
  p.id = "cpanel";
  document.body.append(p);
  p.innerHTML = `<div class="empty">${X.ic("loader-circle", 22, "spin")}</div>`;
  requestAnimationFrame(() => p.classList.add("in"));
  const outside = (e) => {
    if (!p.isConnected) return document.removeEventListener("mousedown", outside);
    if (!p.contains(e.target) && !e.target.closest("#claudeChip, #csModal")) {
      p.remove();
      document.removeEventListener("mousedown", outside);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
  await draw(X, p);
}

async function draw(X, p) {
  const { ic, esc } = X;
  const st = await X.api("/api/claude");
  if (!p.isConnected) return;
  const ui = { setup: p.dataset.uiSetup || "", removing: p.dataset.uiRemoving || "", adding: p.dataset.uiAdding === "1" };
  const activeAcc = st.accounts.find((a) => a.active) || st.accounts[0];
  const u = st.usage || {};
  const wins = u.windows || [];
  const name = (id) => st.models.find((m) => m.id === id)?.name || id || "—";
  const eff = (id) => st.efforts.find((e) => e.id === id)?.name || id || "—";
  const mgr = st.manager;
  p.innerHTML = `<div class="nphead"><b class="grow">${ic("gauge", 16)} Claude kullanımı ${u.plan ? `<span class="badge">${esc(u.plan)}</span>` : ""}</b>
      <button class="btn icon ghost sm" id="cpRefresh" title="Şimdi güncelle">${ic("refresh-cw", 15)}</button></div>
    <div class="cpbody">
      ${accountHtml(X, st, ui)}
      <h4>${ic("gauge", 14)} ${esc(activeAcc.name)} limiti</h4>
      ${u.status === "not_applicable" ? `<div class="muted sm">Bu hesapta plan limiti yok (API anahtarı ile kullanım).</div>` : ""}
      ${wins.length ? wins.map((w) => `<div class="cpwin">
          <div class="row"><span class="grow">${esc(label(w.label))}</span><b class="${level(w.percentUsed)}">%${w.percentUsed}</b></div>
          <div class="cpbar"><i class="${level(w.percentUsed)}" style="width:${Math.min(100, w.percentUsed)}%"></i></div>
          <div class="sm muted">${until(w.resetsAt)}</div></div>`).join("")
        : `<div class="muted sm">Henüz kullanım bilgisi yok.</div>`}
      ${u.extraUsage?.enabled ? `<div class="sm muted">Ek kullanım açık${u.extraUsage.spent != null ? ` · ${u.extraUsage.spent} ${esc(u.extraUsage.currency || "")}` : ""}</div>` : ""}
      <div class="cpupd sm ${st.stale ? "warnc" : "muted"}">${st.updated ? `${ago(st.updated)} güncellendi` : "Hiç güncellenmedi"}${st.refresh ? " · güncelleme istendi…" : ""}
        · Yönetici ${mgr?.live ? `<span class="okc">çalışıyor</span>` : `<span class="warnc">kapalı</span>`}</div>
      <div class="help sm">${ic("info", 13)} <b>Fable ayrı mı sayılır?</b> Hayır. Fable da önce <b>5 saatlik oturum</b> limitinden düşer. "Haftalık · sadece Fable" ayrıca Fable için konan ek bir haftalık tavandır. Fable en büyük model olduğu için aynı iş, oturum limitini daha hızlı tüketir.</div>
      <h4>${ic("bot", 14)} Ajanlar</h4>
      ${st.sessions.length ? st.sessions.map((s) => `<div class="cpagent"><span class="dot ${s.live !== "off" ? "on" : ""}"></span><b class="grow">${esc(s.name)}</b><span class="badge">${esc(name(s.model))}</span><span class="badge">${esc(eff(s.effort))}</span></div>`).join("")
        : `<div class="row cpnoag"><span class="muted sm grow">Henüz bilgi gönderen ajan yok.</span>${claudeSetupBtn("ajanlar")}</div>`}
      <h4>${ic("sliders-horizontal", 14)} Ajanlar hangi modelle çalışsın?</h4>
      <div class="cpmodels" id="cpModel">${[{ id: "", name: "Değiştirme", note: "Ajan kendi ayarında kalsın" }, ...st.models].map((m) => `<button data-m="${m.id}" class="${st.prefs.model === m.id ? "active" : ""}"><b>${esc(m.name)}</b><span>${esc(m.note)}</span></button>`).join("")}</div>
      <label class="sm muted" style="display:block;margin:10px 0 6px">Çaba (düşünme düzeyi): yüksek çaba daha iyi sonuç verir ama limiti daha çok harcar</label>
      <div class="seg sm" id="cpEffort">${[{ id: "", name: "Değiştirme" }, ...st.efforts].map((e) => `<button data-e="${e.id}" class="${st.prefs.effort === e.id ? "active" : ""}">${esc(e.name)}</button>`).join("")}</div>
      ${st.pending.length ? `<div class="cppend sm">${ic("loader-circle", 13, "spin")} ${mgr?.live ? "Yönetici uyguluyor…" : "Yönetici açılınca uygulanacak"}: ${st.pending.map((c) => `${esc(c.agent)} → ${[c.model && name(c.model), c.effort && eff(c.effort)].filter(Boolean).join(", ")}`).join("; ")}</div>` : ""}
      <div class="sm muted" style="margin-top:8px">Değişiklik ajanın bir sonraki işinden itibaren geçerli olur; o an süren iş eski ayarla biter.</div>
    </div>`;
  const save = X.guard(async (patch) => {
    await X.api("/api/claude/prefs", { ...st.prefs, ...patch });
    await X.refresh();
    await draw(X, p);
  });
  $("#cpModel", p).onclick = (e) => {
    const b = e.target.closest("[data-m]");
    if (b) save({ model: b.dataset.m });
  };
  $("#cpEffort", p).onclick = (e) => {
    const b = e.target.closest("[data-e]");
    if (b) save({ effort: b.dataset.e });
  };
  const redraw = () => draw(X, p);
  $(".cpacc", p).onclick = X.guard(async (e) => {
    const t = e.target;
    const op = t.closest("[data-open]");
    if (op) {
      e.stopPropagation();
      await X.api("/api/claude/open", { account: op.dataset.open });
      return X.toast("Claude açılıyor…");
    }
    const su = t.closest("[data-setup]");
    if (su) {
      e.stopPropagation();
      p.dataset.uiSetup = p.dataset.uiSetup === su.dataset.setup ? "" : su.dataset.setup;
      return redraw();
    }
    const rm = t.closest("[data-remove]");
    if (rm) {
      e.stopPropagation();
      p.dataset.uiRemoving = rm.dataset.remove;
      return redraw();
    }
    const cp = t.closest("[data-copy]");
    if (cp) {
      const acc = st.accounts.find((a) => a.id === cp.dataset.accId);
      return copyText(X, agentPrompt(st.studio_dir, acc, cp.dataset.copy, nextName(st, acc, cp.dataset.copy === "video"), st.cli), cp.dataset.copy === "video" ? "Video ajanı metni" : "Fikir ajanı metni", acc.name);
    }
    if (t.closest("#cpRemNo")) {
      p.dataset.uiRemoving = "";
      return redraw();
    }
    const go = t.closest("#cpRemGo");
    if (go) {
      go.disabled = true;
      const del = $("#cpDelFiles", p)?.checked;
      const res = await X.api("/api/claude/accounts/remove", { account: go.dataset.id, delete_files: !!del });
      p.dataset.uiRemoving = "";
      if (p.dataset.uiSetup === go.dataset.id) p.dataset.uiSetup = "";
      X.toast(res.removed?.note || (del ? "Oturum ve dosyaları silindi" : "Oturum listeden çıkarıldı"), !!res.removed?.note);
      await X.refresh();
      return redraw();
    }
    if (t.closest("#cpAddNo")) {
      p.dataset.uiAdding = "";
      return redraw();
    }
    if (t.closest("#cpAddGo")) {
      const res = await X.api("/api/claude/accounts/add", { name: $("#cpAddName", p).value });
      p.dataset.uiAdding = "";
      p.dataset.uiSetup = res.added.id;
      X.toast(`${res.added.name} eklendi; masaüstüne kısayolu kondu`);
      await X.refresh();
      return redraw();
    }
    if (t.closest("#cpAddCard")) {
      if (p.dataset.uiAdding === "1") return;
      p.dataset.uiAdding = "1";
      await redraw();
      return $("#cpAddName", p)?.focus();
    }
    const card = t.closest("[data-acc]");
    if (card) {
      const acc = st.accounts.find((a) => a.id === card.dataset.acc);
      await X.api("/api/claude/account", { account: acc.id, on: !acc.active });
      X.toast(acc.active ? `${acc.name} kapatıldı; ajanları yeni iş almayacak` : `${acc.name} açıldı; ajanları da iş alacak`);
      await X.refresh();
      return redraw();
    }
  });
  const nameIn = $("#cpAddName", p);
  if (nameIn)
    nameIn.onkeydown = (e) => {
      if (e.key === "Enter") $("#cpAddGo", p).click();
      if (e.key === "Escape") $("#cpAddNo", p).click();
    };
  $("#cpRefresh", p).onclick = X.guard(async () => {
    await X.api("/api/claude/refresh", {});
    X.toast(mgr?.live ? "Güncelleme istendi; birkaç saniye içinde yenilenir" : "Yönetici kapalı; açılınca güncellenecek");
    await draw(X, p);
  });
  clearTimeout(p._t);
  p._t = setTimeout(function tick() {
    if (!p.isConnected) return;
    if (p.contains(document.activeElement) && document.activeElement.matches("input")) p._t = setTimeout(tick, 4000);
    else draw(X, p);
  }, 8000);
}
