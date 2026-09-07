'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const KV_KEY = 'ihracat_excel_source_v1';
const MAX_EXCEL_BYTES = 40 * 1024 * 1024;
const EXCEL_EXT_RE = /\.(xlsx|xls|xlsm|xlsb)$/i;
const FILE_NOT_FOUND_MSG = 'İhracat Excel dosyası bulunamadı. Lütfen dosyayı tekrar seçin.';

function notFoundError() {
  const err = new Error(FILE_NOT_FOUND_MSG);
  err.status = 404;
  err.code = 'EXCEL_FILE_NOT_FOUND';
  return err;
}

function isExcelPath(filePath) {
  const s = String(filePath || '').trim();
  if (!s || s.length > 500 || s.includes('\0')) return false;
  return EXCEL_EXT_RE.test(s);
}

function isAbsoluteExcelPath(filePath) {
  const s = String(filePath || '').trim();
  if (!isExcelPath(s)) return false;
  if (path.isAbsolute(s)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  if (s.startsWith('\\\\')) return true;
  return false;
}

function defaultSearchDirs() {
  const home = os.homedir();
  const dirs = [
    process.env.IHRACAT_EXCEL_DIR,
    home && path.join(home, 'Downloads'),
    home && path.join(home, 'Desktop'),
    home && path.join(home, 'Documents'),
  ];
  return dirs.filter(function (d) {
    return typeof d === 'string' && d.trim().length > 1;
  });
}

async function isReadableExcelFile(filePath) {
  if (!isAbsoluteExcelPath(filePath)) return false;
  try {
    const st = await fs.promises.stat(filePath);
    return st.isFile() && st.size > 0 && st.size <= MAX_EXCEL_BYTES;
  } catch (_) {
    return false;
  }
}

async function walkCollectExcel(dir, name, depth, out) {
  const root = path.resolve(dir);
  const needle = String(name || '').toLowerCase();
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const ent of entries) {
    if (!ent || !ent.name || ent.name === '.' || ent.name === '..') continue;
    if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
    const full = path.join(root, ent.name);
    if (ent.isFile() && String(ent.name).toLowerCase() === needle) {
      if (await isReadableExcelFile(full)) out.push(full);
      continue;
    }
    if (ent.isDirectory() && depth > 0) {
      await walkCollectExcel(full, name, depth - 1, out);
    }
  }
}

async function pickNewestExcel(paths) {
  let best = '';
  let bestMtime = -1;
  const seen = Object.create(null);
  for (const p of paths) {
    if (!p || seen[p]) continue;
    seen[p] = true;
    try {
      const st = await fs.promises.stat(p);
      const t = Number(st.mtimeMs);
      if (Number.isFinite(t) && t >= bestMtime) {
        bestMtime = t;
        best = p;
      }
    } catch (_) {}
  }
  return best;
}

async function findNewestExcelInDir(dir) {
  if (!dir) return '';
  const root = path.resolve(String(dir));
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch (_) {
    return '';
  }
  const candidates = [];
  for (const ent of entries) {
    if (!ent || !ent.isFile()) continue;
    if (!ent.name || ent.name.startsWith('~$') || ent.name.startsWith('.')) continue;
    if (!EXCEL_EXT_RE.test(ent.name)) continue;
    const full = path.join(root, ent.name);
    if (await isReadableExcelFile(full)) candidates.push(full);
  }
  return pickNewestExcel(candidates);
}

async function findExcelByFileName(fileName, opts) {
  const name = sanitizeFileName(fileName);
  if (!name || !EXCEL_EXT_RE.test(name) || name === '.' || name === '..') return '';
  const depth = opts && Number.isFinite(opts.depth) ? Math.max(0, Math.min(3, opts.depth)) : 2;
  const dirs = (opts && Array.isArray(opts.searchDirs) && opts.searchDirs.length)
    ? opts.searchDirs.slice()
    : defaultSearchDirs();
  const candidates = [];
  if (opts && opts.hintPath && await isReadableExcelFile(opts.hintPath)) {
    const hintBase = sanitizeFileName(opts.hintPath);
    if (!name || hintBase.toLowerCase() === name.toLowerCase()) candidates.push(opts.hintPath);
  }
  if (opts && opts.hintPath) {
    try { dirs.unshift(path.dirname(String(opts.hintPath))); } catch (_) {}
  }
  const seen = Object.create(null);
  for (const dir of dirs) {
    if (!dir) continue;
    const root = path.resolve(String(dir));
    if (seen[root]) continue;
    seen[root] = true;
    await walkCollectExcel(root, name, depth, candidates);
  }
  return pickNewestExcel(candidates);
}

function sanitizeFileName(raw) {
  const base = path.basename(String(raw || '').replace(/\\/g, '/').trim());
  if (!base || base.length > 260 || base.includes('\0')) return '';
  return base;
}

function sanitizeSource(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const fileName = sanitizeFileName(o.fileName || '');
  let filePath = String(o.filePath || '').trim();
  if (filePath.length > 500) filePath = filePath.slice(0, 500);
  if (!isAbsoluteExcelPath(filePath)) filePath = '';
  const sheetName = String(o.sheetName || '').trim().slice(0, 120);
  const selectedAt = String(o.selectedAt || '').trim().slice(0, 40);
  const lastUpdatedAt = String(o.lastUpdatedAt || '').trim().slice(0, 40);
  return {
    fileName,
    filePath,
    sheetName,
    selectedAt,
    lastUpdatedAt,
  };
}

function hasStoredSource(source) {
  const s = sanitizeSource(source);
  return !!(s.fileName || s.filePath);
}

function mergeSource(prev, next) {
  const a = sanitizeSource(prev);
  const b = sanitizeSource(next);
  const raw = next && typeof next === 'object' ? next : {};
  const fileName = b.fileName || a.fileName;
  let filePath = b.filePath || a.filePath;
  if (raw.clearPath) filePath = b.filePath;
  else if (b.fileName && a.fileName && b.fileName.toLowerCase() !== a.fileName.toLowerCase() && !b.filePath) {
    filePath = '';
  }
  return sanitizeSource({
    fileName,
    filePath,
    sheetName: b.sheetName || a.sheetName,
    selectedAt: b.selectedAt || a.selectedAt,
    lastUpdatedAt: b.lastUpdatedAt || a.lastUpdatedAt,
  });
}

function publicSourceView(source) {
  const s = sanitizeSource(source);
  return {
    ok: true,
    hasSource: hasStoredSource(s),
    fileName: s.fileName,
    hasPath: !!s.filePath,
    sheetName: s.sheetName,
    selectedAt: s.selectedAt,
    lastUpdatedAt: s.lastUpdatedAt,
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLastUpdateLabel(isoOrMs) {
  if (isoOrMs == null || isoOrMs === '') return '';
  const d = isoOrMs instanceof Date ? isoOrMs : new Date(isoOrMs);
  if (!Number.isFinite(d.getTime())) return '';
  return (
    'Son Güncelleme: ' +
    pad2(d.getDate()) +
    '.' +
    pad2(d.getMonth() + 1) +
    '.' +
    d.getFullYear() +
    ' ' +
    pad2(d.getHours()) +
    ':' +
    pad2(d.getMinutes())
  );
}

async function getStoredSource(q) {
  const r = await q('SELECT value FROM kv_store WHERE key = $1', [KV_KEY]);
  if (!r.rows[0]) return sanitizeSource({});
  try {
    const parsed = JSON.parse(r.rows[0].value);
    return sanitizeSource(parsed);
  } catch (_) {
    return sanitizeSource({});
  }
}

async function setStoredSource(q, raw) {
  const prev = await getStoredSource(q);
  const next = mergeSource(prev, raw);
  if (!next.selectedAt) next.selectedAt = new Date().toISOString();
  await q(
    `INSERT INTO kv_store(key, value)
     VALUES($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KV_KEY, JSON.stringify(next)]
  );
  return next;
}

async function clearStoredSource(q) {
  const empty = sanitizeSource({});
  await q(
    `INSERT INTO kv_store(key, value)
     VALUES($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [KV_KEY, JSON.stringify(empty)]
  );
  return empty;
}

async function readExcelFromStoredPath(source, opts) {
  const s = sanitizeSource(source);
  const candidates = [];
  if (await isReadableExcelFile(s.filePath)) candidates.push(s.filePath);
  if (s.fileName) {
    const found = await findExcelByFileName(s.fileName, Object.assign({}, opts, { hintPath: s.filePath }));
    if (found) candidates.push(found);
  }
  let filePath = await pickNewestExcel(candidates);
  if (!filePath && s.filePath) {
    filePath = await findNewestExcelInDir(path.dirname(s.filePath));
  }
  if (filePath) {
    const newestInDir = await findNewestExcelInDir(path.dirname(filePath));
    if (newestInDir) filePath = await pickNewestExcel([filePath, newestInDir]);
  }
  if (!filePath) throw notFoundError();
  let st;
  try {
    st = await fs.promises.stat(filePath);
  } catch (_) {
    throw notFoundError();
  }
  if (!st.isFile()) throw notFoundError();
  if (st.size <= 0 || st.size > MAX_EXCEL_BYTES) throw notFoundError();
  let buf;
  try {
    buf = await fs.promises.readFile(filePath);
  } catch (_) {
    throw notFoundError();
  }
  return {
    buf,
    fileName: path.basename(filePath),
    filePath,
    mtime: st.mtime,
  };
}

module.exports = {
  KV_KEY,
  MAX_EXCEL_BYTES,
  FILE_NOT_FOUND_MSG,
  isExcelPath,
  isAbsoluteExcelPath,
  sanitizeSource,
  hasStoredSource,
  mergeSource,
  publicSourceView,
  formatLastUpdateLabel,
  getStoredSource,
  setStoredSource,
  clearStoredSource,
  findExcelByFileName,
  findNewestExcelInDir,
  readExcelFromStoredPath,
};
