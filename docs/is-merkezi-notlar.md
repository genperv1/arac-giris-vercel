# İş Merkezi — not endeksi

Kaynak Word’ler: `SABAH YAPILACAK İŞLER.docx`, `HAFTALİK İHRACAT SEVK.docx`, `Sevkiyat Bittikten sonra.docx`.

Uygulama sayfası: [`public/is-merkezi.html`](../public/is-merkezi.html)  
Modül: [`public/modules/is-merkezi.js`](../public/modules/is-merkezi.js)

## A) Sabah yapılacak işler

1. **İrsaliye kontrolü** — İlk iş irsaliyeleri kontrol et. 2 Excel indir, birleştir (Özel Yapıştır). Kontrol: irsaliye no, teslim cari, taşıyıcı, miktar 1, miktar 2, şoför, sipariş no. Sevkiyat bitince Netsis rapordan tekrar bak.
2. **Liste hazırlama** — Halil’e 2 günlük “iboya nereden satılacak” sor. İhracat listesini aç/kopyala; D sütununa ekle → kendi Excel ihracat bölümüne yapıştır. Sevkiyat Takip Formu’na numarayı yaz. Gerekli verileri Excel’e yapıştır. **Ton ÷ 27** ile satır ekle.
3. **Kendi araç yük kuralları** — Akyüz’e **1–19 BBT** gibi az veya **38** gibi tek küsürat bırakma; en az ~20 BBT kalsın. Sarı alana: KG + yükleme yeri.
4. **BBT hesapları**
   - Bizim tipik: **1350→19** · **1250→20** · **1300→20** · **1150→22** BBT/araç (~25–27 ton)
   - Bizim araçlar **~26–27 tonu geçmeyecek**
   - Gemlik → ÷21; Körfez → ÷24
5. **Paketleme düzeni** — Başlıklarda “BBT” yazanı çuval yap; “palet” yazanı BBT yap.
6. **Son kontrol** — Güncel ihracat listesi ↔ kendi Excel; Lot no + mailler.

## B) Haftalık ihracat sevk

- Maili **Sibel Hanım** atıyor → indir, adını kopyala, **Liste kopyala**’ya bas.
- GPM ayrı, Akyüz ayrı düzenle.
- Paketlemeleri **1375**ten hesapla.
- Bizim arabaların sardığı yükü **Akyüz’den düş** (kritik).
- Paletli/streçli olursa sal dorse veya babaları çıkan araba istenecek.
- Bizim araçlar → Selahattin abi; Akyüz listesi → Akyüz; mail at.

## C) Sevkiyat bittikten sonra

1. Netsis kayıtlı raporu aç. OSB sevkiyatlarında KG hariç düzelt. Excel’e aktar, filtrele; KG / BBT / diğer ile karşılaştır. Tutuyorsa tarihli yeni kitap kaydet.
2. Selahattin abiye: **“Netsis tutuyor.”** — ancak “tamam, gönder” dedikten sonra.
3. Blok/sevkiyat sayısı kadar taslak kopyala; son kısım + yükleme yeri yapıştır; bizim araçları listeden sil; başlığa dosya adı + PO (yoksa Lot).
4. Gönderilen mailler → Tümünü Yanıtla + biten dosyalar; tonaj / madencilik / tarihler / ekler.
5. Muhasebe: Akyüz klasörü + Arşiv; Lot ile mail ara; sipariş formu + ihracat listesi; klasörü sevkiyat tarihiyle adlandır.
6. Son kontrol → Muhasebeye gönder.

## Sistem bağları

| Not | Araç |
|-----|------|
| Liste kopyala | `liste-kopyala.html` / masaüstü HTML |
| BBT / nakliye | `nakliye-bekleyen.html` |
| İhracat Excel | ana sayfa İHRACAT chip |

## BBT / sevkiyat kuralları (İş Merkezi hesap kartı)

**Formül (tek):** `Nakliyeci kalan = toplam BBT − bizim (sarı GPM) BBT`

| Durum | Renk |
|-------|------|
| kalan = 0 veya ≥ 20 | Yeşil — tamam |
| 1 ≤ kalan ≤ 19 | Kırmızı — Akyüz’e az |
| kalan &lt; 0 | Kırmızı — bizim fazla |

Bizim tipik BBT/araç (ipucu): 1350→19 · 1250→20 · 1300→20 · 1150→22.

Akyüz kalanı kendi araçlarına böler (20–32 BBT vs.); sistem “çift araç / N×kapasite” zorlamaz.

**Ayır** sekmesi kaldırıldı.
