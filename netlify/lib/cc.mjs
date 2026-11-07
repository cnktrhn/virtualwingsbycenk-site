// CrossCheck canlı harita API — ortak kod.
// Sözleşme: CROSS-CHECK ↔ virtualwingsbycenk.com BAĞLANTI SÖZLEŞMESİ (v1), bölüm 3.
// Blobs store "crosscheck", anahtarlar: live/<pilotId>, pilot/<pilotId>, auth/<pilotId>.
// E-posta, şifre, IP adresi, gerçek ad SAKLANMAZ.
import { createHash, timingSafeEqual } from "node:crypto";

export const STORE_NAME = "crosscheck";
const LIVE_MAX_AGE = 180;     // sn: GET /live yalnızca son 3 dakikadaki kayıtları döner
const MIN_INTERVAL = 20;      // sn: aynı pilotId'den daha sık konum gelirse 429
const MAX_BODY = 16384;       // bayt (rota noktaları için)
const MAX_PTS = 400;          // rota noktası sınırı
const TS_SKEW = 600;          // sn: ts sunucu saatinden en fazla bu kadar sapabilir
const PHASES = ["gate", "taxi", "climb", "cruise", "descent", "approach", "landed"];
const PUBLIC_LIVE = ["pilotId", "name", "rank", "flight", "aircraft", "dep", "arr",
  "lat", "lon", "altFt", "gsKt", "hdg", "phase", "ts"];
const PUBLIC_PROFILE = ["pilotId", "name", "rank", "xp", "flights", "hours", "badges", "updated"];

const ID_RE = /^[A-Z0-9]{8}$/;
const SECRET_RE = /^[0-9a-fA-F]{32}$/;

// ---------- yanıtlar ----------
const JSON_H = { "Content-Type": "application/json; charset=utf-8" };
export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_H, ...headers } });
const ok = () => json(200, { ok: true }, { "Cache-Control": "no-store" });
const err = (status, error) => json(status, { ok: false, error }, { "Cache-Control": "no-store" });
export const bad = (m = "bad_request", field) => json(400, field ? { ok: false, error: m, field } : { ok: false, error: m }, { "Cache-Control": "no-store" });
const forbidden = () => err(403, "forbidden");
const tooMany = () => err(429, "too_many_requests");
const notFound = () => err(404, "not_found");
const notAllowed = (allow) => new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }),
  { status: 405, headers: { ...JSON_H, Allow: allow } });

// ---------- doğrulama ----------
const clean = (s) => String(s).replace(/[\u0000-\u001F\u007F<>]/g, "").trim();
function str(v, max, { min = 0, re } = {}) {
  if (typeof v !== "string") return undefined;
  const s = clean(v);
  if (s.length < min || s.length > max) return undefined;
  if (re && !re.test(s)) return undefined;
  return s;
}
function num(v, lo, hi, { int = false } = {}) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) return undefined;
  if (int && !Number.isInteger(v)) return undefined;
  return v;
}
const has = (o, keys) => keys.every((k) => o[k] !== undefined);
const missing = (o, keys) => keys.find((k) => o[k] === undefined);

async function readBody(req) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) return null;
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try {
    const o = JSON.parse(text);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch { return null; }
}

const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// İlk istekte auth/<pilotId> = sha256(secret) yazılır; sonra tutmazsa false.
async function checkAuth(store, pilotId, secret) {
  const h = sha256(secret);
  const saved = await store.get(`auth/${pilotId}`, { type: "text" });
  if (saved == null) { await store.set(`auth/${pilotId}`, h); return true; }
  const a = Buffer.from(saved), b = Buffer.from(h);
  return a.length === b.length && timingSafeEqual(a, b);
}

function creds(o) {
  const pilotId = typeof o.pilotId === "string" && ID_RE.test(o.pilotId) ? o.pilotId : undefined;
  const secret = typeof o.secret === "string" && SECRET_RE.test(o.secret) ? o.secret : undefined;
  return pilotId && secret ? { pilotId, secret } : null;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

// ---------- POST /api/cc/position ----------
export async function position(req, store, now = Date.now()) {
  if (req.method !== "POST") return notAllowed("POST");
  const o = await readBody(req);
  if (!o || o.v !== 1) return bad();
  const c = creds(o);
  if (!c) return bad();
  const t = Math.floor(now / 1000);
  const rec = {
    pilotId: c.pilotId,
    name: str(o.name, 32, { min: 1 }),
    rank: str(o.rank, 32, { min: 1 }),
    flight: str(o.flight ?? "", 12),
    aircraft: str(o.aircraft ?? "", 16),
    dep: str(o.dep ?? "", 8, { re: /^[A-Za-z0-9]*$/ }),
    arr: str(o.arr ?? "", 8, { re: /^[A-Za-z0-9]*$/ }),
    lat: num(o.lat, -90, 90),
    lon: num(o.lon, -180, 180),
    altFt: num(o.altFt, -2000, 60000),
    gsKt: num(o.gsKt, 0, 1200),
    hdg: num(o.hdg, 0, 360),
    phase: PHASES.includes(o.phase) ? o.phase : undefined,
    ts: num(o.ts, t - TS_SKEW, t + TS_SKEW, { int: true }),
  };
  if (!has(rec, PUBLIC_LIVE)) return bad("bad_request", missing(rec, PUBLIC_LIVE));
  // Ek (v1.1-ek): isteğe bağlı uçuş planı. Program uçuş başında ve plan değişince gönderir.
  let route, pts;
  if (o.route !== undefined) { route = str(o.route, 2000); if (route === undefined) return bad(); }
  if (o.pts !== undefined) {
    if (!Array.isArray(o.pts) || o.pts.length > MAX_PTS) return bad();
    pts = [];
    for (const q of o.pts) {
      if (!Array.isArray(q) || q.length !== 2) return bad();
      const la = num(q[0], -90, 90), lo = num(q[1], -180, 180);
      if (la === undefined || lo === undefined) return bad();
      pts.push([Math.round(la * 1e4) / 1e4, Math.round(lo * 1e4) / 1e4]);
    }
  }
  if (!(await checkAuth(store, c.pilotId, c.secret))) return forbidden();

  const prev = await store.get(`live/${c.pilotId}`, { type: "json" });
  if (prev && typeof prev._rx === "number" && now - prev._rx < MIN_INTERVAL * 1000) return tooMany();

  rec.altFt = Math.round(rec.altFt); rec.gsKt = Math.round(rec.gsKt); rec.hdg = Math.round(rec.hdg) % 360;
  // Plan gönderilmediyse aynı uçuşun önceki planı korunur
  const same = prev && prev.flight === rec.flight && prev.dep === rec.dep && prev.arr === rec.arr;
  if (route === undefined && same && typeof prev.route === "string") route = prev.route;
  if (pts === undefined && same && Array.isArray(prev.pts)) pts = prev.pts;
  const extra = {};
  if (route) extra.route = route;
  if (pts && pts.length >= 2) extra.pts = pts;
  await store.setJSON(`live/${c.pilotId}`, { ...rec, ...extra, _rx: now });  // üzerine yazar; geçmiş yok
  // Uçuşun ilk konumunda pilotun profili yoksa geçici bir profil aç: pilot sayfası ilk uçuştan itibaren açılır.
  // Program uçuş sonunda /profile gönderdiğinde gerçek değerlerle üzerine yazılır.
  if (!prev && !(await store.get(`pilot/${c.pilotId}`, { type: "text" }))) {
    await store.setJSON(`pilot/${c.pilotId}`, { pilotId: c.pilotId, name: rec.name, rank: rec.rank, xp: 0, flights: 0, hours: 0, badges: [], updated: Math.floor(now / 1000), provisional: true });
  }
  return ok();
}

// ---------- POST /api/cc/end ----------
export async function end(req, store) {
  if (req.method !== "POST") return notAllowed("POST");
  const o = await readBody(req);
  const c = o && creds(o);
  if (!c) return bad();
  if (!(await checkAuth(store, c.pilotId, c.secret))) return forbidden();
  await store.delete(`live/${c.pilotId}`);
  return ok();
}

// ---------- GET /api/cc/live ----------
export async function live(req, store, now = Date.now()) {
  if (req.method !== "GET" && req.method !== "HEAD") return notAllowed("GET");
  const cutoff = Math.floor(now / 1000) - LIVE_MAX_AGE;
  const { blobs } = await store.list({ prefix: "live/" });
  const out = [], stale = [];
  await Promise.all(blobs.map(async ({ key }) => {
    const r = await store.get(key, { type: "json" }).catch(() => null);
    if (!r || typeof r.ts !== "number" || r.ts < cutoff) stale.push(key);
    else out.push(pick(r, PUBLIC_LIVE));      // secret ve _rx alanları çıkar
  }));
  await Promise.all(stale.map((k) => store.delete(k).catch(() => {})));
  out.sort((a, b) => a.pilotId.localeCompare(b.pilotId));
  // Kısa CDN önbelleği: aynı anda haritayı açan herkes için fonksiyon tekrar çalışmaz (kredi tasarrufu).
  return json(200, out, {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": "public, durable, s-maxage=15, stale-while-revalidate=15",
    "Access-Control-Allow-Origin": "*",
  });
}

// ---------- POST /api/cc/profile ----------
export async function profile(req, store, now = Date.now()) {
  if (req.method !== "POST") return notAllowed("POST");
  const o = await readBody(req);
  if (!o || o.v !== 1) return bad();
  const c = creds(o);
  if (!c) return bad();
  const t = Math.floor(now / 1000);
  // Hoşgörülü okuma: rozet kimlikleri küçük harfe çevrilir, geçersiz olanlar atlanır; rozet yoksa boş liste.
  const badges = o.badges === undefined || o.badges === null ? [] : Array.isArray(o.badges) && o.badges.length <= 200
    ? [...new Set(o.badges.filter((b) => typeof b === "string").map((b) => b.trim().toLowerCase()).filter((b) => /^[a-z0-9_]{1,32}$/.test(b)))] : undefined;
  const rnd = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : v);
  const rec = {
    pilotId: c.pilotId,
    name: typeof o.name === "string" ? str(o.name.slice(0, 32), 32, { min: 1 }) : undefined,
    rank: str(o.rank, 32, { min: 1 }),
    xp: num(rnd(o.xp), 0, 1e9, { int: true }),
    flights: num(rnd(o.flights), 0, 1e7, { int: true }),
    hours: num(o.hours, 0, 1e7),
    badges,
    updated: o.updated === undefined ? t : num(rnd(o.updated), 1e9, t + TS_SKEW, { int: true }),
  };
  if (!has(rec, PUBLIC_PROFILE)) return bad("bad_request", missing(rec, PUBLIC_PROFILE));
  if (!(await checkAuth(store, c.pilotId, c.secret))) return forbidden();
  rec.hours = Math.round(rec.hours * 10) / 10;
  await store.setJSON(`pilot/${c.pilotId}`, rec);  // üzerine yazar; uçuş listesi yok
  return ok();
}

// ---------- GET /api/cc/pilot?id= ----------
export async function pilot(req, store) {
  if (req.method !== "GET" && req.method !== "HEAD") return notAllowed("GET");
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return bad();
  const r = await store.get(`pilot/${id}`, { type: "json" });
  if (!r) return notFound();
  return json(200, r.provisional ? { ...pick(r, PUBLIC_PROFILE), provisional: true } : pick(r, PUBLIC_PROFILE), {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=60",
    "Access-Control-Allow-Origin": "*",
  });
}

// ---------- GET /api/cc/route?id=  (v1.1-ek) ----------
// Haritada uçağa tıklanınca çağrılır; /live hafif kalsın diye rota ayrı verilir.
export async function route(req, store, now = Date.now()) {
  if (req.method !== "GET" && req.method !== "HEAD") return notAllowed("GET");
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!ID_RE.test(id)) return bad();
  const r = await store.get(`live/${id}`, { type: "json" });
  if (!r || typeof r.ts !== "number" || r.ts < Math.floor(now / 1000) - LIVE_MAX_AGE || (!r.route && !r.pts)) return notFound();
  const out = { pilotId: id, dep: r.dep, arr: r.arr };
  if (r.route) out.route = r.route;
  if (r.pts) out.pts = r.pts;
  return json(200, out, {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=60",
    "Access-Control-Allow-Origin": "*",
  });
}

// ---------- GET /api/cc/top  (Hall of Fame) ----------
// pilot/<id> profillerinden XP'ye göre ilk 50. CDN'de 5 dk önbellek: çok ziyaret olsa da fonksiyon az çalışır.
export async function top(req, store) {
  if (req.method !== "GET" && req.method !== "HEAD") return notAllowed("GET");
  const { blobs } = await store.list({ prefix: "pilot/" });
  const all = (await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json" }).catch(() => null))))
    .filter((p) => p && typeof p.xp === "number")
    .map((p) => ({ ...pick(p, PUBLIC_PROFILE), badgeCount: Array.isArray(p.badges) ? p.badges.length : 0 }));
  all.sort((a, b) => b.xp - a.xp || b.hours - a.hours || a.pilotId.localeCompare(b.pilotId));
  const out = all.slice(0, 50).map(({ badges, ...rest }) => rest);
  return json(200, { total: all.length, pilots: out }, {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": "public, durable, s-maxage=300, stale-while-revalidate=300",
    "Access-Control-Allow-Origin": "*",
  });
}
