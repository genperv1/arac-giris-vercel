'use strict';

const AMIR_USERNAME = 'xxr';
const DEV_USERNAME = 'burak';
const AMIR_ROLE = 'amir';
const AMIR_LABEL = 'GENPER · AMİR';

function usernameOf(user) {
  return String((user && user.username) || '').trim().toLowerCase();
}

/** Selahattin Toker ile aynı yetkiler: Burak Karataş. */
function isLeadAmir(user) {
  const username = usernameOf(user);
  return username === AMIR_USERNAME || username === DEV_USERNAME;
}

function isAmirIdentity(user) {
  const username = usernameOf(user);
  const role = String((user && user.role) || '').trim().toLowerCase();
  return isLeadAmir(user) || username === 'saban' || username === 'ugur' || role === AMIR_ROLE;
}

function canDirectMessage(user) {
  const username = usernameOf(user);
  return isLeadAmir(user) || username === 'saban';
}

/** Liman listesini kapatma, yeniden açma ve kaldırma: Selahattin Toker ve Burak Karataş. */
function canManageLimanList(user) {
  return isLeadAmir(user);
}

module.exports = {
  isAmirIdentity,
  isLeadAmir,
  canDirectMessage,
  canManageLimanList,
  AMIR_USERNAME,
  DEV_USERNAME,
  AMIR_ROLE,
  AMIR_LABEL,
};
