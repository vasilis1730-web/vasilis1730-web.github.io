/**
 * Περίπτωση χρήσης «Μεταγραφή αρχείου»: ελέγχει το αίτημα, διαλέγει μηχανή,
 * καθαρίζει το κείμενο, φτιάχνει τη μεταγραφή (domain) και την αποθηκεύει.
 *
 * Η υπηρεσία δεν ξέρει τίποτα για Whisper, ElevenLabs ή αρχεία: μιλά μόνο με
 * τις θύρες TranscriptionEngine, TranscriptRepository, DeviceStorage, Clock και
 * IdGenerator. Είναι και η μία πηγή για το αν μια μηχανή είναι διαθέσιμη και
 * ποια επίπεδα ποιότητας έχει (OO-003), ώστε η διεπαφή να μην ξαναγράφει τους
 * κανόνες των μηχανών.
 */
import { createTranscript, speakersFromKeys } from '../domain/transcript.js';
import { normalizeRecognizedText } from '../domain/text-normalize.js';
import { isSupportedLanguageCode, explicitLanguageCode } from '../config/languages.js';
import { AppError, ERROR_CODES, INPUT_ISSUES, invalidInput, throwIfAborted, toAppError } from './errors.js';
import { PROGRESS_STAGES } from './progress.js';
import { MAX_EXPECTED_SPEAKERS } from './limits.js';

/**
 * @typedef {import('./ports.js').TranscriptionEngine} TranscriptionEngine
 * @typedef {import('./ports.js').RecognitionOptions} RecognitionOptions
 * @typedef {import('./ports.js').RecognizedSegment} RecognizedSegment
 * @typedef {import('./ports.js').ProgressUpdate} ProgressUpdate
 * @typedef {import('./ports.js').Transcript} Transcript
 * @typedef {import('./ports.js').EngineKind} EngineKind
 *
 * @typedef {Object} TranscriptionRequest  αίτημα μεταγραφής (API-003)
 * @property {Blob & { name?: string }} media
 * @property {EngineKind} engineKind
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
  #speakerLabelFor;
  #deviceStorage;

  /**
   * @param {Object} deps
   * @param {TranscriptionEngine[]} deps.engines
   * @param {import('./ports.js').TranscriptRepository} deps.repository
   * @param {import('./ports.js').Clock} deps.clock
   * @param {import('./ports.js').IdGenerator} deps.idGenerator
   * @param {(ordinal: number) => string} deps.speakerLabelFor  π.χ. n => `Ομιλητής ${n}`
   * @param {import('./ports.js').DeviceStorage} [deps.deviceStorage]
   */
  constructor({ engines, repository, clock, idGenerator, speakerLabelFor, deviceStorage = null }) {
    this.#engines = new Map(engines.map(engine => [engine.kind, engine]));
    this.#repository = repository;
    this.#clock = clock;
    this.#ids = idGenerator;
    this.#speakerLabelFor = speakerLabelFor;
    this.#deviceStorage = deviceStorage;
  }

  /** @returns {EngineKind[]} οι μηχανές με τη σειρά που δόθηκαν */
  get engineKinds() {
    return [...this.#engines.keys()];
  }

  /**
   * @param {EngineKind} engineKind
   * @param {RecognitionOptions} [options]
   * @returns {Promise<import('./ports.js').EngineAvailability>}
   */
  async checkAvailability(engineKind, options) {
    return this.#engineFor(engineKind).checkAvailability(options);
  }

  /**
   * Τα επίπεδα ποιότητας μιας μηχανής σε αυτή τη συσκευή, ή null όταν η
   * μηχανή δεν έχει επίπεδα (π.χ. ElevenLabs).
   * @param {EngineKind} engineKind
   * @returns {Promise<import('./ports.js').QualityPresetsDescription|null>}
   */
  async describeQualityPresets(engineKind) {
    const engine = this.#engineFor(engineKind);
    return typeof engine.describeQualityPresets === 'function' ? engine.describeQualityPresets() : null;
  }

  /**
   * @param {TranscriptionRequest} request
   * @returns {Promise<Transcript>}
   */
  async transcribe(request) {
    const { media, engineKind, options, textOptions, signal, onProgress, onPartialSegments } = request;
    validateRequest(request);
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
    const { speakers, speakerIdByKey } = speakersFromKeys(cleaned, this.#speakerLabelFor);
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
      languageCode: result.languageCode || explicitLanguageCode(options.languageCode),
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
    if (this.#deviceStorage) await this.#deviceStorage.requestPersistence().catch(() => false);
    return transcript;
  }

  #engineFor(kind) {
    const engine = this.#engines.get(kind);
    // Λάθος προγραμματισμού (API-001): η διεπαφή προσφέρει μόνο τις μηχανές του engineKinds.
    if (!engine) throw new RangeError(`άγνωστη μηχανή ${kind}`);
    return engine;
  }
}

/**
 * Το κενό αρχείο το διορθώνει ο χρήστης (INVALID_INPUT). Τα υπόλοιπα τα
 * εγγυάται η διεπαφή, άρα αν λείπουν είναι λάθος προγραμματισμού.
 */
function validateRequest({ media, options, textOptions }) {
  if (!media || typeof media.size !== 'number') throw new TypeError('λείπει το αρχείο');
  if (media.size <= 0) throw invalidInput(INPUT_ISSUES.EMPTY_FILE, 'κενό αρχείο');
  if (!options || !isSupportedLanguageCode(options.languageCode)) throw new RangeError(`μη υποστηριζόμενη γλώσσα ${options && options.languageCode}`);
  const n = options.expectedSpeakers;
  if (n != null && !(Number.isInteger(n) && n >= 1 && n <= MAX_EXPECTED_SPEAKERS)) throw new RangeError(`μη έγκυρο πλήθος ομιλητών ${n}`);
  if (!textOptions || typeof textOptions.removeAnoTeleia !== 'boolean') throw new TypeError('λείπουν οι επιλογές κειμένου');
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
