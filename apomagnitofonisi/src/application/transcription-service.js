/**
 * Περίπτωση χρήσης «Μεταγραφή αρχείου»: ελέγχει το αίτημα, διαλέγει μηχανή,
 * καθαρίζει το κείμενο, φτιάχνει τη μεταγραφή (domain) και την αποθηκεύει.
 *
 * Η υπηρεσία δεν ξέρει τίποτα για Whisper, ElevenLabs ή αρχεία: μιλά μόνο με
 * τις θύρες TranscriptionEngine, TranscriptRepository, Clock και IdGenerator.
 */
import { createTranscript, speakersFromKeys } from '../domain/transcript.js';
import { normalizeRecognizedText } from '../domain/text-normalize.js';
import { isSupportedLanguageCode, AUTO_LANGUAGE_CODE } from '../config/languages.js';
import { AppError, ERROR_CODES, throwIfAborted, toAppError } from './errors.js';
import { PROGRESS_STAGES } from './progress.js';
import { MAX_EXPECTED_SPEAKERS } from './limits.js';

/**
 * @typedef {import('./ports.js').TranscriptionEngine} TranscriptionEngine
 * @typedef {import('./ports.js').RecognitionOptions} RecognitionOptions
 * @typedef {import('./ports.js').RecognizedSegment} RecognizedSegment
 * @typedef {import('./ports.js').ProgressUpdate} ProgressUpdate
 * @typedef {import('./ports.js').Transcript} Transcript
 *
 * @typedef {Object} TranscriptionJob
 * @property {Blob & { name?: string }} media
 * @property {import('./ports.js').EngineKind} engineKind
 * @property {RecognitionOptions} options
 * @property {{ removeAnoTeleia: boolean }} textOptions
 * @property {AbortSignal} [signal]
 * @property {(update: ProgressUpdate) => void} [onProgress]
 * @property {(segments: RecognizedSegment[]) => void} [onPartialSegments]
 */
export class TranscriptionService {
  #engines;
  #repository;
  #clock;
  #ids;
  #speakerLabel;
  #storage;

  /**
   * @param {Object} deps
   * @param {TranscriptionEngine[]} deps.engines
   * @param {import('./ports.js').TranscriptRepository} deps.repository
   * @param {import('./ports.js').Clock} deps.clock
   * @param {import('./ports.js').IdGenerator} deps.idGenerator
   * @param {(ordinal: number) => string} deps.speakerLabel  π.χ. n => `Ομιλητής ${n}`
   * @param {import('./ports.js').StorageEstimator} [deps.storage]
   */
  constructor({ engines, repository, clock, idGenerator, speakerLabel, storage = null }) {
    this.#engines = new Map(engines.map(engine => [engine.kind, engine]));
    this.#repository = repository;
    this.#clock = clock;
    this.#ids = idGenerator;
    this.#speakerLabel = speakerLabel;
    this.#storage = storage;
  }

  /** @returns {import('./ports.js').EngineKind[]} */
  get engineKinds() {
    return [...this.#engines.keys()];
  }

  /**
   * @param {import('./ports.js').EngineKind} engineKind
   * @param {RecognitionOptions} [options]
   * @returns {Promise<import('./ports.js').EngineAvailability>}
   */
  async checkAvailability(engineKind, options) {
    return this.#engineFor(engineKind).checkAvailability(options);
  }

  /**
   * @param {TranscriptionJob} job
   * @returns {Promise<Transcript>}
   */
  async transcribe(job) {
    const { media, engineKind, options, textOptions, signal, onProgress, onPartialSegments } = job;
    validateJob(job);
    const engine = this.#engineFor(engineKind);
    const availability = await engine.checkAvailability(options);
    if (!availability.available) throw new AppError(availability.reason || ERROR_CODES.DEVICE_UNSUPPORTED, `η μηχανή ${engineKind} δεν είναι διαθέσιμη`);

    let result;
    try {
      result = await engine.recognize({ media, options, signal, onProgress, onPartialSegments });
    } catch (error) {
      throw toAppError(error);
    }
    throwIfAborted(signal);

    const cleaned = cleanSegments(result.segments, textOptions);
    const { speakers, speakerIdByKey } = speakersFromKeys(cleaned, this.#speakerLabel);
    const now = this.#clock.nowIso();
    const transcript = createTranscript({
      id: this.#ids.newId(),
      title: '',
      createdAt: now,
      source: {
        fileName: media.name || '',
        mimeType: media.type || '',
        sizeBytes: media.size,
        durationSec: result.durationSec ?? null,
      },
      languageCode: result.languageCode || (options.languageCode === AUTO_LANGUAGE_CODE ? null : options.languageCode),
      engine: { kind: engineKind, model: result.model },
      speakers,
      segments: cleaned.map((segment, index) => ({
        id: `seg-${index + 1}`,
        start: segment.start,
        end: segment.end,
        speakerId: segment.speakerKey == null ? null : speakerIdByKey.get(segment.speakerKey),
        text: segment.text,
        ...(segment.words ? { words: segment.words } : {}),
      })),
    });

    onProgress?.({ stage: PROGRESS_STAGES.SAVING });
    await this.#repository.save(transcript);
    if (this.#storage) await this.#storage.requestPersistence().catch(() => false);
    return transcript;
  }

  #engineFor(kind) {
    const engine = this.#engines.get(kind);
    if (!engine) throw new AppError(ERROR_CODES.INVALID_INPUT, `άγνωστη μηχανή ${kind}`);
    return engine;
  }
}

function validateJob({ media, options, textOptions }) {
  if (!media || typeof media.size !== 'number' || media.size <= 0) throw new AppError(ERROR_CODES.INVALID_INPUT, 'κενό ή άκυρο αρχείο');
  if (!options || !isSupportedLanguageCode(options.languageCode)) throw new AppError(ERROR_CODES.INVALID_INPUT, `μη υποστηριζόμενη γλώσσα ${options && options.languageCode}`);
  const n = options.expectedSpeakers;
  if (n != null && !(Number.isInteger(n) && n >= 1 && n <= MAX_EXPECTED_SPEAKERS)) throw new AppError(ERROR_CODES.INVALID_INPUT, `μη έγκυρο πλήθος ομιλητών ${n}`);
  if (!textOptions || typeof textOptions.removeAnoTeleia !== 'boolean') throw new AppError(ERROR_CODES.INVALID_INPUT, 'λείπουν οι επιλογές κειμένου');
}

/**
 * Κανονικοποιεί το κείμενο κάθε τμήματος και πετά τα κενά. Οι χρόνοι ανά
 * λέξη κρατιούνται όταν η κανονικοποίηση δεν άλλαξε το πλήθος των λέξεων
 * (π.χ. μόνο στίξη), με το νέο κείμενο ανά λέξη. Αλλιώς δεν αντιστοιχούν πια
 * και αφαιρούνται.
 */
function cleanSegments(segments, textOptions) {
  const cleaned = [];
  for (const segment of segments) {
    const text = normalizeRecognizedText(segment.text, textOptions);
    if (!text) continue;
    const next = { start: segment.start, end: Math.max(segment.start, segment.end), speakerKey: segment.speakerKey ?? null, text };
    if (Array.isArray(segment.words) && segment.words.length) {
      const pieces = text.split(' ');
      if (pieces.length === segment.words.length) next.words = segment.words.map((w, i) => ({ text: pieces[i], start: w.start, end: w.end }));
    }
    cleaned.push(next);
  }
  return cleaned.sort((a, b) => a.start - b.start);
}
