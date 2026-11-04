/**
 * Το πρωτόκολλο μηνυμάτων ανάμεσα στη σελίδα (LocalWhisperEngine μέσω
 * WorkerClient) και στον worker των μοντέλων (whisper-worker.js). Ένας
 * διακριτής, το `type`, και στις δύο κατευθύνσεις (API-002).
 *
 * Σελίδα → worker: WorkerRequest
 * Worker → σελίδα: WorkerReply (EVENT ενδιάμεση ειδοποίηση, RESULT απάντηση, ERROR σφάλμα)
 *
 * @typedef {import('../../application/errors.js').ErrorCode} ErrorCode
 *
 * @typedef {Object} SpeechModelSpec
 * @property {string} repo  π.χ. onnx-community/whisper-base
 * @property {'webgpu'|'wasm'} device
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
 * @property {'webgpu'|'wasm'} device  η συσκευή όπου φορτώθηκε το μοντέλο μεταγραφής
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
 * @typedef {Object} WorkerRequest
 * @property {number} requestId
 * @property {typeof WORKER_REQUESTS[keyof typeof WORKER_REQUESTS]} type
 * @property {LoadModelsPayload|TranscribeWindowPayload} payload
 *
 * @typedef {Object} WorkerReply
 * @property {number} requestId
 * @property {typeof WORKER_REPLIES[keyof typeof WORKER_REPLIES]} type
 * @property {ModelProgressEvent|LoadModelsResult|TranscribeWindowResult|WorkerError} payload
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
