'use strict';

/**
 * PIYASA bayi/müşteri listesini Excel'den data/piyasa-customers-seed.json dosyasına aktarır.
 * Tüm satırlar korunur (aynı KOD tekrar edebilir). Tekrarlayan başlık satırları atlanır.
 * Kullanım: node scripts/import-piyasa-customers.js [excel-yolu]
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const excelPath = process.argv[2]
  || path.join(process.env.USERPROFILE || '', 'Downloads', 'PIYASA_2026_v5.xlsx');
const outPath = path.join(__dirname, '..', 'data', 'piyasa-customers-seed.json');

function normCell(v) {
  return String(v == null ? '' : v).trim();
}

function isHeaderLikeRow(kod, ad) {
  const k = kod.toUpperCase();
  const a = ad.toUpperCase();
  return /^(KOD|MÜŞTERİ KODU|MUSTERI KODU)$/.test(k)
    || /^(AD|CARİ UNVAN|CARI UNVAN)$/.test(a);
}

function main() {
  if (!fs.existsSync(excelPath)) {
    console.error('Excel bulunamadı:', excelPath);
    process.exit(1);
  }
  const wb = XLSX.readFile(excelPath);
  const sheetName = wb.SheetNames.find((n) => /BAYİ|BAYI/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
  const customers = [];
  let skippedHeaders = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const kod = normCell(r[2]);
    const ad = normCell(r[3]);
    if (!kod) continue;
    if (isHeaderLikeRow(kod, ad)) {
      skippedHeaders++;
      continue;
    }
    customers.push({
      id: i + 1,
      kod,
      ad,
      urunTipi: normCell(r[0]),
      sektor: normCell(r[1]),
      il: normCell(r[4]),
      adres: normCell(r[5]),
      ambalaj: normCell(r[6]),
    });
  }

  const payload = {
    version: 2,
    source: path.basename(excelPath),
    updatedAt: Date.now(),
    customers,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log('OK:', customers.length, 'satır →', outPath, `(atlanan başlık: ${skippedHeaders})`);
}

main();
