/**
 * Τα μοντέλα που κατέβηκαν στη συσκευή, στην Cache Storage του browser.
 * Μέγεθος και διαγραφή, για τις Ρυθμίσεις. Υλοποιεί τη θύρα ModelCache.
 *
 * Τα ονόματα των caches τα δίνει το main.js από τον πάροχο που τα γράφει
 * (WHISPER_MODEL_CACHE_NAME στο infrastructure/whisper/), ώστε το όνομα να έχει
 * έναν μόνο ιδιοκτήτη (CA-015): αν αλλάξει εκεί, αλλάζει και ό,τι μετράμε και σβήνουμε.
 */
export class BrowserModelCache {
  #caches;
  #cacheNames;

  /** @param {{ caches: CacheStorage|undefined, cacheNames: readonly string[] }} deps */
  constructor({ caches, cacheNames }) {
    if (!Array.isArray(cacheNames) || cacheNames.length === 0 || !cacheNames.every(n => typeof n === 'string' && n)) {
      throw new TypeError('BrowserModelCache: χρειάζεται τουλάχιστον ένα όνομα cache (cacheNames)');
    }
    this.#caches = caches;
    this.#cacheNames = Object.freeze([...cacheNames]);
  }

  /** Το άθροισμα των Content-Length των αποθηκευμένων αρχείων (byte), ή null χωρίς Cache Storage. */
  async estimateSizeBytes() {
    if (!this.#caches) return null;
    let total = 0;
    for (const name of this.#cacheNames) {
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
    for (const name of this.#cacheNames) await this.#caches.delete(name);
  }
}
