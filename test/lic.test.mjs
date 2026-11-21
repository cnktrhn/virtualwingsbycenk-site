// Lisans işareti testleri: sahte bir anahtar çiftiyle bilet üretilir, gerçek seri kullanılmaz.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as cc from "../netlify/lib/cc.mjs";
import { _resetKeyForTests } from "../netlify/lib/lic.mjs";
import { KEY_HASHES } from "../netlify/functions/cc-license/cc-license-keys.mjs";

const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
process.env.CC_LICENSE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.CC_ADMIN_TOKEN = "admintoken-123";
_resetKeyForTests();

const H = [...KEY_HASHES][0], KH = H.slice(0, 16);
const b64u = (b) => Buffer.from(b).toString("base64url");
const ticket = (o, key = privateKey) => { const p = Buffer.from(JSON.stringify({ m: "abcdef0123", iat: 1, exp: 2, ...o }));
  return b64u(p) + "." + b64u(crypto.sign("sha256", p, { key, dsaEncoding: "ieee-p1363" })); };

function memStore(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, JSON.stringify(v)])); let reads = 0;
  return { m, get reads() { return reads; },
    async get(k, o) { reads++; if (!m.has(k)) return null; const v = m.get(k); return o && o.type === "json" ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, String(v)); }, async setJSON(k, v) { m.set(k, JSON.stringify(v)); }, async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; } };
}
const NOW = 1767000000 * 1000, T = NOW / 1000, SECRET = "0123456789abcdef0123456789abcdef";
const post = (path, body) => new Request("https://x" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (path, admin) => new Request("https://x" + path, { headers: admin ? { "x-cc-admin": admin } : {} });
const fl = (o = {}) => ({ v: 1, pilotId: "AB3K9XQZ", secret: SECRET, name: "Cenk", rank: "captain", flight: "VWG123", aircraft: "A321",
  dep: "LTFM", arr: "LTAI", blockMin: 95, airMin: 71, distNm: 362, fpm: 142, score: 91, grade: "A", ...o });
const pos = (o = {}) => ({ v: 1, pilotId: "K7Q2M9XA", secret: SECRET, name: "Cenk T.", rank: "captain", flight: "VWG1", aircraft: "A321",
  dep: "LTFM", arr: "LTAI", lat: 40, lon: 30, altFt: 30000, gsKt: 450, hdg: 90, phase: "cruise", ts: T, ...o });

async function flightStatus(lic, lstore = memStore()) {
  const s = memStore(), f = memStore();
  const r = await cc.flight(post("/api/cc/flight", fl(lic === undefined ? {} : { lic })), s, f, NOW, lstore);
  assert.equal(r.status, 200, "lic yüzünden istek reddedilmez");
  const [x] = await (await cc.recent(get("/api/cc/recent?admin=1", "admintoken-123"), f, NOW)).json();
  return { x, f };
}

test("lisans: licensed / trial / revoked / invalid / none", async () => {
  let { x, f } = await flightStatus(ticket({ kh: KH }));
  assert.equal(x.licStatus, "licensed"); assert.equal(x.licHint, "#" + KH.slice(0, 4));
  assert.ok(![...f.m.values()].join("").includes(ticket({ kh: KH }).split(".")[1]), "bilet saklanmaz");
  ({ x } = await flightStatus(ticket({ kh: KH, p: "7K2Q" }))); assert.equal(x.licHint, "7K2Q");
  ({ x } = await flightStatus(ticket({ kh: "trial" }))); assert.equal(x.licStatus, "trial"); assert.equal(x.licHint, undefined);
  ({ x } = await flightStatus(ticket({ kh: KH }), memStore({ [H]: { machines: [], revoked: true } }))); assert.equal(x.licStatus, "revoked");
  ({ x } = await flightStatus(ticket({ kh: KH }, other))); assert.equal(x.licStatus, "invalid", "başka anahtarla imza");
  const t = ticket({ kh: "trial" }); ({ x } = await flightStatus(b64u(JSON.stringify({ kh: KH, m: "x" })) + "." + t.split(".")[1])); assert.equal(x.licStatus, "invalid", "değiştirilmiş içerik");
  ({ x } = await flightStatus("bozuk")); assert.equal(x.licStatus, "invalid");
  ({ x } = await flightStatus(ticket({ kh: "0000000000000000" }))); assert.equal(x.licStatus, "invalid", "listede olmayan özet");
  ({ x } = await flightStatus(undefined)); assert.equal(x.licStatus, "none");
  ({ x } = await flightStatus("")); assert.equal(x.licStatus, "none");
});

test("lisans: herkese açık yanıtlarda dönmez; admin başlıksız 403", async () => {
  const { f } = await flightStatus(ticket({ kh: KH }));
  const pub = await (await cc.recent(get("/api/cc/recent"), f, NOW)).json();
  assert.equal(pub[0].licStatus, undefined); assert.equal(pub[0].licHint, undefined);
  assert.equal((await cc.recent(get("/api/cc/recent?admin=1"), f, NOW)).status, 403);
  assert.equal((await cc.recent(get("/api/cc/recent?admin=1", "yanlis"), f, NOW)).status, 403);
  const a = await cc.recent(get("/api/cc/recent?admin=1", "admintoken-123"), f, NOW);
  assert.match(a.headers.get("cache-control"), /no-store/); assert.equal(a.headers.get("netlify-cdn-cache-control"), null);
});

test("lisans: canlı konum, pilot kaydı; 15 dk içinde depo tekrar okunmaz", async () => {
  const s = memStore(), f = memStore(), L = memStore();
  const lic = ticket({ kh: KH });
  assert.equal((await cc.position(post("/api/cc/position", pos({ lic })), s, NOW, f, L)).status, 200);
  const r1 = L.reads;
  assert.equal((await cc.position(post("/api/cc/position", pos({ lic, ts: T + 30 })), s, NOW + 30000, f, L)).status, 200);
  assert.equal(L.reads, r1, "aynı bilet önbellekten");
  const pubLive = await (await cc.live(get("/api/cc/live"), s, NOW + 30000)).json();
  assert.equal(pubLive[0].licStatus, undefined);
  const adm = await (await cc.live(get("/api/cc/live?admin=1", "admintoken-123"), s, NOW + 30000)).json();
  assert.equal(adm[0].licStatus, "licensed");
  assert.equal((await cc.live(get("/api/cc/live?admin=1"), s, NOW)).status, 403);
  assert.equal(JSON.parse(s.m.get("pilot/K7Q2M9XA")).licStatus, "licensed");
  const pp = await (await cc.pilot(get("/api/cc/pilot?id=K7Q2M9XA"), s)).json();
  assert.equal(pp.licStatus, undefined, "pilot sayfası yanıtında yok");
  assert.ok(![...s.m.values()].join("").includes(lic.split(".")[1]), "bilet saklanmaz");
  // eski sürüm: lic yok → none; istek kabul
  assert.equal((await cc.position(post("/api/cc/position", pos({ pilotId: "OLDVER01" })), s, NOW, f, L)).status, 200);
  assert.equal(JSON.parse(s.m.get("live/OLDVER01")).licStatus, "none");
  // bozuk bilet: konum yine kabul
  assert.equal((await cc.position(post("/api/cc/position", pos({ pilotId: "CRACK001", lic: "x.y" })), s, NOW, f, L)).status, 200);
  assert.equal(JSON.parse(s.m.get("live/CRACK001")).licStatus, "invalid");
});

test("lisans: /profile pilot kaydına yazar", async () => {
  const s = memStore(), L = memStore();
  const r = await cc.profile(post("/api/cc/profile", { v: 1, pilotId: "K7Q2M9XA", secret: SECRET, name: "Cenk", rank: "captain", xp: 1, flights: 1, hours: 1, badges: [], updated: T, lic: ticket({ kh: "trial" }) }), s, NOW, null, L);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(s.m.get("pilot/K7Q2M9XA")).licStatus, "trial");
});
