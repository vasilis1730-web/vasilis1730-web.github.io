/**
 * Παράδοση αρχείων στον χρήστη: λήψη (a[download] με object URL) ή κοινή
 * χρήση (Web Share API με αρχεία, π.χ. στο Viber ή στο email από κινητό).
 * Υλοποιεί τη θύρα FileDelivery.
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';

export class BrowserFileDelivery {
  #document;
  #navigator;
  #url;

  /** @param {{ document: Document, navigator: Navigator, URL: typeof URL }} deps */
  constructor({ document, navigator, URL }) {
    this.#document = document;
    this.#navigator = navigator;
    this.#url = URL;
  }

  /** @param {import('../../application/ports.js').ExportFile} file */
  download(file) {
    const blob = new Blob([file.data], { type: file.mimeType });
    const href = this.#url.createObjectURL(blob);
    const anchor = this.#document.createElement('a');
    anchor.href = href;
    anchor.download = file.fileName;
    anchor.rel = 'noopener';
    anchor.hidden = true;
    this.#document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => this.#url.revokeObjectURL(href), 60_000);
  }

  /**
   * Αν η συσκευή μοιράζεται αρχεία με αυτό το όνομα και τύπο. Ο έλεγχος γίνεται
   * με κενό αρχείο ίδιου ονόματος και τύπου, χωρίς να φτιαχτεί το πραγματικό.
   * @param {import('../../application/ports.js').FileMetadata} file
   */
  canShare({ fileName, mimeType }) {
    const nav = this.#navigator;
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    try {
      return nav.canShare({ files: [new File([], fileName, { type: mimeType })] });
    } catch {
      return false;
    }
  }

  /**
   * @param {import('../../application/ports.js').ExportFile} file
   * @param {string} title
   * @returns {Promise<void>} πετά AppError CANCELLED όταν ο χρήστης κλείσει το παράθυρο κοινής χρήσης
   */
  async share(file, title) {
    try {
      await this.#navigator.share({ files: [new File([file.data], file.fileName, { type: file.mimeType })], title });
    } catch (error) {
      throw shareError(error);
    }
  }
}

function shareError(error) {
  const name = error && error.name;
  if (name === 'AbortError') return new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε', { cause: error });
  if (name === 'NotAllowedError' || name === 'DataError' || name === 'TypeError') {
    return new AppError(ERROR_CODES.DEVICE_UNSUPPORTED, `η κοινή χρήση δεν επιτράπηκε (${name})`, { cause: error });
  }
  return new AppError(ERROR_CODES.UNKNOWN, error && error.message ? error.message : String(error), { cause: error });
}
