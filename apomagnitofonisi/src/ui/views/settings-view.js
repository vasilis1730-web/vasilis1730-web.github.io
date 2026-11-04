/**
 * Προβολή «Ρυθμίσεις»: κλειδιά API (αποθήκευση, έλεγχος, αφαίρεση, πού
 * μένουν), μοντέλο Claude, ποιότητα στη συσκευή, άνω τελεία, μοντέλα στη
 * συσκευή, διαγραφή όλων των δεδομένων και πληροφορίες έκδοσης.
 *
 * Τα επίπεδα ποιότητας έρχονται από τη μηχανή στη συσκευή (OO-003), ώστε να
 * μη φαίνεται διαθέσιμο ένα επίπεδο που δεν τρέχει εδώ.
 */
import { h, replaceContent, field } from '../dom.js';
import { STRINGS, qualityLabel } from '../strings.js';
import { runAction, describeError } from '../feedback.js';
import { formatBytes, formatPrice } from '../formatters.js';
import { confirmAction } from '../components/confirm-dialog.js';
import { KEY_PROVIDERS } from '../../application/api-key-service.js';
import { ENGINE_KINDS } from '../../domain/transcript.js';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL_ID, AUTO_LOCAL_QUALITY } from '../../config/models.js';
import { EXTERNAL_LINKS } from '../../config/external-links.js';

const KEY_EDITORS = Object.freeze([
  { provider: KEY_PROVIDERS.ELEVENLABS, label: STRINGS.settings.elevenLabsKey, help: STRINGS.settings.elevenLabsHelp, keysUrl: EXTERNAL_LINKS.elevenLabsKeys, pricingUrl: EXTERNAL_LINKS.elevenLabsPricing },
  { provider: KEY_PROVIDERS.ANTHROPIC, label: STRINGS.settings.anthropicKey, help: STRINGS.settings.anthropicHelp, keysUrl: EXTERNAL_LINKS.anthropicKeys, pricingUrl: EXTERNAL_LINKS.anthropicPricing },
]);

export class SettingsView {
  title = STRINGS.settings.title;
  navKey = 'settings';

  #deps;
  #root = null;
  #qualityPresets = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/api-key-service.js').ApiKeyService} deps.apiKeys
   * @param {import('../../application/settings-service.js').SettingsService} deps.settings
   * @param {Pick<import('../../application/transcription-service.js').TranscriptionService, 'describeQualityPresets'>} deps.transcription
   * @param {import('../../application/ports.js').ModelCache} deps.modelCache
   * @param {import('../../application/data-erasure-service.js').DataErasureService} deps.dataErasure
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {{ version: string, privacyHref: string }} deps.about
   */
  constructor(deps) {
    this.#deps = deps;
  }

  render() {
    this.#root = h('section', { class: 'view settings-view' });
    this.#draw();
    this.#deps.transcription.describeQualityPresets(ENGINE_KINDS.LOCAL).then(presets => {
      this.#qualityPresets = presets;
      if (this.#root.isConnected) this.#draw();
    }, () => {});
    return this.#root;
  }

  #draw() {
    const s = STRINGS.settings;
    replaceContent(this.#root,
      h('h1', {}, s.title),
      h('section', { class: 'card', 'aria-labelledby': 'keys-title' },
        h('h2', { id: 'keys-title' }, s.keysTitle),
        h('p', { class: 'hint' }, s.keysIntro),
        KEY_EDITORS.map(editor => this.#keyEditor(editor)),
        this.#keyRetentionToggle()),
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
        h('p', {}, STRINGS.footer.independent, ' ', h('a', { href: this.#deps.about.privacyHref }, STRINGS.footer.privacy))));
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
      const saved = await runAction(toasts, () => { apiKeys.saveKey(provider, input.value); return true; }, { success: s.keySaved });
      if (saved) { input.value = ''; this.#draw(); }
    } }, STRINGS.common.save);
    const verify = h('button', { type: 'button', class: 'secondary', disabled: !hint, onclick: async () => {
      verify.disabled = true;
      status.textContent = s.verifying;
      try {
        await apiKeys.verify(provider);
        status.textContent = s.keyValid;
      } catch (error) {
        status.textContent = describeError(error);
      } finally {
        verify.disabled = false;
      }
    } }, s.verify);
    const remove = hint ? h('button', { type: 'button', class: 'danger', onclick: async () => {
      await runAction(toasts, () => apiKeys.removeKey(provider), { success: s.keyRemoved });
      this.#draw();
    } }, s.remove) : null;
    return h('div', { class: 'key-editor' },
      field(label, input, help),
      h('p', { class: 'links' },
        h('a', { href: keysUrl, target: '_blank', rel: 'noopener noreferrer' }, s.getKey), ' ',
        h('a', { href: pricingUrl, target: '_blank', rel: 'noopener noreferrer' }, s.pricing)),
      h('div', { class: 'actions' }, toggle, save, verify, remove),
      status);
  }

  #keyRetentionToggle() {
    const { apiKeys } = this.#deps;
    const box = h('input', { type: 'checkbox', checked: apiKeys.keyRetention() === 'device', onchange: () => apiKeys.setKeyRetention(box.checked ? 'device' : 'session') });
    return h('div', { class: 'field' },
      h('label', { class: 'choice' }, box, h('span', {}, STRINGS.settings.keyRetentionDevice)),
      h('p', { class: 'hint' }, STRINGS.settings.keyRetentionHint));
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
    const selected = settings.current.localQualityPreset;
    const presets = this.#qualityPresets ? this.#qualityPresets.presets : [];
    const select = h('select', { onchange: () => settings.update({ localQualityPreset: select.value }) },
      h('option', { value: AUTO_LOCAL_QUALITY, selected: selected === AUTO_LOCAL_QUALITY }, qualityLabel(AUTO_LOCAL_QUALITY)),
      presets.map(p => h('option', { value: p.id, selected: selected === p.id, disabled: !p.available },
        p.available ? qualityLabel(p.id) : `${qualityLabel(p.id)} (${STRINGS.quality.unavailable})`)));
    return field(STRINGS.home.quality, select);
  }

  #modelsBlock() {
    const { modelCache, toasts } = this.#deps;
    const size = h('span', {}, STRINGS.common.loading);
    modelCache.estimateSizeBytes().then(bytes => { size.textContent = bytes == null ? STRINGS.common.notAvailable : formatBytes(bytes); }, () => {
      size.textContent = STRINGS.common.notAvailable;
    });
    return h('div', { class: 'field' },
      h('p', {}, `${STRINGS.settings.modelsSize}: `, size),
      h('button', { type: 'button', class: 'secondary', onclick: async () => {
        await runAction(toasts, () => modelCache.clear(), { success: STRINGS.settings.modelsDeleted });
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
    if (!(await confirmAction({ message: s.deleteEverythingConfirm, confirmLabel: s.deleteEverything, danger: true }))) return;
    await runAction(this.#deps.toasts, () => this.#deps.dataErasure.eraseAll(), { success: s.everythingDeleted });
    this.#draw();
  }
}
