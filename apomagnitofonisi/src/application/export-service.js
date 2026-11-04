/**
 * Περίπτωση χρήσης «Εξαγωγή»: μετατρέπει μια μεταγραφή ή μια περίληψη σε
 * αρχείο (Word, κείμενο, υπότιτλοι, JSON) μέσω των εξαγωγέων που της δίνονται,
 * με όνομα αρχείου με κενά. Δίνει και τις ενέργειες που χρειάζεται η διεπαφή
 * με την πρόθεσή τους (CA-007): κείμενο για το πρόχειρο και αρχείο για κοινή
 * χρήση, ώστε καμία προβολή να μην υποθέτει μορφές.
 */
import { toSafeFileName } from '../domain/file-naming.js';
import { EXPORT_FORMATS, SHARE_FORMAT_PREFERENCE } from './export-formats.js';

/**
 * @typedef {import('./ports.js').ExportFile} ExportFile
 * @typedef {import('./ports.js').ExportFormat} ExportFormat
 * @typedef {import('./ports.js').Transcript} Transcript
 * @typedef {import('./ports.js').Summary} Summary
 */
export class ExportService {
  #transcriptExporters;
  #summaryExporters;
  #summaryFileSuffixFor;
  #untitledFileName;

  /**
   * @param {Object} deps
   * @param {import('./ports.js').TranscriptExporter[]} deps.transcriptExporters
   * @param {import('./ports.js').SummaryExporter[]} deps.summaryExporters
   * @param {(kind: import('./ports.js').SummaryKind) => string} deps.summaryFileSuffixFor  π.χ. 'minutes' → «Πρακτικά»
   * @param {string} deps.untitledFileName  όνομα αρχείου όταν η μεταγραφή δεν έχει τίτλο
   */
  constructor({ transcriptExporters, summaryExporters, summaryFileSuffixFor, untitledFileName }) {
    this.#transcriptExporters = new Map(transcriptExporters.map(e => [e.format, e]));
    this.#summaryExporters = new Map(summaryExporters.map(e => [e.format, e]));
    this.#summaryFileSuffixFor = summaryFileSuffixFor;
    this.#untitledFileName = untitledFileName;
  }

  /** @returns {ExportFormat[]} */
  get transcriptFormats() {
    return [...this.#transcriptExporters.keys()];
  }

  /** @returns {ExportFormat[]} */
  get summaryFormats() {
    return [...this.#summaryExporters.keys()];
  }

  /**
   * @param {Transcript} transcript
   * @param {ExportFormat} format
   * @returns {ExportFile}
   */
  exportTranscript(transcript, format) {
    const exporter = requireExporter(this.#transcriptExporters, format);
    return {
      fileName: this.#fileName(transcript.title, exporter.extension),
      mimeType: exporter.mimeType,
      data: exporter.render(transcript),
    };
  }

  /**
   * @param {Transcript} transcript
   * @param {Summary} summary  η περίληψη (από τη μεταγραφή)
   * @param {ExportFormat} format
   * @returns {ExportFile}
   */
  exportSummary(transcript, summary, format) {
    const exporter = requireExporter(this.#summaryExporters, format);
    const base = [transcript.title, this.#summaryFileSuffixFor(summary.kind)].filter(Boolean).join(' ');
    return {
      fileName: this.#fileName(base, exporter.extension),
      mimeType: exporter.mimeType,
      data: exporter.render(transcript, summary),
    };
  }

  /** Η μεταγραφή ως απλό κείμενο για το πρόχειρο (με χρόνους και ομιλητές). */
  exportClipboardText(transcript) {
    const data = this.exportTranscript(transcript, EXPORT_FORMATS.TXT).data;
    if (typeof data !== 'string') throw new TypeError('ο εξαγωγέας κειμένου πρέπει να επιστρέφει κείμενο');
    return data;
  }

  /**
   * Η μορφή που θα μοιραστεί: η πρώτη κατά προτίμηση (Word, μετά κείμενο) που
   * δέχεται η συσκευή. Ο έλεγχος γίνεται με το όνομα και τον τύπο του αρχείου,
   * χωρίς να φτιαχτεί το αρχείο (OO-004).
   *
   * @param {Transcript} transcript
   * @param {(file: import('./ports.js').FileMetadata) => boolean} canShare
   * @returns {ExportFormat|null} null όταν η συσκευή δεν μοιράζεται καμία
   */
  shareFormatFor(transcript, canShare) {
    for (const format of SHARE_FORMAT_PREFERENCE) {
      const exporter = this.#transcriptExporters.get(format);
      if (exporter && canShare({ fileName: this.#fileName(transcript.title, exporter.extension), mimeType: exporter.mimeType })) return format;
    }
    return null;
  }

  #fileName(baseName, extension) {
    return toSafeFileName(baseName, extension, { fallback: this.#untitledFileName });
  }
}

/** Άγνωστη μορφή είναι λάθος προγραμματισμού (API-001): η διεπαφή δείχνει μόνο τις μορφές της υπηρεσίας. */
function requireExporter(exporters, format) {
  const exporter = exporters.get(format);
  if (!exporter) throw new RangeError(`άγνωστη μορφή ${format}`);
  return exporter;
}
