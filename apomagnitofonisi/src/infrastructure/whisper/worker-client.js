/**
 * Αιτήματα προς έναν Web Worker με promises: κάθε αίτημα έχει requestId και
 * περιμένει τη δική του απάντηση, με προαιρετικές ενδιάμεσες ειδοποιήσεις.
 * Ο τερματισμός απορρίπτει όσα αιτήματα εκκρεμούν με CANCELLED.
 *
 * Αν ο worker καταρρεύσει (onerror), κάθε αίτημα που εκκρεμεί απορρίπτεται με
 * τον κωδικό που ταιριάζει στο είδος του (API-002): MODEL_LOAD_FAILED για τη
 * φόρτωση μοντέλων, TRANSCRIPTION_FAILED για τη μεταγραφή.
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';
import { WORKER_REPLIES, WORKER_REQUESTS } from './worker-protocol.js';

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
   * @param {string} type  ένα από τα WORKER_REQUESTS
   * @param {unknown} payload
   * @param {{ transfer?: Transferable[], onEvent?: (event: any) => void }} [options]
   * @returns {Promise<any>} το payload της απάντησης RESULT
   */
  request(type, payload, { transfer = [], onEvent } = {}) {
    if (this.#terminated) return Promise.reject(new AppError(ERROR_CODES.CANCELLED, 'ο worker έχει τερματιστεί'));
    const requestId = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { type, resolve, reject, onEvent });
      this.#worker.postMessage({ requestId, type, payload }, transfer);
    });
  }

  terminate() {
    if (this.#terminated) return;
    this.#terminated = true;
    this.#worker.terminate();
    this.#failAll(() => new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε'));
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
