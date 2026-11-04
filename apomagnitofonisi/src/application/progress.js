/**
 * Τα στάδια προόδου μιας μεταγραφής, κοινά για όλες τις μηχανές.
 *
 * @typedef {typeof PROGRESS_STAGES[keyof typeof PROGRESS_STAGES]} ProgressStage
 *
 * @typedef {Object} ProgressDetail  οι μονάδες εξαρτώνται από το στάδιο (API-014):
 *   byte (loadedBytes/totalBytes) στα DOWNLOADING_MODEL και UPLOADING,
 *   δευτερόλεπτα ήχου (processedSec/totalSec) στο TRANSCRIBING.
 * @property {number} [loadedBytes]
 * @property {number} [totalBytes]
 * @property {number} [processedSec]
 * @property {number} [totalSec]
 *
 * @typedef {Object} ProgressUpdate
 * @property {ProgressStage} stage
 * @property {number} [fraction]  0 … 1, όταν είναι γνωστό
 * @property {ProgressDetail} [detail]
 */
export const PROGRESS_STAGES = Object.freeze({
  READING: 'reading',
  DOWNLOADING_MODEL: 'downloading-model',
  UPLOADING: 'uploading',
  TRANSCRIBING: 'transcribing',
  DIARIZING: 'diarizing',
  SAVING: 'saving',
});

/** Κλάσμα περιορισμένο στο [0, 1], ή undefined όταν δεν είναι γνωστό. */
export function clampFraction(value) {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(1, Math.max(0, value));
}
