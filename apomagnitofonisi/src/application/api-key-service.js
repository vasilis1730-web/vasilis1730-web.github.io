/**
 * Τα κλειδιά API του χρήστη (ElevenLabs, Anthropic): αποθήκευση μόνο στη
 * συσκευή του, έλεγχος εγκυρότητας και επιλογή αν μένουν στη συσκευή ή μόνο
 * για την τρέχουσα καρτέλα. Η εφαρμογή δεν έχει δικό της server: τα κλειδιά
 * πηγαίνουν μόνο στον πάροχο τον οποίο αφορούν.
 *
 * Τα σύνολα των παρόχων και της διατήρησης ζουν στο key-providers.js (CA-012).
 *
 * @typedef {import('./key-providers.js').KeyProvider} KeyProvider
 * @typedef {import('./key-providers.js').KeyRetention} KeyRetention
 */
import { AppError, ERROR_CODES, INPUT_ISSUES, invalidInput, toAppError } from './errors.js';
import { KEY_PROVIDERS, KEY_RETENTIONS } from './key-providers.js';

const PROVIDERS = new Set(Object.values(KEY_PROVIDERS));
const RETENTIONS = new Set(Object.values(KEY_RETENTIONS));

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
    this.#verifiers = new Map(verifiers.map(v => [requireProvider(v.provider), v]));
  }

  /** @param {KeyProvider} provider */
  hasKey(provider) {
    return Boolean(this.#store.getKey(requireProvider(provider)));
  }

  /**
   * Οι τελευταίοι 4 χαρακτήρες, για να αναγνωρίζει ο χρήστης ποιο κλειδί έχει βάλει.
   * @param {KeyProvider} provider
   * @returns {string|null}
   */
  getKeyHint(provider) {
    const key = this.#store.getKey(requireProvider(provider));
    return key ? key.slice(-4) : null;
  }

  /**
   * Αποθήκευση. Κενό κλειδί ή κλειδί με κενά → INVALID_INPUT με την αιτία.
   * @param {KeyProvider} provider
   * @param {string} key
   */
  saveKey(provider, key) {
    requireProvider(provider);
    const clean = String(key ?? '').trim();
    if (!clean) throw invalidInput(INPUT_ISSUES.EMPTY_KEY, 'κενό κλειδί');
    if (/\s/.test(clean)) throw invalidInput(INPUT_ISSUES.KEY_WHITESPACE, 'το κλειδί έχει κενά');
    this.#store.setKey(provider, clean);
  }

  /** @param {KeyProvider} provider */
  removeKey(provider) {
    this.#store.removeKey(requireProvider(provider));
  }

  /**
   * Ελέγχει το αποθηκευμένο κλειδί (ή αυτό που δίνεται) με ένα φθηνό αίτημα στον πάροχο.
   * @param {KeyProvider} provider
   * @param {string|null} [key]
   */
  async verify(provider, key = this.#store.getKey(requireProvider(provider))) {
    const verifier = this.#verifiers.get(requireProvider(provider));
    if (!verifier) throw new RangeError(`δεν υπάρχει έλεγχος για τον πάροχο ${provider}`);
    if (!key) throw new AppError(ERROR_CODES.KEY_MISSING, `λείπει το κλειδί ${provider}`);
    try {
      await verifier.verify(key);
    } catch (error) {
      throw toAppError(error);
    }
  }

  /** @param {KeyRetention} retention  ένα από τα KEY_RETENTIONS */
  setKeyRetention(retention) {
    if (!RETENTIONS.has(retention)) throw new RangeError(`άγνωστη διατήρηση κλειδιών ${retention}`);
    this.#store.setKeyRetention(retention);
  }

  /** @returns {KeyRetention} */
  getKeyRetention() {
    return this.#store.getKeyRetention();
  }

  /** Διαγραφή όλων των κλειδιών (ίδιο ρήμα με τις άλλες αποθήκες). */
  clear() {
    this.#store.clear();
  }
}

/** Άγνωστος πάροχος είναι λάθος προγραμματισμού (API-004): απορρίπτεται σε κάθε μέθοδο. */
function requireProvider(provider) {
  if (!PROVIDERS.has(provider)) throw new RangeError(`άγνωστος πάροχος ${provider}`);
  return provider;
}
