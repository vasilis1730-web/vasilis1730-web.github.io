/**
 * Προβολή «Ρυθμίσεις»: κλειδιά API (αποθήκευση, έλεγχος, αφαίρεση, πού
 * μένουν), μοντέλο Claude, ποιότητα στη συσκευή, άνω τελεία, μοντέλα στη
 * συσκευή, διαγραφή όλων των δεδομένων και πληροφορίες έκδοσης.
 *
 * Τα επίπεδα ποιότητας έρχονται από τη μηχανή στη συσκευή (OO-003), ώστε να
 * μη φαίνεται διαθέσιμο ένα επίπεδο που δεν τρέχει εδώ. Η ρύθμιση
 * `localQuality` αφορά μόνο αυτή τη μηχανή, γι' αυτό η προβολή τη ζητά ονομαστικά.
 *
 * Ενημερώσεις επί τόπου (OO-001): η επικεφαλίδα μένει ίδια, κάθε κλειδί
 * ενημερώνει μόνο το δικό του πεδίο (KeyEditor), τα επίπεδα ποιότητας
 * μπαίνουν στο ίδιο <select> όταν έρθουν. Μόνο μετά τη «Διαγραφή όλων των
 * δεδομένων» ξαναγράφονται όλες οι ενότητες, γιατί άλλαξαν όλες.
 *
 * Οι διαγραφές περνούν από το DataErasureService (και τα μοντέλα), που πρώτα
 * σταματά μια μεταγραφή που τρέχει (OO-014, CA-013).
 */
import { h, field } from '../dom.js';
import { STRINGS } from '../strings.js';
import { runAction, reportUnexpected } from '../feedback.js';
import { formatBytes, formatPrice } from '../formatters.js';
import { confirmAction } from '../components/confirm-dialog.js';
import { KeyEditor } from '../components/key-editor.js';
import { qualityOptions } from '../components/quality-options.js';
import { KEY_PROVIDERS, KEY_RETENTIONS } from '../../application/key-providers.js';
import { ERASE_TARGETS } from '../../application/erase-targets.js';
import { ENGINE_KINDS } from '../../domain/transcript.js';
import { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL_ID } from '../../config/models.js';
import { EXTERNAL_LINKS } from '../../config/external-links.js';

const KEY_EDITORS = Object.freeze([
  { provider: KEY_PROVIDERS.ELEVENLABS, texts: { label: STRINGS.settings.elevenLabsKey, help: STRINGS.settings.elevenLabsHelp, keysUrl: EXTERNAL_LINKS.elevenLabsKeys, pricingUrl: EXTERNAL_LINKS.elevenLabsPricing } },
  { provider: KEY_PROVIDERS.ANTHROPIC, texts: { label: STRINGS.settings.anthropicKey, help: STRINGS.settings.anthropicHelp, keysUrl: EXTERNAL_LINKS.anthropicKeys, pricingUrl: EXTERNAL_LINKS.anthropicPricing } },
]);

export class SettingsView {
  title = STRINGS.settings.title;
  navKey = 'settings';

  #deps;
  #heading = null;
  #content = null;
  #qualityDescription = null;
  #qualitySelect = null;
  #modelsSize = null;
  #sizeRequest = 0;

  /**
   * @param {Object} deps
   * @param {Pick<import('../../application/api-key-service.js').ApiKeyService, 'getKeyHint'|'saveKey'|'removeKey'|'verify'|'getKeyRetention'|'setKeyRetention'>} deps.apiKeys
   * @param {import('../../application/settings-service.js').SettingsService} deps.settings
   * @param {Pick<import('../../application/transcription-service.js').TranscriptionService, 'describeQualityPresets'>} deps.transcription
   * @param {Pick<import('../../application/ports.js').ModelCache, 'estimateSizeBytes'>} deps.modelCache
   * @param {Pick<import('../../application/data-erasure-service.js').DataErasureService, 'erase'|'eraseAll'>} deps.dataErasure
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {{ version: string, privacyHref: string }} deps.about
   */
  constructor(deps) {
    this.#deps = deps;
  }

  render() {
    this.#heading = h('h1', {}, STRINGS.settings.title);
    this.#content = h('div');
    const root = h('section', { class: 'view settings-view' }, this.#heading, this.#content);
    this.#drawSections();
    this.#deps.transcription.describeQualityPresets(ENGINE_KINDS.LOCAL).then(description => {
      this.#qualityDescription = description;
      this.#refreshQuality();
    }, reportUnexpected);
    return root;
  }

  /* ---------------------------------------------------------------- ενότητες */

  #drawSections() {
    const s = STRINGS.settings;
    this.#content.replaceChildren(
      h('section', { class: 'card', 'aria-labelledby': 'keys-title' },
        h('h2', { id: 'keys-title' }, s.keysTitle),
        h('p', { class: 'hint' }, s.keysIntro),
        KEY_EDITORS.map(({ provider, texts }) => new KeyEditor({ apiKeys: this.#deps.apiKeys, toasts: this.#deps.toasts, provider, texts }).element()),
        this.#keyRetentionToggle()),
      h('section', { class: 'card', 'aria-labelledby': 'model-title' },
        h('h2', { id: 'model-title' }, s.claudeModel),
        this.#claudeModels()),
      h('section', { class: 'card', 'aria-labelledby': 'local-title' },
        h('h2', { id: 'local-title' }, s.localQuality),
        this.#qualityField(),
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

  #keyRetentionToggle() {
    const { apiKeys, toasts } = this.#deps;
    const onDevice = () => apiKeys.getKeyRetention() === KEY_RETENTIONS.DEVICE;
    const box = h('input', { type: 'checkbox', checked: onDevice(), onchange: async () => {
      const outcome = await runAction(toasts, () => apiKeys.setKeyRetention(box.checked ? KEY_RETENTIONS.DEVICE : KEY_RETENTIONS.SESSION));
      if (!outcome.ok) box.checked = onDevice();
    } });
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

  #qualityField() {
    const { settings } = this.#deps;
    this.#qualitySelect = h('select', { onchange: () => settings.update({ localQuality: this.#qualitySelect.value }) });
    this.#refreshQuality();
    return field(STRINGS.home.quality, this.#qualitySelect);
  }

  /** Τα επίπεδα ποιότητας στο ίδιο <select> (πριν έρθουν, μόνο το «Αυτόματα»). */
  #refreshQuality() {
    this.#qualitySelect.replaceChildren(...qualityOptions(this.#qualityDescription));
    this.#qualitySelect.value = this.#deps.settings.current.localQuality;
  }

  #modelsBlock() {
    this.#modelsSize = h('span', {});
    this.#refreshModelsSize();
    return h('div', { class: 'field' },
      h('p', {}, `${STRINGS.settings.modelsSize}: `, this.#modelsSize),
      h('button', { type: 'button', class: 'secondary', onclick: () => this.#deleteModels() }, STRINGS.settings.deleteModels));
  }

  #refreshModelsSize() {
    const request = ++this.#sizeRequest;
    const size = this.#modelsSize;
    size.textContent = STRINGS.common.loading;
    const show = text => { if (request === this.#sizeRequest) size.textContent = text; };
    this.#deps.modelCache.estimateSizeBytes().then(
      bytes => show(bytes == null ? STRINGS.common.notAvailable : formatBytes(bytes)),
      () => show(STRINGS.common.notAvailable));
  }

  #anoTeleiaToggle() {
    const { settings } = this.#deps;
    const box = h('input', { type: 'checkbox', checked: settings.current.removeAnoTeleia, onchange: () => settings.update({ removeAnoTeleia: box.checked }) });
    return h('div', { class: 'field' },
      h('label', { class: 'choice' }, box, h('span', {}, STRINGS.settings.noAnoTeleia)),
      h('p', { class: 'hint' }, STRINGS.settings.noAnoTeleiaHint));
  }

  /* ---------------------------------------------------------------- διαγραφές */

  async #deleteModels() {
    const s = STRINGS.settings;
    if (!(await confirmAction({ message: s.deleteModelsConfirm, confirmLabel: s.deleteModels, danger: true }))) return;
    await runAction(this.#deps.toasts, () => this.#deps.dataErasure.erase([ERASE_TARGETS.MODELS]), { success: s.modelsDeleted });
    this.#refreshModelsSize();
  }

  async #eraseAll() {
    const s = STRINGS.settings;
    if (!(await confirmAction({ message: s.deleteEverythingConfirm, confirmLabel: s.deleteEverything, danger: true }))) return;
    await runAction(this.#deps.toasts, () => this.#deps.dataErasure.eraseAll(), { success: s.everythingDeleted });
    // Άλλαξαν όλα (κλειδιά, ρυθμίσεις, μοντέλα): οι ενότητες ξαναγράφονται, η επικεφαλίδα μένει.
    this.#drawSections();
    this.#heading.focus({ preventScroll: true });
  }
}
