/**
 * Προβολή «Μεταγραφή σε εξέλιξη»: στάδια, ποσοστό, ό,τι έχει ήδη
 * αναγνωριστεί, ακύρωση, και το αποτέλεσμα ή το σφάλμα.
 *
 * Ο σκελετός φτιάχνεται ΜΙΑ φορά (OO-001): επικεφαλίδα, ένα στοιχείο ανά
 * στάδιο, μία μπάρα προόδου, η περιοχή του κειμένου και ένα κουμπί ενέργειας.
 * Κάθε αλλαγή της μεταγραφής αλλάζει μόνο κείμενα, τιμές και `hidden`, και το
 * πολύ μία φορά ανά καρέ (requestAnimationFrame), γιατί η πρόοδος λήψης και
 * αποστολής έρχεται πολύ συχνά. Το κουμπί δεν αντικαθίσταται ποτέ: στο τέλος
 * αλλάζει μόνο η ετικέτα και η ενέργειά του, άρα η «Ακύρωση» πιάνει πάντα,
 * με ποντίκι, αφή ή πληκτρολόγιο.
 */
import { h } from '../dom.js';
import { STRINGS } from '../strings.js';
import { describeError } from '../feedback.js';
import { formatBytes, formatDuration, formatPercent } from '../formatters.js';
import { ROUTES } from '../routes.js';
import { JOB_STATUSES } from '../transcription-job.js';
import { formatClock } from '../../domain/time-format.js';
import { PROGRESS_STAGES } from '../../application/progress.js';

const STAGE_ORDER = [
  PROGRESS_STAGES.READING,
  PROGRESS_STAGES.DOWNLOADING_MODEL,
  PROGRESS_STAGES.UPLOADING,
  PROGRESS_STAGES.TRANSCRIBING,
  PROGRESS_STAGES.DIARIZING,
  PROGRESS_STAGES.SAVING,
];
/** Πόσα από τα τελευταία τμήματα δείχνονται όσο προχωρά η μεταγραφή. */
const VISIBLE_PARTIAL_SEGMENTS = 30;

const HEADINGS = Object.freeze({
  [JOB_STATUSES.CANCELLED]: STRINGS.progress.cancelledTitle,
  [JOB_STATUSES.FAILED]: STRINGS.progress.failedTitle,
});

export class ProgressView {
  title = STRINGS.progress.title;

  #job;
  #router;
  #unsubscribe = null;
  #frame = 0;
  #pendingState = null;
  #seenStages = new Set();
  #announcedStage = null;
  #partialCount = 0;
  // Ο σκελετός (φτιάχνεται μία φορά στο render):
  #root = null;
  #heading = null;
  #fileName = null;
  #keepOpen = null;
  #stageAnnouncer = null;
  #stageList = null;
  /** @type {Map<string, HTMLElement>} */
  #stageItems = new Map();
  #detail = null;
  #bar = null;
  #detailText = null;
  #failure = null;
  #partialCard = null;
  #partialLines = null;
  #action = null;

  /**
   * @param {Object} deps
   * @param {import('../transcription-job.js').TranscriptionJob} deps.job
   * @param {{ navigate: (path: string) => void }} deps.router
   */
  constructor({ job, router }) {
    this.#job = job;
    this.#router = router;
  }

  render() {
    const s = STRINGS.progress;
    this.#heading = h('h1', {}, s.title);
    this.#fileName = h('p', { class: 'file-name', hidden: true });
    this.#keepOpen = h('p', { class: 'notice', hidden: true }, s.keepOpen);
    // Ανακοινώνει μόνο την αλλαγή σταδίου, όχι κάθε ποσοστό.
    this.#stageAnnouncer = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
    this.#bar = h('progress', { max: 1 });
    this.#detailText = h('span', { class: 'meta' });
    this.#detail = h('div', { class: 'stage-detail' }, this.#bar, this.#detailText);
    this.#stageList = h('ol', { class: 'stages', hidden: true }, STAGE_ORDER.map(stage => {
      const item = h('li', { hidden: true }, h('span', { class: 'stage-name' }, s.stages[stage]));
      this.#stageItems.set(stage, item);
      return item;
    }));
    this.#failure = h('div', { class: 'card error-card', role: 'alert', hidden: true });
    this.#partialLines = h('div', { class: 'partial-lines' });
    this.#partialCard = h('section', { class: 'card partial', 'aria-labelledby': 'partial-title', hidden: true },
      h('h2', { id: 'partial-title' }, s.partial),
      this.#partialLines);
    this.#action = h('button', { type: 'button', class: 'danger', onclick: () => this.#onAction() }, STRINGS.common.cancel);
    this.#root = h('section', { class: 'view progress-view' },
      this.#heading, this.#fileName, this.#keepOpen, this.#stageAnnouncer, this.#stageList, this.#failure, this.#partialCard,
      h('div', { class: 'actions' }, this.#action));
    // Η πρώτη κατάσταση σχεδιάζεται αμέσως (πριν την εστίαση της επικεφαλίδας), οι επόμενες ανά καρέ.
    let first = true;
    this.#unsubscribe = this.#job.subscribe(state => {
      // Κάθε στάδιο μετρά ως «έγινε», ακόμη κι αν κράτησε λιγότερο από ένα καρέ.
      if (state.status === JOB_STATUSES.RUNNING && state.progress) this.#seenStages.add(state.progress.stage);
      if (first) { first = false; this.#draw(state); } else this.#schedule(state);
    });
    return this.#root;
  }

  dispose() {
    this.#unsubscribe?.();
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  #schedule(state) {
    this.#pendingState = state;
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const pending = this.#pendingState;
      this.#pendingState = null;
      if (pending) this.#draw(pending);
    });
  }

  /** Η ενέργεια του κουμπιού για την κατάσταση που φαίνεται: ακύρωση όσο τρέχει, αλλιώς νέα μεταγραφή. */
  #onAction() {
    if (this.#job.isRunning) { this.#job.cancel(); return; }
    this.#job.reset();
    this.#router.navigate(ROUTES.home());
  }

  #draw(state) {
    if (state.status === JOB_STATUSES.IDLE) { queueMicrotask(() => this.#router.navigate(ROUTES.home())); return; }
    const s = STRINGS.progress;
    const running = state.status === JOB_STATUSES.RUNNING;
    this.#heading.textContent = HEADINGS[state.status] || s.title;
    this.#fileName.textContent = state.fileName || '';
    this.#fileName.hidden = !state.fileName;
    this.#keepOpen.hidden = !running;
    this.#drawStages(running ? state.progress : null, running);
    this.#failure.hidden = state.status !== JOB_STATUSES.FAILED;
    if (state.status === JOB_STATUSES.FAILED) this.#failure.replaceChildren(h('p', {}, describeError(state.error)));
    this.#drawPartial(state.partialSegments);
    this.#action.className = running ? 'danger' : 'primary';
    this.#action.textContent = running ? STRINGS.common.cancel : s.newFile;
  }

  #drawStages(progress, running) {
    const current = running && progress ? progress.stage : null;
    this.#stageList.hidden = !running || this.#seenStages.size === 0;
    if (!running) return;
    for (const [stage, item] of this.#stageItems) {
      const active = stage === current;
      item.hidden = !this.#seenStages.has(stage);
      item.className = active ? 'active' : 'done';
      if (active) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    }
    if (current && current !== this.#announcedStage) {
      this.#announcedStage = current;
      this.#stageAnnouncer.textContent = STRINGS.progress.stages[current] || '';
    }
    if (!current) { this.#detail.remove(); return; }
    const item = this.#stageItems.get(current);
    if (item && this.#detail.parentElement !== item) item.append(this.#detail);
    this.#drawDetail(progress);
  }

  /**
   * Μπάρα και κείμενο του τρέχοντος σταδίου. Το detail έχει bytes για τη λήψη
   * μοντέλου και την αποστολή, δευτερόλεπτα για τη μεταγραφή (API-014).
   */
  #drawDetail(progress) {
    const { fraction } = progress;
    const label = STRINGS.progress.stages[progress.stage];
    this.#bar.setAttribute('aria-label', label);
    if (Number.isFinite(fraction)) this.#bar.value = fraction;
    else this.#bar.removeAttribute('value');
    const detail = progress.detail || {};
    let text = Number.isFinite(fraction) ? formatPercent(fraction) : '';
    if (Number.isFinite(detail.loadedBytes) && Number.isFinite(detail.totalBytes)) text += ` (${formatBytes(detail.loadedBytes)} / ${formatBytes(detail.totalBytes)})`;
    else if (Number.isFinite(detail.processedSec)) text += ` (${formatDuration(detail.processedSec)}${Number.isFinite(detail.totalSec) ? ` / ${formatDuration(detail.totalSec)}` : ''})`;
    this.#detailText.textContent = text;
    this.#detailText.hidden = !text;
  }

  /** Προσθέτει μόνο τα νέα τμήματα και κρατά τα τελευταία VISIBLE_PARTIAL_SEGMENTS. */
  #drawPartial(segments) {
    if (segments.length < this.#partialCount) {
      this.#partialLines.replaceChildren();
      this.#partialCount = 0;
    }
    const start = Math.max(this.#partialCount, segments.length - VISIBLE_PARTIAL_SEGMENTS);
    for (const segment of segments.slice(start)) {
      this.#partialLines.append(h('p', {}, h('span', { class: 'time' }, formatClock(segment.start)), ' ', segment.text));
    }
    this.#partialCount = segments.length;
    while (this.#partialLines.childElementCount > VISIBLE_PARTIAL_SEGMENTS) this.#partialLines.firstElementChild.remove();
    this.#partialCard.hidden = segments.length === 0;
  }
}
