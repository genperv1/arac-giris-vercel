#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { Pool } = require('pg');
const {
  getPrintFormBgRecord,
  clearPrintFormBg,
  resolveLocalBgFilePath,
  importLocalBgFile,
} = require('../lib/print-form-bg-store');

async function main() {
  const force = process.argv.includes('--force');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = (text, params) => pool.query(text, params);
  try {
    if (force) await clearPrintFormBg(q);
    const filePath = resolveLocalBgFilePath();
    if (!filePath) {
      console.error('Sablon dosyasi yok. Proje kokune AA.jpg veya AA.png koyun.');
    } else {
      await importLocalBgFile(q, filePath, { source: path.basename(filePath) });
      console.log('Takip formu sablonu dosyadan kullanilacak (DB blob yazilmadi).');
    }
    const record = await getPrintFormBgRecord(q);
    console.log('Durum:', record ? ('kayitli · ' + (record.source || '')) : 'yok');
    console.log('Kaynak dosya:', filePath || '-');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
