/**
 * Οι αποθηκευμένες περιλήψεις μιας μεταγραφής (OO-015): ανάγνωση, εξαγωγή σε
 * κάθε μορφή, αντιγραφή και διαγραφή με επιβεβαίωση.
 *
 * Μία γραμμή (<details>) ανά περίληψη, με κλειδί το id της, που φτιάχνεται
 * μία φορά (OO-001): μια νέα περίληψη μπαίνει στη θέση της, μια διαγραμμένη
 * φεύγει, και όσες είναι ανοιχτές μένουν ανοιχτές. Οι περιλήψεις δεν
 * αλλάζουν μετά την αποθήκευση, άρα μια γραμμή δεν ξαναγράφεται ποτέ.
 *
 * Όσο γράφεται νέα περίληψη η λίστα είναι αδρανής (setBusy, OO-013), ώστε να
 * μη σβηστεί περίληψη στη μέση μιας αποθήκευσης.
 */
import { h } from '../dom.js';
import { STRINGS, exportFormatLabel } from '../strings.js';
import { runAction } from '../feedback.js';
import { formatDateTime } from '../formatters.js';
import { renderMarkdown } from './markdown-view.js';
import { confirmAction } from './confirm-dialog.js';

export class SavedSummariesList {
  #editor;
  #exports;
  #fileDelivery;
  #clipboard;
  #toasts;
  #onChange;
  #transcript = null;
  #root = null;
  #heading = null;
  #empty = null;
  #list = null;
  /** @type {Map<string, HTMLElement>} */
  #rows = new Map();

  /**
   * @param {Object} deps
   * @param {Pick<import('../../application/transcript-editor.js').TranscriptEditor, 'removeSummary'>} deps.editor
   * @param {Pick<import('../../application/export-service.js').ExportService, 'summaryFormats'|'exportSummary'>} deps.exports
   * @param {import('../../application/ports.js').FileDelivery} deps.fileDelivery
   * @param {import('../../application/ports.js').Clipboard} deps.clipboard
   * @param {import('./toast.js').ToastHost} deps.toasts
   * @param {(transcript: import('../../domain/transcript.js').Transcript) => void} deps.onChange  η μεταγραφή μετά από διαγραφή
   */
  constructor({ editor, exports, fileDelivery, clipboard, toasts, onChange }) {
    this.#editor = editor;
    this.#exports = exports;
    this.#fileDelivery = fileDelivery;
    this.#clipboard = clipboard;
    this.#toasts = toasts;
    this.#onChange = onChange;
  }

  /** @returns {HTMLElement} */
  element() {
    if (!this.#root) {
      this.#heading = h('h2', { id: 'saved-title' }, STRINGS.summary.saved);
      this.#empty = h('p', { class: 'hint' }, STRINGS.summary.none);
      this.#list = h('div');
      this.#root = h('section', { class: 'saved-summaries', 'aria-labelledby': 'saved-title' }, this.#heading, this.#empty, this.#list);
    }
    return this.#root;
  }

  /** Η μεταγραφή σε κάθε νέα έκδοσή της: προσθέτει και αφαιρεί μόνο όσες γραμμές άλλαξαν. */
  setTranscript(transcript) {
    this.element();
    this.#transcript = transcript;
    const ids = new Set(transcript.summaries.map(summary => summary.id));
    for (const [id, row] of this.#rows) {
      if (!ids.has(id)) { row.remove(); this.#rows.delete(id); }
    }
    transcript.summaries.forEach((summary, index) => {
      let row = this.#rows.get(summary.id);
      if (!row) {
        row = this.#createRow(summary);
        this.#rows.set(summary.id, row);
      }
      const atIndex = this.#list.children[index] || null;
      if (atIndex !== row) this.#list.insertBefore(row, atIndex);
    });
    const empty = transcript.summaries.length === 0;
    this.#heading.hidden = empty;
    this.#empty.hidden = !empty;
  }

  /** Αδρανής λίστα (χωρίς κλικ και εστίαση) όσο γράφεται νέα περίληψη. */
  setBusy(busy) {
    this.element().inert = busy;
  }

  #createRow(summary) {
    return h('details', { class: 'card saved-summary' },
      h('summary', {}, `${STRINGS.summary.kinds[summary.kind]}, ${formatDateTime(summary.createdAt)}`),
      h('div', { class: 'markdown' }, renderMarkdown(summary.text)),
      summary.truncated ? h('p', { class: 'warning' }, STRINGS.summary.truncated) : null,
      h('p', { class: 'hint' }, STRINGS.summary.notice),
      h('div', { class: 'actions' },
        this.#exports.summaryFormats.map(format => h('button', { type: 'button', class: 'secondary', onclick: () => this.#download(summary.id, format) }, exportFormatLabel(format))),
        h('button', { type: 'button', class: 'secondary', onclick: () => this.#copy(summary.text) }, STRINGS.common.copy),
        h('button', { type: 'button', class: 'danger', onclick: () => this.#remove(summary.id) }, STRINGS.common.delete)));
  }

  #summary(summaryId) {
    return this.#transcript.summaries.find(summary => summary.id === summaryId);
  }

  #download(summaryId, format) {
    const transcript = this.#transcript;
    return runAction(this.#toasts, () => this.#fileDelivery.download(this.#exports.exportSummary(transcript, this.#summary(summaryId), format)));
  }

  #copy(text) {
    return runAction(this.#toasts, () => this.#clipboard.copyText(text), { success: STRINGS.common.copied });
  }

  async #remove(summaryId) {
    if (!(await confirmAction({ message: STRINGS.summary.deleteConfirm, confirmLabel: STRINGS.common.delete, danger: true }))) return;
    const outcome = await runAction(this.#toasts, () => this.#editor.removeSummary(this.#transcript, summaryId));
    if (!outcome.ok) return;
    this.setTranscript(outcome.value);
    this.#onChange(outcome.value);
  }
}
