/**
 * Η γραμμή ενεργειών μιας μεταγραφής: περίληψη και πρακτικά, εξαγωγή σε κάθε
 * μορφή, αντιγραφή και κοινή χρήση.
 *
 * Κοινή χρήση (OO-004): η μορφή (Word, αλλιώς κείμενο) αποφασίζεται ΜΙΑ φορά
 * ανά έκδοση της μεταγραφής, με τον ίδιο τύπο αρχείου που θα σταλεί, και το
 * κουμπί εμφανίζεται μόνο όταν η συσκευή μοιράζεται κάποια από αυτές. Το
 * αρχείο φτιάχνεται μέσα στην ενέργεια, ώστε ένα σφάλμα του να φαίνεται.
 */
import { h } from '../dom.js';
import { STRINGS, exportFormatLabel } from '../strings.js';
import { runAction } from '../feedback.js';
import { displayTitle } from '../presentation.js';
import { ROUTES, hrefFor } from '../routes.js';

export class ExportToolbar {
  #exports;
  #fileDelivery;
  #clipboard;
  #toasts;
  #transcript = null;
  #root = null;
  #summaryLink = null;
  #shareButton = null;
  #shareFormat = null;
  #shareCheckedFor = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/export-service.js').ExportService} deps.exports
   * @param {import('../../application/ports.js').FileDelivery} deps.fileDelivery
   * @param {import('../../application/ports.js').Clipboard} deps.clipboard
   * @param {import('./toast.js').ToastHost} deps.toasts
   */
  constructor({ exports, fileDelivery, clipboard, toasts }) {
    this.#exports = exports;
    this.#fileDelivery = fileDelivery;
    this.#clipboard = clipboard;
    this.#toasts = toasts;
  }

  /** @returns {HTMLElement} */
  element() {
    if (!this.#root) {
      const menu = h('details', { class: 'menu' },
        h('summary', { class: 'button secondary' }, STRINGS.transcript.export),
        h('div', { class: 'menu-items' }, this.#exports.transcriptFormats.map(format =>
          h('button', { type: 'button', onclick: () => { menu.open = false; this.#download(format); } }, exportFormatLabel(format)))));
      this.#shareButton = h('button', { type: 'button', class: 'secondary', hidden: true, onclick: () => this.#share() }, STRINGS.common.share);
      this.#summaryLink = h('a', { class: 'button primary', href: hrefFor(ROUTES.history()) }, STRINGS.transcript.summaries);
      this.#root = h('div', { class: 'toolbar' },
        this.#summaryLink,
        menu,
        h('button', { type: 'button', class: 'secondary', onclick: () => this.#copyAll() }, STRINGS.common.copy),
        this.#shareButton);
    }
    return this.#root;
  }

  /** Η μεταγραφή που αφορούν οι ενέργειες (σε κάθε νέα έκδοσή της, OO-016). */
  setTranscript(transcript) {
    this.element();
    if (transcript === this.#transcript) return;
    this.#transcript = transcript;
    this.#summaryLink.href = hrefFor(ROUTES.summary(transcript.id));
    if (this.#shareCheckedFor !== transcript.updatedAt) {
      this.#shareCheckedFor = transcript.updatedAt;
      this.#shareFormat = this.#exports.shareFormatFor(transcript, file => this.#fileDelivery.canShare(file));
    }
    this.#shareButton.hidden = !this.#shareFormat;
  }

  #download(format) {
    return runAction(this.#toasts, () => this.#fileDelivery.download(this.#exports.exportTranscript(this.#transcript, format)));
  }

  #copyAll() {
    return runAction(this.#toasts, () => this.#clipboard.copyText(this.#exports.exportClipboardText(this.#transcript)), { success: STRINGS.common.copied });
  }

  #share() {
    const format = this.#shareFormat;
    const transcript = this.#transcript;
    if (!format) return undefined;
    // Η κοινή χρήση θέλει την ενέργεια του χρήστη: το αρχείο φτιάχνεται σύγχρονα, πριν από κάθε αναμονή.
    return runAction(this.#toasts, () => this.#fileDelivery.share(this.#exports.exportTranscript(transcript, format), displayTitle(transcript)));
  }
}
