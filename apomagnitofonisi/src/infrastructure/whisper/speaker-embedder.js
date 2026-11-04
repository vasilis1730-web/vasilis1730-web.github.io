/**
 * Αποτύπωμα φωνής (speaker embedding) μέσα στον worker, με το WeSpeaker
 * ResNet34 (Transformers.js, ~27 MB). Δίνει ένα διάνυσμα ανά τμήμα ομιλίας.
 * Ίδια φωνή → κοντινά διανύσματα, και η ομαδοποίηση γίνεται στο domain.
 */

import { PCM_SAMPLE_RATE } from '../../domain/audio/pcm.js';

/** Τμήματα μικρότερα από αυτό δεν δίνουν αξιόπιστο αποτύπωμα (s). */
export const MIN_EMBEDDING_SEC = 1;
/** Από μεγάλα τμήματα παίρνουμε τα μεσαία τόσα δευτερόλεπτα (ταχύτητα, ίδια ακρίβεια). */
const MAX_EMBEDDING_SEC = 10;

export class SpeakerEmbedder {
  #processor;
  #model;

  constructor(processor, model) {
    this.#processor = processor;
    this.#model = model;
  }

  /**
   * @param {any} transformers
   * @param {{ repo: string, dtype: string }} model
   * @param {(event: any) => void} progressCallback
   */
  static async load(transformers, model, progressCallback) {
    const processor = await transformers.AutoProcessor.from_pretrained(model.repo, { progress_callback: progressCallback });
    const network = await transformers.AutoModel.from_pretrained(model.repo, { dtype: model.dtype, device: 'wasm', progress_callback: progressCallback });
    return new SpeakerEmbedder(processor, network);
  }

  /**
   * @param {Float32Array} samples  PCM με PCM_SAMPLE_RATE ενός τμήματος
   * @returns {Promise<Float32Array|null>} null για πολύ μικρό τμήμα
   */
  async embed(samples) {
    if (samples.length < MIN_EMBEDDING_SEC * PCM_SAMPLE_RATE) return null;
    const maxLength = MAX_EMBEDDING_SEC * PCM_SAMPLE_RATE;
    const middle = samples.length > maxLength
      ? samples.subarray(Math.floor((samples.length - maxLength) / 2), Math.floor((samples.length + maxLength) / 2))
      : samples;
    const inputs = await this.#processor(middle);
    const output = await this.#model(inputs);
    const tensor = output.embeddings || output.pooler_output || output.last_hidden_state || Object.values(output)[0];
    return Float32Array.from(tensor.data);
  }
}
