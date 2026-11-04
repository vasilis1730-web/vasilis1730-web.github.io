/**
 * Τα στάδια προόδου μιας μεταγραφής, κοινά για όλες τις μηχανές.
 *
 * @typedef {'reading'|'downloading-model'|'uploading'|'transcribing'|'diarizing'|'saving'} ProgressStage
 *
 * @typedef {Object} ProgressUpdate
 * @property {ProgressStage} stage
 * @property {number} [fraction]  0 … 1, όταν είναι γνωστό
 * @property {{ loadedBytes?: number, totalBytes?: number, processedSec?: number, totalSec?: number }} [detail]
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
