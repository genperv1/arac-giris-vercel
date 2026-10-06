'use strict';

const AMIR_USERNAME = 'xxr';
const AMIR_ROLE = 'amir';
const AMIR_LABEL = 'GENPER · AMİR';

function isAmirIdentity(user) {
  const username = String((user && user.username) || '').trim().toLowerCase();
  const role = String((user && user.role) || '').trim().toLowerCase();
  return username === AMIR_USERNAME || username === 'saban' || role === AMIR_ROLE;
}

module.exports = { isAmirIdentity, AMIR_USERNAME, AMIR_ROLE, AMIR_LABEL };
