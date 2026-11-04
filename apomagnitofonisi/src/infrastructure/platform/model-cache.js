/**
 * Τα μοντέλα που κατέβηκαν στη συσκευή (το Transformers.js τα κρατά στην
 * Cache Storage «transformers-cache», το ONNX Runtime τα .wasm του στην ίδια).
 * Μέγεθος και διαγραφή, για τις Ρυθμίσεις. Υλοποιεί τη θύρα ModelCache.
 */
export const MODEL_CACHE_NAMES = Object.freeze(['transformers-cache']);

export class BrowserModelCache {
  #caches;

  /** @param {{ caches: CacheStorage|undefined }} deps */
  constructor({ caches }) {
    this.#caches = caches;
  }

  /** Το άθροισμα των Content-Length των αποθηκευμένων αρχείων (byte), ή null χωρίς Cache Storage. */
  async estimateSizeBytes() {
    if (!this.#caches) return null;
    let total = 0;
    for (const name of MODEL_CACHE_NAMES) {
      if (!(await this.#caches.has(name))) continue;
      const cache = await this.#caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const length = Number(response && response.headers.get('Content-Length'));
        if (Number.isFinite(length)) total += length;
      }
    }
    return total;
  }

  async clear() {
    if (!this.#caches) return;
    for (const name of MODEL_CACHE_NAMES) await this.#caches.delete(name);
  }
}
