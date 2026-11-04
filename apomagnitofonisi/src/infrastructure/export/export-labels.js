/**
 * Τα κείμενα που χρειάζονται οι εξαγωγείς (κεφαλίδες, ετικέτες, σημειώσεις).
 * Τα δίνει η διεπαφή (ui/strings.js) μέσω του composition root, ώστε οι
 * εξαγωγείς να μην εξαρτώνται από τη διεπαφή.
 *
 * @typedef {Object} ExportLabels
 * @property {string} appName
 * @property {string} date
 * @property {string} duration
 * @property {string} speakers
 * @property {string} engine
 * @property {string} unknownSpeaker
 * @property {string} transcriptNotice  π.χ. «Αυτόματη μεταγραφή, μπορεί να έχει λάθη.»
 * @property {string} summaryNotice  π.χ. «Συντάχθηκε αυτόματα με Claude από τη μεταγραφή.»
 * @property {(iso: string) => string} formatDate
 * @property {(engine: import('../../domain/transcript.js').TranscriptEngineInfo) => string} describeEngine
 * @property {(kind: string) => string} summaryTitle  π.χ. 'minutes' → «Πρακτικά»
 */
import { transcriptDuration, findSpeaker } from '../../domain/transcript.js';
import { formatClock } from '../../domain/time-format.js';

/** Οι γραμμές στοιχείων κάτω από τον τίτλο: ημερομηνία, διάρκεια, μηχανή, ομιλητές. */
export function transcriptFacts(transcript, labels) {
  const facts = [
    { label: labels.date, value: labels.formatDate(transcript.createdAt) },
    { label: labels.duration, value: formatClock(transcriptDuration(transcript)) },
    { label: labels.engine, value: labels.describeEngine(transcript.engine) },
  ];
  if (transcript.speakers.length) facts.push({ label: labels.speakers, value: transcript.speakers.map(s => s.label).join(', ') });
  return facts;
}

/** Το όνομα του ομιλητή ενός τμήματος, ή null όταν δεν υπάρχει ομιλητής. */
export function speakerNameOf(transcript, segment, labels) {
  if (!segment.speakerId) return transcript.speakers.length ? labels.unknownSpeaker : null;
  const speaker = findSpeaker(transcript, segment.speakerId);
  return speaker ? speaker.label : labels.unknownSpeaker;
}
