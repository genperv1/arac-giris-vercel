# Supabase ve Railway veri güvenliği brifingi

Araç giriş sistemi · şirket yönetimi · 9 Ekim 2026

9 Ekim 2026 tarihinde araç giriş sistemi için sızma testi yapılmıştır. Kapsam Supabase üzerindeki veri ve Railway üzerindeki uygulamadır. Testte kimlik doğrulama, oturum, veritabanı erişimi, kişisel verinin nasıl saklandığı ve liman ekranının dışarı açık alanları incelenmiştir. Aşağıdaki bulgular bu testin sonucudur.

Sağlayıcı panellerindeki bölge, yedek süresi ve hesap erişim listesi test sırasında ayrıca not edilmiştir. Bu üç madde panelden teyit edilmeden “yedekler güvende” denmemelidir.

## Kısa hüküm

Veritabanı tarayıcıya açık değil. Uygulama Railway üzerinde çalışıyor, kayıtlar Supabase PostgreSQL içinde duruyor. Asıl risk, veritabanı bağlantı bilgisinin ve iki sağlayıcı hesabının dar tutulması, kimlik verisinin düz metin saklanması ve liman ekranının giriş yapmadan şoför adı ile telefon göstermesidir.

## Veri nasıl akıyor

Kantar, liman ve ofis ekranları veritabanına doğrudan bağlanmaz. İstekler Railway üzerindeki uygulamaya gider. Uygulama, Supabase PostgreSQL bağlantısı ile okur ve yazar. Supabase’in herkese açık anonim anahtarı tarayıcı kodunda kullanılmıyor.

| Katman | Ne iş görür | Veri burada mı |
| --- | --- | --- |
| Tarayıcı | Ekran ve oturum çerezi | Kalıcı kayıt yok |
| Railway | Uygulama, giriş kontrolü, iş kuralları | Disk geçicidir; kalıcı veri burada beklenmez |
| Supabase | PostgreSQL veritabanı | Asıl kayıtların durduğu yer |

Üç koruma hattı vardır.

1. Uygulama şifreleri ve oturum.
2. Veritabanı şifresinin ve Railway ile Supabase panellerine giren kişilerin sınırlı olması.
3. Sağlayıcının disk şifrelemesi ve yedeklemesi. Bu hat kodda değil, satın alınan planda durur.

Uygulama veritabanına tam yetkili hesapla bağlanır. Satır güvenliği (RLS), Supabase’in genel API’sini kapatır; bu hesabı durdurmaz. Bağlantı dizesi e-postaya, sohbete veya bir dizüstü yedeğine düşerse kayıtların tamamı okunabilir.

## Hangi veri tutuluyor

Sistem bir sevkiyat ve kantar kaydıdır. Kişisel veri, operasyon kaydının içindedir. Saklama süresi kodda tanımlı değildir. Satır sayıları bu testte ölçülmedi.

| Veri | Örnek alan | Nerede | Hassasiyet |
| --- | --- | --- | --- |
| T.C. kimlik no | Yazdırma geçmişi | Supabase | Kimlik |
| Şoför adı ve telefon | Sevkiyat, liman, yazdırma | Supabase | İletişim |
| İmza görseli | Kantar imzaları | Supabase | Biyometrik görüntü |
| İSG form dosyası | Form kaydı ve dosya içeriği | Supabase | İş sağlığı belgesi |
| Plaka, firma, tonaj, liman | Araç ve sevkiyat tabloları | Supabase | Operasyon |
| Şoför sefer fotoğrafı | İrsaliye ve kantar fotoğrafı | Uygulama diski ve veritabanı | Belge görüntüsü |
| Hesap | Kullanıcı adı, şifre özeti, rol | Supabase | Erişim |

### Kim görebilir

| Rol | Ne yapabilir |
| --- | --- |
| Kantar / ofis oturumu | Kendi yetkisindeki kayıtları işler |
| Amir | Yedek indirir, tam geri yükler, bazı yönetim işlerini yapar |
| Liman ekranı | Giriş yapmadan çıkarılmış araç listesini görür; şoför adı ve telefon dahildir |
| Şoför paneli | Açıksa ilgili plakanın sefer kaydı |

## Kodda yerinde olan koruma

- Tarayıcı Supabase anonim anahtarı kullanmaz. Okuma ve yazma uygulama üzerinden gider.
- Kullanıcı şifreleri bcrypt ile saklanır. Düz şifre kullanıcı tablosunda durmaz.
- Oturum httpOnly çerezdedir. Üretimde Secure bayrağı açıktır. Varsayılan süre 6 saattir.
- Başarısız giriş denemeleri sınırlanır. Eşik aşılınca IP geçici engellenir.
- Her açılışta satır güvenliği açılır. Anonim ve authenticated rolleri tablolardan çıkarılır.
- Sonradan açılan tablolara genel API yetkisi otomatik verilmez.
- JSON yedek indirme ve tam geri yükleme amir oturumuna bağlıdır.
- Üretimde varsayılan oturum sırrı kabul edilmez. Ayrı bir `JWT_SECRET` tanımlı olmalıdır.

## Açık konular

### Yüksek öncelik

1. Veritabanı hesabı tam yetkilidir. Bağlantı dizesi sızarsa satır güvenliği veriyi durdurmaz. Bu dize Railway değişkenlerinde kalmalı, paylaşılmamalıdır.
2. T.C. kimlik, telefon, imza ve İSG dosyası veritabanında okunabilir biçimdedir. Ekranda T.C. maskelenir; depoda maskelenmez.
3. Liman listesi oturumsuzdur. Şoför adı ve telefon görünür. Bu bilinçli bir iş kararıdır; kişisel veri ifşası olarak kayda geçmelidir.
4. Supabase projesinin hangi ülkede durduğu kodda yoktur. Avrupa dışı bölge, KVKK aktarım şartı doğurur.

### Orta öncelik

5. Veritabanı bağlantısı şifrelidir. Sunucu, karşı tarafın sertifikasını doğrulamaz. Ağ üzerinde araya girme ihtimali buna bağlıdır.
6. `JWT_SECRET` boşsa üretimde bağlantı adresinden türetilir. İkisi aynı kapıya çıkar. Ayrı ve uzun bir sır tanımlanmalıdır.
7. Veritabanı hatasında sorgu parametreleri Railway günlüğüne yazılır. Günlüğü okuyan kişi kimlik verisi görebilir.
8. Amir JSON yedek indirir. Dosya dizüstü bilgisayarda kalırsa veritabanı kadar değerlidir. Dosya şifreli değildir.
9. Supabase kilidi uygulanamazsa sistem uyarı basıp çalışmaya devam eder. Açılış günlüğü izlenmelidir.
10. IP engel listesi ve konteyner içindeki dosyalar yeni dağıtımda silinebilir. Kalıcı kayıt Supabase’tedir.

## Yönetim karar listesi

İlk dört madde panelden teyit edilmeden “yedekler güvende” denmemelidir.

| No | Karar | Kim bakmalı |
| --- | --- | --- |
| 1 | Supabase bölgesini yazın. Avrupa dışıysa aktarım gerekçesini ve sözleşmeyi tamamlayın. | Bilgi işlem + hukuk |
| 2 | Supabase yedek ve noktadan geri dönüş planını doğrulayın. Ne sıklıkta, kaç gün saklandığını kayda geçirin. | Bilgi işlem |
| 3 | Railway ve Supabase hesaplarında iki adımlı doğrulama ve isim listesi olsun. Ayrılan kişinin erişimi kapatılsın. | Yönetim |
| 4 | İki sağlayıcı ile veri işleme sözleşmesini dosyalayın. | Hukuk |
| 5 | `DATABASE_URL` ve `JWT_SECRET` yalnızca Railway gizli değişkenlerinde dursun. Sohbet, e-posta ve kod deposuna girmesin. | Bilgi işlem |
| 6 | `JWT_SECRET` bağımsız, uzun ve rastgele olsun. Daha önce bağlantı adresinden türetildiyse değiştirilsin. | Bilgi işlem |
| 7 | T.C. kimlik, telefon, imza ve İSG dosyası için saklama süresi ve silme sorumlusu belirlensin. | Operasyon + hukuk |
| 8 | Liman ekranının oturumsuz şoför adı ve telefon göstermesi yazılı olarak kabul edilsin ya da kısıtlansın. | Operasyon |
| 9 | İndirilen JSON yedekler iş bitince silinsin. Yedeği kimlerin alabileceği sınırlı kalsın. | Amirler |
| 10 | Railway günlüklerini kimlerin okuduğu ve kaç gün tutulduğu yazılsın. | Bilgi işlem |

Yönetici özeti sözlü anlatım içindir. Veri envanteri hukuk ve KVKK dosyasına, açık konular risk kaydına, karar listesi toplantı tutanağına eklenir.
