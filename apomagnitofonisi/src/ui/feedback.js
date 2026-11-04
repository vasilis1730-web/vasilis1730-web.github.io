/**
 * Η κοινή συμπεριφορά των ενεργειών του χρήστη (OO-007): εκτέλεση, μήνυμα
 * επιτυχίας, και σε σφάλμα το μήνυμα του κωδικού μαζί με το μήνυμα του
 * παρόχου. Οι ακυρώσεις από τον χρήστη δεν δείχνουν σφάλμα.
 *
 * Απρόσμενα σφάλματα (API-020): ένα λάθος του κώδικα, ή ένα σφάλμα που ο
 * adapter τύλιξε ως UNKNOWN (π.χ. TypeError από αλλαγή βιβλιοθήκης), ο χρήστης
 * το βλέπει ως «Κάτι πήγε στραβά». Για να μη χάνεται, το reportUnexpected το
 * γράφει στην κονσόλα με την αρχική του αιτία. Το καλούν το runAction, η
 * TranscriptionJob, η σύνταξη περίληψης και ο έλεγχος κλειδιού.
 *
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false }} ActionOutcome
 */
import { STRINGS, errorMessage, providerMessage } from './strings.js';
import { ERROR_CODES, isAppError, isCancellation } from '../application/errors.js';

/** Μήνυμα σφάλματος με το μήνυμα του παρόχου, όπου υπάρχει, και τα μέρη που έμειναν στη διαγραφή. */
export function describeError(error) {
  const parts = [errorMessage(error)];
  const fromProvider = providerMessage(error);
  if (fromProvider) parts.push(`${STRINGS.errors.providerSaid}: ${fromProvider}`);
  const failed = error && error.details && Array.isArray(error.details.failedTargets) ? error.details.failedTargets : null;
  if (failed && failed.length) parts.push(`${STRINGS.errors.notErased}: ${failed.map(name => STRINGS.settings.eraseTargets[name] || name).join(', ')}.`);
  return parts.join(' ');
}

/**
 * Γράφει στην κονσόλα ένα σφάλμα που δεν περιμέναμε: ό,τι δεν είναι AppError,
 * ή AppError με κωδικό UNKNOWN, με την αρχική αιτία όταν υπάρχει. Τα γνωστά
 * σφάλματα (κλειδί, δίκτυο, όριο χρήσης κ.λπ.) και οι ακυρώσεις δεν γράφονται.
 * @param {unknown} error
 * @returns {boolean} αν γράφτηκε
 */
export function reportUnexpected(error) {
  if (isCancellation(error)) return false;
  if (isAppError(error) && error.code !== ERROR_CODES.UNKNOWN) return false;
  console.error(error && error.cause ? error.cause : error);
  return true;
}

/**
 * Εκτελεί μια ενέργεια. Σε επιτυχία δείχνει το `success` (αν δοθεί), σε
 * σφάλμα το describeError (εκτός από την ακύρωση). Το αποτέλεσμα λέει ρητά αν
 * πέτυχε (API-021), ώστε μια ενέργεια χωρίς τιμή να μη μοιάζει με αποτυχία.
 *
 * @template T
 * @param {{ show: (message: string, options?: object) => unknown }} toasts
 * @param {() => T|Promise<T>} action
 * @param {{ success?: string }} [options]
 * @returns {Promise<ActionOutcome<T>>}
 */
export async function runAction(toasts, action, { success } = {}) {
  try {
    const value = await action();
    if (success) toasts.show(success, { tone: 'success' });
    return { ok: true, value };
  } catch (error) {
    if (!isCancellation(error)) {
      reportUnexpected(error);
      toasts.show(describeError(error), { tone: 'error' });
    }
    return { ok: false };
  }
}
