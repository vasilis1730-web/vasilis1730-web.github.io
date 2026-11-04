/**
 * Προβολή «Ρυθμίσεις»: κλειδιά API (αποθήκευση, έλεγχος, αφαίρεση, πού
 * μένουν), μοντέλο Claude, ποιότητα στη συσκευή, άνω τελεία, μοντέλα στη
 * συσκευή, διαγραφή όλων των δεδομένων και πληροφορίες έκδοσης.
 */
import { h, replaceContent, field } from '../dom.js';
import { STRINGS, errorMessage, providerMessage } from '../strings.js';
import { formatBytes, formatPrice } from '../formatters.js';
import { confirmAction } from '../components/confirm-dialog.js';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL_ID, LOCAL_QUALITY_PRESET_IDS } from '../../config/models.js';
import { EXTERNAL_LINKS } from '../../config/external-links.js';

const KEY_PROVIDERS = Object.freeze([
  { provider: 'elevenlabs', label: STRINGS.settings.elevenLabsKey, help: STRINGS.settings.elevenLabsHelp, keysUrl: EXTERNAL_LINKS.elevenLabsKeys, pricingUrl: EXTERNAL_LINKS.elevenLabsPricing },
  { provider: 'anthropic', label: STRINGS.settings.anthropicKey, help: STRINGS.settings.anthropicHelp, keysUrl: EXTERNAL_LINKS.anthropicKeys, pricingUrl: EXTERNAL_LINKS.anthropicPricing },
]);

const QUALITY_OPTIONS = Object.freeze([
  [LOCAL_QUALITY_PRESET_IDS.AUTO, STRINGS.home.qualityAuto],
  [LOCAL_QUALITY_PRESET_IDS.FAST, STRINGS.home.qualityFast],
  [LOCAL_QUALITY_PRESET_IDS.BALANCED, STRINGS.home.qualityBalanced],
  [LOCAL_QUALITY_PRESET_IDS.ACCURATE, STRINGS.home.qualityAccurate],
]);

export class SettingsView {
  title = STRINGS.settings.title;
  navKey = 'settings';

  #deps;
  #root = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/api-key-service.js').ApiKeyService} deps.apiKeys
   * @param {import('../../application/settings-service.js').SettingsService} deps.settings
   * @param {import('../../infrastructure/platform/model-cache.js').ModelCacheManager} deps.modelCache
   * @param {() => Promise<void>} deps.eraseAllData  διαγραφή μεταγραφών, κλειδιών, ρυθμίσεων και μοντέλων
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {Document} deps.document
   * @param {{ version: string, privacyHref: string }} deps.about
   */
  constructor(deps) {
    this.#deps = deps;
  }

  render() {
    this.#root = h('section', { class: 'view settings-view' });
    this.#draw();
    return this.#root;
  }

  #draw() {
    const s = STRINGS.settings;
    replaceContent(this.#root, 
      h('h1', {}, s.title),
      h('section', { class: 'card', 'aria-labelledby': 'keys-title' },
        h('h2', { id: 'keys-title' }, s.keysTitle),
        h('p', { class: 'hint' }, s.keysIntro),
        KEY_PROVIDERS.map(p => this.#keyEditor(p)),
        this.#persistToggle()),
      h('section', { class: 'card', 'aria-labelledby': 'model-title' },
        h('h2', { id: 'model-title' }, s.claudeModel),
        this.#claudeModels()),
      h('section', { class: 'card', 'aria-labelledby': 'local-title' },
        h('h2', { id: 'local-title' }, s.localQuality),
        this.#qualitySelect(),
        this.#modelsBlock()),
      h('section', { class: 'card', 'aria-labelledby': 'text-title' },
        h('h2', { id: 'text-title' }, s.textTitle),
        this.#anoTeleiaToggle()),
      h('section', { class: 'card', 'aria-labelledby': 'data-title' },
        h('h2', { id: 'data-title' }, s.dataTitle),
        h('button', { type: 'button', class: 'danger', onclick: () => this.#eraseAll() }, s.deleteEverything)),
      h('section', { class: 'card', 'aria-labelledby': 'about-title' },
        h('h2', { id: 'about-title' }, s.about),
        h('p', {}, `${s.version} ${this.#deps.about.version}`),
        h('p', {}, STRINGS.footer.independent, ' ', h('a', { href: this.#deps.about.privacyHref }, STRINGS.footer.privacy))),
    );
  }

  #keyEditor({ provider, label, help, keysUrl, pricingUrl }) {
    const { apiKeys, toasts } = this.#deps;
    const s = STRINGS.settings;
    const hint = apiKeys.keyHint(provider);
    const input = h('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: s.keyPlaceholder, inputMode: 'text' });
    const status = h('p', { class: 'meta', 'aria-live': 'polite' }, hint ? `${s.keyStored} …${hint}` : '');
    const toggle = h('button', { type: 'button', class: 'secondary', onclick: () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      toggle.textContent = showing ? s.show : s.hide;
    } }, s.show);
    const save = h('button', { type: 'button', class: 'primary', onclick: async () => {
      try {
        apiKeys.saveKey(provider, input.value);
        input.value = '';
        toasts.show(s.keySaved, { tone: 'success' });
        this.#draw();
      } catch (error) {
        toasts.show(errorMessage(error), { tone: 'error' });
      }
    } }, STRINGS.common.save);
    const verify = h('button', { type: 'button', class: 'secondary', disabled: !hint, onclick: async () => {
      verify.disabled = true;
      status.textContent = s.verifying;
      try {
        await apiKeys.verify(provider);
        status.textContent = s.keyValid;
      } catch (error) {
        const extra = providerMessage(error);
        status.textContent = extra ? `${errorMessage(error)} ${STRINGS.errors.providerSaid}: ${extra}` : errorMessage(error);
      } finally {
        verify.disabled = false;
      }
    } }, s.verify);
    const remove = hint ? h('button', { type: 'button', class: 'danger', onclick: () => { apiKeys.removeKey(provider); toasts.show(s.keyRemoved); this.#draw(); } }, s.remove) : null;
    return h('div', { class: 'key-editor' },
      field(label, input, help),
      h('p', { class: 'links' },
        h('a', { href: keysUrl, target: '_blank', rel: 'noopener noreferrer' }, s.getKey), ' ',
        h('a', { href: pricingUrl, target: '_blank', rel: 'noopener noreferrer' }, s.pricing)),
      h('div', { class: 'actions' }, toggle, save, verify, remove),
      status);
  }

  #persistToggle() {
    const { apiKeys } = this.#deps;
    const box = h('input', { type: 'checkbox', checked: apiKeys.isPersistent(), onchange: () => apiKeys.setPersistent(box.checked) });
    return h('div', { class: 'field' },
      h('label', { class: 'choice' }, box, h('span', {}, STRINGS.settings.persistKeys)),
      h('p', { class: 'hint' }, STRINGS.settings.persistKeysHint));
  }

  #claudeModels() {
    const { settings } = this.#deps;
    return h('fieldset', {}, h('legend', { class: 'visually-hidden' }, STRINGS.settings.claudeModel),
      CLAUDE_MODELS.map(model => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'claude-model', value: model.id, checked: settings.current.claudeModelId === model.id, onchange: () => settings.update({ claudeModelId: model.id }) }),
        h('span', {},
          h('strong', {}, model.label, model.id === DEFAULT_CLAUDE_MODEL_ID ? ` (${STRINGS.settings.claudeModelDefault})` : ''),
          h('span', { class: 'hint' }, `${formatPrice(model.inputUsdPerMTok)} / ${formatPrice(model.outputUsdPerMTok)} ${STRINGS.settings.perMillion}`)))));
  }

  #qualitySelect() {
    const { settings } = this.#deps;
    const select = h('select', { onchange: () => settings.update({ localQuality: select.value }) },
      QUALITY_OPTIONS.map(([value, label]) => h('option', { value, selected: settings.current.localQuality === value }, label)));
    return field(STRINGS.home.quality, select);
  }

  #modelsBlock() {
    const { modelCache, toasts } = this.#deps;
    const size = h('span', {}, STRINGS.common.loading);
    modelCache.sizeBytes().then(bytes => { size.textContent = bytes == null ? STRINGS.common.notAvailable : formatBytes(bytes); });
    return h('div', { class: 'field' },
      h('p', {}, `${STRINGS.settings.modelsSize}: `, size),
      h('button', { type: 'button', class: 'secondary', onclick: async () => {
        await modelCache.clear();
        toasts.show(STRINGS.settings.modelsDeleted, { tone: 'success' });
        this.#draw();
      } }, STRINGS.settings.deleteModels));
  }

  #anoTeleiaToggle() {
    const { settings } = this.#deps;
    const box = h('input', { type: 'checkbox', checked: settings.current.removeAnoTeleia, onchange: () => settings.update({ removeAnoTeleia: box.checked }) });
    return h('div', { class: 'field' },
      h('label', { class: 'choice' }, box, h('span', {}, STRINGS.settings.noAnoTeleia)),
      h('p', { class: 'hint' }, STRINGS.settings.noAnoTeleiaHint));
  }

  async #eraseAll() {
    const s = STRINGS.settings;
    if (!(await confirmAction(this.#deps.document, { message: s.deleteEverythingConfirm, confirmLabel: s.deleteEverything, danger: true }))) return;
    await this.#deps.eraseAllData();
    this.#deps.toasts.show(s.everythingDeleted, { tone: 'success' });
    this.#draw();
  }
}
