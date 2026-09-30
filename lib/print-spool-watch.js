'use strict';

const { spawn } = require('child_process');
const path = require('path');

const SEEN_TTL_MS = 3 * 60 * 1000;
const TOKEN_RE = /TF[A-Z0-9]{8}/g;
const seen = new Map();

let child = null;
let restartTimer = null;
let allowRestart = false;

function rememberDocument(doc, now = Date.now()) {
  const text = String(doc || '').replace(/\u0000/g, '').trim();
  if (!text) return;
  const key = text.toUpperCase();
  if (!seen.has(key)) console.log('Yazıcı kuyruğu:', text);
  seen.set(key, now);
  const matches = text.toUpperCase().match(TOKEN_RE);
  if (matches) matches.forEach((token) => seen.set(token, now));
}

function prune(now = Date.now()) {
  for (const [key, ts] of seen) {
    if (now - ts > SEEN_TTL_MS) seen.delete(key);
  }
}

function hasToken(token, now = Date.now()) {
  prune(now);
  const t = String(token || '').trim().toUpperCase();
  if (!/^TF[A-Z0-9]{8}$/.test(t)) return false;
  for (const [key, ts] of seen) {
    if (now - ts > SEEN_TTL_MS) continue;
    if (key === t || key.includes(t)) return true;
  }
  return false;
}

function isWatching() {
  return !!(child && !child.killed && child.exitCode == null);
}

function stop() {
  allowRestart = false;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    const current = child;
    child = null;
    try { current.kill(); } catch (e) {}
  }
}

function start() {
  if (process.platform !== 'win32') return;
  if (isWatching()) return;
  allowRestart = true;
  const script = path.join(__dirname, '..', 'scripts', 'print-spool-watch.ps1');
  child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      rememberDocument(line);
    }
  });
  let loggedErr = false;
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (!text || loggedErr) return;
    loggedErr = true;
    console.warn('Yazıcı kuyruğu izleme:', text);
  });
  child.on('exit', () => {
    child = null;
    if (!allowRestart || restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      start();
    }, 1000);
  });
}

function resetForTests() {
  seen.clear();
}

module.exports = {
  start,
  stop,
  isWatching,
  hasToken,
  rememberDocument,
  resetForTests,
};
