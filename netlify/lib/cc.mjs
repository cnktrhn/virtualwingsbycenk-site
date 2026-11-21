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
const MAX_TRACK = 600;        // uçuş içi iz noktası sınırı (dolunca seyreltilir)
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

async function readBody(req, max = MAX_BODY) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) return null;
  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > max) return null;
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
export async function position(req, store, now = Date.now(), fstore = null) {
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
  // Son uçuşlar: önceki uçuş indiyse ve şimdi yeni bir uçuş (başka uçuş no ya da yeniden kalkış) başladıysa önceki uçuşu kaydet.
  const airborne = AIR_PHASES.includes(rec.phase);
  const cont = same && !(prev._land && airborne);
  if (prev && !cont) await finalizeFlight(fstore, prev);
  if (route === undefined && same && typeof prev.route === "string") route = prev.route;
  if (pts === undefined && same && Array.isArray(prev.pts)) pts = prev.pts;
  const extra = {};
  if (route) extra.route = route;
  if (pts && pts.length >= 2) extra.pts = pts;
  // Uçulan iz: aynı uçuş sürdükçe her konum eklenir; uçuş bitince (end ya da 3 dk veri yok) live kaydıyla birlikte silinir.
  let track = cont && Array.isArray(prev.track) ? prev.track.slice() : [];
  const q = [Math.round(rec.lat * 1e4) / 1e4, Math.round(rec.lon * 1e4) / 1e4];
  const last = track[track.length - 1];
  if (!last || last[0] !== q[0] || last[1] !== q[1]) track.push(q);
  if (track.length > MAX_TRACK) track = track.filter((_, i) => i % 2 === 0 || i === track.length - 1);
  extra.track = track;
  // Uçuş özeti için iç alanlar (dışarı verilmez): başlangıç, kalkış/iniş zamanı, kaydedildi mi
  const m = cont ? prev : {};
  extra._t0 = m._t0 ?? (cont ? prev.ts : rec.ts);
  extra._air = !!m._air || airborne;
  if (m._tOff || airborne) extra._tOff = m._tOff || rec.ts;
  extra._land = !!m._land || (extra._air && rec.phase === "landed");
  if (extra._land) extra._tOn = m._tOn || rec.ts;
  if (m._rec) extra._rec = true;
  await store.setJSON(`live/${c.pilotId}`, { ...rec, ...extra, _rx: now });  // üzerine yazar; geçmiş yok
  // Uçuşun ilk konumunda pilotun profili yoksa geçici bir profil aç: pilot sayfası ilk uçuştan itibaren açılır.
  // Program uçuş sonunda /profile gönderdiğinde gerçek değerlerle üzerine yazılır.
  if (!prev && !(await store.get(`pilot/${c.pilotId}`, { type: "text" }))) {
    await store.setJSON(`pilot/${c.pilotId}`, { pilotId: c.pilotId, name: rec.name, rank: rec.rank, xp: 0, flights: 0, hours: 0, badges: [], updated: Math.floor(now / 1000), provisional: true });
  }
  return ok();
}

// Mevcut program sürümü için: uçuş özeti canlı harita verisinden çıkarılır (konum kayıtları + /end ya da /profile).
// Yalnızca kalkıp inmiş (airborne → landed) ve 5–1200 dakika süren uçuşlar yazılır; yarım kalan uçuş yazılmaz.
// Programın gönderemediği alanlar (iniş fpm'i, not, tescil, havayolu) boş kalır.
const nmBetween = (a, b) => {
  const R = Math.PI / 180, la1 = a[0] * R, la2 = b[0] * R, dla = la2 - la1, dlo = (b[1] - a[1]) * R;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2)));
};
async function finalizeFlight(fstore, r) {
  if (!fstore || !r || !r._air || !r._land || r._rec || typeof r._t0 !== "number") return false;
  const blockMin = Math.round((r.ts - r._t0) / 60);
  if (blockMin < 5 || blockMin > 1200) return false;
  const airMin = r._tOff && r._tOn > r._tOff ? Math.round((r._tOn - r._tOff) / 60) : null;
  if (typeof airMin === "number" && airMin < MIN_AIR) return false;
  const line = Array.isArray(r.pts) && r.pts.length >= 2 ? r.pts : Array.isArray(r.track) && r.track.length >= 2 ? r.track : null;
  const a = line ? line[0] : null, b = line ? line[line.length - 1] : null;
  const end = Math.floor((typeof r._rx === "number" ? r._rx : r.ts * 1000) / 1000);
  const rec = {
    pilotId: r.pilotId, name: cut(r.name, 40), rank: cut(r.rank, 32),
    flight: cut(r.flight, 12), airline: "", aircraft: cut(r.aircraft, 8), reg: "",
    dep: icao(r.dep), arr: icao(r.arr),
    depLat: a ? a[0] : null, depLon: a ? a[1] : null, arrLat: b ? b[0] : null, arrLon: b ? b[1] : null,
    blockMin, airMin,
    distNm: a && b ? Math.round(nmBetween(a, b)) : null, fpm: null, score: null, grade: "",
    ts: end, src: "auto", t0: r._t0,
  };
  const list = await fstore.get("recent", { type: "json" }).catch(() => null);
  const old = Array.isArray(list) ? list : [];
  if (old.some((f) => f && f.pilotId === rec.pilotId && f.t0 === rec.t0)) return false;   // aynı uçuş ikinci kez yazılmaz
  await fstore.setJSON("recent", [rec, ...old].slice(0, RECENT_KEEP));
  return true;
}

// ---------- POST /api/cc/end ----------
export async function end(req, store, fstore = null, now = Date.now()) {
  if (req.method !== "POST") return notAllowed("POST");
  const o = await readBody(req);
  const c = o && creds(o);
  if (!c) return bad();
  if (!(await checkAuth(store, c.pilotId, c.secret))) return forbidden();
  await finalizeFlight(fstore, await store.get(`live/${c.pilotId}`, { type: "json" }).catch(() => null));
  await store.delete(`live/${c.pilotId}`);
  return ok();
}

// ---------- GET /api/cc/live ----------
export async function live(req, store, now = Date.now(), fstore = null) {
  if (req.method !== "GET" && req.method !== "HEAD") return notAllowed("GET");
  const cutoff = Math.floor(now / 1000) - LIVE_MAX_AGE;
  const { blobs } = await store.list({ prefix: "live/" });
  const out = [], stale = [];
  await Promise.all(blobs.map(async ({ key }) => {
    const r = await store.get(key, { type: "json" }).catch(() => null);
    if (!r || typeof r.ts !== "number" || r.ts < cutoff) { stale.push(key); if (r) await finalizeFlight(fstore, r).catch(() => {}); }
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
export async function profile(req, store, now = Date.now(), fstore = null) {
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
  // Program profili uçuş bitince gönderir: canlı kayıt inişi gördüyse uçuş "son uçuşlar"a yazılır ve işaretlenir.
  const lv = await store.get(`live/${c.pilotId}`, { type: "json" }).catch(() => null);
  if (lv && (await finalizeFlight(fstore, lv))) await store.setJSON(`live/${c.pilotId}`, { ...lv, _rec: true });
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
  const hasTrack = Array.isArray(r && r.track) && r.track.length >= 2;
  if (!r || typeof r.ts !== "number" || r.ts < Math.floor(now / 1000) - LIVE_MAX_AGE || (!r.route && !r.pts && !hasTrack)) return notFound();
  const out = { pilotId: id, dep: r.dep, arr: r.arr };
  if (r.route) out.route = r.route;
  if (r.pts) out.pts = r.pts;
  if (hasTrack) out.track = r.track;
  return json(200, out, {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Netlify-CDN-Cache-Control": "public, durable, s-maxage=20, stale-while-revalidate=60",
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

// ---------- Son uçuşlar (canlı harita sözleşmesi v1 eki, program v1.0.5) ----------
// POST /api/cc/flight: tamamlanan uçuşun özeti. Kimlik /position ile aynı (auth/<pilotId>, "crosscheck" deposu).
// Kayıtlar ayrı depoda: "cc-flights", anahtar "recent" = en yeni 50 uçuş. Hız sınırı anahtarı: rl/<pilotId>.
export const FLIGHTS_STORE = "cc-flights";
const FLIGHT_MAX_BODY = 4096;          // bayt
const FLIGHT_INTERVAL = 600;           // sn: aynı pilotId'den 10 dakikada en fazla 1 kayıt
const RECENT_KEEP = 50;
const RECENT_MAX_AGE = 30 * 86400;     // sn: 30 günden eski uçuşlar listelenmez
const AIR_PHASES = ["climb", "cruise", "descent", "approach"];
const PUBLIC_FLIGHT = ["pilotId", "name", "rank", "flight", "airline", "aircraft", "reg", "dep", "arr",
  "depLat", "depLon", "arrLat", "arrLon", "blockMin", "airMin", "distNm", "fpm", "score", "grade",
  "g", "service", "pas", "cats", "ts"];
const MIN_AIR = 15;                    // dk: havada 15 dakikadan kısa uçuşlar listeye girmez
const CAT_KEYS = ["sop", "cabin", "air", "comfort"];
// İsteğe bağlı sayı: yok/null → null, aralık dışı → undefined (400)
const opt = (v, lo, hi, int) => (v === null || v === undefined ? null : num(int && typeof v === "number" ? Math.round(v) : v, lo, hi, { int }));

// Metin alanları: boş olabilir, uzunsa kırpılır (reddedilmez).
const cut = (v, max) => (typeof v === "string" || typeof v === "number" ? clean(String(v)).slice(0, max) : "");
const icao = (v) => (typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : "");
const coord = (v, lim) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim ? Math.round(v * 1e4) / 1e4 : null);

export async function flight(req, store, fstore, now = Date.now()) {
  if (req.method !== "POST") return notAllowed("POST");
  const o = await readBody(req, FLIGHT_MAX_BODY);
  if (!o || o.v !== 1) return bad();
  const c = creds(o);
  if (!c) return bad();
  const nums = { blockMin: num(o.blockMin, 5, 1200), distNm: num(o.distNm, 0, 9000), score: num(o.score, 0, 100) };
  const k = missing(nums, Object.keys(nums));
  if (k) return bad("bad_request", k);
  // İniş ölçülemediyse fpm null. Program alçalma hızını eksi işaretli gönderirse mutlak değeri alınır.
  let fpm = null;
  if (o.fpm !== null && o.fpm !== undefined) {
    fpm = num(typeof o.fpm === "number" ? Math.abs(o.fpm) : o.fpm, 0, 3000);
    if (fpm === undefined) return bad("bad_request", "fpm");
  }
  const air = num(o.airMin, 0, 1200);
  if (typeof air === "number" && air < MIN_AIR) return bad("bad_request", "airMin");
  // Winter Update alanları (eski sürümde yok → null)
  const g = opt(o.g, 0.5, 4), service = opt(o.service, 0, 100, true), pas = opt(o.pas, 0, 500, true);
  for (const [f, v] of [["g", g], ["service", service], ["pas", pas]]) if (v === undefined) return bad("bad_request", f);
  let cats = null;
  if (o.cats !== null && o.cats !== undefined) {
    if (typeof o.cats !== "object" || Array.isArray(o.cats)) return bad("bad_request", "cats");
    cats = {};
    for (const key of CAT_KEYS) {
      const v = opt(o.cats[key], 0, 100, true);
      if (v === undefined) return bad("bad_request", "cats." + key);
      if (v !== null) cats[key] = v;
    }
    if (!Object.keys(cats).length) cats = null;
  }
  const rec = {
    pilotId: c.pilotId,
    name: cut(o.name, 40), rank: cut(o.rank, 32),
    flight: cut(o.flight, 12), airline: cut(o.airline, 40), aircraft: cut(o.aircraft, 8), reg: cut(o.reg, 10),
    dep: icao(o.dep), arr: icao(o.arr),
    depLat: coord(o.depLat, 90), depLon: coord(o.depLon, 180), arrLat: coord(o.arrLat, 90), arrLon: coord(o.arrLon, 180),
    blockMin: Math.round(nums.blockMin), airMin: air === undefined ? null : Math.round(air),
    distNm: Math.round(nums.distNm), fpm: fpm === null ? null : Math.round(fpm),
    score: Math.round(nums.score), grade: cut(o.grade, 3),
    g: g === null ? null : Math.round(g * 100) / 100, service, pas, cats,
    ts: Math.floor(now / 1000),        // programın ts'i yerine sunucu saati
  };
  if (!(await checkAuth(store, c.pilotId, c.secret))) return forbidden();
  const last = Number(await fstore.get(`rl/${c.pilotId}`, { type: "text" }));
  if (last && now - last < FLIGHT_INTERVAL * 1000) return tooMany();
  await fstore.set(`rl/${c.pilotId}`, String(now));
  const list = await fstore.get("recent", { type: "json" }).catch(() => null);
  const rest = (Array.isArray(list) ? list : []).filter((f) => !(f && f.src === "auto" && f.pilotId === rec.pilotId && rec.ts - f.ts < 3 * 3600));
  const next = [rec, ...rest].slice(0, RECENT_KEEP);
  await fstore.setJSON("recent", next);
  return ok();
}

// ---------- GET /api/cc/recent?n=10 ----------
// En fazla 20 uçuş, yeniden eskiye; 30 günden eskiler çıkar. secret hiç saklanmaz, pilotId döner.
export async function recent(req, fstore, now = Date.now()) {
  if (req.method !== "GET" && req.method !== "HEAD") return notAllowed("GET");
  const q = Number(new URL(req.url).searchParams.get("n"));
  const n = Number.isInteger(q) && q > 0 ? Math.min(q, 20) : 10;
  const cutoff = Math.floor(now / 1000) - RECENT_MAX_AGE;
  const list = await fstore.get("recent", { type: "json" }).catch(() => null);
  const out = (Array.isArray(list) ? list : [])
    .filter((f) => f && f.ts >= cutoff && !(typeof f.airMin === "number" && f.airMin < MIN_AIR)).sort((a, b) => b.ts - a.ts).slice(0, n)
    .map((f) => Object.fromEntries(PUBLIC_FLIGHT.map((k) => [k, f[k] ?? null])));
  return json(200, out, {
    "Cache-Control": "public, max-age=60",
    "Netlify-CDN-Cache-Control": "public, durable, s-maxage=60, stale-while-revalidate=60",
    "Access-Control-Allow-Origin": "*",
  });
}
