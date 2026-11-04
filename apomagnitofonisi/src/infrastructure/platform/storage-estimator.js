/**
 * Ο χώρος που χρησιμοποιεί η εφαρμογή στη συσκευή (μεταγραφές, μοντέλα) και
 * αίτημα να μη σβήνει ο browser τα δεδομένα όταν γεμίσει ο δίσκος.
 * Υλοποιεί τη θύρα StorageEstimator.
 */
export class BrowserStorageEstimator {
  #manager;

  /** @param {{ storageManager: StorageManager|undefined }} deps */
  constructor({ storageManager }) {
    this.#manager = storageManager;
  }

  async estimate() {
    if (!this.#manager || !this.#manager.estimate) return { usageBytes: null, quotaBytes: null };
    try {
      const { usage, quota } = await this.#manager.estimate();
      return { usageBytes: usage ?? null, quotaBytes: quota ?? null };
    } catch {
      return { usageBytes: null, quotaBytes: null };
    }
  }

  async requestPersistence() {
    if (!this.#manager || !this.#manager.persist) return false;
    try {
      if (this.#manager.persisted && await this.#manager.persisted()) return true;
      return await this.#manager.persist();
    } catch {
      return false;
    }
  }
}
