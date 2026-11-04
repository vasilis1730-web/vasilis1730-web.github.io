/**
 * Η κατάσταση της μεταγραφής που τρέχει (μία τη φορά): στάδιο, πρόοδος,
 * κείμενο που έχει ήδη αναγνωριστεί, αποτέλεσμα ή σφάλμα. Οι προβολές
 * ακούνε τις αλλαγές (Observer). Η ίδια η μεταγραφή γίνεται από το
 * TranscriptionService.
 *
 * Η μεταγραφή ζει όσο η εφαρμογή, όχι όσο μια προβολή: ο χρήστης μπορεί να
 * πάει στις Ρυθμίσεις όσο τρέχει. Γι' αυτό η διαγραφή δεδομένων τη σταματά
 * πρώτα με το cancelAndSettle() και περιμένει να σταματήσει (OO-014, CA-013).
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
import { reportUnexpected } from './feedback.js';

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
  /** @type {Promise<JobState>|null} η μεταγραφή που τρέχει */
  #running = null;

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
  start(request) {
    if (this.isRunning) return Promise.reject(new Error('τρέχει ήδη μεταγραφή'));
    const running = this.#run(request);
    this.#running = running;
    const forget = () => { if (this.#running === running) this.#running = null; };
    running.then(forget, forget);
    return running;
  }

  cancel() {
    this.#controller?.abort();
  }

  /**
   * Ακύρωση και αναμονή μέχρι να σταματήσει πραγματικά η μεταγραφή: μετά δεν
   * γράφεται τίποτα (ούτε μεταγραφή ούτε μοντέλα). Χωρίς μεταγραφή που τρέχει
   * επιστρέφει αμέσως την τρέχουσα κατάσταση.
   * @returns {Promise<JobState>}
   */
  cancelAndSettle() {
    this.cancel();
    return this.#running ?? Promise.resolve(this.#state);
  }

  /** Επιστροφή σε αδράνεια μετά από αποτέλεσμα ή σφάλμα. */
  reset() {
    if (!this.isRunning) this.#set(IDLE);
  }

  async #run(request) {
    this.#controller = new AbortController();
    const { signal } = this.#controller;
    this.#set({ ...IDLE, status: JOB_STATUSES.RUNNING, fileName: request.media.name || null });
    try {
      await this.#wakeLock.acquire();
      const transcript = await this.#service.transcribe({
        ...request,
        signal,
        onProgress: progress => this.#set({ ...this.#state, progress }),
        onPartialSegments: segments => this.#set({ ...this.#state, partialSegments: [...this.#state.partialSegments, ...segments] }),
      });
      this.#set({ ...this.#state, status: JOB_STATUSES.DONE, transcript });
    } catch (error) {
      const cancelled = isCancellation(error) || signal.aborted;
      if (!cancelled) reportUnexpected(error);
      this.#set({ ...this.#state, status: cancelled ? JOB_STATUSES.CANCELLED : JOB_STATUSES.FAILED, error: toAppError(error) });
    } finally {
      this.#controller = null;
      await this.#wakeLock.release().catch(() => {});
    }
    return this.#state;
  }

  #set(state) {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) listener(this.#state);
  }
}
