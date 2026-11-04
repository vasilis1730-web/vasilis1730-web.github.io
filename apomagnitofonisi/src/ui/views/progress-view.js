/**
 * Προβολή «Μεταγραφή σε εξέλιξη»: στάδια, ποσοστό, ό,τι έχει ήδη
 * αναγνωριστεί, ακύρωση, και το αποτέλεσμα ή το σφάλμα.
 */
import { h, replaceContent } from '../dom.js';
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
  #root = null;
  #unsubscribe = null;
  #seenStages = new Set();

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
    this.#root = h('section', { class: 'view progress-view' });
    this.#unsubscribe = this.#job.subscribe(state => this.#draw(state));
    return this.#root;
  }

  dispose() {
    this.#unsubscribe?.();
  }

  #draw(state) {
    if (state.status === JOB_STATUSES.IDLE) { queueMicrotask(() => this.#router.navigate(ROUTES.home())); return; }
    if (state.progress) this.#seenStages.add(state.progress.stage);
    const s = STRINGS.progress;
    const running = state.status === JOB_STATUSES.RUNNING;
    const heading = HEADINGS[state.status] || s.title;
    replaceContent(this.#root, 
      h('h1', {}, heading),
      state.fileName ? h('p', { class: 'file-name' }, state.fileName) : null,
      running ? h('p', { class: 'notice' }, s.keepOpen) : null,
      running ? this.#stages(state.progress) : null,
      state.status === JOB_STATUSES.FAILED ? this.#failure(state.error) : null,
      this.#partial(state.partialSegments),
      h('div', { class: 'actions' },
        running
          ? h('button', { type: 'button', class: 'danger', onclick: () => this.#job.cancel() }, STRINGS.common.cancel)
          : h('button', { type: 'button', class: 'primary', onclick: () => { this.#job.reset(); this.#router.navigate(ROUTES.home()); } }, s.newFile)),
    );
  }

  #stages(progress) {
    const current = progress ? progress.stage : null;
    const items = STAGE_ORDER.filter(stage => this.#seenStages.has(stage) || stage === current).map(stage => {
      const active = stage === current;
      return h('li', { class: active ? 'active' : 'done', 'aria-current': active ? 'step' : false },
        h('span', { class: 'stage-name' }, STRINGS.progress.stages[stage]),
        active ? this.#activeDetail(progress) : null);
    });
    return h('ol', { class: 'stages', 'aria-live': 'polite' }, items);
  }

  #activeDetail(progress) {
    const fraction = progress.fraction;
    const bar = Number.isFinite(fraction)
      ? h('progress', { max: 1, value: fraction, 'aria-label': STRINGS.progress.stages[progress.stage] })
      : h('progress', { 'aria-label': STRINGS.progress.stages[progress.stage] });
    const detail = progress.detail || {};
    let text = Number.isFinite(fraction) ? formatPercent(fraction) : '';
    if (Number.isFinite(detail.loadedBytes) && Number.isFinite(detail.totalBytes)) text += ` (${formatBytes(detail.loadedBytes)} / ${formatBytes(detail.totalBytes)})`;
    else if (Number.isFinite(detail.processedSec)) text += ` (${formatDuration(detail.processedSec)}${Number.isFinite(detail.totalSec) ? ` / ${formatDuration(detail.totalSec)}` : ''})`;
    return h('div', { class: 'stage-detail' }, bar, text ? h('span', { class: 'meta' }, text) : null);
  }

  #failure(error) {
    return h('div', { class: 'card error-card', role: 'alert' }, h('p', {}, describeError(error)));
  }

  #partial(segments) {
    if (!segments.length) return null;
    const visible = segments.slice(-VISIBLE_PARTIAL_SEGMENTS);
    return h('section', { class: 'card partial', 'aria-labelledby': 'partial-title' },
      h('h2', { id: 'partial-title' }, STRINGS.progress.partial),
      h('div', { class: 'partial-lines' }, visible.map(seg => h('p', {}, h('span', { class: 'time' }, formatClock(seg.start)), ' ', seg.text))));
  }
}
