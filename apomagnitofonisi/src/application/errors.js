/**
 * Ο ενιαίος τύπος σφάλματος της εφαρμογής, με σταθερούς κωδικούς. Οι
 * adapters (ElevenLabs, Claude, Whisper, αρχεία) μεταφράζουν τα δικά τους
 * σφάλματα σε AppError, και η διεπαφή δείχνει μήνυμα ανά κωδικό
 * (ui/strings.js). Έτσι κανένα στρώμα δεν συγκρίνει κείμενα μηνυμάτων.
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
  DEVICE_UNSUPPORTED: 'DEVICE_UNSUPPORTED',
  REFUSED: 'REFUSED',
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  STORAGE_FULL: 'STORAGE_FULL',
  UNKNOWN: 'UNKNOWN',
});

const KNOWN_CODES = new Set(Object.values(ERROR_CODES));

export class AppError extends Error {
  /**
   * @param {string} code  ένας από τους ERROR_CODES
   * @param {string} [message]  τεχνική περιγραφή (για logs, όχι για τον χρήστη)
   * @param {{ cause?: unknown, details?: Record<string, unknown> }} [extra]
   *   details.providerMessage: το μήνυμα του παρόχου, όταν αξίζει να το δει ο χρήστης
   */
  constructor(code, message = code, { cause, details } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AppError';
    this.code = KNOWN_CODES.has(code) ? code : ERROR_CODES.UNKNOWN;
    this.details = details ? { ...details } : {};
  }
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
