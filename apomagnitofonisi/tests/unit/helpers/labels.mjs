/** Ετικέτες εξαγωγής για τα tests (ίδιας μορφής με του ui/strings.js). */
export const testLabels = {
  appName: 'Απομαγνητοφώνηση',
  date: 'Ημερομηνία',
  duration: 'Διάρκεια',
  speakers: 'Ομιλητές',
  engine: 'Μεταγραφή',
  unknownSpeaker: 'Άγνωστος ομιλητής',
  transcriptNotice: 'Αυτόματη μεταγραφή, μπορεί να έχει λάθη.',
  summaryNotice: 'Συντάχθηκε αυτόματα από τη μεταγραφή.',
  formatDate: iso => iso.slice(0, 10),
  describeEngine: engine => `${engine.kind} ${engine.model}`,
  summaryTitle: kind => ({ minutes: 'Πρακτικά', brief: 'Περίληψη' }[kind] || 'Σημειώσεις'),
};
