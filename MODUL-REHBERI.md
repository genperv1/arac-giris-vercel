# Modül Rehberi — Araç Giriş Sistemi

Bu dosya, projedeki modüllerin **ne işe yaradığını** ve **sorun çıktığında nereye bakılacağını** özetler.  
Son güncelleme: modülerleştirme tamamlandıktan sonra (Haziran 2026).

---

## Hızlı başvuru

| Sorun / ihtiyaç | İlk bakılacak yer |
|-----------------|-------------------|
| Giriş / oturum / JWT | `routes/auth-routes.js`, `lib/auth-session.js`, `user.js` |
| Araç kaydı, plaka, red | `routes/vehicles-routes.js`, `public/modules/app-vehicles.js` |
| Takip formu, yazdırma öncesi alanlar | `app-ui-forms-takip.js`, `app-ui-forms-pick.js`, `print-main.js` |
| Günlük Excel / ihracat | `app-excel-ihracat.js`, `app-ihracat-modal.js`, `dailyStore.js` |
| Piyasa Excel / sipariş seçimi | `piyasa-*.js` modülleri, `routes/piyasa-routes.js` |
| Raporlar, içerideki araç | `routes/reports-routes.js`, `public/rapor.html` |
| Plaka istatistikleri | `routes/plaka-stats-routes.js`, `public/plaka.html` |
| İmza (kantar / saha) | `routes/signatures-routes.js`, `app-signatures-prefs.js` |
| Canlı senkron (SSE) | `lib/sse.js`, `app-sync-handlers.js`, `sync-manager.js` |
| Veritabanı güvenliği (RLS) | `lib/supabase-security.js`, `scripts/check-rls.js` |
| API 401 / yetki | `lib/auth-session.js`, `server.js` middleware bloğu |

---

## Mimari özeti

```
Tarayıcı (GIRIS.html + modüller)
        ↕ fetch / SSE
server.js  ──→  routes/*.js  ──→  PostgreSQL (pg pool)
              ↘  lib/*.js
              ↘  user.js (JWT)
```

- **Frontend modülleri** çoğunlukla **global scope** paylaşır (IIFE yok, `window.*` kullanımı yaygın).  
  **`GIRIS.html` içindeki script sırası kritiktir** — sırayı değiştirmeden önce bağımlılıkları kontrol edin.
- **Backend route dosyaları** `registerXRoutes(api, routeCtx)` kalıbıyla `server.js`'e bağlanır.  
  Route içinde kullanılan yardımcılar `routeCtx` üzerinden gelir.

---

## Backend

### `server.js` (~2.000 satır)

Ana Express uygulaması. Hâlâ burada kalan başlıca parçalar:

| Bölüm | Açıklama |
|-------|----------|
| Pool / `q()` | PostgreSQL bağlantı havuzu ve sorgu sarmalayıcı |
| Middleware | CORS, helmet, compression, rate limit, JWT (`user.js`) |
| `routeCtx` | Tüm route modüllerine paylaşılan bağımlılık objesi |
| `/api/health`, `/api/heartbeat` | Sağlık kontrolü |
| `/api/kv/:key` | Genel anahtar-değer deposu |
| `/api/operation-notes` | Vardiya / operasyon notları |
| `/api/print_history` | Yazdırma geçmişi (print_history tablosu) |
| `/api/restore-full` | Tam JSON yedek geri yükleme |
| `/api/admin/*` | IP ban / unban |
| `/api/search` | Genel arama |
| `/api/export/db` | DB JSON export |
| `/api/settings/*` | Ayarlar parolası, ban API (JWT router dışı) |
| Statik dosyalar | `public/` servisi |

**Modüler route kayıtları** (sıra önemli değil, hepsi `api` router'a bağlanır):

```text
registerAuthRoutes
registerVehicleRoutes
registerDailyRoutes
registerPiyasaRoutes
registerProblemRoutes
registerReportsRoutes
registerPlakaStatsRoutes
registerSignaturesRoutes
registerSseRoutes(app)   ← SSE app seviyesinde
```

---

### `routes/` — API endpoint grupları

| Dosya | Endpoint örnekleri | Ne işe yarar |
|-------|-------------------|--------------|
| `auth-routes.js` | `POST /login`, `GET /me`, `POST /logout` | Kullanıcı girişi, oturum bilgisi |
| `vehicles-routes.js` | `GET/POST/PUT/DELETE /vehicles`, `lookup`, `reject` | Araç CRUD, plaka arama, red kayıtları |
| `daily-routes.js` | `GET/POST/DELETE /daily_rows` | Günlük Excel satırları (ihracat listesi) |
| `piyasa-routes.js` | `GET/POST /piyasa`, `/piyasa/durum-status`, `/piyasa/customers` | Piyasa state (kv_store), DURUM sayacı, müşteri listesi |
| `problems-routes.js` | `GET/POST/PUT/DELETE /problems` | Plaka / şoför sorun kayıtları |
| `reports-routes.js` | `GET/POST /reports`, `/icerideki-*`, `/stats/daily-shifts`, `/reports/count` | Rapor tablosu, çıkış işaretleme, vardiya istatistikleri |
| `plaka-stats-routes.js` | `/plaka-stats`, `/plaka-product-stats`, `/vehicle-edit-log` | Plaka yazdırma istatistikleri, düzenleme geçmişi |
| `signatures-routes.js` | `GET/POST/DELETE /signatures` | Kantar ve saha imza görselleri |

---

### `lib/` — Sunucu yardımcı kütüphaneleri

| Dosya | Ne işe yarar |
|-------|--------------|
| `auth-session.js` | `requireValidSession`, `requireAdmin`, `requireMutatingSession` middleware |
| `sanitize.js` | `sanitizeString`, TC/telefon/e-posta doğrulama, tarih parse |
| `env.js` | `envNumber` — ortam değişkeni sayı okuma |
| `plate-format.js` | TR / yabancı plaka format doğrulama (sunucu + test) |
| `plate-norm-sql.js` | Plaka normalizasyon SQL ifadeleri (`PLATE_NORM_SQL`) |
| `vehicle-helpers.js` | Araç sıralama, plaka norm, upsert, edit log |
| `report-format.js` | Rapor tarih/saat formatı (`formatReportInstant`, İstanbul TZ) |
| `sse.js` | Server-Sent Events: `broadcastEvent`, `registerSseRoutes` |
| `supabase-security.js` | RLS politikaları uygulama / `anon` yetkilerini kaldırma |
| `piyasa-server.js` | Piyasa DURUM meta, müşteri seed/sanitize (`createPiyasaServerApi`) |
| `signature-helpers.js` | `signatureRowToSrc` — DB imza satırını görsel URL/data'ya çevirir |

---

### `user.js`

JWT tabanlı kimlik doğrulama fabrikası:

- `authenticateUser`, `registerUser`
- `verifyToken` Express middleware
- `users` tablosunu oluşturur

`server.js` içinde: `const auth = require('./user')(q, { jwtSecret, expiresIn })`

---

## Frontend — Ana sayfa (`GIRIS.html`)

### Script yükleme sırası (değiştirmeyin)

```text
1.  core-dom.js, asset-version.js, asset-loader.js
2.  idb.js, dailyStore.js, report-events.js
3.  errorReporter.js, storage.js, session-manager.js, sync-manager.js
4.  network-banner.js, issues-sync-bus.js, operation-notes-alert.js
5.  rp-dialog.js, signatures-registry.js, ayarlar-gate.js, excel-utils.js
6.  app-modals.js
7.  app-sofor-history.js
8.  app-core.js                    ← state, listeler, eşleştirme
9.  app-excel-ihracat.js            ← günlük Excel / ihracat
10. app-shipment-ui.js             ← sevkiyat seçim, yedekleme
11. app-signatures-prefs.js        ← imza + kullanıcı tercihleri
12. app-ui-forms-pick.js           ← firma/malzeme/plaka Bul modalları
13. app-ui-forms-takip.js          ← takip formu, ana render()
14. app-ui-utils.js                ← toast, plaka format, WhatsApp
15. app-auth.js                    ← giriş ekranı, oturum
16. app-vehicles.js                ← araç CRUD
17. app-excel-review.js            ← Excel düzeltme penceresi
18. app-issues-core.js             ← plaka sorun kayıtları
19. app-ihracat-modal.js           ← ihracat detay modal, satır işlemleri
20. app-ihracat-print.js           ← ihracat yazdırma HTML
21. app-sync-handlers.js           ← SSE / sekme senkronu
22. excel-consistency.js, excel-ihracat-import.js
23. piyasa-core.js → orders → excel → customers → ui → api
```

**Not:** `app-ui-forms-pick.js`, `app-ui-forms-takip.js`'den **önce** yüklenmeli (`_openQuickPick` global).

---

### `public/modules/` — Uygulama modülleri

#### Genel / UI

| Modül | Ne işe yarar |
|-------|--------------|
| `app-modals.js` | Kalıcı onay modalı (`showConfirmModal`) |
| `app-core.js` | Uygulama state (`state`), araç listesi, firma/malzeme listeleri, eşleştirme storage |
| `app-ui-forms-pick.js` | Takip formunda **Bul**: firma, malzeme, plaka hızlı seçim (`_openQuickPick`, `_openPlatePick`) |
| `app-ui-forms-takip.js` | **Takip formu** (`showTakipFormu`), sıra sayısı, validasyon, firma/eşleştirme modal, ana `render()` |
| `app-ui-utils.js` | `showToast`, plaka/telefon formatlama, WhatsApp link, `closeAppToolsMenu` |
| `app-auth.js` | Login formu, oturum kontrolü, yedekleme menüsü |
| `app-sync-handlers.js` | SSE olayları, çoklu sekme senkronu |

#### Araçlar & Excel

| Modül | Ne işe yarar |
|-------|--------------|
| `app-vehicles.js` | Araç ekleme/düzenleme/silme, liste kartları |
| `app-excel-ihracat.js` | Günlük Excel yükleme, ihracat satır parse, `commitIhracatImport` |
| `app-excel-review.js` | Excel yükleme sonrası düzeltme penceresi |
| `app-shipment-ui.js` | Sevkiyat seçim UI, günlük veri yedekleme |
| `app-ihracat-modal.js` | İhracat detay tablosu, satır ekle/sil, ambalaj, kayıt et |
| `app-ihracat-print.js` | İhracat blokları yazdırma HTML üretimi |

#### İmza, şoför, sorunlar

| Modül | Ne işe yarar |
|-------|--------------|
| `app-signatures-prefs.js` | Kantar/saha imza seçimi, kayıtlı tercihler (`localStorage`) |
| `app-sofor-history.js` | Şoför geçmişi önerileri |
| `app-issues-core.js` | Plaka sorun kayıtları UI (sorunlar sayfası ile entegre) |

#### Yazdırma

| Modül | Ne işe yarar |
|-------|--------------|
| `print-main.js` | `window.Print` API — takip formu yazdırma (IIFE) |
| `print-ux-fit.js` | Yazdırma önizleme sığdırma, eşleştirme UX |

`asset-loader.js` yazdırma gerektiğinde `print-main.js` + `print-ux-fit.js` yükler.

#### Piyasa (7 parça, `window.state` paylaşımı)

> **Önemli:** Ayrı `<script>` dosyalarında `const state` **kullanılmaz** — `piyasa-globals.js` önce yüklenir ve `window.state` oluşturur.

| Modül | Ne işe yarar |
|-------|--------------|
| `piyasa-globals.js` | **İlk yükleme** — `window.state`, stub API (`piyasaShowOrdersModal`) |
| `piyasa-core.js` | localStorage/sync, sunucu push/pull |
| `piyasa-orders.js` | Sipariş eşleştirme, yazdırma sayacı, malzeme geçmişi |
| `piyasa-excel.js` | Excel import, satır parse, hafta/sheet seçimi |
| `piyasa-customers.js` | Müşteri listesi cache ve modal |
| `piyasa-ui.js` | Sipariş seçici modal, buton bind, `init` |
| `piyasa-api.js` | `window.piyasa.*` dış API, `window.piyasaShowOrdersModal`, `window.initPiyasaModule` |

Dışarıdan kullanılan API örnekleri: `window.piyasa.openOrderPicker`, `recordOrderPrint`, `hasOrders`.

#### Rapor olayları

| Modül | Ne işe yarar |
|-------|--------------|
| `report-events.js` | Rapor/yazdırma olay yardımcıları (birden fazla sayfa kullanır) |

---

### `public/` — Diğer önemli dosyalar (modül dışı)

| Dosya | Ne işe yarar |
|-------|--------------|
| `storage.js` | Araç verisini API'den okuma/yazma, cache (`_loaded`) |
| `session-manager.js` | Oturum süresi, expire modal |
| `sync-manager.js` | Periyodik sunucu senkronu |
| `dailyStore.js` | Günlük Excel meta + satırlar (localStorage/IDB) |
| `excel-utils.js` | Excel parse yardımcıları (tarayıcı) |
| `excel-ihracat-import.js` | İhracat import pipeline |
| `excel-consistency.js` | Excel tutarlılık kontrolleri |
| `signatures-registry.js` | İmza haritası önbelleği (`/api/signatures/map`) |
| `operation-notes-alert.js` | Vardiya notu uyarı banner |
| `ayarlar-gate.js` | Ayarlar sayfası parola kapısı |
| `asset-loader.js` | Lazy script yükleme (print vb.) |
| `app.js`, `print.js`, `piyasa.js` | **Stub loader** — asıl kod `modules/` altında |

---

### Diğer HTML sayfaları

| Sayfa | İlgili JS |
|-------|-----------|
| `rapor.html` | `report.js` |
| `gunlukraporlar.html` | Günlük rapor görünümü |
| `advanced_reports.html` | Gelişmiş raporlar |
| `plaka.html` | Plaka istatistikleri UI |
| `sorunlar.html` | Sorun kayıtları listesi |
| `ayarlar.html` | `ayarlar.js` — sistem ayarları |
| `vardiya-notlari.html` | Operasyon notları |
| `driver-card.html` | Şoför kartı görünümü |

---

## Scripts (`scripts/`)

| Script | Komut | Ne işe yarar |
|--------|-------|--------------|
| `check-rls.js` | `npm run security:check-rls` | Tüm tablolarda RLS açık mı kontrol |
| `apply-supabase-security.js` | `npm run security:apply` | RLS politikalarını uygula |
| `split-large-files.js` | `npm run modularize:split` | Eski app/print bölme (tekrar çalıştırırken dikkat) |
| `extract-server-routes.js` | `npm run modularize:routes` | server route çıkarma |
| `modularize-remaining.js` | `npm run modularize:remaining` | Kalan büyük dosya bölme + HTML güncelleme |
| `import-piyasa-customers.js` | (manuel) | Piyasa müşteri listesi import |
| `seed-piyasa-customers.js` | (manuel) | Seed JSON'dan müşteri yükleme |
| `write-asset-version.js` | `npm run build` | Cache bust versiyonu yazar |

---

## Test (`test/`)

| Dosya | Ne test eder |
|-------|--------------|
| `auth-session.test.js` | Oturum middleware |
| `integration-api.test.js` | `/api/health`, `/api/heartbeat` |
| `deps.test.js` | Bağımlılık ve modül dosya varlığı |
| `plate-format.test.js` | Plaka formatı |
| `excel-utils.test.js` | Excel yardımcıları |
| `storage-boot.test.js` | Storage cache davranışı |

```bash
npm test
```

---

## Güvenlik özeti

| Katman | Dosya / mekanizma |
|--------|-------------------|
| JWT + cookie | `user.js`, `lib/auth-session.js` |
| Mutating istekler | `requireValidSession`, `requireAdmin` |
| Input sanitize | `lib/sanitize.js` |
| DB RLS | `lib/supabase-security.js`, `scripts/supabase-security-fix.sql` |
| Rate limit / IP ban | `server.js` |

---

## Sorun giderme ipuçları

1. **`X is not defined` (tarayıcı)**  
   → `GIRIS.html` script sırasını kontrol edin; eksik modül veya yanlış sıra.

2. **API 401 / oturum düştü**  
   → `session-manager.js`, `app-auth.js`, `lib/auth-session.js`.

3. **Takip formu Bul çalışmıyor**  
   → `app-ui-forms-pick.js` yüklü mü ve takip'ten önce mi?

4. **Piyasa sipariş listesi boş**  
   → `piyasa-core.js` (sync), `routes/piyasa-routes.js`, `kv_store` key: `piyasa_state_v1`.

5. **Yazdırma boş / layout bozuk**  
   → `print-main.js`, `print-ux-fit.js`, `asset-loader.js`.

6. **Canlı güncelleme gelmiyor**  
   → `lib/sse.js`, `app-sync-handlers.js`, tarayıcı EventSource.

7. **RLS / yetki hatası (DB)**  
   → `npm run security:check-rls`, `npm run security:apply`.

8. **Değişiklik görünmüyor**  
   → `npm start` yeniden başlat, tarayıcıda **Ctrl+F5** (cache).

---

## Veritabanı tabloları (kısa)

| Tablo | Kullanım |
|-------|----------|
| `vehicles` | Araç kartları |
| `daily_rows` | Günlük Excel satırları |
| `print_history` | Yazdırma geçmişi (sıra sayısı, istatistik) |
| `report` | Rapor / çıkış takibi |
| `problems` | Sorun kayıtları |
| `kv_store` | Piyasa state, müşteri listesi, genel KV |
| `signatures` | İmza görselleri |
| `operation_notes` | Vardiya notları |
| `vehicle_edit_log` | Araç düzenleme geçmişi |
| `events` | SSE / olay log (opsiyonel) |
| `users` | Giriş kullanıcıları |

---

*Bu rehber modülerleştirme sonrası oluşturulmuştur. Yeni modül eklediğinizde bu dosyayı da güncelleyin.*
