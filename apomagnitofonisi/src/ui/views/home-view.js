/**
 * Προβολή «Νέα μεταγραφή»: επιλογή αρχείου (ή σύρσιμο, ή κοινή χρήση από
 * άλλη εφαρμογή), μηχανή, γλώσσα, ομιλητές, ποιότητα και έναρξη.
 *
 * Το αν μια μηχανή είναι διαθέσιμη και ποια επίπεδα ποιότητας τρέχουν σε αυτή
 * τη συσκευή τα λέει η υπηρεσία μεταγραφής (OO-003): η προβολή δεν ξέρει τους
 * κανόνες των μηχανών (κλειδιά, WebGPU), μόνο δείχνει την απάντηση.
 */
import { h, field, replaceContent } from '../dom.js';
import { STRINGS, downloadSizeHint, errorMessage, qualityLabel } from '../strings.js';
import { formatBytes, formatDuration } from '../formatters.js';
import { ROUTES, hrefFor } from '../routes.js';
import { JOB_STATUSES } from '../transcription-job.js';
import { ERROR_CODES } from '../../application/errors.js';
import { LANGUAGES, AUTO_LANGUAGE_CODE } from '../../config/languages.js';
import { AUTO_LOCAL_QUALITY } from '../../config/models.js';
import { ENGINE_KINDS } from '../../domain/transcript.js';

const ACCEPTED_FILES = 'audio/*,video/*,.mp3,.m4a,.mp4,.wav,.ogg,.oga,.opus,.webm,.flac,.aac,.mov,.mkv,.3gp,.amr,.wma';
const MAX_SPEAKER_CHOICE = 10;

export class HomeView {
  title = STRINGS.home.title;
  navKey = 'home';

  #deps;
  #file = null;
  #fileInfo = null;
  #fileError = null;
  #qualityPresets = null;
  #availability = null;
  #availabilityRequest = 0;
  #root = null;
  #intro = null;
  #details = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/settings-service.js').SettingsService} deps.settings
   * @param {Pick<import('../../application/transcription-service.js').TranscriptionService, 'engineKinds'|'checkAvailability'|'describeQualityPresets'>} deps.transcription
   * @param {import('../transcription-job.js').TranscriptionJob} deps.job
   * @param {Pick<import('../../application/ports.js').MediaReader, 'probe'>} deps.mediaReader
   * @param {import('../session-media.js').SessionMedia} deps.sessionMedia
   * @param {{ navigate: (path: string) => void, currentPath: string }} deps.router
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {{ initialFile?: File|null }} [params]  αρχείο από κοινή χρήση
   */
  constructor(deps, { initialFile = null } = {}) {
    this.#deps = deps;
    if (initialFile) this.#selectFile(initialFile);
  }

  render() {
    // Η ζώνη επιλογής αρχείου φτιάχνεται μία φορά: έτσι μια ανανέωση της
    // προβολής (π.χ. όταν έρθουν τα επίπεδα ποιότητας) δεν αντικαθιστά ποτέ
    // το <input type="file"> τη στιγμή που ο χρήστης διαλέγει αρχείο.
    this.#intro = h('div');
    this.#details = h('div');
    this.#root = h('section', { class: 'view home-view' }, h('h1', {}, STRINGS.home.title), this.#intro, this.#dropZone(), this.#details);
    this.#draw();
    this.#deps.transcription.describeQualityPresets(ENGINE_KINDS.LOCAL).then(presets => { this.#qualityPresets = presets; this.#draw(); }, () => {});
    this.#refreshAvailability();
    return this.#root;
  }

  #draw() {
    if (!this.#root) return;
    const { job } = this.#deps;
    replaceContent(this.#intro,
      job.isRunning ? h('div', { class: 'notice' }, STRINGS.home.jobRunning, ' ', h('a', { href: hrefFor(ROUTES.progress()) }, STRINGS.home.showJob)) : null,
      this.#deps.settings.current.onboardingDismissed ? null : this.#onboarding());
    replaceContent(this.#details,
      this.#file ? this.#fileCard() : null,
      this.#file ? this.#optionsForm() : null);
  }

  /** Ρωτά την υπηρεσία αν η επιλεγμένη μηχανή μπορεί να τρέξει με τις τρέχουσες επιλογές. */
  #refreshAvailability() {
    const request = ++this.#availabilityRequest;
    const { engineKind } = this.#deps.settings.current;
    this.#deps.transcription.checkAvailability(engineKind, this.#recognitionOptions()).then(availability => {
      if (request !== this.#availabilityRequest) return;
      this.#availability = availability;
      this.#draw();
    }, () => {});
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
    const { settings, transcription } = this.#deps;
    const current = settings.current;
    const engine = current.engineKind;
    const form = h('form', { class: 'card options', novalidate: true });

    form.append(h('fieldset', {},
      h('legend', {}, STRINGS.home.engine),
      transcription.engineKinds.map(kind => this.#engineChoice(kind, engine)),
      this.#availabilityNotice()));

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

    if (engine === ENGINE_KINDS.LOCAL) form.append(this.#qualityField(current.localQualityPreset));

    const blocked = !(this.#availability && this.#availability.available) || (this.#fileInfo && !this.#fileInfo.hasAudio) || this.#deps.job.isRunning;
    form.append(h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary large', disabled: blocked }, STRINGS.home.start)));
    form.addEventListener('submit', event => { event.preventDefault(); if (!blocked) this.#start(); });
    return form;
  }

  #engineChoice(kind, selected) {
    const texts = STRINGS.engines[kind] || { label: kind, hint: '' };
    return h('label', { class: 'choice' },
      h('input', { type: 'radio', name: 'engine', value: kind, checked: selected === kind, onchange: () => {
        this.#deps.settings.update({ engineKind: kind });
        this.#availability = null;
        this.#draw();
        this.#refreshAvailability();
      } }),
      h('span', {}, h('strong', {}, texts.label), h('span', { class: 'hint' }, texts.hint)));
  }

  /** Γιατί δεν ξεκινά η μεταγραφή (π.χ. λείπει κλειδί), με σύνδεσμο στις Ρυθμίσεις όπου βοηθά. */
  #availabilityNotice() {
    const availability = this.#availability;
    if (!availability || availability.available) return null;
    const needsSettings = availability.reason === ERROR_CODES.KEY_MISSING;
    return h('p', { class: 'warning' },
      errorMessage({ code: availability.reason }),
      needsSettings ? [' ', h('a', { href: hrefFor(ROUTES.settings()) }, STRINGS.home.goToSettings)] : null);
  }

  #qualityField(selected) {
    const { settings } = this.#deps;
    const description = this.#qualityPresets;
    const presets = description ? description.presets : [];
    const autoLabel = description ? STRINGS.quality.autoResolves(qualityLabel(description.autoPresetId)) : qualityLabel(AUTO_LOCAL_QUALITY);
    const select = h('select', { onchange: () => { settings.update({ localQualityPreset: select.value }); this.#refreshAvailability(); } },
      h('option', { value: AUTO_LOCAL_QUALITY, selected: selected === AUTO_LOCAL_QUALITY }, autoLabel),
      presets.map(p => h('option', { value: p.id, selected: selected === p.id, disabled: !p.available },
        p.available ? `${qualityLabel(p.id)}, ${downloadSizeHint(p.approxDownloadMb)}` : `${qualityLabel(p.id)} (${STRINGS.quality.unavailable})`)));
    const hint = description ? (description.accelerated ? STRINGS.home.webgpuYes : STRINGS.home.webgpuNo) : STRINGS.common.loading;
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

  /** Οι επιλογές μεταγραφής από τις ρυθμίσεις. */
  #recognitionOptions() {
    const current = this.#deps.settings.current;
    const diarize = current.diarizeByEngine[current.engineKind];
    return {
      languageCode: current.languageCode,
      diarize,
      expectedSpeakers: diarize ? current.expectedSpeakers : null,
      localQualityPreset: current.localQualityPreset,
    };
  }

  #start() {
    const { settings, job, sessionMedia, router, toasts } = this.#deps;
    const current = settings.current;
    const file = this.#file;
    const pending = job.start({
      media: file,
      engineKind: current.engineKind,
      options: this.#recognitionOptions(),
      textOptions: { removeAnoTeleia: current.removeAnoTeleia },
    });
    router.navigate(ROUTES.progress());
    pending.then(state => {
      if (state.status !== JOB_STATUSES.DONE) return;
      const { transcript } = state;
      sessionMedia.attach(transcript.id, file);
      const path = ROUTES.transcript(transcript.id);
      if (router.currentPath === ROUTES.progress()) router.navigate(path);
      else toasts.show(transcript.title || STRINGS.transcript.untitled, { tone: 'success', action: { label: STRINGS.common.open, run: () => router.navigate(path) } });
    });
  }
}
