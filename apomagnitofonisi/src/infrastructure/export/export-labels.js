/**
 * Βοηθοί των εξαγωγέων για τα κείμενα των εγγράφων. Τα ίδια τα κείμενα
 * (θύρα ExportLabels, ports.js) τα δίνει η διεπαφή μέσω του composition root,
 * ώστε οι εξαγωγείς να μην εξαρτώνται από τη διεπαφή.
 *
 * @typedef {import('../../application/ports.js').ExportLabels} ExportLabels
 */
import { transcriptDuration, segmentSpeakerLabel } from '../../domain/transcript.js';
import { formatClock } from '../../domain/time-format.js';

/** Ο τίτλος της μεταγραφής, ή η ετικέτα «χωρίς τίτλο». */
export function titleOf(transcript, labels) {
  return transcript.title || labels.untitled;
}

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

/** Ο τίτλος ενός εγγράφου περίληψης: «Πρακτικά συνεδρίασης: Τίτλος μεταγραφής» (OO-009). */
export function summaryHeading(transcript, summary, labels) {
  return `${labels.summaryTitleFor(summary.kind)}: ${titleOf(transcript, labels)}`;
}

/** Το όνομα του ομιλητή ενός τμήματος, ή null σε μεταγραφή χωρίς ομιλητές (κανόνας του domain, OO-020). */
export function speakerNameOf(transcript, segment, labels) {
  return segmentSpeakerLabel(transcript, segment, { unknown: labels.unknownSpeaker });
}
