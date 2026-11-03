const $ = (s, el = document) => el.querySelector(s);

const thumb = (p) => (p.has_thumb ? `/media/${p.id}/thumb.jpg?v=${encodeURIComponent(p.updated)}` : "");

export function saveAsTemplate(X, post, after) {
  const { ic, esc, api, toast } = X;
  X.modal(`<h2>${ic("copy-plus", 20)}Videodan şablon al</h2>
    <div class="tt-head">
      <div class="tt-th" style="${thumb(post) ? `background-image:url('${thumb(post)}')` : ""}">${thumb(post) ? "" : ic("film", 20)}</div>
      <div class="grow"><b>#${post.id} · ${esc(post.title)}</b>
        <div class="sm muted">Bu videonun görsel dili (renkler, yazı tipleri, sahne yapısı, animasyonlar ve geçişler) yeni bir video stili olarak kaydedilir. Yeni videolarda içerik konuya göre değişir, görünüm aynı kalır.</div></div>
    </div>
    <label>Şablonun adı</label><input id="ttName" maxlength="40" value="${esc(`${post.title.slice(0, 30)} stili`)}">
    <label>Kısa açıklama <span class="muted">(isteğe bağlı)</span></label><textarea id="ttDesc" rows="2" maxlength="300" placeholder="ör. Kâğıt notlar, el çizimi ikonlar, sıcak bej zemin"></textarea>
    <div class="foot"><button class="btn" data-close>Vazgeç</button><button class="btn primary" id="ttGo">${ic("copy-plus", 15)}Şablon olarak kaydet</button></div>`, (m) => {
    const go = $("#ttGo", m);
    const name = $("#ttName", m);
    name.select();
    name.onkeydown = (e) => {
      if (e.key === "Enter") go.click();
    };
    go.onclick = X.guard(async () => {
      go.disabled = true;
      go.innerHTML = `${ic("loader-circle", 15, "spin")}Kaydediliyor…`;
      try {
        const t = await api(`/api/posts/${post.id}/to-template`, { name: name.value, description: $("#ttDesc", m).value });
        X.S.templates = await api("/api/templates");
        X.closeModal();
        toast(`"${t.name}" şablonu kaydedildi; stil listelerinde "Senin" olarak görünür`);
        after?.(t);
      } catch (err) {
        go.disabled = false;
        go.innerHTML = `${ic("copy-plus", 15)}Şablon olarak kaydet`;
        throw err;
      }
    });
  }, "tt-dlg");
}

export function pickVideoForTemplate(X, after) {
  const { ic, esc } = X;
  const posts = (X.S.posts || []).filter((p) => p.video && !p.manual);
  X.modal(`<h2>${ic("copy-plus", 20)}Hangi videonun stili şablon olsun?</h2>
    <div class="sm muted" style="margin:-6px 0 10px">Beğendiğin bir videoyu seç; görsel dili yeni bir stil olarak kaydedilir.</div>
    ${posts.length ? `<div class="tt-grid">${posts.map((p) => `<button class="tt-item" data-pid="${p.id}"><div class="tt-th" style="${thumb(p) ? `background-image:url('${thumb(p)}')` : ""}">${thumb(p) ? "" : ic("film", 18)}</div><span>#${p.id} · ${esc(p.title)}</span></button>`).join("")}</div>`
      : `<div class="empty sm">Henüz hazır video yok.</div>`}
    <div class="foot"><button class="btn" data-close>Vazgeç</button></div>`, (m) => {
    m.onclick = (e) => {
      if (e.target === m) return X.closeModal();
      const b = e.target.closest("[data-pid]");
      if (!b) return;
      const post = posts.find((p) => p.id === b.dataset.pid);
      X.closeModal();
      setTimeout(() => saveAsTemplate(X, post, after), 0);
    };
  }, "tt-dlg wide");
}
