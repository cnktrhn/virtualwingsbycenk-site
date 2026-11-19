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
    return fetch("/api/cc/recent?n=" + n).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(fresh);
  }

  window.ccRecent = { get: get, row: row, ranks: loadRanks, lang: lang, fresh: fresh };

  // Ana sayfa kutusu
  var box = document.getElementById("ccRecent");
  if (!box) return;
  var ol = box.querySelector(".rf-list"), N = Number(box.dataset.n) || 5;
  Promise.all([get(10), loadRanks()]).then(function (v) {
    var list = v[0], map = v[1];
    if (list.length < 3) return;          // boş görünmesin: son 30 günde 3'ten az uçuş varsa hiç gösterme
    ol.textContent = "";
    list.slice(0, N).forEach(function (f) { var li = el("li"); li.appendChild(row(f, map)); ol.appendChild(li); });
    box.hidden = false;
  }).catch(function () {});
})();
