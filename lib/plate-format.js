/**
 * Turkish plate format check (server + tests).
 * Accepts: 34 ABC 1234, 34ABC1234, 34 A 123, 06 AA 1234, etc.
 */
function validatePlateFormat(plate) {
  if (!plate) return true;
  const plateRegex = /^[0-9]{2}\s*[A-ZÇĞİÖŞÜ]{1,3}\s*[0-9]{1,5}$/i;
  return plateRegex.test(String(plate).trim());
}

module.exports = { validatePlateFormat };
