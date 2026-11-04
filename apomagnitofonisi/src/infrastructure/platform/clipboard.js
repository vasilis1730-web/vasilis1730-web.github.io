/**
 * Αντιγραφή κειμένου στο πρόχειρο της συσκευής. Υλοποιεί τη θύρα Clipboard.
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';

export class BrowserClipboard {
  #navigator;

  /** @param {{ navigator: Navigator }} deps */
  constructor({ navigator }) {
    this.#navigator = navigator;
  }

  async copyText(text) {
    const clipboard = this.#navigator && this.#navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') throw new AppError(ERROR_CODES.DEVICE_UNSUPPORTED, 'δεν υπάρχει πρόχειρο');
    try {
      await clipboard.writeText(text);
    } catch (error) {
      throw new AppError(ERROR_CODES.DEVICE_UNSUPPORTED, 'η αντιγραφή δεν επιτράπηκε', { cause: error });
    }
  }
}
