/**
 * Περίπτωση χρήσης «Διαγραφή δεδομένων» (OO-002, CA-002), όπως την υπόσχεται
 * η πολιτική απορρήτου: μεταγραφές και περιλήψεις, κλειδιά, ρυθμίσεις,
 * μοντέλα, αρχεία από κοινή χρήση και τα αρχεία της συνεδρίας.
 *
 * 1. Πρώτα σταματά ό,τι γράφει ακόμη δεδομένα (OO-014, CA-013): π.χ. μια
 *    μεταγραφή που τρέχει θα αποθήκευε τη μεταγραφή της, και ο worker θα
 *    συνέχιζε να κατεβάζει μοντέλα, αφού είχε πει η εφαρμογή «διαγράφηκαν όλα».
 * 2. Μετά σβήνει κάθε στόχο ανεξάρτητα (Promise.allSettled): αν ένας αποτύχει
 *    (π.χ. το IndexedDB είναι κλειδωμένο από άλλη καρτέλα), οι υπόλοιποι
 *    σβήνονται κανονικά και το σφάλμα λέει ποιοι έμειναν.
 *
 * Ο κατασκευαστής ελέγχει ότι δίνεται ένας στόχος για κάθε ERASE_TARGETS: ένα
 * ξεχασμένο σημείο αποθήκευσης είναι λάθος της σύνδεσης και φαίνεται αμέσως,
 * όχι ως διαγραφή που άφησε κάτι πίσω.
 *
 * @typedef {import('./erase-targets.js').EraseTarget} EraseTarget
 */
import { AppError, ERROR_CODES } from './errors.js';
import { ERASE_TARGETS } from './erase-targets.js';

const ALL_TARGETS = Object.freeze(Object.values(ERASE_TARGETS));

export class DataErasureService {
  #targets;
  #beforeErase;

  /**
   * @param {Object} deps
   * @param {import('./ports.js').Erasable[]} deps.targets  ένας για κάθε ERASE_TARGETS
   * @param {(() => Promise<unknown>|unknown)[]} [deps.beforeErase]  σταματούν ό,τι γράφει ακόμη (π.χ. τη μεταγραφή που τρέχει)
   */
  constructor({ targets, beforeErase = [] }) {
    requireAllTargets(targets);
    this.#targets = new Map(targets.map(target => [target.name, target]));
    this.#beforeErase = [...beforeErase];
  }

  /** @returns {EraseTarget[]} τα ονόματα των στόχων, με τη σειρά που δόθηκαν */
  get targetNames() {
    return [...this.#targets.keys()];
  }

  /** Σβήνει όλα τα δεδομένα. */
  eraseAll() {
    return this.erase(ALL_TARGETS);
  }

  /**
   * Σβήνει μόνο τους στόχους που δίνονται (π.χ. μόνο τα μοντέλα), αφού
   * σταματήσει ό,τι γράφει ακόμη. Αν κάποιοι αποτύχουν, πετά ERASE_INCOMPLETE
   * με τα ονόματά τους στο details.failedTargets, αφού έχουν σβηστεί οι υπόλοιποι.
   * @param {EraseTarget[]} names
   */
  async erase(names) {
    const targets = names.map(name => {
      const target = this.#targets.get(name);
      if (!target) throw new RangeError(`άγνωστος στόχος διαγραφής ${name}`);
      return target;
    });
    await Promise.allSettled(this.#beforeErase.map(stop => Promise.resolve().then(stop)));
    const results = await Promise.allSettled(targets.map(target => Promise.resolve().then(() => target.erase())));
    const failed = results.map((result, i) => (result.status === 'rejected' ? targets[i].name : null)).filter(Boolean);
    if (failed.length) {
      const causes = results.filter(r => r.status === 'rejected').map(r => r.reason);
      throw new AppError(ERROR_CODES.ERASE_INCOMPLETE, `δεν σβήστηκαν: ${failed.join(', ')}`, { cause: causes[0], details: { failedTargets: failed } });
    }
  }
}

/** Ακριβώς ένας στόχος για κάθε ERASE_TARGETS (λάθος σύνδεσης → RangeError, API-001). */
function requireAllTargets(targets) {
  const names = targets.map(target => target.name);
  const unknown = names.filter(name => !ALL_TARGETS.includes(name));
  if (unknown.length) throw new RangeError(`άγνωστοι στόχοι διαγραφής: ${unknown.join(', ')}`);
  if (new Set(names).size !== names.length) throw new RangeError('ο ίδιος στόχος διαγραφής δίνεται δύο φορές');
  const missing = ALL_TARGETS.filter(name => !names.includes(name));
  if (missing.length) throw new RangeError(`λείπουν στόχοι διαγραφής: ${missing.join(', ')}`);
}
