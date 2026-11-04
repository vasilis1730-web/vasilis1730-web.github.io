/**
 * Σύντομα μηνύματα στο κάτω μέρος της οθόνης (role="status", ώστε να τα
 * διαβάζουν και οι αναγνώστες οθόνης). Προαιρετικά με ένα κουμπί ενέργειας.
 */
import { h } from '../dom.js';

const DEFAULT_TIMEOUT_MS = 5000;

export class ToastHost {
  #region;

  /** @param {HTMLElement} region  το στοιχείο με role="status" */
  constructor(region) {
    this.#region = region;
  }

  /**
   * @param {string} message
   * @param {{ tone?: 'info'|'error'|'success', action?: { label: string, run: () => void }, sticky?: boolean }} [options]
   */
  show(message, { tone = 'info', action, sticky = false } = {}) {
    const close = () => toast.remove();
    const toast = h('div', { class: ['toast', `toast-${tone}`] },
      h('span', { class: 'toast-message' }, message),
      action ? h('button', { type: 'button', class: 'toast-action', onclick: () => { close(); action.run(); } }, action.label) : null,
      h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Κλείσιμο', onclick: close }, '×'));
    this.#region.append(toast);
    if (!sticky) setTimeout(close, tone === 'error' ? DEFAULT_TIMEOUT_MS * 2 : DEFAULT_TIMEOUT_MS);
    return close;
  }
}
