const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../lib/excel-utils.js'), 'utf8');
const body = src.replace(/^'use strict';\s*/m, '').replace('module.exports =', 'var ExcelUtils =');
const out = `(function () {\n'use strict';\n${body}\nwindow.ExcelUtils = ExcelUtils;\n})();\n`;
fs.writeFileSync(path.join(__dirname, '../public/excel-utils.js'), out);
console.log('Wrote public/excel-utils.js');
