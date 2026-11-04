/**
 * Τα κλειδιά API του χρήστη (ElevenLabs, Anthropic): αποθήκευση μόνο στη
 * συσκευή του, έλεγχος εγκυρότητας και επιλογή αν μένουν στη συσκευή ή μόνο
 * για την τρέχουσα καρτέλα. Η εφαρμογή δεν έχει δικό της server: τα κλειδιά
 * πηγαίνουν μόνο στον πάροχο τον οποίο αφορούν.
 *
 * @typedef {typeof KEY_PROVIDERS[keyof typeof KEY_PROVIDERS]} KeyProvider
 */
import { AppError, ERROR_CODES, INPUT_ISSUES, invalidInput, toAppError } from './errors.js';

/** Οι πάροχοι κλειδιών (API-004): ένα κλειστό σύνολο, ποτέ ελεύθερα strings. */
export const KEY_PROVIDERS = Object.freeze({
  ELEVENLABS: 'elevenlabs',
  ANTHROPIC: 'anthropic',
});

const PROVIDERS = new Set(Object.values(KEY_PROVIDERS));

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

  /** Οι τελευταίοι 4 χαρακτήρες, για να αναγνωρίζει ο χρήστης ποιο κλειδί έχει βάλει. */
  keyHint(provider) {
    const key = this.#store.getKey(requireProvider(provider));
    return key ? key.slice(-4) : null;
  }

  /** Αποθήκευση. Κενό κλειδί ή κλειδί με κενά → INVALID_INPUT με την αιτία. */
  saveKey(provider, key) {
    requireProvider(provider);
    const clean = String(key ?? '').trim();
    if (!clean) throw invalidInput(INPUT_ISSUES.EMPTY_KEY, 'κενό κλειδί');
    if (/\s/.test(clean)) throw invalidInput(INPUT_ISSUES.KEY_WHITESPACE, 'το κλειδί έχει κενά');
    this.#store.setKey(provider, clean);
  }

  removeKey(provider) {
    this.#store.removeKey(requireProvider(provider));
  }

  /** Ελέγχει το αποθηκευμένο κλειδί (ή αυτό που δίνεται) με ένα φθηνό αίτημα στον πάροχο. */
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

  /** @param {import('./ports.js').KeyRetention} retention  'device' ή 'session' */
  setKeyRetention(retention) {
    if (retention !== 'device' && retention !== 'session') throw new RangeError(`άγνωστη διατήρηση κλειδιών ${retention}`);
    this.#store.setKeyRetention(retention);
  }

  /** @returns {import('./ports.js').KeyRetention} */
  keyRetention() {
    return this.#store.keyRetention();
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
