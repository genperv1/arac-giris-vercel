#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const { Pool } = require('pg');
const {
  seedPrintFormBgIfEmpty,
  syncPrintFormBgFromAaFile,
  getPrintFormBgRecord,
  clearPrintFormBg,
  resolveLocalBgFilePath,
  importLocalBgFile,
  ROOT_AA_FILES,
} = require('../lib/print-form-bg-store');

async function main() {
  const force = process.argv.includes('--force');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = (text, params) => pool.query(text, params);
  try {
    let seeded = false;
    if (force) {
      await clearPrintFormBg(q);
      const filePath = resolveLocalBgFilePath();
      if (!filePath) {
        console.error('Sablon dosyasi yok. Proje kokune AA.jpg veya AA.png koyun.');
      } else {
        seeded = await importLocalBgFile(q, filePath, {
          source: path.basename(filePath),
        });
      }
    } else {
      seeded = await syncPrintFormBgFromAaFile(q, { force: false }) || await seedPrintFormBgIfEmpty(q);
    }
    const record = await getPrintFormBgRecord(q);
    console.log(seeded ? 'Takip formu sablonu DB ye yuklendi.' : 'DB de guncel kayit var veya dosya bulunamadi.');
    console.log('Durum:', record ? ('kayitli · ' + (record.source || '')) : 'yok');
    const local = resolveLocalBgFilePath();
    if (local) console.log('Kaynak dosya:', local);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
