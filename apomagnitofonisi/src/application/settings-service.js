/**
 * Οι ρυθμίσεις του χρήστη, με προεπιλογές και έλεγχο κάθε τιμής. Ό,τι δεν
 * είναι έγκυρο (π.χ. από παλιά έκδοση) αγνοείται και μένει η προεπιλογή.
 * Το αν τα κλειδιά μένουν στη συσκευή το κρατά μόνο το KeyStore (μία πηγή).
 */
import { ENGINE_KINDS } from '../domain/transcript.js';
import { isSupportedLanguageCode, DEFAULT_LANGUAGE_CODE } from '../config/languages.js';
import { LOCAL_QUALITY_PRESET_IDS, DEFAULT_CLAUDE_MODEL_ID, findClaudeModel } from '../config/models.js';
import { MAX_EXPECTED_SPEAKERS } from './limits.js';

/**
 * @typedef {Object} Settings
 * @property {'local'|'elevenlabs'} engineKind
 * @property {string} languageCode
 * @property {{ local: boolean, elevenlabs: boolean }} diarizeByEngine
 * @property {number|null} expectedSpeakers
 * @property {string} localQuality  'auto' | 'fast' | 'balanced' | 'accurate'
 * @property {string} claudeModelId
 * @property {boolean} removeAnoTeleia
 * @property {boolean} onboardingDismissed
 */

/** @type {Readonly<Settings>} */
export const DEFAULT_SETTINGS = Object.freeze({
  engineKind: ENGINE_KINDS.LOCAL,
  languageCode: DEFAULT_LANGUAGE_CODE,
  diarizeByEngine: Object.freeze({ local: false, elevenlabs: true }),
  expectedSpeakers: null,
  localQuality: LOCAL_QUALITY_PRESET_IDS.AUTO,
  claudeModelId: DEFAULT_CLAUDE_MODEL_ID,
  removeAnoTeleia: true,
  onboardingDismissed: false,
});

const isBoolean = v => typeof v === 'boolean';

const VALIDATORS = Object.freeze({
  engineKind: v => Object.values(ENGINE_KINDS).includes(v),
  languageCode: v => isSupportedLanguageCode(v),
  diarizeByEngine: v => v != null && typeof v === 'object' && isBoolean(v.local) && isBoolean(v.elevenlabs),
  expectedSpeakers: v => v === null || (Number.isInteger(v) && v >= 1 && v <= MAX_EXPECTED_SPEAKERS),
  localQuality: v => Object.values(LOCAL_QUALITY_PRESET_IDS).includes(v),
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
   * Αλλάζει όσες ρυθμίσεις δίνονται. Άκυρη τιμή → RangeError και καμία αλλαγή.
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

  /** Επιστροφή στις προεπιλογές (π.χ. στη «Διαγραφή όλων των δεδομένων»). */
  reset() {
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
