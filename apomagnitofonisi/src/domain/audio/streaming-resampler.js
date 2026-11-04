/**
 * Αλλαγή συχνότητας δειγματοληψίας σε ροή (π.χ. 44,1 ή 48 kHz → 16 kHz για το
 * Whisper), με παρεμβολή windowed-sinc (παράθυρο Blackman).
 *
 * Το φίλτρο κόβει στο `rolloff` της συχνότητας Nyquist της χαμηλότερης από τις
 * δύο συχνότητες, ώστε να μη μένει aliasing όταν μειώνεται η συχνότητα. Ο
 * πυρήνας υπολογίζεται μία φορά σε πίνακα με υπερδειγματοληψία και γραμμική
 * παρεμβολή, οπότε μία ώρα ήχου επεξεργάζεται σε λίγα δευτερόλεπτα.
 *
 * Η κατάσταση (τα τελευταία δείγματα εισόδου) κρατιέται ανάμεσα στις κλήσεις
 * του `process()`, άρα το αποτέλεσμα είναι ίδιο είτε ο ήχος έρθει σε ένα
 * κομμάτι είτε σε χιλιάδες. Το `flush()` βγάζει την ουρά στο τέλος.
 */
const TABLE_RESOLUTION = 512;

export class StreamingResampler {
  #ratio;
  #halfWidth;
  #table;
  #passthrough;
  #buffer = new Float32Array(0);
  #bufferStart = 0;
  #inputCount = 0;
  #nextOutput = 0;
  #flushed = false;

  /**
   * @param {Object} options
   * @param {number} options.inputRate
   * @param {number} [options.outputRate]
   * @param {number} [options.zeroCrossings]  μισό πλάτος πυρήνα σε μηδενισμούς του sinc
   * @param {number} [options.rolloff]  κλάσμα της συχνότητας Nyquist
   */
  constructor({ inputRate, outputRate = 16000, zeroCrossings = 8, rolloff = 0.92 }) {
    if (!(inputRate > 0) || !(outputRate > 0)) throw new RangeError('οι συχνότητες πρέπει να είναι θετικές');
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.#ratio = inputRate / outputRate;
    this.#passthrough = inputRate === outputRate;
    const downsampling = Math.max(1, this.#ratio);
    const cutoff = (rolloff * 0.5) / downsampling;
    this.#halfWidth = zeroCrossings * downsampling;
    this.#table = buildKernelTable(this.#halfWidth, cutoff);
  }

  /** Δέχεται νέα δείγματα και επιστρέφει όσα δείγματα εξόδου μπορούν να υπολογιστούν. */
  process(input) {
    if (this.#flushed) throw new Error('ο resampler έχει ήδη τελειώσει (flush)');
    if (this.#passthrough) {
      this.#inputCount += input.length;
      return Float32Array.from(input);
    }
    this.#append(input);
    return this.#render(false);
  }

  /** Τα τελευταία δείγματα εξόδου, θεωρώντας σιωπή μετά το τέλος της εισόδου. */
  flush() {
    if (this.#flushed) return new Float32Array(0);
    this.#flushed = true;
    if (this.#passthrough) return new Float32Array(0);
    return this.#render(true);
  }

  #append(input) {
    const merged = new Float32Array(this.#buffer.length + input.length);
    merged.set(this.#buffer, 0);
    merged.set(input, this.#buffer.length);
    this.#buffer = merged;
    this.#inputCount += input.length;
  }

  #render(final) {
    const totalOutputs = Math.ceil(this.#inputCount / this.#ratio);
    const output = [];
    const half = this.#halfWidth;
    const table = this.#table;
    while (this.#nextOutput < totalOutputs) {
      const center = this.#nextOutput * this.#ratio;
      const last = Math.floor(center + half);
      if (!final && last >= this.#inputCount) break;
      const first = Math.ceil(center - half);
      let sum = 0;
      for (let k = first; k <= last; k++) {
        const local = k - this.#bufferStart;
        if (local < 0 || local >= this.#buffer.length) continue;
        const position = Math.abs(center - k) * TABLE_RESOLUTION;
        const index = Math.floor(position);
        if (index + 1 >= table.length) continue;
        const fraction = position - index;
        sum += this.#buffer[local] * (table[index] + (table[index + 1] - table[index]) * fraction);
      }
      output.push(sum);
      this.#nextOutput += 1;
    }
    // Κρατάμε μόνο τα δείγματα που θα χρειαστεί το επόμενο δείγμα εξόδου.
    const keepFrom = Math.max(this.#bufferStart, Math.ceil(this.#nextOutput * this.#ratio - half) - 1);
    if (keepFrom > this.#bufferStart) {
      this.#buffer = this.#buffer.slice(Math.min(this.#buffer.length, keepFrom - this.#bufferStart));
      this.#bufferStart = keepFrom;
    }
    return Float32Array.from(output);
  }
}

/** Πίνακας τιμών του πυρήνα h(d) για d = i / TABLE_RESOLUTION, d ∈ [0, halfWidth]. */
function buildKernelTable(halfWidth, cutoff) {
  const size = Math.ceil(halfWidth * TABLE_RESOLUTION) + 2;
  const table = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const d = i / TABLE_RESOLUTION;
    if (d > halfWidth) { table[i] = 0; continue; }
    const x = 2 * cutoff * d;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = blackman(d / halfWidth);
    table[i] = 2 * cutoff * sinc * w;
  }
  return table;
}

/** Παράθυρο Blackman σε σχετική απόσταση t ∈ [0, 1] από το κέντρο. */
function blackman(t) {
  const phase = Math.PI * (1 + t);
  return 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
}
