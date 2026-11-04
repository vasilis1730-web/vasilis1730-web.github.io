/**
 * Κείμενα παρουσίασης που χρειάζονται και έξω από τις προβολές (εξαγωγείς,
 * υπηρεσίες): περιγραφή μηχανής και οι ετικέτες των εγγράφων.
 */
import { STRINGS } from './strings.js';
import { formatDateTime } from './formatters.js';
import { ENGINE_KINDS } from '../domain/transcript.js';

/** «ElevenLabs Scribe (scribe_v2)» ή «Whisper στη συσκευή (whisper-base)». */
export function describeEngine(engine) {
  if (engine.kind === ENGINE_KINDS.ELEVENLABS) return STRINGS.documents.engineCloud(engine.model);
  return STRINGS.documents.engineLocal(String(engine.model || '').split('/').pop());
}

/** @returns {import('../infrastructure/export/export-labels.js').ExportLabels} */
export function exportLabels() {
  return Object.freeze({
    appName: STRINGS.appName,
    date: STRINGS.documents.date,
    duration: STRINGS.documents.duration,
    speakers: STRINGS.transcript.speakers,
    engine: STRINGS.documents.engine,
    unknownSpeaker: STRINGS.transcript.unknownSpeaker,
    transcriptNotice: STRINGS.documents.transcriptNotice,
    summaryNotice: STRINGS.summary.notice,
    formatDate: formatDateTime,
    describeEngine,
    summaryTitle: kind => STRINGS.summary.kinds[kind] || STRINGS.summary.title,
  });
}
