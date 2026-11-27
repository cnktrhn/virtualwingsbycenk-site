// Canlı harita: Online ATC katmanı (VATSIM / IVAO)
// Ağlara söz: ağın verisi en fazla 30 saniyede bir çekilir; ziyaretçiler ağa değil bu fonksiyona gelir.
// Döndürülen veri sadedir: çağrı adı, tür, frekans, konum, ATIS metni. İsim, CID/VID, rating GÖNDERİLMEZ.

export const ATC_STORE = "cc-atc";
export const NETS = ["vatsim", "ivao"];
const FRESH_MS = 30 * 1000;            // bu süreden yeni veri varsa ağa gidilmez
const LOCK_MS = 30 * 1000;             // son denemeden (başarılı ya da hatalı) 30 sn geçmeden ağa tekrar gidilmez
const TIMEOUT_MS = 10 * 1000;
const UA = "VirtualWingsByCenk-LiveMap/1.0 (+https://virtualwingsbycenk.com/crosscheck/map/)";

export const SRC = {
  vatsim: { data: "https://data.vatsim.net/v3/vatsim-data.json", tx: "https://data.vatsim.net/v3/transceivers-data.json" },
  ivao: { data: "https://api.ivao.aero/v2/tracker/whazzup" },
};

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "public, max-age=15",
  "Netlify-CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
};
const out = (status, body) => new Response(JSON.stringify(body), { status, headers: HEADERS });

// Çağrı adının son ekinden tür: DEL, GND, TWR, APP (DEP de APP), CTR, FSS, ATIS. Diğerleri gösterilmez.
const TYPES = { DEL: "DEL", GND: "GND", TWR: "TWR", APP: "APP", DEP: "APP", CTR: "CTR", FSS: "FSS", ATIS: "ATIS" };
export function typeOf(cs) {
  const parts = String(cs || "").toUpperCase().split("_");
  return parts.length > 1 ? TYPES[parts[parts.length - 1]] || null : null;
}
const cleanCs = (cs) => String(cs || "").toUpperCase().replace(/[^A-Z0-9_\-]/g, "").slice(0, 16);
const coord = (v, lim) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim && v !== 0 ? Math.round(v * 1e4) / 1e4 : null);
function freqStr(f) {
  const n = typeof f === "number" ? f : parseFloat(f);
  if (!Number.isFinite(n) || n < 100 || n > 200) return "";
  if (n > 199.99) return "";                                    // 199.998: frekanssız (gözlemci/hazırlık)
  return n.toFixed(3);
}
function atisText(lines) {
  if (!Array.isArray(lines)) return "";
  // IVAO'nun ilk satırı sunucu adı (ör. "ts-1.eu-west-2.ivao.aero/LDDU_TWR"): gösterilmez
  return lines.filter((l) => typeof l === "string").map((l) => l.replace(/[\u0000-\u001f]/g, " ").trim())
    .filter((l) => l && !/^[\w.-]+\.ivao\.aero\//i.test(l))
    .slice(0, 8).join("\n").slice(0, 600);
}
const station = (cs, type, freq, lat, lon, atis) => ({ cs, type, freq, lat, lon, atis });

// ---------- VATSIM ----------
export function parseVatsim(data, tx) {
  const pos = new Map();
  if (Array.isArray(tx)) for (const t of tx) {
    const first = t && Array.isArray(t.transceivers) ? t.transceivers[0] : null;
    if (t && t.callsign && first) pos.set(String(t.callsign).toUpperCase(), [coord(first.latDeg, 90), coord(first.lonDeg, 180)]);
  }
  const list = [...(Array.isArray(data?.controllers) ? data.controllers : []), ...(Array.isArray(data?.atis) ? data.atis : [])];
  const seen = new Set(), stations = [];
  for (const c of list) {
    if (!c || c.facility === 0) continue;                                     // OBS
    const cs = cleanCs(c.callsign);
    if (!cs || /_(OBS|SUP)$/.test(cs) || seen.has(cs)) continue;
    const type = typeOf(cs);
    if (!type) continue;
    const freq = freqStr(c.frequency);
    if (!freq) continue;
    seen.add(cs);
    const [lat, lon] = pos.get(cs) || [null, null];
    // Kontrolör "info" metni kişisel bilgi içerebilir; yalnızca ATIS istasyonlarının metni gönderilir.
    stations.push(station(cs, type, freq, lat, lon, type === "ATIS" ? atisText(c.text_atis) : ""));
  }
  const ts = Date.parse(data?.general?.update_timestamp || "");
  return { stations, updated: Number.isFinite(ts) ? new Date(ts).toISOString() : null };
}

// ---------- IVAO ----------
export function parseIvao(data) {
  const list = Array.isArray(data?.clients?.atcs) ? data.clients.atcs : [];
  const seen = new Set(), stations = [];
  for (const c of list) {
    if (!c) continue;
    const cs = cleanCs(c.callsign);
    if (!cs || /_(OBS|SUP)$/.test(cs) || seen.has(cs)) continue;
    const type = typeOf(cs);
    if (!type) continue;
    const freq = freqStr(c.atcSession?.frequency);
    if (!freq && type !== "ATIS") continue;
    seen.add(cs);
    const lat = coord(c.lastTrack?.latitude, 90), lon = coord(c.lastTrack?.longitude, 180);
    stations.push(station(cs, type, freq, lat, lon, atisText(c.atis?.lines)));
  }
  const ts = Date.parse(data?.updatedAt || "");
  return { stations, updated: Number.isFinite(ts) ? new Date(ts).toISOString() : null };
}

async function getJSON(fetcher, url) {
  const r = await fetcher(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}
export async function fetchNet(net, fetcher = fetch) {
  if (net === "vatsim") {
    const [d, t] = await Promise.all([getJSON(fetcher, SRC.vatsim.data), getJSON(fetcher, SRC.vatsim.tx)]);
    return parseVatsim(d, t);
  }
  return parseIvao(await getJSON(fetcher, SRC.ivao.data));
}

export const enabled = (net, env = process.env) => String(env[net === "vatsim" ? "ATC_VATSIM_ENABLED" : "ATC_IVAO_ENABLED"] ?? "true").trim().toLowerCase() !== "false";

// GET /.netlify/functions/atc-online?net=vatsim|ivao   (&probe=1: yalnızca açık/kapalı bilgisi, ağa gitmez)
export async function atcOnline(req, store, { fetcher = fetch, now = Date.now(), env = process.env, log = console.log } = {}) {
  if (req.method !== "GET" && req.method !== "HEAD") return out(405, { error: "method" });
  const q = new URL(req.url).searchParams, net = q.get("net");
  if (!NETS.includes(net)) return out(400, { error: "net must be vatsim or ivao" });
  if (!enabled(net, env)) return out(200, { net, disabled: true });
  if (q.get("probe") === "1") return out(200, { net, disabled: false });

  const cached = await store.get(net, { type: "json" }).catch(() => null);
  const body = (c, stale) => ({ net, updated: c.data.updated || new Date(c.ts).toISOString(), stale, stations: c.data.stations });
  if (cached && now - cached.ts < FRESH_MS) return out(200, body(cached, false));
  // Kısa kilit: başka bir çağrı az önce ağa gittiyse eldeki veriyle dön
  const lock = Number(await store.get(net + ":lock", { type: "text" }).catch(() => 0));
  if (lock && now - lock < LOCK_MS) {
    // Son deneme 30 sn içinde (sürüyor ya da başarısız oldu): ağa tekrar gitme, eldekini dön
    return cached ? out(200, body(cached, now - cached.ts >= FRESH_MS + LOCK_MS)) : out(502, { net, updated: null, stale: true, stations: [] });
  }
  await store.set(net + ":lock", String(now)).catch(() => {});
  try {
    const data = await fetchNet(net, fetcher);
    log(`[atc-online] ${net}: ağdan çekildi, ${data.stations.length} istasyon`);
    const rec = { ts: now, data };
    await store.setJSON(net, rec);
    return out(200, body(rec, false));
  } catch (e) {
    log(`[atc-online] ${net}: ağ hatası (${e && e.message}) – ${cached ? "son veri" : "veri yok"}`);
    if (cached) return out(200, body(cached, true));
    return out(502, { net, updated: null, stale: true, stations: [] });
  }
}
