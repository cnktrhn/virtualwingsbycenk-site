/* Çıkış indirimi: 18 Kasım 00:00 – 3 Aralık 23:59 (TSİ). Bitince satır kendiliğinden gizlenir. */
(function(){var n=Date.now(),a=Date.parse("2026-11-18T00:00:00+03:00"),b=Date.parse("2026-12-04T00:00:00+03:00"),s=n>=a&&n<b;
document.querySelectorAll("[data-sale]").forEach(function(e){e.hidden=!s});
document.querySelectorAll("[data-nosale]").forEach(function(e){e.hidden=s});})();
