/**
 * Προβολή «Νέα μεταγραφή»: επιλογή αρχείου (ή σύρσιμο, ή κοινή χρήση από
 * άλλη εφαρμογή), μηχανή, γλώσσα, ομιλητές, ποιότητα και έναρξη.
 *
 * Το αν μια μηχανή είναι διαθέσιμη και ποια επίπεδα ποιότητας έχει σε αυτή τη
 * συσκευή τα λέει η υπηρεσία μεταγραφής (OO-003). Η προβολή δεν ξέρει κανόνες
 * μηχανών: κάθε αλλαγή επιλογής περνά από το #onOptionsChanged, που ρωτά την
 * υπηρεσία για την επιλεγμένη μηχανή με όλες τις επιλογές, και το πεδίο
 * ποιότητας φαίνεται μόνο όταν η μηχανή έχει επίπεδα (OO-017, CA-008).
 *
 * Η κάρτα του αρχείου και η φόρμα φτιάχνονται ΜΙΑ φορά (OO-001): οι αλλαγές
 * ενημερώνουν μόνο ό,τι εξαρτάται από αυτές (ομιλητές, ποιότητα, ειδοποίηση,
 * κουμπί «Έναρξη»), ώστε η εστίαση να μένει εκεί που είναι, π.χ. όταν ο
 * χρήστης αλλάζει μηχανή με τα βελάκια.
 */
import { h, field, replaceContent } from '../dom.js';
import { STRINGS, errorMessage, messageForCode } from '../strings.js';
import { reportUnexpected } from '../feedback.js';
import { formatBytes, formatDuration } from '../formatters.js';
import { displayTitle } from '../presentation.js';
import { ROUTES, hrefFor } from '../routes.js';
import { JOB_STATUSES } from '../transcription-job.js';
import { qualityOptions } from '../components/quality-options.js';
import { ERROR_CODES } from '../../application/errors.js';
import { LANGUAGES, AUTO_LANGUAGE_CODE } from '../../config/languages.js';

const ACCEPTED_FILES = 'audio/*,video/*,.mp3,.m4a,.mp4,.wav,.ogg,.oga,.opus,.webm,.flac,.aac,.mov,.mkv,.3gp,.amr,.wma';
/** Πόσες επιλογές έχει ο «Αριθμός ομιλητών» (οι συσκέψεις σπάνια έχουν περισσότερους). */
const MAX_SPEAKER_CHOICE = 10;

export class HomeView {
  title = STRINGS.home.title;
  navKey = 'home';

  #deps;
  #file = null;
  #fileInfo = null;
  #fileError = null;
  #availability = null;
  #availabilityEngine = null;
  #availabilityRequest = 0;
  /** @type {Map<string, Promise<import('../../application/ports.js').QualityPresetsDescription|null>>} */
  #qualityByEngine = new Map();
  #renderedQuality = undefined;
  #jobRunning = false;
  #unsubscribe = null;
  // Στοιχεία που φτιάχνονται μία φορά:
  #root = null;
  #heading = null;
  #jobNotice = null;
  #details = null;
  #fileCard = null;
  #form = null;

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
    this.#heading = h('h1', {}, STRINGS.home.title);
    this.#jobNotice = h('div', { class: 'notice', hidden: true }, STRINGS.home.jobRunning, ' ', h('a', { href: hrefFor(ROUTES.progress()) }, STRINGS.home.showJob));
    this.#details = h('div');
    // Η ζώνη επιλογής αρχείου φτιάχνεται μία φορά: καμία ενημέρωση δεν
    // αντικαθιστά το <input type="file"> τη στιγμή που ο χρήστης διαλέγει αρχείο.
    this.#root = h('section', { class: 'view home-view' },
      this.#heading,
      this.#jobNotice,
      this.#deps.settings.current.onboardingDismissed ? null : this.#onboarding(),
      this.#dropZone(),
      this.#details);
    this.#unsubscribe = this.#deps.job.subscribe(() => this.#onJobChanged());
    if (this.#file) this.#showFile();
    return this.#root;
  }

  dispose() {
    this.#unsubscribe?.();
  }

  /* ---------------------------------------------------------------- σκελετός */

  #onboarding() {
    const s = STRINGS.onboarding;
    const card = h('aside', { class: 'card onboarding', 'aria-labelledby': 'onboarding-title' },
      h('h2', { id: 'onboarding-title' }, s.title),
      h('p', {}, s.intro),
      h('ul', {}, h('li', {}, s.local), h('li', {}, s.cloud), h('li', {}, s.summary), h('li', {}, s.keys)),
      h('button', { type: 'button', class: 'secondary', onclick: () => {
        this.#deps.settings.update({ onboardingDismissed: true });
        card.remove();
        this.#heading.focus({ preventScroll: true });
      } }, s.dismiss));
    return card;
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

  /** Η κάρτα του αρχείου και η φόρμα: φτιάχνονται με το πρώτο αρχείο, μετά μόνο ενημερώνονται. */
  #showFile() {
    if (!this.#form) {
      this.#fileCard = this.#buildFileCard();
      this.#form = this.#buildForm();
      this.#details.replaceChildren(this.#fileCard.root, this.#form.root);
      this.#onOptionsChanged(null);
    }
    this.#refreshFileCard();
    this.#refreshStart();
  }

  #buildFileCard() {
    const card = {
      name: h('p', { class: 'file-name' }),
      meta: h('p', { class: 'meta' }),
      probing: h('p', { class: 'hint' }, STRINGS.home.probing),
      noAudio: h('p', { class: 'error', hidden: true }, STRINGS.home.noAudio),
      problem: h('p', { class: 'warning', hidden: true }),
    };
    card.root = h('div', { class: 'card file-card', 'aria-live': 'polite' },
      h('h2', {}, STRINGS.home.fileInfo), card.name, card.meta, card.probing, card.noAudio, card.problem);
    return card;
  }

  #buildForm() {
    const { settings, transcription } = this.#deps;
    const current = settings.current;
    const form = { engines: new Map() };

    form.availability = h('p', { class: 'warning', hidden: true });
    const engines = h('fieldset', {},
      h('legend', {}, STRINGS.home.engine),
      transcription.engineKinds.map(kind => {
        const texts = STRINGS.engines[kind] || { label: kind, hint: '' };
        const radio = h('input', { type: 'radio', name: 'engine', value: kind, checked: current.engineKind === kind, onchange: () => this.#onOptionsChanged({ engineKind: kind }) });
        form.engines.set(kind, radio);
        return h('label', { class: 'choice' }, radio, h('span', {}, h('strong', {}, texts.label), h('span', { class: 'hint' }, texts.hint)));
      }),
      form.availability);

    form.language = h('select', { onchange: () => this.#onOptionsChanged({ languageCode: form.language.value }) },
      h('option', { value: AUTO_LANGUAGE_CODE }, STRINGS.home.autoLanguage),
      LANGUAGES.map(l => h('option', { value: l.code, lang: l.code }, l.label)));

    form.diarize = h('input', { type: 'checkbox', onchange: () => {
      const { engineKind, diarizeByEngine } = settings.current;
      this.#onOptionsChanged({ diarizeByEngine: { ...diarizeByEngine, [engineKind]: form.diarize.checked } });
    } });
    form.diarizeHint = h('p', { class: 'hint', hidden: true });

    form.speakers = h('select', { onchange: () => this.#onOptionsChanged({ expectedSpeakers: form.speakers.value ? Number(form.speakers.value) : null }) },
      h('option', { value: '' }, STRINGS.home.speakersAuto),
      Array.from({ length: MAX_SPEAKER_CHOICE }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
    form.speakersField = field(STRINGS.home.speakers, form.speakers);

    form.quality = h('select', { onchange: () => this.#onOptionsChanged({ localQuality: form.quality.value }) });
    form.qualityField = field(STRINGS.home.quality, form.quality, STRINGS.common.loading);
    form.qualityHint = form.qualityField.querySelector('.hint');
    form.qualityField.hidden = true;

    form.start = h('button', { type: 'submit', class: 'primary large', disabled: true }, STRINGS.home.start);
    form.root = h('form', { class: 'card options', novalidate: true },
      engines,
      field(STRINGS.home.language, form.language),
      h('div', { class: 'field' }, h('label', { class: 'choice' }, form.diarize, h('span', {}, STRINGS.home.diarize)), form.diarizeHint),
      form.speakersField,
      form.qualityField,
      h('div', { class: 'actions' }, form.start));
    form.root.addEventListener('submit', event => {
      event.preventDefault();
      if (this.#canStart()) this.#start();
    });
    return form;
  }

  /* ---------------------------------------------------------------- ενημερώσεις */

  /**
   * Η μία διαδρομή κάθε αλλαγής επιλογής (OO-017): αποθήκευση στις ρυθμίσεις,
   * ενημέρωση των εξαρτημένων πεδίων, και ερώτηση στην υπηρεσία για την
   * επιλεγμένη μηχανή (διαθεσιμότητα με όλες τις επιλογές, επίπεδα ποιότητας).
   * @param {Partial<import('../../application/settings-service.js').Settings>|null} patch
   */
  #onOptionsChanged(patch) {
    if (patch) this.#deps.settings.update(patch);
    this.#refreshOptions();
    this.#refreshAvailability();
    this.#refreshQuality();
  }

  /** Τα πεδία από τις αποθηκευμένες ρυθμίσεις (ό,τι απέρριψαν οι ρυθμίσεις επανέρχεται). */
  #refreshOptions() {
    const form = this.#form;
    const current = this.#deps.settings.current;
    const engine = current.engineKind;
    for (const [kind, radio] of form.engines) radio.checked = kind === engine;
    form.language.value = current.languageCode;
    const diarize = current.diarizeByEngine[engine];
    form.diarize.checked = diarize;
    const hint = STRINGS.engines[engine] && STRINGS.engines[engine].diarizeHint;
    form.diarizeHint.textContent = hint || '';
    form.diarizeHint.hidden = !hint;
    form.speakersField.hidden = !diarize;
    form.speakers.value = current.expectedSpeakers == null ? '' : String(current.expectedSpeakers);
  }

  /** Ρωτά αν η επιλεγμένη μηχανή τρέχει με τις τρέχουσες επιλογές. Μόνο η τελευταία απάντηση μετρά. */
  #refreshAvailability() {
    const request = ++this.#availabilityRequest;
    const engine = this.#deps.settings.current.engineKind;
    if (engine !== this.#availabilityEngine) {
      // Άλλη μηχανή: η παλιά απάντηση δεν ισχύει, η «Έναρξη» περιμένει τη νέα.
      this.#availabilityEngine = engine;
      this.#showAvailability(null);
    }
    this.#deps.transcription.checkAvailability(engine, this.#recognitionOptions()).then(
      availability => { if (request === this.#availabilityRequest) this.#showAvailability(availability); },
      error => {
        reportUnexpected(error);
        if (request === this.#availabilityRequest) this.#showAvailability({ available: false, reason: ERROR_CODES.UNKNOWN });
      });
  }

  /** @param {import('../../application/ports.js').Availability|null} availability */
  #showAvailability(availability) {
    this.#availability = availability;
    const notice = this.#form.availability;
    const blocked = Boolean(availability && !availability.available);
    notice.hidden = !blocked;
    if (blocked) {
      const reason = availability.reason || ERROR_CODES.DEVICE_UNSUPPORTED;
      replaceContent(notice, messageForCode(reason),
        reason === ERROR_CODES.KEY_MISSING ? [' ', h('a', { href: hrefFor(ROUTES.settings()) }, STRINGS.home.goToSettings)] : null);
    }
    this.#refreshStart();
  }

  /** Το πεδίο ποιότητας, μόνο όταν η επιλεγμένη μηχανή έχει επίπεδα. */
  #refreshQuality() {
    const engine = this.#deps.settings.current.engineKind;
    this.#qualityFor(engine).then(description => {
      if (!this.#form || this.#deps.settings.current.engineKind !== engine) return;
      const { quality, qualityField, qualityHint } = this.#form;
      qualityField.hidden = !description;
      if (!description) return;
      if (this.#renderedQuality !== description) {
        // Οι επιλογές αλλάζουν μόνο όταν αλλάζει η περιγραφή, όχι σε κάθε επιλογή του χρήστη.
        this.#renderedQuality = description;
        quality.replaceChildren(...qualityOptions(description, { withDownloadSize: true }));
        qualityHint.textContent = description.accelerated ? STRINGS.home.webgpuYes : STRINGS.home.webgpuNo;
      }
      quality.value = this.#deps.settings.current.localQuality;
    });
  }

  /** Τα επίπεδα ποιότητας μιας μηχανής, μία ερώτηση ανά μηχανή (δεν αλλάζουν όσο είναι ανοιχτή η σελίδα). */
  #qualityFor(engine) {
    if (!this.#qualityByEngine.has(engine)) {
      this.#qualityByEngine.set(engine, this.#deps.transcription.describeQualityPresets(engine).catch(error => {
        reportUnexpected(error);
        return null;
      }));
    }
    return this.#qualityByEngine.get(engine);
  }

  #refreshFileCard() {
    const card = this.#fileCard;
    const info = this.#fileInfo;
    const problem = this.#fileError;
    card.name.textContent = this.#file.name;
    card.meta.textContent = info && info.durationSec != null ? `${formatBytes(this.#file.size)}, ${formatDuration(info.durationSec)}` : formatBytes(this.#file.size);
    card.probing.hidden = Boolean(info || problem);
    card.noAudio.hidden = !(info && !info.hasAudio);
    card.problem.hidden = !problem;
    card.problem.textContent = problem ? errorMessage(problem) : '';
  }

  #onJobChanged() {
    const running = this.#deps.job.isRunning;
    if (running === this.#jobRunning) return;
    this.#jobRunning = running;
    this.#jobNotice.hidden = !running;
    this.#refreshStart();
  }

  #canStart() {
    const availability = this.#availability;
    const noAudio = this.#fileInfo && !this.#fileInfo.hasAudio;
    return Boolean(this.#file && availability && availability.available && !noAudio && !this.#deps.job.isRunning);
  }

  #refreshStart() {
    if (this.#form) this.#form.start.disabled = !this.#canStart();
  }

  /* ---------------------------------------------------------------- ενέργειες */

  async #selectFile(file) {
    this.#file = file;
    this.#fileInfo = null;
    this.#fileError = null;
    if (this.#root) this.#showFile();
    try {
      const info = await this.#deps.mediaReader.probe(file);
      if (this.#file === file) this.#fileInfo = info;
    } catch (error) {
      if (this.#file === file) this.#fileError = error;
    }
    if (this.#root && this.#file === file) this.#showFile();
  }

  /** Οι επιλογές μεταγραφής από τις ρυθμίσεις. */
  #recognitionOptions() {
    const current = this.#deps.settings.current;
    const diarize = current.diarizeByEngine[current.engineKind];
    return {
      languageCode: current.languageCode,
      diarize,
      expectedSpeakers: diarize ? current.expectedSpeakers : null,
      localQuality: current.localQuality,
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
      else toasts.show(displayTitle(transcript), { tone: 'success', action: { label: STRINGS.common.open, run: () => router.navigate(path) } });
    });
  }
}
