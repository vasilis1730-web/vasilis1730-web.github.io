/**
 * Τα κλειδιά API του χρήστη (ElevenLabs, Anthropic): αποθήκευση μόνο στη
 * συσκευή του, έλεγχος εγκυρότητας και επιλογή αν μένουν στη συσκευή ή μόνο
 * για την τρέχουσα καρτέλα. Η εφαρμογή δεν έχει δικό της server: τα κλειδιά
 * πηγαίνουν μόνο στον πάροχο τον οποίο αφορούν.
 */
import { AppError, ERROR_CODES, toAppError } from './errors.js';

export class ApiKeyService {
  #store;
  #verifiers;

  /**
   * @param {Object} deps
   * @param {import('./ports.js').KeyStore} deps.keyStore
   * @param {import('./ports.js').KeyVerifier[]} deps.verifiers
   */
  constructor({ keyStore, verifiers }) {
    this.#store = keyStore;
    this.#verifiers = new Map(verifiers.map(v => [v.provider, v]));
  }

  /** @param {import('./ports.js').KeyProvider} provider */
  hasKey(provider) {
    return Boolean(this.#store.getKey(provider));
  }

  /** Οι τελευταίοι 4 χαρακτήρες, για να αναγνωρίζει ο χρήστης ποιο κλειδί έχει βάλει. */
  keyHint(provider) {
    const key = this.#store.getKey(provider);
    return key ? key.slice(-4) : null;
  }

  saveKey(provider, key) {
    const clean = String(key ?? '').trim();
    if (!clean || /\s/.test(clean)) throw new AppError(ERROR_CODES.INVALID_INPUT, 'το κλειδί είναι κενό ή έχει κενά');
    this.#store.setKey(provider, clean);
  }

  removeKey(provider) {
    this.#store.removeKey(provider);
  }

  /** Ελέγχει το αποθηκευμένο κλειδί (ή αυτό που δίνεται) με ένα φθηνό αίτημα στον πάροχο. */
  async verify(provider, key = this.#store.getKey(provider)) {
    if (!key) throw new AppError(ERROR_CODES.KEY_MISSING, `λείπει το κλειδί ${provider}`);
    const verifier = this.#verifiers.get(provider);
    if (!verifier) throw new AppError(ERROR_CODES.INVALID_INPUT, `άγνωστος πάροχος ${provider}`);
    try {
      await verifier.verify(key);
    } catch (error) {
      throw toAppError(error);
    }
  }

  setPersistent(persistent) {
    this.#store.setPersistent(Boolean(persistent));
  }

  isPersistent() {
    return this.#store.isPersistent();
  }

  clearAll() {
    this.#store.clearAll();
  }
}
