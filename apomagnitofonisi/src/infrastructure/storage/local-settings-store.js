/**
 * Οι ρυθμίσεις στο localStorage (JSON). Υλοποιεί τη θύρα SettingsStore.
 * Αν ο browser δεν επιτρέπει αποθήκευση (ιδιωτική περιήγηση), οι ρυθμίσεις
 * απλώς δεν μένουν μετά το κλείσιμο.
 */
import { requireWebStorage } from './web-storage.js';

export const SETTINGS_STORAGE_KEY = 'apomagnitofonisi.settings.v1';

export class LocalSettingsStore {
  #storage;
  #key;

  /**
   * @param {{ storage: Storage|null, key?: string }} deps
   *   null: ο browser δεν επιτρέπει αποθήκη. Οτιδήποτε άλλο εκτός από Web Storage
   *   (π.χ. undefined από λάθος σύνδεση) απορρίπτεται αμέσως (API-026).
   */
  constructor({ storage, key = SETTINGS_STORAGE_KEY }) {
    this.#storage = requireWebStorage(storage, 'storage του LocalSettingsStore');
    this.#key = key;
  }

  load() {
    try {
      const raw = this.#storage && this.#storage.getItem(this.#key);
      const value = raw ? JSON.parse(raw) : null;
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  save(settings) {
    try {
      this.#storage && this.#storage.setItem(this.#key, JSON.stringify(settings));
    } catch {
      // Χωρίς δικαίωμα αποθήκευσης οι ρυθμίσεις ισχύουν μόνο για τη συνεδρία.
    }
  }

  clear() {
    try {
      this.#storage && this.#storage.removeItem(this.#key);
    } catch {
      // όπως στο save()
    }
  }
}
