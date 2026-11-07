// node --test test/  — Blobs yerine bellek içi sahte store ile sözleşme testleri
import { test } from "node:test";
import assert from "node:assert/strict";
import * as cc from "../netlify/lib/cc.mjs";

function memStore() {
  const m = new Map();
  return {
    m,
    async get(k, { type } = {}) { if (!m.has(k)) return null; const v = m.get(k); return type === "json" ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, String(v)); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  };
}
const NOW = 1767000000 * 1000;
const T = NOW / 1000;
const SECRET = "0123456789abcdef0123456789abcdef";
const post = (path, body) => new Request("https://x" + path, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (path) => new Request("https://x" + path);
const pos = (o = {}) => ({ v: 1, pilotId: "K7Q2M9XA", secret: SECRET, name: "Cenk T.", rank: "captain",
  flight: "VWG123", aircraft: "A321", dep: "LTFM", arr: "LTAC", lat: 40.12345, lon: 32.12345,
  altFt: 36000, gsKt: 452, hdg: 95, phase: "cruise", ts: T, ...o });
const prof = (o = {}) => ({ v: 1, pilotId: "K7Q2M9XA", secret: SECRET, name: "Cenk T.", rank: "captain", xp: 12450,
  flights: 87, hours: 163.5, badges: ["butter", "night_owl"], updated: T, ...o });

test("position: 200, auth hash yazılır, secret saklanmaz", async () => {
  const s = memStore();
  const r = await cc.position(post("/api/cc/position", pos()), s, NOW);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.match(s.m.get("auth/K7Q2M9XA"), /^[0-9a-f]{64}$/);
  assert.ok(!s.m.get("live/K7Q2M9XA").includes(SECRET));
  assert.ok(![...s.m.values()].some((v) => v.includes(SECRET)));
});

test("position: yanlış secret 403", async () => {
  const s = memStore();
  await cc.position(post("/api/cc/position", pos()), s, NOW);
  const r = await cc.position(post("/api/cc/position", pos({ secret: "f".repeat(32) })), s, NOW + 30000);
  assert.equal(r.status, 403);
});

test("position: 20 sn'den sık 429, sonra 200", async () => {
  const s = memStore();
  assert.equal((await cc.position(post("/api/cc/position", pos()), s, NOW)).status, 200);
  assert.equal((await cc.position(post("/api/cc/position", pos({ ts: T + 10 })), s, NOW + 10000)).status, 429);
  assert.equal((await cc.position(post("/api/cc/position", pos({ ts: T + 30 })), s, NOW + 30000)).status, 200);
});

test("position: bozuk veri 400", async () => {
  const s = memStore();
  for (const o of [{ lat: 91 }, { lon: -181 }, { altFt: 99999 }, { gsKt: -1 }, { hdg: 400 }, { phase: "flying" },
    { pilotId: "k7q2m9xa" }, { pilotId: "SHORT" }, { secret: "xyz" }, { v: 2 }, { name: "" }, { ts: T - 3600 }, { lat: "40" }]) {
    assert.equal((await cc.position(post("/api/cc/position", pos(o)), s, NOW)).status, 400, JSON.stringify(o));
  }
  assert.equal((await cc.position(post("/api/cc/position", "{not json"), s, NOW)).status, 400);
  assert.equal((await cc.position(post("/api/cc/position", "x".repeat(5000)), s, NOW)).status, 400);
  assert.equal(s.m.size, 0, "geçersiz isteklerde hiçbir şey yazılmamalı");
});

test("live: secret yok, eski kayıt silinir, alanlar sözleşmedeki gibi", async () => {
  const s = memStore();
  await cc.position(post("/api/cc/position", pos()), s, NOW);
  await cc.position(post("/api/cc/position", pos({ pilotId: "OLD00001", ts: T - 100 })), s, NOW - 100000);
  const r = await cc.live(get("/api/cc/live"), s, NOW + 150000);   // OLD00001 ts'si 250 sn önce
  const arr = await r.json();
  assert.equal(r.status, 200);
  assert.equal(arr.length, 1);
  assert.deepEqual(Object.keys(arr[0]).sort(), ["pilotId","name","rank","flight","aircraft","dep","arr","lat","lon","altFt","gsKt","hdg","phase","ts"].sort());
  assert.ok(!("secret" in arr[0]) && !("_rx" in arr[0]));
  assert.ok(!s.m.has("live/OLD00001"), "eski kayıt silinmeli");
  assert.ok(s.m.has("auth/OLD00001"), "auth kalmalı");
});

test("end: live silinir; yanlış secret 403", async () => {
  const s = memStore();
  await cc.position(post("/api/cc/position", pos()), s, NOW);
  assert.equal((await cc.end(post("/api/cc/end", { pilotId: "K7Q2M9XA", secret: "a".repeat(32) }), s)).status, 403);
  assert.ok(s.m.has("live/K7Q2M9XA"));
  assert.equal((await cc.end(post("/api/cc/end", { pilotId: "K7Q2M9XA", secret: SECRET }), s)).status, 200);
  assert.ok(!s.m.has("live/K7Q2M9XA"));
});

test("profile + pilot: üzerine yazar, secret dönmez, 404", async () => {
  const s = memStore();
  assert.equal((await cc.profile(post("/api/cc/profile", prof()), s, NOW)).status, 200);
  assert.equal((await cc.profile(post("/api/cc/profile", prof({ xp: 13000, flights: 88 })), s, NOW)).status, 200);
  const r = await cc.pilot(get("/api/cc/pilot?id=K7Q2M9XA"), s);
  const p = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(p, { pilotId: "K7Q2M9XA", name: "Cenk T.", rank: "captain", xp: 13000, flights: 88, hours: 163.5, badges: ["butter", "night_owl"], updated: T });
  assert.equal((await cc.pilot(get("/api/cc/pilot?id=ZZZZZZZZ"), s)).status, 404);
  assert.equal((await cc.pilot(get("/api/cc/pilot?id=bad"), s)).status, 400);
  assert.equal((await cc.profile(post("/api/cc/profile", prof({ badges: ["<script>"] })), s, NOW)).status, 200);  // geçersiz rozet atlanır
  assert.equal((await cc.profile(post("/api/cc/profile", prof({ secret: "b".repeat(32) })), s, NOW)).status, 403);
  assert.deepEqual((await (await cc.pilot(get("/api/cc/pilot?id=K7Q2M9XA"), s)).json()).badges, []);
});

test("yanlış metot 405", async () => {
  const s = memStore();
  assert.equal((await cc.position(get("/api/cc/position"), s)).status, 405);
  assert.equal((await cc.live(post("/api/cc/live", {}), s)).status, 405);
});

test("v1.1-ek rota: kaydedilir, /live'da görünmez, /route'ta döner, aynı uçuşta korunur", async () => {
  const s = memStore();
  const pts = [[40.98, 28.82], [40.2, 30.5], [40.13, 33.0]];
  assert.equal((await cc.position(post("/api/cc/position", pos({ route: "LTFM DCT ADORU UL333 LTAC", pts })), s, NOW)).status, 200);
  const live = await (await cc.live(get("/api/cc/live"), s, NOW)).json();
  assert.ok(!("route" in live[0]) && !("pts" in live[0]));
  let r = await cc.route(get("/api/cc/route?id=K7Q2M9XA"), s, NOW);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { pilotId: "K7Q2M9XA", dep: "LTFM", arr: "LTAC", route: "LTFM DCT ADORU UL333 LTAC", pts });
  // plan olmadan yeni konum: plan korunur
  await cc.position(post("/api/cc/position", pos({ ts: T + 30, lat: 40.5 })), s, NOW + 30000);
  assert.equal((await (await cc.route(get("/api/cc/route?id=K7Q2M9XA"), s, NOW + 30000)).json()).pts.length, 3);
  // farklı uçuş: eski plan düşer
  await cc.position(post("/api/cc/position", pos({ ts: T + 60, flight: "VWG124", dep: "LTAC", arr: "LTFM" })), s, NOW + 60000);
  assert.equal((await cc.route(get("/api/cc/route?id=K7Q2M9XA"), s, NOW + 60000)).status, 404);
  // bozuk plan
  assert.equal((await cc.position(post("/api/cc/position", pos({ ts: T + 90, pts: [[91, 0], [0, 0]] })), s, NOW + 90000)).status, 400);
  assert.equal((await cc.position(post("/api/cc/position", pos({ ts: T + 90, pts: "x" })), s, NOW + 90000)).status, 400);
  assert.equal((await cc.route(get("/api/cc/route?id=NOPE0000"), s, NOW)).status, 404);
});

test("top: XP'ye göre sıralı, secret ve rozet listesi yok, rozet sayısı var", async () => {
  const s = memStore();
  await cc.profile(post("/api/cc/profile", prof()), s, NOW);
  await cc.profile(post("/api/cc/profile", prof({ pilotId: "AB12CD34", secret: "a".repeat(32), name: "Ayşe K.", xp: 50000, badges: ["butter"] })), s, NOW);
  const r = await cc.top(get("/api/cc/top"), s);
  const j = await r.json();
  assert.equal(j.total, 2);
  assert.deepEqual(j.pilots.map((p) => p.pilotId), ["AB12CD34", "K7Q2M9XA"]);
  assert.equal(j.pilots[0].badgeCount, 1);
  assert.ok(!("badges" in j.pilots[0]) && !("secret" in j.pilots[0]));
});

test("ilk konumda geçici profil açılır; profile gelince üzerine yazılır", async () => {
  const s = memStore();
  await cc.position(post("/api/cc/position", pos()), s, NOW);
  let p = await (await cc.pilot(get("/api/cc/pilot?id=K7Q2M9XA"), s)).json();
  assert.equal(p.name, "Cenk T."); assert.equal(p.xp, 0);
  await cc.profile(post("/api/cc/profile", prof()), s, NOW);
  p = await (await cc.pilot(get("/api/cc/pilot?id=K7Q2M9XA"), s)).json();
  assert.equal(p.xp, 12450);
  // ikinci konum geçici profili ezmez
  await cc.position(post("/api/cc/position", pos({ ts: T + 30 })), s, NOW + 30000);
  assert.equal((await (await cc.pilot(get("/api/cc/pilot?id=K7Q2M9XA"), s)).json()).xp, 12450);
});

test("profile hoşgörülü: ondalık XP yuvarlanır, büyük harfli rozet düzelir, eksik rozet boş liste, hata alanı söylenir", async () => {
  const s = memStore();
  assert.equal((await cc.profile(post("/api/cc/profile", prof({ xp: 12450.6, badges: ["Butter", "bad id!"] })), s, NOW)).status, 200);
  const p = await (await cc.pilot(get("/api/cc/pilot?id=K7Q2M9XA"), s)).json();
  assert.equal(p.xp, 12451); assert.deepEqual(p.badges, ["butter"]);
  const o = prof(); delete o.badges; delete o.updated;
  assert.equal((await cc.profile(post("/api/cc/profile", o), s, NOW)).status, 200);
  const r = await cc.profile(post("/api/cc/profile", prof({ hours: "x" })), s, NOW);
  assert.equal(r.status, 400); assert.equal((await r.json()).field, "hours");
});
