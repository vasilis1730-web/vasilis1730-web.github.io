/**
 * Ο worker των μοντέλων από την πλευρά της σελίδας, με μία μέθοδο ανά αίτημα
 * του πρωτοκόλλου (API-019): loadModels και transcribeWindow, με τους τύπους
 * τους και τη λίστα μεταφοράς φτιαγμένη εδώ. Κάθε αίτημα έχει requestId και
 * περιμένει τη δική του απάντηση. Ο τερματισμός απορρίπτει όσα αιτήματα
 * εκκρεμούν με CANCELLED.
 *
 * Αν ο worker καταρρεύσει (onerror), κάθε αίτημα που εκκρεμεί απορρίπτεται με
 * τον κωδικό που ταιριάζει στο είδος του (API-002): MODEL_LOAD_FAILED για τη
 * φόρτωση μοντέλων, TRANSCRIPTION_FAILED για τη μεταγραφή.
 *
 * @typedef {import('./worker-protocol.js').LoadModelsPayload} LoadModelsPayload
 * @typedef {import('./worker-protocol.js').LoadModelsResult} LoadModelsResult
 * @typedef {import('./worker-protocol.js').TranscribeWindowPayload} TranscribeWindowPayload
 * @typedef {import('./worker-protocol.js').TranscribeWindowResult} TranscribeWindowResult
 * @typedef {import('./worker-protocol.js').ModelProgressEvent} ModelProgressEvent
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';
import { WORKER_REPLIES, WORKER_REQUESTS, WORKER_EVENTS } from './worker-protocol.js';

export class WorkerClient {
  #worker;
  #pending = new Map();
  #nextId = 1;
  #terminated = false;

  /** @param {Worker} worker */
  constructor(worker) {
    this.#worker = worker;
    worker.onmessage = event => this.#receive(event.data);
    worker.onerror = event => {
      event.preventDefault?.();
      this.#failAll(type => new AppError(crashCodeFor(type), event.message || 'ο worker σταμάτησε'));
    };
  }

  /**
   * Φόρτωση των μοντέλων (πρώτο αίτημα).
   * @param {LoadModelsPayload} payload
   * @param {{ onModelProgress?: (event: ModelProgressEvent) => void }} [options]
   * @returns {Promise<LoadModelsResult>}
   */
  loadModels(payload, { onModelProgress } = {}) {
    return this.#request(WORKER_REQUESTS.LOAD_MODELS, payload, {
      onEvent: event => { if (event && event.event === WORKER_EVENTS.MODEL_PROGRESS) onModelProgress?.(event); },
    });
  }

  /**
   * Μεταγραφή ενός παραθύρου. Τα δείγματα ΜΕΤΑΦΕΡΟΝΤΑΙ στον worker: μετά την
   * κλήση το `payload.samples` δεν χρησιμοποιείται πια στη σελίδα.
   * @param {TranscribeWindowPayload} payload
   * @returns {Promise<TranscribeWindowResult>}
   */
  transcribeWindow(payload) {
    return this.#request(WORKER_REQUESTS.TRANSCRIBE_WINDOW, payload, { transfer: [payload.samples.buffer] });
  }

  terminate() {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#worker.terminate();
    this.#failAll(() => new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε'));
  }

  #request(type, payload, { transfer = [], onEvent } = {}) {
    if (this.#terminated) return Promise.reject(new AppError(ERROR_CODES.CANCELLED, 'ο worker έχει τερματιστεί'));
    const requestId = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { type, resolve, reject, onEvent });
      this.#worker.postMessage({ requestId, type, payload }, transfer);
    });
  }

  #receive(message) {
    const entry = message && this.#pending.get(message.requestId);
    if (!entry) return;
    if (message.type === WORKER_REPLIES.EVENT) { entry.onEvent?.(message.payload); return; }
    this.#pending.delete(message.requestId);
    if (message.type === WORKER_REPLIES.RESULT) entry.resolve(message.payload);
    else entry.reject(new AppError(message.payload && message.payload.code, message.payload && message.payload.message));
  }

  #failAll(errorFor) {
    for (const entry of this.#pending.values()) entry.reject(errorFor(entry.type));
    this.#pending.clear();
  }
}

function crashCodeFor(type) {
  return type === WORKER_REQUESTS.LOAD_MODELS ? ERROR_CODES.MODEL_LOAD_FAILED : ERROR_CODES.TRANSCRIPTION_FAILED;
}
