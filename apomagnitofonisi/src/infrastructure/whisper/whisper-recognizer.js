/**
 * Το Whisper μέσα στον worker: φόρτωση του pipeline του Transformers.js και
 * μεταγραφή ενός παραθύρου (έως 30 s) με χρόνους ανά φράση.
 */
import { PCM_SAMPLE_RATE } from '../../domain/audio/pcm.js';

/**
 * Ρύθμιση του Transformers.js: μοντέλα μόνο από το Hugging Face, αποθήκευση
 * στην Cache Storage του browser, νήματα WASM όταν η σελίδα είναι απομονωμένη.
 */
export function configureTransformers(transformers, { wasmThreads }) {
  const { env } = transformers;
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  if (env.backends && env.backends.onnx && env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = wasmThreads;
}

/**
 * Πρόοδος λήψης από τα progress_callback του Transformers.js (ένα ανά αρχείο),
 * σε ένα σύνολο byte για όλα τα αρχεία.
 */
export function createDownloadProgress(onTotal) {
  const files = new Map();
  return event => {
    if (!event || event.status !== 'progress' || !event.file) return;
    files.set(event.file, { loaded: Number(event.loaded) || 0, total: Number(event.total) || 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    if (total > 0) onTotal(loaded, total);
  };
}

export class WhisperRecognizer {
  #pipe;

  constructor(pipe) {
    this.#pipe = pipe;
  }

  /**
   * @param {any} transformers  το module του Transformers.js
   * @param {{ repo: string, device: string, dtype: Record<string, string> }} model
   * @param {(event: any) => void} progressCallback
   */
  static async load(transformers, model, progressCallback) {
    const pipe = await transformers.pipeline('automatic-speech-recognition', model.repo, {
      device: model.device,
      dtype: model.dtype,
      progress_callback: progressCallback,
    });
    return new WhisperRecognizer(pipe);
  }

  /**
   * @param {Float32Array} samples  PCM με PCM_SAMPLE_RATE
   * @param {{ startSec: number, whisperLanguage: string|null }} options  null: αυτόματη ανίχνευση γλώσσας
   * @returns {Promise<{ start: number, end: number, text: string }[]>} χρόνοι του αρχείου
   */
  async transcribe(samples, { startSec, whisperLanguage }) {
    const windowSec = samples.length / PCM_SAMPLE_RATE;
    const output = await this.#pipe(samples, {
      task: 'transcribe',
      return_timestamps: true,
      ...(whisperLanguage ? { language: whisperLanguage } : {}),
    });
    const chunks = Array.isArray(output.chunks) && output.chunks.length ? output.chunks : [{ timestamp: [0, windowSec], text: output.text }];
    return chunks
      .map(chunk => {
        const [from, to] = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, windowSec];
        const start = Math.min(windowSec, Math.max(0, Number.isFinite(from) ? from : 0));
        const end = Math.min(windowSec, Math.max(start, Number.isFinite(to) ? to : windowSec));
        return { start: startSec + start, end: startSec + end, text: String(chunk.text ?? '').trim() };
      })
      .filter(segment => segment.text);
  }
}
