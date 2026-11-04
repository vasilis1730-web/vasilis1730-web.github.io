/**
 * Μαζεύει PCM 16 kHz σε παράθυρα για το Whisper (που δέχεται έως 30 s).
 *
 * Κάθε παράθυρο έχει έως `maxWindowSec` και κόβεται στο πιο ήσυχο πλαίσιο
 * `frameSec` ανάμεσα σε `minWindowSec` και `maxWindowSec`, ώστε το κόψιμο να
 * πέφτει σε παύση και όχι στη μέση λέξης. Παράθυρα με πολύ χαμηλή στάθμη
 * σημειώνονται `isSilent`, για να μη στέλνονται στο μοντέλο (σε σιωπή το
 * Whisper «ακούει» φράσεις που δεν ειπώθηκαν). Η μνήμη μένει σταθερή: κρατιέται
 * μόνο το μέρος που δεν έχει γίνει ακόμη παράθυρο.
 *
 * @typedef {Object} AudioWindow
 * @property {number} startSec  χρόνος έναρξης στο αρχείο
 * @property {Float32Array} samples
 * @property {boolean} isSilent
 */
import { rms } from './pcm.js';

export const DEFAULT_WINDOW_RULES = Object.freeze({
  sampleRate: 16000,
  maxWindowSec: 28,
  minWindowSec: 18,
  frameSec: 0.1,
  /** Περίπου -50 dBFS: κάτω από αυτό το παράθυρο θεωρείται σιωπή. */
  silenceRms: 0.003,
  /** Μικρότερο υπόλοιπο στο τέλος δεν αξίζει παράθυρο (μένει μόνο αν δεν είναι σιωπή). */
  minTailSec: 0.3,
});

export class ChunkAssembler {
  #rules;
  #buffer;
  #length = 0;
  #emittedSamples = 0;

  /** @param {Partial<typeof DEFAULT_WINDOW_RULES>} [rules] */
  constructor(rules = {}) {
    this.#rules = { ...DEFAULT_WINDOW_RULES, ...rules };
    if (!(this.#rules.minWindowSec > 0 && this.#rules.maxWindowSec > this.#rules.minWindowSec)) {
      throw new RangeError('μη έγκυρα όρια παραθύρου');
    }
    this.#buffer = new Float32Array(Math.ceil(this.#rules.maxWindowSec * this.#rules.sampleRate * 1.5));
  }

  /** Δείγματα που έχουν δοθεί και δεν έχουν γίνει ακόμη παράθυρο. */
  get pendingSamples() {
    return this.#length;
  }

  /**
   * @param {Float32Array} samples
   * @returns {AudioWindow[]} τα παράθυρα που ολοκληρώθηκαν
   */
  push(samples) {
    this.#append(samples);
    const windows = [];
    const maxSamples = Math.round(this.#rules.maxWindowSec * this.#rules.sampleRate);
    while (this.#length >= maxSamples) windows.push(this.#cut(this.#quietestCut()));
    return windows;
  }

  /** Το υπόλοιπο στο τέλος της ροής. */
  flush() {
    const windows = [];
    const maxSamples = Math.round(this.#rules.maxWindowSec * this.#rules.sampleRate);
    while (this.#length > maxSamples) windows.push(this.#cut(this.#quietestCut()));
    if (this.#length > 0) {
      const tail = this.#cut(this.#length);
      const tooShort = tail.samples.length < this.#rules.minTailSec * this.#rules.sampleRate;
      if (!(tooShort && tail.isSilent)) windows.push(tail);
    }
    return windows;
  }

  #append(samples) {
    const needed = this.#length + samples.length;
    if (needed > this.#buffer.length) {
      const grown = new Float32Array(Math.max(needed, this.#buffer.length * 2));
      grown.set(this.#buffer.subarray(0, this.#length));
      this.#buffer = grown;
    }
    this.#buffer.set(samples, this.#length);
    this.#length = needed;
  }

  #quietestCut() {
    const { sampleRate, minWindowSec, maxWindowSec, frameSec } = this.#rules;
    return findQuietestCut(this.#buffer.subarray(0, this.#length), { sampleRate, fromSec: minWindowSec, toSec: maxWindowSec, frameSec });
  }

  #cut(count) {
    const samples = this.#buffer.slice(0, count);
    this.#buffer.copyWithin(0, count, this.#length);
    this.#length -= count;
    const window = {
      startSec: this.#emittedSamples / this.#rules.sampleRate,
      samples,
      isSilent: rms(samples) < this.#rules.silenceRms,
    };
    this.#emittedSamples += count;
    return window;
  }
}

/**
 * Η θέση (σε δείγματα) στο κέντρο του πιο ήσυχου πλαισίου, ανάμεσα σε
 * `fromSec` και `toSec`. Σε ισοπαλία κερδίζει το πιο αργό πλαίσιο (μεγαλύτερα
 * παράθυρα, λιγότερες κλήσεις του μοντέλου).
 */
export function findQuietestCut(samples, { sampleRate, fromSec, toSec, frameSec }) {
  const frame = Math.max(1, Math.round(frameSec * sampleRate));
  const from = Math.max(0, Math.round(fromSec * sampleRate));
  const to = Math.min(samples.length, Math.round(toSec * sampleRate));
  if (to - from < frame) return Math.min(samples.length, Math.max(1, to));
  let best = to;
  let bestEnergy = Infinity;
  for (let start = from; start + frame <= to; start += frame) {
    const energy = rms(samples, start, start + frame);
    if (energy <= bestEnergy) {
      bestEnergy = energy;
      best = start + Math.floor(frame / 2);
    }
  }
  return best;
}
