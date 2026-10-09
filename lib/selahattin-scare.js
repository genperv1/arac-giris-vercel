'use strict';

/** İlk sunucu açılışında bir kez: Selahattin ekranına 1 dk arayla kırmızı giriş denemesi. Sonraki açılışlarda tekrarlamaz. */

const ONCE_KEY = 'selahattin_scare_once_v1';

const TARGET = 'xxr';
const PLAN = [
  ['88.241.46.17', 248],
  ['78.189.112.64', 253],
  ['95.70.201.33', 261],
  ['176.40.18.209', 239],
  ['85.105.77.14', 274],
  ['212.174.58.91', 256],
  ['88.255.14.203', 244],
  ['78.180.96.41', 267],
  ['95.9.144.72', 251],
  ['176.88.23.155', 286],
  ['81.213.44.19', 233],
  ['212.156.70.228', 262],
  ['88.230.61.104', 247],
  ['78.191.8.53', 279],
  ['95.14.220.36', 255],
  ['185.86.41.127', 241],
  ['176.219.54.80', 271],
  ['85.98.33.146', 258],
];

function usernameKey(value) {
  return String(value || '').trim().toLowerCase().slice(0, 80);
}

function clientKey(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{8,32}$/.test(id)) return '';
  return id;
}

function ackKey(username, clientId) {
  const user = usernameKey(username);
  if (user !== TARGET) return '';
  const client = clientKey(clientId);
  return client ? user + '|' + client : user;
}

function createScareNotices(opts) {
  opts = opts || {};
  const setTimer = typeof opts.setTimeout === 'function' ? opts.setTimeout : setTimeout;
  const firstDelayMs = Number.isFinite(opts.firstDelayMs) ? opts.firstDelayMs : 7.5 * 60 * 1000;
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : 60000;
  const nowFn = typeof opts.now === 'function' ? opts.now : Date.now;
  const items = [];
  let started = false;

  function noticeFrom(row, index, ts) {
    const ip = row[0];
    const attempts = row[1];
    const n = String(index + 1).padStart(2, '0');
    const firma = 'NOVATEK — IP ' + ip + ' — giriş denemesi ' + attempts + ' — sistem tarafından engellendi';
    return {
      id: 'scare-nv-' + n,
      kind: 'scare',
      plate: ip,
      firma,
      malzeme: '',
      ts,
      text: firma,
      ackedBy: {},
    };
  }

  function start(onEmit) {
    if (started) return false;
    started = true;
    PLAN.forEach((row, index) => {
      setTimer(() => {
        const notice = noticeFrom(row, index, nowFn());
        items.push(notice);
        if (typeof onEmit === 'function') onEmit(publicNotice(notice));
      }, firstDelayMs + index * intervalMs);
    });
    return true;
  }

  function publicNotice(item) {
    return {
      id: item.id,
      kind: 'scare',
      plate: item.plate,
      firma: item.firma,
      malzeme: '',
      ts: item.ts,
      text: item.text,
    };
  }

  function unread(username, clientId) {
    const key = ackKey(username, clientId);
    if (!key) return [];
    return items
      .filter((item) => !item.ackedBy[key])
      .map(publicNotice);
  }

  function ack(id, username, clientId) {
    const key = ackKey(username, clientId);
    const wanted = String(id || '').trim();
    if (!key || !wanted) return false;
    const item = items.find((row) => row.id === wanted);
    if (!item) return false;
    item.ackedBy[key] = nowFn();
    return true;
  }

  return { start, unread, ack, planSize: PLAN.length };
}

const shared = createScareNotices();

function startSelahattinScare(onEmit) {
  return shared.start(onEmit);
}

/** true: bu süreç diziyi kurabilir. false: daha önce bir kez kurulmuş. */
async function claimScareOnce(q) {
  const ins = await q(
    `INSERT INTO kv_store(key, value)
     VALUES($1,$2)
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [ONCE_KEY, JSON.stringify({ startedAt: Date.now() })]
  );
  return !!(ins && ins.rows && ins.rows[0]);
}

function unreadScareNotices(username, clientId) {
  return shared.unread(username, clientId);
}

function ackScareNotice(id, username, clientId) {
  return shared.ack(id, username, clientId);
}

module.exports = {
  createScareNotices,
  startSelahattinScare,
  claimScareOnce,
  unreadScareNotices,
  ackScareNotice,
};
