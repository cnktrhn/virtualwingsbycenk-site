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

test("uçulan iz: aynı uçuşta birikir, /route'ta döner, /live'da görünmez, yeni uçuşta sıfırlanır", async () => {
  const s = memStore();
  await cc.position(post("/api/cc/position", pos({ lat: 40.0, lon: 32.0 })), s, NOW);
  await cc.position(post("/api/cc/position", pos({ ts: T + 30, lat: 40.1, lon: 32.1 })), s, NOW + 30000);
  await cc.position(post("/api/cc/position", pos({ ts: T + 60, lat: 40.2, lon: 32.2 })), s, NOW + 60000);
  const r = await (await cc.route(get("/api/cc/route?id=K7Q2M9XA"), s, NOW + 60000)).json();
  assert.deepEqual(r.track, [[40, 32], [40.1, 32.1], [40.2, 32.2]]);
  const live = await (await cc.live(get("/api/cc/live"), s, NOW + 60000)).json();
  assert.ok(!("track" in live[0]));
  await cc.position(post("/api/cc/position", pos({ ts: T + 90, flight: "VWG999", lat: 41, lon: 29 })), s, NOW + 90000);
  assert.equal((await cc.route(get("/api/cc/route?id=K7Q2M9XA"), s, NOW + 90000)).status, 404);
});

// ---------- Son uçuşlar ----------
const fl = (o = {}) => ({ v: 1, pilotId: "AB3K9XQZ", secret: SECRET, name: "Cenk", rank: "captain",
  flight: "VWG123", airline: "Virtual Wings", aircraft: "A321", reg: "TC-VWG", dep: "LTFM", arr: "LTAI",
  depLat: 41.262, depLon: 28.742, arrLat: 36.899, arrLon: 30.8, blockMin: 95, airMin: 71, distNm: 362,
  fpm: 142, score: 91, grade: "A", ts: 1763560000, ...o });

test("flight: kayıt, sunucu saati, secret dönmez, auth /position ile ortak", async () => {
  const s = memStore(), f = memStore();
  await cc.position(post("/api/cc/position", pos({ pilotId: "AB3K9XQZ" })), s, NOW);
  const r = await cc.flight(post("/api/cc/flight", fl()), s, f, NOW);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.ok(![...f.m.values()].some((v) => v.includes(SECRET)));
  const g = await cc.recent(get("/api/cc/recent?n=10"), f, NOW);
  assert.equal(g.headers.get("cache-control"), "public, max-age=60");
  const [x] = await g.json();
  assert.equal(x.ts, T); assert.equal(x.pilotId, "AB3K9XQZ"); assert.equal(x.fpm, 142);
  assert.equal(x.secret, undefined); assert.equal(x.score, 91);
  assert.equal((await cc.flight(post("/api/cc/flight", fl({ secret: "f".repeat(32) })), s, f, NOW + 700000)).status, 403);
});

test("flight: 10 dakikada 1 kayıt (429)", async () => {
  const s = memStore(), f = memStore();
  assert.equal((await cc.flight(post("/api/cc/flight", fl()), s, f, NOW)).status, 200);
  assert.equal((await cc.flight(post("/api/cc/flight", fl()), s, f, NOW + 300000)).status, 429);
  assert.equal((await cc.flight(post("/api/cc/flight", fl()), s, f, NOW + 601000)).status, 200);
});

test("flight: mantık kontrolü 400, kırpma, fpm null", async () => {
  const s = memStore(), f = memStore();
  for (const o of [{ blockMin: 4 }, { blockMin: 1201 }, { distNm: 9001 }, { score: 101 }, { fpm: 3001 }, { score: "91" }, { v: 2 }, { secret: "x" }]) {
    assert.equal((await cc.flight(post("/api/cc/flight", fl(o)), s, f, NOW)).status, 400, JSON.stringify(o));
  }
  assert.equal((await cc.flight(post("/api/cc/flight", JSON.stringify(fl({ name: "x".repeat(5000) }))), s, f, NOW)).status, 400, "4 KB sınırı");
  assert.equal(f.m.size, 0);
  const r = await cc.flight(post("/api/cc/flight", fl({ fpm: null, name: "N".repeat(60), flight: "VWG1234567890", dep: "ltfm-x", arr: "", reg: "" })), s, f, NOW);
  assert.equal(r.status, 200);
  const [x] = await (await cc.recent(get("/api/cc/recent"), f, NOW)).json();
  assert.equal(x.fpm, null); assert.equal(x.name.length, 40); assert.equal(x.flight, "VWG123456789"); assert.equal(x.dep, "LTFM"); assert.equal(x.arr, "");
});

test("recent: en yeni 50 saklanır, n en fazla 20, 30 günden eskiler çıkar", async () => {
  const s = memStore(), f = memStore();
  for (let i = 0; i < 55; i++) {
    const id = "P" + String(i).padStart(7, "0");
    await cc.flight(post("/api/cc/flight", fl({ pilotId: id, flight: "F" + i })), s, f, NOW + i * 1000);
  }
  assert.equal(JSON.parse(f.m.get("recent")).length, 50);
  const a = await (await cc.recent(get("/api/cc/recent?n=99"), f, NOW + 60000)).json();
  assert.equal(a.length, 20); assert.equal(a[0].flight, "F54");
  const old = await (await cc.recent(get("/api/cc/recent"), f, NOW + 31 * 86400000)).json();
  assert.equal(old.length, 0);
});

// ---------- Mevcut sürüm: son uçuşlar canlı harita verisinden ----------
const ID2 = "Z9Y8X7W6";
async function fly(s, f, phases, { t0 = NOW, step = 180000, flight = "VWG777", dep = "LTFM", arr = "LTAI" } = {}) {
  let t = t0;
  for (let i = 0; i < phases.length; i++) {
    const r = await cc.position(post("/api/cc/position", pos({ pilotId: ID2, flight, dep, arr, phase: phases[i], ts: Math.floor(t / 1000),
      lat: 41 - i * 0.4, lon: 28.7 + i * 0.2 })), s, t, f);
    assert.equal(r.status, 200, phases[i]);
    t += step;
  }
  return t;
}
const FULL = ["gate", "taxi", "climb", "cruise", "cruise", "descent", "approach", "landed", "taxi", "gate"];

test("auto: kalkıp inen uçuş /end ile son uçuşlara yazılır", async () => {
  const s = memStore(), f = memStore();
  const t = await fly(s, f, FULL);
  assert.equal((await cc.end(post("/api/cc/end", { pilotId: ID2, secret: SECRET }), s, f, t)).status, 200);
  const [x, y] = await (await cc.recent(get("/api/cc/recent"), f, t)).json();
  assert.equal(y, undefined);
  assert.equal(x.flight, "VWG777"); assert.equal(x.dep, "LTFM"); assert.equal(x.blockMin, 27); assert.equal(x.airMin, 15);
  assert.equal(x.fpm, null); assert.equal(x.grade, ""); assert.ok(x.distNm > 100); assert.equal(typeof x.depLat, "number");
  assert.ok(!f.m.get("recent").includes(SECRET));
});

test("auto: inmeyen (yarım kalan) uçuş yazılmaz; kısa uçuş yazılmaz", async () => {
  const s = memStore(), f = memStore();
  let t = await fly(s, f, ["gate", "taxi", "climb", "cruise", "cruise", "cruise"]);
  await cc.end(post("/api/cc/end", { pilotId: ID2, secret: SECRET }), s, f, t);
  t = await fly(s, f, ["taxi", "climb", "landed"], { t0: t + 60000, step: 30000 });
  await cc.end(post("/api/cc/end", { pilotId: ID2, secret: SECRET }), s, f, t);
  assert.equal(f.m.get("recent"), undefined);
});

test("auto: /profile uçuşu kaydeder, sonraki /end ve yeni uçuş tekrar yazmaz", async () => {
  const s = memStore(), f = memStore();
  let t = await fly(s, f, FULL);
  assert.equal((await cc.profile(post("/api/cc/profile", prof({ pilotId: ID2, updated: Math.floor(t / 1000) })), s, t, f)).status, 200);
  assert.equal(JSON.parse(f.m.get("recent")).length, 1);
  await cc.end(post("/api/cc/end", { pilotId: ID2, secret: SECRET }), s, f, t + 1000);
  assert.equal(JSON.parse(f.m.get("recent")).length, 1);
});

test("auto: /end gelmese de yeni uçuş başlayınca ya da kayıt bayatlayınca önceki uçuş yazılır", async () => {
  const s = memStore(), f = memStore();
  let t = await fly(s, f, FULL);
  t = await fly(s, f, ["gate", "taxi"], { t0: t + 600000, flight: "VWG778", dep: "LTAI", arr: "LTFM" });
  let list = JSON.parse(f.m.get("recent")); assert.equal(list.length, 1); assert.equal(list[0].flight, "VWG777");
  // ikinci uçuş da tamamlanır, program /end göndermez; harita isteği bayat kaydı temizlerken yazar
  t = await fly(s, f, ["climb", "cruise", "cruise", "descent", "approach", "landed", "gate"], { t0: t, flight: "VWG778", dep: "LTAI", arr: "LTFM" });
  await cc.live(get("/api/cc/live"), s, t + 400000, f);
  list = JSON.parse(f.m.get("recent")); assert.equal(list.length, 2); assert.equal(list[0].flight, "VWG778");
  assert.equal(s.m.get("live/" + ID2), undefined);
});

test("auto: program özeti (/flight) gelirse otomatik kaydın yerine geçer", async () => {
  const s = memStore(), f = memStore();
  const t = await fly(s, f, FULL);
  await cc.end(post("/api/cc/end", { pilotId: ID2, secret: SECRET }), s, f, t);
  await cc.flight(post("/api/cc/flight", fl({ pilotId: ID2, flight: "VWG777" })), s, f, t + 5000);
  const list = JSON.parse(f.m.get("recent"));
  assert.equal(list.length, 1); assert.equal(list[0].fpm, 142);
});

// ---------- Uçuş özeti alanları (Winter Update) ----------
test("flight: g/service/pas/cats doğrulanır, saklanır ve /recent'te döner", async () => {
  const s = memStore(), f = memStore();
  const r = await cc.flight(post("/api/cc/flight", fl({ g: 1.183, service: 100, pas: 14, cats: { sop: 92, cabin: 88, air: 95, comfort: 80.4, junk: 5 } })), s, f, NOW);
  assert.equal(r.status, 200);
  const [x] = await (await cc.recent(get("/api/cc/recent"), f, NOW)).json();
  assert.equal(x.g, 1.18); assert.equal(x.service, 100); assert.equal(x.pas, 14); assert.equal(x.score, 91); assert.equal(x.airMin, 71);
  assert.deepEqual(x.cats, { sop: 92, cabin: 88, air: 95, comfort: 80 });
});
test("flight: eski kayıt (yeni alan yok) null döner; aralık dışı 400", async () => {
  const s = memStore(), f = memStore();
  for (const o of [{ g: 0.4 }, { g: 4.1 }, { service: 101 }, { pas: 501 }, { pas: -1 }, { cats: { sop: 120 } }, { cats: [1] }, { g: "1.2" }]) {
    assert.equal((await cc.flight(post("/api/cc/flight", fl(o)), s, f, NOW)).status, 400, JSON.stringify(o));
  }
  assert.equal((await cc.flight(post("/api/cc/flight", fl({ cats: { sop: 90 } })), s, f, NOW)).status, 200);
  const [x] = await (await cc.recent(get("/api/cc/recent"), f, NOW)).json();
  assert.equal(x.g, null); assert.equal(x.service, null); assert.equal(x.pas, null); assert.deepEqual(x.cats, { sop: 90 });
});
test("flight: havada 15 dakikadan kısa uçuş kabul edilmez, eski kısa kayıtlar gizlenir", async () => {
  const s = memStore(), f = memStore();
  const r = await cc.flight(post("/api/cc/flight", fl({ airMin: 14 })), s, f, NOW);
  assert.equal(r.status, 400); assert.equal((await r.json()).field, "airMin");
  f.m.set("recent", JSON.stringify([{ ...fl({ airMin: 9 }), ts: T, secret: undefined }, { ...fl({ flight: "OK1" }), ts: T - 10 }]));
  const list = await (await cc.recent(get("/api/cc/recent"), f, NOW)).json();
  assert.equal(list.length, 1); assert.equal(list[0].flight, "OK1");
});
