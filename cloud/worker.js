const VERSION = 10
const STORAGE_LIMIT = 1073741824
const STORAGE_MARGIN = 16 * 1024 * 1024
const LEAD_MS = 10 * 60 * 1000
const MISSED_MS = 6 * 3600 * 1000
const PROCESS_MS = 45 * 60 * 1000
const UPLOAD_GRACE_MS = 5 * 60 * 1000
const REFRESH_MS = 20 * 86400 * 1000
const REFRESH_RETRY_MS = 6 * 3600 * 1000
const MAX_CHUNK = 20 * 1024 * 1024
const MAX_CHUNKS = 64
const MAX_ATTEMPTS = 5
const LOG_KEEP = 20
const OPS_BUDGET = 40
const STATUS_READS = 40
const EVENTS_KEEP = 25
const RECENT_KEEP = 12
const THUMB_MAX = 300 * 1024
const SNAP_MAX = 64 * 1024
const PANEL_TTL = 30 * 86400
const IGSTAT_KEEP = 90
const IG_LIVE_MS = 15 * 60 * 1000
const STUDIO_STALE_MS = 70 * 60 * 1000
const IG_FIELDS = "username,followers_count,follows_count,media_count"
const PID_RE = /^[\w-]{1,40}$/
const TOKEN_RE = /^[\w-]{16,64}$/
const STORED = new Set(["uploading", "ready", "preparing", "publishing", "error"])
const LOCKED = new Set(["preparing", "publishing", "published"])
const UPCOMING = new Set(["uploading", "ready", "preparing", "publishing"])
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613])
const ENTRY_KEYS = ["at", "status", "size", "chunks", "title", "permalink", "published_at", "error", "stage", "thumb"]
const PANEL_HEADERS = {
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; manifest-src 'self'",
  "x-frame-options": "DENY", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", "x-content-type-options": "nosniff",
}
const SITE_HEADERS = {
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", "x-content-type-options": "nosniff",
}
const SITE_ROUTES = new Map([["/", ["en", "home"]], ["/privacy", ["en", "privacy"]], ["/terms", ["en", "terms"]],
  ["/tr", ["tr", "home"]], ["/tr/privacy", ["tr", "privacy"]], ["/tr/terms", ["tr", "terms"]]])
const SITE_KEYS = ["owner_name", "email", "app_name", "channel_url", "instagram_url", "lang_default"]
const POLICY_DATE = "2026-11-02T00:00:00Z"
const EMAIL_RE = /^[^\s@<>"'()[\],;:\\]+@[^\s@<>"'()[\],;:\\]+\.[^\s@<>"'()[\],;:\\]{2,}$/
const ASSET_CACHE = "public, max-age=604800"

const iso = t => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z")
const enc = new TextEncoder()
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("")
const unhex = s => Uint8Array.from(s.match(/../g) || [], h => parseInt(h, 16))

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })
}

const fail = (error, status = 400, extra = {}) => json({ ok: false, error, ...extra }, status)

async function hmac(env, text) {
  const key = await crypto.subtle.importKey("raw", enc.encode(env.STUDIO_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(text)))
}

const sign = async (env, pid) => (await hmac(env, pid)).slice(0, 32)

function safeEqual(a, b) {
  a = String(a)
  b = String(b)
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

async function readIndex(env) {
  const idx = (await env.STORE.get("index", "json")) || {}
  idx.jobs = idx.jobs || {}
  idx.version = idx.version || 0
  return idx
}

async function writeIndex(env, idx) {
  idx.version = (idx.version || 0) + 1
  await env.STORE.put("index", JSON.stringify(idx))
}

function entryOf(job) {
  return {
    at: job.at, status: job.status, size: job.size, chunks: job.chunks, updated: job.updated,
    title: String(job.title || "").slice(0, 120), permalink: job.permalink || null, published_at: job.published_at || null,
    error: job.error ? String(job.error).slice(0, 200) : null, stage: job.status === "error" ? job.error_stage || null : null,
    thumb: !!job.thumb,
  }
}

function sameEntry(a, b) {
  return !!a && !!b && ENTRY_KEYS.every(k => a[k] === b[k])
}

function addEvent(idx, job, kind, text) {
  const ev = { at: iso(Date.now()), pid: job?.pid || null, title: job ? String(job.title || "").slice(0, 80) : null, kind, text: String(text).slice(0, 200) }
  idx.events = (idx.events || []).concat(ev).slice(-EVENTS_KEEP)
}

function addLog(job, text) {
  job.log = (job.log || []).concat({ at: iso(Date.now()), text }).slice(-LOG_KEEP)
}

async function putJob(env, job) {
  job.updated = iso(Date.now())
  await env.STORE.put(`job:${job.pid}`, JSON.stringify(job))
}

const getJob = (env, pid) => env.STORE.get(`job:${pid}`, "json")

function publicJob(job, lines) {
  const { log, ...rest } = job
  return { ...rest, log: (log || []).slice(-lines) }
}

function storage(idx) {
  let used = 0
  let videos = 0
  for (const e of Object.values(idx.jobs)) {
    if (STORED.has(e.status)) {
      used += e.size || 0
      videos++
    }
  }
  return { used, limit: STORAGE_LIMIT, videos }
}

function chunkLength(job, i) {
  return i < job.chunks - 1 ? job.chunk_size : job.size - job.chunk_size * (job.chunks - 1)
}

async function deleteChunks(env, pid, count) {
  for (let i = 0; i < count; i++) await env.STORE.delete(`vid:${pid}:${i}`)
}

async function missingChunks(env, job) {
  const listed = await env.STORE.list({ prefix: `vid:${job.pid}:` })
  const have = new Set(listed.keys.map(k => k.name))
  const missing = []
  for (let i = 0; i < job.chunks; i++) {
    const key = `vid:${job.pid}:${i}`
    if (have.has(key)) continue
    const s = await env.STORE.get(key, "stream")
    if (s) await s.cancel()
    else missing.push(i)
  }
  return missing
}

function igView(ig) {
  return ig ? { configured: !!ig.configured, user_id: ig.user_id || null, updated: ig.updated || null, refreshed: ig.refreshed || null }
    : { configured: false, user_id: null, updated: null, refreshed: null }
}

async function readBody(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

async function remember(env, idx, src, hasThumb) {
  const item = {
    pid: src.pid, title: String(src.title || "").slice(0, 120), at: src.at || null, permalink: src.permalink || null,
    published_at: src.published_at || null, thumb: hasThumb,
  }
  const list = (idx.recent || []).filter(r => r.pid !== src.pid).concat(item)
  const drop = list.slice(0, Math.max(0, list.length - RECENT_KEEP))
  idx.recent = list.slice(-RECENT_KEEP)
  for (const r of drop) if (r.thumb && !idx.jobs[r.pid]) await env.STORE.delete(`thumb:${r.pid}`)
}

async function api(request, env, url) {
  const parts = url.pathname.slice(5).split("/").filter(Boolean).map(decodeURIComponent)
  const method = request.method
  const route = `${method} ${parts[0] || ""}`

  if (route === "GET ping") return json({ ok: true, version: VERSION, now: iso(Date.now()) })

  if (route === "GET status") {
    const idx = await readIndex(env)
    const meta = (await env.STORE.get("meta", "json")) || {}
    const jobs = []
    let dirty = false
    let reads = 0
    for (const [pid, e] of Object.entries(idx.jobs)) {
      if (reads >= STATUS_READS) {
        jobs.push({ pid, ...e, log: [] })
        continue
      }
      reads++
      const job = await getJob(env, pid)
      if (!job) {
        delete idx.jobs[pid]
        dirty = true
        continue
      }
      if (!sameEntry(entryOf(job), e)) {
        idx.jobs[pid] = entryOf(job)
        dirty = true
      }
      jobs.push(publicJob(job, 5))
    }
    if (dirty) await writeIndex(env, idx)
    return json({
      ok: true, version: VERSION, now: iso(Date.now()), jobs, storage: storage(idx),
      meta: { ...meta, last_action: idx.last_action || null, last_error: idx.last_error || null },
      ig: igView(idx.ig),
    })
  }

  if (parts[0] === "config" && parts.length === 1) {
    if (method === "GET") {
      const cfg = await env.STORE.get("cfg:ig", "json")
      return json({ ok: true, user_id: cfg?.user_id || null, updated: cfg?.updated || null, refreshed: cfg?.refreshed || null,
        api_version: cfg?.api_version || "", token: cfg?.token || null })
    }
    if (method === "PUT") {
      const b = await readBody(request)
      const token = String(b.token || "").trim()
      const userId = String(b.user_id || "").trim()
      const version = String(b.api_version || "").trim()
      const cur = await env.STORE.get("cfg:ig", "json")
      if (cur && cur.token === token && cur.user_id === userId && (cur.api_version || "") === version) return json({ ok: true, changed: false })
      if (!cur && !token) return json({ ok: true, changed: false })
      const idx = await readIndex(env)
      if (!token) {
        await env.STORE.delete("cfg:ig")
        idx.ig = null
      } else {
        const stamp = b.updated && !Number.isNaN(Date.parse(b.updated)) ? iso(Date.parse(b.updated)) : iso(Date.now())
        const cfg = { token, user_id: userId, api_version: version, updated: stamp, refreshed: cur?.token === token ? cur.refreshed || null : null }
        await env.STORE.put("cfg:ig", JSON.stringify(cfg))
        idx.ig = { configured: !!userId, user_id: userId, kind: token.startsWith("IG") ? "IG" : "FB", updated: cfg.updated,
          refreshed: cfg.refreshed, checked: null }
      }
      addEvent(idx, null, "ig", token ? "Instagram bağlantısı güncellendi" : "Instagram bağlantısı kaldırıldı")
      await writeIndex(env, idx)
      return json({ ok: true, changed: true })
    }
  }

  if (route === "PUT meta") {
    const b = await readBody(request)
    const cur = (await env.STORE.get("meta", "json")) || {}
    const next = { ...cur }
    if (b.origin) next.origin = String(b.origin).replace(/\/+$/, "")
    if (b.deployed) next.deployed = String(b.deployed)
    next.version = VERSION
    if (JSON.stringify(next) !== JSON.stringify(cur)) await env.STORE.put("meta", JSON.stringify(next))
    return json({ ok: true, meta: next })
  }

  if (parts[0] === "panel" && parts.length === 1) {
    if (method === "GET") {
      const cfg = await env.STORE.get("cfg:panel", "json")
      return json({ ok: true, enabled: !!cfg, token: cfg?.token || null, created: cfg?.created || null, updated: cfg?.updated || null })
    }
    if (method === "PUT") {
      const b = await readBody(request)
      const token = String(b.token || "")
      const salt = String(b.salt || "").toLowerCase()
      const hash = String(b.hash || "").toLowerCase()
      const iterations = Number(b.iterations)
      if (!TOKEN_RE.test(token)) return fail("geçersiz panel anahtarı")
      if (!/^([0-9a-f]{2}){8,64}$/.test(salt)) return fail("geçersiz tuz")
      if (!/^[0-9a-f]{64}$/.test(hash)) return fail("geçersiz şifre özeti")
      if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 10000) return fail("geçersiz yineleme sayısı")
      const cur = await env.STORE.get("cfg:panel", "json")
      if (cur && cur.token === token && cur.salt === salt && cur.hash === hash && cur.iterations === iterations) {
        return json({ ok: true, changed: false, enabled: true, token, created: cur.created, updated: cur.updated })
      }
      const now = iso(Date.now())
      const cfg = { token, salt, hash, iterations, created: cur?.created || now, updated: now }
      await env.STORE.put("cfg:panel", JSON.stringify(cfg))
      return json({ ok: true, changed: true, enabled: true, token, created: cfg.created, updated: cfg.updated })
    }
    if (method === "DELETE") {
      const cur = await env.STORE.get("cfg:panel")
      if (cur) await env.STORE.delete("cfg:panel")
      return json({ ok: true, enabled: false, deleted: !!cur })
    }
  }

  if (parts[0] === "snapshot" && parts.length === 1) {
    if (method === "GET") {
      const snap = await env.STORE.get("snap", "json")
      return json({ ok: true, ...(snap || {}), snapshot: snap || null })
    }
    if (method === "PUT") {
      if (Number(request.headers.get("content-length") || 0) > SNAP_MAX) return fail("anlık durum 64 KB'yi aşıyor", 413)
      const raw = await request.arrayBuffer()
      if (raw.byteLength > SNAP_MAX) return fail("anlık durum 64 KB'yi aşıyor", 413)
      let snap
      try {
        snap = JSON.parse(new TextDecoder().decode(raw))
      } catch {
        return fail("geçersiz anlık durum")
      }
      if (!snap || typeof snap !== "object" || Array.isArray(snap)) return fail("geçersiz anlık durum")
      snap.received = iso(Date.now())
      await env.STORE.put("snap", JSON.stringify(snap))
      return json({ ok: true, size: raw.byteLength, received: snap.received })
    }
  }

  if (parts[0] === "site" && parts.length === 1) {
    if (method === "GET") return json({ ok: true, site: (await env.STORE.get("cfg:site", "json")) || null })
    if (method === "PUT") {
      const b = await readBody(request)
      const r = siteConfig(b)
      if (r.error) return fail(r.error)
      const cur = await env.STORE.get("cfg:site", "json")
      if (cur && SITE_KEYS.every(k => cur[k] === r.site[k]) && (!b.updated || cur.updated === r.site.updated)) {
        return json({ ok: true, changed: false, site: cur })
      }
      await env.STORE.put("cfg:site", JSON.stringify(r.site))
      return json({ ok: true, changed: true, site: r.site })
    }
    if (method === "DELETE") {
      const cur = await env.STORE.get("cfg:site")
      if (cur) await env.STORE.delete("cfg:site")
      return json({ ok: true, deleted: !!cur })
    }
  }

  if (parts[0] !== "jobs") return fail("yok", 404)

  if (method === "POST" && parts.length === 1) {
    const b = await readBody(request)
    const pid = String(b.pid || "")
    const at = Date.parse(b.at)
    const size = Number(b.size)
    const chunkSize = Number(b.chunk_size)
    const chunks = Number(b.chunks)
    if (!PID_RE.test(pid)) return fail("geçersiz kimlik")
    if (Number.isNaN(at)) return fail("geçersiz tarih")
    if (!(size > 0) || !(chunkSize > 0) || chunkSize > MAX_CHUNK || !Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS
      || chunks !== Math.ceil(size / chunkSize)) return fail("geçersiz parça planı")
    const caption = String(b.caption || "")
    if (caption.length > 2200) return fail("açıklama 2200 karakteri aşıyor")
    const idx = await readIndex(env)
    const old = idx.jobs[pid]
    if (old && old.status === "publishing") return fail("bu paylaşım şu an yayınlanıyor", 409)
    const others = storage({ jobs: Object.fromEntries(Object.entries(idx.jobs).filter(([k]) => k !== pid)) })
    if (others.used + size > STORAGE_LIMIT - STORAGE_MARGIN) return fail("bulut depolama alanı dolu", 507, { storage: others })
    if (old) await deleteChunks(env, pid, old.chunks || 0)
    const now = iso(Date.now())
    const thumb = b.thumb_offset === null || b.thumb_offset === undefined || b.thumb_offset === "" ? null : Math.max(0, Math.round(Number(b.thumb_offset)) || 0)
    const job = {
      pid, title: String(b.title || "").slice(0, 200), at: iso(at), caption, thumb_offset: thumb, kind: "reels",
      size, chunks, chunk_size: chunkSize, sha256: String(b.sha256 || ""), status: "uploading", created: now, updated: now,
      container_id: null, container_at: null, media_id: null, permalink: null, published_at: null, error: null, attempts: 0,
      verified: false, thumb: false, log: [],
    }
    addLog(job, "Video yükleniyor")
    await putJob(env, job)
    idx.jobs[pid] = entryOf(job)
    addEvent(idx, job, "upload", old ? "Video yeniden yükleniyor" : "Video buluta yükleniyor")
    await writeIndex(env, idx)
    return json({ ok: true, job: publicJob(job, 5) })
  }

  const pid = parts[1] || ""
  if (!PID_RE.test(pid)) return fail("geçersiz kimlik")

  if (method === "PUT" && parts[2] === "chunk" && parts.length === 4) {
    const i = Number(parts[3])
    const job = await getJob(env, pid)
    if (!job) return fail("iş yok", 404)
    if (job.status !== "uploading") return fail(`iş ${job.status} durumunda`, 409)
    if (!Number.isInteger(i) || i < 0 || i >= job.chunks) return fail("geçersiz parça")
    const buf = await request.arrayBuffer()
    if (buf.byteLength !== chunkLength(job, i)) return fail(`parça boyutu hatalı (${buf.byteLength})`)
    await env.STORE.put(`vid:${pid}:${i}`, buf, { metadata: { n: buf.byteLength } })
    return json({ ok: true, i, size: buf.byteLength })
  }

  if (method === "PUT" && parts[2] === "thumb" && parts.length === 3) {
    if (Number(request.headers.get("content-length") || 0) > THUMB_MAX) return fail("kapak 300 KB'den büyük", 413)
    const job = await getJob(env, pid)
    if (!job) return fail("iş yok", 404)
    const buf = await request.arrayBuffer()
    if (buf.byteLength > THUMB_MAX) return fail("kapak 300 KB'den büyük", 413)
    const head = new Uint8Array(buf, 0, Math.min(3, buf.byteLength))
    if (head.length < 3 || head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return fail("kapak JPEG değil")
    await env.STORE.put(`thumb:${pid}`, buf)
    if (!job.thumb) {
      job.thumb = true
      await putJob(env, job)
      const idx = await readIndex(env)
      if (idx.jobs[pid] && !sameEntry(entryOf(job), idx.jobs[pid])) {
        idx.jobs[pid] = entryOf(job)
        await writeIndex(env, idx)
      }
    }
    return json({ ok: true, size: buf.byteLength })
  }

  if (method === "POST" && parts[2] === "ready" && parts.length === 3) {
    const job = await getJob(env, pid)
    if (!job) return fail("iş yok", 404)
    const idx = await readIndex(env)
    if (job.status !== "uploading") {
      if (!sameEntry(entryOf(job), idx.jobs[pid])) {
        idx.jobs[pid] = entryOf(job)
        await writeIndex(env, idx)
      }
      return json({ ok: true, job: publicJob(job, 5) })
    }
    const missing = await missingChunks(env, job)
    if (missing.length) return fail("eksik parçalar var", 409, { missing })
    job.status = "ready"
    job.verified = true
    addLog(job, "Video bulutta, yayın saati bekleniyor")
    await putJob(env, job)
    idx.jobs[pid] = entryOf(job)
    addEvent(idx, job, "ready", "Video bulutta, yayın saati bekleniyor")
    await writeIndex(env, idx)
    return json({ ok: true, job: publicJob(job, 5) })
  }

  if (method === "POST" && parts[2] === "retry" && parts.length === 3) {
    const job = await getJob(env, pid)
    if (!job) return fail("iş yok", 404)
    const b = await readBody(request)
    if (job.status !== "error") return fail(`iş ${job.status} durumunda`, 409)
    if (!job.verified || job.purged) return fail("video bulutta eksik, yeniden yüklenmeli", 409)
    if (b.at !== undefined) {
      const at = Date.parse(b.at)
      if (Number.isNaN(at)) return fail("geçersiz tarih")
      job.at = iso(at)
    }
    Object.assign(job, { status: "ready", container_id: null, container_at: null, attempts: 0, error: null, error_stage: null })
    addLog(job, "Yeniden denenecek")
    await putJob(env, job)
    const idx = await readIndex(env)
    idx.jobs[pid] = entryOf(job)
    addEvent(idx, job, "retry", "Yeniden denenecek")
    await writeIndex(env, idx)
    return json({ ok: true, job: publicJob(job, 5) })
  }

  if (method === "PATCH" && parts.length === 2) {
    const job = await getJob(env, pid)
    if (!job) return fail("iş yok", 404)
    if (LOCKED.has(job.status)) return fail(`iş ${job.status} durumunda, değiştirilemez`, 409)
    const b = await readBody(request)
    const changes = []
    let atChanged = false
    let titleChanged = false
    if (b.at !== undefined) {
      const at = Date.parse(b.at)
      if (Number.isNaN(at)) return fail("geçersiz tarih")
      if (iso(at) !== job.at) {
        job.at = iso(at)
        atChanged = true
        changes.push("saat")
      }
    }
    if (b.caption !== undefined) {
      const caption = String(b.caption || "")
      if (caption.length > 2200) return fail("açıklama 2200 karakteri aşıyor")
      if (caption !== job.caption) {
        job.caption = caption
        changes.push("açıklama")
      }
    }
    if (b.thumb_offset !== undefined) {
      const thumb = b.thumb_offset === null || b.thumb_offset === "" ? null : Math.max(0, Math.round(Number(b.thumb_offset)) || 0)
      if (thumb !== job.thumb_offset) {
        job.thumb_offset = thumb
        changes.push("kapak")
      }
    }
    if (b.title !== undefined) {
      const title = String(b.title || "").slice(0, 200)
      if (title !== (job.title || "")) {
        titleChanged = title.slice(0, 120) !== String(job.title || "").slice(0, 120)
        job.title = title
        changes.push("başlık")
      }
    }
    if (!changes.length) return json({ ok: true, changed: false, job: publicJob(job, 5) })
    addLog(job, `Plan güncellendi: ${changes.join(", ")}`)
    await putJob(env, job)
    if (atChanged || titleChanged) {
      const idx = await readIndex(env)
      idx.jobs[pid] = entryOf(job)
      if (atChanged) addEvent(idx, job, "plan", "Yayın saati değişti")
      await writeIndex(env, idx)
    }
    return json({ ok: true, changed: true, job: publicJob(job, 5) })
  }

  if (method === "DELETE" && parts.length === 2) {
    const idx = await readIndex(env)
    const job = await getJob(env, pid)
    const entry = idx.jobs[pid]
    const count = Math.max(job?.chunks || 0, entry?.chunks || 0)
    if (!job && !entry) return json({ ok: true, deleted: false })
    await deleteChunks(env, pid, count)
    if (job) await env.STORE.delete(`job:${pid}`)
    const src = job || { pid, ...entry }
    const hasThumb = !!(job?.thumb || entry?.thumb)
    const published = src.status === "published"
    if (hasThumb && (!published || !entry)) await env.STORE.delete(`thumb:${pid}`)
    if (entry) {
      delete idx.jobs[pid]
      if (published) {
        await remember(env, idx, src, hasThumb)
        addEvent(idx, src, "synced", "Stüdyoya aktarıldı")
      } else {
        addEvent(idx, src, "canceled", "Buluttan kaldırıldı")
      }
      await writeIndex(env, idx)
    }
    return json({ ok: true, deleted: true })
  }

  return fail("yok", 404)
}

function parseRange(header, size) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === "" && m[2] === "")) return null
  let start
  let end
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start > end || start >= size) return { invalid: true }
  return { start, end }
}

async function pump(env, job, start, end, writable) {
  const cs = job.chunk_size
  try {
    for (let i = Math.floor(start / cs); i <= Math.floor(end / cs); i++) {
      const base = i * cs
      const length = chunkLength(job, i)
      const from = Math.max(start - base, 0)
      const to = Math.min(end - base + 1, length)
      const key = `vid:${job.pid}:${i}`
      if (from === 0 && to === length) {
        const s = await env.STORE.get(key, "stream")
        if (!s) throw new Error(`parça ${i} yok`)
        await s.pipeTo(writable, { preventClose: true })
      } else {
        const buf = await env.STORE.get(key, "arrayBuffer")
        if (!buf) throw new Error(`parça ${i} yok`)
        const w = writable.getWriter()
        await w.write(new Uint8Array(buf, from, to - from))
        w.releaseLock()
      }
    }
    await writable.close()
  } catch (e) {
    try {
      await writable.abort(e)
    } catch {}
  }
}

async function video(request, env, ctx, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 })
  const m = /^\/v\/([\w-]{1,40})\.mp4$/.exec(url.pathname)
  if (!m || !env.STUDIO_KEY) return new Response("yok", { status: 404 })
  const pid = m[1]
  if ((url.searchParams.get("s") || "") !== (await sign(env, pid))) return new Response("yetkisiz", { status: 403 })
  const job = await getJob(env, pid)
  if (!job || !job.verified || job.purged || !STORED.has(job.status)) return new Response("yok", { status: 404 })
  const range = parseRange(request.headers.get("range"), job.size)
  const headers = { "content-type": "video/mp4", "accept-ranges": "bytes", "cache-control": "no-store" }
  if (range?.invalid) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${job.size}` } })
  const start = range ? range.start : 0
  const end = range ? range.end : job.size - 1
  const length = end - start + 1
  headers["content-length"] = String(length)
  if (range) headers["content-range"] = `bytes ${start}-${end}/${job.size}`
  const status = range ? 206 : 200
  if (request.method === "HEAD") return new Response(null, { status, headers })
  const ts = typeof FixedLengthStream === "function" ? new FixedLengthStream(length) : new TransformStream()
  ctx.waitUntil(pump(env, job, start, end, ts.writable))
  return new Response(ts.readable, { status, headers })
}

function pjson(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...PANEL_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  })
}

const nothing = () => new Response("yok", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } })

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"])
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unhex(salt), iterations }, key, 256))
}

const sessionMac = (env, cfg, exp) => hmac(env, `panel|${cfg.token}|${exp}|${cfg.hash.slice(0, 16)}`)

function sessionCookie(url, token, value, maxAge) {
  return `sp=${value}; HttpOnly;${url.protocol === "https:" ? " Secure;" : ""} SameSite=Strict; Path=/p/${token}; Max-Age=${maxAge}`
}

async function hasSession(request, env, cfg) {
  const m = /(?:^|;\s*)sp=(\d{1,12})\.([0-9a-f]{64})(?:;|$)/.exec(request.headers.get("cookie") || "")
  if (!m || Number(m[1]) * 1000 <= Date.now()) return false
  return safeEqual(m[2], await sessionMac(env, cfg, m[1]))
}

async function panelData(env) {
  const [idx, snap, igs] = await Promise.all([readIndex(env), env.STORE.get("snap", "json"), env.STORE.get("igstat", "json")])
  const jobs = Object.entries(idx.jobs).map(([pid, e]) => ({ pid, ...e })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const n = jobs.find(j => UPCOMING.has(j.status))
  return {
    ok: true, now: iso(Date.now()), version: VERSION, storage: storage(idx), jobs,
    next: n ? { pid: n.pid, title: n.title || "", at: n.at, status: n.status, thumb: !!n.thumb } : null,
    recent: (idx.recent || []).slice().reverse(), events: (idx.events || []).slice().reverse(),
    ig: { configured: !!idx.ig?.configured, updated: idx.ig?.updated || null, refreshed: idx.ig?.refreshed || null },
    meta: { last_action: idx.last_action || null, last_error: idx.last_error || null }, snapshot: snap || null,
    igstat: await igStatView(env, idx, snap, igs),
  }
}

async function panel(request, env, url) {
  const parts = url.pathname.split("/").filter(Boolean)
  const token = parts[1] || ""
  if (!env.STUDIO_KEY || !TOKEN_RE.test(token)) return nothing()
  const cfg = await env.STORE.get("cfg:panel", "json")
  if (!cfg || !cfg.hash || !safeEqual(cfg.token, token)) return nothing()
  const method = request.method
  const route = parts.slice(2)
  if (!route.length) {
    if (method !== "GET" && method !== "HEAD") return nothing()
    return new Response(method === "HEAD" ? null : panelPage(token), {
      headers: { ...PANEL_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    })
  }
  if (route.length === 1 && (method === "GET" || method === "HEAD")) {
    if (Object.hasOwn(ICON_PNG, route[0])) return iconResponse(route[0], method)
    if (route[0] === "manifest.webmanifest") {
      return new Response(method === "HEAD" ? null : panelManifest(token), {
        headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": ASSET_CACHE, "x-content-type-options": "nosniff", "x-robots-tag": "noindex" },
      })
    }
  }
  if (route.length === 1 && route[0] === "login" && method === "POST") {
    const b = await readBody(request)
    const password = typeof b.password === "string" ? b.password : ""
    const ok = password.length > 0 && password.length <= 256 && safeEqual(await pbkdf2(password, cfg.salt, cfg.iterations), cfg.hash)
    if (!ok) {
      await new Promise(r => setTimeout(r, 400))
      return pjson({ ok: false, error: "Şifre yanlış" }, 401)
    }
    const exp = Math.floor(Date.now() / 1000) + PANEL_TTL
    const mac = await sessionMac(env, cfg, exp)
    return pjson({ ok: true }, 200, { "set-cookie": sessionCookie(url, token, `${exp}.${mac}`, PANEL_TTL) })
  }
  if (route.length === 1 && route[0] === "logout" && method === "POST") {
    return pjson({ ok: true }, 200, { "set-cookie": sessionCookie(url, token, "", 0) })
  }
  if (method !== "GET" || !["data", "job", "thumb"].includes(route[0])) return nothing()
  if (!(await hasSession(request, env, cfg))) return pjson({ ok: false, error: "Oturum kapalı", login: true }, 401)
  if (route[0] === "data" && route.length === 1) return pjson(await panelData(env))
  if (route[0] === "job" && route.length === 2) {
    const pid = decodeURIComponent(route[1])
    if (!PID_RE.test(pid)) return nothing()
    const job = await getJob(env, pid)
    if (!job) return pjson({ ok: false, error: "Kayıt bulunamadı" }, 404)
    const playable = job.verified && !job.purged && STORED.has(job.status)
    return pjson({ ok: true, job: publicJob(job, LOG_KEEP), video: playable ? `/v/${pid}.mp4?s=${await sign(env, pid)}` : null })
  }
  if (route[0] === "thumb" && route.length === 2) {
    const m = /^([\w-]{1,40})\.jpg$/.exec(route[1])
    if (!m) return nothing()
    const buf = await env.STORE.get(`thumb:${m[1]}`, "arrayBuffer")
    if (!buf) return nothing()
    return new Response(buf, { headers: { ...PANEL_HEADERS, "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } })
  }
  return nothing()
}

async function graph(run, cfg, method, path, params) {
  const host = cfg.token.startsWith("IG") ? "https://graph.instagram.com" : "https://graph.facebook.com"
  let url = cfg.api_version ? `${host}/${cfg.api_version}/${path}` : `${host}/${path}`
  const init = { method, headers: { authorization: `Bearer ${cfg.token}` } }
  if (method === "GET") url += "?" + new URLSearchParams(params)
  else init.body = new URLSearchParams(params)
  run.ops++
  let res
  try {
    res = await fetch(url, init)
  } catch (e) {
    return { ok: false, fatal: false, message: `bağlantı hatası (${e.message})` }
  }
  let data = null
  try {
    data = await res.json()
  } catch {}
  if (res.ok && data && !data.error) return { ok: true, data }
  const err = (data && data.error) || {}
  const message = err.error_user_msg || err.message || `HTTP ${res.status}`
  const transient = res.status >= 500 || res.status === 429 || err.is_transient === true || TRANSIENT_CODES.has(err.code)
  return { ok: false, fatal: !transient, status: res.status, message }
}

async function igConfig(run) {
  if (run.cfg === undefined) {
    run.ops++
    run.cfg = await run.env.STORE.get("cfg:ig", "json")
  }
  return run.cfg && run.cfg.token && run.cfg.user_id ? run.cfg : null
}

async function originOf(run) {
  if (run.meta === undefined) {
    run.ops++
    run.meta = (await run.env.STORE.get("meta", "json")) || {}
  }
  return run.meta.origin || null
}

async function save(run, job, index = true) {
  run.ops++
  await putJob(run.env, job)
  if (index) {
    run.idx.jobs[job.pid] = entryOf(job)
    run.dirty = true
  }
}

async function failJob(run, job, text) {
  job.error_stage = job.status
  job.status = "error"
  job.error = text
  addLog(job, text)
  run.idx.last_error = { at: iso(Date.now()), pid: job.pid, text }
  addEvent(run.idx, job, "error", text)
  await save(run, job)
}

async function softFail(run, job, text, r) {
  job.attempts = (job.attempts || 0) + 1
  if (r.fatal || job.attempts >= MAX_ATTEMPTS) return failJob(run, job, `${text}: ${r.message}`)
  addLog(job, `${text} (deneme ${job.attempts}/${MAX_ATTEMPTS}): ${r.message}`)
  await save(run, job, false)
}

async function createContainer(run, job) {
  const cfg = await igConfig(run)
  const origin = await originOf(run)
  if (!cfg || !origin) {
    if (Date.now() >= Date.parse(job.at)) await failJob(run, job, cfg ? "Bulut adresi kayıtlı değil" : "Instagram bağlantısı bulutta yok")
    return
  }
  const params = {
    media_type: "REELS", video_url: `${origin}/v/${job.pid}.mp4?s=${await sign(run.env, job.pid)}`,
    caption: job.caption || "", share_to_feed: "true",
  }
  if (job.thumb_offset) params.thumb_offset = String(Math.round(job.thumb_offset))
  const r = await graph(run, cfg, "POST", `${cfg.user_id}/media`, params)
  if (!r.ok || !r.data.id) return softFail(run, job, "Instagram'a gönderilemedi", r.ok ? { fatal: true, message: "kimlik dönmedi" } : r)
  Object.assign(job, { status: "preparing", container_id: String(r.data.id), container_at: iso(Date.now()), attempts: 0, error: null })
  addLog(job, "Instagram'a gönderildi, video işleniyor")
  addEvent(run.idx, job, "preparing", "Instagram'a gönderildi, video işleniyor")
  await save(run, job)
}

async function finishPublished(run, job, cfg, mediaId, permalink) {
  job.media_id = mediaId ? String(mediaId) : null
  if (mediaId && !permalink) {
    const info = await graph(run, cfg, "GET", job.media_id, { fields: "permalink,timestamp" })
    if (info.ok) permalink = info.data.permalink || null
  }
  Object.assign(job, { status: "published", permalink: permalink || null, published_at: iso(Date.now()), error: null, purged: true })
  addLog(job, "Instagram'da yayınlandı")
  run.idx.last_action = { at: job.published_at, pid: job.pid, text: "Yayınlandı" }
  addEvent(run.idx, job, "published", "Instagram'da yayınlandı")
  await save(run, job)
  run.ops += job.chunks
  await deleteChunks(run.env, job.pid, job.chunks)
}

async function publishNow(run, job, cfg) {
  if (job.status !== "publishing") {
    job.status = "publishing"
    addLog(job, "Yayınlanıyor")
    await save(run, job, false)
  }
  const r = await graph(run, cfg, "POST", `${cfg.user_id}/media_publish`, { creation_id: job.container_id })
  if (r.ok && r.data.id) return finishPublished(run, job, cfg, r.data.id)
  return softFail(run, job, "Yayınlanamadı", r.ok ? { fatal: true, message: "kimlik dönmedi" } : r)
}

async function containerStatus(run, job, cfg) {
  const r = await graph(run, cfg, "GET", job.container_id, { fields: "status_code,status" })
  if (!r.ok) {
    if (r.fatal) await failJob(run, job, `Instagram durumu okunamadı: ${r.message}`)
    else if (Date.now() - Date.parse(job.container_at || job.updated) > PROCESS_MS) await failJob(run, job, `Instagram'a ulaşılamadı: ${r.message}`)
    return null
  }
  const code = r.data.status_code || null
  if (code === "ERROR" || code === "EXPIRED") {
    await failJob(run, job, `Instagram videoyu işleyemedi: ${r.data.status || code}`)
    return null
  }
  return code || "FINISHED"
}

async function checkPreparing(run, job) {
  const cfg = await igConfig(run)
  if (!cfg) return failJob(run, job, "Instagram bağlantısı bulutta yok")
  const code = await containerStatus(run, job, cfg)
  if (!code) return
  if (code === "PUBLISHED") return recoverPublished(run, job, cfg)
  if (code === "FINISHED") {
    if (Date.now() >= Date.parse(job.at)) await publishNow(run, job, cfg)
    return
  }
  if (Date.now() - Date.parse(job.container_at) > PROCESS_MS) await failJob(run, job, "Instagram videoyu 45 dakikada işleyemedi")
}

async function recoverPublished(run, job, cfg) {
  const r = await graph(run, cfg, "GET", `${cfg.user_id}/media`, { fields: "id,permalink,timestamp", limit: "5" })
  const since = Date.parse(job.container_at || job.at) - 60000
  const hit = r.ok ? (r.data.data || []).find(m => Date.parse(m.timestamp) >= since) : null
  return finishPublished(run, job, cfg, hit?.id || null, hit?.permalink || null)
}

async function checkPublishing(run, job) {
  const cfg = await igConfig(run)
  if (!cfg) return failJob(run, job, "Instagram bağlantısı bulutta yok")
  const code = await containerStatus(run, job, cfg)
  if (!code) return
  if (code === "PUBLISHED") return recoverPublished(run, job, cfg)
  if (code === "FINISHED") return publishNow(run, job, cfg)
  if (Date.now() - Date.parse(job.container_at) > PROCESS_MS) await failJob(run, job, "Instagram videoyu 45 dakikada işleyemedi")
}

async function step(run, pid) {
  run.ops++
  const job = await getJob(run.env, pid)
  if (!job) {
    delete run.idx.jobs[pid]
    run.dirty = true
    return
  }
  if (!sameEntry(entryOf(job), run.idx.jobs[pid])) {
    run.idx.jobs[pid] = entryOf(job)
    run.dirty = true
  }
  const now = Date.now()
  const at = Date.parse(job.at)
  if (job.status === "uploading") {
    if (now - at > UPLOAD_GRACE_MS) await failJob(run, job, "Video buluta tamamen yüklenmedi")
    return
  }
  if (job.status === "ready") {
    if (at - now > LEAD_MS) return
    if (now - at > MISSED_MS) return failJob(run, job, "Planlanan saat kaçtı")
    return createContainer(run, job)
  }
  if (job.status === "preparing") return checkPreparing(run, job)
  if (job.status === "publishing") return checkPublishing(run, job)
}

function needsRefresh(ig, now) {
  return !!ig && ig.kind === "IG" && !!ig.updated && now - Date.parse(ig.updated) > REFRESH_MS
    && (!ig.checked || now - Date.parse(ig.checked) > REFRESH_RETRY_MS)
}

async function refreshToken(run) {
  const idx = run.idx
  const cfg = await igConfig(run)
  const stamp = iso(Date.now())
  idx.ig.checked = stamp
  run.dirty = true
  if (!cfg || !cfg.token.startsWith("IG")) return
  run.ops++
  let data = null
  let message = ""
  try {
    const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(cfg.token)}`)
    data = await res.json().catch(() => null)
    if (!res.ok || !data?.access_token) message = data?.error?.message || `HTTP ${res.status}`
  } catch (e) {
    message = e.message
  }
  if (message) {
    idx.last_error = { at: stamp, pid: null, text: `Instagram anahtarı yenilenemedi: ${message}` }
    addEvent(idx, null, "warn", `Instagram anahtarı yenilenemedi: ${message}`)
    return
  }
  Object.assign(cfg, { token: data.access_token, updated: stamp, refreshed: stamp })
  run.ops++
  await run.env.STORE.put("cfg:ig", JSON.stringify(cfg))
  Object.assign(idx.ig, { updated: stamp, refreshed: stamp })
  idx.last_action = { at: stamp, pid: null, text: "Instagram anahtarı yenilendi" }
  addEvent(idx, null, "token", "Instagram anahtarı yenilendi")
}

let igLive = null
const utcDay = t => new Date(t).toISOString().slice(0, 10)

function igPick(d) {
  const n = v => (typeof v === "number" ? v : null)
  return { username: d.username || null, followers: n(d.followers_count), follows: n(d.follows_count), media: n(d.media_count) }
}

async function dailyIgStat(run) {
  const day = utcDay(Date.now())
  run.idx.ig_day = day
  run.dirty = true
  const cfg = await igConfig(run)
  if (!cfg) return
  const r = await graph(run, cfg, "GET", cfg.user_id, { fields: IG_FIELDS })
  if (!r.ok) return
  run.ops += 2
  const cur = (await run.env.STORE.get("igstat", "json")) || {}
  const p = igPick(r.data)
  const hist = (cur.hist || []).filter(h => h.d !== day).concat([{ d: day, f: p.followers, m: p.media }]).slice(-IGSTAT_KEEP)
  await run.env.STORE.put("igstat", JSON.stringify({ ...p, at: iso(Date.now()), hist }))
}

async function igStatView(env, idx, snap, stored) {
  const base = stored ? { ...stored, live: false } : null
  if (!idx.ig?.configured) return base
  if (Date.now() - (Date.parse(snap?.stats?.at || "") || 0) < STUDIO_STALE_MS) return base
  if (!igLive || Date.now() - igLive.t >= IG_LIVE_MS || igLive.t > Date.now()) {
    const cfg = await env.STORE.get("cfg:ig", "json")
    if (!cfg || !cfg.token || !cfg.user_id) return base
    const r = await graph({ ops: 0 }, cfg, "GET", cfg.user_id, { fields: IG_FIELDS })
    if (!r.ok || !r.data) return base
    igLive = { t: Date.now(), data: { ...igPick(r.data), at: iso(Date.now()) } }
  }
  return { hist: [], ...(stored || {}), ...igLive.data, live: true }
}

async function cron(env) {
  const idx = await env.STORE.get("index", "json")
  if (!idx || !idx.jobs) return { idle: true }
  const now = Date.now()
  const due = []
  for (const [pid, e] of Object.entries(idx.jobs)) {
    if (e.status === "preparing" || e.status === "publishing") due.push(pid)
    else if ((e.status === "ready" || e.status === "uploading") && Date.parse(e.at) - now <= LEAD_MS) due.push(pid)
  }
  const refresh = needsRefresh(idx.ig, now)
  const statDay = !!idx.ig?.configured && idx.ig_day !== utcDay(now)
  if (!due.length && !refresh && !statDay) return { idle: true }
  const run = { env, idx, cfg: undefined, meta: undefined, dirty: false, ops: 1 }
  due.sort((a, b) => Date.parse(idx.jobs[a].at) - Date.parse(idx.jobs[b].at))
  for (const pid of due) {
    if (run.ops > OPS_BUDGET) break
    try {
      await step(run, pid)
    } catch (e) {
      idx.last_error = { at: iso(Date.now()), pid, text: `Zamanlayıcı hatası: ${e.message}` }
      run.dirty = true
    }
  }
  if (refresh && run.ops <= OPS_BUDGET) await refreshToken(run)
  if (statDay && run.ops <= OPS_BUDGET) await dailyIgStat(run)
  if (run.dirty) await writeIndex(env, idx)
  return { idle: false, due: due.length }
}

// Lucide icons, ISC License, https://lucide.dev
const PANEL_ICONS = {
  "youtube": '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/> <path d="m10 15 5-3-5-3z"/>',
  "bot": '<path d="M12 8V4H8"/> <rect width="16" height="12" x="4" y="8" rx="2"/> <path d="M2 14h2"/> <path d="M20 14h2"/> <path d="M15 13v2"/> <path d="M9 13v2"/>',
  "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/> <circle cx="9" cy="7" r="4"/> <path d="M22 21v-2a4 4 0 0 0-3-3.87"/> <path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  "heart": '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  "message-circle": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  "trending-up": '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/> <polyline points="16 7 22 7 22 13"/>',
  "trending-down": '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  "list-checks": '<path d="m3 17 2 2 4-4"/> <path d="m3 7 2 2 4-4"/> <path d="M13 6h8"/> <path d="M13 12h8"/> <path d="M13 18h8"/>',
  "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/> <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  "workflow": '<rect width="8" height="8" x="3" y="3" rx="2"/> <path d="M7 11v4a2 2 0 0 0 2 2h4"/> <rect width="8" height="8" x="13" y="13" rx="2"/>',
  "music": '<path d="M9 18V5l12-2v13"/> <circle cx="6" cy="18" r="3"/> <circle cx="18" cy="16" r="3"/>',
  "zap": '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  "circle-pause": '<circle cx="12" cy="12" r="10"/> <line x1="10" x2="10" y1="15" y2="9"/> <line x1="14" x2="14" y1="15" y2="9"/>',
  "clock": '<circle cx="12" cy="12" r="10"/> <polyline points="12 6 12 12 16 14"/>',
  "layers": '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  "chart-column": '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  "layout-dashboard": '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  "wand-sparkles": '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/> <path d="m14 7 3 3"/> <path d="M5 6v4"/> <path d="M19 14v4"/> <path d="M10 2v2"/> <path d="M7 8H3"/> <path d="M21 16h-4"/> <path d="M11 3H9"/>',
  "circle-arrow-up": '<circle cx="12" cy="12" r="10"/> <path d="m16 12-4-4-4 4"/> <path d="M12 16V8"/>',
  "palette": '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  "sparkles": '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  "pause": '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  "copy": '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  "cloud-upload": '<path d="M12 13v8"/><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="m8 17 4-4 4 4"/>',
  "cloud-check": '<path d="m17 15-5.5 5.5L9 18"/><path d="M5 17.743A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.742"/>',
  "cloud-off": '<path d="m2 2 20 20"/><path d="M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193"/><path d="M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07"/>',
  "refresh-cw": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "loader-circle": '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  "triangle-alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
  "monitor-off": '<path d="M17 17H4a2 2 0 0 1-2-2V5c0-1.5 1-2 1-2"/><path d="M22 15V5a2 2 0 0 0-2-2H9"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m2 2 20 20"/>',
  "hard-drive": '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18"/><circle cx="12" cy="8" r="2"/><rect width="16" height="16" x="6" y="2" rx="2"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  clapperboard: '<path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3Z"/><path d="m6.2 5.3 3.1 3.9"/><path d="m12.4 3.4 3.1 4"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  "calendar-clock": '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
  "calendar-days": '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  "circle-check": '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  "key-round": '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  "external-link": '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
}

const PANEL_CSS = `
:root{--accent-rgb:255,106,61;--pbtn2:#ff4d6a;--bg:#141519;--bg2:#1b1d22;--bg2h:#1f2127;--bg3:#24272d;--bg4:#2e3239;--line:#2d3138;--line2:#3b4048;--text:#e8eaed;--soft:#c9cdd4;--muted:#9198a3;--faint:#6c727c;--accent:#ff6a3d;--accent2:#ff8f6b;--pink:#e1306c;--blue:#4c8dff;--green:#2bc46a;--yellow:#f2c14e;--red:#ef4f4f;--ok:#7ee2a6;--okbg:rgba(43,196,106,.14);--okln:rgba(43,196,106,.38);--warn:#ffd98a;--warnbg:rgba(242,193,78,.12);--warnln:rgba(242,193,78,.38);--bad:#ff9d9d;--badbg:rgba(239,79,79,.13);--badln:rgba(239,79,79,.45);--info:#9fc0ff;--infobg:rgba(76,141,255,.14);--infoln:rgba(76,141,255,.45);--acc:#ffb59c;--accbg:rgba(var(--accent-rgb),.14);--accln:rgba(var(--accent-rgb),.42);--glass:rgba(20,21,25,.74);--shadow:0 1px 0 rgba(255,255,255,.025) inset,0 10px 28px -12px rgba(0,0,0,.55);--thumb:#0b0b0d;--num1:#fff;--num2:#ffbfa8;--clock:rgba(0,0,0,.24);--glow1:rgba(var(--accent-rgb),.13);--glow2:rgba(225,48,108,.09);--herobg1:rgba(var(--accent-rgb),.2);--herobg2:rgba(225,48,108,.13);color-scheme:dark}
@media (prefers-color-scheme:light){:root{--accent-rgb:255,106,61;--pbtn2:#ff4d6a;--bg:#f3f4f7;--bg2:#fff;--bg2h:#fbfbfc;--bg3:#f1f2f5;--bg4:#e5e8ec;--line:#e4e6ea;--line2:#d3d7dd;--text:#15171b;--soft:#3a3f47;--muted:#667080;--faint:#949aa5;--accent:#f2592a;--accent2:#e04a1c;--ok:#13773f;--okbg:rgba(43,196,106,.13);--okln:rgba(30,150,80,.32);--warn:#8a5b00;--warnbg:rgba(242,173,30,.15);--warnln:rgba(200,140,0,.38);--bad:#c22c2c;--badbg:rgba(239,79,79,.09);--badln:rgba(220,60,60,.38);--info:#1f5fd6;--infobg:rgba(76,141,255,.11);--infoln:rgba(60,120,240,.38);--acc:#c9410f;--accbg:rgba(var(--accent-rgb),.11);--accln:rgba(240,90,40,.4);--glass:rgba(255,255,255,.8);--shadow:0 1px 2px rgba(16,24,40,.04),0 10px 26px -14px rgba(16,24,40,.16);--thumb:#dde1e6;--num1:#1a1c20;--num2:#e2471a;--clock:rgba(255,255,255,.75);--glow1:rgba(var(--accent-rgb),.11);--glow2:rgba(225,48,108,.07);--herobg1:rgba(var(--accent-rgb),.14);--herobg2:rgba(225,48,108,.08);color-scheme:light}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--bg);color:var(--text);font:14px/1.45 "Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,sans-serif;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent}
body::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(70vmax 42vmax at -12% -14%,var(--glow1),transparent 62%),radial-gradient(55vmax 38vmax at 112% -8%,var(--glow2),transparent 60%)}
body.lock{overflow:hidden}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}
a{color:inherit}
.ic{display:block;flex:none}
.spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.grow{flex:1;min-width:0}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;padding:0;margin:-1px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:9px 15px;border-radius:12px;background:var(--bg3);border:1px solid var(--line2);font-weight:600;font-size:13.5px;text-decoration:none;white-space:nowrap;transition:transform .15s,filter .15s,box-shadow .2s}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.65;cursor:default}
.btn.primary{background:linear-gradient(135deg,var(--accent),var(--pbtn2));border-color:transparent;color:#fff;box-shadow:0 10px 22px -8px rgba(var(--accent-rgb),.65)}
.btn.ig{background:linear-gradient(90deg,#f58529,#dd2a7b 60%,#8134af);border-color:transparent;color:#fff}
.btn.sm{min-height:32px;padding:5px 11px;font-size:12.5px;border-radius:10px}
.btn.wide{width:100%}
@media (hover:hover){.btn:hover{filter:brightness(1.08)}}
.ib{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;flex:none;color:var(--muted);background:var(--bg3);border:1px solid var(--line);transition:color .15s,transform .15s,border-color .15s}
.ib:active{transform:scale(.92)}
@media (hover:hover){.ib:hover{color:var(--text);border-color:var(--line2)}}
.tag{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:650;letter-spacing:0;text-transform:none;padding:2px 9px 2px 7px;border-radius:999px;background:var(--bg4);color:var(--soft);white-space:nowrap;flex:none}
.tag.ok{background:var(--okbg);color:var(--ok)}.tag.warn{background:var(--warnbg);color:var(--warn)}.tag.bad{background:var(--badbg);color:var(--bad)}.tag.info{background:var(--infobg);color:var(--info)}.tag.acc{background:var(--accbg);color:var(--acc)}.tag.mute{color:var(--muted)}
.boot{min-height:100vh;min-height:100dvh;display:grid;place-items:center}
.logo{width:36px;height:36px;border-radius:11px;flex:none;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--accent),var(--pink));box-shadow:0 8px 18px -6px rgba(var(--accent-rgb),.6)}
.boot .logo{width:58px;height:58px;border-radius:18px;animation:breathe 1.4s ease-in-out infinite}
@keyframes breathe{50%{transform:scale(.9);opacity:.65}}
.boot-err{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;color:var(--muted);padding:24px}
.boot-err b{color:var(--text);font-size:16px}
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:11px;padding:calc(10px + env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 10px max(16px,env(safe-area-inset-left));background:var(--glass);-webkit-backdrop-filter:saturate(1.6) blur(16px);backdrop-filter:saturate(1.6) blur(16px);border-bottom:1px solid var(--line)}
.brand{display:flex;flex-direction:column;line-height:1.2;min-width:0;flex:1}
.brand b{font-size:15.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.brand b em{font-style:normal;color:var(--acc);font-weight:650}
.brand>span{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);white-space:nowrap}
.ld{width:7px;height:7px;border-radius:50%;background:var(--green);animation:ping 2.4s ease-out infinite}
.ld.bad{background:var(--red);animation:none}
@keyframes ping{0%{box-shadow:0 0 0 0 rgba(43,196,106,.6)}70%,100%{box-shadow:0 0 0 7px rgba(43,196,106,0)}}
.acts{display:flex;gap:8px}
.wrap{max-width:1180px;margin:0 auto;padding:12px max(14px,env(safe-area-inset-right)) calc(26px + env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left))}
.strip{display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;margin:0 -14px 12px;padding:2px 14px}
.strip::-webkit-scrollbar{display:none}
.chip{display:inline-flex;align-items:center;gap:6px;flex:none;font-size:12.5px;font-weight:550;padding:6px 11px 6px 10px;border-radius:999px;background:var(--bg2);border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.chip .dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.chip.ok{color:var(--ok);background:var(--okbg);border-color:var(--okln)}
.chip.ok .dot{animation:ping 2.4s ease-out infinite}
.chip.warn{color:var(--warn);background:var(--warnbg);border-color:var(--warnln)}
.chip.bad{color:var(--bad);background:var(--badbg);border-color:var(--badln)}
.chip.ig{color:var(--text)}
.chip.ig .ic{color:#e1306c}
.cols{display:flex;flex-direction:column;gap:14px}
.col{display:contents}
.o1{order:1}.o2{order:2}.o3{order:3}.o4{order:4}.o5{order:5}.o6{order:6}.o7{order:7}.o8{order:8}
@media (min-width:940px){.cols{display:grid;grid-template-columns:minmax(0,1.42fr) minmax(330px,1fr);gap:18px;align-items:start}.col{display:flex;flex-direction:column;gap:16px}}
section{scroll-margin-top:76px}
.card{background:var(--bg2);border:1px solid var(--line);border-radius:18px;padding:14px 15px;box-shadow:var(--shadow);min-width:0}
.ch{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
.ch .tag{margin-left:auto}
.chs{text-transform:none;letter-spacing:0;font-weight:500;color:var(--faint)}
.sh{display:flex;align-items:center;gap:8px;margin:4px 2px 10px;font-size:12px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.sh .n{min-width:22px;height:20px;padding:0 6px;border-radius:10px;background:var(--bg3);border:1px solid var(--line);display:inline-grid;place-items:center;font-size:11px;color:var(--text);letter-spacing:0}
.sh .chs{margin-left:auto}
.first .rise{animation:rise .55s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0) * 55ms)}
@keyframes rise{from{opacity:0;transform:translateY(12px)}}
.banner{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:16px;margin-bottom:12px;border:1px solid var(--line);background:var(--bg2)}
.banner[data-open]{cursor:pointer}
.banner .bi{width:36px;height:36px;border-radius:11px;flex:none;display:grid;place-items:center}
.banner .grow{display:flex;flex-direction:column;gap:2px}
.banner b{font-size:13.5px}
.banner .grow span{font-size:12.5px;color:var(--soft);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.banner>.ic{color:var(--faint)}
.banner.bad{border-color:var(--badln);background:linear-gradient(100deg,var(--badbg),transparent 80%),var(--bg2)}
.banner.bad .bi{background:var(--badbg);color:var(--bad)}
.banner.warn{border-color:var(--warnln);background:linear-gradient(100deg,var(--warnbg),transparent 80%),var(--bg2)}
.banner.warn .bi{background:var(--warnbg);color:var(--warn)}
.hero{position:relative;overflow:hidden;border-radius:24px;padding:16px;border:1px solid var(--accln);background:radial-gradient(130% 95% at 0% 0%,var(--herobg1),transparent 62%),radial-gradient(90% 80% at 100% 100%,var(--herobg2),transparent 66%),var(--bg2);box-shadow:var(--shadow),0 24px 50px -28px rgba(var(--accent-rgb),.55)}
.hero::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.06) 50%,transparent 65%);transform:translateX(-100%);animation:sheen 7s ease-in-out 1.2s infinite}
@keyframes sheen{0%,62%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.hero.idle{border-color:var(--line);box-shadow:var(--shadow)}
.hero.idle::after{display:none}
.hh{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--acc)}
.hh .tag{margin-left:auto}
.hin{display:flex;gap:14px;margin-top:14px;align-items:center;cursor:pointer;border-radius:14px;outline:none}
.hth{position:relative;width:76px;aspect-ratio:9/16;flex:none;border-radius:14px;overflow:hidden;background:var(--thumb);display:grid;place-items:center;color:var(--faint);box-shadow:0 12px 26px -12px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.06)}
.hb{min-width:0;flex:1}
.hb h2{margin:0;font-size:18.5px;line-height:1.28;font-weight:700;letter-spacing:-.01em;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.hwhen{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px;font-size:13px;color:var(--soft)}
.hwhen b{color:var(--text);font-variant-numeric:tabular-nums}
.hst{display:flex;align-items:center;gap:6px;margin-top:5px;font-size:12.5px;color:var(--muted)}
.clock{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:16px}
.clock>span{display:flex;flex-direction:column;align-items:center;padding:12px 4px 9px;border-radius:15px;background:var(--clock);border:1px solid var(--line)}
.clock b{font-size:36px;line-height:1;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.03em;background:linear-gradient(180deg,var(--num1) 30%,var(--num2));-webkit-background-clip:text;background-clip:text;color:transparent}
.clock i{font-style:normal;font-size:10.5px;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-top:7px}
.clock .due{grid-column:1/-1;display:flex;align-items:center;justify-content:center;gap:9px;padding:15px;border-radius:15px;background:var(--accbg);border:1px solid var(--accln);color:var(--acc);font-weight:650;text-align:center}
.hnote{display:flex;align-items:flex-start;gap:8px;margin-top:12px;font-size:12.5px;line-height:1.4;color:var(--ok)}
.hnote .ic{margin-top:1px}
.hnote.warn{color:var(--warn)}
.hnote b{font-weight:650}
.hempty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:5px;padding:20px 8px 8px;color:var(--muted)}
.hempty .hei{width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:var(--bg3);color:var(--faint);margin-bottom:6px}
.hempty b{color:var(--text);font-size:15px}
.hempty span{font-size:12.5px;max-width:300px}
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.tile{display:flex;flex-direction:column;gap:1px;padding:11px 12px;border-radius:16px;background:var(--bg2);border:1px solid var(--line);text-decoration:none;box-shadow:var(--shadow);transition:transform .15s,border-color .2s;min-width:0}
.tile:active{transform:scale(.97)}
@media (hover:hover){.tile:hover{border-color:var(--line2)}}
.tile .ti{width:28px;height:28px;border-radius:9px;display:grid;place-items:center;margin-bottom:7px;background:var(--bg3);color:var(--muted)}
.tile b{font-size:23px;line-height:1.05;font-weight:750;font-variant-numeric:tabular-nums}
.tile>span:last-child{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile.info .ti{background:var(--infobg);color:var(--info)}.tile.ok .ti{background:var(--okbg);color:var(--ok)}.tile.warn .ti{background:var(--warnbg);color:var(--warn)}.tile.bad .ti{background:var(--badbg);color:var(--bad)}
.tile.bad{border-color:var(--badln)}
.big{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 7px;margin-bottom:11px}
.big b{font-size:29px;line-height:1;font-weight:750;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.big span{color:var(--muted);font-size:13px}
.bar{height:8px;border-radius:6px;background:var(--bg4);overflow:hidden;flex:1;min-width:0}
.bar.lg{height:11px}
.bar i{display:block;height:100%;width:0;border-radius:inherit;background:var(--green);transform-origin:left center;transition:width .8s cubic-bezier(.3,.8,.3,1)}
.bar i.ok{background:linear-gradient(90deg,#20a457,#3bd17d)}
.bar i.warn{background:linear-gradient(90deg,#d49b22,#f2c14e)}
.bar i.bad{background:linear-gradient(90deg,#c63a3a,#ef4f4f)}
.bar i.st{background-color:var(--blue);background-image:linear-gradient(45deg,rgba(255,255,255,.22) 25%,transparent 25% 50%,rgba(255,255,255,.22) 50% 75%,transparent 75%),linear-gradient(90deg,#3c7af0,#62b0ff);background-size:16px 16px,100% 100%;animation:stripe .7s linear infinite}
@keyframes stripe{to{background-position:16px 0,0 0}}
.first .bar i{animation:grow 1.1s cubic-bezier(.2,.8,.2,1) .25s both}
.first .bar i.st{animation:grow 1.1s cubic-bezier(.2,.8,.2,1) .25s both,stripe .7s linear infinite}
@keyframes grow{from{transform:scaleX(0)}}
.sub{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px 10px;margin-top:10px;font-size:12.5px;color:var(--muted)}
.sub span{display:inline-flex;align-items:center;gap:5px}
.sub b{color:var(--text);font-weight:650}
.urow{display:grid;grid-template-columns:86px minmax(0,1fr) auto;align-items:center;gap:10px;padding:5px 0;font-size:12.5px}
.ul{color:var(--soft);white-space:nowrap}
.uv{font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right;min-width:104px}
.uv b{font-weight:650}
.uv i{font-style:normal;color:var(--faint);margin-left:3px;font-size:11.5px}
.urow.na .ul,.urow.na .uv{color:var(--faint)}
.note{display:flex;gap:6px;align-items:flex-start;margin-top:11px;font-size:11.5px;line-height:1.45;color:var(--muted)}
.note .ic{margin-top:1px}
.none{display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;padding:10px 6px 4px;color:var(--muted)}
.none>.ic{color:var(--faint)}
.none b{color:var(--text);font-size:13.5px;margin-top:4px}
.none span{font-size:12.5px;max-width:300px}
.job{position:relative;display:flex;gap:12px;padding:12px;border-radius:18px;background:var(--bg2);border:1px solid var(--line);box-shadow:var(--shadow);margin-bottom:10px;cursor:pointer;transition:border-color .25s,transform .15s,background .2s;outline:none}
.job:last-child{margin-bottom:0}
.job:active{transform:scale(.985)}
.job:focus-visible,.hin:focus-visible,.rrow:focus-visible{box-shadow:0 0 0 2px var(--accent)}
@media (hover:hover){.job:hover{border-color:var(--line2);background:var(--bg2h)}}
.job.st-uploading{border-color:var(--infoln)}
.job.st-preparing,.job.st-publishing{border-color:var(--accln)}
.job.st-error{border-color:var(--badln);background:linear-gradient(100deg,var(--badbg),transparent 60%),var(--bg2)}
.th{position:relative;width:50px;aspect-ratio:9/16;flex:none;border-radius:11px;overflow:hidden;background:var(--thumb);display:grid;place-items:center;color:var(--faint);align-self:flex-start;box-shadow:0 0 0 1px rgba(255,255,255,.05)}
.th.xs{width:38px;border-radius:9px;align-self:center}
.th img,.hth img,.mth img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;opacity:0;transition:opacity .45s}
img.in{opacity:1}
.jb{flex:1;min-width:0}
.jt{display:flex;align-items:flex-start;gap:8px}
.jt b{flex:1;min-width:0;font-size:14.5px;font-weight:650;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.jw{display:flex;align-items:center;flex-wrap:wrap;gap:4px 7px;margin-top:6px;font-size:12.5px;color:var(--soft)}
.jw>.ic{color:var(--muted)}
.cd{font-variant-numeric:tabular-nums;font-weight:650;color:var(--acc);background:var(--accbg);padding:1px 8px;border-radius:8px;white-space:nowrap}
.cd.due{color:var(--info);background:var(--infobg)}
.okt{color:var(--ok);font-weight:600}
.chev{align-self:center;color:var(--faint);margin-right:-4px}
.pipe{list-style:none;margin:13px 0 2px;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr))}
.pipe li{position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;min-width:0;text-align:center}
.pipe li::before{content:"";position:absolute;top:11px;right:50%;width:100%;height:2px;background:var(--bg4);border-radius:2px}
.pipe li:first-child::before{display:none}
.pipe li.done::before{background:var(--green)}
.pipe li.cur::before{background:linear-gradient(90deg,var(--green),var(--blue))}
.st-preparing .pipe li.cur::before,.st-publishing .pipe li.cur::before{background:linear-gradient(90deg,var(--green),var(--accent))}
.pipe li.err::before{background:linear-gradient(90deg,var(--green),var(--red))}
.pd{position:relative;z-index:1;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:var(--bg3);border:1px solid var(--line2);color:var(--faint);transition:background .3s,color .3s,border-color .3s}
.pn{font-size:10.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.pipe li.done .pd{background:var(--okbg);border-color:var(--okln);color:var(--ok)}
.pipe li.done .pn{color:var(--ok)}
.pipe li.cur .pd{background:var(--blue);border-color:var(--blue);color:#fff;animation:pulse 1.8s ease-out infinite}
.pipe li.cur .pn{color:var(--text);font-weight:650}
.pipe li.err .pd{background:var(--red);border-color:var(--red);color:#fff}
.pipe li.err .pn{color:var(--bad);font-weight:650}
.st-ready .pipe li.cur .pd{background:var(--infobg);border-color:var(--infoln);color:var(--info);animation:none;box-shadow:0 0 12px rgba(76,141,255,.3)}
.st-preparing .pipe li.cur .pd,.st-publishing .pipe li.cur .pd{background:var(--accent);border-color:var(--accent);animation-name:pulse2}
.st-published .pipe li:last-child .pd{background:var(--green);border-color:var(--green);color:#fff}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(76,141,255,.55)}100%{box-shadow:0 0 0 9px rgba(76,141,255,0)}}
@keyframes pulse2{0%{box-shadow:0 0 0 0 rgba(var(--accent-rgb),.55)}100%{box-shadow:0 0 0 9px rgba(var(--accent-rgb),0)}}
.up{margin-top:11px;padding:9px 11px 10px;border-radius:12px;background:var(--infobg);border:1px solid var(--infoln)}
.upt{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:7px;font-size:11.5px;color:var(--muted)}
.upt b{font-size:17px;line-height:1;color:var(--info);font-variant-numeric:tabular-nums}
.up.paused{background:var(--bg3);border-color:var(--line2)}
.up.paused .upt b{color:var(--muted)}
.up.paused .bar i{background:var(--faint);animation:none}
.jerr{display:flex;gap:7px;align-items:flex-start;margin-top:11px;padding:9px 11px;border-radius:12px;background:var(--badbg);border:1px solid var(--badln);color:var(--bad);font-size:12.5px;line-height:1.4;word-break:break-word}
.jerr .ic{margin-top:1px}
.empty{display:flex;gap:13px;align-items:center;padding:16px;border:1px dashed var(--line2);border-radius:18px;color:var(--muted)}
.empty>.ic{color:var(--faint)}
.empty b{display:block;color:var(--text);margin-bottom:2px;font-size:13.5px}
.empty span{font-size:12.5px}
.empty.ok{border-style:solid;border-color:var(--okln);background:var(--okbg)}
.empty.ok>.ic{color:var(--ok)}
.warnbox{display:flex;gap:11px;align-items:flex-start;padding:12px 13px;border-radius:14px;background:var(--warnbg);border:1px solid var(--warnln);color:var(--warn);margin-bottom:6px}
.warnbox b{display:block;font-size:13.5px}
.warnbox>div>span{display:block;font-size:12.5px;line-height:1.45;color:var(--soft);margin-top:2px}
.warnbox>div>.off{color:var(--warn);font-weight:600;margin-top:5px}
.lrow{display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-top:1px solid var(--line)}
.lrow:first-of-type{border-top:0}
.li{width:36px;height:36px;border-radius:11px;flex:none;display:grid;place-items:center;background:var(--bg3);color:var(--muted)}
.lrow b{display:block;font-size:13.5px;font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lt{display:flex;flex-wrap:wrap;align-items:center;gap:4px 7px;font-size:12.5px;color:var(--soft);margin-top:3px}
.lrow i{display:block;font-style:normal;font-size:12px;color:var(--muted);margin-top:4px;line-height:1.4}
.lrow.risk .li{background:var(--warnbg);color:var(--warn)}
.lrow.past{opacity:.55}
.rrow{display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid var(--line);cursor:pointer;outline:none;border-radius:4px}
.rrow:first-child{border-top:0;padding-top:2px}
.rrow:last-child{padding-bottom:2px}
.rrow .grow{display:flex;flex-direction:column;gap:2px}
.rrow b{font-size:13.5px;font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rrow .grow>span{font-size:12px;color:var(--muted)}
.rrow .live{color:var(--ok);font-weight:600}
.tl{list-style:none;margin:0;padding:0}
.tl li{position:relative;display:flex;gap:11px;padding:7px 0}
.tl li:not(:last-child)::after{content:"";position:absolute;left:13.5px;top:37px;bottom:-7px;width:1px;background:var(--line2)}
.evi{width:28px;height:28px;border-radius:9px;flex:none;display:grid;place-items:center;background:var(--bg3);color:var(--muted);position:relative;z-index:1}
.evi.ok{background:var(--okbg);color:var(--ok)}.evi.info{background:var(--infobg);color:var(--info)}.evi.acc{background:var(--accbg);color:var(--acc)}.evi.bad{background:var(--badbg);color:var(--bad)}.evi.warn{background:var(--warnbg);color:var(--warn)}
.tl .grow{padding-top:1px}
.tl p{margin:0;font-size:13px;font-weight:600;line-height:1.35;word-break:break-word}
.tl b{display:block;font-size:12.5px;font-weight:500;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.tl .tm{display:block;font-size:11.5px;color:var(--faint);margin-top:2px}
.more{display:flex;width:100%;align-items:center;justify-content:center;gap:6px;margin-top:6px;padding:9px;border-radius:11px;font-size:12.5px;font-weight:650;color:var(--acc)}
@media (hover:hover){.more:hover{background:var(--bg3)}}
.foot{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 16px;margin-top:24px;padding-top:16px;border-top:1px solid var(--line);font-size:11.5px;color:var(--faint);text-align:center}
.foot span{display:inline-flex;align-items:center;gap:5px}
.sbg{position:fixed;inset:0;z-index:40;background:rgba(6,7,9,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .28s}
.sbg.on{opacity:1;pointer-events:auto}
.sheet{position:fixed;z-index:41;left:0;right:0;bottom:0;max-height:92vh;max-height:92dvh;overflow-y:auto;overscroll-behavior:contain;background:var(--bg2);border:1px solid var(--line);border-bottom:0;border-radius:24px 24px 0 0;box-shadow:0 -20px 60px -20px rgba(0,0,0,.6);padding:8px max(16px,env(safe-area-inset-right)) calc(22px + env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));transform:translateY(105%);transition:transform .34s cubic-bezier(.2,.9,.25,1);visibility:hidden}
.sheet.on{transform:none;visibility:visible}
.grab{width:42px;height:5px;border-radius:3px;background:var(--line2);margin:2px auto 10px}
@media (min-width:720px){.sheet{left:50%;right:auto;bottom:auto;top:50%;width:min(620px,calc(100vw - 40px));max-height:86vh;border-radius:22px;border-bottom:1px solid var(--line);padding:16px 20px 22px;transform:translate(-50%,-47%) scale(.97);opacity:0;transition:transform .26s cubic-bezier(.2,.9,.25,1),opacity .2s}.sheet.on{transform:translate(-50%,-50%);opacity:1}.grab{display:none}}
.shd{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.ib.sm{width:34px;height:34px;border-radius:11px}
.stop{display:flex;gap:15px;align-items:flex-start}
.stop.play{flex-direction:column;align-items:stretch}
.media{width:104px;flex:none}
.stop.play .media{width:100%}
.mth{position:relative;display:grid;place-items:center;width:100%;aspect-ratio:9/16;border-radius:15px;overflow:hidden;background:var(--thumb);color:var(--faint);box-shadow:0 14px 30px -14px rgba(0,0,0,.7)}
.media video{display:block;width:100%;height:min(64vh,600px);height:min(64dvh,600px);object-fit:contain;border-radius:15px;background:#000}
.media .note{justify-content:center}
.sinfo{flex:1;min-width:0}
.sinfo h2{margin:0 0 11px;font-size:18px;line-height:1.3;letter-spacing:-.01em;word-break:break-word}
.facts{display:flex;flex-direction:column;gap:9px}
.facts>div{display:flex;flex-direction:column;gap:1px}
.facts .k{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}
.facts .v{font-size:13px;color:var(--text);font-weight:550;display:flex;flex-wrap:wrap;gap:4px 7px;align-items:center}
.sacts{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.ssec{margin-top:18px}
.ssec h4{margin:0 0 8px;font-size:11.5px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.ssec .pipe{margin-top:4px}
.cap{margin:0;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.55;color:var(--soft);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.cap.open{display:block}
.log{list-style:none;margin:0;padding:4px 12px;border-radius:13px;background:var(--bg);border:1px solid var(--line);max-height:300px;overflow-y:auto}
.log li{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px;padding:7px 0;border-top:1px solid var(--line);font-size:12px}
.log li:first-child{border-top:0}
.log span{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.log p{margin:0;word-break:break-word;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:11.5px;line-height:1.45;color:var(--soft)}
.sk{height:64px;margin-top:18px;border-radius:13px;background:linear-gradient(90deg,var(--bg3) 20%,var(--bg4) 50%,var(--bg3) 80%);background-size:200% 100%;animation:sk 1.2s linear infinite}
@keyframes sk{from{background-position:100% 0}to{background-position:-100% 0}}
.login{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:28px 18px calc(28px + env(safe-area-inset-bottom))}
.lgc{width:100%;max-width:380px;text-align:center;animation:rise .6s cubic-bezier(.2,.8,.2,1) both}
.lg-logo{position:relative;width:74px;height:74px;margin:0 auto 20px;border-radius:23px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--accent),var(--pink));box-shadow:0 20px 44px -12px rgba(var(--accent-rgb),.65)}
.lg-logo::after{content:"";position:absolute;inset:-9px;border-radius:30px;border:1.5px solid rgba(var(--accent-rgb),.4);animation:halo 2.8s ease-out infinite}
@keyframes halo{0%{transform:scale(.88);opacity:1}100%{transform:scale(1.28);opacity:0}}
.lgc h1{margin:0;font-size:25px;letter-spacing:-.02em}
.lgc>p{margin:6px 0 24px;color:var(--muted)}
.lgc form{display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:22px;background:var(--bg2);border:1px solid var(--line);box-shadow:var(--shadow);text-align:left}
.lgc label.t{font-size:12px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);margin:0 2px -4px}
.pw{display:flex;align-items:center;gap:10px;padding:0 5px 0 13px;height:52px;border-radius:14px;background:var(--bg);border:1px solid var(--line2);color:var(--muted);transition:border-color .2s,box-shadow .2s}
.pw:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px var(--accbg)}
.pw input{flex:1;min-width:0;height:100%;border:0;outline:0;background:none;color:var(--text);font:inherit;font-size:16px;letter-spacing:.02em}
.pw input::placeholder{color:var(--faint);letter-spacing:0}
.eye{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;color:var(--muted)}
@media (hover:hover){.eye:hover{color:var(--text);background:var(--bg3)}}
.btn.lgb{min-height:50px;font-size:15px;border-radius:14px}
.lerr{min-height:19px;font-size:12.5px;color:var(--bad);text-align:center;font-weight:550}
.lerr.info{color:var(--muted);font-weight:500}
.shake{animation:shake .42s}
@keyframes shake{20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
.lg-foot{display:flex;gap:8px;align-items:flex-start;justify-content:center;margin:16px 4px 0;font-size:12px;color:var(--muted);line-height:1.5;text-align:left}
.lg-foot .ic{margin-top:2px;color:var(--ok)}
.lg-foot b{color:var(--soft);font-weight:600}
@media (max-width:560px){.job .pn{display:none}.job .pipe{margin-top:11px}.clock b{font-size:32px}.strip{flex-wrap:wrap;overflow:visible;margin:0 0 12px;padding:0;gap:6px}.chip{font-size:12px;padding:5px 10px 5px 9px}.jt{flex-direction:column-reverse;align-items:flex-start;gap:5px}.jt b{font-size:14px}}
@media (max-width:360px){.urow{grid-template-columns:74px minmax(0,1fr) auto;gap:8px}.uv{min-width:92px}.clock b{font-size:28px}.hth{width:66px}}
html.fx{--text:#e8eaed;--soft:#c9cdd4;--muted:#9198a3;--faint:#6c727c;--ok:#7ee2a6;--okbg:rgba(43,196,106,.14);--okln:rgba(43,196,106,.38);--warn:#ffd98a;--warnbg:rgba(242,193,78,.12);--warnln:rgba(242,193,78,.38);--bad:#ff9d9d;--badbg:rgba(239,79,79,.13);--badln:rgba(239,79,79,.45);--info:#9fc0ff;--infobg:rgba(76,141,255,.14);--infoln:rgba(76,141,255,.45);--bg3:rgba(255,255,255,.05);--bg4:rgba(255,255,255,.09);--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--accbg:rgba(var(--accent-rgb),.14);--accln:rgba(var(--accent-rgb),.42);--herobg1:rgba(var(--accent-rgb),.22);--herobg2:rgba(var(--fx2),.14);--glow1:transparent;--glow2:transparent;--glass:rgba(0,0,0,.3);--shadow:0 1px 0 rgba(255,255,255,.03) inset,0 14px 34px -16px rgba(0,0,0,.7);--thumb:#0b0b0d;--num1:#fff;--clock:rgba(0,0,0,.28);color-scheme:dark}
html[data-theme=gunbatimi]{--bg:#100d13;--bg2:rgba(26,21,30,.74);--bg2s:#1a151e;--bg2h:rgba(36,29,41,.84);--accent:#ff6a3d;--accent2:#ff9466;--pbtn2:#ff4d6a;--accent-rgb:255,106,61;--acc:#ffb59c;--num2:#ffbfa8;--fx1:255,106,61;--fx2:225,48,108;--fx3:124,58,237}
html[data-theme=aurora]{--bg:#0a0e15;--bg2:rgba(18,24,36,.72);--bg2s:#121824;--bg2h:rgba(26,33,48,.84);--accent:#8b5cf6;--accent2:#a78bfa;--pbtn2:#6366f1;--accent-rgb:139,92,246;--acc:#c4b5fd;--num2:#c4b5fd;--fx1:139,92,246;--fx2:20,184,166;--fx3:59,130,246}
html[data-theme=okyanus]{--bg:#07101b;--bg2:rgba(14,25,40,.72);--bg2s:#0e1928;--bg2h:rgba(20,34,52,.84);--accent:#2f8fff;--accent2:#66adff;--pbtn2:#06b6d4;--accent-rgb:47,143,255;--acc:#93c5fd;--num2:#93c5fd;--fx1:14,165,233;--fx2:37,99,235;--fx3:6,182,212}
html[data-theme=neon]{--bg:#0b0912;--bg2:rgba(21,17,31,.72);--bg2s:#15111f;--bg2h:rgba(30,24,44,.84);--accent:#ec4899;--accent2:#f472b6;--pbtn2:#a855f7;--accent-rgb:236,72,153;--acc:#f9a8d4;--num2:#f9a8d4;--fx1:236,72,153;--fx2:34,211,238;--fx3:168,85,247}
html[data-theme=orman]{--bg:#09110d;--bg2:rgba(17,28,22,.74);--bg2s:#111c16;--bg2h:rgba(24,38,30,.84);--accent:#10b981;--accent2:#34d399;--pbtn2:#0d9488;--accent-rgb:16,185,129;--acc:#6ee7b7;--num2:#6ee7b7;--fx1:16,185,129;--fx2:132,204,22;--fx3:13,148,136}
html[data-theme=gece]{--bg:#060607;--bg2:rgba(16,16,19,.84);--bg2s:#101013;--bg2h:rgba(24,24,28,.9);--accent:#ff6a3d;--accent2:#ff9466;--pbtn2:#ff4d6a;--accent-rgb:255,106,61;--acc:#ffb59c;--num2:#ffbfa8;--fx1:255,106,61;--fx2:90,90,110;--fx3:60,60,80;--fx-o:.45}
.bgfx{display:none}
html.fx body::before{display:none}
html.fx .bgfx{display:block;position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none}
.bgfx .b{position:absolute;width:70vmax;height:70vmax;border-radius:50%;opacity:var(--fx-o,.9);will-change:transform}
.bgfx .b1{top:-34vmax;left:-6vw;background:radial-gradient(closest-side,rgba(var(--fx1),.42),rgba(var(--fx1),.15) 55%,transparent);animation:fxa 34s ease-in-out infinite alternate}
.bgfx .b2{bottom:-38vmax;right:-24vmax;background:radial-gradient(closest-side,rgba(var(--fx2),.4),rgba(var(--fx2),.14) 55%,transparent);animation:fxb 42s ease-in-out infinite alternate}
.bgfx .b3{top:22vh;left:30vw;width:52vmax;height:52vmax;background:radial-gradient(closest-side,rgba(var(--fx3),.32),rgba(var(--fx3),.11) 55%,transparent);animation:fxc 50s ease-in-out infinite alternate}
.bgfx .st{position:absolute;top:0;left:0;width:1px;height:1px;border-radius:50%;animation:twinkle 4.6s ease-in-out infinite}
.bgfx .st2{animation-duration:6.2s;animation-delay:-2.1s}
.bgfx .st3{width:2px;height:2px;animation-duration:7.8s;animation-delay:-4.3s}
@keyframes fxa{to{transform:translate(16vw,12vh) scale(1.12)}}
@keyframes fxb{to{transform:translate(-14vw,-10vh) scale(1.18)}}
@keyframes fxc{0%{transform:translate(0,0) scale(1)}50%{transform:translate(-12vw,8vh) scale(.9)}100%{transform:translate(10vw,-6vh) scale(1.1)}}
@keyframes twinkle{0%,100%{opacity:.15}50%{opacity:.95}}
.sheet,.lgc form{background:var(--bg2s,var(--bg2))}
html.fx .top{background:rgba(0,0,0,.3);border-bottom-color:rgba(255,255,255,.06)}
html.fx .top::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,rgba(var(--accent-rgb),.75) 30%,rgba(var(--fx2),.6) 70%,transparent);opacity:.75;pointer-events:none}
html.fx .logo,html.fx .lg-logo{background:linear-gradient(135deg,var(--accent),var(--pbtn2))}
html.fx .top .logo{animation:logoGlow 4s ease-in-out infinite}
@keyframes logoGlow{50%{box-shadow:0 0 22px -2px rgba(var(--accent-rgb),.9)}}
html.fx .btn.primary{position:relative;overflow:hidden;box-shadow:0 10px 24px -8px rgba(var(--accent-rgb),.75),inset 0 1px 0 rgba(255,255,255,.22)}
html.fx .btn.primary::after{content:"";position:absolute;top:-20%;bottom:-20%;left:-70%;width:45%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.4),transparent);transform:skewX(-22deg);animation:shine 6s ease-in-out infinite;pointer-events:none}
html.fx .btn.primary:disabled::after{display:none}
@keyframes shine{0%,72%{left:-70%}88%,100%{left:140%}}
html.fx .chip.ok{box-shadow:0 0 16px -5px rgba(43,196,106,.7)}
html.fx .card,html.fx .tile,html.fx .job{transition:border-color .25s,box-shadow .3s,transform .2s,background .2s}
@media (hover:hover){html.fx .card:hover,html.fx .job:hover{border-color:rgba(var(--accent-rgb),.32);box-shadow:var(--shadow),0 14px 32px -18px rgba(var(--accent-rgb),.6)}html.fx .tile:hover{transform:translateY(-2px);border-color:rgba(var(--accent-rgb),.38);box-shadow:var(--shadow),0 12px 28px -14px rgba(var(--accent-rgb),.6)}}
.ib.on{color:var(--text);border-color:var(--accln);background:var(--accbg)}
.thp{position:fixed;z-index:60;top:calc(62px + env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 80px);overflow-y:auto;padding:12px;border-radius:20px;background:var(--bg2s,var(--bg2));border:1px solid var(--line2);box-shadow:0 24px 60px -20px rgba(0,0,0,.7);opacity:0;transform:translateY(-8px) scale(.97);transform-origin:top right;transition:opacity .18s,transform .22s cubic-bezier(.2,.9,.25,1.1)}
html.fx .thp{-webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4)}
.thp.on{opacity:1;transform:none}
.thp-h{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:14px}
.thp-h b{flex:1}
.thp-h>.ic{color:var(--acc)}
.thp-g{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.thc{display:flex;flex-direction:column;gap:6px;padding:0 0 8px;border-radius:14px;border:1px solid var(--line);background:var(--bg3);overflow:hidden;text-align:left;transition:transform .15s,border-color .2s,box-shadow .25s}
.thc:active{transform:scale(.97)}
.thc.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 8px 22px -10px rgba(var(--accent-rgb),.8)}
.thv{position:relative;display:block;height:46px;overflow:hidden}
.thv i{position:absolute;width:64px;height:64px;border-radius:50%}
.thv i:nth-child(1){top:-26px;left:-12px}
.thv i:nth-child(2){bottom:-30px;right:-10px}
.thv i:nth-child(3){top:6px;left:44%;width:40px;height:40px}
.thn{display:flex;align-items:center;gap:5px;padding:0 10px;font-size:12.5px;font-weight:650}
.thn .ic{color:var(--accent);margin-left:auto}
.thm{display:flex;align-items:center;gap:11px;width:100%;margin-top:10px;padding:10px 11px;border-radius:14px;background:var(--bg3);border:1px solid var(--line);text-align:left}
.thm b{display:block;font-size:13px}
.thm .grow>span{font-size:11.5px;color:var(--muted)}
.sw{position:relative;width:38px;height:22px;flex:none;border-radius:11px;background:var(--bg4);transition:background .2s}
.sw i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}
.sw.on{background:var(--accent)}
.sw.on i{transform:translateX(16px)}
.cxm{min-width:210px;max-width:280px;padding:5px;border-radius:14px;background:var(--bg2s,var(--bg2));border:1px solid var(--line2);box-shadow:0 18px 44px rgba(0,0,0,.55)}
.cx-root{position:fixed;z-index:70;opacity:0;transform:scale(.94);transition:opacity .12s,transform .16s cubic-bezier(.2,.9,.25,1.15)}
.cx-root.on{opacity:1;transform:none}
html.fx .cx-root{-webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4)}
.cx-it{position:relative;display:flex;align-items:center;flex-wrap:wrap;gap:9px;width:100%;padding:8px 10px;border-radius:9px;font-size:13.5px;text-align:left;color:var(--text);cursor:pointer;outline:none}
.cx-it>.ic:first-child{color:var(--muted)}
.cx-it:hover,.cx-it.open,.cx-it:focus-visible{background:var(--accbg)}
.cx-it:hover>.ic:first-child{color:var(--acc)}
.cx-it.danger{color:var(--bad)}
.cx-it.danger>.ic:first-child{color:var(--bad)}
.cx-it.danger:hover{background:var(--badbg)}
.cx-sep{height:1px;margin:4px 6px;background:var(--line)}
.cx-head{padding:6px 10px 4px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cx-dot{width:12px;height:12px;border-radius:50%;flex:none}
.cx-sub{position:absolute;top:-6px;left:calc(100% + 4px);display:none}
.cx-root.flip .cx-sub{left:auto;right:calc(100% + 4px)}
.cx-it.has-sub:hover>.cx-sub,.cx-it.has-sub.open>.cx-sub{display:block;animation:cxIn .12s ease-out}
@keyframes cxIn{from{opacity:0;transform:translateX(-4px)}}
@media (max-width:560px){.cx-root{max-height:calc(100vh - 16px);overflow-y:auto;overscroll-behavior:contain}.cx-sub,.cx-root.flip .cx-sub{position:static;flex-basis:100%;min-width:0;max-width:none;margin:2px 0 0;padding:0 0 0 14px;border:0;box-shadow:none;background:none;animation:none}.cx-it.has-sub:hover>.cx-sub{display:none}.cx-it.has-sub.open>.cx-sub{display:block}}
html.still .bgfx *,html.still .btn.primary::after,html.still .top .logo,html.still .hero::after,html.still .bar i.st{animation:none!important}
html.still .btn.primary::after{display:none}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
.chip.yt,.chip.tt{color:var(--text)}.chip.yt .ic{color:#ff4e45}.chip.tt .ic{color:#25f4ee}.chip.off{opacity:.7}
.seg{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:4px;margin:0 0 14px;border-radius:16px;background:var(--bg2);border:1px solid var(--line);box-shadow:var(--shadow)}
.sg{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:6px 8px;border-radius:12px;color:var(--muted);font-weight:620;font-size:13px;transition:background .2s,color .2s;min-width:0}
.sg>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg em{font-style:normal;font-size:10.5px;font-weight:700;min-width:18px;height:18px;padding:0 5px;border-radius:9px;display:inline-grid;place-items:center;background:var(--bg4);color:var(--text)}
.sg.on{color:var(--text);background:var(--bg3);box-shadow:inset 0 0 0 1px var(--line2)}
.sg.on .ic{color:var(--accent2)}
html.fx .sg.on{background:linear-gradient(135deg,rgba(var(--accent-rgb),.24),rgba(var(--accent-rgb),.08));box-shadow:inset 0 0 0 1px rgba(var(--accent-rgb),.45)}
@media (max-width:520px){.sg{flex-direction:column;gap:3px;min-height:52px;font-size:11.5px;padding:6px 4px}.sg em{position:absolute;top:4px;right:6px;height:16px;min-width:16px;font-size:10px}}
.one{display:flex;flex-direction:column;gap:14px;max-width:860px;margin:0 auto}
.calsum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;text-align:center}
.calsum b{display:block;font-size:23px;font-weight:750;line-height:1.1;font-variant-numeric:tabular-nums}
.calsum span{font-size:12px;color:var(--muted)}
.calsum .warn b{color:var(--warn)}.calsum .ok b{color:var(--ok)}
.calday .sh .chs{margin-left:0;text-transform:none;letter-spacing:0;font-weight:500;color:var(--faint)}
.calday .sh .n{margin-left:auto}
.crow{display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-top:1px solid var(--line);outline:none}
.crow:first-child{border-top:0;padding-top:2px}.crow:last-child{padding-bottom:2px}
.crow[data-open]{cursor:pointer}
.ctime{display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:62px;flex:none}
.ctime b{font-size:16px;font-weight:720;line-height:1.2;font-variant-numeric:tabular-nums}
.ctime .cd{font-size:10.5px;padding:0 6px}
.crow.pc .ctime b{color:var(--warn)}
.crow .grow>b{display:block;font-size:13.5px;font-weight:620;line-height:1.35}
.pts{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}
.pt{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:600;padding:2px 8px 2px 6px;border-radius:999px;background:var(--bg3);color:var(--soft);border:1px solid var(--line);white-space:nowrap}
.pt.ok{color:var(--ok);background:var(--okbg);border-color:var(--okln)}.pt.warn{color:var(--warn);background:var(--warnbg);border-color:var(--warnln)}
.pt.bad{color:var(--bad);background:var(--badbg);border-color:var(--badln)}.pt.info{color:var(--info);background:var(--infobg);border-color:transparent}
.ptiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
@media (min-width:700px){.ptiles{grid-template-columns:repeat(6,minmax(0,1fr))}}
.ptiles .tile:not(.ok):not(.warn):not(.bad):not(.info):not(.acc) b{color:var(--muted)}
.tile.acc .ti{background:var(--accbg);color:var(--acc)}
.li.acc{background:var(--accbg);color:var(--acc)}.li.info{background:var(--infobg);color:var(--info)}.li.ok{background:var(--okbg);color:var(--ok)}.li.bad{background:var(--badbg);color:var(--bad)}.li.warn{background:var(--warnbg);color:var(--warn)}
.who{display:inline-flex;align-items:center;gap:4px;color:var(--muted)}
.lrow i.err{color:var(--bad)}
.lrow i.tm{color:var(--faint)}
.lrow i .ic{vertical-align:-2px;margin-right:2px}
.arow{display:flex;gap:11px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.arow:first-of-type{border-top:0;padding-top:2px}
.arow .grow b{display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:620}
.arow .grow>span{display:block;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
.arow.off{opacity:.62}
.accn{font-style:normal;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;background:var(--bg4);color:var(--soft)}
.sthead{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);margin:0 2px}
.fr{display:inline-flex;align-items:center;gap:4px;flex:none;font-size:10.5px;font-weight:650;letter-spacing:0;text-transform:none;line-height:1.6;padding:0 7px;border-radius:999px;border:1px solid var(--line2);color:var(--muted);background:var(--bg3);white-space:nowrap;cursor:help}
.fr .ic{opacity:.85}
.fr.live{color:var(--ok);border-color:var(--okln);background:var(--okbg)}
.fr.live i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:ping 2.4s ease-out infinite}
.fr.old{color:var(--warn);border-color:var(--warnln);background:var(--warnbg)}
.sh .fr,.ch .fr,.hh .fr{margin-left:auto}
.ch .fr~.tag,.hh .fr~.tag{margin-left:6px}
.pcard .ch .fr{margin-left:8px}
.frleg{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:-6px 2px 14px;font-size:11.5px;color:var(--faint)}
.frleg>span:not(.fr){margin-right:8px}
.frline{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin:0 2px}
.kf{display:inline-flex;vertical-align:-1px;color:var(--faint);cursor:help}
html.still .fr.live i{animation:none}
.stnote{margin:0 2px}
.frz{display:flex;gap:6px;align-items:center;margin-top:8px;padding:7px 10px;border-radius:10px;background:var(--warnbg);border:1px solid var(--warnln);color:var(--warn);font-size:12px;line-height:1.35}
.frz>.ic{flex:none}
.pgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.pcard .ch .chs{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:55%}
.pcard.ig .ch>.ic{color:#e1306c}.pcard.yt .ch>.ic{color:#ff4e45}.pcard.tt .ch>.ic{color:#25f4ee}
.kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.kpi .kl{display:block;font-size:12px;color:var(--muted)}
.kpi b{display:block;font-size:25px;font-weight:750;line-height:1.15;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.dl{display:inline-flex;align-items:center;gap:3px;font-size:11.5px;font-weight:650;color:var(--muted);font-variant-numeric:tabular-nums}
.dl.gain{color:var(--ok)}.dl.loss{color:var(--bad)}
.dl i{font-style:normal;font-weight:500;color:var(--faint);margin-left:2px}
.spk{position:relative;margin:6px 0 0;touch-action:pan-y}
.spk>svg{display:block;width:100%;height:64px;overflow:visible}
.spk .sl{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.spk .sa{fill:rgba(var(--accent-rgb),.12);stroke:none}
.spk .sx{position:absolute;top:0;height:64px;width:1px;background:var(--line2);display:none;pointer-events:none}
.spk .stip{position:absolute;top:-30px;transform:translateX(-50%);display:none;padding:3px 8px;border-radius:8px;background:var(--bg2s,var(--bg3));border:1px solid var(--line2);font-size:11.5px;white-space:nowrap;pointer-events:none;z-index:2;box-shadow:var(--shadow)}
.spk .stip b{margin-right:5px;font-variant-numeric:tabular-nums}
.spk .stip span{color:var(--muted)}
.spk.hov .sx,.spk.hov .stip{display:block}
.sax{display:flex;justify-content:space-between;font-size:10.5px;color:var(--faint);margin-top:3px}
.spkn{display:flex;gap:8px;align-items:center;margin:8px 0 2px;padding:12px;border:1px dashed var(--line2);border-radius:12px;font-size:12px;line-height:1.4;color:var(--muted)}
.spkn>.ic{flex:none;color:var(--faint)}
.srow{display:flex;align-items:center;gap:11px;padding:10px 0;border-top:1px solid var(--line)}
.srow:first-child{border-top:0;padding-top:2px}.srow:last-child{padding-bottom:2px}
.srow .grow{display:flex;flex-direction:column;gap:2px}
.srow .grow b{font-size:13.5px;font-weight:620;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.srow .grow>span{font-size:12px;color:var(--muted)}
.nums{display:flex;gap:10px;font-size:12px;color:var(--soft);font-variant-numeric:tabular-nums;flex:none}
.nums span{display:inline-flex;align-items:center;gap:3px}
.nums .ic{color:var(--muted)}
.li.ig{color:#e1306c}.li.yt{color:#ff4e45}.li.tt{color:#25f4ee}
@media (max-width:520px){.nums span:nth-child(3){display:none}.kpi b{font-size:22px}}
`

function panelApp(IC) {
  const root = document.getElementById("root")
  const base = (location.pathname.match(/^\/p\/[^/]+/) || [""])[0]
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
  const ic = (n, s = 18, c = "") => `<svg class="ic${c ? " " + c : ""}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ""}</svg>`
  const S = { d: null, skew: 0, last: 0, okAt: 0, busy: false, err: false, first: true, all: false, sheet: null, seen: new Set(), login: false, due: 0, ticks: 0, tab: "ozet" }
  const THEMES = [["gunbatimi", "Gün Batımı", ["#ff6a3d", "#e1306c", "#7c3aed"], "#100d13"], ["aurora", "Aurora", ["#8b5cf6", "#14b8a6", "#3b82f6"], "#0a0e15"],
    ["okyanus", "Okyanus", ["#0ea5e9", "#2563eb", "#06b6d4"], "#07101b"], ["neon", "Neon", ["#ec4899", "#22d3ee", "#a855f7"], "#0b0912"],
    ["orman", "Orman", ["#10b981", "#84cc16", "#0d9488"], "#09110d"], ["gece", "Gece", ["#ff6a3d", "#5a5a6e", "#3c3c50"], "#060607"],
    ["klasik", "Klasik", ["#ff6a3d", "#e1306c", "#2e3239"], "#141519"]]
  const thPrefs = () => {
    try {
      return JSON.parse(localStorage.getItem("sosyal-theme") || "{}") || {}
    } catch {
      return {}
    }
  }
  const thCur = () => (THEMES.find(t => t[0] === thPrefs().theme) || THEMES[0])[0]
  function applyTheme(p = thPrefs()) {
    const t = THEMES.find(x => x[0] === p.theme) || THEMES[0]
    const h = document.documentElement
    const flat = t[0] === "klasik"
    h.dataset.theme = t[0]
    h.classList.toggle("fx", !flat)
    h.classList.toggle("still", p.motion === false)
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
      if (!m.dataset.orig) m.dataset.orig = m.getAttribute("content")
      m.setAttribute("content", flat ? m.dataset.orig : t[3])
    }
    if (flat || document.querySelector(".bgfx")) return
    const bg = document.createElement("div")
    bg.className = "bgfx"
    bg.setAttribute("aria-hidden", "true")
    bg.innerHTML = '<i class="b b1"></i><i class="b b2"></i><i class="b b3"></i><i class="st st1"></i><i class="st st2"></i><i class="st st3"></i>'
    document.body.prepend(bg)
    for (const [sel, n, al] of [[".st1", 30, 0.7], [".st2", 22, 0.6], [".st3", 10, 0.55]]) {
      const dots = []
      for (let i = 0; i < n; i++) dots.push(`${(Math.random() * 100).toFixed(2)}vw ${(Math.random() * 100).toFixed(2)}vh 0 0 rgba(255,255,255,${(al * (0.5 + Math.random() * 0.5)).toFixed(2)})`)
      bg.querySelector(sel).style.boxShadow = dots.join(",")
    }
  }
  function setTheme(patch) {
    const p = { ...thPrefs(), ...patch }
    try {
      localStorage.setItem("sosyal-theme", JSON.stringify(p))
    } catch {}
    applyTheme(p)
    drawThemePop()
  }
  applyTheme()
  let thp = null
  function drawThemePop() {
    if (!thp) return
    const cur = thCur()
    const still = thPrefs().motion === false
    thp.innerHTML = `<div class="thp-h">${ic("palette", 17)}<b>Görünüm</b><button class="ib sm" data-th-close aria-label="Kapat">${ic("x", 16)}</button></div>
      <div class="thp-g">${THEMES.map(t => `<button class="thc${t[0] === cur ? " on" : ""}" data-th="${t[0]}" aria-pressed="${t[0] === cur}"><span class="thv" style="background:${t[3]}">${t[2].map(c => `<i style="background:radial-gradient(closest-side,${c}${t[0] === "klasik" ? "55" : "aa"},transparent)"></i>`).join("")}</span><span class="thn">${esc(t[1])}${t[0] === cur ? ic("check", 14) : ""}</span></button>`).join("")}</div>
      <button class="thm" data-th-motion role="switch" aria-checked="${!still}"><span class="sw${still ? "" : " on"}"><i></i></span><span class="grow"><b>Hareketli arka plan</b><span>Işıklar, yıldızlar ve parıltılar</span></span></button>`
  }
  function thOut(e) {
    if (thp && !thp.contains(e.target) && !e.target.closest('[data-act="theme"]')) closeThemePop()
  }
  function closeThemePop() {
    if (!thp) return
    const x = thp
    thp = null
    x.classList.remove("on")
    setTimeout(() => x.remove(), 220)
    document.removeEventListener("mousedown", thOut, true)
    const b = root.querySelector('[data-act="theme"]')
    if (b) b.classList.remove("on")
  }
  function toggleThemePop() {
    if (thp) return closeThemePop()
    thp = document.createElement("div")
    thp.className = "thp"
    thp.setAttribute("role", "dialog")
    thp.setAttribute("aria-label", "Görünüm")
    document.body.append(thp)
    drawThemePop()
    const b = root.querySelector('[data-act="theme"]')
    if (b) b.classList.add("on")
    requestAnimationFrame(() => thp && thp.classList.add("on"))
    thp.addEventListener("click", e => {
      const c = e.target.closest("[data-th]")
      if (c) return setTheme({ theme: c.dataset.th })
      if (e.target.closest("[data-th-motion]")) return setTheme({ motion: thPrefs().motion === false })
      if (e.target.closest("[data-th-close]")) closeThemePop()
    })
    setTimeout(() => document.addEventListener("mousedown", thOut, true), 0)
  }
  let cxm = null
  const cxClose = () => {
    if (cxm) cxm.remove()
    cxm = null
  }
  const copyText = t => {
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {})
  }
  const openTab = u => window.open(u, "_blank", "noopener")
  function cxItems(t) {
    const out = []
    const o = t.closest("[data-open]")
    if (o && S.d && !S.login) {
      const pid = o.dataset.open
      const j = (S.d.jobs || []).find(x => x.pid === pid) || recentList(S.d).find(x => x.pid === pid)
      if (j) out.push({ head: title(j) })
      out.push({ label: "Ayrıntıları aç", icon: "chevron-right", run: () => openSheet(pid, true) })
      const link = j ? safe(j.permalink) : ""
      if (link) out.push({ label: "Instagram'da aç", icon: "instagram", run: () => openTab(link) }, { label: "Bağlantıyı kopyala", icon: "link", run: () => copyText(link) })
      out.push({ sep: true })
    }
    const a = t.closest("a[href]")
    const h = a ? a.getAttribute("href") || "" : ""
    if (a && !o && h && h[0] !== "#") out.push({ label: "Yeni sekmede aç", icon: "external-link", run: () => openTab(a.href) }, { label: "Bağlantıyı kopyala", icon: "link", run: () => copyText(a.href) }, { sep: true })
    const cur = thCur()
    const still = thPrefs().motion === false
    if (!S.login && S.d) out.push({ label: "Yenile", icon: "refresh-cw", run: () => load() })
    out.push({ label: "Tema", icon: "palette", sub: THEMES.map(x => ({ label: x[1], dot: x[2][0], on: x[0] === cur, run: () => setTheme({ theme: x[0] }) })) },
      { label: still ? "Hareketli arka planı aç" : "Hareketli arka planı durdur", icon: still ? "sparkles" : "pause", run: () => setTheme({ motion: still }) })
    if (!S.login && S.d) out.push({ sep: true }, { label: "Çıkış yap", icon: "log-out", danger: true, run: () => { const b = root.querySelector('[data-act="logout"]'); if (b) b.click() } })
    return out.filter((it, i, arr) => !(it.sep && (i === 0 || i === arr.length - 1 || arr[i - 1].sep)))
  }
  function cxHtml(items, pre) {
    return items.map((it, i) => {
      if (it.sep) return '<div class="cx-sep"></div>'
      if (it.head) return `<div class="cx-head">${esc(it.head)}</div>`
      const lead = it.dot ? `<i class="cx-dot" style="background:${it.dot}"></i>` : ic(it.icon, 16)
      const body = `${lead}<span class="grow">${esc(it.label)}</span>${it.on ? ic("check", 14) : ""}`
      if (it.sub) return `<div class="cx-it has-sub" role="menuitem" tabindex="0" aria-haspopup="true" data-cx="${pre}${i}">${body}${ic("chevron-right", 14)}<div class="cxm cx-sub" role="menu">${cxHtml(it.sub, `${pre}${i}.`)}</div></div>`
      return `<button type="button" class="cx-it${it.danger ? " danger" : ""}" role="menuitem" data-cx="${pre}${i}">${body}</button>`
    }).join("")
  }
  document.addEventListener("contextmenu", e => {
    if (e.shiftKey || (e.target.closest && e.target.closest("input, textarea"))) return
    e.preventDefault()
    cxClose()
    closeThemePop()
    const items = cxItems(e.target)
    if (!items.length) return
    const m = document.createElement("div")
    m.className = "cxm cx-root"
    m.setAttribute("role", "menu")
    m.innerHTML = cxHtml(items, "")
    document.body.append(m)
    cxm = m
    const w = m.offsetWidth
    const ht = m.offsetHeight
    const x = e.clientX + w > innerWidth - 8 ? Math.max(8, e.clientX - w) : e.clientX
    const y = e.clientY + ht > innerHeight - 8 ? Math.max(8, e.clientY - ht) : e.clientY
    m.style.left = `${x}px`
    m.style.top = `${y}px`
    m.style.transformOrigin = `${x < e.clientX ? "right" : "left"} ${y < e.clientY ? "bottom" : "top"}`
    if (x + w + 200 > innerWidth) m.classList.add("flip")
    requestAnimationFrame(() => m.classList.add("on"))
    m.addEventListener("contextmenu", ev => ev.preventDefault())
    m.addEventListener("click", ev => {
      const b = ev.target.closest(".cx-it")
      if (!b) return
      const path = b.dataset.cx.split(".").map(Number)
      let it = items[path[0]]
      if (path.length > 1) it = it.sub[path[1]]
      if (!it) return
      if (it.sub) {
        b.classList.toggle("open")
        const rr = m.getBoundingClientRect()
        if (rr.bottom > innerHeight - 8) m.style.top = `${Math.max(8, innerHeight - rr.height - 8)}px`
        return
      }
      cxClose()
      it.run()
    })
  })
  document.addEventListener("mousedown", e => {
    if (cxm && !cxm.contains(e.target)) cxClose()
  }, true)
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return
    cxClose()
    closeThemePop()
  })
  document.addEventListener("wheel", cxClose, { passive: true, capture: true })
  window.addEventListener("resize", cxClose)
  window.addEventListener("blur", cxClose)
  const now = () => Date.now() + S.skew
  const ts = v => (v ? Date.parse(v) : NaN)
  const nf = new Intl.NumberFormat("tr-TR")
  const nf1 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 })
  const fHM = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" })
  const fHMS = new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const fDay = new Intl.DateTimeFormat("tr-TR", { weekday: "short", day: "numeric", month: "short" })
  const fLong = new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" })
  const UPCOMING = ["uploading", "ready", "preparing", "publishing"]
  const ST = {
    uploading: ["Yükleniyor", "info", "cloud-upload"], ready: ["Bulutta", "info", "cloud-check"],
    preparing: ["Hazırlanıyor", "acc", "hourglass"], publishing: ["Yayınlanıyor", "acc", "send"],
    published: ["Yayında", "ok", "circle-check"], error: ["Hata", "bad", "triangle-alert"], canceled: ["İptal", "mute", "ban"],
  }
  const STXT = {
    uploading: "Stüdyodan buluta yükleniyor", ready: "Video bulutta, yayın saatini bekliyor", preparing: "Instagram videoyu hazırlıyor",
    publishing: "Instagram'da yayınlanıyor", published: "Instagram'da yayında", error: "Paylaşım hata verdi",
  }
  const STEPS = [["Yükleniyor", "cloud-upload"], ["Bulutta", "cloud-check"], ["Hazırlanıyor", "hourglass"], ["Yayınlanıyor", "send"], ["Yayında", "instagram"]]
  const POS = { uploading: 0, ready: 1, preparing: 2, publishing: 3, published: 4 }
  const ERRPOS = { uploading: 0, ready: 2, preparing: 2, publishing: 3 }
  const EV = {
    upload: ["cloud-upload", "info"], ready: ["cloud-check", "info"], preparing: ["send", "acc"], published: ["circle-check", "ok"],
    error: ["triangle-alert", "bad"], synced: ["check", "ok"], canceled: ["ban", "mute"], retry: ["rotate-ccw", "warn"],
    plan: ["calendar-clock", "mute"], token: ["key-round", "ok"], warn: ["triangle-alert", "warn"], ig: ["instagram", "info"],
  }
  const KIND = { image: ["image", "Görsel"], carousel: ["images", "Albüm"], story: ["clapperboard", "Hikâye"], reels: ["film", "Reels"] }
  const LIM = { requests: 100000, kv_reads: 100000, kv_writes: 1000, kv_deletes: 1000, kv_lists: 1000 }
  const UROWS = [["requests", "İstek"], ["kv_reads", "KV okuma"], ["kv_writes", "KV yazma"], ["kv_deletes", "KV silme"], ["kv_lists", "KV listeleme"]]

  function dayDiff(t) {
    const a = new Date(t)
    const b = new Date(now())
    return Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()) - new Date(b.getFullYear(), b.getMonth(), b.getDate())) / 864e5)
  }
  function day(t) {
    const d = dayDiff(t)
    return d === 0 ? "Bugün" : d === 1 ? "Yarın" : d === -1 ? "Dün" : fDay.format(new Date(t))
  }
  const when = t => (Number.isNaN(t) ? "—" : `${day(t)} ${fHM.format(new Date(t))}`)
  function span(ms, sec) {
    const s = Math.floor(Math.abs(ms) / 1000)
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    const d = Math.floor(h / 24)
    if (d) return d + " gün" + (h % 24 ? " " + (h % 24) + " sa" : "")
    if (h) return h + " sa" + (m % 60 ? " " + (m % 60) + " dk" : "")
    if (m) return m + " dk" + (sec && s % 60 ? " " + (s % 60) + " sn" : "")
    return s + " sn"
  }
  function ago(ms) {
    const m = Math.floor(ms / 60000)
    const h = Math.floor(m / 60)
    const d = Math.floor(h / 24)
    return (d ? d + " gün" : h ? h + " sa" : m + " dk") + " önce"
  }
  function rel(t, sec) {
    if (Number.isNaN(t)) return ""
    const ms = t - now()
    if (ms <= 0 && sec) return ms > -90000 ? "şimdi" : ago(-ms)
    if (Math.abs(ms) < 45000) return ms > 0 ? span(ms, true) + " sonra" : "az önce"
    return ms > 0 ? span(ms, sec) + " sonra" : ago(-ms)
  }
  function bytes(n) {
    n = n || 0
    if (n >= 1073741824) return nf1.format(n / 1073741824) + " GB"
    if (n && n < 1048576) return nf.format(Math.max(1, Math.round(n / 1024))) + " KB"
    return nf1.format(n / 1048576) + " MB"
  }
  const lvl = p => (p >= 0.9 ? "bad" : p >= 0.7 ? "warn" : "ok")
  const safe = u => (typeof u === "string" && /^https:\/\//.test(u) ? u : "")
  const title = j => j.title || "Başlıksız paylaşım"

  function th(j, cls) {
    if (!j.thumb) return `<span class="${cls}">${ic("film", cls === "th xs" ? 16 : 22)}</span>`
    const src = `${base}/thumb/${encodeURIComponent(j.pid)}.jpg`
    return `<span class="${cls}">${ic("film", 18)}<img src="${src}" alt=""${S.seen.has(src) ? ' class="in"' : ""}></span>`
  }
  function pipe(j) {
    const err = j.status === "error"
    const cur = err ? (ERRPOS[j.stage] ?? 2) : (POS[j.status] ?? 1)
    const done = j.status === "published"
    return `<ol class="pipe">${STEPS.map(([n, i], k) => {
      const c = done || k < cur ? "done" : k === cur ? (err ? "err" : "cur") : ""
      return `<li class="${c}"><span class="pd">${ic(c === "done" && !(done && k === 4) ? "check" : c === "err" ? "x" : i, 13)}</span><span class="pn">${n}</span></li>`
    }).join("")}</ol>`
  }
  const tag = s => {
    const [l, c, i] = ST[s] || ST.ready
    return `<span class="tag ${c}">${ic(i, 12)}${l}</span>`
  }
  const cdSpan = t => `<span class="cd${t - now() <= 0 ? " due" : ""}" data-cd="${t}">${esc(rel(t, true))}</span>`
  const agoSpan = t => `<span data-ago="${t}">${esc(rel(t))}</span>`

  function snapInfo(d) {
    const sn = d.snapshot
    const at = sn ? ts(sn.at || sn.received) : NaN
    const every = sn && sn.studio && sn.studio.push_every ? sn.studio.push_every * 1000 : 30 * 60000
    return { sn, at, online: !!sn && now() - at < every + 2 * 60000 }
  }
  function uploads(d) {
    const m = {}
    for (const u of (d.snapshot && d.snapshot.uploading) || []) if (u && u.pid) m[u.pid] = u
    return m
  }
  function localItems(d) {
    return (((d.snapshot && d.snapshot.local_only) || []).map(x => ({ ...x, t: ts(x.at) })).filter(x => !Number.isNaN(x.t))).sort((a, b) => a.t - b.t)
  }
  function recentList(d) {
    const m = new Map()
    const active = new Set((d.jobs || []).filter(j => j.status !== "published").map(j => j.pid))
    for (const r of d.recent || []) if (!active.has(r.pid)) m.set(r.pid, r)
    for (const j of d.jobs || []) if (j.status === "published") m.set(j.pid, { ...j, live: true })
    const key = r => ts(r.published_at) || ts(r.at) || 0
    return [...m.values()].sort((a, b) => key(b) - key(a))
  }

  function header() {
    return `<header class="top">
      <span class="logo">${ic("cloud", 19)}</span>
      <div class="brand"><b>Sosyal Stüdyo <em>· Bulut</em></b><span><span class="ld${S.err ? " bad" : ""}"></span>${S.err ? "Bağlantı sorunu" : "Uzaktan takip paneli"}</span></div>
      <div class="acts">
        <button class="ib${thp ? " on" : ""}" data-act="theme" aria-label="Görünüm" title="Görünüm">${ic("palette", 18)}</button>
        <button class="ib" data-act="refresh" aria-label="Yenile" title="Yenile">${ic("refresh-cw", 18, S.busy ? "spin" : "")}</button>
        <button class="ib" data-act="logout" aria-label="Çıkış yap" title="Çıkış yap">${ic("log-out", 18)}</button>
      </div>
    </header>`
  }
  function strip(d) {
    const { sn, at, online } = snapInfo(d)
    const conn = (sn && sn.conn) || {}
    const studio = !sn ? `<span class="chip">${ic("monitor", 14)}Stüdyodan bilgi gelmedi</span>`
      : online ? `<span class="chip ok">${ic("monitor", 14)}Stüdyo açık</span>`
        : `<span class="chip" title="Son görülme: ${esc(when(at))}">${ic("monitor-off", 14)}<span>Stüdyo kapalı · ${agoSpan(at)}</span></span>`
    return `<div class="strip rise" style="--i:0">
      <span class="chip ${S.err ? "bad" : "ok"}"><span class="dot"></span>${S.err ? "Buluta ulaşılamadı" : "Bulut çalışıyor"}</span>
      ${studio}
      <span class="chip ${d.ig.configured ? "ig" : "warn"}">${ic("instagram", 14)}${d.ig.configured ? "Instagram bağlı" : "Instagram bağlı değil"}</span>
      ${conn.yt ? `<span class="chip ${conn.yt === "ok" ? "yt" : conn.yt === "reconnect" ? "warn" : "off"}">${ic("youtube", 14)}${conn.yt === "ok" ? "YouTube bağlı" : conn.yt === "reconnect" ? "YouTube yeniden bağlanmalı" : "YouTube bağlı değil"}</span>` : ""}
      ${conn.tt ? `<span class="chip ${conn.tt === "ok" ? "tt" : conn.tt === "login" ? "warn" : "off"}">${ic("music", 14)}${conn.tt === "ok" ? "TikTok bağlı" : conn.tt === "login" ? "TikTok girişi gerekli" : "TikTok bağlı değil"}</span>` : ""}
      ${sn && sn.limit && typeof sn.limit.percent === "number" ? `<span class="chip${lvl(sn.limit.percent / 100) === "ok" ? "" : " " + lvl(sn.limit.percent / 100)}">${ic("gauge", 14)}Ajan limiti %${esc(nf.format(sn.limit.percent))}</span>` : ""}
      ${sn && sn.studio && sn.studio.latest ? `<span class="chip warn">${ic("circle-arrow-up", 14)}Stüdyo için yeni sürüm v${esc(sn.studio.latest)}</span>` : ""}
    </div>`
  }
  function banners(d, q) {
    const out = []
    const errs = q.filter(j => j.status === "error")
    if (S.err && S.okAt) out.push(`<div class="banner bad rise"><span class="bi">${ic("cloud-off", 18)}</span><div class="grow"><b>Buluta şu an ulaşılamıyor</b><span>Gösterilen bilgiler ${esc(fHM.format(new Date(S.okAt)))} itibarıyla. Bağlantı gelince kendiliğinden yenilenir.</span></div></div>`)
    if (errs.length) out.push(`<div class="banner bad rise" data-open="${esc(errs[0].pid)}" role="button" tabindex="0"><span class="bi">${ic("triangle-alert", 18)}</span><div class="grow"><b>${errs.length === 1 ? "Bir paylaşım hata verdi" : errs.length + " paylaşım hata verdi"}</b><span>${esc(title(errs[0]))}${errs[0].error ? " · " + esc(errs[0].error) : ""}</span></div>${ic("chevron-right", 18)}</div>`)
    if (!d.ig.configured && q.some(j => UPCOMING.includes(j.status))) out.push(`<div class="banner warn rise"><span class="bi">${ic("instagram", 18)}</span><div class="grow"><b>Instagram bağlantısı bulutta yok</b><span>Stüdyo açıldığında bağlantı otomatik gönderilir. O zamana kadar bulut paylaşım yapamaz.</span></div></div>`)
    const le = d.meta && d.meta.last_error
    if (le && !le.pid && now() - ts(le.at) < 864e5) out.push(`<div class="banner warn rise"><span class="bi">${ic("key-round", 18)}</span><div class="grow"><b>Son uyarı · ${esc(rel(ts(le.at)))}</b><span>${esc(le.text)}</span></div></div>`)
    return out.join("")
  }
  function clockHtml(ms) {
    if (ms <= 0) return `<div class="due">${ic("loader-circle", 18, "spin")}Yayın saati geldi, Instagram'a gönderiliyor</div>`
    const s = Math.floor(ms / 1000)
    const d = Math.floor(s / 86400)
    const h = Math.floor(s / 3600) % 24
    const m = Math.floor(s / 60) % 60
    const p = n => String(n).padStart(2, "0")
    const parts = d ? [[String(d), "gün"], [p(h), "saat"], [p(m), "dakika"]] : [[p(h), "saat"], [p(m), "dakika"], [p(s % 60), "saniye"]]
    return parts.map(([v, u]) => `<span><b>${v}</b><i>${u}</i></span>`).join("")
  }
  function hero(d, loc) {
    const n = d.next && ((d.jobs || []).find(j => j.pid === d.next.pid) || d.next)
    const ahead = loc.filter(x => x.t > now())
    if (!n) {
      return `<section class="hero idle o1 rise" style="--i:1">
        <div class="hh">${ic("calendar-clock", 15)}Sıradaki paylaşım${fr("live")}</div>
        <div class="hempty"><span class="hei">${ic("cloud", 28)}</span><b>Bulutta bekleyen paylaşım yok</b><span>Stüdyoda bir Reels planlandığında buluta yüklenir ve geri sayım burada başlar.</span></div>
        ${ahead.length ? `<div class="hnote warn">${ic("monitor", 15)}<span>Bilgisayardan paylaşılacak ${ahead.length} gönderi var · ilki <b>${esc(when(ahead[0].t))}</b></span></div>` : ""}
      </section>`
    }
    const at = ts(n.at)
    const before = ahead.find(x => x.t < at)
    return `<section class="hero o1 st-${esc(n.status)} rise" style="--i:1">
      <div class="hh">${ic("calendar-clock", 15)}Sıradaki paylaşım ${fr("live")}${tag(n.status)}</div>
      <div class="hin" data-open="${esc(n.pid)}" role="button" tabindex="0">
        ${th(n, "hth")}
        <div class="hb">
          <h2>${esc(title(n))}</h2>
          <div class="hwhen">${ic("calendar-days", 15)}<span>${esc(dayDiff(at) === 0 ? "Bugün" : dayDiff(at) === 1 ? "Yarın" : fLong.format(new Date(at)))}</span>·<b>${esc(fHM.format(new Date(at)))}</b></div>
          <div class="hst">${esc(STXT[n.status] || "")}</div>
        </div>
      </div>
      <div class="clock" data-clock="${at}">${clockHtml(at - now())}</div>
      <div class="hnote">${ic("cloud-check", 15)}<span>Bilgisayar kapalı olsa da bulut zamanında paylaşır.</span></div>
      ${before ? `<div class="hnote warn">${ic("monitor", 15)}<span>Ondan önce bilgisayardan: <b>${esc(title(before))}</b> · ${esc(when(before.t))}</span></div>` : ""}
    </section>`
  }
  function tiles(q, rec, loc) {
    const errs = q.filter(j => j.status === "error").length
    const t = [
      ["kuyruk", q.length, "Bulutta sırada", "cloud", errs ? "bad" : "info"],
      ["yayinda", rec.length, "Yayınlanan", "circle-check", "ok"],
      ["yerel", loc.length, "Bilgisayarda", "monitor", loc.length ? "warn" : ""],
    ]
    return `<nav class="tiles o2 rise" style="--i:2">${t.map(([id, n, l, i, c]) => `<a href="#${id}" class="tile ${c}"><span class="ti">${ic(i, 16)}</span><b>${n}</b><span>${l}</span></a>`).join("")}</nav>`
  }
  function storageCard(d) {
    const s = d.storage || {}
    const lim = s.limit || 1073741824
    const used = s.used || 0
    const p = used / lim
    return `<section class="card o3 rise" style="--i:3">
      <div class="ch">${ic("hard-drive", 15)}Depolama ${fr("live")}<span class="tag ${lvl(p)}">%${esc(nf1.format(p * 100))}</span></div>
      <div class="big"><b>${esc(bytes(used))}</b><span>/ ${esc(bytes(lim))}</span></div>
      <div class="bar lg"><i class="${lvl(p)}" style="width:${Math.min(100, used ? Math.max(p * 100, 1.2) : 0)}%"></i></div>
      <div class="sub"><span>${ic("check", 13)}<b>${esc(bytes(Math.max(0, lim - used)))}</b> boş yer</span><span>${ic("film", 13)}<b>${s.videos || 0}</b> video bulutta</span></div>
    </section>`
  }
  function usageCard(d) {
    const { sn } = snapInfo(d)
    const u = sn && sn.usage
    const lim = { ...LIM, ...((sn && sn.limits) || {}) }
    const reset = new Date(Date.UTC(new Date(now()).getUTCFullYear(), new Date(now()).getUTCMonth(), new Date(now()).getUTCDate() + 1))
    const stamp = sn && ts(sn.at || sn.received)
    let body
    if (!u) {
      body = `<div class="none">${ic("gauge", 24)}<b>Kullanım bilgisi yok</b><span>Stüdyo açıkken Cloudflare'den alınıp buraya gönderilir.</span></div>`
    } else {
      body = UROWS.map(([k, l]) => {
        const v = u[k]
        const L = lim[k]
        if (v === null || v === undefined) return `<div class="urow na"><span class="ul">${l}</span><div class="bar"><i></i></div><span class="uv">bilinmiyor</span></div>`
        const p = v / L
        return `<div class="urow"><span class="ul">${l}</span><div class="bar"><i class="${lvl(p)}" style="width:${Math.min(100, v ? Math.max(p * 100, 1.5) : 0)}%"></i></div><span class="uv"><b>${nf.format(v)}</b><i>/ ${nf.format(L)}</i></span></div>`
      }).join("")
    }
    return `<section class="card o4 rise" style="--i:4">
      <div class="ch">${ic("activity", 15)}Bugünkü kullanım${stamp ? ` <span class="chs">· ${esc(fHM.format(new Date(stamp)))} itibarıyla</span>` : ""}${fr("p15")}</div>
      ${body}
      <div class="note">${ic("info", 13)}<span>Ücretsiz plan sınırları. Aşılırsa o gün istekler durur, ücret çıkmaz. Sayaçlar her gün ${esc(fHM.format(reset))} itibarıyla sıfırlanır.</span></div>
    </section>`
  }
  function jobCard(j, ups) {
    const at = ts(j.at)
    const up = j.status === "uploading" ? ups[j.pid] : null
    const pct = up ? Math.max(0, Math.min(100, Number(up.pct) || 0)) : 0
    const { at: snapAt, online } = snapInfo(S.d)
    return `<article class="job st-${esc(j.status)}" data-open="${esc(j.pid)}" role="button" tabindex="0">
      ${th(j, "th")}
      <div class="jb">
        <div class="jt"><b>${esc(title(j))}</b>${tag(j.status)}</div>
        <div class="jw">${ic("calendar-clock", 14)}<span>${esc(when(at))}</span>${UPCOMING.includes(j.status) ? cdSpan(at) : ""}</div>
        ${pipe(j)}
        ${up ? `<div class="up${online ? "" : " paused"}"><div class="upt"><b>%${Math.round(pct)}</b><span>${online ? "stüdyodan" : "yükleme durdu"} ·${agoSpan(snapAt)}</span></div><div class="bar"><i class="st" style="width:${pct}%"></i></div></div>` : ""}
        ${j.status === "error" && j.error ? `<div class="jerr">${ic("triangle-alert", 14)}<span>${esc(j.error)}</span></div>` : ""}
      </div>
      <span class="chev">${ic("chevron-right", 18)}</span>
    </article>`
  }
  function queue(q, ups) {
    return `<section id="kuyruk" class="o5 rise" style="--i:5">
      <h3 class="sh">${ic("cloud", 15)}Bulut kuyruğu <span class="n">${q.length}</span>${fr("live")}</h3>
      ${q.length ? q.map(j => jobCard(j, ups)).join("") : `<div class="empty">${ic("inbox", 24)}<div><b>Kuyruk boş</b><span>Planlanan Reels videoları buluta yüklendikçe burada görünür.</span></div></div>`}
    </section>`
  }
  function localSec(d, loc) {
    const { sn, at, online } = snapInfo(d)
    let body
    if (!sn) body = `<div class="empty">${ic("monitor", 24)}<div><b>Stüdyodan bilgi gelmedi</b><span>Stüdyo açıldığında bilgisayardan yapılacak paylaşımlar burada listelenir.</span></div></div>`
    else if (!loc.length) body = `<div class="empty ok">${ic("circle-check", 24)}<div><b>Hepsi bulutta</b><span>Bilgisayarın açık kalmasını gerektiren paylaşım yok.</span></div></div>`
    else {
      const rows = loc.map(x => {
        const [i, k] = KIND[x.kind] || ["image", ""]
        const past = x.t < now()
        const risk = !past && !online && x.t - now() < 864e5
        return `<div class="lrow${past ? " past" : ""}${risk ? " risk" : ""}"><span class="li">${ic(i, 17)}</span><div class="grow"><b>${esc(title(x))}</b><span class="lt">${k ? `<span>${k}</span>·` : ""}<span>${esc(when(x.t))}</span>${past ? "" : cdSpan(x.t)}</span>${x.detail ? `<i>${esc(x.detail)}</i>` : ""}</div></div>`
      }).join("")
      body = `<div class="warnbox">${ic("monitor", 19)}<div><b>Bu saatlerde bilgisayar açık olmalı</b><span>Bu paylaşımlar bulutta değil. Planlanan saatte bilgisayar açık ve Sosyal Stüdyo çalışıyor olmalı.</span>${!online ? `<span class="off">Stüdyo şu an kapalı görünüyor · son görülme ${agoSpan(at)}</span>` : ""}</div></div><div class="card">${rows}</div>`
    }
    return `<section id="yerel" class="o6 rise" style="--i:6"><h3 class="sh">${ic("monitor", 15)}Bilgisayarda kalacak <span class="n">${loc.length}</span>${fr("p15")}</h3>${body}</section>`
  }
  function recentSec(rec) {
    const rows = rec.map(r => {
      const link = safe(r.permalink)
      const pt = ts(r.published_at) || ts(r.at)
      return `<div class="rrow" data-open="${esc(r.pid)}" role="button" tabindex="0">${th(r, "th xs")}<div class="grow"><b>${esc(title(r))}</b><span>${esc(when(pt))} · ${r.live ? `<span class="live">yeni</span>` : agoSpan(pt)}</span></div>${link ? `<a class="btn sm ig" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${ic("instagram", 14)}Aç</a>` : ""}</div>`
    }).join("")
    return `<section id="yayinda" class="o7 rise" style="--i:7"><h3 class="sh">${ic("instagram", 15)}Son yayınlananlar <span class="n">${rec.length}</span>${fr("live")}</h3>
      ${rec.length ? `<div class="card">${rows}</div>` : `<div class="empty">${ic("instagram", 24)}<div><b>Henüz yok</b><span>Bulutun paylaştığı gönderiler burada Instagram bağlantılarıyla görünür.</span></div></div>`}
    </section>`
  }
  function eventsSec(ev) {
    const list = S.all ? ev : ev.slice(0, 7)
    const rows = list.map(e => {
      const [i, c] = EV[e.kind] || ["info", ""]
      const t = ts(e.at)
      return `<li><span class="evi ${c}">${ic(i, 14)}</span><div class="grow"><p>${esc(e.text)}</p>${e.title ? `<b>${esc(e.title)}</b>` : ""}<span class="tm">${agoSpan(t)} · ${esc(when(t))}</span></div></li>`
    }).join("")
    return `<section id="olaylar" class="o8 rise" style="--i:8"><h3 class="sh">${ic("history", 15)}Olaylar${fr("live")}</h3>
      ${ev.length ? `<div class="card"><ol class="tl">${rows}</ol>${ev.length > 7 ? `<button class="more" data-act="all">${S.all ? "Daha az göster" : `Tümünü göster (${ev.length})`}</button>` : ""}</div>` : `<div class="empty">${ic("history", 24)}<div><b>Henüz olay yok</b><span>Yükleme, yayın ve hata kayıtları burada akar.</span></div></div>`}
    </section>`
  }

  const TABS = [["ozet", "Özet", "layout-dashboard"], ["takvim", "Takvim", "calendar-days"], ["uretim", "Üretim", "workflow"], ["istatistik", "İstatistik", "chart-column"]]
  const PST = {
    sirada: ["Sırada", "mute", "hourglass"], uretimde: ["Üretimde", "acc", "wand-sparkles"], inceleme: ["İncelemede", "info", "eye"],
    planlandi: ["Planlandı", "ok", "calendar-clock"], paylasiliyor: ["Paylaşılıyor", "acc", "send"], paylasildi: ["Paylaşıldı", "ok", "circle-check"],
    hata: ["Hata", "bad", "triangle-alert"],
  }
  const PORDER = ["sirada", "uretimde", "inceleme", "planlandi", "paylasildi", "hata"]
  const PLAT = { ig: ["instagram", "Instagram"], yt: ["youtube", "YouTube"], tt: ["music", "TikTok"] }
  const TST = {
    cloud: ["Bulutta", "info"], local: ["Bilgisayardan", "warn"], published: ["Yayında", "ok"], scheduled: ["Planlandı", "ok"],
    queued: ["Yükleme bekliyor", "warn"], uploading: ["Yükleniyor", "info"], error: ["Hata", "bad"], attached: ["Bağlandı", "ok"],
  }
  const AG = { working: ["Çalışıyor", "acc", "wand-sparkles"], watching: ["Hazır", "ok", "circle-check"], off: ["Kapalı", "mute", "circle-pause"] }
  const CP = {
    calisiyor: ["Çalışıyor", "acc", "zap"], duraklatildi: ["Duraklatıldı", "warn", "circle-pause"], bitti: ["Bitti", "ok", "circle-check"],
    hata: ["Hata", "bad", "triangle-alert"], iptal: ["İptal", "mute", "ban"],
  }
  const NK = {
    published: ["circle-check", "ok"], done: ["circle-check", "ok"], ready: ["film", "info"], error: ["triangle-alert", "bad"],
    follow: ["users", "info"], dm: ["message-circle", "info"], comment: ["message-circle", "info"], schedule: ["calendar-clock", "info"],
  }
  const SP = {
    ig: ["instagram", "Instagram", [["followers", "Takipçi", "ig_f"], ["views", "Toplam izlenme", "ig_v", "saatte bir"]],
      [["likes", "beğeni", "heart"], ["comments", "yorum", "message-circle"], ["reach7", "erişim (7 gün)", "users"], ["media", "gönderi", "images"]]],
    yt: ["youtube", "YouTube", [["subscribers", "Abone", "yt_s"], ["views", "Toplam izlenme", "yt_v"]],
      [["likes", "beğeni", "heart"], ["comments", "yorum", "message-circle"], ["videos", "video", "film"]]],
    tt: ["music", "TikTok", [["followers", "Takipçi", "tt_f"], ["views", "Toplam izlenme", "tt_v"]], [["likes", "beğeni", "heart"], ["videos", "video", "film"]]],
  }
  const nfc = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 })
  const fmtN = v => (typeof v === "number" ? (Math.abs(v) >= 1e5 ? nfc.format(v) : nf.format(v)) : "—")
  const snapOf = d => (d && d.snapshot) || {}
  const FR = {
    live: ["Anlık", "Buluttan gelir; panel her dakika kendiliğinden yenilenir"],
    p15: ["15 dk", "Stüdyodan gelir; stüdyo açıkken 15 dakikada bir güncellenir"],
    p60: ["Saatlik", "Stüdyodan gelir; stüdyo açıkken saatte bir güncellenir"],
    p6h: ["6 saatte bir", "Stüdyodan gelir; stüdyo açıkken 6 saatte bir güncellenir"],
  }
  const frTag = k => `<span class="fr ${k}" title="${FR[k][1]}">${k === "live" ? "<i></i>" : ic("clock", 11)}${FR[k][0]}</span>`
  const fr = k => (k !== "live" && S.d && !snapInfo(S.d).online
    ? `<span class="fr old" title="Stüdyo kapalı; son alınan değerler gösteriliyor">${ic("monitor-off", 11)}Güncellenmiyor</span>` : frTag(k))
  const frLegend = () => `<div class="frleg">${frTag("live")}<span>buluttan, panel her dakika yenilenir</span>${frTag("p15")}<span>stüdyodan, stüdyo açıkken gelir</span></div>`
  const ptag = (map, k) => {
    const [l, c, i] = map[k] || [k || "—", "mute", "info"]
    return `<span class="tag ${c}">${ic(i, 12)}${esc(l)}</span>`
  }
  const needsPc = x => x.ig === "local" || x.yt === "queued" || x.yt === "uploading" || (!!x.tt && x.tt !== "scheduled" && x.tt !== "published")
  const empty = (i, b, s, cls = "") => `<div class="empty${cls ? " " + cls : ""}">${ic(i, 24)}<div><b>${b}</b><span>${s}</span></div></div>`

  function tabBar(d) {
    const sn = snapOf(d)
    const n = {
      takvim: (sn.plan || []).filter(x => ts(x.at) > now() - 36e5).length,
      uretim: ((sn.pipeline && sn.pipeline.items) || []).filter(x => x.status !== "paylasiliyor").length,
    }
    return `<nav class="seg" role="tablist">${TABS.map(([id, l, i]) => `<button class="sg${S.tab === id ? " on" : ""}" data-act="tab" data-tab="${id}" role="tab" aria-selected="${S.tab === id}">${ic(i, 17)}<span>${l}</span>${n[id] ? `<em>${n[id]}</em>` : ""}</button>`).join("")}</nav>`
  }
  function platTag(k, st) {
    if (!st) return ""
    const [pi, pn] = PLAT[k]
    const [l, c] = TST[st] || [st, ""]
    return `<span class="pt ${c}" title="${pn}: ${esc(l)}">${ic(pi, 13)}<span>${esc(l)}</span></span>`
  }
  function calendarView(d) {
    const sn = snapOf(d)
    const { online } = snapInfo(d)
    if (!d.snapshot || !Array.isArray(sn.plan)) return empty("calendar-days", "Takvim bilgisi gelmedi", "Stüdyo açıldığında planlı paylaşımlar burada listelenir.")
    const plan = (sn.plan || []).map(x => ({ ...x, t: ts(x.at) })).filter(x => !Number.isNaN(x.t) && x.t > now() - 36e5).sort((a, b) => a.t - b.t)
    if (!plan.length) return empty("calendar-days", "Planlı paylaşım yok", "Stüdyoda bir video planlandığında Instagram, YouTube ve TikTok saatleriyle burada görünür.")
    const pc = plan.filter(needsPc)
    const days = new Map()
    for (const x of plan) {
      const k = new Date(x.t).toDateString()
      if (!days.has(k)) days.set(k, [])
      days.get(k).push(x)
    }
    const open = new Set((d.jobs || []).map(j => j.pid))
    let i = 2
    const head = `<div class="frline rise" style="--i:1">${fr("p15")}<span>Takvim stüdyodan gelir · son veri ${agoSpan(snapInfo(d).at)}</span></div>
      <div class="card calsum rise" style="--i:1">
        <div><b>${plan.length}</b><span>planlı paylaşım</span></div>
        <div><b>${days.size}</b><span>gün</span></div>
        <div class="${pc.length ? "warn" : "ok"}"><b>${pc.length}</b><span>bilgisayar gerektiren</span></div>
      </div>
      ${pc.length && !online ? `<div class="banner warn rise" style="--i:2"><span class="bi">${ic("monitor", 18)}</span><div class="grow"><b>Stüdyo şu an kapalı</b><span>Bilgisayardan yapılacak ${pc.length} paylaşım var, ilki ${esc(when(pc[0].t))}. O saatte bilgisayar açık olmalı.</span></div></div>` : ""}`
    const groups = [...days.values()].map(list => `<section class="calday rise" style="--i:${Math.min(++i, 9)}">
        <h3 class="sh">${ic("calendar-days", 15)}${esc(day(list[0].t))}${Math.abs(dayDiff(list[0].t)) > 1 ? "" : ` <span class="chs">${esc(fLong.format(new Date(list[0].t)))}</span>`}<span class="n">${list.length}</span></h3>
        <div class="card">${list.map(x => `<div class="crow${needsPc(x) ? " pc" : ""}"${open.has(x.pid) ? ` data-open="${esc(x.pid)}" role="button" tabindex="0"` : ""}>
          <span class="ctime"><b>${esc(fHM.format(new Date(x.t)))}</b>${cdSpan(x.t)}</span>
          <div class="grow"><b>${esc(title(x))}</b><div class="pts">${platTag("ig", x.ig)}${platTag("yt", x.yt)}${platTag("tt", x.tt)}</div></div>
        </div>`).join("")}</div>
      </section>`).join("")
    return head + groups + `<div class="note">${ic("info", 13)}<span><b>Bulutta</b> ve <b>Planlandı</b> olanlar bilgisayar kapalıyken de paylaşılır. <b>Bilgisayardan</b> olanlar için o saatte, <b>Yükleme bekliyor</b> olanlar için o saatten önce stüdyo bir kez açık olmalı.</span></div>`
  }
  function limitCard(sn) {
    const c = sn.limit || {}
    const has = typeof c.percent === "number"
    const p = has ? c.percent / 100 : 0
    const reset = ts(c.resets)
    const past = !Number.isNaN(reset) && reset <= now()
    const body = !has ? `<div class="none">${ic("gauge", 24)}<b>Kullanım bilgisi yok</b><span>Stüdyo kullanım raporunu aldığında burada görünür.</span></div>`
      : `<div class="big"><b>%${esc(nf.format(c.percent))}</b><span>5 saatlik limitin kullanıldı</span></div>
        <div class="bar lg"><i class="${lvl(p)}" style="width:${Math.min(100, c.percent ? Math.max(p * 100, 1.5) : 0)}%"></i></div>
        <div class="sub">${Number.isNaN(reset) ? "" : past ? `<span>${ic("rotate-ccw", 13)}Limit sıfırlandı · yeni rapor bekleniyor</span>` : `<span>${ic("rotate-ccw", 13)}Sıfırlanma <b>${esc(fHM.format(new Date(reset)))}</b> ${cdSpan(reset)}</span>`}${c.updated ? `<span>${ic("history", 13)}${agoSpan(ts(c.updated))}</span>` : ""}</div>`
    return `<section class="card o2 rise" style="--i:4"><div class="ch">${ic("gauge", 15)}Ajan kullanımı${fr("p15")}${has ? ` <span class="tag ${lvl(p)}">%${esc(nf.format(c.percent))}</span>` : ""}</div>${body}</section>`
  }
  function agentsCard(sn) {
    const list = (sn.agents || []).slice().sort((a, b) => (a.live === "off") - (b.live === "off"))
    const on = list.filter(a => a.live && a.live !== "off").length
    const rows = list.map(a => {
      const sub = a.post ? esc(a.post) + (a.text ? " · " + esc(a.text) : "") : a.live === "off" ? (a.seen ? `Son görülme ${agoSpan(ts(a.seen))}` : "Kapalı") : "İş bekliyor"
      return `<div class="arow${a.live === "off" ? " off" : ""}"><span class="li ${(AG[a.live] || [])[1] || ""}">${ic("bot", 17)}</span>
        <div class="grow"><b>${esc(a.name)}${a.account && a.account !== "main" ? `<em class="accn">${esc(String(a.account).toUpperCase())}</em>` : ""}</b><span>${sub}</span></div>${ptag(AG, a.live)}</div>`
    }).join("")
    return `<section class="card o4 rise" style="--i:5"><div class="ch">${ic("bot", 15)}Ajanlar ${fr("p15")}<span class="tag ${on ? "ok" : "mute"}">${on} açık</span></div>
      ${list.length ? rows : `<div class="none">${ic("bot", 24)}<b>Ajan yok</b><span>Stüdyoya bir ajan bağlandığında burada görünür.</span></div>`}</section>`
  }
  function autoSec(sn) {
    const list = sn.auto || []
    if (!list.length) return ""
    const n = v => nf.format(v || 0)
    return `<section class="o5 rise" style="--i:5"><h3 class="sh">${ic("zap", 15)}Otopilot <span class="n">${list.length}</span>${fr("p15")}</h3><div class="card">${list.map(a => `<div class="lrow">
        <span class="li ${(CP[a.status] || [])[1] || ""}">${ic("zap", 17)}</span>
        <div class="grow"><b>${esc(a.name || "Kampanya")}</b><span class="lt">${ptag(CP, a.status)}<span>${n(a.videos)} video</span>·<span>${n(a.scheduled)} planlı</span>·<span>${n(a.published)} yayında</span>${a.producing ? `·<span>${n(a.producing)} üretimde</span>` : ""}</span>
          ${a.stage ? `<i>${esc(a.stage)}</i>` : ""}${a.next && a.next.at ? `<i>${ic("calendar-clock", 12)}Sıradaki: ${esc(a.next.title)} · ${esc(when(ts(a.next.at)))}</i>` : ""}</div>
      </div>`).join("")}</div></section>`
  }
  function productionView(d) {
    const sn = snapOf(d)
    if (!d.snapshot || !sn.pipeline) return empty("workflow", "Üretim bilgisi gelmedi", "Stüdyo açıldığında üretim hattı, ajanlar ve kullanım limiti burada görünür.")
    const c = sn.pipeline.counts || {}
    const tl = `<nav class="ptiles o1 rise" style="--i:2">${PORDER.map(k => {
      const [l, cl, i] = PST[k]
      return `<div class="tile ${c[k] ? cl : ""}"><span class="ti">${ic(i, 16)}</span><b>${c[k] || 0}</b><span>${l}</span></div>`
    }).join("")}</nav>`
    const items = sn.pipeline.items || []
    const rows = items.map(x => `<div class="lrow">
        <span class="li ${(PST[x.status] || [])[1] || ""}">${ic((PST[x.status] || ["", "", "film"])[2], 17)}</span>
        <div class="grow"><b>${esc(title(x))}</b><span class="lt">${ptag(PST, x.status)}${x.status === "inceleme" && x.ready ? `<span class="tag ok">${ic("check", 12)}Onayını bekliyor</span>` : ""}${x.agent ? `<span class="who">${ic("bot", 12)}${esc(x.agent)}</span>` : ""}</span>
          ${x.stage ? `<i>${esc(x.stage)}</i>` : ""}${x.error ? `<i class="err">${esc(x.error)}</i>` : ""}${x.updated ? `<i class="tm">Son değişiklik ${agoSpan(ts(x.updated))}</i>` : ""}</div>
      </div>`).join("")
    const list = items.length ? `<div class="card">${rows}</div>` : empty("circle-check", "Üretimde video yok", "Yeni bir fikir üretime alındığında ajanların ilerlemesi burada görünür.", "ok")
    return `<div class="cols"><div class="col">${tl}
        <section class="o3 rise" style="--i:3"><h3 class="sh">${ic("wand-sparkles", 15)}Üretim hattı <span class="n">${items.length}</span>${fr("p15")}</h3>${list}</section>
        ${autoSec(sn)}</div>
      <div class="col">${limitCard(sn)}${agentsCard(sn)}</div></div>`
  }
  function delta(hist, key, cur) {
    if (typeof cur !== "number" || !hist.length) return ""
    const cut = new Date(now() - 7 * 864e5).toISOString().slice(0, 10)
    const known = hist.filter(h => typeof h[key] === "number")
    const base = known.filter(h => h.d <= cut).pop() || known[0]
    if (!base || base.d === new Date(now()).toISOString().slice(0, 10)) return ""
    const dv = cur - base[key]
    const days = Math.max(1, Math.round((now() - Date.parse(base.d + "T12:00:00")) / 864e5))
    return `<span class="dl ${dv > 0 ? "gain" : dv < 0 ? "loss" : ""}">${ic(dv < 0 ? "trending-down" : "trending-up", 13)}${dv > 0 ? "+" : ""}${esc(nf.format(dv))}<i>${days} günde</i></span>`
  }
  function spark(hist, key, label) {
    const pts = hist.filter(h => typeof h[key] === "number")
    if (pts.length < 2) return `<div class="spkn">${ic("chart-column", 15)}<span>Grafik yarından itibaren dolmaya başlar; her gün bir nokta eklenir.</span></div>`
    const W = 300
    const H = 64
    const P = 4
    let lo = Math.min(...pts.map(h => h[key]))
    let hi = Math.max(...pts.map(h => h[key]))
    if (lo === hi) {
      lo -= 1
      hi += 1
    }
    const x = i => P + (i * (W - 2 * P)) / (pts.length - 1)
    const y = v => H - P - ((v - lo) * (H - 2 * P)) / (hi - lo)
    const line = pts.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h[key]).toFixed(1)}`).join(" ")
    const area = `${line} L${x(pts.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`
    const fd = s => fDay.format(new Date(s + "T12:00:00"))
    return `<div class="spk" data-spk="${esc(JSON.stringify(pts.map(h => [h.d, h[key]])))}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}, son ${pts.length} gün: ${esc(nf.format(pts[0][key]))} → ${esc(nf.format(pts[pts.length - 1][key]))}"><path class="sa" d="${area}"/><path class="sl" d="${line}" vector-effect="non-scaling-stroke"/></svg><span class="sx"></span><span class="stip"></span><div class="sax"><span>${esc(fd(pts[0].d))}</span><span>${esc(label)}</span><span>${esc(fd(pts[pts.length - 1].d))}</span></div></div>`
  }
  function platCard(k, s, hist, i, frozen) {
    if (!s) return ""
    const [pi, pn, heads, subs] = SP[k]
    const who = s.username ? "@" + s.username : s.title || ""
    return `<section class="card pcard ${k} rise" style="--i:${i}">
      <div class="ch">${ic(pi, 15)}${pn}${who ? `<span class="chs">${esc(who)}</span>` : ""}${fr(k === "ig" ? (s.cloud ? "live" : "p15") : k === "yt" ? "p15" : "p6h")}</div>
      <div class="kpis">${heads.map(([f, l, h, note]) => `<div class="kpi"><span class="kl">${l}${note ? ` <i class="kf" title="Stüdyo açıkken ${note} güncellenir">${ic("clock", 11)}</i>` : ""}</span><b>${esc(fmtN(s[f]))}</b>${delta(hist, h, s[f])}</div>`).join("")}</div>
      ${spark(hist, heads[0][2], heads[0][1])}
      ${frozen ? `<div class="frz">${ic("monitor-off", 13)}<span>Stüdyo kapalı, bu değerler güncellenmiyor${s.at ? ` · ${agoSpan(ts(s.at))} alındı` : ""}</span></div>` : ""}
      <div class="sub">${subs.filter(([f]) => typeof s[f] === "number").map(([f, l, si]) => `<span>${ic(si, 13)}<b>${esc(fmtN(s[f]))}</b>${l}</span>`).join("")}${s.at ? `<span>${ic(s.cloud ? "cloud" : "history", 13)}${s.cloud ? "Buluttan · " : ""}${agoSpan(ts(s.at))}</span>` : ""}</div>
    </section>`
  }
  function igMerge(st, c) {
    const hist = ((st && st.hist) || []).map(h => ({ ...h }))
    let ig = st && st.ig
    if (!c || typeof c.followers !== "number") return { ig, hist }
    const by = new Map(hist.map(h => [h.d, h]))
    const put = (day, f, force) => {
      const e = by.get(day)
      if (e) {
        if (force || typeof e.ig_f !== "number") e.ig_f = f
        return
      }
      const n = { d: day, ig_f: f }
      hist.push(n)
      by.set(day, n)
    }
    for (const h of c.hist || []) if (typeof h.f === "number") put(h.d, h.f)
    const sAt = ig ? ts(ig.at || st.at) : NaN
    if (Number.isNaN(sAt) || ts(c.at) > sAt) {
      ig = { ...(ig || {}), followers: c.followers, follows: c.follows ?? (ig && ig.follows), media: c.media ?? (ig && ig.media),
        username: c.username || (ig && ig.username), at: c.at, cloud: true }
      const t = new Date(now())
      put(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`, c.followers, true)
    }
    hist.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
    return { ig, hist }
  }
  function recentPosts(list) {
    if (!list.length) return ""
    const rows = list.map(r => {
      const [pi, pn] = PLAT[r.p] || ["film", ""]
      const link = safe(r.u)
      const t = ts(r.at)
      const num = (v, i, l) => (typeof v === "number" ? `<span title="${l}">${ic(i, 12)}${esc(fmtN(v))}</span>` : "")
      return `<div class="srow"><span class="li ${esc(r.p)}" title="${pn}">${ic(pi, 16)}</span><div class="grow"><b>${esc(r.t || "Başlıksız paylaşım")}</b><span>${Number.isNaN(t) ? pn : `${pn} · ${esc(when(t))}`}</span></div>
        <div class="nums">${num(r.v, "eye", "İzlenme")}${num(r.l, "heart", "Beğeni")}${num(r.c, "message-circle", "Yorum")}</div>
        ${link ? `<a class="ib sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer" aria-label="${pn}'da aç">${ic("external-link", 15)}</a>` : ""}</div>`
    }).join("")
    return `<section class="rise" style="--i:6"><h3 class="sh">${ic("trending-up", 15)}Son paylaşımların performansı${fr("p60")}</h3><div class="card">${rows}</div></section>`
  }
  function statsView(d) {
    const st = snapOf(d).stats
    const { ig, hist } = igMerge(st, d.igstat)
    if (!st && !ig) return empty("chart-column", "İstatistik henüz gelmedi", "Uzaktan takip açıkken stüdyo hesap istatistiklerini 15 dakikada bir toplar ve buraya gönderir.")
    const sAt = st ? ts(st.at) : NaN
    const stale = Number.isNaN(sAt) || now() - sAt > 70 * 60000
    const cards = [["ig", ig], ["yt", st && st.yt], ["tt", st && st.tt]].map(([k, s], i) => platCard(k, s, hist, 2 + i, k !== "ig" && stale)).join("")
    return `<div class="sthead rise" style="--i:1">${ic("history", 14)}<span>${st ? `Stüdyodan son veri ${agoSpan(sAt)} · stüdyo açıkken 15 dakikada bir yenilenir` : "Stüdyodan henüz istatistik gelmedi"}</span></div>
      <div class="note stnote rise" style="--i:1">${ic("info", 13)}<span><b>Instagram</b> takipçi ve gönderi sayısını bulut, stüdyo kapalıyken de günceller. <b>YouTube</b> ve <b>TikTok</b> istatistikleri yalnızca stüdyo açıkken güncellenir; kapalıyken son alınan değerler görünür.</span></div>
      ${cards ? `<div class="pgrid">${cards}</div>` : empty("users", "Bağlı hesap yok", "Stüdyoda Instagram, YouTube ya da TikTok bağlandığında istatistikler burada görünür.")}
      ${recentPosts((st && st.recent) || [])}`
  }
  function notesSec(d) {
    const n = snapOf(d).notes
    if (!n || !(n.items || []).length) return ""
    const rows = n.items.slice(0, 6).map(e => {
      const [i, c] = NK[e.kind] || ["bell", ""]
      const t = ts(e.at)
      return `<li><span class="evi ${c}">${ic(i, 14)}</span><div class="grow"><p>${esc(e.title)}</p>${e.text ? `<b>${esc(e.text)}</b>` : ""}<span class="tm">${agoSpan(t)} · ${esc(when(t))}</span></div></li>`
    }).join("")
    return `<section class="o7 rise" style="--i:9"><h3 class="sh">${ic("bell", 15)}Stüdyo bildirimleri${n.unread ? ` <span class="n" title="Okunmamış">${n.unread}</span>` : ""}${fr("p15")}</h3><div class="card"><ol class="tl">${rows}</ol></div></section>`
  }
  function sparkHover(e) {
    const s = e.target.closest && e.target.closest(".spk[data-spk]")
    if (!s) return
    let pts
    try {
      pts = JSON.parse(s.dataset.spk)
    } catch {
      return
    }
    const r = s.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const i = Math.round(f * (pts.length - 1))
    const px = ((4 + (i * 292) / (pts.length - 1)) / 300) * r.width
    const tip = s.querySelector(".stip")
    tip.innerHTML = `<b>${esc(nf.format(pts[i][1]))}</b><span>${esc(fDay.format(new Date(pts[i][0] + "T12:00:00")))}</span>`
    tip.style.left = Math.max(46, Math.min(r.width - 46, px)) + "px"
    s.querySelector(".sx").style.left = px + "px"
    s.classList.add("hov")
  }

  function render() {
    const d = S.d
    const jobs = d.jobs || []
    const q = jobs.filter(j => j.status !== "published")
    const rec = recentList(d)
    const loc = localItems(d)
    const ups = uploads(d)
    root.className = S.first ? "first" : ""
    const view = S.tab === "takvim" ? `<div class="one">${calendarView(d)}</div>` : S.tab === "uretim" ? productionView(d)
      : S.tab === "istatistik" ? `<div class="one">${statsView(d)}</div>` : `<div class="cols">
      <div class="col">${hero(d, loc)}${tiles(q, rec, loc)}${queue(q, ups)}${localSec(d, loc)}</div>
      <div class="col">${storageCard(d)}${usageCard(d)}${notesSec(d)}${recentSec(rec)}${eventsSec(d.events || [])}</div>
    </div>`
    root.innerHTML = header() + `<main class="wrap">${strip(d)}${banners(d, q)}${tabBar(d)}${frLegend()}${view}
    <footer class="foot"><span>${ic("history", 13)}Son yenileme <b>${esc(fHMS.format(new Date(S.okAt || Date.now())))}</b> · 60 sn'de bir</span><span>${ic("lock", 13)}Salt okunur · sürüm ${esc(d.version)}</span></footer></main>`
    if (S.first) {
      S.first = false
      setTimeout(() => root.classList.remove("first"), 1600)
    }
  }
  function setBusy(on) {
    S.busy = on
    const el = root.querySelector('[data-act="refresh"] .ic')
    if (el) el.classList.toggle("spin", on)
  }
  async function load() {
    if (S.busy) return
    setBusy(true)
    S.last = Date.now()
    try {
      const r = await fetch(base + "/data", { cache: "no-store", credentials: "same-origin" })
      if (r.status === 401) {
        const had = !!S.d
        S.d = null
        showLogin(had ? "Oturum sona erdi, yeniden giriş yap." : "", "info")
        return
      }
      if (!r.ok) throw new Error("HTTP " + r.status)
      const d = await r.json()
      const skew = Date.parse(d.now) + 500 - Date.now()
      S.skew = Math.abs(skew) > 5000 ? skew : 0
      S.d = d
      S.err = false
      S.okAt = Date.now()
      render()
    } catch {
      S.err = true
      if (S.d) render()
      else root.innerHTML = `<div class="boot"><div class="boot-err"><span class="logo">${ic("cloud-off", 26)}</span><b>Buluta ulaşılamadı</b><span>İnternet bağlantını kontrol edip tekrar dene.</span><button class="btn primary" data-act="refresh">${ic("refresh-cw", 16)}Tekrar dene</button></div></div>`
    } finally {
      setBusy(false)
    }
  }

  function showLogin(msg, kind) {
    S.login = true
    closeSheet(true)
    root.className = ""
    root.innerHTML = `<main class="login"><div class="lgc">
      <div class="lg-logo">${ic("cloud", 34)}</div>
      <h1>Bulut paneli</h1>
      <p>Sosyal Stüdyo · uzaktan takip</p>
      <form id="lf" novalidate>
        <input class="vh" type="text" name="username" autocomplete="username" value="Sosyal Stüdyo" tabindex="-1" aria-hidden="true" readonly>
        <label class="t" for="pw">Şifre</label>
        <div class="pw">${ic("lock", 18)}<input id="pw" type="password" name="password" autocomplete="current-password" placeholder="Panel şifresi" enterkeyhint="go" required><button type="button" class="eye" data-eye aria-label="Şifreyi göster">${ic("eye", 19)}</button></div>
        <button class="btn primary wide lgb" id="lb" type="submit">Giriş yap ${ic("chevron-right", 18)}</button>
        <div class="lerr${kind === "info" ? " info" : ""}" id="le" role="alert">${esc(msg || "")}</div>
      </form>
      <div class="lg-foot">${ic("shield-check", 15)}<span>Salt okunur panel. Şifre stüdyoda <b>Bulut · Uzaktan takip</b> bölümünden belirlenir.</span></div>
    </div></main>`
    const f = root.querySelector("#lf")
    const pw = root.querySelector("#pw")
    const eye = root.querySelector("[data-eye]")
    eye.addEventListener("click", () => {
      const show = pw.type === "password"
      pw.type = show ? "text" : "password"
      eye.innerHTML = ic(show ? "eye-off" : "eye", 19)
      eye.setAttribute("aria-label", show ? "Şifreyi gizle" : "Şifreyi göster")
      pw.focus()
    })
    f.addEventListener("submit", async e => {
      e.preventDefault()
      const le = root.querySelector("#le")
      const lb = root.querySelector("#lb")
      if (!pw.value) {
        le.className = "lerr"
        le.textContent = "Şifreyi yaz."
        pw.focus()
        return
      }
      lb.disabled = true
      lb.innerHTML = `${ic("loader-circle", 18, "spin")}Kontrol ediliyor`
      let r = null
      try {
        r = await fetch(base + "/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw.value }), credentials: "same-origin" })
      } catch {}
      if (r && r.ok) {
        S.login = false
        S.first = true
        lb.innerHTML = `${ic("check", 18)}Giriş yapıldı`
        await load()
        return
      }
      let msg = "Buluta ulaşılamadı, tekrar dene."
      if (r) msg = (await r.json().catch(() => ({}))).error || "Giriş yapılamadı."
      lb.disabled = false
      lb.innerHTML = `Giriş yap ${ic("chevron-right", 18)}`
      le.className = "lerr"
      le.textContent = msg
      const form = root.querySelector("#lf")
      form.classList.remove("shake")
      void form.offsetWidth
      form.classList.add("shake")
      pw.select()
    })
    if (matchMedia("(hover:hover)").matches) pw.focus()
  }

  let sbg = null
  let sh = null
  function ensureSheet() {
    if (sh) return
    sbg = document.createElement("div")
    sbg.className = "sbg"
    sh = document.createElement("div")
    sh.className = "sheet"
    sh.setAttribute("role", "dialog")
    sh.setAttribute("aria-modal", "true")
    document.body.append(sbg, sh)
    sbg.addEventListener("click", () => closeSheet())
    sh.addEventListener("click", e => {
      const a = e.target.closest("[data-act]")
      if (!a) return
      if (a.dataset.act === "close") closeSheet()
      if (a.dataset.act === "play" && S.sheet) {
        S.sheet.play = true
        drawSheet()
      }
      if (a.dataset.act === "cap") {
        const c = sh.querySelector(".cap")
        const open = c.classList.toggle("open")
        a.textContent = open ? "Daha az göster" : "Devamını göster"
      }
    })
  }
  function drawSheet() {
    const s = S.sheet
    if (!s || !sh) return
    const j = s.job ? { ...s.base, ...s.job, stage: s.job.error_stage || s.base.stage } : s.base
    const status = j.status || "published"
    const at = ts(j.at)
    const link = safe(j.permalink)
    const facts = [
      ["calendar-clock", "Planlanan saat", `<span>${esc(when(at))}</span>${UPCOMING.includes(status) ? cdSpan(at) : ""}`],
      j.published_at ? ["circle-check", "Yayınlandı", `<span>${esc(when(ts(j.published_at)))}</span>`] : null,
      j.size ? ["hard-drive", "Video boyutu", `<span>${esc(bytes(j.size))}</span>`] : null,
      s.job && s.job.created ? ["cloud-upload", "Buluta eklendi", `<span>${esc(when(ts(s.job.created)))}</span>`] : null,
    ].filter(Boolean)
    const log = s.job && s.job.log ? s.job.log.slice().reverse() : []
    const cap = s.job && s.job.caption ? s.job.caption : ""
    const media = s.play && s.video ? `<video src="${esc(s.video)}" controls playsinline autoplay preload="metadata"></video>` : th(j, "mth")
    sh.innerHTML = `<div class="grab"></div>
      <div class="shd">${tag(status)}<button class="ib sm" data-act="close" aria-label="Kapat">${ic("x", 18)}</button></div>
      <div class="stop${s.play && s.video ? " play" : ""}">
        <div class="media">${media}</div>
        <div class="sinfo"><h2>${esc(title(j))}</h2><div class="facts">${facts.map(([i, k, v]) => `<div><span class="k">${ic(i, 12)}${k}</span><span class="v">${v}</span></div>`).join("")}</div>
          <div class="sacts">${s.video && !s.play ? `<button class="btn primary" data-act="play">${ic("play", 15)}Videoyu izle</button>` : ""}${link ? `<a class="btn ig" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${ic("instagram", 15)}Instagram'da aç</a>` : ""}</div>
        </div>
      </div>
      <div class="ssec st-${esc(status)}"><h4>Durum</h4>${pipe({ ...j, status })}</div>
      ${status === "error" && j.error ? `<div class="jerr">${ic("triangle-alert", 14)}<span>${esc(j.error)}</span></div>` : ""}
      ${s.loading ? `<div class="sk"></div>` : ""}
      ${cap ? `<div class="ssec"><h4>Açıklama</h4><p class="cap">${esc(cap)}</p>${cap.length > 160 || cap.split("\n").length > 4 ? `<button class="more" data-act="cap">Devamını göster</button>` : ""}</div>` : ""}
      ${log.length ? `<div class="ssec"><h4>Bulut kaydı</h4><ol class="log">${log.map(l => `<li><span>${esc(when(ts(l.at)))}</span><p>${esc(l.text)}</p></li>`).join("")}</ol></div>` : ""}
      ${!s.loading && !s.job ? `<div class="note">${ic("info", 13)}<span>${s.failed ? "Ayrıntılar şu an alınamadı." : "Bu paylaşımın bulut kaydı stüdyoya aktarıldı; burada özet bilgisi kalır."}</span></div>` : ""}`
    const v = sh.querySelector("video")
    if (v) {
      v.addEventListener("error", () => {
        const n = document.createElement("div")
        n.className = "note"
        n.innerHTML = `${ic("triangle-alert", 13)}<span>Video bu tarayıcıda oynatılamadı.</span>`
        v.after(n)
      }, { once: true })
    }
  }
  async function openSheet(pid, trusted) {
    const d = S.d
    if (!d) return
    const live = (d.jobs || []).find(j => j.pid === pid)
    const b = live || recentList(d).find(r => r.pid === pid)
    if (!b) return
    ensureSheet()
    const wasOpen = !!S.sheet
    S.sheet = { pid, base: b, job: null, video: null, loading: !!live, play: false, failed: false }
    drawSheet()
    sh.scrollTop = 0
    if (!wasOpen) {
      if (trusted) {
        history.pushState({ sheet: pid }, "")
        S.pushed = true
      }
      document.body.classList.add("lock")
      void sh.offsetHeight
      sbg.classList.add("on")
      sh.classList.add("on")
    }
    if (!live) return
    let x = null
    try {
      const r = await fetch(`${base}/job/${encodeURIComponent(pid)}`, { cache: "no-store", credentials: "same-origin" })
      if (r.status === 401) return showLogin("Oturum sona erdi, yeniden giriş yap.", "info")
      x = await r.json()
    } catch {}
    if (!S.sheet || S.sheet.pid !== pid) return
    S.sheet.loading = false
    if (x && x.ok) {
      S.sheet.job = x.job
      S.sheet.video = x.video
    } else if (!x) S.sheet.failed = true
    drawSheet()
  }
  function closeSheet(silent) {
    if (!S.sheet) return
    S.sheet = null
    const v = sh && sh.querySelector("video")
    if (v) v.pause()
    sbg.classList.remove("on")
    sh.classList.remove("on")
    document.body.classList.remove("lock")
    setTimeout(() => {
      if (!S.sheet && sh) sh.innerHTML = ""
    }, 380)
    if (S.pushed && !silent) {
      S.pushed = false
      history.back()
    }
  }

  function tick() {
    const n = now()
    for (const el of document.querySelectorAll("[data-cd]")) {
      const t = Number(el.dataset.cd)
      const txt = rel(t, true)
      if (el.textContent !== txt) el.textContent = txt
      el.classList.toggle("due", t - n <= 0)
      if (t - n <= 0 && t - n > -1500 && !S.due) S.due = setTimeout(() => {
        S.due = 0
        load()
      }, 70000)
    }
    for (const el of document.querySelectorAll("[data-clock]")) {
      const h = clockHtml(Number(el.dataset.clock) - n)
      if (el._h !== h) {
        el._h = h
        el.innerHTML = h
      }
    }
    if (++S.ticks % 10 === 0) for (const el of document.querySelectorAll("[data-ago]")) el.textContent = rel(Number(el.dataset.ago))
  }

  document.addEventListener("load", e => {
    const t = e.target
    if (t.tagName === "IMG") {
      t.classList.add("in")
      S.seen.add(t.getAttribute("src"))
    }
  }, true)
  document.addEventListener("error", e => {
    const t = e.target
    if (t.tagName === "IMG") t.remove()
  }, true)
  root.addEventListener("click", async e => {
    const a = e.target.closest("[data-act]")
    if (a) {
      const act = a.dataset.act
      if (act === "refresh") load()
      if (act === "theme") toggleThemePop()
      if (act === "tab" && TABS.some(t => t[0] === a.dataset.tab)) {
        S.tab = a.dataset.tab
        try {
          localStorage.setItem("sosyal-tab", S.tab)
        } catch {}
        render()
        window.scrollTo({ top: 0, behavior: "auto" })
      }
      if (act === "all") {
        S.all = !S.all
        render()
      }
      if (act === "logout") {
        try {
          await fetch(base + "/logout", { method: "POST", credentials: "same-origin" })
        } catch {}
        S.d = null
        showLogin("Çıkış yapıldı.", "info")
      }
      return
    }
    const link = e.target.closest("a")
    if (link) {
      const h = link.getAttribute("href") || ""
      if (h[0] === "#") {
        e.preventDefault()
        const t = document.getElementById(h.slice(1))
        if (t) t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
      }
      return
    }
    const o = e.target.closest("[data-open]")
    if (o) openSheet(o.dataset.open, e.isTrusted)
  })
  root.addEventListener("pointermove", sparkHover)
  root.addEventListener("pointerdown", sparkHover)
  root.addEventListener("pointerout", e => {
    const s = e.target.closest && e.target.closest(".spk")
    if (s && !s.contains(e.relatedTarget)) s.classList.remove("hov")
  })
  try {
    const t = localStorage.getItem("sosyal-tab")
    if (TABS.some(x => x[0] === t)) S.tab = t
  } catch {}
  root.addEventListener("keydown", e => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-open]")) {
      e.preventDefault()
      openSheet(e.target.dataset.open, e.isTrusted)
    }
  })
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && S.sheet) closeSheet()
  })
  window.addEventListener("popstate", () => {
    S.pushed = false
    if (S.sheet) closeSheet(true)
  })
  if (history.state && history.state.sheet) history.replaceState(null, "")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !S.login && S.d && Date.now() - S.last >= 60000) load()
  })
  setInterval(() => {
    if (document.visibilityState === "visible" && !S.login && S.d && Date.now() - S.last >= 60000) load()
  }, 5000)
  setInterval(() => {
    if (document.visibilityState === "visible" && !S.login) tick()
  }, 1000)
  load()
}

let PAGE = null
function panelPage(token) {
  if (!PAGE) {
    const logo = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PANEL_ICONS.cloud}</svg>`
    const icons = JSON.stringify(PANEL_ICONS).replace(/</g, "\\u003c")
    PAGE = [`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Bulut · Sosyal Stüdyo</title><meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="dark light"><meta name="theme-color" content="#141519" media="(prefers-color-scheme: dark)"><meta name="theme-color" content="#f3f4f7" media="(prefers-color-scheme: light)"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Sosyal Stüdyo"><meta name="application-name" content="Sosyal Stüdyo">`,
      `<script>try{var t=JSON.parse(localStorage.getItem("sosyal-theme")||"{}")||{},h=document.documentElement;h.dataset.theme=t.theme||"gunbatimi";if(h.dataset.theme!=="klasik")h.classList.add("fx");if(t.motion===false)h.classList.add("still")}catch(e){document.documentElement.dataset.theme="gunbatimi";document.documentElement.classList.add("fx")}</script><style>${PANEL_CSS}</style></head><body><div id="root"><div class="boot"><span class="logo">${logo}</span></div></div><script>(${panelApp.toString()})(${icons})</script></body></html>`]
  }
  const base = `/p/${token}`
  return `${PAGE[0]}<link rel="manifest" href="${base}/manifest.webmanifest"><link rel="icon" type="image/png" sizes="192x192" href="${base}/icon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="${base}/apple-touch-icon.png">${PAGE[1]}`
}

function panelManifest(token) {
  const base = `/p/${token}`
  return JSON.stringify({
    id: base, name: "Sosyal Stüdyo · Bulut", short_name: "Sosyal Stüdyo", lang: "tr", start_url: base, scope: base, display: "standalone",
    background_color: "#141519", theme_color: "#141519",
    icons: [
      { src: `${base}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  })
}

let ICON_BYTES = null
function iconResponse(name, method) {
  ICON_BYTES ||= {}
  const bytes = (ICON_BYTES[name] ||= Uint8Array.from(atob(ICON_PNG[name]), c => c.charCodeAt(0)))
  return new Response(method === "HEAD" ? null : bytes, {
    headers: { "content-type": "image/png", "cache-control": ASSET_CACHE, "x-content-type-options": "nosniff" },
  })
}

function siteConfig(b) {
  const text = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max + 1)
  const owner = text(b.owner_name, 100)
  const email = text(b.email, 254)
  const app = text(b.app_name, 60) || "Sosyal Stüdyo"
  if (owner.length < 2) return { error: "ad soyad gerekli" }
  if (owner.length > 100) return { error: "ad soyad çok uzun" }
  if (email.length > 254 || !EMAIL_RE.test(email)) return { error: "geçersiz e-posta" }
  if (app.length > 60) return { error: "uygulama adı çok uzun" }
  const links = {}
  for (const k of ["channel_url", "instagram_url"]) {
    const u = text(b[k], 300)
    if (u && (u.length > 300 || !/^https:\/\/[^\s<>"'`]+$/.test(u))) return { error: "geçersiz kanal adresi" }
    links[k] = u
  }
  const at = Date.parse(b.updated)
  return { site: { owner_name: owner, email, app_name: app, ...links, lang_default: b.lang_default === "tr" ? "tr" : "en",
    updated: iso(Number.isNaN(at) ? Date.now() : at) } }
}

const SITE_LINKS = {
  ytTerms: "https://www.youtube.com/t/terms", gPrivacy: "http://www.google.com/policies/privacy",
  revoke: "https://security.google.com/settings/security/permissions",
  guidelines: "https://www.youtube.com/howyoutubeworks/policies/community-guidelines/",
}
const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  tr: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const longDate = (t, lang) => {
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
const YT_MARK = `<span class="ytmark"><svg width="32" height="22" viewBox="0 0 32 22" aria-hidden="true"><rect width="32" height="22" rx="6.5" fill="#FF0000"/><path d="M13 6.5v9l7.8-4.5z" fill="#fff"/></svg>YouTube</span>`

const SITE_TEXT = {
  en: {
    nav: { home: "Home", privacy: "Privacy Policy", terms: "Terms of Service" }, lang: "Türkçe", updated: "Last updated",
    contents: "Contents", usesYt: "Uses YouTube API Services", ytTerms: "YouTube Terms of Service", gPrivacy: "Google Privacy Policy",
    footer: v => `Open-source software; this instance is operated by ${v.owner}.`,
    home: v => `<h1>${v.app}</h1>
<p class="lead">A self-hosted desktop tool for preparing short videos and publishing them at planned times.</p>
<p>${v.app} is a desktop application that ${v.owner} runs on their own computer to prepare their own short videos and publish them to their own social media channels at planned times. It is not a public service: there is no sign-up, and nobody else can sign in to or use this instance.</p>
${v.ytBox(`<b>Uses YouTube API Services</b><p>With the operator's permission (Google sign-in with OAuth 2.0), ${v.app} uses the YouTube Data API to upload the operator's videos to the operator's own YouTube channel, set their title, description and publish time, and check their status. These features are subject to the ${v.ytTermsN} and the ${v.gPrivacyN}.</p>`)}
<h2>What it does</h2>
<ul>
<li>Keeps projects, videos and settings on the operator's own computer.</li>
<li>Publishes finished posts and videos to the operator's own YouTube channel and Instagram account at the times the operator chooses.</li>
<li>Can use the operator's own Cloudflare account to publish scheduled Instagram posts while the computer is off; those cloud copies are deleted once published.</li>
<li>Does not collect data from viewers or other people, shows no ads, and never sells or shares data.</li>
</ul>
${v.channels ? `<h2>Channels</h2><p>Channels managed with this tool: ${v.channels}</p>` : ""}
<h2>Privacy and terms</h2>
<p>How this instance handles information, and the conditions for using it:</p>
<p class="legal"><a class="btn" href="${v.privacyHref}">Privacy Policy</a><a class="btn" href="${v.termsHref}">Terms of Service</a></p>
<h2>Contact</h2>
<p>${v.owner} · ${v.email}</p>`,
    privacy: v => [
      ["overview", "Overview", `<p>This Privacy Policy explains how ${v.app} (“the app”) handles information. This instance of the app is installed and operated by ${v.owner} (“the operator”), who uses it to prepare their own videos and publish them to their own social media accounts. The app is open-source software that runs on the operator's own computer; some parts can optionally run in the operator's own Cloudflare account. It is not a public service: it has no sign-up and no other users, and it is not directed to children.</p>`],
      ["youtube", "YouTube API Services", `<p>The app uses YouTube API Services to upload and manage videos on the operator's own YouTube channel. By using the app's YouTube features, you agree to be bound by the YouTube Terms of Service: ${v.ytTerms}. How Google handles data is described in the Google Privacy Policy: ${v.gPrivacy}.</p>`],
      ["data", "Information the app accesses", `<p>When the operator connects a YouTube channel through Google sign-in (OAuth 2.0), the app accesses only the following Google and YouTube data:</p>
<ul>
<li><b>Channel information</b>: the connected channel's ID, title, handle and thumbnail image (YouTube Data API <code>channels.list</code>), so the app can show which channel is connected.</li>
<li><b>The operator's own videos</b>: the app uploads videos the operator has prepared (<code>videos.insert</code>); changes the title, description, privacy status and scheduled publish time of videos it uploaded (<code>videos.update</code>); deletes a video it uploaded when the operator cancels that post (<code>videos.delete</code>); and reads the upload, processing and privacy status of those videos (<code>videos.list</code>).</li>
<li><b>Access and refresh tokens</b> issued by Google, which let the app make the requests above for the operator.</li>
</ul>
<p>The app does not access comments, messages, subscribers, analytics, watch history, or any information about viewers or other YouTube users.</p>`],
      ["use", "How information is used", `<p>This information is used only to provide the app's features to the operator: publishing the operator's own videos at the planned times and showing whether each upload and publication succeeded. It is not used for advertising or profiling, it is not sold, and it is not shared with anyone other than the platform it is meant for (for example, a video is sent only to YouTube).</p>`],
      ["storage", "Where information is stored", `<ul>
<li><b>On the operator's computer</b>: projects, videos, settings, the connected channel's information and the Google tokens are kept in the app's local data folder. Google tokens are sent only to Google.</li>
<li><b>In the operator's own Cloudflare account</b> (optional cloud publishing): videos scheduled for Instagram, their captions and the Instagram access token are stored temporarily so they can be published while the computer is off. These pages are served from the same account.</li>
</ul>
<p>Information travels only over encrypted (HTTPS) connections to the services involved. It is not stored on servers belonging to anyone else, and it is never sold or shared with third parties.</p>`],
      ["other", "Other connected services", `<p>The operator may connect other services. Each is used only for the operator's own content and is governed by that provider's own terms and privacy policy:</p>
<ul>
<li><b>Instagram (Meta)</b>: to publish the operator's posts to the operator's own Instagram account and to show that account's posts, comments, messages and statistics inside the app.</li>
<li><b>Cloudflare</b>: to host these pages and, optionally, to publish scheduled posts while the operator's computer is off.</li>
<li><b>Content tools chosen by the operator</b> (for example, text-to-speech): they receive only what a task needs, such as a narration script.</li>
</ul>`],
      ["retention", "Retention and deletion", `<ul>
<li>Local data stays on the operator's computer until the operator deletes it.</li>
<li>When the YouTube connection is removed in the app, the stored Google tokens and channel information are deleted from the app immediately.</li>
<li>Videos stored in the operator's Cloudflare account are deleted automatically once they are published, or when the post is cancelled.</li>
<li>Videos already published on YouTube or Instagram stay there until the operator deletes them on that platform.</li>
</ul>
<p>To ask for deletion of any information the app may hold about you, email ${v.email}. Requests are handled promptly, and within 30 days at the latest.</p>`],
      ["revoke", "Revoking access", `<p>Access to a Google account can be revoked at any time on the Google security settings page: ${v.revoke}. After that, the app can no longer access the YouTube channel. The connection can also be removed from within the app.</p>`],
      ["cookies", "Cookies", `<p>These pages do not use cookies, analytics, advertising or any kind of tracking. The only cookie the app's cloud service sets is a strictly necessary sign-in cookie for the operator's private, password-protected status page; it is never used for tracking.</p>`],
      ["security", "Security", `<p>Tokens and keys are kept only on the operator's computer and in the operator's own Cloudflare account. The cloud service accepts commands only with a secret key held by the operator's computer, and the private status page is protected by a password.</p>`],
      ["changes", "Changes to this policy", `<p>If this policy changes, the new version will be published on this page and the “Last updated” date at the top will change.</p>`],
      ["contact", "Contact", `<p>${v.owner} · ${v.email}</p>`],
    ],
    terms: v => [
      ["agreement", "Agreement", `<p>These Terms of Service apply to this instance of ${v.app} and its website, operated by ${v.owner} (“the operator”). ${v.app} is a personal tool the operator uses to publish their own content; it is not offered as a public service and has no account registration. By using this instance or its website, you agree to these terms.</p>`],
      ["youtube", "YouTube Terms of Service", `<p>The app uses YouTube API Services. Anyone using the app's YouTube features agrees to be bound by the YouTube Terms of Service: ${v.ytTerms}. The Google Privacy Policy (${v.gPrivacy}) and this instance's ${v.privacyN} also apply. Content uploaded to YouTube must follow YouTube's Community Guidelines: ${v.guidelines}.</p>`],
      ["platforms", "Other platforms", `<p>When the app publishes to Instagram or another platform, that platform's terms and policies apply as well, for example Instagram's Terms of Use and Community Guidelines.</p>`],
      ["use", "Acceptable use", `<p>The app may only be used to publish content that the operator owns or has the right to publish, in line with applicable law and the rules of each platform. The operator is solely responsible for the content published with it.</p>`],
      ["license", "Open-source software", `<p>${v.app} is open-source software, available under the licence included with its source code. This instance is installed and run by the operator, independently of the software's authors.</p>`],
      ["warranty", "No warranty", `<p>The app and this website are provided “as is” and “as available”, without warranties of any kind, express or implied. To the extent permitted by law, the operator is not liable for indirect or consequential damages, loss of data, or interruptions arising from their use.</p>`],
      ["changes", "Changes to these terms", `<p>These terms may be updated from time to time. The current version is always published on this page with its “Last updated” date.</p>`],
      ["contact", "Contact", `<p>${v.owner} · ${v.email}</p>`],
    ],
  },
  tr: {
    nav: { home: "Ana sayfa", privacy: "Gizlilik Politikası", terms: "Kullanım Şartları" }, lang: "English", updated: "Son güncelleme",
    contents: "İçindekiler", usesYt: "YouTube API Hizmetlerini kullanır", ytTerms: "YouTube Hizmet Şartları", gPrivacy: "Google Gizlilik Politikası",
    footer: v => `Açık kaynaklı yazılım; bu kurulum ${v.owner} tarafından işletilmektedir.`,
    home: v => `<h1>${v.app}</h1>
<p class="lead">Kısa videolar hazırlayıp planlanan saatlerde yayınlamak için kişinin kendi bilgisayarında çalıştırdığı bir masaüstü aracı.</p>
<p>${v.app}, ${v.owner} tarafından kendi bilgisayarında çalıştırılan bir masaüstü uygulamasıdır; kendi kısa videolarını hazırlamak ve bunları kendi sosyal medya kanallarında planlanan saatlerde yayınlamak için kullanılır. Herkese açık bir hizmet değildir: üyelik yoktur ve bu kuruluma başka hiç kimse giriş yapamaz, onu kullanamaz.</p>
${v.ytBox(`<b>YouTube API Hizmetlerini kullanır</b><p>${v.app}, işletmecinin izniyle (OAuth 2.0 ile Google girişi) YouTube Data API'yi kullanarak işletmecinin videolarını kendi YouTube kanalına yükler, başlık, açıklama ve yayın saatlerini ayarlar ve durumlarını denetler. Bu özellikler için ${v.ytTermsN} ve ${v.gPrivacyN} geçerlidir.</p>`)}
<h2>Ne yapar</h2>
<ul>
<li>Projeleri, videoları ve ayarları işletmecinin kendi bilgisayarında tutar.</li>
<li>Hazır gönderileri ve videoları, işletmecinin seçtiği saatlerde kendi YouTube kanalında ve Instagram hesabında yayınlar.</li>
<li>Bilgisayar kapalıyken planlı Instagram gönderilerini yayınlamak için işletmecinin kendi Cloudflare hesabını kullanabilir; buluttaki kopyalar yayınlandıktan sonra silinir.</li>
<li>İzleyicilerden ya da başka kişilerden veri toplamaz, reklam göstermez, verileri asla satmaz ya da paylaşmaz.</li>
</ul>
${v.channels ? `<h2>Kanallar</h2><p>Bu araçla yönetilen kanallar: ${v.channels}</p>` : ""}
<h2>Gizlilik ve şartlar</h2>
<p>Bu kurulumun bilgileri nasıl işlediği ve kullanım koşulları:</p>
<p class="legal"><a class="btn" href="${v.privacyHref}">Gizlilik Politikası</a><a class="btn" href="${v.termsHref}">Kullanım Şartları</a></p>
<h2>İletişim</h2>
<p>${v.owner} · ${v.email}</p>`,
    privacy: v => [
      ["overview", "Genel bakış", `<p>Bu Gizlilik Politikası, ${v.app} uygulamasının (“uygulama”) bilgileri nasıl işlediğini açıklar. Uygulamanın bu kurulumu ${v.owner} (“işletmeci”) tarafından kurulmuş ve işletilmektedir; işletmeci onu kendi videolarını hazırlamak ve kendi sosyal medya hesaplarında yayınlamak için kullanır. Uygulama, işletmecinin kendi bilgisayarında çalışan açık kaynaklı bir yazılımdır; bazı bölümleri isteğe bağlı olarak işletmecinin kendi Cloudflare hesabında çalışabilir. Herkese açık bir hizmet değildir: üyelik ve başka kullanıcı yoktur, çocuklara yönelik değildir.</p>`],
      ["youtube", "YouTube API Hizmetleri", `<p>Uygulama, işletmecinin kendi YouTube kanalındaki videoları yüklemek ve yönetmek için YouTube API Hizmetlerini kullanır. Uygulamanın YouTube özelliklerini kullanarak YouTube Hizmet Şartları'nı kabul etmiş olursunuz: ${v.ytTerms}. Google'ın verileri nasıl işlediği Google Gizlilik Politikası'nda anlatılır: ${v.gPrivacy}.</p>`],
      ["data", "Uygulamanın eriştiği bilgiler", `<p>İşletmeci bir YouTube kanalını Google girişiyle (OAuth 2.0) bağladığında uygulama yalnızca şu Google ve YouTube verilerine erişir:</p>
<ul>
<li><b>Kanal bilgileri</b>: bağlı kanalın kimliği, adı, kullanıcı adı ve küçük resmi (YouTube Data API <code>channels.list</code>); uygulama bunları hangi kanalın bağlı olduğunu göstermek için kullanır.</li>
<li><b>İşletmecinin kendi videoları</b>: uygulama işletmecinin hazırladığı videoları yükler (<code>videos.insert</code>); yüklediği videoların başlığını, açıklamasını, gizlilik durumunu ve planlı yayın saatini değiştirir (<code>videos.update</code>); işletmeci bir gönderiyi iptal ettiğinde yüklediği videoyu siler (<code>videos.delete</code>); bu videoların yükleme, işlenme ve gizlilik durumunu okur (<code>videos.list</code>).</li>
<li><b>Erişim ve yenileme anahtarları</b>: Google'ın verdiği ve uygulamanın yukarıdaki istekleri işletmeci adına yapmasını sağlayan anahtarlar.</li>
</ul>
<p>Uygulama yorumlara, mesajlara, abonelere, analizlere, izleme geçmişine ya da izleyiciler veya diğer YouTube kullanıcıları hakkındaki hiçbir bilgiye erişmez.</p>`],
      ["use", "Bilgilerin kullanımı", `<p>Bu bilgiler yalnızca uygulamanın özelliklerini işletmeciye sunmak için kullanılır: işletmecinin kendi videolarını planlanan saatlerde yayınlamak ve her yüklemenin ve yayının başarılı olup olmadığını göstermek. Reklam ya da profilleme için kullanılmaz, satılmaz ve gönderildiği platform dışında kimseyle paylaşılmaz (örneğin bir video yalnızca YouTube'a gönderilir).</p>`],
      ["storage", "Bilgilerin saklandığı yer", `<ul>
<li><b>İşletmecinin bilgisayarında</b>: projeler, videolar, ayarlar, bağlı kanalın bilgileri ve Google anahtarları uygulamanın yerel veri klasöründe tutulur. Google anahtarları yalnızca Google'a gönderilir.</li>
<li><b>İşletmecinin kendi Cloudflare hesabında</b> (isteğe bağlı bulut yayını): Instagram için planlanan videolar, açıklamaları ve Instagram erişim anahtarı, bilgisayar kapalıyken de yayınlanabilmeleri için geçici olarak saklanır. Bu sayfalar da aynı hesaptan sunulur.</li>
</ul>
<p>Bilgiler ilgili hizmetlere yalnızca şifreli (HTTPS) bağlantılarla iletilir. Başka birine ait sunucularda saklanmaz, hiçbir zaman satılmaz ve üçüncü kişilerle paylaşılmaz.</p>`],
      ["other", "Bağlanan diğer hizmetler", `<p>İşletmeci başka hizmetler de bağlayabilir. Her biri yalnızca işletmecinin kendi içeriği için kullanılır ve o hizmetin kendi şartlarına ve gizlilik politikasına tabidir:</p>
<ul>
<li><b>Instagram (Meta)</b>: işletmecinin gönderilerini kendi Instagram hesabında yayınlamak ve bu hesabın gönderilerini, yorumlarını, mesajlarını ve istatistiklerini uygulama içinde göstermek için.</li>
<li><b>Cloudflare</b>: bu sayfaları barındırmak ve isteğe bağlı olarak, işletmecinin bilgisayarı kapalıyken planlı gönderileri yayınlamak için.</li>
<li><b>İşletmecinin seçtiği içerik araçları</b> (örneğin seslendirme): yalnızca işin gerektirdiği bilgiyi, örneğin bir seslendirme metnini alır.</li>
</ul>`],
      ["retention", "Saklama süresi ve silme", `<ul>
<li>Yerel veriler, işletmeci silene kadar işletmecinin bilgisayarında kalır.</li>
<li>Uygulamada YouTube bağlantısı kaldırıldığında kayıtlı Google anahtarları ve kanal bilgileri uygulamadan hemen silinir.</li>
<li>İşletmecinin Cloudflare hesabında saklanan videolar, yayınlandıktan sonra ya da gönderi iptal edildiğinde otomatik olarak silinir.</li>
<li>YouTube'da ya da Instagram'da yayınlanmış videolar, işletmeci o platformda silene kadar orada kalır.</li>
</ul>
<p>Uygulamanın sizinle ilgili tutabileceği herhangi bir bilginin silinmesini istemek için ${v.email} adresine e-posta gönderin. Talepler hızla, en geç 30 gün içinde yerine getirilir.</p>`],
      ["revoke", "Erişimi geri alma", `<p>Bir Google hesabına verilen erişim, Google güvenlik ayarları sayfasından istenildiği an geri alınabilir: ${v.revoke}. Bundan sonra uygulama YouTube kanalına erişemez. Bağlantı uygulamanın içinden de kaldırılabilir.</p>`],
      ["cookies", "Çerezler", `<p>Bu sayfalar çerez, analiz, reklam ya da herhangi bir izleme aracı kullanmaz. Uygulamanın bulut hizmetinin kullandığı tek çerez, işletmecinin şifreyle korunan özel durum sayfası için zorunlu oturum çerezidir; hiçbir zaman izleme amacıyla kullanılmaz.</p>`],
      ["security", "Güvenlik", `<p>Anahtarlar yalnızca işletmecinin bilgisayarında ve işletmecinin kendi Cloudflare hesabında tutulur. Bulut hizmeti yalnızca işletmecinin bilgisayarındaki gizli anahtarla gelen komutları kabul eder; özel durum sayfası şifreyle korunur.</p>`],
      ["changes", "Bu politikadaki değişiklikler", `<p>Bu politika değişirse yeni sürüm bu sayfada yayınlanır ve en üstteki “Son güncelleme” tarihi değişir.</p>`],
      ["contact", "İletişim", `<p>${v.owner} · ${v.email}</p>`],
    ],
    terms: v => [
      ["agreement", "Sözleşme", `<p>Bu Kullanım Şartları, ${v.owner} (“işletmeci”) tarafından işletilen ${v.app} kurulumu ve web sitesi için geçerlidir. ${v.app}, işletmecinin kendi içeriğini yayınlamak için kullandığı kişisel bir araçtır; herkese açık bir hizmet olarak sunulmaz ve hesap açma yoktur. Bu kurulumu ya da web sitesini kullanarak bu şartları kabul etmiş olursunuz.</p>`],
      ["youtube", "YouTube Hizmet Şartları", `<p>Uygulama YouTube API Hizmetlerini kullanır. Uygulamanın YouTube özelliklerini kullanan herkes YouTube Hizmet Şartları'nı kabul etmiş olur: ${v.ytTerms}. Google Gizlilik Politikası (${v.gPrivacy}) ve bu kurulumun ${v.privacyN} da geçerlidir. YouTube'a yüklenen içerik YouTube Topluluk Kuralları'na uymalıdır: ${v.guidelines}.</p>`],
      ["platforms", "Diğer platformlar", `<p>Uygulama Instagram'da ya da başka bir platformda yayın yaptığında o platformun şartları ve kuralları da geçerlidir; örneğin Instagram Kullanım Koşulları ve Topluluk Kuralları.</p>`],
      ["use", "Kabul edilebilir kullanım", `<p>Uygulama yalnızca işletmecinin sahibi olduğu ya da yayınlama hakkına sahip olduğu içerikleri, yürürlükteki yasalara ve her platformun kurallarına uygun şekilde yayınlamak için kullanılabilir. Yayınlanan içerikten yalnızca işletmeci sorumludur.</p>`],
      ["license", "Açık kaynaklı yazılım", `<p>${v.app}, kaynak koduyla birlikte sunulan lisans kapsamında kullanılabilen açık kaynaklı bir yazılımdır. Bu kurulum, yazılımın geliştiricilerinden bağımsız olarak işletmeci tarafından kurulmuş ve çalıştırılmaktadır.</p>`],
      ["warranty", "Garanti yoktur", `<p>Uygulama ve bu web sitesi, açık ya da örtülü hiçbir garanti olmaksızın “olduğu gibi” ve “erişilebildiği kadarıyla” sunulur. Yasaların izin verdiği ölçüde işletmeci, kullanımlarından doğan dolaylı zararlardan, veri kaybından ya da kesintilerden sorumlu değildir.</p>`],
      ["changes", "Şartlardaki değişiklikler", `<p>Bu şartlar zaman zaman güncellenebilir. Güncel sürüm her zaman bu sayfada “Son güncelleme” tarihiyle yayınlanır.</p>`],
      ["contact", "İletişim", `<p>${v.owner} · ${v.email}</p>`],
    ],
  },
}

const SITE_CSS = `
:root{--bg:#f5f6f8;--card:#fff;--text:#1b1f27;--soft:#434a55;--muted:#6b7280;--line:#e2e5ea;--tint:#f7f8fa;--link:#0b57d0;color-scheme:light}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 "Segoe UI",system-ui,-apple-system,"Helvetica Neue",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link);text-underline-offset:2px;overflow-wrap:anywhere}
a:hover{text-decoration-thickness:2px}
.wrap{max-width:860px;margin:0 auto;padding:26px 20px 36px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px 20px;flex-wrap:wrap;margin-bottom:20px}
.brand{display:flex;align-items:center;gap:11px;font-weight:700;font-size:18px;color:var(--text);text-decoration:none}
.brand img{width:36px;height:36px;border-radius:9px}
.links{display:flex;gap:4px;flex-wrap:wrap}
.links a{padding:6px 11px;border-radius:8px;color:var(--soft);text-decoration:none;font-size:14.5px}
.links a:hover{background:#eceef2}
.links a[aria-current]{background:#e6e9ee;color:var(--text);font-weight:600}
.links a.lang{border:1px solid var(--line);margin-left:6px}
main{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:44px 56px 40px;box-shadow:0 1px 2px rgba(16,24,40,.04),0 14px 34px -20px rgba(16,24,40,.2)}
h1{font-size:34px;line-height:1.2;margin:0 0 8px;letter-spacing:-.015em}
h2{font-size:20px;line-height:1.35;margin:32px 0 10px;padding-top:24px;border-top:1px solid var(--line)}
p{margin:0 0 14px}
ul{margin:0 0 14px;padding-left:22px}
li{margin:7px 0}
code{font:.9em/1.4 Consolas,"SFMono-Regular",Menlo,monospace;background:#eef0f3;border-radius:4px;padding:1px 4px}
.lead{font-size:19px;line-height:1.55;color:var(--soft);margin:0 0 20px}
.meta{color:var(--muted);font-size:14.5px;margin:0 0 26px}
.yt{display:flex;gap:18px;align-items:flex-start;padding:18px 22px;border:1px solid var(--line);border-radius:12px;background:var(--tint);margin:24px 0 8px}
.yt b{display:block;font-size:16.5px;margin-bottom:4px}
.yt p{margin:0;font-size:15px;color:var(--soft)}
.ytmark{display:inline-flex;align-items:center;gap:5px;flex:none;margin-top:2px;font:700 20px/1 Arial,Helvetica,sans-serif;letter-spacing:-.05em;color:#0f0f0f}
.toc{background:var(--tint);border:1px solid var(--line);border-radius:12px;padding:14px 22px 10px;margin:0 0 6px}
.toc b{font-size:12.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.toc ol{margin:8px 0 4px;padding-left:22px;columns:2;column-gap:32px;font-size:15px}
.toc li{margin:0;padding:2px 0;break-inside:avoid}
.toc a{text-decoration:none}
.legal{display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-flex;align-items:center;padding:10px 18px;border-radius:10px;border:1px solid #cfd4db;background:#fff;color:var(--text);font-weight:600;text-decoration:none}
.btn:hover{border-color:#9aa3af;background:var(--tint)}
footer{color:var(--muted);font-size:13.5px;text-align:center;margin-top:22px;line-height:1.6}
footer p{margin:0 0 6px}
footer a{color:var(--muted)}
@media (max-width:640px){.wrap{padding:16px 12px 28px}main{padding:26px 20px 24px;border-radius:12px}h1{font-size:28px}.lead{font-size:17.5px}.toc ol{columns:1}.yt{flex-direction:column;gap:10px}}
`

function sitePage(cfg, lang, page) {
  const T = SITE_TEXT[lang]
  const other = lang === "tr" ? "en" : "tr"
  const path = p => (lang === "tr" ? (p === "home" ? "/tr" : `/tr/${p}`) : (p === "home" ? "/" : `/${p}`))
  const alt = p => (other === "tr" ? (p === "home" ? "/tr" : `/tr/${p}`) : (p === "home" ? "/" : `/${p}`))
  const link = (url, text) => `<a href="${esc(url)}">${esc(text || url)}</a>`
  const app = esc(cfg.app_name || "Sosyal Stüdyo")
  const v = {
    app, owner: esc(cfg.owner_name), email: `<a href="mailto:${esc(cfg.email)}">${esc(cfg.email)}</a>`,
    ytTerms: link(SITE_LINKS.ytTerms), gPrivacy: link(SITE_LINKS.gPrivacy), revoke: link(SITE_LINKS.revoke), guidelines: link(SITE_LINKS.guidelines),
    ytTermsN: link(SITE_LINKS.ytTerms, T.ytTerms), gPrivacyN: link(SITE_LINKS.gPrivacy, T.gPrivacy),
    privacyN: `<a href="${path("privacy")}">${T.nav.privacy}</a>`, privacyHref: path("privacy"), termsHref: path("terms"),
    channels: [[cfg.channel_url, "YouTube"], [cfg.instagram_url, "Instagram"]].filter(x => x[0]).map(([u, t]) => link(u, t)).join(" · "),
    ytBox: inner => `<div class="yt">${YT_MARK}<div>${inner}</div></div>`,
  }
  let title = app
  let body = T.home(v)
  if (page !== "home") {
    const secs = T[page](v)
    const stamp = Math.max(Date.parse(POLICY_DATE), Date.parse(cfg.updated) || 0)
    title = `${T.nav[page]} · ${app}`
    body = `<h1>${T.nav[page]}</h1><p class="meta">${T.updated}: ${longDate(stamp, lang)}</p>
<div class="toc"><b>${T.contents}</b><ol>${secs.map(([id, h]) => `<li><a href="#${id}">${h}</a></li>`).join("")}</ol></div>
${secs.map(([id, h, html], i) => `<section id="${id}"><h2>${i + 1}. ${h}</h2>\n${html}</section>`).join("\n")}`
  }
  const nav = ["privacy", "terms"].map(p => `<a href="${path(p)}"${p === page ? ' aria-current="page"' : ""}>${T.nav[p]}</a>`).join("")
  const swap = `<a class="lang" href="${alt(page)}" hreflang="${other}" lang="${other}">${T.lang}</a>`
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light"><meta name="theme-color" content="#f5f6f8"><link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="alternate" hreflang="${other}" href="${alt(page)}"><style>${SITE_CSS}</style></head>
<body><div class="wrap"><header class="top"><a class="brand" href="${path("home")}"><img src="/icon-192.png" width="36" height="36" alt="">${app}</a><nav class="links">${nav}${swap}</nav></header>
<main>
${body}
</main>
<footer><p>${T.footer(v)}</p><p><a href="${path("home")}">${T.nav.home}</a> · <a href="${path("privacy")}">${T.nav.privacy}</a> · <a href="${path("terms")}">${T.nav.terms}</a> · ${swap.replace(' class="lang"', "")}</p><p>${T.usesYt} · ${v.ytTermsN} · ${v.gPrivacyN}</p></footer></div></body></html>`
}

async function site(request, env, [lang, page]) {
  if (request.method !== "GET" && request.method !== "HEAD") return nothing()
  const cfg = await env.STORE.get("cfg:site", "json")
  if (!cfg || !cfg.owner_name || !cfg.email) return nothing()
  return new Response(request.method === "HEAD" ? null : sitePage(cfg, lang, page), {
    headers: { ...SITE_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  })
}

const ICON_PNG = {
  "icon-192.png": "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",
  "icon-512.png": "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",
  "apple-touch-icon.png": "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",
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    try {
      if (url.pathname.startsWith("/v/")) return await video(request, env, ctx, url)
      if (url.pathname.startsWith("/p/")) return await panel(request, env, url)
      if (url.pathname.startsWith("/api/")) {
        if (!env.STUDIO_KEY || request.headers.get("x-studio-key") !== env.STUDIO_KEY) return fail("yetkisiz", 401)
        return await api(request, env, url)
      }
      const name = url.pathname.slice(1)
      if (Object.hasOwn(ICON_PNG, name) && (request.method === "GET" || request.method === "HEAD")) return iconResponse(name, request.method)
      const page = SITE_ROUTES.get(url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname)
      if (page) return await site(request, env, page)
      return new Response("yok", { status: 404 })
    } catch (e) {
      return fail(`sunucu hatası: ${e.message}`, 500)
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(env))
  },
}
