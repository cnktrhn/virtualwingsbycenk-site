// Online ATC: ağ verisi örnekleri (belgelenmiş biçim) ile ayrıştırma, önbellek ve kapatma testleri
import { test } from "node:test";
import assert from "node:assert/strict";
import { atcOnline, parseVatsim, parseIvao, typeOf } from "../netlify/lib/atc.mjs";

const VATSIM = { general: { update_timestamp: "2026-11-26T08:55:00.1234567Z" },
  controllers: [
    { cid: 1234567, name: "John Doe", callsign: "LTFM_TWR", frequency: "118.100", facility: 4, rating: 3, text_atis: ["John Doe, ask me anything"] },
    { cid: 2, name: "Jane", callsign: "LTFM_DEP", frequency: "120.500", facility: 5, rating: 4, text_atis: null },
    { cid: 3, name: "Obs", callsign: "LTFM_OBS", frequency: "199.998", facility: 0, rating: 1 },
    { cid: 4, name: "Sup", callsign: "EURW_SUP", frequency: "199.998", facility: 0, rating: 11 },
    { cid: 5, name: "X", callsign: "LTBB_CTR", frequency: "128.200", facility: 6, rating: 5 },
    { cid: 6, name: "Y", callsign: "LTAI_RMP", frequency: "121.900", facility: 3, rating: 2 },
    { cid: 7, name: "Z", callsign: "EDDF_GND", frequency: "121.800", facility: 3, rating: 2 },
  ],
  atis: [{ cid: 8, name: "J", callsign: "LTFM_ATIS", frequency: "128.200", facility: 4, atis_code: "A", text_atis: ["ISTANBUL INFORMATION ALPHA", "RWY 34L", "QNH 1013", "x", "y", "z", "u", "v", "w"] }] };
const TX = [
  { callsign: "LTFM_TWR", transceivers: [{ latDeg: 41.2753, lonDeg: 28.7519 }, { latDeg: 1, lonDeg: 1 }] },
  { callsign: "LTFM_DEP", transceivers: [{ latDeg: 41.27, lonDeg: 28.75 }] },
  { callsign: "LTBB_CTR", transceivers: [{ latDeg: 40.9, lonDeg: 29.3 }] },
];
const IVAO = { updatedAt: "2026-11-26T08:55:10Z", clients: { atcs: [
  { id: 1, userId: 555555, callsign: "LTAI_TWR", rating: 4, atcSession: { frequency: 118.6, position: "TWR" }, lastTrack: { latitude: 36.9, longitude: 30.8 }, atis: { lines: ["LTAI_TWR", "Information B", "RWY 36C"] } },
  { id: 2, userId: 666666, callsign: "LTAA_CTR", atcSession: { frequency: 127.3 }, lastTrack: { latitude: 39.9, longitude: 32.8 } },
  { id: 3, userId: 7, callsign: "LTAI_OBS", atcSession: { frequency: 199.998 }, lastTrack: null },
] } };

function memStore() { const m = new Map(); return { m,
  async get(k, o) { if (!m.has(k)) return null; const v = m.get(k); return o && o.type === "json" ? JSON.parse(v) : v; },
  async set(k, v) { m.set(k, String(v)); }, async setJSON(k, v) { m.set(k, JSON.stringify(v)); } }; }
function fakeFetch(fail = false) {
  const f = async (url) => { f.calls.push(url); if (fail) throw new Error("down");
    const body = url.includes("transceivers") ? TX : url.includes("vatsim") ? VATSIM : IVAO;
    return new Response(JSON.stringify(body), { status: 200 }); };
  f.calls = []; return f;
}
const req = (q) => new Request("https://x/.netlify/functions/atc-online" + q);
const env = { ATC_VATSIM_ENABLED: "true" };

test("tür çağrı adının son ekinden", () => {
  assert.equal(typeOf("LTFM_DEP"), "APP"); assert.equal(typeOf("LTFM_A_APP"), "APP"); assert.equal(typeOf("LTBB_CTR"), "CTR");
  assert.equal(typeOf("LTFM_ATIS"), "ATIS"); assert.equal(typeOf("LTAI_RMP"), null); assert.equal(typeOf("LTFM"), null);
});

test("VATSIM: OBS/SUP yok, kişisel veri yok, konumsuz istasyon listede ama konumsuz", () => {
  const { stations, updated } = parseVatsim(VATSIM, TX);
  assert.equal(updated, "2026-11-26T08:55:00.123Z");
  assert.deepEqual(stations.map((s) => s.cs), ["LTFM_TWR", "LTFM_DEP", "LTBB_CTR", "EDDF_GND", "LTFM_ATIS"]);
  const twr = stations[0];
  assert.deepEqual(twr, { cs: "LTFM_TWR", type: "TWR", freq: "118.100", lat: 41.2753, lon: 28.7519, atis: "" });
  assert.equal(stations[1].type, "APP");
  const gnd = stations.find((s) => s.cs === "EDDF_GND"); assert.equal(gnd.lat, null);
  const atis = stations.find((s) => s.type === "ATIS"); assert.equal(atis.atis.split("\n").length, 8);
  const txt = JSON.stringify(stations);
  for (const bad of ["John", "Jane", "1234567", "rating", "cid", "ask me"]) assert.ok(!txt.includes(bad), bad);
});

test("IVAO: frekans, konum, ATIS satırları; kişisel veri yok", () => {
  const { stations } = parseIvao(IVAO);
  assert.deepEqual(stations.map((s) => s.cs), ["LTAI_TWR", "LTAA_CTR"]);
  assert.equal(stations[0].freq, "118.600"); assert.equal(stations[0].atis, "LTAI_TWR\nInformation B\nRWY 36C");
  assert.ok(!JSON.stringify(stations).includes("555555"));
});

test("net doğrulama ve kapatma anahtarı", async () => {
  const s = memStore(), f = fakeFetch();
  assert.equal((await atcOnline(req("?net=foo"), s, { fetcher: f, env })).status, 400);
  assert.equal((await atcOnline(req(""), s, { fetcher: f, env })).status, 400);
  let r = await atcOnline(req("?net=vatsim"), s, { fetcher: f, env: { ATC_VATSIM_ENABLED: "false" } });
  assert.deepEqual(await r.json(), { net: "vatsim", disabled: true }); assert.equal(f.calls.length, 0);
  r = await atcOnline(req("?net=ivao&probe=1"), s, { fetcher: f, env: {} });
  assert.deepEqual(await r.json(), { net: "ivao", disabled: false }); assert.equal(f.calls.length, 0, "probe ağa gitmez");
  assert.equal(r.headers.get("netlify-cdn-cache-control"), "public, s-maxage=30, stale-while-revalidate=30");
  assert.equal(r.headers.get("cache-control"), "public, max-age=15");
});

test("ağa en fazla 30 sn'de bir gidilir; hata olursa son veri stale:true", async () => {
  const s = memStore(), f = fakeFetch(), T = 1_800_000_000_000, log = () => {};
  let j = await (await atcOnline(req("?net=vatsim"), s, { fetcher: f, now: T, env, log })).json();
  assert.equal(j.stale, false); assert.equal(j.stations.length, 5); assert.equal(f.calls.length, 2);
  await atcOnline(req("?net=vatsim"), s, { fetcher: f, now: T + 10_000, env, log });
  await atcOnline(req("?net=vatsim"), s, { fetcher: f, now: T + 29_000, env, log });
  assert.equal(f.calls.length, 2, "30 sn içinde ağa gidilmez");
  await atcOnline(req("?net=vatsim"), s, { fetcher: f, now: T + 31_000, env, log });
  assert.equal(f.calls.length, 4, "30 sn sonra yeniden");
  const down = fakeFetch(true);
  const r = await atcOnline(req("?net=vatsim"), s, { fetcher: down, now: T + 70_000, env, log });
  j = await r.json(); assert.equal(r.status, 200); assert.equal(j.stale, true); assert.equal(j.stations.length, 5);
  const r2 = await atcOnline(req("?net=ivao"), memStore(), { fetcher: down, now: T, env, log });
  assert.equal(r2.status, 502); assert.equal((await r2.json()).stale, true);
  assert.ok(!JSON.stringify([...s.m.values()]).includes("John"), "depoda da kişisel veri yok");
});
