'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/analyze-ihracat-xlsx.js <path-to-xlsx>');
  process.exit(1);
}

function _safeStr(x) { return x == null ? '' : String(x); }
function _rowToText(row) {
  if (!row || !Array.isArray(row)) return '';
  return row.map((v) => _safeStr(v).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}
function _extractFirmaKod(headerText) {
  const m = String(headerText || '').match(/\b(YD\d{2,4})\b/i);
  return m ? m[1] : '';
}
function _extractMalzeme(headerText) {
  const m = String(headerText || '').match(/\bHP\s*([0-9][0-9\.,]*\s*-\s*[0-9][0-9\.,]*)\b/i);
  if (!m) return '';
  return `HP ${String(m[1] || '').replace(/\s+/g, '').replace(/\./g, ',')}`;
}
function formatPlakaForInput(p) { return String(p || '').trim().toUpperCase(); }
function _todayKeyTR() { return '2026-07-11'; }
function _dateKeyFromFileName() { return '2026-07-11'; }
function escapeHtml(s) { return String(s || ''); }
function escapeAttr(s) { return String(s || ''); }

function escapeAttr(s) { return String(s || ''); }

global.XLSX = XLSX;
global.window = global;

const excelCode = fs.readFileSync(
  path.join(__dirname, '../public/modules/app-excel-ihracat.js'),
  'utf8'
);
const parseStart = excelCode.indexOf('function _nz(v)');
const parseEnd = excelCode.indexOf('window.parseIhracatRowsFromWorkbook');
const wrapped = `(function(){\n${excelCode.slice(parseStart, parseEnd)}\nreturn { parseIhracatRowsFromWorkbook, parseIhracatBlockMeta, isIhracatBlockHeaderRow, resolveIhracatBlockCols, extractPrimaryPortFromShipment, extractPrimaryAmbalajFromHeader, getLimanCandidates, getAmbalajCandidates };})()`;
const {
  parseIhracatRowsFromWorkbook,
  parseIhracatBlockMeta,
  extractPrimaryPortFromShipment,
  extractPrimaryAmbalajFromHeader,
  getLimanCandidates,
  getAmbalajCandidates,
} = eval(wrapped);

const wb = XLSX.readFile(filePath);
const sheetName = wb.SheetNames[0];
const parsed = parseIhracatRowsFromWorkbook(wb, sheetName, {
  fileName: path.basename(filePath),
});

if (!parsed.ok) {
  console.error('Parse failed:', parsed.msg);
  process.exit(1);
}

const blocks = new Map();
for (const row of parsed.rows) {
  const bk = row.blockKey || `row_${row.blockHeaderRow}`;
  if (!blocks.has(bk)) {
    blocks.set(bk, {
      blockHeaderRow: row.blockHeaderRow,
      headerText: row.headerText,
      blockMeta: row.blockMeta,
      sevkYeri: row.sevkYeri,
      ambalaj: row.ambalaj,
      rows: [],
    });
  }
  blocks.get(bk).rows.push(row);
}

console.log(`File: ${path.basename(filePath)}`);
console.log(`Sheet: ${sheetName}`);
console.log(`Blocks: ${blocks.size}`);
console.log(`Total rows: ${parsed.rows.length}`);
console.log('');

let i = 0;
for (const [, block] of [...blocks.entries()].sort((a, b) => a[1].blockHeaderRow - b[1].blockHeaderRow)) {
  i += 1;
  const ht = block.headerText || '';
  const portLine = block.blockMeta?.portLine || '';
  const sevk = block.sevkYeri || extractPrimaryPortFromShipment({ headerText: ht, blockMeta: block.blockMeta });
  const amb = block.ambalaj || extractPrimaryAmbalajFromHeader(ht);
  const limCands = getLimanCandidates(ht);
  const ambCands = getAmbalajCandidates(ht);
  const yd = (ht.match(/\b(YD\d{1,4})\b/i) || [])[1] || '';
  const plates = block.rows.map((r) => r.plaka).filter(Boolean);
  const malzemeler = [...new Set(block.rows.map((r) => r.malzeme).filter(Boolean))];

  console.log(`--- Block ${i} (Excel row ${block.blockHeaderRow + 1}) ---`);
  console.log(`YD: ${yd} | Malzeme: ${malzemeler.join(', ') || '—'}`);
  console.log(`Plates: ${plates.length} → ${plates.join(', ')}`);
  console.log(`Sevk (parsed): ${sevk || '(boş)'}`);
  console.log(`Sevk (meta.portLine): ${portLine || '(boş)'}`);
  console.log(`Sevk candidates: ${limCands.join(' | ') || '(yok)'}`);
  console.log(`Ambalaj (parsed): ${amb || '(boş)'}`);
  console.log(`Ambalaj candidates: ${ambCands.join(' | ') || '(yok)'}`);
  const headerPreview = ht.replace(/\s+/g, ' ').trim();
  console.log(`Header: ${headerPreview.slice(0, 200)}${headerPreview.length > 200 ? '…' : ''}`);
  if (block.blockMeta?.exportLine) {
    console.log(`Export: ${String(block.blockMeta.exportLine).slice(0, 120)}`);
  }
  console.log('');
}
