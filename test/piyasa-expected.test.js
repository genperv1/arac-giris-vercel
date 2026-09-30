const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePiyasaExpectedPaste,
  sanitizeExpectedItems,
  matchExpectedByPlate,
  orderMatchesQuery,
  platesMissingFromRegistry,
} = require('../public/modules/piyasa-expected');

test('çekici ve dorse satırları, isim, telefon, TC', () => {
  const parsed = parsePiyasaExpectedPaste([
    'Çekici 42 ATT 321',
    'Dorse 42 AJD 506',
    'YASİN ADIGÜZEL',
    '+905306091555',
    'TC 390 137 699 18',
    '',
    'Çekici 34 HF 4886',
    'Dorse 42 EEU 49.',
    'HAMZA KALKAN.',
    'TC 16535030238.',
    '05416701625',
    '',
    'HP38 ARAÇ BİLGİLERİ',
  ].join('\n'));
  assert.equal(parsed.vehicles.length, 2);
  assert.deepEqual(parsed.vehicles[0], {
    cekici: '42ATT321',
    dorse: '42AJD506',
    sofor: 'YASİN ADIGÜZEL',
    telefon: '5306091555',
    tc: '39013769918',
    label: 'HP38',
  });
  assert.equal(parsed.vehicles[1].cekici, '34HF4886');
  assert.equal(parsed.vehicles[1].dorse, '42EEU49');
  assert.equal(parsed.vehicles[1].sofor, 'HAMZA KALKAN');
  assert.equal(parsed.vehicles[1].telefon, '5416701625');
  assert.equal(parsed.vehicles[1].tc, '16535030238');
  assert.equal(parsed.vehicles[1].label, 'HP38');
});

test('tek satırda iki plaka, isim, telefon ve TC', () => {
  const parsed = parsePiyasaExpectedPaste('19 nd 921 19 sav 402 Orhan kaçan 5453451797 34711237110\nİ110 ARAÇ BİLGİLERİ');
  assert.equal(parsed.vehicles.length, 1);
  assert.equal(parsed.vehicles[0].cekici, '19ND921');
  assert.equal(parsed.vehicles[0].dorse, '19SAV402');
  assert.equal(parsed.vehicles[0].sofor, 'Orhan kaçan');
  assert.equal(parsed.vehicles[0].telefon, '5453451797');
  assert.equal(parsed.vehicles[0].tc, '34711237110');
  assert.equal(parsed.vehicles[0].label, 'I110');
});

test('cümle içindeki plaka ve CR etiketi', () => {
  const parsed = parsePiyasaExpectedPaste('Araç plakası bugün gelecek olan 06 etz 736\nCR2 ARAÇ BİLGİLERİ');
  assert.equal(parsed.vehicles.length, 1);
  assert.equal(parsed.vehicles[0].cekici, '06ETZ736');
  assert.equal(parsed.vehicles[0].dorse, '');
  assert.equal(parsed.vehicles[0].label, 'CR2');
  assert.equal(parsed.vehicles[0].sofor, '');
});

test('bitişik plakalar ve aralıklı telefon', () => {
  const parsed = parsePiyasaExpectedPaste('42BFH523\n42AED248\n18911429162\nAhmet temel\n0543 266 08 93');
  assert.equal(parsed.vehicles.length, 1);
  assert.equal(parsed.vehicles[0].cekici, '42BFH523');
  assert.equal(parsed.vehicles[0].dorse, '42AED248');
  assert.equal(parsed.vehicles[0].sofor, 'Ahmet temel');
  assert.equal(parsed.vehicles[0].telefon, '5432660893');
  assert.equal(parsed.vehicles[0].tc, '18911429162');
});

test('kayıt aynı plakada yenilenir ve eski hafta eşleşmez', () => {
  const items = sanitizeExpectedItems([
    { weekKey: '2026:40', cekici: '42 fdv 63', dorse: '42 bhp 062', orderKey: '40:a:1', label: 'hp38', firma: 'HP38', sofor: 'Eski' },
    { weekKey: '2026:40', cekici: '42FDV63', orderKey: '40:a:2', label: 'HP38', firma: 'HP38', sofor: 'Yeni', telefon: '05321234567', tc: '10000000146' },
    { weekKey: '2026:39', cekici: '42FDV63', orderKey: '39:a:1', label: 'HP38' },
    { weekKey: 'nope', cekici: '42FDV63' },
  ]);
  assert.equal(items.length, 2);
  const now = matchExpectedByPlate(items, '42 FDV 63', '2026:40');
  assert.equal(now.length, 1);
  assert.equal(now[0].sofor, 'Yeni');
  assert.equal(now[0].orderKey, '40:a:2');
  assert.equal(matchExpectedByPlate(items, '42 FDV 63', '2026:41').length, 0);
  assert.equal(matchExpectedByPlate(items, '42 BHP 062', '2026:40').length, 0);
});

test('kayıtlı olmayan plaka uyarı listesine girer', () => {
  const vehicles = [{ cekiciPlaka: '34 ABC 123' }, { cekiciPlaka: '06 ETZ 736' }];
  assert.deepEqual(platesMissingFromRegistry(['34ABC123', '42 FDV 63'], vehicles), ['42FDV63']);
  assert.deepEqual(platesMissingFromRegistry(['34 ABC 123'], vehicles), []);
  assert.deepEqual(platesMissingFromRegistry(['42 FDV 63'], []), []);
});

test('etiket sipariş satırında kelime olarak durur', () => {
  const hp38 = { firma: 'HP38', malzeme: 'KUM', il: 'ANKARA' };
  const hp380 = { firma: 'HP380', malzeme: 'KUM' };
  const hp3 = { firma: 'HP3', malzeme: 'KUM' };
  assert.equal(orderMatchesQuery(hp38, 'HP38'), true);
  assert.equal(orderMatchesQuery(hp380, 'HP38'), false);
  assert.equal(orderMatchesQuery(hp3, 'HP38'), false);
  assert.equal(orderMatchesQuery({ firma: 'İ110', malzeme: 'UN' }, 'I110'), true);
});
