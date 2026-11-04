/**
 * Το πρωτόκολλο μηνυμάτων ανάμεσα στη σελίδα (LocalWhisperEngine μέσω
 * WorkerClient) και στον worker των μοντέλων (whisper-worker.js).
 *
 * Σελίδα → worker: { requestId, type, payload }
 *   LOAD_MODELS        payload { speech: { repo, device, dtype }, speaker: { repo, dtype }|null, wasmThreads }
 *   TRANSCRIBE_WINDOW  payload { startSec, samples: Float32Array (μεταφέρεται), language, embedSpeakers }
 * Worker → σελίδα: { requestId, kind, payload }
 *   kind EVENT   ενδιάμεση ειδοποίηση (π.χ. πρόοδος λήψης μοντέλου)
 *   kind RESULT  η απάντηση στο αίτημα
 *   kind ERROR   payload { code, message }
 *
 * Αποτέλεσμα TRANSCRIBE_WINDOW: { segments: [{ start, end, text, embedding: Float32Array|null }] }
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
