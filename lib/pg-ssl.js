'use strict';

const fs = require('fs');

function readCa(env) {
  const inline = String(env.PG_SSL_CA || '').trim();
  if (inline) return inline.replace(/\\n/g, '\n');
  const file = String(env.PG_SSL_CA_FILE || '').trim();
  if (!file) return '';
  return fs.readFileSync(file, 'utf8');
}

/**
 * CA varsa sertifika doğrulanır. Yoksa bağlantı açık kalır ve uyarı basılır.
 * @param {NodeJS.ProcessEnv} [env]
 */
function pgSsl(env) {
  const source = env || process.env;
  const ca = readCa(source);
  if (ca) return { rejectUnauthorized: true, ca };
  console.error('[security] Veritabanı sertifikası doğrulanmıyor. Supabase > Database > SSL Configuration bölümünden prod-ca-2021.crt indirip PG_SSL_CA olarak yapıştırın. Dosya gelince doğrulama kendiliğinden açılır.');
  return { rejectUnauthorized: false };
}

module.exports = { pgSsl };
