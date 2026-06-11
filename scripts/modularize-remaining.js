#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function readLines(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
}

function slice(lines, start1, end1) {
  return lines.slice(start1 - 1, end1);
}

function writeModule(rel, banner, bodyLines) {
  const out = [banner, '// Otomatik bölüm — scripts/modularize-remaining.js', '', ...bodyLines, ''].join('\n');
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, out, 'utf8');
  console.log('Wrote', rel, `(${bodyLines.length} lines)`);
}

function writeRoute(file, name, ctxFields, bodyLines) {
  const out = `'use strict';

function ${name}(api, ctx) {
  const { ${ctxFields} } = ctx;
${bodyLines.join('\n')}
}

module.exports = { ${name} };
`;
  fs.writeFileSync(path.join(ROOT, 'routes', file), out, 'utf8');
  console.log('Wrote routes/' + file);
}

function removeLineRange(lines, start1, end1) {
  return lines.slice(0, start1 - 1).concat(lines.slice(end1));
}

function fixReportsRoutes() {
  const p = path.join(ROOT, 'routes/reports-routes.js');
  let text = fs.readFileSync(p, 'utf8');
  text = text.replace(/\nregisterProblemRoutes\(api, routeCtx\);\n/, '\n');
  fs.writeFileSync(p, text, 'utf8');
  console.log('Fixed reports-routes.js');
}

function extractServerRoutes() {
  const serverPath = path.join(ROOT, 'server.js');
  let lines = readLines('server.js');

  const commonCtx = 'q, pool, auth, parsePagination, sendApiError, requireValidSession, requireAdmin, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs';

  let piyasaBody = slice(lines, 1218, 1283).concat(slice(lines, 1360, 1385));
  const piyasaReplacements = [
    ['readPiyasaDurumMeta(', 'piyasaServer.readPiyasaDurumMeta('],
    ['getPiyasaDurumFreezeUntilMs(', 'piyasaServer.getPiyasaDurumFreezeUntilMs('],
    ['isPiyasaDurumFrozen(', 'piyasaServer.isPiyasaDurumFrozen('],
    ['piyasaDurumFreezeMessage(', 'piyasaServer.piyasaDurumFreezeMessage('],
    ['resetPiyasaDurumDisplayOnly(', 'piyasaServer.resetPiyasaDurumDisplayOnly('],
    ['normalizePiyasaCustomersPayload(', 'piyasaServer.normalizePiyasaCustomersPayload('],
    ["PIYASA_CUSTOMERS_KV", 'piyasaServer.PIYASA_CUSTOMERS_KV'],
  ];
  let piyasaText = piyasaBody.join('\n');
  for (const [from, to] of piyasaReplacements) piyasaText = piyasaText.split(from).join(to);
  piyasaBody = piyasaText.split('\n');
  writeRoute(
    'piyasa-routes.js',
    'registerPiyasaRoutes',
    `${commonCtx}, piyasaServer, verifySettingsPassword`,
    piyasaBody
  );

  const plakaBody = slice(lines, 1975, 2246);
  writeRoute(
    'plaka-stats-routes.js',
    'registerPlakaStatsRoutes',
    `${commonCtx}, normPlateForLookup, VEH_PLATE_NORM_SQL_CEK, PLATE_NORM_SQL, PLATE_NORM_SQL_PH, plateNormSql`,
    plakaBody
  );

  const sigBody = slice(lines, 2248, 2363);
  writeRoute(
    'signatures-routes.js',
    'registerSignaturesRoutes',
    `${commonCtx}, signatureRowToSrc`,
    sigBody
  );

  const ranges = [
    { start: 2248, end: 2363 },
    { start: 1975, end: 2246 },
    { start: 1360, end: 1385 },
    { start: 1285, end: 1358 },
    { start: 1218, end: 1283 },
  ].sort((a, b) => b.start - a.start);

  for (const { start, end } of ranges) {
    lines = removeLineRange(lines, start, end);
  }

  let text = lines.join('\n');

  const reqBlock = `const { registerPiyasaRoutes } = require('./routes/piyasa-routes');
const { registerPlakaStatsRoutes } = require('./routes/plaka-stats-routes');
const { registerSignaturesRoutes } = require('./routes/signatures-routes');
const { plateNormSql, PLATE_NORM_SQL, PLATE_NORM_SQL_PH } = require('./lib/plate-norm-sql');
const { signatureRowToSrc } = require('./lib/signature-helpers');
const { createPiyasaServerApi } = require('./lib/piyasa-server');`;

  if (!text.includes('registerPiyasaRoutes')) {
    text = text.replace(
      "const { registerReportsRoutes } = require('./routes/reports-routes');",
      `const { registerReportsRoutes } = require('./routes/reports-routes');
${reqBlock}`
    );
  }

  if (!text.includes('const piyasaServer = createPiyasaServerApi')) {
    text = text.replace(
      'const routeCtx = {',
      `const piyasaServer = createPiyasaServerApi({
  q,
  broadcastReportUpdate,
  sanitizeString,
  rootDir: __dirname,
});

const routeCtx = {`
    );
  }

  if (!text.includes('piyasaServer,')) {
    text = text.replace(
      'broadcastReportUpdate,',
      `broadcastReportUpdate,
  piyasaServer,
  normPlateForLookup,
  VEH_PLATE_NORM_SQL_CEK,
  PLATE_NORM_SQL,
  PLATE_NORM_SQL_PH,
  plateNormSql,
  signatureRowToSrc,
  verifySettingsPassword,
  formatReportInstant,
  istanbulMinutesFromTs,`
    );
  }

  if (!text.includes('registerProblemRoutes(api')) {
    text = text.replace(
      'registerDailyRoutes(api, routeCtx);',
      `registerDailyRoutes(api, routeCtx);
registerPiyasaRoutes(api, routeCtx);
registerProblemRoutes(api, routeCtx);
registerReportsRoutes(api, routeCtx);`
    );
  } else if (!text.includes('registerPiyasaRoutes(api')) {
    text = text.replace(
      'registerDailyRoutes(api, routeCtx);',
      `registerDailyRoutes(api, routeCtx);
registerPiyasaRoutes(api, routeCtx);`
    );
  }

  if (!text.includes('registerPlakaStatsRoutes(api')) {
    text = text.replace(
      'registerSseRoutes(app);',
      `registerPlakaStatsRoutes(api, routeCtx);
registerSignaturesRoutes(api, routeCtx);

registerSseRoutes(app);`
    );
  }

  // Remove duplicate inline helpers moved to lib
  text = text.replace(/\nfunction plateNormSql\(col\) \{[\s\S]*?^const PLATE_NORM_SQL_PH = plateNormSql\('ph\.plaka'\);\n/m, '\n');
  text = text.replace(/\nfunction signatureRowToSrc\(row\) \{[\s\S]*?^}\n\n\/\/ Report cleanup/m, '\n\n// Report cleanup');

  text = text.replace(
    /\nconst PIYASA_DURUM_META_KV = 'piyasa_durum_meta_v1';\n\nfunction getPiyasaDurumFreezeUntilMs\(\) \{[\s\S]*?^async function resetPiyasaDurumDisplayOnly\(\) \{[\s\S]*?^}\n/m,
    '\n'
  );

  text = text.replace(/await seedPiyasaCustomersIfEmpty\(\)/g, 'await piyasaServer.seedPiyasaCustomersIfEmpty()');

  fs.writeFileSync(serverPath, text, 'utf8');
  console.log('Updated server.js');
}

function splitAppUiFormsCore() {
  const rel = 'public/modules/app-ui-forms-core.js';
  if (!fs.existsSync(path.join(ROOT, rel))) return;
  const lines = readLines(rel);
  if (lines.length < 1500) return;
  writeModule('public/modules/app-ui-forms-pick.js', '// app-ui-forms-pick.js — firma/malzeme/plaka hızlı seçim', slice(lines, 1080, 1494));
  const takipBody = slice(lines, 4, 1079).concat(slice(lines, 1495, lines.length));
  writeModule('public/modules/app-ui-forms-takip.js', '// app-ui-forms-takip.js — takip formu, sıra, ana render', takipBody);
  fs.unlinkSync(path.join(ROOT, rel));
  console.log('Subdivided app-ui-forms-core.js');
}

function splitAppUiForms() {
  const rel = 'public/modules/app-ui-forms.js';
  if (!fs.existsSync(path.join(ROOT, rel))) return;
  const lines = readLines(rel);
  if (lines.length < 2000) {
    console.log('Skip app-ui-forms split');
    return;
  }
  writeModule('public/modules/app-ui-forms-core.js', '// app-ui-forms-core.js — takip formu, sıra, quick pick', slice(lines, 4, 2476));
  writeModule('public/modules/app-ui-utils.js', '// app-ui-utils.js — toast, plaka format, WhatsApp', slice(lines, 2477, lines.length));
  fs.unlinkSync(path.join(ROOT, rel));
  console.log('Removed', rel);
}

function splitAppIhracatUi() {
  const rel = 'public/modules/app-ihracat-ui.js';
  if (!fs.existsSync(path.join(ROOT, rel))) return;
  const lines = readLines(rel);
  if (lines.length < 2000) {
    console.log('Skip app-ihracat-ui split');
    return;
  }
  // Bölme noktası: _ihracatDetailRowHtml tamamlandıktan sonra (fonksiyon ortasında kesmeyin)
  writeModule('public/modules/app-ihracat-modal.js', '// app-ihracat-modal.js — ihracat modal, satır işlemleri', slice(lines, 4, 1429));
  writeModule('public/modules/app-ihracat-print.js', '// app-ihracat-print.js — ihracat yazdırma HTML', slice(lines, 1430, lines.length));
  fs.unlinkSync(path.join(ROOT, rel));
  console.log('Removed', rel);
}

function splitPiyasaJs() {
  const rel = 'public/piyasa.js';
  if (!fs.existsSync(path.join(ROOT, rel))) return;
  const lines = readLines(rel);
  if (lines.length < 3000) {
    console.log('Skip piyasa.js split (already modular?)');
    return;
  }
  const parts = [
    { file: 'public/modules/piyasa-core.js', start: 9, end: 1286, banner: '// piyasa-core.js — state, sync, geçmiş (global kapsam)' },
    { file: 'public/modules/piyasa-orders.js', start: 1287, end: 2117, banner: '// piyasa-orders.js — sipariş eşleştirme, Excel satır parse' },
    { file: 'public/modules/piyasa-excel.js', start: 2118, end: 2860, banner: '// piyasa-excel.js — Excel import, form doldurma' },
    { file: 'public/modules/piyasa-customers.js', start: 2861, end: 3302, banner: '// piyasa-customers.js — müşteri listesi' },
    { file: 'public/modules/piyasa-ui.js', start: 3303, end: 4310, banner: '// piyasa-ui.js — sipariş seçici, bind, init' },
    { file: 'public/modules/piyasa-api.js', start: 4312, end: 4365, banner: '// piyasa-api.js — window.piyasa API' },
  ];
  for (const p of parts) writeModule(p.file, p.banner, slice(lines, p.start, p.end));
  fs.writeFileSync(
    path.join(ROOT, rel),
    "// Loader — public/modules/piyasa-*.js (GIRIS.html'de yüklenir)\n",
    'utf8'
  );
  console.log('Replaced public/piyasa.js with loader');
}

function updateGirisHtml() {
  const p = path.join(ROOT, 'public/GIRIS.html');
  let html = fs.readFileSync(p, 'utf8');

  html = html.replace(
    /<script src="modules\/app-ui-forms\.js[^"]*"><\/script>\s*/,
    `<script src="modules/app-ui-forms-core.js?v=20260611-modular2"></script>
        <script src="modules/app-ui-utils.js?v=20260611-modular2"></script>
        `
  );

  html = html.replace(
    /<script src="modules\/app-ihracat-ui\.js[^"]*"><\/script>\s*/,
    `<script src="modules/app-ihracat-modal.js?v=20260611-modular2"></script>
        <script src="modules/app-ihracat-print.js?v=20260611-modular2"></script>
        `
  );

  if (!html.includes('piyasa-core.js')) {
    html = html.replace(
      /<script src="piyasa\.js[^"]*"><\/script>/,
      `<script src="modules/piyasa-core.js?v=20260611-modular2"></script>
        <script src="modules/piyasa-orders.js?v=20260611-modular2"></script>
        <script src="modules/piyasa-excel.js?v=20260611-modular2"></script>
        <script src="modules/piyasa-customers.js?v=20260611-modular2"></script>
        <script src="modules/piyasa-ui.js?v=20260611-modular2"></script>
        <script src="modules/piyasa-api.js?v=20260611-modular2"></script>`
    );
  }

  fs.writeFileSync(p, html, 'utf8');
  console.log('Updated GIRIS.html');
}

fixReportsRoutes();
extractServerRoutes();
splitAppUiForms();
splitAppUiFormsCore();
splitAppIhracatUi();
splitPiyasaJs();
updateGirisHtml();
console.log('Done.');
