// CROSS-CHECK lisans sunucusu (Netlify Function) – POST /api/cc/license
// op: "activate" | "check" | "release" (program) · "admin" (tools/license_admin.py, CC_ADMIN_TOKEN ile)
// Ortam değişkenleri (Netlify → Site configuration → Environment variables):
//   CC_LICENSE_PRIVATE_KEY  : imza anahtarı (PEM, cc_license_private_pk8.pem dosyasının tamamı)   – GİZLİ
//   CC_ADMIN_TOKEN          : yönetim parolası (uzun rastgele metin)                               – GİZLİ
// Veri: Netlify Blobs "cc-license" deposu – anahtar = seri özeti, değer = { machines:[{m,pc,first,last}], revoked }
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { KEY_HASHES } from "./cc-license-keys.mjs";

const PEPPER = "df6af5711259948f4a5b25210ffc64e6";   // License.cs ve tools/keygen.py ile AYNI
const MAX_MACHINES = 2;
const TICKET_DAYS = 30;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hashKey = (key) => crypto.createHash("sha256").update(`${PEPPER}|${key}`).digest("hex");
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Anahtar Netlify kutusuna yapıştırılırken satır sonları kaybolabiliyor (boşluk ya da "\n" yazısına dönüşüyor).
// Burada PEM'i her durumda yeniden kuruyoruz; tek satırlık base64 gövde de kabul ediliyor.
let _key = null;
function privKey() {
  if (_key) return _key;
  const raw = String(process.env.CC_LICENSE_PRIVATE_KEY || "");
  if (!raw.trim()) throw new Error("nokey");
  const body = raw.replace(/\\n/g, "\n").replace(/-----(BEGIN|END)[^-]*-----/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  const pem = "-----BEGIN PRIVATE KEY-----\n" + body.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
  _key = crypto.createPrivateKey(pem);
  return _key;
}

function ticket(h, m) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ kh: h.slice(0, 16), m, iat, exp: iat + TICKET_DAYS * 86400 }));
  const sig = crypto.sign("sha256", payload, { key: privKey(), dsaEncoding: "ieee-p1363" });
  return b64url(payload) + "." + b64url(sig);
}

export default async (req) => {
  try { return await handle(req); }
  catch (e) {
    const msg = String(e && e.message || e);
    const code = msg === "nokey" ? "server_nokey" : /key|decoder|PEM|asn1/i.test(msg) ? "server_key" : /blob|store/i.test(msg) ? "server_store" : "server";
    console.error("cc-license:", msg);
    return json({ ok: false, error: code }, 500);
  }
};

async function handle(req) {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad" }, 400); }
  if (b.op === "health") {
    const r = { ok: true, key: false, store: false, admin: !!process.env.CC_ADMIN_TOKEN };
    try { crypto.sign("sha256", Buffer.from("x"), { key: privKey(), dsaEncoding: "ieee-p1363" }); r.key = true; } catch (e) { r.keyErr = String(e.message).slice(0, 80); }
    try { await getStore("cc-license").get("health-probe"); r.store = true; } catch (e) { r.storeErr = String(e.message).slice(0, 80); }
    return json(r);
  }
  const store = getStore("cc-license");

  // ---- yönetim (Cenk): list / revoke / unrevoke / reset
  if (b.op === "admin") {
    if (!process.env.CC_ADMIN_TOKEN || b.token !== process.env.CC_ADMIN_TOKEN) return json({ ok: false, error: "auth" }, 403);
    const h = b.key ? hashKey(String(b.key).toUpperCase()) : String(b.hash || "");
    if (!KEY_HASHES.has(h)) return json({ ok: false, error: "invalid" });
    const rec = (await store.get(h, { type: "json" })) || { machines: [] };
    if (b.action === "revoke") rec.revoked = true;
    else if (b.action === "unrevoke") rec.revoked = false;
    else if (b.action === "reset") rec.machines = [];
    if (b.action !== "list") await store.setJSON(h, rec);
    return json({ ok: true, record: rec });
  }

  // ---- 1 ücretsiz deneme uçuşu (Cenk 10.11): bilgisayar başına bir kez; 48 saat içinde aynı bilgisayara bilet tekrar verilir
  if (b.op === "trial") {
    const tm = String(b.machine || "").slice(0, 32);
    if (!/^[0-9a-f]{8,32}$/.test(tm)) return json({ ok: false, error: "invalid" });
    const tk = "trial-" + tm;
    const t = (await store.get(tk, { type: "json" })) || { first: Date.now(), pc: String(b.pc || "").slice(0, 40) };
    if (Date.now() - t.first > 48 * 3600 * 1000) return json({ ok: false, error: "trial_used" });
    await store.setJSON(tk, t);
    const iat = Math.floor(Date.now() / 1000), exp = Math.floor(t.first / 1000) + 48 * 3600;
    const payload = Buffer.from(JSON.stringify({ kh: "trial", m: tm, iat, exp }));
    const sig = crypto.sign("sha256", payload, { key: privKey(), dsaEncoding: "ieee-p1363" });
    return json({ ok: true, token: b64url(payload) + "." + b64url(sig) });
  }

  const key = String(b.key || "").toUpperCase(), m = String(b.machine || "").slice(0, 32), pc = String(b.pc || "").slice(0, 40);
  if (!/^VWCC-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(key) || !/^[0-9a-f]{8,32}$/.test(m)) return json({ ok: false, error: "invalid" });
  const h = hashKey(key);
  if (!KEY_HASHES.has(h)) return json({ ok: false, error: "invalid" });
  const rec = (await store.get(h, { type: "json" })) || { machines: [] };
  if (rec.revoked) return json({ ok: false, error: "revoked" });
  const now = new Date().toISOString();
  const i = rec.machines.findIndex((x) => x.m === m);

  if (b.op === "release") {
    if (i >= 0) { rec.machines.splice(i, 1); await store.setJSON(h, rec); }
    return json({ ok: true, machines: rec.machines.length });
  }
  if (b.op === "activate" || b.op === "check") {
    if (i >= 0) rec.machines[i].last = now;
    else if (rec.machines.length >= MAX_MACHINES) return json({ ok: false, error: "limit", machines: rec.machines.length });
    else rec.machines.push({ m, pc, first: now, last: now });
    await store.setJSON(h, rec);
    return json({ ok: true, token: ticket(h, m), machines: rec.machines.length });
  }
  return json({ ok: false, error: "op" }, 400);
}

export const config = { path: "/api/cc/license" };
