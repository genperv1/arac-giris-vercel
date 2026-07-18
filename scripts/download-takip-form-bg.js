#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'takip-form-bg.jpg');
const URLS = [
  'https://i.hizliresim.com/36cc3jp.jpg',
  'https://hizliresim.com/36cc3jp.jpg',
];

function fetchBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        Referer: 'https://hizliresim.com/36cc3jp',
        ...headers,
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchBuffer(res.headers.location, headers).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(chunks), type: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (const url of URLS) {
    try {
      const { status, buf, type } = await fetchBuffer(url);
      console.log(url, '->', status, buf.length, type, buf.slice(0, 4).toString('hex'));
      if (buf.length > 10000 && buf[0] === 0xff && buf[1] === 0xd8) {
        fs.writeFileSync(OUT, buf);
        console.log('Saved', OUT, buf.length);
        return;
      }
    } catch (e) {
      console.log(url, 'error', e.message);
    }
  }
  console.log('Could not download valid JPEG.');
  process.exit(1);
}

main();
