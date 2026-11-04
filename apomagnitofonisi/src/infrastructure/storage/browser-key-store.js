/**
 * Τα κλειδιά API του χρήστη στον browser. Υλοποιεί τη θύρα KeyStore.
 *
 * - «Στη συσκευή» (προεπιλογή): localStorage, μένουν μετά το κλείσιμο.
 * - «Μόνο για αυτή την καρτέλα»: sessionStorage, σβήνουν όταν κλείσει.
 * Η επιλογή κρατιέται κι αυτή στο localStorage. Η αλλαγή επιλογής μεταφέρει τα
 * κλειδιά από τη μία αποθήκη στην άλλη, ώστε να υπάρχουν πάντα σε μία μόνο.
 */
export const KEYS_STORAGE_KEY = 'apomagnitofonisi.keys.v1';
export const KEYS_MODE_STORAGE_KEY = 'apomagnitofonisi.keys-mode.v1';

const MODE_DEVICE = 'device';
const MODE_SESSION = 'session';

export class BrowserKeyStore {
  #device;
  #session;

  /** @param {{ deviceStorage: Storage|null, sessionStorage: Storage|null }} deps */
  constructor({ deviceStorage, sessionStorage }) {
    this.#device = deviceStorage;
    this.#session = sessionStorage;
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

  isPersistent() {
    return safeGet(this.#device, KEYS_MODE_STORAGE_KEY) !== MODE_SESSION;
  }

  setPersistent(persistent) {
    if (persistent === this.isPersistent()) return;
    const from = this.#active();
    const keys = this.#read(from);
    safeSet(this.#device, KEYS_MODE_STORAGE_KEY, persistent ? MODE_DEVICE : MODE_SESSION);
    this.#write(this.#active(), keys);
    safeRemove(from, KEYS_STORAGE_KEY);
  }

  clearAll() {
    safeRemove(this.#device, KEYS_STORAGE_KEY);
    safeRemove(this.#session, KEYS_STORAGE_KEY);
  }

  #active() {
    return this.isPersistent() ? this.#device : this.#session;
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

function safeGet(storage, key) {
  try { return storage ? storage.getItem(key) : null; } catch { return null; }
}

function safeSet(storage, key, value) {
  try { storage && storage.setItem(key, value); } catch { /* χωρίς αποθήκευση: το κλειδί ισχύει όσο είναι ανοιχτή η σελίδα */ }
}

function safeRemove(storage, key) {
  try { storage && storage.removeItem(key); } catch { /* όπως στο safeSet */ }
}
