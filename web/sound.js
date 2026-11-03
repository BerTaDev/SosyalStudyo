const KEY = "sosyal-volume";
const live = new Set();
const seen = new WeakSet();
let st = load();
let X0 = null;
let cur = null;

function load() {
  try {
    return Object.assign({ v: 0.8, muted: false }, JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return { v: 0.8, muted: false };
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(st));
  } catch {}
}

const audible = (m) => !m.muted;
const level = () => (st.muted ? 0 : st.v);
const playing = () => [...live].filter((m) => !m.paused && !m.ended && audible(m));
const apply = (m) => {
  if (audible(m)) m.volume = level();
};

export function stopAll() {
  for (const m of playing()) m.pause();
  cur = null;
  render();
}

export function isPlaying(key) {
  return !!cur && cur.key === key && !cur.a.paused && !cur.a.ended;
}

export function playToggle(url, key) {
  if (isPlaying(key)) {
    cur.a.pause();
    cur = null;
    render();
    return null;
  }
  const a = new Audio(url);
  cur = { key, a };
  a.play().catch(() => {
    if (cur?.a === a) cur = null;
    render();
  });
  return a;
}

function icon() {
  return st.muted || st.v === 0 ? "volume-x" : st.v < 0.5 ? "volume-1" : "volume-2";
}

function render() {
  if (!X0) return;
  const { ic } = X0;
  const el = document.querySelector("#snd");
  if (el) {
    const n = playing().length;
    const sig = `${n}|${icon()}|${Math.round(st.v * 100)}|${st.muted}`;
    if (el.dataset.sig !== sig) {
      el.dataset.sig = sig;
      el.innerHTML = `${n ? `<button class="snd-stop" data-snd-stop title="Çalan sesi durdur"><span class="eq"><i></i><i></i><i></i></span>${ic("square", 11)}Durdur</button>` : ""}
        <button class="btn icon snd-btn ${st.muted ? "off" : ""}" id="sndBtn" title="Ses seviyesi: ${st.muted ? "kapalı" : `%${Math.round(st.v * 100)}`}">${ic(icon(), 18)}</button>`;
    }
  }
  const pop = document.querySelector("#sndPop");
  if (pop) {
    const n = playing().length;
    pop.querySelector("#sndPct").textContent = st.muted ? "Kapalı" : `%${Math.round(st.v * 100)}`;
    pop.querySelector("#sndMute").innerHTML = ic(icon(), 16);
    pop.querySelector("#sndMute").title = st.muted ? "Sesi aç" : "Sessize al";
    pop.querySelector("#sndStop2").classList.toggle("hidden", !n);
  }
  for (const b of document.querySelectorAll("[data-snd]")) {
    const on = isPlaying(b.dataset.snd);
    if (b.classList.contains("playing") === on) continue;
    b.classList.toggle("playing", on);
    b.innerHTML = ic(on ? "square" : "play", +(b.dataset.size || 13));
    b.title = on ? "Durdur" : "Dinle";
  }
}

function setLevel(v, muted = st.muted) {
  st = { v: Math.max(0, Math.min(1, v)), muted };
  save();
  for (const m of live) apply(m);
  for (const m of document.querySelectorAll("audio, video")) apply(m);
  render();
}

function togglePop(anchor) {
  const open = document.querySelector("#sndPop");
  if (open) return open.remove();
  const { ic } = X0;
  const pop = document.createElement("div");
  pop.id = "sndPop";
  pop.className = "snd-pop";
  pop.innerHTML = `<div class="row"><b>Ses</b><span class="grow"></span><span id="sndPct" class="sm muted"></span></div>
    <div class="row snd-row"><button class="btn icon sm" id="sndMute"></button><input type="range" id="sndRange" min="0" max="100" step="1" value="${Math.round(st.v * 100)}"></div>
    <div class="sm muted">Seslendirme önizlemeleri, ses örnekleri ve videolar bu seviyede çalar.</div>
    <button class="btn sm wide hidden" id="sndStop2" data-snd-stop>${ic("square", 12)}Çalan sesi durdur</button>`;
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(10, Math.min(innerWidth - pop.offsetWidth - 10, r.right - pop.offsetWidth))}px`;
  const range = pop.querySelector("#sndRange");
  const paint = () => range.style.setProperty("--p", `${range.value}%`);
  paint();
  range.oninput = () => {
    paint();
    setLevel(range.value / 100, false);
  };
  pop.querySelector("#sndMute").onclick = () => {
    if (st.muted || st.v === 0) setLevel(st.v || 0.6, false);
    else setLevel(st.v, true);
    range.value = Math.round(st.v * 100);
    paint();
  };
  const outside = (e) => {
    if (!pop.isConnected) return document.removeEventListener("mousedown", outside, true);
    if (!pop.contains(e.target) && !e.target.closest("#sndBtn")) {
      pop.remove();
      document.removeEventListener("mousedown", outside, true);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  render();
}

export function initSound(X) {
  X0 = X;
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (audible(this)) {
      for (const m of playing()) if (m !== this) m.pause();
      apply(this);
      live.add(this);
      if (!seen.has(this)) {
        seen.add(this);
        for (const ev of ["pause", "ended", "playing"]) this.addEventListener(ev, render);
        this.addEventListener("ended", () => {
          if (!this.isConnected) live.delete(this);
        });
      }
    }
    const p = orig.apply(this, args);
    queueMicrotask(render);
    return p;
  };
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-snd-stop]")) stopAll();
    else if (e.target.closest("#sndBtn")) togglePop(e.target.closest("#sndBtn"));
  });
  render();
}
