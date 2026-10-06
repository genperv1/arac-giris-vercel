'use strict';

const AMIR_USERNAME = 'xxr';
const AMIR_ROLE = 'amir';
const AMIR_LABEL = 'GENPER · AMİR';

function isAmirIdentity(user) {
  const username = String((user && user.username) || '').trim().toLowerCase();
  const role = String((user && user.role) || '').trim().toLowerCase();
  return username === AMIR_USERNAME || username === 'saban' || username === 'ugur' || role === AMIR_ROLE;
}

function canDirectMessage(user) {
  const username = String((user && user.username) || '').trim().toLowerCase();
  return username === AMIR_USERNAME || username === 'saban';
}

/** Liman listesini kapatma, yeniden açma ve kaldırma: yalnız Selahattin Toker (xxr). */
function canManageLimanList(user) {
  const username = String((user && user.username) || '').trim().toLowerCase();
  return username === AMIR_USERNAME;
}

module.exports = { isAmirIdentity, canDirectMessage, canManageLimanList, AMIR_USERNAME, AMIR_ROLE, AMIR_LABEL };
