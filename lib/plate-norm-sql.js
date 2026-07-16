'use strict';

function plateNormSql(col) {
  return `regexp_replace(regexp_replace(lower(coalesce(${col}, '')), E'\\\\s+', '', 'g'), '[^a-z0-9ığüşöç]+', '', 'gi')`;
}

const PLATE_NORM_SQL = plateNormSql('plaka');
const PLATE_NORM_SQL_PH = plateNormSql('ph.plaka');

module.exports = { plateNormSql, PLATE_NORM_SQL, PLATE_NORM_SQL_PH };
