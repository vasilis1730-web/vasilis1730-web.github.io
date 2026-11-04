/**
 * Τα κλειδιά API του χρήστη στον browser. Υλοποιεί τη θύρα KeyStore.
 *
 * - «Στη συσκευή» (προεπιλογή): localStorage, μένουν μετά το κλείσιμο.
 * - «Μόνο για αυτή την καρτέλα»: sessionStorage, σβήνουν όταν κλείσει.
 * Η επιλογή κρατιέται κι αυτή στο localStorage. Η αλλαγή επιλογής μεταφέρει τα
 * κλειδιά από τη μία αποθήκη στην άλλη, ώστε να υπάρχουν πάντα σε μία μόνο.
 *
 * Οι εξαρτήσεις λέγονται με τον μηχανισμό του browser (API-018), localStorage
 * και sessionStorage, ώστε να μη μπερδεύονται με τη θύρα DeviceStorage. Μια
 * αποθήκη που δεν μοιάζει με Web Storage απορρίπτεται αμέσως: αλλιώς η λάθος
 * σύνδεση θα φαινόταν μόνο ως «κλειδιά που χάνονται».
 *
 * @typedef {import('../../application/key-providers.js').KeyRetention} KeyRetention
 */
import { KEY_RETENTIONS } from '../../application/key-providers.js';

export const KEYS_STORAGE_KEY = 'apomagnitofonisi.keys.v1';
export const KEYS_MODE_STORAGE_KEY = 'apomagnitofonisi.keys-mode.v1';

export class BrowserKeyStore {
  #device;
  #session;

  /**
   * @param {{ localStorage: Storage|null, sessionStorage: Storage|null }} deps
   *   null: ο browser δεν επιτρέπει αυτή την αποθήκη (π.χ. αποκλεισμένα cookies)
   */
  constructor({ localStorage, sessionStorage }) {
    this.#device = requireWebStorage(localStorage, 'localStorage');
    this.#session = requireWebStorage(sessionStorage, 'sessionStorage');
  }

  getKey(provider) {
    const value = this.#read(this.#active())[provider];
    return typeof value === 'string' && value ? value : null;
  }

  setKey(provider, key) {
    const storage = this.#active();
    this.#write(storage, { ...this.#read(storage), [provider]: key });
  }

  removeKey(provider) {
    const storage = this.#active();
    const keys = this.#read(storage);
    delete keys[provider];
    this.#write(storage, keys);
  }

  /** @returns {KeyRetention} */
  getKeyRetention() {
    return safeGet(this.#device, KEYS_MODE_STORAGE_KEY) === KEY_RETENTIONS.SESSION ? KEY_RETENTIONS.SESSION : KEY_RETENTIONS.DEVICE;
  }

  /** @param {KeyRetention} retention */
  setKeyRetention(retention) {
    if (retention === this.getKeyRetention()) return;
    const from = this.#active();
    const keys = this.#read(from);
    safeSet(this.#device, KEYS_MODE_STORAGE_KEY, retention === KEY_RETENTIONS.SESSION ? KEY_RETENTIONS.SESSION : KEY_RETENTIONS.DEVICE);
    this.#write(this.#active(), keys);
    safeRemove(from, KEYS_STORAGE_KEY);
  }

  /** Διαγραφή των κλειδιών και της επιλογής διατήρησης (OO-002): δεν μένει τίποτα. */
  clear() {
    safeRemove(this.#device, KEYS_STORAGE_KEY);
    safeRemove(this.#session, KEYS_STORAGE_KEY);
    safeRemove(this.#device, KEYS_MODE_STORAGE_KEY);
  }

  #active() {
    return this.getKeyRetention() === KEY_RETENTIONS.SESSION ? this.#session : this.#device;
  }

  #read(storage) {
    try {
      const value = JSON.parse(safeGet(storage, KEYS_STORAGE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  #write(storage, keys) {
    if (Object.keys(keys).length) safeSet(storage, KEYS_STORAGE_KEY, JSON.stringify(keys));
    else safeRemove(storage, KEYS_STORAGE_KEY);
  }
}

/** null (χωρίς αποθήκη) ή αντικείμενο με getItem/setItem/removeItem, αλλιώς λάθος σύνδεσης (API-018). */
function requireWebStorage(storage, name) {
  if (storage === null) return null;
  const valid = storage != null && ['getItem', 'setItem', 'removeItem'].every(method => typeof storage[method] === 'function');
  if (!valid) throw new TypeError(`το ${name} του BrowserKeyStore πρέπει να είναι Web Storage ή null`);
  return storage;
}

function safeGet(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}

function safeSet(storage, key, value) {
  try { storage && storage.setItem(key, value); } catch { /* χωρίς αποθήκευση: το κλειδί ισχύει όσο είναι ανοιχτή η σελίδα */ }
}

function safeRemove(storage, key) {
  try { storage && storage.removeItem(key); } catch { /* όπως στο safeSet */ }
}
