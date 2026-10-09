# Oturum ve veri erişimi test notu

Araç giriş sistemi · 9 Ekim 2026

Bu not bir “güvenli” belgesi değildir. Kod incelemesi ve yerel birim testlerinin sonucudur. Canlı sunucuya istek atılmadı. Saldırı adımı yoktur.

## Ne çalıştı

`auth-session`, `sse-auth`, `env-secrets`, `session-renew` ve `liman-routes` testleri: 39 testten 38’i geçti, 1’i kaldı.

Geçenler:

- Oturum çerezi yoksa korumalı işlem 401 döner.
- Geçerli oturum kabul edilir. Admin ve amir ayrımı duruyor.
- Canlı akış (`events-stream`, `reports-stream`) oturum ister.
- Kantar limana yazamaz; oturum yoksa 401 olur.
- Cihaz çerezi ile sessiz yenileme, çerez yoksa veya IP bağlanırsa 401 olur.
- Şoför listesi okunurken düz şifre alandan çıkarılır.

Kalan test güvenlik deliği göstermiyor. `autoRefreshTick` artık parametre aldığı için testin aradığı yazım eşleşmedi. Fonksiyonun içinde oturum kontrolü duruyor.

## Yüksek

1. **Okuma uçları giriş istemiyor.** Yazma işlemleri oturum ister. Aşağıdaki okumalar istemez. Dönen kayıtta şoför adı, telefon ve T.C. kimlik bulunabilir. Araç listesi kaydın tamamını olduğu gibi verir.

   - Araç listesi, plaka arama ve tek araç
   - Yazdırma geçmişi (`/reports` ve tarih sorguları)
   - Günlük satırlar
   - İmza listesi ve imza görseli
   - Plaka istatistikleri, düzenleme günlüğü, pasif şoförler
   - Piyasa listesi ve müşteri listesi
   - Özmal kayıtları ve şoför hesap adları (şifre bu cevapta yok)

2. **Liman listesi bilerek oturumsuz.** Test bunu doğruluyor: giriş yokken liste okunur, düzenleme kapalıdır, nakliyeci adı gizlenir. Şoför adı ve telefon açık kalır. Çıkan araç akışı da adı ve telefonu verir. Bu kişisel veri ifşasıdır.

3. **Şifre listesi kod deposunda.** `giris-sifreleri.md` git ile izleniyor ve `.gitignore` içinde değil. Depoyu gören kişi hesap şifrelerini görür. Dosya içeriği bu nota yazılmadı. Dosya depodan çıkarılmalı, paylaşılan kopyalar silinmeli, içindeki hesapların şifreleri değiştirilmelidir.

4. **`JWT_SECRET` boşsa bağlantı adresinden türetiliyor.** Üretim testi bu yolu doğruluyor. Veritabanı adresi sızarsa hem kayıtlar hem oturum üretimi aynı sırra bağlanır. Railway’de ayrı, uzun ve rastgele bir `JWT_SECRET` olmalıdır.

## Orta

5. **Veritabanı bağlantısı karşı tarafın sertifikasını doğrulamıyor.** Ağda araya girilirse bağlantı bunu fark etmez.

6. **Veritabanı hatasında sorgu parametreleri günlüğe yazılıyor.** Günlüğü okuyan kişi kimlik veya telefon görebilir.

7. **Tarayıcıda `authToken` hâlâ `localStorage` içinde aranıyor.** Asıl oturum httpOnly çerezte. Sayfada çalışan bir betik `localStorage` değerini okuyabilir; çerezi okuyamaz. İçerik güvenlik ilkesi kapalı (`contentSecurityPolicy: false`).

8. **CORS varsayılanı tüm kökenlere açık** (`CORS_ORIGIN` yoksa `*`). Oturumsuz okuma uçları başka bir siteden de çağrılabilir.

9. **Şoför düz şifresi bir süre anahtar-değer deposunda durabiliyor.** Herkese açık liste bunu göstermiyor. Ayarlar ekranındaki tam liste oturum ister. Depoda düz metin kalması yine risk.

10. **Amir yedeği şifresiz JSON.** İndirilen dosya veritabanı kadar değerlidir.

## Oturumun durduğu yer

Çerez `httpOnly`. Üretimde `Secure` açık. `SameSite` lax. Varsayılan süre 6 saat. Başarısız girişte sınır ve geçici IP engeli var. Kullanıcı şifreleri bcrypt. Tarayıcı Supabase anonim anahtarı kullanmıyor. Canlı akış ve yazma işlemleri oturum istiyor.

Bu tablo “oturumlar güvenli” demek için yetmez. Okuma uçları kapanmadan üçüncü kişi, giriş yapmadan sevkiyat ve kimlik verisini okuyabilir.
