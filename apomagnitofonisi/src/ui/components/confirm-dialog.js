/**
 * Παράθυρα διαλόγου με το εγγενές <dialog> (εστίαση, Esc και προσβασιμότητα
 * από τον browser): επιβεβαίωση, ερώτηση κειμένου και επιλογή ομιλητή. Όπως
 * το h(), χρησιμοποιούν το document της σελίδας (API-013: χωρίς παράμετρο doc).
 *
 * Η απάντηση του pickSpeaker λέει ρητά τι διάλεξε ο χρήστης (API-021): ακύρωση,
 * ομιλητή (ή κανέναν) ή νέο ομιλητή, ώστε το «χωρίς ομιλητή» να μη μοιάζει με ακύρωση.
 *
 * @typedef {{ kind: 'cancelled' } | { kind: 'assign', speakerId: string|null } | { kind: 'new' }} SpeakerChoice
 */
import { h, uid } from '../dom.js';
import { STRINGS } from '../strings.js';

/** Τα είδη απάντησης του pickSpeaker. */
export const SPEAKER_CHOICES = Object.freeze({
  CANCELLED: 'cancelled',
  ASSIGN: 'assign',
  NEW: 'new',
});

function openDialog(dialog) {
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * Επιβεβαίωση. Επιστρέφει true μόνο στο «Επιβεβαίωση».
 * @param {{ message: string, confirmLabel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export function confirmAction({ message, confirmLabel = STRINGS.common.confirm, danger = false }) {
  return new Promise(resolve => {
    const dialog = h('dialog', { class: 'confirm-dialog' },
      h('form', { method: 'dialog' },
        h('p', {}, message),
        h('div', { class: 'actions' },
          h('button', { value: 'cancel', type: 'submit', class: 'secondary' }, STRINGS.common.cancel),
          h('button', { value: 'confirm', type: 'submit', class: danger ? 'danger' : 'primary' }, confirmLabel))));
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'confirm'); dialog.remove(); });
    openDialog(dialog);
  });
}

/**
 * Ερώτηση κειμένου (π.χ. όνομα νέου ομιλητή). null αν ακυρωθεί.
 * @param {{ label: string, value?: string, confirmLabel?: string, maxLength?: number }} options
 * @returns {Promise<string|null>}
 */
export function promptText({ label, value = '', confirmLabel = STRINGS.common.save, maxLength = 200 }) {
  return new Promise(resolve => {
    const input = h('input', { type: 'text', value, required: true, maxLength, autocomplete: 'off', id: uid('prompt') });
    const dialog = h('dialog', { class: 'confirm-dialog' },
      h('form', { method: 'dialog' },
        h('label', { for: input.id }, label),
        input,
        h('div', { class: 'actions' },
          h('button', { value: 'cancel', type: 'submit', class: 'secondary', formNoValidate: true }, STRINGS.common.cancel),
          h('button', { value: 'confirm', type: 'submit', class: 'primary' }, confirmLabel))));
    dialog.addEventListener('close', () => {
      const text = input.value.trim();
      resolve(dialog.returnValue === 'confirm' && text ? text : null);
      dialog.remove();
    });
    openDialog(dialog);
    input.select();
  });
}

/**
 * Επιλογή ομιλητή για ένα τμήμα.
 * @param {{ options: { id: string|null, label: string }[], currentId: string|null }} params  id null: «Χωρίς ομιλητή»
 * @returns {Promise<SpeakerChoice>}
 */
export function pickSpeaker({ options, currentId }) {
  return new Promise(resolve => {
    /** @type {SpeakerChoice} */
    let result = { kind: SPEAKER_CHOICES.CANCELLED };
    const dialog = h('dialog', { class: 'confirm-dialog speaker-picker' },
      h('h2', {}, STRINGS.transcript.speakerOfSegment),
      h('div', { class: 'picker-options' },
        options.map(option => h('button', {
          type: 'button',
          class: option.id === currentId ? 'primary' : 'secondary',
          onclick: () => { result = { kind: SPEAKER_CHOICES.ASSIGN, speakerId: option.id }; dialog.close(); },
        }, option.label)),
        h('button', { type: 'button', class: 'secondary', onclick: () => { result = { kind: SPEAKER_CHOICES.NEW }; dialog.close(); } }, `${STRINGS.transcript.addSpeaker}…`)),
      h('div', { class: 'actions' }, h('button', { type: 'button', class: 'secondary', onclick: () => dialog.close() }, STRINGS.common.cancel)));
    dialog.addEventListener('close', () => { resolve(result); dialog.remove(); });
    openDialog(dialog);
  });
}
