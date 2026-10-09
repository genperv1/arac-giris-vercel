const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'excel-ajan');

test('kantar ajan dosyalari yerinde', () => {
  for (const name of ['ajan.ps1', 'baslat.bat', 'durdur.bat', 'kaldir.bat', 'ayar.ornek.txt']) {
    assert.equal(fs.existsSync(path.join(root, name)), true, name);
  }
});

test('ajan sunucunun bekledigi adrese yukler', () => {
  const script = fs.readFileSync(path.join(root, 'ajan.ps1'), 'utf8');
  assert.match(script, /\/api\/excel-agent\/upload/);
  assert.match(script, /x-excel-agent-key/);
  assert.match(script, /\/api\/excel-agent\/ping/);
  assert.match(script, /dropFiles/);
  assert.match(script, /Tamamlandi, kantardan silindi/);
  assert.match(script, /Test-BirakFile/);
  assert.match(script, /WindowStyle Hidden/);
  assert.match(script, /baslat\.bat|Startup/);
});

test('bir eski Excel okunamazsa diger dosyalar sisteme gitmeye devam eder', () => {
  const script = fs.readFileSync(path.join(root, 'ajan.ps1'), 'utf8');
  const start = script.indexOf('foreach ($file in $files)');
  const loop = script.slice(start, script.indexOf('SonGuncelleme', start));
  assert.doesNotMatch(loop, /\bbreak\b/);
  assert.match(loop, /diger dosyalar yine sisteme gider/);
});

test('baslat gizli calistirir', () => {
  const bat = fs.readFileSync(path.join(root, 'baslat.bat'), 'utf8');
  assert.match(bat, /ajan\.ps1" -Kur/);
  assert.match(bat, /ajan\.ps1" -Kontrol/);
});
