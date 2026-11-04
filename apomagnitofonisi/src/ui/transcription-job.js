/**
 * Η κατάσταση της μεταγραφής που τρέχει (μία τη φορά): στάδιο, πρόοδος,
 * κείμενο που έχει ήδη αναγνωριστεί, αποτέλεσμα ή σφάλμα. Οι προβολές
 * ακούνε τις αλλαγές (Observer). Η ίδια η μεταγραφή γίνεται από το
 * TranscriptionService.
 *
 * @typedef {'idle'|'running'|'done'|'failed'|'cancelled'} JobStatus
 *
 * @typedef {Object} JobState
 * @property {JobStatus} status
 * @property {string|null} fileName
 * @property {import('../application/progress.js').ProgressUpdate|null} progress
 * @property {{ start: number, end: number, text: string }[]} partialSegments
 * @property {import('../domain/transcript.js').Transcript|null} transcript
 * @property {import('../application/errors.js').AppError|null} error
 */
import { isCancellation, toAppError } from '../application/errors.js';

const IDLE = Object.freeze({ status: 'idle', fileName: null, progress: null, partialSegments: [], transcript: null, error: null });

export class TranscriptionJob {
  #service;
  #wakeLock;
  #state = IDLE;
  #listeners = new Set();
  #controller = null;

  /**
   * @param {Object} deps
   * @param {import('../application/transcription-service.js').TranscriptionService} deps.service
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
    return this.#state.status === 'running';
  }

  /** @returns {() => void} απεγγραφή */
  subscribe(listener) {
    this.#listeners.add(listener);
    listener(this.#state);
    return () => this.#listeners.delete(listener);
  }

  /**
   * @param {Omit<import('../application/transcription-service.js').TranscriptionJob, 'signal'|'onProgress'|'onPartialSegments'>} job
   * @returns {Promise<import('../domain/transcript.js').Transcript|null>}
   */
  async start(job) {
    if (this.isRunning) throw new Error('τρέχει ήδη μεταγραφή');
    this.#controller = new AbortController();
    this.#set({ ...IDLE, status: 'running', fileName: job.media.name || null });
    await this.#wakeLock.acquire();
    try {
      const transcript = await this.#service.transcribe({
        ...job,
        signal: this.#controller.signal,
        onProgress: progress => this.#set({ ...this.#state, progress }),
        onPartialSegments: segments => this.#set({ ...this.#state, partialSegments: [...this.#state.partialSegments, ...segments] }),
      });
      this.#set({ ...this.#state, status: 'done', transcript });
      return transcript;
    } catch (error) {
      this.#set({ ...this.#state, status: isCancellation(error) ? 'cancelled' : 'failed', error: toAppError(error) });
      return null;
    } finally {
      this.#controller = null;
      await this.#wakeLock.release();
    }
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
