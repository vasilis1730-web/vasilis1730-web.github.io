/**
 * Παράδοση αρχείων στον χρήστη: λήψη (a[download] με object URL) ή κοινή
 * χρήση (Web Share API με αρχεία, π.χ. στο Viber ή στο email από κινητό).
 */
export class BrowserFileSaver {
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
    const blob = toBlob(file);
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

  /** Αληθές όταν η συσκευή μοιράζεται αρχεία αυτού του τύπου. */
  canShare(file) {
    const nav = this.#navigator;
    if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    try {
      return nav.canShare({ files: [toFile(file)] });
    } catch {
      return false;
    }
  }

  /** @returns {Promise<boolean>} false όταν ο χρήστης ακύρωσε */
  async share(file, title) {
    try {
      await this.#navigator.share({ files: [toFile(file)], title });
      return true;
    } catch (error) {
      if (error && error.name === 'AbortError') return false;
      throw error;
    }
  }

  /** Αντιγραφή κειμένου στο πρόχειρο. */
  async copyText(text) {
    await this.#navigator.clipboard.writeText(text);
  }
}

function toBlob(file) {
  return new Blob([file.data], { type: file.mimeType });
}

function toFile(file) {
  return new File([file.data], file.fileName, { type: file.mimeType });
}
