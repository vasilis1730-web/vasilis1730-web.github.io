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
 * Τελευταίο στρώμα, στη μνήμη (API-026): όταν ο browser δεν επιτρέπει
 * αποθήκευση, ένα κλειδί που μόλις αποθηκεύτηκε ισχύει όσο είναι ανοιχτή η
 * σελίδα, αντί να χάνεται ενώ η διεπαφή λέει «αποθηκεύτηκε».
 *
 * @typedef {import('../../application/key-providers.js').KeyRetention} KeyRetention
 */
import { KEY_RETENTIONS } from '../../application/key-providers.js';
import { requireWebStorage, safeGet, safeSet, safeRemove } from './web-storage.js';

export const KEYS_STORAGE_KEY = 'apomagnitofonisi.keys.v1';
export const KEYS_MODE_STORAGE_KEY = 'apomagnitofonisi.keys-mode.v1';

export class BrowserKeyStore {
  #device;
  #session;
  /** Κλειδιά που ο browser δεν άφησε να αποθηκευτούν: ισχύουν όσο είναι ανοιχτή η σελίδα (API-026). */
  #inMemory = {};

  /**
   * @param {{ localStorage: Storage|null, sessionStorage: Storage|null }} deps
   *   null: ο browser δεν επιτρέπει αυτή την αποθήκη (π.χ. αποκλεισμένα cookies)
   */
  constructor({ localStorage, sessionStorage }) {
    this.#device = requireWebStorage(localStorage, 'localStorage του BrowserKeyStore');
    this.#session = requireWebStorage(sessionStorage, 'sessionStorage του BrowserKeyStore');
  }

  getKey(provider) {
    const stored = this.#read(this.#active())[provider];
    if (typeof stored === 'string' && stored) return stored;
    const kept = this.#inMemory[provider];
    return typeof kept === 'string' && kept ? kept : null;
  }

  setKey(provider, key) {
    const storage = this.#active();
    if (this.#write(storage, { ...this.#read(storage), [provider]: key })) delete this.#inMemory[provider];
    else this.#inMemory[provider] = key;
  }

  removeKey(provider) {
    const storage = this.#active();
    const keys = this.#read(storage);
    delete keys[provider];
    this.#write(storage, keys);
    delete this.#inMemory[provider];
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

  /** Διαγραφή των κλειδιών και της επιλογής διατήρησης (OO-002): δεν μένει τίποτα, ούτε στη μνήμη. */
  clear() {
    safeRemove(this.#device, KEYS_STORAGE_KEY);
    safeRemove(this.#session, KEYS_STORAGE_KEY);
    safeRemove(this.#device, KEYS_MODE_STORAGE_KEY);
    this.#inMemory = {};
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

  /** Γράφει τα κλειδιά. Επιστρέφει αν αποθηκεύτηκαν (false: ο browser αρνείται την αποθήκευση). */
  #write(storage, keys) {
    if (Object.keys(keys).length) return safeSet(storage, KEYS_STORAGE_KEY, JSON.stringify(keys));
    safeRemove(storage, KEYS_STORAGE_KEY);
    return true;
  }
}
