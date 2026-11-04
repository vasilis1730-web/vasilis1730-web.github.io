/**
 * Προβολή «Ιστορικό»: οι μεταγραφές της συσκευής, άνοιγμα, διαγραφή,
 * διαγραφή όλων, εισαγωγή αρχείου .json και ο χώρος που χρησιμοποιείται.
 *
 * Η επικεφαλίδα φτιάχνεται μία φορά στο render (OO-001): όταν έρθει ή
 * αλλάξει η λίστα αλλάζει μόνο το περιεχόμενο κάτω από αυτήν, άρα η εστίαση
 * που της δίνει το AppShell μένει. Μετά από διαγραφή η εστίαση γυρίζει σε αυτήν.
 */
import { h, replaceContent } from '../dom.js';
import { STRINGS, historyCounts, errorMessage } from '../strings.js';
import { runAction } from '../feedback.js';
import { formatBytes, formatDateTime, formatDuration } from '../formatters.js';
import { displayTitle, engineShortName } from '../presentation.js';
import { ROUTES, hrefFor } from '../routes.js';
import { confirmAction } from '../components/confirm-dialog.js';

export class HistoryView {
  title = STRINGS.history.title;
  navKey = 'history';

  #deps;
  #heading = null;
  #content = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/library-service.js').LibraryService} deps.library
   * @param {{ navigate: (path: string) => void }} deps.router
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   */
  constructor(deps) {
    this.#deps = deps;
  }

  render() {
    this.#heading = h('h1', {}, STRINGS.history.title);
    this.#content = h('div');
    const root = h('section', { class: 'view history-view' }, this.#heading, this.#content);
    this.#refresh();
    return root;
  }

  async #refresh() {
    const { library } = this.#deps;
    let items;
    let usage;
    try {
      [items, usage] = await Promise.all([library.listNewestFirst(), library.estimateStorageUsage()]);
    } catch (error) {
      replaceContent(this.#content, h('p', { class: 'error' }, errorMessage(error)));
      return;
    }
    replaceContent(this.#content,
      h('p', { class: 'meta' }, `${STRINGS.history.storage}: ${formatBytes(usage.usageBytes)}`),
      this.#toolbar(items.length),
      items.length ? h('ul', { class: 'history-list' }, items.map(item => this.#item(item))) : h('p', { class: 'notice' }, STRINGS.history.empty));
  }

  #toolbar(count) {
    const { library, toasts, router } = this.#deps;
    const input = h('input', { type: 'file', accept: '.json,application/json', id: 'import-json', class: 'visually-hidden' });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const outcome = await runAction(toasts, async () => library.importFromJson(await file.text()));
      input.value = '';
      if (!outcome.ok) return;
      const { id } = outcome.value;
      toasts.show(STRINGS.history.imported, { tone: 'success', action: { label: STRINGS.common.open, run: () => router.navigate(ROUTES.transcript(id)) } });
      this.#refresh();
    });
    return h('div', { class: 'toolbar' },
      h('label', { for: 'import-json', class: 'button secondary' }, STRINGS.history.import), input,
      count ? h('button', { type: 'button', class: 'danger', onclick: () => this.#clear() }, STRINGS.history.deleteAll) : null);
  }

  #item(item) {
    const href = hrefFor(ROUTES.transcript(item.id));
    const title = displayTitle(item);
    return h('li', { class: 'card history-item' },
      h('a', { href, class: 'history-title' }, title),
      h('p', { class: 'meta' },
        `${formatDateTime(item.createdAt)}, ${formatDuration(item.durationSec)}, ${engineShortName(item.engineKind)}, ${historyCounts(item.segmentCount, item.summaryCount)}`),
      h('div', { class: 'actions' },
        h('a', { href, class: 'button secondary' }, STRINGS.common.open),
        h('button', { type: 'button', class: 'danger', 'aria-label': `${STRINGS.common.delete}: ${title}`, onclick: () => this.#remove(item) }, STRINGS.common.delete)));
  }

  async #remove(item) {
    if (!(await confirmAction({ message: STRINGS.history.deleteConfirm, confirmLabel: STRINGS.common.delete, danger: true }))) return;
    await runAction(this.#deps.toasts, () => this.#deps.library.remove(item.id), { success: STRINGS.history.deleted });
    await this.#refreshAndFocus();
  }

  async #clear() {
    if (!(await confirmAction({ message: STRINGS.history.deleteAllConfirm, confirmLabel: STRINGS.history.deleteAll, danger: true }))) return;
    await runAction(this.#deps.toasts, () => this.#deps.library.clear(), { success: STRINGS.history.allDeleted });
    await this.#refreshAndFocus();
  }

  /** Το κουμπί που πατήθηκε δεν υπάρχει πια: η εστίαση πηγαίνει στην επικεφαλίδα. */
  async #refreshAndFocus() {
    await this.#refresh();
    this.#heading.focus({ preventScroll: true });
  }
}
