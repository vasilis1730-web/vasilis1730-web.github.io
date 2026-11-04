/**
 * Η κατάσταση της μεταγραφής που τρέχει (μία τη φορά): στάδιο, πρόοδος,
 * κείμενο που έχει ήδη αναγνωριστεί, αποτέλεσμα ή σφάλμα. Οι προβολές
 * ακούνε τις αλλαγές (Observer). Η ίδια η μεταγραφή γίνεται από το
 * TranscriptionService.
 *
 * @typedef {typeof JOB_STATUSES[keyof typeof JOB_STATUSES]} JobStatus
 *
 * @typedef {Object} JobState
 * @property {JobStatus} status
 * @property {string|null} fileName
 * @property {import('../application/progress.js').ProgressUpdate|null} progress
 * @property {{ start: number, end: number, text: string }[]} partialSegments
 * @property {import('../domain/transcript.js').Transcript|null} transcript
 * @property {import('../application/errors.js').AppError|null} error
 *
 * @typedef {Omit<import('../application/transcription-service.js').TranscriptionRequest, 'signal'|'onProgress'|'onPartialSegments'>} JobRequest
 */
import { isCancellation, toAppError } from '../application/errors.js';

/** Οι καταστάσεις μιας μεταγραφής (API-004). */
export const JOB_STATUSES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const IDLE = Object.freeze({ status: JOB_STATUSES.IDLE, fileName: null, progress: null, partialSegments: [], transcript: null, error: null });

export class TranscriptionJob {
  #service;
  #wakeLock;
  #state = IDLE;
  #listeners = new Set();
  #controller = null;

  /**
   * @param {Object} deps
   * @param {Pick<import('../application/transcription-service.js').TranscriptionService, 'transcribe'>} deps.service
   * @param {{ acquire: () => Promise<void>, release: () => Promise<void> }} deps.wakeLock
   */
  constructor({ service, wakeLock }) {
    this.#service = service;
    this.#wakeLock = wakeLock;
  }

  /** @returns {JobState} */
  get state() {
    return this.#state;
  }

  get isRunning() {
    return this.#state.status === JOB_STATUSES.RUNNING;
  }

  /** @returns {() => void} απεγγραφή */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  /**
   * @param {JobRequest} request
   * @returns {Promise<JobState>} η τελική κατάσταση (done, failed ή cancelled)
   */
  async start(request) {
    if (this.isRunning) throw new Error('τρέχει ήδη μεταγραφή');
    this.#controller = new AbortController();
    this.#set({ ...IDLE, status: JOB_STATUSES.RUNNING, fileName: request.media.name || null });
    await this.#wakeLock.acquire();
    try {
      const transcript = await this.#service.transcribe({
        ...request,
        signal: this.#controller.signal,
        onProgress: progress => this.#set({ ...this.#state, progress }),
        onPartialSegments: segments => this.#set({ ...this.#state, partialSegments: [...this.#state.partialSegments, ...segments] }),
      });
      this.#set({ ...this.#state, status: JOB_STATUSES.DONE, transcript });
    } catch (error) {
      if (!isCancellation(error) && !(error && error.code)) console.error(error);
      this.#set({ ...this.#state, status: isCancellation(error) ? JOB_STATUSES.CANCELLED : JOB_STATUSES.FAILED, error: toAppError(error) });
    } finally {
      this.#controller = null;
      await this.#wakeLock.release();
    }
    return this.#state;
  }

  cancel() {
    this.#controller?.abort();
  }

  /** Επιστροφή σε αδράνεια μετά από αποτέλεσμα ή σφάλμα. */
  reset() {
    if (!this.isRunning) this.#set(IDLE);
  }

  #set(state) {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) listener(this.#state);
  }
}
