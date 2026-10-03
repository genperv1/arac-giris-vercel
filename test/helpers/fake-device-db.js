'use strict';

/**
 * lib/device-tokens.js'in kullandığı SQL cümlelerini bellekte taklit eden mini `q`.
 * Yalnız o modülün sorgu kalıplarını tanır; başka SQL gelirse hata fırlatır (test yanlış yola sapmasın).
 */
function createFakeDeviceDb() {
  const rows = [];

  function clone(r) { return Object.assign({}, r); }

  async function q(sql, params) {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    const p = params || [];
    if (/^CREATE (TABLE|INDEX)/i.test(s)) return { rows: [] };

    if (/^INSERT INTO device_tokens/i.test(s)) {
      rows.push({
        id: p[0], username: p[1], token_hash: p[2], label: p[3],
        created_at: p[4], expires_at: p[5], last_used_at: p[4],
        last_ip: p[6], user_agent: p[7], revoked_at: null,
      });
      return { rows: [], rowCount: 1 };
    }

    if (/^SELECT id FROM device_tokens WHERE username = \$1 AND revoked_at IS NULL AND expires_at > \$2/i.test(s)) {
      const out = rows
        .filter((r) => r.username === p[0] && r.revoked_at == null && Number(r.expires_at) > Number(p[1]))
        .sort((a, b) => Number(b.created_at) - Number(a.created_at))
        .map((r) => ({ id: r.id }));
      return { rows: out };
    }

    if (/^UPDATE device_tokens SET revoked_at = \$1 WHERE id = ANY/i.test(s)) {
      let n = 0;
      rows.forEach((r) => { if (p[1].includes(r.id)) { r.revoked_at = p[0]; n++; } });
      return { rows: [], rowCount: n };
    }

    if (/^SELECT \* FROM device_tokens WHERE id = \$1/i.test(s)) {
      return { rows: rows.filter((r) => r.id === p[0]).map(clone) };
    }

    if (/^UPDATE device_tokens SET last_used_at = \$2/i.test(s)) {
      let n = 0;
      rows.forEach((r) => {
        if (r.id !== p[0]) return;
        r.last_used_at = p[1];
        if (p[2]) r.last_ip = p[2];
        if (p[3]) r.user_agent = p[3];
        n++;
      });
      return { rows: [], rowCount: n };
    }

    if (/^UPDATE device_tokens SET revoked_at = \$2 WHERE id = \$1 AND revoked_at IS NULL/i.test(s)) {
      let n = 0;
      rows.forEach((r) => { if (r.id === p[0] && r.revoked_at == null) { r.revoked_at = p[1]; n++; } });
      return { rows: [], rowCount: n };
    }

    if (/^UPDATE device_tokens SET revoked_at = \$2 WHERE username = \$1 AND revoked_at IS NULL/i.test(s)) {
      let n = 0;
      rows.forEach((r) => { if (r.username === p[0] && r.revoked_at == null) { r.revoked_at = p[1]; n++; } });
      return { rows: [], rowCount: n };
    }

    if (/^SELECT id, username, label, created_at, expires_at, last_used_at, last_ip, user_agent, revoked_at FROM device_tokens WHERE/i.test(s)) {
      const out = rows.filter((r) => (r.revoked_at == null && Number(r.expires_at) > Number(p[0]))
        || (r.revoked_at != null && Number(r.revoked_at) > Number(p[1])));
      return { rows: out.map(clone) };
    }

    throw new Error('fake-device-db: tanınmayan SQL: ' + s.slice(0, 80));
  }

  return { q, rows };
}

module.exports = { createFakeDeviceDb };
