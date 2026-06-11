'use strict';

const { sanitizeString, parseDateOrEpoch } = require('./sanitize');

const VEH_PLATE_NORM_SQL_CEK = "regexp_replace(regexp_replace(lower(coalesce(cekiciplaka, '')), E'\\\\s+', '', 'g'), '[^a-z0-9ığüşöç]+', '', 'gi')";
const VEH_PLATE_NORM_SQL_DORSE = "regexp_replace(regexp_replace(lower(coalesce(dorseplaka, '')), E'\\\\s+', '', 'g'), '[^a-z0-9ığüşöç]+', '', 'gi')";

const VEHICLE_EDIT_LABELS = {
  cekiciPlaka: 'Çekici plaka',
  dorsePlaka: 'Dorse plaka',
  soforAdi: 'Şoför adı',
  soforSoyadi: 'Şoför soyadı',
  sofor2Adi: '2. şoför adı',
  sofor2Soyadi: '2. şoför soyadı',
  iletisim: 'İletişim',
  tcKimlik: 'TC kimlik',
  defaultFirma: 'Varsayılan firma',
  defaultMalzeme: 'Varsayılan malzeme',
  defaultSevkYeri: 'Varsayılan sevk yeri',
  defaultYuklemeNotu: 'Yükleme notu',
};

const UPSERT_VEHICLE_SQL = `
  INSERT INTO vehicles(id, cekiciPlaka, dorsePlaka, data, sort_ts)
  VALUES($1,$2,$3,$4,$5)
  ON CONFLICT (id) DO UPDATE SET
    cekiciPlaka = EXCLUDED.cekiciPlaka,
    dorsePlaka = EXCLUDED.dorsePlaka,
    data = EXCLUDED.data,
    sort_ts = EXCLUDED.sort_ts
`;

function normPlateForLookup(p) {
  return String(p || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-z0-9ığüşöç]/gi, '');
}

function computeVehicleSortTs(vehicle) {
  return (
    parseDateOrEpoch(vehicle?.kayitTarihi) ||
    parseDateOrEpoch(vehicle?.created_at) ||
    parseDateOrEpoch(vehicle?.ts) ||
    parseDateOrEpoch(vehicle?.lastPrintedAt) ||
    Date.now()
  );
}

function normVehicleEditVal(field, val) {
  const s = String(val ?? '').trim();
  if (field === 'tcKimlik' || field === 'iletisim') return s.replace(/\D/g, '');
  if (field === 'cekiciPlaka' || field === 'dorsePlaka') return normPlateForLookup(s);
  return s.toUpperCase();
}

function buildVehicleEditDiff(oldObj, newObj) {
  const changes = [];
  Object.keys(VEHICLE_EDIT_LABELS).forEach((field) => {
    const label = VEHICLE_EDIT_LABELS[field];
    const ov = normVehicleEditVal(field, oldObj?.[field]);
    const nv = normVehicleEditVal(field, newObj?.[field]);
    if (ov !== nv) {
      changes.push({
        field,
        label,
        old: String(oldObj?.[field] ?? '').trim(),
        new: String(newObj?.[field] ?? '').trim(),
      });
    }
  });
  const summaryParts = changes.slice(0, 2).map((c) => `${c.label}: ${c.old || '—'} → ${c.new || '—'}`);
  let summary = summaryParts.join(' · ');
  if (changes.length > 2) summary += ` (+${changes.length - 2})`;
  return { changes, summary: summary || 'Düzenleme' };
}

async function maybeLogVehicleEdit(q, vehicleId, sanitized, userId) {
  try {
    const existing = await q('SELECT data FROM vehicles WHERE id = $1', [vehicleId]);
    if (!existing.rows[0]) return;
    let oldObj = {};
    try { oldObj = JSON.parse(existing.rows[0].data); } catch (e) { oldObj = {}; }
    const diff = buildVehicleEditDiff(oldObj, sanitized);
    if (!diff.changes.length) return;
    const logId = Date.now().toString() + Math.random().toString(16).slice(2);
    const plaka = sanitizeString(sanitized.cekiciPlaka || oldObj.cekiciPlaka || '', 50);
    await q(
      `INSERT INTO vehicle_edit_log(id, vehicle_id, plaka, summary, changes, user_id, edit_ts)
       VALUES($1, $2, $3, $4, $5, $6, $7)`,
      [
        logId,
        String(vehicleId),
        plaka,
        sanitizeString(diff.summary, 500),
        JSON.stringify(diff.changes),
        sanitizeString(userId || '', 80),
        Date.now(),
      ]
    );
  } catch (e) {
    console.warn('vehicle edit log skipped:', e.message || e);
  }
}

async function upsertVehicleRecord(executor, vehicleLike) {
  const id = String(vehicleLike.id || (Date.now().toString() + Math.random().toString(16).slice(2)));
  const merged = Object.assign({}, vehicleLike, { id });
  const cekiciPlaka = sanitizeString(merged.cekiciPlaka || '', 50);
  const dorsePlaka = sanitizeString(merged.dorsePlaka || '', 50);
  const raw = JSON.stringify(merged);
  const sortTs = computeVehicleSortTs(merged);
  await executor.query(UPSERT_VEHICLE_SQL, [id, cekiciPlaka, dorsePlaka, raw, sortTs]);
  return id;
}

function applyRejectionColumnsToVehicle(vehicle, row) {
  const st = row.rejection_status || null;
  if (st) {
    const numOrNull = (v) => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const startTs = numOrNull(row.rejection_start_ts);
    const endTs = numOrNull(row.rejection_end_ts);
    vehicle.rejection = {
      status: st,
      duration: row.rejection_duration,
      startTs,
      endTs,
    };
    vehicle.rejection_status = st;
    vehicle.rejection_duration = row.rejection_duration || null;
    vehicle.rejection_start_ts = startTs;
    vehicle.rejection_end_ts = endTs;
  } else {
    delete vehicle.rejection;
    delete vehicle.rejection_status;
    delete vehicle.rejection_duration;
    delete vehicle.rejection_start_ts;
    delete vehicle.rejection_end_ts;
  }
}

function mapVehicleRowToApiVehicle(row) {
  try {
    const vehicle = JSON.parse(row.data);
    if (!vehicle.kayitTarihi) {
      if (vehicle.created_at) {
        vehicle.kayitTarihi = new Date(vehicle.created_at).toLocaleString('tr-TR');
      } else if (row.id && /^\d+/.test(row.id)) {
        const timestamp = parseInt(row.id, 10);
        if (timestamp > 1000000000000) {
          vehicle.kayitTarihi = new Date(timestamp).toLocaleString('tr-TR');
        }
      }
    }
    applyRejectionColumnsToVehicle(vehicle, row);
    return vehicle;
  } catch {
    const vehicle = { id: row.id, cekiciPlaka: row.cekiciPlaka, dorsePlaka: row.dorsePlaka };
    applyRejectionColumnsToVehicle(vehicle, row);
    return vehicle;
  }
}

async function fetchVehiclesRowsKeyset(pool, totalLimit, batchSize, statementTimeout) {
  const client = await pool.connect();
  const cols = 'id, cekiciPlaka, dorsePlaka, data, rejection_status, rejection_duration, rejection_start_ts, rejection_end_ts, sort_ts';
  const acc = [];
  try {
    let lastSortTs = null;
    let lastId = null;
    while (acc.length < totalLimit) {
      const need = totalLimit - acc.length;
      const take = Math.min(batchSize, need);
      let text;
      let params;
      if (lastSortTs === null) {
        text = `SELECT ${cols} FROM vehicles ORDER BY sort_ts DESC, id DESC LIMIT $1`;
        params = [take];
      } else {
        text = `SELECT ${cols} FROM vehicles WHERE sort_ts < $2 OR (sort_ts = $2 AND id < $3) ORDER BY sort_ts DESC, id DESC LIMIT $1`;
        params = [take, lastSortTs, lastId];
      }
      const r = await client.query({
        text,
        values: params,
        statement_timeout: statementTimeout,
      });
      if (!r.rows.length) break;
      acc.push(...r.rows);
      const tail = r.rows[r.rows.length - 1];
      lastSortTs = tail.sort_ts;
      lastId = tail.id;
      if (r.rows.length < take) break;
    }
    return acc.slice(0, totalLimit);
  } finally {
    client.release();
  }
}

module.exports = {
  VEH_PLATE_NORM_SQL_CEK,
  VEH_PLATE_NORM_SQL_DORSE,
  normPlateForLookup,
  computeVehicleSortTs,
  maybeLogVehicleEdit,
  upsertVehicleRecord,
  mapVehicleRowToApiVehicle,
  fetchVehiclesRowsKeyset,
};
