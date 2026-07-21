'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { purgeUnacceptablePrintFormBg, clearPrintFormBg, getPrintFormBgRecord } = require('../lib/print-form-bg-store');

async function main() {
  const force = process.argv.includes('--all');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const q = (text, params) => pool.query(text, params);
  try {
    const before = await getPrintFormBgRecord(q);
    if (force) {
      await clearPrintFormBg(q);
      console.log('print_form_bg_v1 silindi.');
    } else {
      const purged = await purgeUnacceptablePrintFormBg(q);
      if (purged) {
        console.log('Kabul edilmeyen sablon (SVG/builtin) silindi.');
      } else if (before) {
        console.log('Kayitli sablon gecerli JPG/PNG — silinmedi. Tamamen silmek icin: --all');
      } else {
        console.log('Kayitli sablon yok.');
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
