/* CROSS-CHECK — Son uçuşlar / Latest flights
   GET /api/cc/recent?n=… verisini satırlara çevirir.
   Ana sayfada #ccRecent kutusunu doldurur (son 30 günde 3'ten az uçuş varsa kutu gizli kalır).
   Harita sayfası window.ccRecent yardımcılarını kullanır. */
(function () {
  var DAY = 86400;
  var TXT = {
    tr: { h: "s", m: "dk", butter: "butter", ago: "önce", now: "az önce", pilot: "Pilot sayfası" },
    en: { h: "h", m: "m", butter: "butter", ago: "ago", now: "just now", pilot: "Pilot page" }
  };
  function lang() {
    var d = document.documentElement;
    var l = d.dataset.l || d.lang || "tr";
    return l.slice(0, 2) === "en" ? "en" : "tr";
  }
  var ranks = null;
  function loadRanks() {
    if (!ranks) ranks = fetch("/crosscheck/rozetler.json").then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; }).then(function (j) {
        var m = {}, list = (j && (j.ranks || j.rutbeler)) || [];
        if (Array.isArray(list)) list.forEach(function (r) { if (r && r.id) m[r.id] = r; });
        return m;
      });
    return ranks;
  }
  function rankName(id, map) {
    if (!id) return "";
    var r = map && map[id], l = lang();
    if (r) return r["name_" + l] || r[l] || r.name || id;
    return id.replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function block(min) {
    if (typeof min !== "number") return "";
    var t = TXT[lang()], h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? h + t.h + " " + m + t.m : m + t.m;
  }
  function ago(ts) {
    var s = Math.max(0, Math.floor(Date.now() / 1000) - ts), l = lang();
    if (s < 60) return TXT[l].now;
    var rtf = window.Intl && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(l === "en" ? "en" : "tr", { numeric: "always" }) : null;
    var v, u;
    if (s < 3600) { v = Math.floor(s / 60); u = "minute"; }
    else if (s < DAY) { v = Math.floor(s / 3600); u = "hour"; }
    else { v = Math.floor(s / DAY); u = "day"; }
    return rtf ? rtf.format(-v, u) : v + " " + u + " " + TXT[l].ago;
  }
  function fresh(list) {
    var cut = Math.floor(Date.now() / 1000) - 30 * DAY;
    return (Array.isArray(list) ? list : []).filter(function (f) { return f && typeof f.ts === "number" && f.ts >= cut; });
  }
  function el(t, c, txt) { var e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; }
  function sep(p) { p.appendChild(el("span", "rf-dot", "·")); }

  // Tek satır: VWG123 · LTFM → LTAI · A321 · 1s 35dk · 142 fpm · A · Cenk (Captain) · 2 saat önce
  function row(f, map, opt) {
    opt = opt || {};
    var r = el(opt.tag || "a", "rf-row");
    if (r.tagName === "A" && f.pilotId) r.href = "/crosscheck/pilot/?id=" + encodeURIComponent(f.pilotId);
    var top = el("span", "rf-top"), sub = el("span", "rf-sub");
    var parts = [];
    if (f.flight) parts.push(el("b", "rf-fl", f.flight));
    if (f.dep || f.arr) parts.push(el("span", "rf-rt", (f.dep || "?") + " → " + (f.arr || "?")));
    parts.forEach(function (p, i) { if (i) sep(top); top.appendChild(p); });
    var lb = f.licStatus ? licBadge(f.licStatus, f.licHint) : null;
    if (lb) top.appendChild(lb);
    if (f.grade) top.appendChild(el("span", "rf-grade", f.grade));
    var s = [];
    if (f.aircraft) s.push(el("span", null, f.aircraft));
    if (typeof f.blockMin === "number") s.push(el("span", null, block(f.blockMin)));
    if (typeof f.fpm === "number") {
      var c = f.fpm < 100 ? "is-butter" : f.fpm > 500 ? "is-hard" : "";
      var b = el("span", "rf-fpm " + c, f.fpm + " fpm");
      if (f.fpm < 100) b.appendChild(el("i", null, " · " + TXT[lang()].butter));
      s.push(b);
    }
    var who = f.name || "Pilot", rk = rankName(f.rank, map);
    if (opt.pilotLink && f.pilotId) {
      var a = el("a", "rf-who", rk ? who + " (" + rk + ")" : who);
      a.href = "/crosscheck/pilot/?id=" + encodeURIComponent(f.pilotId);
      a.title = TXT[lang()].pilot;
      a.addEventListener("click", function (e) { e.stopPropagation(); });
      s.push(a);
    } else s.push(el("span", "rf-who", rk ? who + " (" + rk + ")" : who));
    s.push(el("span", "rf-ago", ago(f.ts)));
    s.forEach(function (p, i) { if (i) sep(sub); sub.appendChild(p); });
    r.appendChild(top); r.appendChild(sub);
    return r;
  }
  function get(n) {
    // Admin görünümü (yalnızca harita sayfası, #admin=… ile): lisans işaretleri de gelir; önbelleğe alınmaz.
    var a = window.ccAdmin;
    var req = a ? fetch("/api/cc/recent?admin=1&n=" + n, { cache: "no-store", headers: { "x-cc-admin": a } }) : fetch("/api/cc/recent?n=" + n);
    return req.then(function (r) { if (!r.ok) throw r.status; return r.json(); }).then(fresh);
  }
  // Lisans rozeti (yalnızca admin yanıtlarında licStatus olur)
  var LIC = { licensed: ["LİSANSLI", "ok"], trial: ["DENEME", "trial"], revoked: ["İPTAL", "bad"], invalid: ["DOĞRULANAMADI", "bad"], none: ["ESKİ SÜRÜM", "old"] };
  function licBadge(st, hint) {
    var d = LIC[st]; if (!d) return null;
    var b = el("span", "lic-b is-" + d[1], d[0] + (st === "licensed" && hint ? " · " + hint : ""));
    b.title = "Lisans durumu (yalnızca admin görür)"; return b;
  }

  // ---------- Uçuş özeti (satıra tıklayınca açılır). Ceza ayrıntısı yok; eski kayıtlarda olmayan satırlar gizli. ----------
  var S = {
    tr: { land: "İniş", block: "Blok", air: "Havada", dist: "Mesafe", svc: "Kabin servisi", done: "tamamlandı", pa: "anons", paL: "Anons",
      cats: { sop: "Prosedür (SOP)", cabin: "Kabin", air: "Pilotaj", comfort: "Konfor" }, score: "Uçuş puanı", pilot: "Pilot sayfası →" },
    en: { land: "Landing", block: "Block", air: "Airborne", dist: "Distance", svc: "Cabin service", done: "complete", pa: "announcements", paL: "PA", pa1: "announcement",
      cats: { sop: "Procedures (SOP)", cabin: "Cabin", air: "Airmanship", comfort: "Comfort" }, score: "Flight score", pilot: "Pilot page →" }
  };
  function landLabel(fpm) {
    return fpm < 100 ? ["BUTTER", "butter"] : fpm < 250 ? ["SMOOTH", "smooth"] : fpm < 400 ? ["FIRM", "firm"] : fpm < 600 ? ["HARD", "hard"] : ["VERY HARD", "vhard"];
  }
  function pct(v, l) { return l === "tr" ? "%" + v : v + "%"; }
  function bar(label, v, l, suffix) {
    var w = el("div", "rs-bar"), top = el("div", "rs-bar-top");
    top.appendChild(el("span", null, label)); top.appendChild(el("b", null, pct(v, l) + (suffix ? " " + suffix : "")));
    var t = el("div", "rs-track"), fill = el("i"); fill.style.width = Math.max(0, Math.min(100, v)) + "%";
    t.appendChild(fill); w.appendChild(top); w.appendChild(t); return w;
  }
  function stat(label, value) { var d = el("div", "rs-stat"); d.appendChild(el("span", null, label)); d.appendChild(el("b", null, value)); return d; }
  function summary(f) {
    var l = lang(), t = S[l], box = el("div", "rf-sum");
    var head = el("div", "rs-head");
    if (typeof f.score === "number" || f.grade) {
      var sc = el("div", "rs-score");
      sc.appendChild(el("span", "rs-lab", t.score));
      var big = el("b", null, typeof f.score === "number" ? pct(f.score, l) : "");
      if (f.grade) { if (typeof f.score === "number") big.appendChild(el("i", "rs-sep", " · ")); big.appendChild(el("em", "rs-grade", f.grade)); }
      sc.appendChild(big); head.appendChild(sc);
    }
    if (typeof f.fpm === "number") {
      var ld = el("div", "rs-land"), lab = landLabel(f.fpm);
      ld.appendChild(el("span", "rs-lab", t.land));
      ld.appendChild(el("b", null, "-" + f.fpm + " fpm" + (typeof f.g === "number" ? " · " + f.g.toFixed(2) + " G" : "")));
      ld.appendChild(el("em", "rs-tag is-" + lab[1], lab[0]));
      head.appendChild(ld);
    }
    if (head.childNodes.length) box.appendChild(head);
    var st = el("div", "rs-stats");
    if (typeof f.blockMin === "number") st.appendChild(stat(t.block, block(f.blockMin)));
    if (typeof f.airMin === "number") st.appendChild(stat(t.air, block(f.airMin)));
    if (typeof f.distNm === "number") st.appendChild(stat(t.dist, f.distNm + " nm"));
    if (typeof f.pas === "number") st.appendChild(stat(t.paL, f.pas + " " + (f.pas === 1 && t.pa1 ? t.pa1 : t.pa)));
    if (st.childNodes.length) box.appendChild(st);
    var bars = el("div", "rs-bars");
    if (typeof f.service === "number") bars.appendChild(bar(t.svc, f.service, l, t.done));
    var c = f.cats && typeof f.cats === "object" ? f.cats : {};
    ["sop", "cabin", "air", "comfort"].forEach(function (k) { if (typeof c[k] === "number") bars.appendChild(bar(t.cats[k], c[k], l)); });
    if (bars.childNodes.length) box.appendChild(bars);
    if (f.pilotId) {
      var a = el("a", "rs-pilot", t.pilot); a.href = "/crosscheck/pilot/?id=" + encodeURIComponent(f.pilotId);
      a.addEventListener("click", function (e) { e.stopPropagation(); }); box.appendChild(a);
    }
    box.addEventListener("click", function (e) { e.stopPropagation(); });
    return box;
  }
  // Satırı aç/kapa düğmesine çevirir; onToggle(açık mı) harita gibi ek davranışlar için
  function toggleRow(r, f, onToggle) {
    r.tabIndex = 0; r.setAttribute("role", "button"); r.setAttribute("aria-expanded", "false");
    function go() {
      var li = r.parentNode, open = r.getAttribute("aria-expanded") !== "true";
      var list = li && li.parentNode;
      if (list) list.querySelectorAll(".rf-row[aria-expanded=true]").forEach(function (o) { if (o !== r) close(o); });
      if (open) { li.appendChild(summary(f)); r.setAttribute("aria-expanded", "true"); r.classList.add("open"); }
      else close(r);
      if (onToggle) onToggle(open);
    }
    function close(o) { o.setAttribute("aria-expanded", "false"); o.classList.remove("open"); var s = o.parentNode && o.parentNode.querySelector(".rf-sum"); if (s) s.remove(); }
    r.addEventListener("click", go);
    r.addEventListener("keydown", function (e) { if (e.target === r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(); } });
  }

  window.ccRecent = { get: get, row: row, ranks: loadRanks, lang: lang, fresh: fresh, summary: summary, toggleRow: toggleRow, licBadge: licBadge };

  // Ana sayfa kutusu
  var box = document.getElementById("ccRecent");
  if (!box) return;
  var ol = box.querySelector(".rf-list"), N = Number(box.dataset.n) || 5;
  Promise.all([get(10), loadRanks()]).then(function (v) {
    var list = v[0], map = v[1];
    if (list.length < 3) return;          // boş görünmesin: son 30 günde 3'ten az uçuş varsa hiç gösterme
    ol.textContent = "";
    list.slice(0, N).forEach(function (f) {
      var li = el("li"), r = row(f, map, { tag: "div", pilotLink: true });
      li.appendChild(r); ol.appendChild(li); toggleRow(r, f);
    });
    box.hidden = false;
  }).catch(function () {});
})();
