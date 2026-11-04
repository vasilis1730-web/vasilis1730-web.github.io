/**
 * Περίπτωση χρήσης «Εξαγωγή»: μετατρέπει μια μεταγραφή ή μια περίληψη σε
 * αρχείο (Word, κείμενο, υπότιτλοι, JSON) μέσω των εξαγωγέων που της δίνονται,
 * με όνομα αρχείου με κενά.
 */
import { findSummary } from '../domain/transcript.js';
import { toSafeFileName } from '../domain/file-naming.js';
import { AppError, ERROR_CODES } from './errors.js';

export class ExportService {
  #transcriptExporters;
  #summaryExporters;
  #summaryNameSuffix;

  /**
   * @param {Object} deps
   * @param {import('./ports.js').TranscriptExporter[]} deps.transcriptExporters
   * @param {import('./ports.js').SummaryExporter[]} deps.summaryExporters
   * @param {(kind: string) => string} deps.summaryNameSuffix  π.χ. 'minutes' → «Πρακτικά»
   */
  constructor({ transcriptExporters, summaryExporters, summaryNameSuffix }) {
    this.#transcriptExporters = new Map(transcriptExporters.map(e => [e.format, e]));
    this.#summaryExporters = new Map(summaryExporters.map(e => [e.format, e]));
    this.#summaryNameSuffix = summaryNameSuffix;
  }

  get transcriptFormats() {
    return [...this.#transcriptExporters.keys()];
  }

  get summaryFormats() {
    return [...this.#summaryExporters.keys()];
  }

  /** @returns {import('./ports.js').ExportFile} */
  exportTranscript(transcript, format) {
    const exporter = this.#transcriptExporters.get(format);
    if (!exporter) throw new AppError(ERROR_CODES.INVALID_INPUT, `άγνωστη μορφή ${format}`);
    return {
      fileName: toSafeFileName(transcript.title, exporter.extension),
      mimeType: exporter.mimeType,
      data: exporter.render(transcript),
    };
  }

  /** @returns {import('./ports.js').ExportFile} */
  exportSummary(transcript, summaryId, format) {
    const exporter = this.#summaryExporters.get(format);
    if (!exporter) throw new AppError(ERROR_CODES.INVALID_INPUT, `άγνωστη μορφή ${format}`);
    const summary = findSummary(transcript, summaryId);
    if (!summary) throw new AppError(ERROR_CODES.NOT_FOUND, `άγνωστη περίληψη ${summaryId}`);
    return {
      fileName: toSafeFileName(`${transcript.title} ${this.#summaryNameSuffix(summary.kind)}`, exporter.extension),
      mimeType: exporter.mimeType,
      data: exporter.render(transcript, summary),
    };
  }
}
