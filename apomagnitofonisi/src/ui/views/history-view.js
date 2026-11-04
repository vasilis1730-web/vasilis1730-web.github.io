/**
 * Προβολή «Ιστορικό»: οι μεταγραφές της συσκευής, άνοιγμα, διαγραφή,
 * διαγραφή όλων, εισαγωγή αρχείου .json και ο χώρος που χρησιμοποιείται.
 */
import { h, replaceContent } from '../dom.js';
import { STRINGS, historyCounts, errorMessage } from '../strings.js';
import { formatBytes, formatDateTime, formatDuration } from '../formatters.js';
import { confirmAction } from '../components/confirm-dialog.js';
import { ENGINE_KINDS } from '../../domain/transcript.js';

export class HistoryView {
  title = STRINGS.history.title;
  navKey = 'history';

  #deps;
  #root = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/library-service.js').LibraryService} deps.library
   * @param {{ navigate: (path: string) => void }} deps.router
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {Document} deps.document
   */
  constructor(deps) {
    this.#deps = deps;
  }

  render() {
    this.#root = h('section', { class: 'view history-view' }, h('h1', {}, STRINGS.history.title));
    this.#refresh();
    return this.#root;
  }

  async #refresh() {
    const { library } = this.#deps;
    let items;
    let usage;
    try {
      [items, usage] = await Promise.all([library.listNewestFirst(), library.storageUsage()]);
    } catch (error) {
      replaceContent(this.#root, h('h1', {}, STRINGS.history.title), h('p', { class: 'error' }, errorMessage(error)));
      return;
    }
    replaceContent(this.#root, 
      h('h1', {}, STRINGS.history.title),
      h('p', { class: 'meta' }, `${STRINGS.history.storage}: ${formatBytes(usage.usageBytes)}`),
      this.#toolbar(items.length),
      items.length ? h('ul', { class: 'history-list' }, items.map(item => this.#item(item))) : h('p', { class: 'notice' }, STRINGS.history.empty),
    );
  }

  #toolbar(count) {
    const input = h('input', { type: 'file', accept: '.json,application/json', id: 'import-json', class: 'visually-hidden' });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const transcript = await this.#deps.library.importFromJson(await file.text());
        this.#deps.toasts.show(STRINGS.history.imported, { tone: 'success', action: { label: STRINGS.common.open, run: () => this.#deps.router.navigate(`/t/${encodeURIComponent(transcript.id)}`) } });
        this.#refresh();
      } catch (error) {
        this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
      }
    });
    return h('div', { class: 'toolbar' },
      h('label', { for: 'import-json', class: 'button secondary' }, STRINGS.history.import), input,
      count ? h('button', { type: 'button', class: 'danger', onclick: () => this.#removeAll() }, STRINGS.history.deleteAll) : null);
  }

  #item(item) {
    const href = `#/t/${encodeURIComponent(item.id)}`;
    return h('li', { class: 'card history-item' },
      h('a', { href, class: 'history-title' }, item.title),
      h('p', { class: 'meta' },
        `${formatDateTime(item.createdAt)}, ${formatDuration(item.durationSec)}, `,
        item.engineKind === ENGINE_KINDS.ELEVENLABS ? STRINGS.history.engineCloud : STRINGS.history.engineLocal,
        `, ${historyCounts(item.segmentCount, item.summaryCount)}`),
      h('div', { class: 'actions' },
        h('a', { href, class: 'button secondary' }, STRINGS.common.open),
        h('button', { type: 'button', class: 'danger', 'aria-label': `${STRINGS.common.delete}: ${item.title}`, onclick: () => this.#remove(item) }, STRINGS.common.delete)));
  }

  async #remove(item) {
    if (!(await confirmAction(this.#deps.document, { message: STRINGS.history.deleteConfirm, confirmLabel: STRINGS.common.delete, danger: true }))) return;
    await this.#deps.library.remove(item.id);
    this.#refresh();
  }

  async #removeAll() {
    if (!(await confirmAction(this.#deps.document, { message: STRINGS.history.deleteAllConfirm, confirmLabel: STRINGS.history.deleteAll, danger: true }))) return;
    await this.#deps.library.removeAll();
    this.#refresh();
  }
}
