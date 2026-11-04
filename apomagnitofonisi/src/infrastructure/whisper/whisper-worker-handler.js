/**
 * Η λογική του worker των μοντέλων, χωρίς το `self` (CA-006): σειρά
 * αιτημάτων, διανομή ανά είδος, κομμάτια ήχου για τα αποτυπώματα φωνής,
 * κωδικοί σφαλμάτων και λίστες μεταφοράς. Το whisper-worker.js απλώς τη συνδέει
 * με το `self` και με τα πραγματικά μοντέλα, ενώ τα tests με ψεύτικα.
 *
 * @typedef {import('./worker-protocol.js').LoadModelsPayload} LoadModelsPayload
 * @typedef {import('./worker-protocol.js').TranscribeWindowPayload} TranscribeWindowPayload
 *
 * @typedef {Object} LoadedModels
 * @property {{ transcribe: (samples: Float32Array, options: { startSec: number, whisperLanguage: string|null }) => Promise<{ start: number, end: number, text: string }[]> }} recognizer
 * @property {{ embed: (samples: Float32Array) => Promise<Float32Array|null> }|null} embedder
 * @property {'webgpu'|'wasm'} device
 *
 * @typedef {Object} WorkerHandlerDeps
 * @property {(payload: LoadModelsPayload, onProgress: (loadedBytes: number, totalBytes: number) => void) => Promise<LoadedModels>} loadModels
 * @property {(message: import('./worker-protocol.js').WorkerReply, transfer?: Transferable[]) => void} post
 */
import { ERROR_CODES } from '../../application/errors.js';
import { PCM_SAMPLE_RATE } from '../../domain/audio/pcm.js';
import { WORKER_REQUESTS, WORKER_REPLIES, WORKER_EVENTS } from './worker-protocol.js';

/**
 * @param {WorkerHandlerDeps} deps
 * @returns {{ onMessage: (message: import('./worker-protocol.js').WorkerRequest) => Promise<void> }}
 */
export function createWhisperWorkerHandler({ loadModels, post }) {
  let models = null;
  let queue = Promise.resolve();

  const reply = (requestId, type, payload, transfer = []) => post({ requestId, type, payload }, transfer);

  async function handleLoad(requestId, payload) {
    try {
      models = await loadModels(payload, (loadedBytes, totalBytes) => reply(requestId, WORKER_REPLIES.EVENT, { event: WORKER_EVENTS.MODEL_PROGRESS, loadedBytes, totalBytes }));
      reply(requestId, WORKER_REPLIES.RESULT, { device: models.device });
    } catch (error) {
      reply(requestId, WORKER_REPLIES.ERROR, workerError(ERROR_CODES.MODEL_LOAD_FAILED, error));
    }
  }

  async function handleWindow(requestId, payload) {
    if (!models) {
      reply(requestId, WORKER_REPLIES.ERROR, { code: ERROR_CODES.MODEL_LOAD_FAILED, message: 'δεν έχει φορτωθεί μοντέλο' });
      return;
    }
    try {
      const result = await transcribeWindow(models, payload);
      const transfer = result.segments.map(s => s.embedding && s.embedding.buffer).filter(Boolean);
      reply(requestId, WORKER_REPLIES.RESULT, result, transfer);
    } catch (error) {
      reply(requestId, WORKER_REPLIES.ERROR, workerError(ERROR_CODES.TRANSCRIPTION_FAILED, error));
    }
  }

  async function handle({ requestId, type, payload } = {}) {
    if (type === WORKER_REQUESTS.LOAD_MODELS) return handleLoad(requestId, payload);
    if (type === WORKER_REQUESTS.TRANSCRIBE_WINDOW) return handleWindow(requestId, payload);
    return reply(requestId, WORKER_REPLIES.ERROR, { code: ERROR_CODES.UNKNOWN, message: `άγνωστο αίτημα ${type}` });
  }

  return {
    /** Τα αιτήματα εκτελούνται ένα-ένα: το μοντέλο δεν τρέχει ποτέ δύο φορές παράλληλα. */
    onMessage(message) {
      queue = queue.then(() => handle(message || {}));
      return queue;
    },
  };
}

/**
 * Μεταγραφή ενός παραθύρου και, όταν ζητείται, αποτύπωμα φωνής για κάθε
 * τμήμα από τα δικά του δείγματα μέσα στο παράθυρο.
 * @param {LoadedModels} models
 * @param {TranscribeWindowPayload} payload
 */
export async function transcribeWindow(models, { startSec, samples, whisperLanguage, embedSpeakers }) {
  const segments = await models.recognizer.transcribe(samples, { startSec, whisperLanguage });
  const result = [];
  for (const segment of segments) {
    let embedding = null;
    if (embedSpeakers && models.embedder) embedding = await models.embedder.embed(segmentSamples(samples, startSec, segment));
    result.push({ ...segment, embedding });
  }
  return { segments: result };
}

/** Τα δείγματα ενός τμήματος (χρόνοι του αρχείου) μέσα στο παράθυρο που ξεκινά στο startSec. */
export function segmentSamples(samples, startSec, { start, end }) {
  const from = Math.max(0, Math.round((start - startSec) * PCM_SAMPLE_RATE));
  const to = Math.min(samples.length, Math.round((end - startSec) * PCM_SAMPLE_RATE));
  return samples.subarray(from, Math.max(from, to));
}

/** Σφάλμα για τη σελίδα: ο κωδικός του αν είναι γνωστός, αλλιώς ο κωδικός της φάσης. */
function workerError(fallbackCode, error) {
  const known = error && typeof error.code === 'string' && Object.values(ERROR_CODES).includes(error.code);
  return { code: known ? error.code : fallbackCode, message: error && error.message ? error.message : String(error) };
}
