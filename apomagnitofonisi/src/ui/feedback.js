/**
 * Η κοινή συμπεριφορά των ενεργειών του χρήστη (OO-007): εκτέλεση, μήνυμα
 * επιτυχίας, και σε σφάλμα το μήνυμα του κωδικού μαζί με το μήνυμα του
 * παρόχου. Οι ακυρώσεις από τον χρήστη δεν δείχνουν σφάλμα.
 */
import { STRINGS, errorMessage, providerMessage } from './strings.js';
import { isCancellation } from '../application/errors.js';

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
 * Εκτελεί μια ενέργεια. Σε επιτυχία δείχνει το `success` (αν δοθεί), σε
 * σφάλμα το describeError. Επιστρέφει το αποτέλεσμα, ή undefined σε σφάλμα.
 *
 * @template T
 * @param {{ show: (message: string, options?: object) => unknown }} toasts
 * @param {() => T|Promise<T>} action
 * @param {{ success?: string }} [options]
 * @returns {Promise<T|undefined>}
 */
export async function runAction(toasts, action, { success } = {}) {
  try {
    const result = await action();
    if (success) toasts.show(success, { tone: 'success' });
    return result;
  } catch (error) {
    if (!isCancellation(error)) {
      if (!(error && error.code)) console.error(error);
      toasts.show(describeError(error), { tone: 'error' });
    }
    return undefined;
  }
}
