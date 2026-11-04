/**
 * Κοινοί βοηθοί για Web Storage (localStorage, sessionStorage): έλεγχος της
 * σύνδεσης και πρόσβαση που δεν σπάει όταν ο browser αρνείται την αποθήκευση
 * (ιδιωτική περιήγηση, αποκλεισμένα cookies, γεμάτος χώρος).
 */

/**
 * null (ο browser δεν επιτρέπει αυτή την αποθήκη) ή αντικείμενο με
 * getItem/setItem/removeItem. Οτιδήποτε άλλο (π.χ. undefined από λάθος όνομα
 * στη σύνδεση) είναι λάθος του κώδικα και απορρίπτεται αμέσως (API-018, API-026).
 * @param {unknown} storage
 * @param {string} name  για το μήνυμα, π.χ. «localStorage του BrowserKeyStore»
 * @returns {Storage|null}
 */
export function requireWebStorage(storage, name) {
  if (storage === null) return null;
  const valid = storage != null && ['getItem', 'setItem', 'removeItem'].every(method => typeof storage[method] === 'function');
  if (!valid) throw new TypeError(`το ${name} πρέπει να είναι Web Storage ή null`);
  return /** @type {Storage} */ (storage);
}

/** Η τιμή του κλειδιού, ή null όταν λείπει ή ο browser αρνείται την ανάγνωση. */
export function safeGet(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}

/** Αποθηκεύει την τιμή. Επιστρέφει αν αποθηκεύτηκε. */
export function safeSet(storage, key, value) {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Σβήνει το κλειδί. Επιστρέφει αν έγινε (ή αν δεν υπήρχε αποθήκη να το κρατά). */
export function safeRemove(storage, key) {
  if (!storage) return true;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
