/**
 * Η λογική του worker των μοντέλων, χωρίς το `self` (CA-006): σειρά
 * αιτημάτων, διανομή ανά είδος, κομμάτια ήχου για τα αποτυπώματα φωνής,
 * κωδικοί σφαλμάτων και λίστες μεταφοράς. Το whisper-worker.js απλώς τη συνδέει
 * με το `self` και με τα πραγματικά μοντέλα, ενώ τα tests με ψεύτικα.
 *
 * Η πρόοδος λήψης έρχεται από το Transformers.js μία φορά ανά κομμάτι αρχείου
 * (εκατοντάδες ανά δευτερόλεπτο). Ο worker τη στέλνει το πολύ μία φορά ανά
 * `progressIntervalMs` (και πάντα στο τέλος κάθε αρχείου), ώστε η σελίδα να
 * μην ξαναζωγραφίζει χωρίς λόγο (OO-001).
 *
 * @typedef {import('./worker-protocol.js').LoadModelsPayload} LoadModelsPayload
 * @typedef {import('./worker-protocol.js').TranscribeWindowPayload} TranscribeWindowPayload
 * @typedef {import('./worker-protocol.js').InferenceDevice} InferenceDevice
 *
 * @typedef {Object} LoadedModels
 * @property {{ transcribe: (samples: Float32Array, options: { startSec: number, whisperLanguage: string|null }) => Promise<{ start: number, end: number, text: string }[]> }} recognizer
 * @property {{ embed: (samples: Float32Array) => Promise<Float32Array|null> }|null} embedder
 * @property {InferenceDevice} device
 *
 * @typedef {Object} WorkerHandlerDeps
 * @property {(payload: LoadModelsPayload, onProgress: (loadedBytes: number, totalBytes: number) => void) => Promise<LoadedModels>} loadModels
 * @property {(message: import('./worker-protocol.js').WorkerReply, transfer?: Transferable[]) => void} post
 * @property {() => number} [now]  χιλιοστά του δευτερολέπτου (για τον ρυθμό της προόδου)
 * @property {number} [progressIntervalMs]
 */
import { ERROR_CODES } from '../../application/errors.js';
import { PCM_SAMPLE_RATE } from '../../domain/audio/pcm.js';
import { WORKER_REQUESTS, WORKER_REPLIES, WORKER_EVENTS } from './worker-protocol.js';

/** Το πολύ 10 ειδοποιήσεις προόδου ανά δευτερόλεπτο. */
export const MODEL_PROGRESS_INTERVAL_MS = 100;

/**
 * @param {WorkerHandlerDeps} deps
 * @returns {{ onMessage: (message: import('./worker-protocol.js').WorkerRequest) => Promise<void> }}
 */
export function createWhisperWorkerHandler({ loadModels, post, now = () => Date.now(), progressIntervalMs = MODEL_PROGRESS_INTERVAL_MS }) {
  let models = null;
  let queue = Promise.resolve();

  const reply = (requestId, type, payload, transfer = []) => post({ requestId, type, payload }, transfer);

  async function handleLoad(requestId, payload) {
    const sendProgress = throttleProgress((loadedBytes, totalBytes) => reply(requestId, WORKER_REPLIES.EVENT, { event: WORKER_EVENTS.MODEL_PROGRESS, loadedBytes, totalBytes }), { now, intervalMs: progressIntervalMs });
    try {
      models = await loadModels(payload, sendProgress);
      reply(requestId, WORKER_REPLIES.RESULT, { device: models.device });
    } catch (error) {
      reply(requestId, WORKER_REPLIES.ERROR, workerError(ERROR_CODES.MODEL_LOAD_FAILED, error));
    }
  }

  async function handleWindow(requestId, payload) {
    if (!models) {
      // Παράθυρο πριν από τη φόρτωση: λάθος σειράς της σελίδας, όχι αποτυχία φόρτωσης (API-019).
      reply(requestId, WORKER_REPLIES.ERROR, { code: ERROR_CODES.UNKNOWN, message: 'μεταγραφή πριν από τη φόρτωση μοντέλων' });
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
 * Περνά μία ειδοποίηση το πολύ ανά `intervalMs`, και πάντα όταν ολοκληρώνεται
 * η λήψη (loaded ≥ total), ώστε η σελίδα να βλέπει το τέλος.
 * @param {(loadedBytes: number, totalBytes: number) => void} send
 * @param {{ now: () => number, intervalMs: number }} options
 */
export function throttleProgress(send, { now, intervalMs }) {
  let last = -Infinity;
  return (loadedBytes, totalBytes) => {
    const finished = totalBytes > 0 && loadedBytes >= totalBytes;
    const time = now();
    if (!finished && time - last < intervalMs) return;
    last = time;
    send(loadedBytes, totalBytes);
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
