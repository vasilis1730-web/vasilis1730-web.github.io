/**
 * Ο worker των μοντέλων στη συσκευή (module worker): δεύτερο σημείο σύνδεσης
 * (μετά το src/main.js), γιατί σε worker δεν περνούν συναρτήσεις από τη σελίδα.
 * Συνδέει το `self` με τη λογική του whisper-worker-handler.js και με τα
 * πραγματικά μοντέλα (Whisper και αποτύπωμα φωνής) από το Transformers.js.
 */
import { VENDOR_MODULE_URLS } from '../../config/vendor.js';
import { createModuleLoader } from '../vendor-loader.js';
import { createWhisperWorkerHandler } from './whisper-worker-handler.js';
import { WhisperRecognizer, configureTransformers, createDownloadProgress } from './whisper-recognizer.js';
import { SpeakerEmbedder } from './speaker-embedder.js';

const loadModule = createModuleLoader();

/** @type {import('./whisper-worker-handler.js').WorkerHandlerDeps['loadModels']} */
async function loadModels({ speech, speaker, wasmThreads }, onProgress) {
  const transformers = await loadModule(VENDOR_MODULE_URLS.transformers);
  configureTransformers(transformers, { wasmThreads });
  const progress = createDownloadProgress(onProgress);
  const recognizer = await WhisperRecognizer.load(transformers, speech, progress);
  const embedder = speaker ? await SpeakerEmbedder.load(transformers, speaker, progress) : null;
  return { recognizer, embedder, device: speech.device };
}

const handler = createWhisperWorkerHandler({ loadModels, post: (message, transfer) => self.postMessage(message, transfer) });
self.onmessage = event => { handler.onMessage(event.data); };
