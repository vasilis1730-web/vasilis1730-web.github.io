/**
 * Παράθυρο επιβεβαίωσης με το εγγενές <dialog> (εστίαση, Esc και
 * προσβασιμότητα από τον browser). Επιστρέφει true μόνο στο «Επιβεβαίωση».
 */
import { h } from '../dom.js';
import { STRINGS } from '../strings.js';

/**
 * @param {Document} doc
 * @param {{ message: string, confirmLabel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export function confirmAction(doc, { message, confirmLabel = STRINGS.common.confirm, danger = false }) {
  return new Promise(resolve => {
    const dialog = h('dialog', { class: 'confirm-dialog' },
      h('form', { method: 'dialog' },
        h('p', {}, message),
        h('div', { class: 'actions' },
          h('button', { value: 'cancel', type: 'submit', class: 'secondary' }, STRINGS.common.cancel),
          h('button', { value: 'confirm', type: 'submit', class: danger ? 'danger' : 'primary' }, confirmLabel))));
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'confirm'); dialog.remove(); });
    doc.body.append(dialog);
    dialog.showModal();
  });
}

/**
 * Ερώτηση κειμένου (π.χ. όνομα νέου ομιλητή). null αν ακυρωθεί.
 * @returns {Promise<string|null>}
 */
export function promptText(doc, { label, value = '', confirmLabel = STRINGS.common.save }) {
  return new Promise(resolve => {
    const input = h('input', { type: 'text', value, required: true, maxLength: 200, autocomplete: 'off' });
    const id = `prompt-${Date.now()}`;
    input.id = id;
    const dialog = h('dialog', { class: 'confirm-dialog' },
      h('form', { method: 'dialog' },
        h('label', { for: id }, label),
        input,
        h('div', { class: 'actions' },
          h('button', { value: 'cancel', type: 'submit', class: 'secondary', formNoValidate: true }, STRINGS.common.cancel),
          h('button', { value: 'confirm', type: 'submit', class: 'primary' }, confirmLabel))));
    dialog.addEventListener('close', () => {
      const text = input.value.trim();
      resolve(dialog.returnValue === 'confirm' && text ? text : null);
      dialog.remove();
    });
    doc.body.append(dialog);
    dialog.showModal();
    input.select();
  });
}
