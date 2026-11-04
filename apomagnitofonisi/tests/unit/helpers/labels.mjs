/** Ετικέτες εξαγωγής για τα tests (θύρα ExportLabels, ίδιας μορφής με του ui/presentation.js). */
export const testLabels = {
  appName: 'Απομαγνητοφώνηση',
  date: 'Ημερομηνία',
  duration: 'Διάρκεια',
  speakers: 'Ομιλητές',
  engine: 'Μεταγραφή',
  unknownSpeaker: 'Άγνωστος ομιλητής',
  untitled: 'Μεταγραφή χωρίς τίτλο',
  transcriptNotice: 'Αυτόματη μεταγραφή, μπορεί να έχει λάθη.',
  summaryNotice: 'Συντάχθηκε αυτόματα από τη μεταγραφή.',
  formatDate: iso => iso.slice(0, 10),
  describeEngine: engine => `${engine.kind} ${engine.model}`,
  summaryTitleFor: kind => ({ minutes: 'Πρακτικά', brief: 'Περίληψη' }[kind] || 'Σημειώσεις'),
};
