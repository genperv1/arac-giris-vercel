'use strict';

const fs = require('fs');
const path = require('path');

const PIYASA_DURUM_META_KV = 'piyasa_durum_meta_v1';
const PIYASA_CUSTOMERS_KV = 'piyasa_customer_list_v1';

function getPiyasaDurumFreezeUntilMs() {
  const raw = String(process.env.PIYASA_DURUM_FREEZE_UNTIL || '2026-06-07T22:00:00+03:00').trim();
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return new Date(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00+03:00`).getTime();
  const dateTime = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dateTime) {
    const sec = dateTime[6] || '00';
    return new Date(`${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${sec}+03:00`).getTime();
  }
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : 0;
}

function createPiyasaServerApi({ q, broadcastReportUpdate, sanitizeString, rootDir }) {
  function isPiyasaDurumFrozen() {
    const until = getPiyasaDurumFreezeUntilMs();
    return until > 0 && Date.now() < until;
  }

  function piyasaDurumFreezeMessage() {
    const until = getPiyasaDurumFreezeUntilMs();
    if (!until || !isPiyasaDurumFrozen()) return '';
    const label = new Date(until).toLocaleString('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `Piyasa sipariş listesi DURUM sayacı ${label} tarihinden itibaren başlayacak (raporlar etkilenmez).`;
  }

  async function readPiyasaDurumMeta() {
    try {
      const r = await q('SELECT value FROM kv_store WHERE key = $1', [PIYASA_DURUM_META_KV]);
      if (!r.rows[0]?.value) return { resetEpoch: 0, freezeUntil: getPiyasaDurumFreezeUntilMs() };
      const parsed = JSON.parse(r.rows[0].value);
      return {
        resetEpoch: Number(parsed.resetEpoch) || 0,
        freezeUntil: Number(parsed.freezeUntil) || getPiyasaDurumFreezeUntilMs(),
      };
    } catch (e) {
      return { resetEpoch: 0, freezeUntil: getPiyasaDurumFreezeUntilMs() };
    }
  }

  async function writePiyasaDurumMeta(meta) {
    const raw = JSON.stringify({
      resetEpoch: Number(meta.resetEpoch) || Date.now(),
      freezeUntil: Number(meta.freezeUntil) || getPiyasaDurumFreezeUntilMs(),
      resetAt: new Date().toISOString(),
    });
    await q(
      `INSERT INTO kv_store(key, value) VALUES($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [PIYASA_DURUM_META_KV, raw]
    );
  }

  async function resetPiyasaDurumDisplayOnly() {
    const resetEpoch = Date.now();
    await writePiyasaDurumMeta({ resetEpoch, freezeUntil: getPiyasaDurumFreezeUntilMs() });
    broadcastReportUpdate({ type: 'piyasa_durum_reset', data: { resetEpoch } });
    return { resetEpoch };
  }

  function sanitizePiyasaCustomerEntry(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    const kod = sanitizeString(String(raw.kod || '').trim(), 50);
    if (!kod) return null;
    const ad = sanitizeString(String(raw.ad || '').trim(), 200);
    if (/^(AD|CARİ UNVAN|CARI UNVAN)$/i.test(ad) && /^(KOD|MÜŞTERİ KODU|MUSTERI KODU)$/i.test(kod)) return null;
    let id = raw.id;
    if (id == null || id === '') id = `row-${index + 1}`;
    else id = sanitizeString(String(id), 40);
    return {
      id,
      kod,
      ad,
      urunTipi: sanitizeString(String(raw.urunTipi || '').trim(), 80),
      sektor: sanitizeString(String(raw.sektor || '').trim(), 80),
      il: sanitizeString(String(raw.il || '').trim(), 80),
      adres: sanitizeString(String(raw.adres || '').trim(), 300),
      ambalaj: sanitizeString(String(raw.ambalaj || '').trim(), 120),
    };
  }

  function normalizePiyasaCustomersPayload(body) {
    const list = Array.isArray(body?.customers) ? body.customers : [];
    if (!list.length) return null;
    if (list.length > 20000) throw new Error('Müşteri listesi çok büyük (max 20000)');
    const customers = [];
    for (let i = 0; i < list.length; i++) {
      const c = sanitizePiyasaCustomerEntry(list[i], i);
      if (c) customers.push(c);
    }
    if (!customers.length) return null;
    return {
      version: 2,
      source: sanitizeString(String(body.source || 'manual'), 120) || 'manual',
      updatedAt: Date.now(),
      customers,
    };
  }

  async function seedPiyasaCustomersIfEmpty() {
    try {
      const r = await q('SELECT value FROM kv_store WHERE key = $1', [PIYASA_CUSTOMERS_KV]);
      if (r.rows[0]) {
        try {
          const parsed = JSON.parse(r.rows[0].value);
          if (parsed && Array.isArray(parsed.customers) && parsed.customers.length > 0) {
            console.log(`ℹ️ Piyasa müşteri listesi mevcut (${parsed.customers.length} kayıt)`);
            return;
          }
        } catch (_) { /* re-seed below */ }
      }
      const seedPath = path.join(rootDir || path.join(__dirname, '..'), 'data', 'piyasa-customers-seed.json');
      if (!fs.existsSync(seedPath)) {
        console.warn('⚠️ Piyasa müşteri seed dosyası yok:', seedPath);
        return;
      }
      const raw = fs.readFileSync(seedPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.customers) || !parsed.customers.length) {
        console.warn('⚠️ Piyasa müşteri seed dosyası boş');
        return;
      }
      await q(
        `INSERT INTO kv_store(key, value) VALUES($1,$2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [PIYASA_CUSTOMERS_KV, raw]
      );
      console.log(`✅ Piyasa müşteri listesi seed edildi (${parsed.customers.length} kayıt)`);
    } catch (err) {
      console.error('Piyasa müşteri seed hatası:', err.message || err);
    }
  }

  return {
    PIYASA_CUSTOMERS_KV,
    getPiyasaDurumFreezeUntilMs,
    isPiyasaDurumFrozen,
    piyasaDurumFreezeMessage,
    readPiyasaDurumMeta,
    writePiyasaDurumMeta,
    resetPiyasaDurumDisplayOnly,
    sanitizePiyasaCustomerEntry,
    normalizePiyasaCustomersPayload,
    seedPiyasaCustomersIfEmpty,
  };
}

module.exports = { createPiyasaServerApi, PIYASA_CUSTOMERS_KV };
