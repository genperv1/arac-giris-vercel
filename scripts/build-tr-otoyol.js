'use strict';

const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const dest = process.argv[3] || path.join(__dirname, '..', 'public', 'data', 'tr-otoyol.json');
if (!src) {
  console.error('usage: node scripts/build-tr-otoyol.js <overpass.json> [out.json]');
  process.exit(1);
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function perp(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function simplify(points, eps) {
  if (points.length < 3) return points.slice();
  let max = 0;
  let idx = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perp(points[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  const left = simplify(points.slice(0, idx + 1), eps);
  const right = simplify(points.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

function keyOf(pt) {
  return round4(pt[0]).toFixed(3) + ',' + round4(pt[1]).toFixed(3);
}

function lengthDeg(line) {
  let n = 0;
  for (let i = 1; i < line.length; i++) {
    n += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  }
  return n;
}

function refName(ref) {
  const raw = String(ref || '').split(';')[0].trim();
  return raw || 'Otoyol';
}

function isToll(tags) {
  const toll = String((tags && tags.toll) || '').toLowerCase();
  if (toll === 'yes') return true;
  if (toll === 'no') return false;
  return /^O-?\d/i.test(refName(tags && tags.ref));
}

const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const elements = raw.elements || [];
const pieces = [];
for (const el of elements) {
  const geom = el.geometry || [];
  if (geom.length < 2) continue;
  const tags = el.tags || {};
  const ad = refName(tags.ref);
  let line = geom.map((p) => [round4(p.lon), round4(p.lat)]);
  line = simplify(line, 0.004);
  if (line.length < 2) continue;
  if (lengthDeg(line) < 0.008) continue;
  pieces.push({ ad: ad, parali: isToll(tags), koord: line });
}

function chain(list) {
  const unused = list.slice();
  const out = [];
  while (unused.length) {
    let cur = unused.pop();
    let grew = true;
    while (grew) {
      grew = false;
      const head = keyOf(cur.koord[0]);
      const tail = keyOf(cur.koord[cur.koord.length - 1]);
      for (let i = unused.length - 1; i >= 0; i--) {
        const other = unused[i];
        if (other.ad !== cur.ad || other.parali !== cur.parali) continue;
        const oh = keyOf(other.koord[0]);
        const ot = keyOf(other.koord[other.koord.length - 1]);
        if (tail === oh) {
          cur = { ad: cur.ad, parali: cur.parali, koord: cur.koord.concat(other.koord.slice(1)) };
          unused.splice(i, 1);
          grew = true;
          break;
        }
        if (tail === ot) {
          cur = { ad: cur.ad, parali: cur.parali, koord: cur.koord.concat(other.koord.slice(0, -1).reverse()) };
          unused.splice(i, 1);
          grew = true;
          break;
        }
        if (head === ot) {
          cur = { ad: cur.ad, parali: cur.parali, koord: other.koord.concat(cur.koord.slice(1)) };
          unused.splice(i, 1);
          grew = true;
          break;
        }
        if (head === oh) {
          cur = { ad: cur.ad, parali: cur.parali, koord: other.koord.slice().reverse().concat(cur.koord.slice(1)) };
          unused.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    out.push(cur);
  }
  return out;
}

const yollar = chain(pieces).map((row, i) => ({
  id: row.ad + '-' + i,
  ad: row.ad,
  parali: row.parali,
  koord: row.koord,
}));

let pts = 0;
let toll = 0;
for (const row of yollar) {
  pts += row.koord.length;
  if (row.parali) toll++;
}

const body = JSON.stringify({ yollar: yollar });
fs.writeFileSync(dest, body);
console.log(JSON.stringify({
  ways: elements.length,
  pieces: pieces.length,
  chains: yollar.length,
  tollChains: toll,
  points: pts,
  bytes: Buffer.byteLength(body),
}, null, 2));
