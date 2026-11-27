/* Canlı harita: Online ATC katmanı (VATSIM / IVAO).
   Veri hep /.netlify/functions/atc-online üzerinden gelir (ağa doğrudan istek yok, 30 sn önbellek).
   CROSS-CHECK uçuşları ayrı katmanda ve her zaman ATC işaretlerinin üstünde durur. */
(function () {
  var NET = { vatsim: "VATSIM", ivao: "IVAO" };
  // Atıf metinleri: birebir, çevrilmez
  var ATTR = { vatsim: "VATSIM data used under license from VATSIM Inc.", ivao: "Data provided by IVAO · ivao.aero" };
  var COL = { DEL: "#3B82F6", GND: "#22C55E", TWR: "#EF4444", APP: "#F59E0B", CTR: "#A855F7", FSS: "#A855F7" };
  var ORDER = ["DEL", "GND", "TWR", "APP"];
  var NM = 1852;
  var TX = {
    tr: { off: "Kapalı", online: "ATC online", stale: "son veri", err: "veri alınamadı", loading: "yükleniyor…", atis: "ATIS",
      ago: function (s) { return s < 10 ? "az önce güncellendi" : (s < 90 ? s + " sn" : Math.round(s / 60) + " dk") + " önce güncellendi"; } },
    en: { off: "Off", online: "ATC online", stale: "last data", err: "data unavailable", loading: "loading…", atis: "ATIS",
      ago: function (s) { return s < 10 ? "updated just now" : "updated " + (s < 90 ? s + " s" : Math.round(s / 60) + " min") + " ago"; } }
  };
  function lang() { return document.documentElement.dataset.l === "en" ? "en" : "tr"; }
  function el(t, c, txt) { var e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; }

  window.ccAtc = function (map, attrEl) {
    map.createPane("atc");
    map.getPane("atc").style.zIndex = 350;            // rota/iz çizgileri (400) ve uçaklar (600) üstte kalır
    var layer = L.layerGroup().addTo(map), cur = "off", last = null, avail = { vatsim: true, ivao: true }, loading = false;
    try { cur = localStorage.getItem("cc_atc") || "off"; } catch (e) {}
    if (!NET[cur]) cur = "off";

    var ctl = L.control({ position: "topright" });
    ctl.onAdd = function () { var d = L.DomUtil.create("div", "atc-ctl"); d.setAttribute("role", "group"); d.setAttribute("aria-label", "Online ATC");
      L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; };
    ctl.addTo(map);
    var box = ctl.getContainer();
    var cnt = L.control({ position: "bottomleft" });
    cnt.onAdd = function () { var d = L.DomUtil.create("div", "atc-count"); d.hidden = true; d.setAttribute("aria-live", "polite"); return d; };
    cnt.addTo(map);
    var cbox = cnt.getContainer();

    function renderCtl() {
      box.textContent = "";
      box.appendChild(el("span", "atc-lab", "Online ATC:"));
      ["off", "vatsim", "ivao"].forEach(function (k) {
        if (k !== "off" && !avail[k]) return;
        var b = el("button", k === cur ? "on" : "", k === "off" ? TX[lang()].off : NET[k]);
        b.type = "button"; b.setAttribute("aria-pressed", k === cur);
        b.addEventListener("click", function () { if (k !== cur) set(k); });
        box.appendChild(b);
      });
      box.hidden = !avail.vatsim && !avail.ivao;
    }
    function set(k) {
      cur = k; last = null;
      try { localStorage.setItem("cc_atc", k); } catch (e) {}
      layer.clearLayers(); renderCtl(); renderCount(); renderAttr();
      if (k !== "off") load();
    }
    function renderAttr() {
      if (!attrEl) return;
      attrEl.hidden = cur === "off";
      attrEl.textContent = cur === "off" ? "" : ATTR[cur];
    }
    function renderCount() {
      var t = TX[lang()];
      if (cur === "off") { cbox.hidden = true; return; }
      cbox.hidden = false;
      if (!last) { cbox.textContent = NET[cur] + ": " + t.loading; return; }
      if (last.err) { cbox.textContent = NET[cur] + ": " + t.err; return; }
      var n = last.stations.filter(function (s) { return s.type !== "ATIS"; }).length;
      var ts = Date.parse(last.updated), age = isFinite(ts) ? Math.max(0, Math.round((Date.now() - ts) / 1000)) : null;
      cbox.textContent = NET[cur] + ": " + n + " " + t.online + (age != null ? " · " + t.ago(age) : "") + (last.stale ? " · " + t.stale : "");
      cbox.classList.toggle("is-stale", !!last.stale);
    }

    // ---- çizim ----
    function rows(list, atisSt) {
      var d = el("div", "atc-tip-in");
      list.forEach(function (s) {
        var r = el("div", "atc-row"), dot = el("i"); dot.style.background = COL[s.type] || "#999";
        r.appendChild(dot); r.appendChild(el("b", null, s.cs)); r.appendChild(el("span", "atc-t", s.type));
        if (s.freq) r.appendChild(el("span", "atc-f", s.freq));
        d.appendChild(r);
      });
      var atisLines = atisSt && atisSt.atis ? atisSt.atis : "";
      if (!atisLines) list.some(function (s) { if (s.atis) { atisLines = s.atis; return true; } });  // IVAO: ATIS istasyonun kendisinde
      if (atisSt || atisLines) {
        var a = el("div", "atc-atis");
        a.appendChild(el("b", null, TX[lang()].atis + (atisSt && atisSt.freq ? " " + atisSt.freq : "")));
        atisLines.split("\n").slice(0, 2).forEach(function (l) { a.appendChild(el("div", null, l.length > 160 ? l.slice(0, 157) + "…" : l)); });
        d.appendChild(a);
      }
      return d;
    }
    function bindInfo(layerObj, title, list, atisSt) {
      var make = function () { var w = el("div", "atc-tip"); if (title) w.appendChild(el("div", "atc-h", title)); w.appendChild(rows(list, atisSt)); return w; };
      layerObj.bindTooltip(make, { direction: "top", offset: [0, -6], className: "atc-tt", pane: "tooltipPane" });
      layerObj.bindPopup(make, { className: "atc-pop", autoPan: true });
    }
    function draw(j) {
      layer.clearLayers();
      var groups = {}, singles = [];
      j.stations.forEach(function (s) {
        if (s.type === "CTR" || s.type === "FSS") { singles.push(s); return; }
        var k = s.cs.split("_")[0];
        (groups[k] = groups[k] || []).push(s);
      });
      // CTR / FSS: mor nokta + soluk ~150 nm daire
      singles.forEach(function (s) {
        if (s.lat == null || s.lon == null) return;
        var ll = [s.lat, s.lon];
        L.circle(ll, { pane: "atc", radius: 150 * NM, color: COL.CTR, weight: 1, opacity: .35, fillOpacity: .04, dashArray: "4 6", interactive: false }).addTo(layer);
        var m = L.circleMarker(ll, { pane: "atc", radius: 5, color: "#fff", weight: 1.5, fillColor: COL.CTR, fillOpacity: 1 });
        bindInfo(m, null, [s], null); m.addTo(layer);
      });
      // Meydanlar: aynı meydandaki istasyonlar tek balonda
      Object.keys(groups).forEach(function (icao) {
        var g = groups[icao], atisSt = null, list = [];
        g.forEach(function (s) { if (s.type === "ATIS") atisSt = s; else list.push(s); });
        list.sort(function (a, b) { return ORDER.indexOf(a.type) - ORDER.indexOf(b.type); });
        var at = null;
        ["TWR", "APP", "GND", "DEL"].some(function (t) { return list.some(function (s) { if (s.type === t && s.lat != null) { at = s; return true; } }); });
        if (!at || !list.length) return;                // yalnız ATIS ya da konumsuz: haritaya konmaz
        var ll = [at.lat, at.lon], types = {};
        list.forEach(function (s) { types[s.type] = 1; });
        if (types.APP) L.circle(ll, { pane: "atc", radius: 40 * NM, color: COL.APP, weight: 1, opacity: .55, fillColor: COL.APP, fillOpacity: .07, interactive: false }).addTo(layer);
        var html = '<span class="atc-dots">' + ORDER.filter(function (t) { return types[t]; }).map(function (t) { return '<i style="background:' + COL[t] + '"></i>'; }).join("") + "</span>";
        var n = ORDER.filter(function (t) { return types[t]; }).length;
        var m = L.marker(ll, { pane: "atc", keyboard: false, icon: L.divIcon({ className: "atc-ap", html: html, iconSize: [n * 10 + 4, 12], iconAnchor: [(n * 10 + 4) / 2, 6] }) });
        bindInfo(m, icao, list, atisSt); m.addTo(layer);
      });
    }

    function load() {
      if (cur === "off" || document.hidden || loading) return;
      var k = cur; loading = true;
      fetch("/.netlify/functions/atc-online?net=" + k).then(function (r) { return r.json(); }).then(function (j) {
        loading = false;
        if (k !== cur) return;
        if (j && j.disabled) { avail[k] = false; set("off"); return; }
        if (!j || !Array.isArray(j.stations)) throw 0;
        last = j; draw(j); renderCount();
      }).catch(function () { loading = false; if (k !== cur) return; if (!last) last = { err: true }; else last.stale = true; renderCount(); });
    }

    // Kapatılmış ağlar seçenekten çıkar (probe ağa gitmez)
    ["vatsim", "ivao"].forEach(function (k) {
      fetch("/.netlify/functions/atc-online?probe=1&net=" + k).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.disabled) { avail[k] = false; if (cur === k) set("off"); else renderCtl(); }
      }).catch(function () {});
    });

    renderCtl(); renderAttr(); renderCount();
    if (cur !== "off") load();
    setInterval(load, 30000);
    setInterval(function () { if (cur !== "off" && last && !last.err) renderCount(); }, 10000);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    document.addEventListener("cc-lang", function () { renderCtl(); renderCount(); if (last && !last.err) draw(last); });
  };
})();
