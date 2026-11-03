import { createEngine } from "./engine.js";

const params = new URLSearchParams(location.search);
const nocache = { cache: "no-store" };
const cfg = await (await fetch("config.json", nocache)).json();
const tl = await (await fetch("build/timeline.json", nocache)).json();
const { default: makeScene } = await import(new URL("src/scene.js", location.href).href);
const canvas = document.getElementById("view");
document.title = `${cfg.meta?.title || "Video"} · Önizleme`;

if (params.has("export")) {
  document.body.classList.add("export");
  const engine = await createEngine(canvas, cfg, tl, makeScene, { q: 1 });
  const g = canvas.getContext("2d");
  window.__info = { frames: engine.frames, fps: engine.fps, width: engine.W, height: engine.H, background: cfg.video.background || "#000000", footage: cfg.video.footage || null };
  window.__renderFrame = (i, opts = {}) => {
    engine.render(i / engine.fps, Object.assign({ preview: false }, opts));
    return canvas.toDataURL("image/png");
  };
  window.__exportRange = async (from, to) => {
    for (let i = from; i < to; i++) {
      engine.render(i / engine.fps, { preview: false });
      const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
      const r = await fetch(`/__frame?i=${i}`, { method: "POST", body: data });
      if (!r.ok) throw new Error(`frame ${i}`);
    }
    return to - from;
  };
  window.__ready = true;
} else {
  const fps = cfg.video.fps;
  const total = Math.round(tl.duration * fps);
  const $ = (id) => document.getElementById(id);
  $("title").textContent = cfg.meta?.title || "";
  const audio = new Audio("mix.wav");
  audio.preload = "auto";
  let engine = null;
  let frame = 0;
  let playing = false;
  const footage = cfg.video.footage ? Object.assign(document.createElement("video"), { src: cfg.video.footage, muted: true, playsInline: true, preload: "auto" }) : null;
  if (footage) {
    Object.assign(footage.style, { position: "absolute", objectFit: "cover", borderRadius: "10px", background: "#000" });
    Object.assign(canvas.style, { position: "relative", background: "transparent" });
    $("stage").style.position = "relative";
    canvas.before(footage);
    const fit = () => Object.assign(footage.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${canvas.offsetWidth}px`, height: `${canvas.offsetHeight}px` });
    new ResizeObserver(fit).observe($("stage"));
    fit();
    footage.onloadedmetadata = syncFootage;
  }

  $("dur").textContent = `${tl.duration.toFixed(2)} sn`;
  $("seek").max = total - 1;
  const opts = () => ({ preview: true, subtitles: $("optSub").checked, blur: $("optBlur").checked });

  async function boot() {
    engine = await createEngine(canvas, cfg, tl, makeScene, { q: $("optFull").checked ? 1 : 0.5 });
    draw();
  }
  function draw() {
    if (!engine) return;
    const t = frame / fps;
    engine.render(t, opts());
    $("seek").value = frame;
    $("clock").textContent = `${t.toFixed(2)} sn · kare ${frame}`;
    document.querySelectorAll(".scene").forEach((el) => el.classList.toggle("on", t >= +el.dataset.start && t < +el.dataset.end));
    syncFootage();
  }
  function syncFootage() {
    if (!footage || !(footage.duration > 0)) return;
    const target = Math.min(frame / fps, footage.duration);
    const run = playing && target < footage.duration;
    if (Math.abs(footage.currentTime - target) > (run ? 0.15 : 0.01)) footage.currentTime = target;
    if (run && footage.paused) footage.play().catch(() => {});
    else if (!run && !footage.paused) footage.pause();
  }
  function tick() {
    if (!playing) return;
    if ($("optAudio").checked && !audio.paused) frame = Math.min(total - 1, Math.floor(audio.currentTime * fps));
    else frame = Math.min(total - 1, frame + 1);
    if (frame >= total - 1) stop();
    draw();
    requestAnimationFrame(tick);
  }
  function play() {
    if (frame >= total - 1) frame = 0;
    playing = true;
    $("play").textContent = "Durdur";
    if ($("optAudio").checked) {
      audio.currentTime = frame / fps;
      audio.play().catch(() => {});
    }
    requestAnimationFrame(tick);
  }
  function stop() {
    playing = false;
    audio.pause();
    syncFootage();
    $("play").textContent = "Oynat";
  }
  function seek(f) {
    frame = Math.max(0, Math.min(total - 1, f));
    if (playing) audio.currentTime = frame / fps;
    draw();
  }
  $("play").onclick = () => (playing ? stop() : play());
  $("prev").onclick = () => seek(frame - 1);
  $("next").onclick = () => seek(frame + 1);
  $("seek").oninput = (e) => seek(+e.target.value);
  for (const id of ["optSub", "optBlur"]) $(id).onchange = draw;
  $("optFull").onchange = boot;
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      playing ? stop() : play();
    } else if (e.code === "ArrowLeft") seek(frame - (e.shiftKey ? fps : 1));
    else if (e.code === "ArrowRight") seek(frame + (e.shiftKey ? fps : 1));
  });
  for (const s of tl.scenes) {
    const b = document.createElement("button");
    b.className = "scene";
    b.dataset.start = s.start;
    b.dataset.end = s.end;
    b.innerHTML = `${s.name}<span>${s.start.toFixed(2)}–${s.end.toFixed(2)}</span>`;
    b.onclick = () => seek(Math.round(s.start * fps));
    $("scenes").appendChild(b);
  }
  await boot();
}
