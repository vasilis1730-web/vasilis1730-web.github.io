/**
 * Ο worker των μοντέλων στη συσκευή (module worker). Δέχεται αιτήματα κατά
 * το worker-protocol.js: φόρτωση μοντέλων και μεταγραφή παραθύρων ήχου. Κάθε
 * παράθυρο επεξεργάζεται με τη σειρά που έρχεται.
 */
import { VENDOR_MODULE_URLS } from '../../config/vendor.js';
import { createModuleLoader } from '../vendor-loader.js';
import { WORKER_REQUESTS, WORKER_REPLIES, WORKER_EVENTS } from './worker-protocol.js';
import { WhisperRecognizer, configureTransformers, createDownloadProgress } from './whisper-recognizer.js';
import { SpeakerEmbedder } from '../diarization/speaker-embedder.js';

const loadModule = createModuleLoader();
const state = { recognizer: null, embedder: null, queue: Promise.resolve() };

self.onmessage = event => {
  const { requestId, type, payload } = event.data || {};
  // Τα αιτήματα εκτελούνται ένα-ένα: το μοντέλο δεν τρέχει ποτέ δύο φορές παράλληλα.
  state.queue = state.queue.then(() => handle(requestId, type, payload));
};

async function handle(requestId, type, payload) {
  const reply = (kind, body) => self.postMessage({ requestId, kind, payload: body });
  try {
    if (type === WORKER_REQUESTS.LOAD_MODELS) reply(WORKER_REPLIES.RESULT, await loadModels(payload, e => reply(WORKER_REPLIES.EVENT, e)));
    else if (type === WORKER_REQUESTS.TRANSCRIBE_WINDOW) {
      const result = await transcribeWindow(payload);
      const transfer = result.segments.map(s => s.embedding && s.embedding.buffer).filter(Boolean);
      self.postMessage({ requestId, kind: WORKER_REPLIES.RESULT, payload: result }, transfer);
    } else reply(WORKER_REPLIES.ERROR, { code: 'UNKNOWN', message: `άγνωστο αίτημα ${type}` });
  } catch (error) {
    reply(WORKER_REPLIES.ERROR, { code: error && error.code ? error.code : 'MODEL_LOAD_FAILED', message: error && error.message ? error.message : String(error) });
  }
}

async function loadModels({ speech, speaker, wasmThreads }, emit) {
  const transformers = await loadModule(VENDOR_MODULE_URLS.transformers);
  configureTransformers(transformers, { wasmThreads });
  const progress = createDownloadProgress((loadedBytes, totalBytes) => emit({ type: WORKER_EVENTS.MODEL_PROGRESS, loadedBytes, totalBytes }));
  state.recognizer = await WhisperRecognizer.load(transformers, speech, progress);
  state.embedder = speaker ? await SpeakerEmbedder.load(transformers, speaker, progress) : null;
  return { device: speech.device };
}

async function transcribeWindow({ startSec, samples, language, embedSpeakers }) {
  if (!state.recognizer) throw Object.assign(new Error('δεν έχει φορτωθεί μοντέλο'), { code: 'MODEL_LOAD_FAILED' });
  const segments = await state.recognizer.transcribe(samples, { startSec, language });
  const withEmbeddings = [];
  for (const segment of segments) {
    let embedding = null;
    if (embedSpeakers && state.embedder) {
      const from = Math.max(0, Math.round((segment.start - startSec) * 16000));
      const to = Math.min(samples.length, Math.round((segment.end - startSec) * 16000));
      embedding = await state.embedder.embed(samples.subarray(from, to));
    }
    withEmbeddings.push({ ...segment, embedding });
  }
  return { segments: withEmbeddings };
}
