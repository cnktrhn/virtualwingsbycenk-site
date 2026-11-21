// CROSS-CHECK lisans işareti (yalnızca admin görür, yalnızca bilgi amaçlı).
// Program (Winter Update) /position, /profile ve /flight isteklerine "lic" alanında /api/cc/license'ın verdiği
// imzalı bileti ekler: base64url(json).base64url(imza), ECDSA P-256 / SHA-256, json = { kh, m, iat, exp }.
// Bilet SAKLANMAZ; yalnızca sonuç (licStatus) ve kısa ipucu (licHint) saklanır. İstek "lic" yüzünden asla reddedilmez.
import crypto from "node:crypto";
import { KEY_HASHES } from "../functions/cc-license/cc-license-keys.mjs";

export const LIC_STORE = "cc-license";     // lisans fonksiyonunun deposu (iptal bayrağı için okunur, yazılmaz)
const RECHECK_MS = 15 * 60 * 1000;          // aynı bilet 15 dakikada bir yeniden denetlenir (konum her 30 sn gelir)

// Genel anahtar, lisans fonksiyonunun özel anahtarından türetilir (yeni gizli bilgi gerekmez).
let _pub;
function pubKey() {
  if (_pub !== undefined) return _pub;
  try {
    const raw = String(process.env.CC_LICENSE_PRIVATE_KEY || "");
    if (!raw.trim()) return (_pub = null);
    const body = raw.replace(/\\n/g, "\n").replace(/-----(BEGIN|END)[^-]*-----/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
    const pem = "-----BEGIN PRIVATE KEY-----\n" + body.match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n";
    _pub = crypto.createPublicKey(crypto.createPrivateKey(pem));
  } catch { _pub = null; }
  return _pub;
}
export function _resetKeyForTests() { _pub = undefined; }

// Bilet içindeki kh = seri özetinin ilk 16 hex karakteri → tam özet (lisans deposunun anahtarı)
let _kh;
function fullHash(kh) {
  if (!_kh) { _kh = new Map(); for (const h of KEY_HASHES) _kh.set(h.slice(0, 16), h); }
  return _kh.get(kh);
}

const b64 = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
export const licSig = (lic) => crypto.createHash("sha256").update(String(lic)).digest("hex").slice(0, 16);

// Sonuç: { licStatus, licHint? } ya da null (sunucuda anahtar yoksa: hiçbir şey yazılmaz)
export async function checkLic(lic, lstore) {
  if (lic === undefined || lic === null || lic === "") return { licStatus: "none" };
  if (typeof lic !== "string" || lic.length > 2048) return { licStatus: "invalid" };
  const key = pubKey();
  if (!key) return null;
  const parts = lic.split(".");
  if (parts.length !== 2) return { licStatus: "invalid" };
  let payload, p;
  try {
    payload = b64(parts[0]);
    const okSig = crypto.verify("sha256", payload, { key, dsaEncoding: "ieee-p1363" }, b64(parts[1]));
    if (!okSig) return { licStatus: "invalid" };
    p = JSON.parse(payload.toString("utf8"));
  } catch { return { licStatus: "invalid" }; }
  if (!p || typeof p.kh !== "string") return { licStatus: "invalid" };
  if (p.kh === "trial") return { licStatus: "trial" };
  const h = fullHash(p.kh);
  if (!h) return { licStatus: "invalid" };                 // imza geçerli ama CROSS-CHECK listesinde yok
  if (lstore) {
    const rec = await lstore.get(h, { type: "json" }).catch(() => null);
    if (rec && rec.revoked) return { licStatus: "revoked" };
  }
  // Seri sunucuda saklanmaz, yalnızca özeti var. Bilet "p" (seri 2. grubu, 4 karakter) taşırsa o gösterilir;
  // taşımazsa özetin ilk 4 karakteri "#" ile gösterilir (admin kendi listesinden eşleştirebilir).
  const hint = typeof p.p === "string" && /^[0-9A-Z]{4}$/.test(p.p) ? p.p : "#" + p.kh.slice(0, 4);
  return { licStatus: "licensed", licHint: hint };
}

// /position için: aynı bilet son 15 dakikada denetlendiyse önceki sonucu kullan (her 30 sn depo okumasın).
export async function liveLic(o, prev, lstore, now) {
  const lic = o.lic;
  if (lic === undefined || lic === null || lic === "") return { licStatus: "none" };
  const sig = typeof lic === "string" ? licSig(lic) : "x";
  if (prev && prev._licSig === sig && typeof prev._licAt === "number" && now - prev._licAt < RECHECK_MS && prev.licStatus)
    return { licStatus: prev.licStatus, licHint: prev.licHint, _licSig: sig, _licAt: prev._licAt };
  const r = await checkLic(lic, lstore).catch(() => null);
  return r ? { ...r, _licSig: sig, _licAt: now } : null;
}

// Admin: ?admin=1 + "x-cc-admin: <CC_ADMIN_TOKEN>" başlığı
export function isAdmin(req) {
  const want = String(process.env.CC_ADMIN_TOKEN || "");
  const got = String(req.headers.get("x-cc-admin") || "");
  if (!want || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const wantsAdmin = (req) => new URL(req.url).searchParams.get("admin") === "1";
