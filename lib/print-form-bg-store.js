'use strict';

const fs = require('fs');
const path = require('path');

const KV_KEY = 'print_form_bg_v1';
const ROOT_AA_FILES = ['AA.jpg', 'AA.png'];
const MAX_IMAGE_BYTES = 8_000_000;

function projectRootPath() {
  return path.join(__dirname, '..');
}

function assetFilePathForMime(contentType) {
  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  return path.join(projectRootPath(), 'public', 'assets', `takip-form-bg.${ext}`);
}

function findRootAaFilePath() {
  let best = null;
  let bestMtime = 0;
  for (const name of ROOT_AA_FILES) {
    const p = path.join(projectRootPath(), name);
    if (!fs.existsSync(p)) continue;
    try {
      const st = fs.statSync(p);
      if (!best || st.mtimeMs >= bestMtime) {
        best = p;
        bestMtime = st.mtimeMs;
      }
    } catch (_) {}
  }
  return best;
}

/** Öncelik: proje kökündeki AA.jpg / AA.png (en yeni) → public/assets */
function resolveLocalBgFilePath() {
  const aa = findRootAaFilePath();
  if (aa) return aa;
  const pngAsset = assetFilePathForMime('image/png');
  if (fs.existsSync(pngAsset)) return pngAsset;
  const jpgAsset = assetFilePathForMime('image/jpeg');
  if (fs.existsSync(jpgAsset)) return jpgAsset;
  return null;
}

function readLocalBgBuffer(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (!isValidImageBuffer(buf)) return null;
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return { contentType: mimeFromBuffer(buf), buffer: buf };
  } catch (_) {
    return null;
  }
}

function isValidImageBuffer(buf) {
  if (!buf || buf.length < 64) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  return false;
}

function mimeFromBuffer(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  return 'application/octet-stream';
}

function normalizeImageData(raw) {
  let imageData = String(raw || '').trim();
  if (!imageData) return null;
  if (imageData.startsWith('data:')) return imageData;
  if (/^image\/(jpeg|jpg|png);base64,/i.test(imageData)) {
    return `data:${imageData}`;
  }
  return `data:image/jpeg;base64,${imageData}`;
}

function parseStoredValue(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.data) return parsed;
  } catch (_) {}
  const data = normalizeImageData(raw);
  if (!data) return null;
  return { kind: 'base64', data, updatedAt: 0, source: 'legacy' };
}

function dataUrlToBuffer(dataUrl) {
  const raw = String(dataUrl || '');
  if (/^data:image\/svg/i.test(raw)) return null;
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!isValidImageBuffer(buf)) return null;
  if (buf.length > MAX_IMAGE_BYTES) return null;
  return { contentType: m[1], buffer: buf };
}

function isAcceptablePrintFormBg(record) {
  if (!record || !record.data) return false;
  if (record.kind === 'svg') return false;
  const source = String(record.source || '').toLowerCase();
  if (source.includes('builtin') || source.includes('svg')) return false;
  if (/^data:image\/svg/i.test(String(record.data))) return false;
  const parsed = dataUrlToBuffer(record.data);
  return !!(parsed && isValidImageBuffer(parsed.buffer));
}

async function getPrintFormBgRecord(q) {
  const r = await q('SELECT value FROM kv_store WHERE key = $1', [KV_KEY]);
  if (!r.rows[0]) return null;
  return parseStoredValue(r.rows[0].value);
}

async function getPrintFormBgBuffer(q) {
  const record = await getPrintFormBgRecord(q);
  if (record && isAcceptablePrintFormBg(record)) {
    const parsed = dataUrlToBuffer(record.data);
    if (parsed) return parsed;
  }

  const localPath = resolveLocalBgFilePath();
  if (localPath) {
    const local = readLocalBgBuffer(localPath);
    if (local) return local;
  }

  return null;
}

async function importLocalBgFile(q, filePath, meta = {}) {
  const parsed = readLocalBgBuffer(filePath);
  if (!parsed) return false;
  const data = `data:${parsed.contentType};base64,${parsed.buffer.toString('base64')}`;
  await setPrintFormBg(q, data, {
    source: meta.source || path.basename(filePath),
    ...meta,
  });
  return true;
}

async function setPrintFormBg(q, imageData, meta = {}) {
  const normalized = String(imageData || '').trim();
  if (!normalized) {
    const err = new Error('invalid image');
    err.status = 400;
    throw err;
  }
  if (/^data:image\/svg/i.test(normalized)) {
    const err = new Error('Yalnızca orijinal JPG/PNG kabul edilir (SVG veya çizilmiş şablon kullanılamaz).');
    err.status = 400;
    throw err;
  }
  const parsed = dataUrlToBuffer(normalized.startsWith('data:') ? normalized : normalizeImageData(normalized));
  if (!parsed) {
    const err = new Error('Geçersiz görsel — JPG veya PNG yükleyin.');
    err.status = 400;
    throw err;
  }

  const payload = {
    kind: 'base64',
    data: normalized.startsWith('data:') ? normalized : `data:${parsed.contentType};base64,${normalized.replace(/^data:[^;]+;base64,/, '')}`,
    updatedAt: Date.now(),
    source: String(meta.source || 'upload').slice(0, 40),
  };

  await q(
    `INSERT INTO kv_store(key, value)
     VALUES($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KV_KEY, JSON.stringify(payload)]
  );

  try {
    const filePath = assetFilePathForMime(parsed.contentType);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, parsed.buffer);
    const otherExt = parsed.contentType === 'image/png' ? 'jpg' : 'png';
    const stalePath = path.join(path.dirname(filePath), `takip-form-bg.${otherExt}`);
    if (fs.existsSync(stalePath)) {
      try { fs.unlinkSync(stalePath); } catch (_) {}
    }
  } catch (e) {
    console.warn('print form bg asset write failed:', e.message || e);
  }

  return payload;
}

async function clearPrintFormBg(q) {
  await q('DELETE FROM kv_store WHERE key = $1', [KV_KEY]);
}

async function purgeUnacceptablePrintFormBg(q) {
  const record = await getPrintFormBgRecord(q);
  if (!record) return false;
  if (isAcceptablePrintFormBg(record)) return false;
  await clearPrintFormBg(q);
  console.log('Removed unacceptable print form template (source: %s)', record.source || record.kind || '?');
  return true;
}

async function seedPrintFormBgIfEmpty(q) {
  const existing = await getPrintFormBgRecord(q);
  if (existing && isAcceptablePrintFormBg(existing)) return false;

  const filePath = resolveLocalBgFilePath();
  if (!filePath) return false;

  try {
    const ok = await importLocalBgFile(q, filePath, {
      source: path.basename(filePath),
    });
    return ok;
  } catch (e) {
    console.warn('seedPrintFormBgIfEmpty file failed:', e.message || e);
    return false;
  }
}

/** Proje kökündeki AA.jpg / AA.png güncellendiyse DB'ye kayıpsız yeniden yükle */
async function syncPrintFormBgFromAaFile(q, opts = {}) {
  const force = !!opts.force;
  const aaPath = findRootAaFilePath();
  if (!aaPath) return false;

  const record = await getPrintFormBgRecord(q);
  let stat;
  try {
    stat = fs.statSync(aaPath);
  } catch (_) {
    return false;
  }

  const acceptable = record && isAcceptablePrintFormBg(record);
  const fromAa = acceptable && /^AA\.(jpg|png)$/i.test(String(record.source || '').trim());
  const aaNewer = !record?.updatedAt || stat.mtimeMs > Number(record.updatedAt);
  const manual = acceptable && /upload|ayarlar|takip-upload/i.test(String(record.source || ''));

  if (!force && acceptable && fromAa && !aaNewer) return false;
  if (!force && acceptable && manual && !aaNewer) return false;
  if (!force && acceptable && !fromAa && !aaNewer) return false;

  try {
    const ok = await importLocalBgFile(q, aaPath, { source: path.basename(aaPath) });
    if (ok) {
      console.log(
        'Takip formu sablonu %s dosyasindan yuklendi (%s KB).',
        path.basename(aaPath),
        Math.round(stat.size / 1024)
      );
    }
    return ok;
  } catch (e) {
    console.warn('syncPrintFormBgFromAaFile failed:', e.message || e);
    return false;
  }
}

module.exports = {
  KV_KEY,
  ROOT_AA_FILES,
  findRootAaFilePath,
  resolveLocalBgFilePath,
  getPrintFormBgRecord,
  getPrintFormBgBuffer,
  setPrintFormBg,
  importLocalBgFile,
  seedPrintFormBgIfEmpty,
  syncPrintFormBgFromAaFile,
  purgeUnacceptablePrintFormBg,
  clearPrintFormBg,
  isAcceptablePrintFormBg,
  dataUrlToBuffer,
};
