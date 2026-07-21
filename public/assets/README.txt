# Takip formu arka plan görseli (ORİJİNAL JPG)

İş yeri bire bir aynı kağıdı ister. **Yalnızca gerçek JPG/PNG** kabul edilir.

## Önerilen yöntem — AA.jpg

Proje köküne yüksek çözünürlüklü şablonu koyun:

```
arac-giris-vercel-main/AA.jpg
```

Örnek boyut: **1492×1054 px** JPG (~390 KB). Sunucu açılışında veya seed komutu ile **kayıpsız** DB'ye yüklenir.

```bash
node scripts/seed-print-form-bg.js --force
```

AA.jpg dosyasını güncellediğinizde sunucuyu yeniden başlatın; dosya daha yeni ise otomatik yenilenir.

## Alternatif

- Uygulama: **Ayarlar → Yazdırma** bölümünden JPG yükleme
- `public/assets/takip-form-bg.jpg` (AA.jpg yoksa yedek)

```bash
node scripts/clear-print-form-bg.js
```

Sunucu açılışında geçersiz (SVG) şablon otomatik silinir.
