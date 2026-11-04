/**
 * Το πεδίο ενός κλειδιού API στις Ρυθμίσεις: επικόλληση, εμφάνιση,
 * αποθήκευση, έλεγχος και αφαίρεση, με συνδέσμους για το πού βρίσκεται κλειδί
 * και τις τιμές του παρόχου.
 *
 * Φτιάχνεται μία φορά και μετά από κάθε αποθήκευση ή αφαίρεση ενημερώνει μόνο
 * τον εαυτό του (OO-001): η υπόλοιπη σελίδα και η εστίαση δεν αλλάζουν. Το
 * κλειδί δεν ξαναφαίνεται ποτέ, μόνο οι τελευταίοι χαρακτήρες του.
 *
 * @typedef {Object} KeyEditorTexts
 * @property {string} label
 * @property {string} help
 * @property {string} keysUrl
 * @property {string} pricingUrl
 */
import { h, field } from '../dom.js';
import { STRINGS } from '../strings.js';
import { runAction, describeError, reportUnexpected } from '../feedback.js';

export class KeyEditor {
  #apiKeys;
  #toasts;
  #provider;
  #texts;
  #root = null;
  #input = null;
  #status = null;
  #verify = null;
  #remove = null;

  /**
   * @param {Object} deps
   * @param {Pick<import('../../application/api-key-service.js').ApiKeyService, 'getKeyHint'|'saveKey'|'removeKey'|'verify'>} deps.apiKeys
   * @param {import('./toast.js').ToastHost} deps.toasts
   * @param {import('../../application/key-providers.js').KeyProvider} deps.provider
   * @param {KeyEditorTexts} deps.texts
   */
  constructor({ apiKeys, toasts, provider, texts }) {
    this.#apiKeys = apiKeys;
    this.#toasts = toasts;
    this.#provider = provider;
    this.#texts = texts;
  }

  /** @returns {HTMLElement} */
  element() {
    if (!this.#root) this.#build();
    return this.#root;
  }

  /** Η κατάσταση από το αποθηκευμένο κλειδί: υπόδειξη, και έλεγχος και αφαίρεση μόνο όταν υπάρχει. */
  refresh() {
    this.element();
    const hint = this.#apiKeys.getKeyHint(this.#provider);
    this.#status.textContent = hint ? `${STRINGS.settings.keyStored} …${hint}` : '';
    this.#verify.disabled = !hint;
    this.#remove.hidden = !hint;
  }

  #build() {
    const s = STRINGS.settings;
    const { label, help, keysUrl, pricingUrl } = this.#texts;
    this.#input = h('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: s.keyPlaceholder, inputMode: 'text' });
    this.#status = h('p', { class: 'meta', 'aria-live': 'polite' });
    const toggle = h('button', { type: 'button', class: 'secondary', onclick: () => {
      const showing = this.#input.type === 'text';
      this.#input.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? s.show : s.hide;
    } }, s.show);
    const save = h('button', { type: 'button', class: 'primary', onclick: () => this.#save() }, STRINGS.common.save);
    this.#verify = h('button', { type: 'button', class: 'secondary', onclick: () => this.#check() }, s.verify);
    this.#remove = h('button', { type: 'button', class: 'danger', onclick: () => this.#removeKey() }, s.remove);
    this.#root = h('div', { class: 'key-editor' },
      field(label, this.#input, help),
      h('p', { class: 'links' },
        h('a', { href: keysUrl, target: '_blank', rel: 'noopener noreferrer' }, s.getKey), ' ',
        h('a', { href: pricingUrl, target: '_blank', rel: 'noopener noreferrer' }, s.pricing)),
      h('div', { class: 'actions' }, toggle, save, this.#verify, this.#remove),
      this.#status);
    this.refresh();
  }

  async #save() {
    const outcome = await runAction(this.#toasts, () => this.#apiKeys.saveKey(this.#provider, this.#input.value), { success: STRINGS.settings.keySaved });
    if (!outcome.ok) return;
    this.#input.value = '';
    this.refresh();
  }

  async #check() {
    const s = STRINGS.settings;
    this.#verify.disabled = true;
    this.#status.textContent = s.verifying;
    try {
      await this.#apiKeys.verify(this.#provider);
      this.#status.textContent = s.keyValid;
    } catch (error) {
      reportUnexpected(error);
      this.#status.textContent = describeError(error);
    } finally {
      this.#verify.disabled = !this.#apiKeys.getKeyHint(this.#provider);
    }
  }

  async #removeKey() {
    const outcome = await runAction(this.#toasts, () => this.#apiKeys.removeKey(this.#provider), { success: STRINGS.settings.keyRemoved });
    this.refresh();
    // Το κουμπί «Αφαίρεση» κρύφτηκε: η εστίαση πηγαίνει στο πεδίο του κλειδιού.
    if (outcome.ok) this.#input.focus();
  }
}
