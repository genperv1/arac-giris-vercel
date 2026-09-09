'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const core = fs.readFileSync(
  path.join(__dirname, '../public/modules/piyasa-core.js'),
  'utf8'
);
const start = core.indexOf('// --- HP13 çoklu malzeme ---');
const end = core.indexOf('// --- /HP13 çoklu malzeme ---');
assert.ok(start >= 0 && end > start, 'HP13 helpers not found');
const {
  isHp13Firma,
  canAddHp13MultiItem,
  formatHp13MultiLine,
  formatHp13QtyLabel,
  composeHp13Malzeme,
  composeHp13Note,
  hp13GridParts,
  parseHp13PartsFromText,
  sumHp13Bbt,
} = eval(`(function(){\n${core.slice(start, end)}\nreturn { isHp13Firma, canAddHp13MultiItem, formatHp13MultiLine, formatHp13QtyLabel, composeHp13Malzeme, composeHp13Note, hp13GridParts, parseHp13PartsFromText, sumHp13Bbt };})()`);

test('isHp13Firma matches only HP13', () => {
  assert.equal(isHp13Firma('HP13'), true);
  assert.equal(isHp13Firma('hp13'), true);
  assert.equal(isHp13Firma('HP13 / ANKARA'), true);
  assert.equal(isHp13Firma('HP13/GEBZE'), true);
  assert.equal(isHp13Firma('HP130'), false);
  assert.equal(isHp13Firma('HP1'), false);
  assert.equal(isHp13Firma('HP2'), false);
  assert.equal(isHp13Firma('YD13'), false);
  assert.equal(isHp13Firma(''), false);
});

test('HP13 line formats kod + malzeme + BBT', () => {
  assert.equal(
    formatHp13MultiLine({ malzeme: 'Expanded Perlite', kod: 'P2', bbt: '12' }),
    '12 BBT P2 Expanded Perlite'
  );
  assert.equal(formatHp13MultiLine({ malzeme: 'P05', kod: '', bbt: '8' }), '8 BBT P05');
  assert.equal(formatHp13MultiLine({ malzeme: '', kod: 'P2', bbt: '4' }), '4 BBT P2');
  assert.equal(formatHp13MultiLine({ malzeme: 'Ham perlit', kod: 'Silo-2', bbt: '' }), 'Silo-2 Ham perlit');
});

test('HP13 compose joins rows with slash', () => {
  const text = composeHp13Malzeme([
    { malzeme: 'Expanded Perlite', kod: 'P2', bbt: '12' },
    { malzeme: 'P05', kod: '', bbt: '8' },
  ]);
  assert.equal(text, '12 BBT P2 Expanded Perlite / 8 BBT P05');
});

test('HP13 BBT sum and add rules', () => {
  assert.equal(sumHp13Bbt([
    { bbt: '12' },
    { bbt: '8' },
    { bbt: '2,5' },
  ]), 22.5);
  assert.equal(canAddHp13MultiItem({ malzeme: 'P2', kod: '', bbt: '' }), true);
  assert.equal(canAddHp13MultiItem({ malzeme: '', kod: 'P05', bbt: '4' }), true);
  assert.equal(canAddHp13MultiItem({ malzeme: '', kod: '', bbt: '10' }), false);
  assert.equal(canAddHp13MultiItem({ malzeme: '', kod: '', bbt: '' }), false);
});

test('HP13 qty label adds BBT from a plain number', () => {
  assert.equal(formatHp13QtyLabel({ bbt: '10' }), '10 BBT');
  assert.equal(formatHp13QtyLabel({ bbt: '10 BBT' }), '10 BBT');
  assert.equal(formatHp13QtyLabel({ bbt: '' }), '');
  assert.equal(
    formatHp13MultiLine({ malzeme: 'HP 0.15-0.60', kod: '', bbt: '15' }),
    '15 BBT HP 0.15-0.60'
  );
});

test('HP13 note matches SARILAN lines and squares keep qty/name', () => {
  const items = [
    { malzeme: 'HP 0.15-0.60', kod: '', bbt: '15' },
    { malzeme: 'HP 0.074-0.30', kod: '', bbt: '10' },
    { malzeme: 'HP 0.15-0.60', kod: '615', bbt: '22' },
  ];
  assert.equal(
    composeHp13Note(items),
    '15 BBT HP 0.15-0.60\n10 BBT HP 0.074-0.30\n22 BBT 615 HP 0.15-0.60'
  );
  const parts = hp13GridParts(items);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].qty, '15 BBT');
  assert.equal(parts[0].desc, 'HP 0.15-0.60');
  assert.equal(parts[2].desc, '615 HP 0.15-0.60');
});

test('parseHp13PartsFromText rebuilds squares from slash/note text', () => {
  const parts = parseHp13PartsFromText(
    '10 BBT HP 0.074-0.60 / 20 BBT HP 1.20-2.40 / 30 BBT HP 1.20-2.40'
  );
  assert.equal(parts.length, 3);
  assert.equal(parts[0].qty, '10 BBT');
  assert.equal(parts[0].desc, 'HP 0.074-0.60');
  assert.equal(parts[1].qty, '20 BBT');
  assert.equal(parts[2].qty, '30 BBT');

  const fromNote = parseHp13PartsFromText(
    '10 BBT HP 0.074-0.60\n20 BBT HP 1.20-2.40 30 BBT HP 1.20-2.40'
  );
  assert.equal(fromNote.length, 3);
  assert.equal(fromNote[0].qty, '10 BBT');
  assert.equal(fromNote[1].qty, '20 BBT');
  assert.equal(fromNote[2].qty, '30 BBT');
});
