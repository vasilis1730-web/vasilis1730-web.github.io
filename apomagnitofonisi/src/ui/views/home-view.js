/**
 * Προβολή «Νέα μεταγραφή»: επιλογή αρχείου (ή σύρσιμο, ή κοινή χρήση από
 * άλλη εφαρμογή), μηχανή, γλώσσα, ομιλητές, ποιότητα και έναρξη.
 */
import { h, field, replaceContent } from '../dom.js';
import { STRINGS, downloadSizeHint, errorMessage } from '../strings.js';
import { formatBytes, formatDuration } from '../formatters.js';
import { LANGUAGES, AUTO_LANGUAGE_CODE } from '../../config/languages.js';
import { LOCAL_QUALITY_PRESET_IDS } from '../../config/models.js';
import { ENGINE_KINDS } from '../../domain/transcript.js';

const ACCEPTED_FILES = 'audio/*,video/*,.mp3,.m4a,.mp4,.wav,.ogg,.oga,.opus,.webm,.flac,.aac,.mov,.mkv,.3gp,.amr,.wma';
const MAX_SPEAKER_CHOICE = 10;
const QUALITY_LABELS = Object.freeze({
  [LOCAL_QUALITY_PRESET_IDS.FAST]: STRINGS.home.qualityFast,
  [LOCAL_QUALITY_PRESET_IDS.BALANCED]: STRINGS.home.qualityBalanced,
  [LOCAL_QUALITY_PRESET_IDS.ACCURATE]: STRINGS.home.qualityAccurate,
});

export class HomeView {
  title = STRINGS.home.title;
  navKey = 'home';

  #deps;
  #file = null;
  #fileInfo = null;
  #fileError = null;
  #capabilities = null;
  #root = null;
  #intro = null;
  #details = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/settings-service.js').SettingsService} deps.settings
   * @param {import('../../application/api-key-service.js').ApiKeyService} deps.apiKeys
   * @param {import('../transcription-job.js').TranscriptionJob} deps.job
   * @param {import('../../application/ports.js').MediaReader} deps.mediaReader
   * @param {() => Promise<import('../../infrastructure/platform/capabilities.js').DeviceCapabilities>} deps.capabilities
   * @param {(caps: any) => { presetId: string, choice: { approxDownloadMb: number }|null }[]} deps.describeLocalPresets
   * @param {import('../session-media.js').SessionMedia} deps.sessionMedia
   * @param {{ navigate: (path: string) => void, currentPath: string }} deps.router
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {File|null} [deps.initialFile]  αρχείο από κοινή χρήση
   */
  constructor(deps) {
    this.#deps = deps;
    if (deps.initialFile) this.#selectFile(deps.initialFile);
  }

  render() {
    // Η ζώνη επιλογής αρχείου φτιάχνεται μία φορά: έτσι μια ανανέωση της
    // προβολής (π.χ. όταν έρθουν οι δυνατότητες της συσκευής) δεν αντικαθιστά
    // ποτέ το <input type="file"> τη στιγμή που ο χρήστης διαλέγει αρχείο.
    this.#intro = h('div');
    this.#details = h('div');
    this.#root = h('section', { class: 'view home-view' }, h('h1', {}, STRINGS.home.title), this.#intro, this.#dropZone(), this.#details);
    this.#draw();
    this.#deps.capabilities().then(caps => { this.#capabilities = caps; this.#draw(); });
    return this.#root;
  }

  #draw() {
    if (!this.#root) return;
    const { job } = this.#deps;
    replaceContent(this.#intro,
      job.isRunning ? h('div', { class: 'notice' }, STRINGS.home.jobRunning, ' ', h('a', { href: '#/progress' }, STRINGS.home.showJob)) : null,
      this.#deps.settings.current.onboardingDismissed ? null : this.#onboarding());
    replaceContent(this.#details,
      this.#file ? this.#fileCard() : null,
      this.#file ? this.#optionsForm() : null);
  }

  #onboarding() {
    const s = STRINGS.onboarding;
    return h('aside', { class: 'card onboarding', 'aria-labelledby': 'onboarding-title' },
      h('h2', { id: 'onboarding-title' }, s.title),
      h('p', {}, s.intro),
      h('ul', {}, h('li', {}, s.local), h('li', {}, s.cloud), h('li', {}, s.summary), h('li', {}, s.keys)),
      h('button', { type: 'button', class: 'secondary', onclick: () => { this.#deps.settings.update({ onboardingDismissed: true }); this.#draw(); } }, s.dismiss));
  }

  #dropZone() {
    const input = h('input', { type: 'file', accept: ACCEPTED_FILES, class: 'visually-hidden', id: 'media-file' });
    input.addEventListener('change', () => { if (input.files && input.files[0]) this.#selectFile(input.files[0]); });
    const zone = h('div', { class: 'dropzone' },
      h('p', {}, STRINGS.home.dropHint),
      h('label', { for: 'media-file', class: 'button primary' }, STRINGS.home.choose),
      input,
      h('p', { class: 'hint' }, STRINGS.home.formats));
    zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('dragging'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
    zone.addEventListener('drop', event => {
      event.preventDefault();
      zone.classList.remove('dragging');
      const file = event.dataTransfer && event.dataTransfer.files[0];
      if (file) this.#selectFile(file);
    });
    return zone;
  }

  #fileCard() {
    const info = this.#fileInfo;
    return h('div', { class: 'card file-card', 'aria-live': 'polite' },
      h('h2', {}, STRINGS.home.fileInfo),
      h('p', { class: 'file-name' }, this.#file.name),
      h('p', { class: 'meta' }, formatBytes(this.#file.size), info && info.durationSec != null ? `, ${formatDuration(info.durationSec)}` : ''),
      !info && !this.#fileError ? h('p', { class: 'hint' }, STRINGS.home.probing) : null,
      info && !info.hasAudio ? h('p', { class: 'error' }, STRINGS.home.noAudio) : null,
      this.#fileError ? h('p', { class: 'warning' }, errorMessage(this.#fileError)) : null);
  }

  #optionsForm() {
    const { settings, apiKeys } = this.#deps;
    const current = settings.current;
    const engine = current.engineKind;
    const hasCloudKey = apiKeys.hasKey('elevenlabs');
    const form = h('form', { class: 'card options', novalidate: true });

    const engineChoice = (value, label, hint) => h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'engine', value, checked: engine === value, onchange: () => { settings.update({ engineKind: value }); this.#draw(); } }),
      h('span', {}, h('strong', {}, label), h('span', { class: 'hint' }, hint)));
    form.append(h('fieldset', {},
      h('legend', {}, STRINGS.home.engine),
      engineChoice(ENGINE_KINDS.LOCAL, STRINGS.home.engineLocal, STRINGS.home.engineLocalHint),
      engineChoice(ENGINE_KINDS.ELEVENLABS, STRINGS.home.engineCloud, STRINGS.home.engineCloudHint),
      engine === ENGINE_KINDS.ELEVENLABS && !hasCloudKey
        ? h('p', { class: 'warning' }, STRINGS.home.engineCloudNoKey, ' ', h('a', { href: '#/settings' }, STRINGS.home.goToSettings))
        : null));

    const language = h('select', { onchange: () => settings.update({ languageCode: language.value }) },
      h('option', { value: AUTO_LANGUAGE_CODE, selected: current.languageCode === AUTO_LANGUAGE_CODE }, STRINGS.home.autoLanguage),
      LANGUAGES.map(l => h('option', { value: l.code, selected: current.languageCode === l.code, lang: l.code }, l.label)));
    form.append(field(STRINGS.home.language, language));

    const diarizeOn = current.diarizeByEngine[engine];
    const diarize = h('input', { type: 'checkbox', checked: diarizeOn, onchange: () => {
      settings.update({ diarizeByEngine: { ...settings.current.diarizeByEngine, [engine]: diarize.checked } });
      this.#draw();
    } });
    form.append(h('div', { class: 'field' },
      h('label', { class: 'choice' }, diarize, h('span', {}, STRINGS.home.diarize)),
      engine === ENGINE_KINDS.LOCAL ? h('p', { class: 'hint' }, STRINGS.home.diarizeLocalHint) : null));
    if (diarizeOn) {
      const speakers = h('select', { onchange: () => settings.update({ expectedSpeakers: speakers.value ? Number(speakers.value) : null }) },
        h('option', { value: '', selected: current.expectedSpeakers == null }, STRINGS.home.speakersAuto),
        Array.from({ length: MAX_SPEAKER_CHOICE }, (_, i) => h('option', { value: String(i + 1), selected: current.expectedSpeakers === i + 1 }, String(i + 1))));
      form.append(field(STRINGS.home.speakers, speakers));
    }

    if (engine === ENGINE_KINDS.LOCAL) form.append(this.#qualityField(current.localQuality));

    const blocked = (engine === ENGINE_KINDS.ELEVENLABS && !hasCloudKey) || (this.#fileInfo && !this.#fileInfo.hasAudio) || this.#deps.job.isRunning;
    form.append(h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary large', disabled: blocked }, STRINGS.home.start)));
    form.addEventListener('submit', event => { event.preventDefault(); if (!blocked) this.#start(); });
    return form;
  }

  #qualityField(selected) {
    const { settings, describeLocalPresets } = this.#deps;
    const caps = this.#capabilities;
    const presets = caps ? describeLocalPresets(caps) : [];
    const select = h('select', { onchange: () => settings.update({ localQuality: select.value }) },
      h('option', { value: LOCAL_QUALITY_PRESET_IDS.AUTO, selected: selected === LOCAL_QUALITY_PRESET_IDS.AUTO }, STRINGS.home.qualityAuto),
      presets.map(p => h('option', { value: p.presetId, selected: selected === p.presetId, disabled: !p.choice },
        p.choice ? `${QUALITY_LABELS[p.presetId]}, ${downloadSizeHint(p.choice.approxDownloadMb)}` : QUALITY_LABELS[p.presetId])));
    const hint = caps ? (caps.webgpu ? STRINGS.home.webgpuYes : STRINGS.home.webgpuNo) : STRINGS.common.loading;
    return field(STRINGS.home.quality, select, hint);
  }

  async #selectFile(file) {
    this.#file = file;
    this.#fileInfo = null;
    this.#fileError = null;
    if (this.#root) this.#draw();
    try {
      const info = await this.#deps.mediaReader.probe(file);
      if (this.#file === file) this.#fileInfo = info;
    } catch (error) {
      if (this.#file === file) this.#fileError = error;
    }
    if (this.#root && this.#file === file) this.#draw();
  }

  #start() {
    const { settings, job, sessionMedia, router, toasts } = this.#deps;
    const current = settings.current;
    const file = this.#file;
    const engineKind = current.engineKind;
    const diarize = current.diarizeByEngine[engineKind];
    const pending = job.start({
      media: file,
      engineKind,
      options: { languageCode: current.languageCode, diarize, expectedSpeakers: diarize ? current.expectedSpeakers : null, qualityPreset: current.localQuality },
      textOptions: { removeAnoTeleia: current.removeAnoTeleia },
    });
    router.navigate('/progress');
    pending.then(transcript => {
      if (!transcript) return;
      sessionMedia.attach(transcript.id, file);
      const path = `/t/${encodeURIComponent(transcript.id)}`;
      if (router.currentPath === '/progress') router.navigate(path);
      else toasts.show(transcript.title, { tone: 'success', action: { label: STRINGS.common.open, run: () => router.navigate(path) } });
    });
  }
}
