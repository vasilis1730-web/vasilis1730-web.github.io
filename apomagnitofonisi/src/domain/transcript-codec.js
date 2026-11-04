/**
 * Η μορφή αρχείου .json της εφαρμογής (αντίγραφο ασφαλείας και μεταφορά σε
 * άλλη συσκευή). Το αρχείο έχει τύπο και έκδοση σχήματος, και κάθε εισαγωγή
 * περνά από το createTranscript(), οπότε ένα αλλοιωμένο αρχείο απορρίπτεται
 * πριν φτάσει στην αποθήκευση.
 */
import { createTranscript, TRANSCRIPT_SCHEMA_VERSION } from './transcript.js';

export const TRANSCRIPT_FILE_FORMAT = 'apomagnitofonisi-transcript';

/** Αρχείο που δεν είναι μεταγραφή της εφαρμογής ή είναι άλλης έκδοσης. */
export class TranscriptFileError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'TranscriptFileError';
  }
}

/**
 * @param {import('./transcript.js').Transcript} transcript
 * @param {{ exportedAt: string, appVersion: string }} meta
 * @returns {string}
 */
export function serializeTranscript(transcript, { exportedAt, appVersion }) {
  return `${JSON.stringify({
    format: TRANSCRIPT_FILE_FORMAT,
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    exportedAt,
    appVersion,
    transcript,
  }, null, 2)}\n`;
}

/**
 * @param {string} text
 * @returns {import('./transcript.js').Transcript}
 */
export function deserializeTranscript(text) {
  let document;
  try {
    document = JSON.parse(String(text));
  } catch (error) {
    throw new TranscriptFileError('το αρχείο δεν είναι έγκυρο JSON', { cause: error });
  }
  if (!document || document.format !== TRANSCRIPT_FILE_FORMAT) throw new TranscriptFileError('το αρχείο δεν είναι μεταγραφή της εφαρμογής');
  if (document.schemaVersion !== TRANSCRIPT_SCHEMA_VERSION) throw new TranscriptFileError(`μη υποστηριζόμενη έκδοση σχήματος ${document.schemaVersion}`);
  try {
    return createTranscript(document.transcript || {});
  } catch (error) {
    throw new TranscriptFileError(`το περιεχόμενο δεν είναι έγκυρο: ${error.message}`, { cause: error });
  }
}
