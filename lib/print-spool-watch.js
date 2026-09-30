'use strict';

const { spawn } = require('child_process');
const path = require('path');

const SEEN_TTL_MS = 3 * 60 * 1000;
const TOKEN_RE = /TF[A-Z0-9]{8}/g;
const seen = new Map();
const jobs = [];

let child = null;
let restartTimer = null;
let allowRestart = false;
let seq = 0;
let consumedSeq = 0;
let loggedReady = false;

function rememberDocument(doc, now = Date.now()) {
  const raw = String(doc || '').replace(/\u0000/g, '').trim();
  if (!raw || raw === 'READY') return;
  let jobId = '';
  let text = raw;
  const tab = raw.indexOf('\t');
  if (tab > 0 && /^\d+$/.test(raw.slice(0, tab))) {
    jobId = raw.slice(0, tab);
    text = raw.slice(tab + 1).trim();
  }
  if (!text) return;
  const key = text.toUpperCase();
  const idKey = jobId ? ('#' + jobId) : '';
  // Aynı iş kuyrukta durduğu sürece tekrar sayılmaz. İş düşünce yarım saniye sonra
  // gelen aynı numara yeni yazdırmadır (kullanıcı ayrımı yok).
  if (idKey && seen.has(idKey) && now - seen.get(idKey) < 500) {
    seen.set(idKey, now);
    return;
  }
  seq += 1;
  console.log('Yazıcı kuyruğu:', text);
  seen.set(key, now);
  if (idKey) seen.set(idKey, now);
  jobs.push({ seq, doc: key, ts: now, jobId });
  const matches = key.match(TOKEN_RE);
  if (matches) matches.forEach((token) => seen.set(token, now));
}

function prune(now = Date.now()) {
  for (const [key, ts] of seen) {
    if (now - ts > SEEN_TTL_MS) seen.delete(key);
  }
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (now - jobs[i].ts > SEEN_TTL_MS) jobs.splice(i, 1);
  }
}

function currentSeq() {
  return seq;
}

function openJobs(now = Date.now()) {
  prune(now);
  return jobs.filter((j) => j.seq > consumedSeq && now - j.ts <= SEEN_TTL_MS);
}

function hasJobSince(sinceSeq, now = Date.now()) {
  const n = Number(sinceSeq);
  if (!Number.isFinite(n) || n < 0) return false;
  return openJobs(now).some((j) => j.seq > n);
}

function hasRecentJob(withinMs, now = Date.now()) {
  const windowMs = Math.min(Math.max(Number(withinMs) || 0, 0), 30000);
  if (!windowMs) return false;
  return openJobs(now).some((j) => now - j.ts <= windowMs && now - j.ts >= 0);
}

function consumeJobs(now = Date.now()) {
  for (const j of openJobs(now)) {
    if (j.seq > consumedSeq) consumedSeq = j.seq;
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
  child.stdout.on('data', (chunk) => {
    const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const text = (raw.length >= 4 && raw[1] === 0 && raw[3] === 0)
      ? raw.toString('utf16le')
      : raw.toString('utf8');
    buf += text;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.trim() === 'READY') {
        if (!loggedReady) {
          loggedReady = true;
          console.log('Yazıcı kuyruğu izleniyor');
        }
        continue;
      }
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
  jobs.length = 0;
  seq = 0;
  consumedSeq = 0;
}

module.exports = {
  start,
  stop,
  isWatching,
  hasToken,
  hasJobSince,
  hasRecentJob,
  consumeJobs,
  currentSeq,
  rememberDocument,
  resetForTests,
};
