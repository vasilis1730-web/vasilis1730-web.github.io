/**
 * Κείμενα παρουσίασης που χρειάζονται και έξω από τις προβολές (εξαγωγείς,
 * υπηρεσίες): περιγραφή μηχανής και οι ετικέτες των εγγράφων (θύρα ExportLabels).
 */
import { STRINGS } from './strings.js';
import { formatDateTime } from './formatters.js';

/** «ElevenLabs Scribe (scribe_v2)» ή «Whisper στη συσκευή (whisper-base)». */
export function describeEngine(engine) {
  const names = STRINGS.engines[engine.kind];
  const model = String(engine.model || '').split('/').pop();
  return names ? names.documentName(model) : `${engine.kind} (${model})`;
}

/** Η σύντομη ονομασία μιας μηχανής, π.χ. «Στη συσκευή» (CA-008: χωρίς ternaries ανά μηχανή). */
export function engineShortName(kind) {
  return STRINGS.engines[kind] ? STRINGS.engines[kind].short : kind;
}

/** Ο τίτλος μιας μεταγραφής για εμφάνιση (κενός τίτλος → «Μεταγραφή χωρίς τίτλο»). */
export function displayTitle(transcriptOrItem) {
  return transcriptOrItem.title || STRINGS.transcript.untitled;
}

/** @returns {import('../application/ports.js').ExportLabels} */
export function createExportLabels() {
  return Object.freeze({
    appName: STRINGS.appName,
    date: STRINGS.documents.date,
    duration: STRINGS.documents.duration,
    speakers: STRINGS.transcript.speakers,
    engine: STRINGS.documents.engine,
    unknownSpeaker: STRINGS.transcript.unknownSpeaker,
    untitled: STRINGS.transcript.untitled,
    transcriptNotice: STRINGS.documents.transcriptNotice,
    summaryNotice: STRINGS.summary.notice,
    formatDate: formatDateTime,
    describeEngine,
    summaryTitleFor: kind => STRINGS.summary.kinds[kind] || STRINGS.summary.title,
  });
}

/** Η κατάληξη του ονόματος αρχείου μιας περίληψης, π.χ. 'minutes' → «Πρακτικά». */
export function summaryFileSuffixFor(kind) {
  return STRINGS.summary.fileSuffix[kind] || STRINGS.summary.fileSuffix.custom;
}
