# virtualwingsbycenk.com

- `public/` — sitenin kendisi (Netlify bunu yayınlar)
- `netlify/functions/` — CrossCheck canlı harita API'si (`/api/cc/*`)
- `netlify/lib/cc.mjs` — API'nin ortak kodu (sözleşme v1, bölüm 3)
- `test/` — API testleri: `npm install && node --test test/cc.test.mjs`

Netlify, bu depo her güncellendiğinde siteyi otomatik yayınlar (her yayın 15 kredi).
Değişiklikleri biriktirip tek seferde yükle.

CrossCheck yeni sürüm: `public/crosscheck/version.json` içinde `latest`, `notes_tr`, `notes_en` alanlarını değiştir.
Rütbe/rozet adları: `public/crosscheck/rozetler.json`, rozet resimleri: `public/crosscheck/badges/<id>.png`.
