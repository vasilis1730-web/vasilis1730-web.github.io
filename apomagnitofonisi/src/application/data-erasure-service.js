/**
 * Περίπτωση χρήσης «Διαγραφή όλων των δεδομένων» (OO-002, CA-002), όπως την
 * υπόσχεται η πολιτική απορρήτου: μεταγραφές και περιλήψεις, κλειδιά,
 * ρυθμίσεις, μοντέλα, αρχεία από κοινή χρήση και τα αρχεία της συνεδρίας.
 *
 * Κάθε στόχος σβήνεται ανεξάρτητα (Promise.allSettled): αν ένας αποτύχει (π.χ.
 * το IndexedDB είναι κλειδωμένο από άλλη καρτέλα), οι υπόλοιποι σβήνονται
 * κανονικά και το σφάλμα λέει ποιοι έμειναν. Νέα αποθήκη = νέος στόχος στο
 * composition root, χωρίς αλλαγή εδώ.
 */
import { AppError, ERROR_CODES } from './errors.js';

/** Τα σταθερά ονόματα των στόχων, για το μήνυμα στον χρήστη. */
export const ERASE_TARGETS = Object.freeze({
  TRANSCRIPTS: 'transcripts',
  KEYS: 'keys',
  SETTINGS: 'settings',
  MODELS: 'models',
  SHARED_FILES: 'shared-files',
  SESSION_MEDIA: 'session-media',
});

export class DataErasureService {
  #targets;

  /** @param {{ targets: import('./ports.js').Erasable[] }} deps */
  constructor({ targets }) {
    this.#targets = [...targets];
  }

  /** @returns {string[]} τα ονόματα των στόχων, με τη σειρά που σβήνονται */
  get targetNames() {
    return this.#targets.map(t => t.name);
  }

  /**
   * Σβήνει όλους τους στόχους. Αν κάποιοι αποτύχουν, πετά ERASE_INCOMPLETE με
   * τα ονόματά τους στο details.failedTargets, αφού έχουν σβηστεί οι υπόλοιποι.
   */
  async eraseAll() {
    const results = await Promise.allSettled(this.#targets.map(target => Promise.resolve().then(() => target.erase())));
    const failed = results.map((result, i) => (result.status === 'rejected' ? this.#targets[i].name : null)).filter(Boolean);
    if (failed.length) {
      const causes = results.filter(r => r.status === 'rejected').map(r => r.reason);
      throw new AppError(ERROR_CODES.ERASE_INCOMPLETE, `δεν σβήστηκαν: ${failed.join(', ')}`, { cause: causes[0], details: { failedTargets: failed } });
    }
  }
}
