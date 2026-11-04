/**
 * Το πρωτόκολλο μηνυμάτων ανάμεσα στη σελίδα (LocalWhisperEngine μέσω
 * WorkerClient) και στον worker των μοντέλων (whisper-worker.js). Ένας
 * διακριτής, το `type`, και στις δύο κατευθύνσεις (API-002), και κάθε μήνυμα
 * ως union που ζευγαρώνει το `type` με το δικό του payload (API-019).
 *
 * Σελίδα → worker: WorkerRequest
 * Worker → σελίδα: WorkerReply (EVENT ενδιάμεση ειδοποίηση, RESULT απάντηση, ERROR σφάλμα)
 * Σειρά: πρώτα LOAD_MODELS, μετά όσα TRANSCRIBE_WINDOW χρειάζονται.
 *
 * @typedef {import('../../application/errors.js').ErrorCode} ErrorCode
 * @typedef {typeof INFERENCE_DEVICES[keyof typeof INFERENCE_DEVICES]} InferenceDevice
 *
 * @typedef {Object} SpeechModelSpec
 * @property {string} repo  π.χ. onnx-community/whisper-base
 * @property {InferenceDevice} device
 * @property {Record<string, string>} dtype  κβάντιση ανά αρχείο ONNX
 *
 * @typedef {Object} SpeakerModelSpec
 * @property {string} repo
 * @property {string} dtype
 *
 * @typedef {Object} LoadModelsPayload
 * @property {SpeechModelSpec} speech
 * @property {SpeakerModelSpec|null} speaker  null: χωρίς διαχωρισμό ομιλητών
 * @property {number} wasmThreads
 *
 * @typedef {Object} LoadModelsResult
 * @property {InferenceDevice} device  η συσκευή όπου φορτώθηκε το μοντέλο μεταγραφής
 *
 * @typedef {Object} TranscribeWindowPayload
 * @property {number} startSec  χρόνος έναρξης του παραθύρου στο αρχείο
 * @property {Float32Array} samples  PCM_SAMPLE_RATE, ένα κανάλι (μεταφέρεται, δεν αντιγράφεται)
 * @property {string|null} whisperLanguage  όνομα γλώσσας του Whisper (π.χ. 'greek'), null: αυτόματη ανίχνευση
 * @property {boolean} embedSpeakers  να υπολογιστεί αποτύπωμα φωνής ανά τμήμα
 *
 * @typedef {Object} RecognizedWindowSegment
 * @property {number} start  δευτερόλεπτα στο αρχείο
 * @property {number} end
 * @property {string} text
 * @property {Float32Array|null} embedding  αποτύπωμα φωνής, ή null (μικρό τμήμα ή χωρίς διαχωρισμό)
 *
 * @typedef {Object} TranscribeWindowResult
 * @property {RecognizedWindowSegment[]} segments
 *
 * @typedef {Object} ModelProgressEvent
 * @property {'model-progress'} event
 * @property {number} loadedBytes
 * @property {number} totalBytes
 *
 * @typedef {Object} WorkerError
 * @property {ErrorCode} code
 * @property {string} message
 *
 * @typedef {{ requestId: number, type: 'load-models', payload: LoadModelsPayload }} LoadModelsRequest
 * @typedef {{ requestId: number, type: 'transcribe-window', payload: TranscribeWindowPayload }} TranscribeWindowRequest
 * @typedef {LoadModelsRequest|TranscribeWindowRequest} WorkerRequest
 *
 * @typedef {{ requestId: number, type: 'event', payload: ModelProgressEvent }} EventReply
 * @typedef {{ requestId: number, type: 'result', payload: LoadModelsResult|TranscribeWindowResult }} ResultReply
 * @typedef {{ requestId: number, type: 'error', payload: WorkerError }} ErrorReply
 * @typedef {EventReply|ResultReply|ErrorReply} WorkerReply
 */
export const WORKER_REQUESTS = Object.freeze({
  LOAD_MODELS: 'load-models',
  TRANSCRIBE_WINDOW: 'transcribe-window',
});

export const WORKER_REPLIES = Object.freeze({
  EVENT: 'event',
  RESULT: 'result',
  ERROR: 'error',
});

export const WORKER_EVENTS = Object.freeze({
  MODEL_PROGRESS: 'model-progress',
});

/** Πού τρέχει ένα μοντέλο (API-004): κάρτα γραφικών ή επεξεργαστής. */
export const INFERENCE_DEVICES = Object.freeze({
  WEBGPU: 'webgpu',
  WASM: 'wasm',
});
