/**
 * Ο ενιαίος τύπος σφάλματος της εφαρμογής, με σταθερούς κωδικούς. Οι
 * adapters (ElevenLabs, Claude, Whisper, αρχεία) μεταφράζουν τα δικά τους
 * σφάλματα σε AppError, και η διεπαφή δείχνει μήνυμα ανά κωδικό
 * (ui/strings.js). Έτσι κανένα στρώμα δεν συγκρίνει κείμενα μηνυμάτων.
 *
 * Κανόνας (API-001): AppError μόνο για ό,τι μπορεί να εξηγηθεί στον χρήστη.
 * Λάθη προγραμματισμού (άγνωστη μηχανή, μορφή, μοντέλο ή πάροχος, ελλιπές
 * αίτημα) είναι TypeError ή RangeError: φαίνονται ως UNKNOWN και γράφονται
 * στην κονσόλα, ώστε να μη μοιάζουν με σφάλματα του χρήστη ή του παρόχου.
 *
 * @typedef {typeof ERROR_CODES[keyof typeof ERROR_CODES]} ErrorCode
 * @typedef {typeof INPUT_ISSUES[keyof typeof INPUT_ISSUES]} InputIssue
 */
export const ERROR_CODES = Object.freeze({
  KEY_MISSING: 'KEY_MISSING',
  KEY_INVALID: 'KEY_INVALID',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RATE_LIMITED: 'RATE_LIMITED',
  OVERLOADED: 'OVERLOADED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_MEDIA: 'UNSUPPORTED_MEDIA',
  NO_AUDIO_TRACK: 'NO_AUDIO_TRACK',
  NETWORK: 'NETWORK',
  CANCELLED: 'CANCELLED',
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  DEVICE_UNSUPPORTED: 'DEVICE_UNSUPPORTED',
  REFUSED: 'REFUSED',
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  /** Είσοδος που διορθώνει ο χρήστης, με την αιτία στο details.reason (INPUT_ISSUES). */
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_TRANSCRIPT_FILE: 'INVALID_TRANSCRIPT_FILE',
  EMPTY_TRANSCRIPT: 'EMPTY_TRANSCRIPT',
  NOT_FOUND: 'NOT_FOUND',
  STORAGE_FULL: 'STORAGE_FULL',
  ERASE_INCOMPLETE: 'ERASE_INCOMPLETE',
  UNKNOWN: 'UNKNOWN',
});

/** Οι αιτίες του INVALID_INPUT, για συγκεκριμένο μήνυμα στη διεπαφή. */
export const INPUT_ISSUES = Object.freeze({
  EMPTY_KEY: 'empty-key',
  KEY_WHITESPACE: 'key-whitespace',
  EMPTY_SPEAKER_NAME: 'empty-speaker-name',
  EMPTY_INSTRUCTION: 'empty-instruction',
  EMPTY_FILE: 'empty-file',
});

const KNOWN_CODES = new Set(Object.values(ERROR_CODES));

export class AppError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {string} [message]  τεχνική περιγραφή (για logs, όχι για τον χρήστη)
   * @param {{ cause?: unknown, details?: Record<string, unknown> }} [extra]
   *   details.providerMessage: το μήνυμα του παρόχου, όταν αξίζει να το δει ο χρήστης
   *   details.reason: η αιτία ενός INVALID_INPUT (INPUT_ISSUES)
   */
  constructor(code, message = code, { cause, details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AppError';
    const known = KNOWN_CODES.has(code);
    /** @type {ErrorCode} */
    this.code = known ? code : ERROR_CODES.UNKNOWN;
    this.details = details ? { ...details } : {};
    // Ένας άγνωστος κωδικός (π.χ. τυπογραφικό λάθος) δεν χάνεται σιωπηλά.
    if (!known) this.details.unrecognizedCode = String(code);
  }
}

/** Είσοδος που πρέπει να διορθώσει ο χρήστης (κενό κλειδί, κενό όνομα κ.λπ.). */
export function invalidInput(reason, message = reason) {
  return new AppError(ERROR_CODES.INVALID_INPUT, message, { details: { reason } });
}

export function isAppError(error) {
  return error instanceof AppError;
}

/** Αληθές για ακύρωση από τον χρήστη (AppError CANCELLED ή AbortError του browser). */
export function isCancellation(error) {
  return (error instanceof AppError && error.code === ERROR_CODES.CANCELLED)
    || (error != null && typeof error === 'object' && error.name === 'AbortError');
}

/** Κάθε σφάλμα ως AppError: τα άγνωστα γίνονται UNKNOWN, οι ακυρώσεις CANCELLED. */
export function toAppError(error) {
  if (error instanceof AppError) return error;
  if (isCancellation(error)) return new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε', { cause: error });
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(ERROR_CODES.UNKNOWN, message, { cause: error });
}

/** Πετά CANCELLED αν το signal έχει ήδη ακυρωθεί. */
export function throwIfAborted(signal) {
  if (signal && signal.aborted) throw new AppError(ERROR_CODES.CANCELLED, 'ακυρώθηκε');
}
