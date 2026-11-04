/**
 * Αποστολή αρχείου με POST μέσω XMLHttpRequest, που (σε αντίθεση με το
 * fetch) δίνει πρόοδο αποστολής: σημαντικό για αρχεία εκατοντάδων MB από
 * κινητό. Η απάντηση επιστρέφεται ως κείμενο, για όλα τα HTTP status.
 *
 * @typedef {Object} UploadResponse
 * @property {number} status
 * @property {string} bodyText
 *
 * @typedef {Object} UploadRequest
 * @property {Record<string, string>} headers
 * @property {FormData|Blob} body
 * @property {AbortSignal} [signal]
 * @property {(loadedBytes: number, totalBytes: number) => void} [onUploadProgress]
 * @property {() => void} [onUploadComplete]  η αποστολή τελείωσε, ο server επεξεργάζεται
 */
import { AppError, ERROR_CODES } from '../../application/errors.js';

export class XhrUploader {
  #createXhr;

  /** @param {{ createXhr: () => XMLHttpRequest }} deps */
  constructor({ createXhr }) {
    this.#createXhr = createXhr;
  }

  /**
   * @param {string} url
   * @param {UploadRequest} request
   * @returns {Promise<UploadResponse>}
   */
  post(url, { headers, body, signal, onUploadProgress, onUploadComplete }) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) { reject(new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε')); return; }
      const xhr = this.#createXhr();
      const onAbort = () => xhr.abort();
      xhr.open('POST', url, true);
      for (const [name, value] of Object.entries(headers || {})) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = event => { if (event.lengthComputable) onUploadProgress?.(event.loaded, event.total); };
      xhr.upload.onload = () => onUploadComplete?.();
      xhr.onload = () => { cleanup(); resolve({ status: xhr.status, bodyText: String(xhr.responseText ?? '') }); };
      xhr.onerror = () => { cleanup(); reject(new AppError(ERROR_CODES.NETWORK, `αποτυχία δικτύου προς ${url}`)); };
      xhr.ontimeout = xhr.onerror;
      xhr.onabort = () => { cleanup(); reject(new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε')); };
      const cleanup = () => signal && signal.removeEventListener('abort', onAbort);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      xhr.send(body);
    });
  }
}
