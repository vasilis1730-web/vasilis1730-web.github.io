/**
 * Οι ρυθμίσεις του χρήστη, με προεπιλογές και έλεγχο κάθε τιμής. Ό,τι δεν
 * είναι έγκυρο (π.χ. από παλιά έκδοση) αγνοείται και μένει η προεπιλογή.
 * Το αν τα κλειδιά μένουν στη συσκευή το κρατά μόνο το KeyStore (μία πηγή).
 */
import { ENGINE_KINDS } from '../domain/transcript.js';
import { isSupportedLanguageCode, DEFAULT_LANGUAGE_CODE } from '../config/languages.js';
import { AUTO_LOCAL_QUALITY, isLocalQualityChoice, DEFAULT_CLAUDE_MODEL_ID, findClaudeModel } from '../config/models.js';
import { MAX_EXPECTED_SPEAKERS } from './limits.js';

/**
 * @typedef {Object} Settings
 * @property {import('./ports.js').EngineKind} engineKind
 * @property {string} languageCode
 * @property {Record<import('./ports.js').EngineKind, boolean>} diarizeByEngine  διαχωρισμός ομιλητών ανά μηχανή
 * @property {number|null} expectedSpeakers
 * @property {import('./ports.js').LocalQualityChoice} localQualityPreset
 * @property {string} claudeModelId
 * @property {boolean} removeAnoTeleia
 * @property {boolean} onboardingDismissed
 */

const ENGINE_KIND_VALUES = Object.values(ENGINE_KINDS);

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  engineKind: ENGINE_KINDS.LOCAL,
  languageCode: DEFAULT_LANGUAGE_CODE,
  // Στη συσκευή ο διαχωρισμός είναι πειραματικός (και κατεβάζει μοντέλο), στο cloud ακριβής.
  diarizeByEngine: Object.freeze({ [ENGINE_KINDS.LOCAL]: false, [ENGINE_KINDS.ELEVENLABS]: true }),
  expectedSpeakers: null,
  localQualityPreset: AUTO_LOCAL_QUALITY,
  claudeModelId: DEFAULT_CLAUDE_MODEL_ID,
  removeAnoTeleia: true,
  onboardingDismissed: false,
});

const isBoolean = v => typeof v === 'boolean';

const VALIDATORS = Object.freeze({
  engineKind: v => ENGINE_KIND_VALUES.includes(v),
  languageCode: v => isSupportedLanguageCode(v),
  // Μία σημαία ανά μηχανή του ENGINE_KINDS (OO-006): νέα μηχανή δεν θέλει αλλαγή εδώ.
  diarizeByEngine: v => v != null && typeof v === 'object' && ENGINE_KIND_VALUES.every(kind => isBoolean(v[kind])),
  expectedSpeakers: v => v === null || (Number.isInteger(v) && v >= 1 && v <= MAX_EXPECTED_SPEAKERS),
  localQualityPreset: v => isLocalQualityChoice(v),
  claudeModelId: v => findClaudeModel(v) != null,
  removeAnoTeleia: isBoolean,
  onboardingDismissed: isBoolean,
});

export class SettingsService {
  #store;
  #settings;

  /** @param {{ store: import('./ports.js').SettingsStore }} deps */
  constructor({ store }) {
    this.#store = store;
    this.#settings = sanitize(store.load() || {}, DEFAULT_SETTINGS);
  }

  /** @returns {Readonly<Settings>} */
  get current() {
    return this.#settings;
  }

  /**
   * Αλλάζει όσες ρυθμίσεις δίνονται. Άκυρη τιμή → RangeError και καμία αλλαγή
   * (η διεπαφή δίνει μόνο έγκυρες τιμές, άρα είναι λάθος προγραμματισμού).
   * @param {Partial<Settings>} patch
   * @returns {Readonly<Settings>}
   */
  update(patch) {
    for (const [key, value] of Object.entries(patch)) {
      const valid = VALIDATORS[key];
      if (!valid) throw new RangeError(`άγνωστη ρύθμιση ${key}`);
      if (!valid(value)) throw new RangeError(`μη έγκυρη τιμή για ${key}`);
    }
    this.#settings = freeze({ ...this.#settings, ...patch });
    this.#store.save({ ...this.#settings });
    return this.#settings;
  }

  /** Διαγραφή των αποθηκευμένων ρυθμίσεων και επιστροφή στις προεπιλογές. */
  clear() {
    this.#store.clear();
    this.#settings = freeze({ ...DEFAULT_SETTINGS });
    return this.#settings;
  }
}

function sanitize(stored, defaults) {
  const result = { ...defaults };
  for (const [key, valid] of Object.entries(VALIDATORS)) {
    if (key in stored && valid(stored[key])) result[key] = stored[key];
  }
  return freeze(result);
}

function freeze(settings) {
  return Object.freeze({ ...settings, diarizeByEngine: Object.freeze({ ...settings.diarizeByEngine }) });
}
