#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readLines(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
}

function writeModule(rel, banner, bodyLines) {
  const out = [banner, '// Otomatik bölüm — scripts/split-large-files.js', '', ...bodyLines, ''].join('\n');
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, out, 'utf8');
  console.log('Wrote', rel, `(${bodyLines.length} lines)`);
}

function sliceLines(lines, start1, end1) {
  return lines.slice(start1 - 1, end1);
}

function splitAppJs() {
  const lines = readLines('public/app.js');
  if (lines.length < 1000) {
    console.log('Skip app.js split (already modular or too small:', lines.length, 'lines)');
    return;
  }
  const parts = [
    { file: 'public/modules/app-core.js', start: 1, end: 586, banner: '// app-core.js — giriş, listeler, state' },
    { file: 'public/modules/app-excel-ihracat.js', start: 587, end: 2424, banner: '// app-excel-ihracat.js — günlük Excel / ihracat' },
    { file: 'public/modules/app-shipment-ui.js', start: 2427, end: 3888, banner: '// app-shipment-ui.js — sevkiyat seçim + yedekleme' },
    { file: 'public/modules/app-signatures-prefs.js', start: 3890, end: 4039, banner: '// app-signatures-prefs.js — imza + tercihler' },
    { file: 'public/modules/app-main.js', start: 4040, end: lines.length, banner: '// app-main.js — sıra, UI, sync, init' },
  ];
  for (const p of parts) writeModule(p.file, p.banner, sliceLines(lines, p.start, p.end));
  fs.writeFileSync(
    path.join(ROOT, 'public/app.js'),
    "// Loader — parçalar public/modules/app-*.js (GIRIS.html'de yüklenir)\n",
    'utf8'
  );
  console.log('Replaced public/app.js with minimal loader');
}

function splitPrintJs() {
  const lines = readLines('public/print.js');
  if (lines.length < 500) {
    console.log('Skip print.js split (already modular or too small)');
    return;
  }
  writeModule(
    'public/modules/print-main.js',
    '// print-main.js — window.Print API (IIFE)',
    sliceLines(lines, 1, 2603)
  );
  writeModule(
    'public/modules/print-ux-fit.js',
    '// print-ux-fit.js — eşleştirme UX + yazdırma sığdırma',
    sliceLines(lines, 2605, lines.length)
  );
  fs.writeFileSync(
    path.join(ROOT, 'public/print.js'),
    "// Loader — modules/print-main.js + print-ux-fit.js (asset-loader.js yükler)\n",
    'utf8'
  );
  console.log('Replaced public/print.js with minimal loader');
}

function splitAppMain() {
  const rel = 'public/modules/app-main.js';
  if (!fs.existsSync(path.join(ROOT, rel))) {
    console.log('Skip app-main subdivide (not found)');
    return;
  }
  const lines = readLines(rel);
  if (lines.length < 2000) {
    console.log('Skip app-main subdivide');
    return;
  }
  const parts = [
    { file: 'public/modules/app-ui-forms.js', start: 5, end: 2788, banner: '// app-ui-forms.js — sıra, takip formu, temel UI' },
    { file: 'public/modules/app-auth.js', start: 2789, end: 4209, banner: '// app-auth.js — giriş, oturum, yedekleme' },
    { file: 'public/modules/app-vehicles.js', start: 4210, end: 4924, banner: '// app-vehicles.js — araç CRUD + liste' },
    { file: 'public/modules/app-excel-review.js', start: 4926, end: 5144, banner: '// app-excel-review.js — Excel düzeltme penceresi' },
    { file: 'public/modules/app-issues.js', start: 5146, end: lines.length, banner: '// app-issues.js — şoför sorunları + sync' },
  ];
  for (const p of parts) writeModule(p.file, p.banner, sliceLines(lines, p.start, p.end));
  fs.unlinkSync(path.join(ROOT, rel));
  console.log('Removed', rel, '(subdivided)');
}

function splitAppIssues() {
  const rel = 'public/modules/app-issues.js';
  if (!fs.existsSync(path.join(ROOT, rel))) return;
  const lines = readLines(rel);
  if (lines.length < 1500) return;
  writeModule('public/modules/app-issues-core.js', '// app-issues-core.js — plaka sorun kayıtları', sliceLines(lines, 4, 719));
  writeModule('public/modules/app-ihracat-ui.js', '// app-ihracat-ui.js — ihracat detay modal + tablo', sliceLines(lines, 723, 3591));
  writeModule('public/modules/app-sync-handlers.js', '// app-sync-handlers.js — SSE / sekme senkronu', sliceLines(lines, 3593, lines.length));
  fs.unlinkSync(path.join(ROOT, rel));
  console.log('Subdivided app-issues.js');
}

splitAppJs();
splitPrintJs();
splitAppMain();
splitAppIssues();
