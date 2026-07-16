#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const serverPath = path.join(ROOT, 'server.js');

if (!fs.existsSync(serverPath)) {
  console.error('server.js not found');
  process.exit(1);
}

const lines = fs.readFileSync(serverPath, 'utf8').split(/\r?\n/);

function slice(start1, end1) {
  return lines.slice(start1 - 1, end1).join('\n');
}

function writeRoute(file, name, ctxFields, start1, end1) {
  const body = slice(start1, end1);
  const out = `'use strict';

function ${name}(api, ctx) {
  const { ${ctxFields} } = ctx;
${body}
}

module.exports = { ${name} };
`;
  fs.writeFileSync(path.join(ROOT, 'routes', file), out, 'utf8');
  console.log('Wrote', file);
  return { start: start1, end: end1 };
}

const commonCtx = 'q, pool, auth, parsePagination, sendApiError, requireValidSession, requireAdmin, sanitizeString, validatePlateFormat, broadcastEvent, broadcastReportUpdate, withTransaction, computeVehicleSortTs';

const removed = [
  writeRoute('daily-routes.js', 'registerDailyRoutes', commonCtx, 1223, 1315),
  writeRoute('reports-routes.js', 'registerReportsRoutes', `${commonCtx}, formatReportInstant, istanbulMinutesFromTs`, 1715, 2111),
];

let updated = [...lines];
for (const { start, end } of removed.sort((a, b) => b.start - a.start)) {
  updated = updated.slice(0, start - 1).concat(updated.slice(end));
}

let text = updated.join('\n');

if (!text.includes('registerDailyRoutes')) {
  text = text.replace(
    "const { registerProblemRoutes } = require('./routes/problems-routes');",
    `const { registerProblemRoutes } = require('./routes/problems-routes');
const { registerDailyRoutes } = require('./routes/daily-routes');
const { registerReportsRoutes } = require('./routes/reports-routes');
const { formatReportInstant, istanbulMinutesFromTs } = require('./lib/report-format');`
  );
}

text = text.replace(
  'registerVehicleRoutes(api, routeCtx);',
  'registerVehicleRoutes(api, routeCtx);\nregisterDailyRoutes(api, routeCtx);'
);

text = text.replace(
  'registerProblemRoutes(api, routeCtx);',
  'registerProblemRoutes(api, routeCtx);\nregisterReportsRoutes(api, routeCtx);'
);

// routeCtx'e formatReportInstant ekle
if (!text.includes('formatReportInstant,')) {
  text = text.replace(
    'broadcastReportUpdate,',
    'broadcastReportUpdate,\n  formatReportInstant,\n  istanbulMinutesFromTs,'
  );
}

// Inline formatReportInstant kaldır (lib/report-format kullan)
text = text.replace(
  /\n\/\*\* Rapor[\s\S]*?^function istanbulMinutesFromTs\(tsMs\) \{[\s\S]*?^}\n/m,
  '\n'
);

fs.writeFileSync(serverPath, text, 'utf8');
console.log('Updated server.js');
