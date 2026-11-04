/**
 * Οδηγίες προς το γλωσσικό μοντέλο για περιλήψεις και πρακτικά, και η μορφή
 * με την οποία του δίνεται η μεταγραφή.
 *
 * Το system prompt και το μπλοκ της μεταγραφής μένουν ίδια ανάμεσα σε
 * διαφορετικά είδη περίληψης της ίδιας μεταγραφής, ώστε το prompt caching
 * του παρόχου να τα ξαναχρησιμοποιεί και η δεύτερη περίληψη να κοστίζει λίγο.
 */
import { SUMMARY_KINDS, transcriptDuration, findSpeaker } from '../domain/transcript.js';
import { formatClock } from '../domain/time-format.js';
import { INPUT_ISSUES, invalidInput } from './errors.js';

export const SUMMARY_SYSTEM_PROMPT = [
  'Είσαι προσεκτικός γραμματέας συσκέψεων. Σου δίνεται η απομαγνητοφώνηση (αυτόματη μεταγραφή) μιας ηχογράφησης, με χρόνους και ονόματα ομιλητών.',
  '',
  'Κανόνες:',
  '- Γράφεις μόνο ό,τι προκύπτει από τη μεταγραφή. Δεν προσθέτεις πρόσωπα, αριθμούς, ημερομηνίες ή αποφάσεις που δεν ειπώθηκαν.',
  '- Η μεταγραφή είναι αυτόματη και μπορεί να έχει λάθη αναγνώρισης. Όπου κάτι είναι ασαφές ή αμφίβολο, το σημειώνεις με [ασαφές] αντί να μαντεύεις.',
  '- Χρησιμοποιείς τα ονόματα ομιλητών όπως δίνονται. Γενικά ονόματα (π.χ. Ομιλητής 2) τα κρατάς, εκτός αν από τη συζήτηση προκύπτει καθαρά ποιος είναι.',
  '- Γράφεις στη γλώσσα της μεταγραφής.',
  '- Μορφή: Markdown με επικεφαλίδες (##), λίστες και, όπου βοηθά, πίνακες. Χωρίς σχόλια πριν ή μετά το κείμενο.',
  '- Δεν χρησιμοποιείς ποτέ την άνω τελεία. Όπου θα χρειαζόταν, βάζεις κόμμα ή τελεία ανάλογα με το νόημα.',
].join('\n');

const INSTRUCTIONS = Object.freeze({
  [SUMMARY_KINDS.BRIEF]: [
    'Γράψε σύντομη περίληψη της ηχογράφησης:',
    '- μία παράγραφο με το θέμα και το αποτέλεσμα,',
    '- έως 10 κουκκίδες με τα βασικά σημεία,',
    '- στο τέλος ενότητα «## Επόμενα βήματα», μόνο αν συμφωνήθηκαν ενέργειες.',
  ].join('\n'),
  [SUMMARY_KINDS.MINUTES]: [
    'Σύνταξε πρακτικά συνεδρίασης με τις ενότητες:',
    '## Στοιχεία συνεδρίασης (ημερομηνία, ώρα, τόπος, φορέας, μόνο όσα αναφέρονται)',
    '## Συμμετέχοντες',
    '## Θέματα (ημερήσια διάταξη)',
    '## Συζήτηση (ανά θέμα, ποιος είπε τι, συνοπτικά και σε τρίτο πρόσωπο)',
    '## Αποφάσεις',
    '## Εκκρεμότητες (πίνακας με στήλες Ποιος, Τι, Πότε, κενό όπου δεν αναφέρθηκε)',
    'Παράλειψε ενότητα για την οποία δεν υπάρχει τίποτα στη μεταγραφή.',
  ].join('\n'),
  [SUMMARY_KINDS.ACTIONS]: [
    'Κατέγραψε μόνο τις αποφάσεις και τις εκκρεμότητες:',
    '## Αποφάσεις: λίστα με κάθε απόφαση και, αν ειπώθηκε, το σκεπτικό της.',
    '## Εκκρεμότητες: πίνακας με στήλες Ποιος, Τι, Πότε (κενό όπου δεν αναφέρθηκε).',
    'Αν δεν προκύπτουν αποφάσεις ή εκκρεμότητες, γράψε το καθαρά.',
  ].join('\n'),
});

/**
 * Το κείμενο της οδηγίας για κάθε είδος. Το 'custom' παίρνει την οδηγία του
 * χρήστη: κενή οδηγία → INVALID_INPUT (τη διορθώνει ο χρήστης), άγνωστο είδος →
 * RangeError (λάθος του κώδικα).
 */
export function buildSummaryInstruction(kind, customInstruction = '') {
  if (kind === SUMMARY_KINDS.CUSTOM) {
    const clean = String(customInstruction).trim();
    if (!clean) throw invalidInput(INPUT_ISSUES.EMPTY_INSTRUCTION, 'κενή οδηγία');
    return `Ακολούθησε την παρακάτω οδηγία του χρήστη για τη μεταγραφή:\n\n${clean}`;
  }
  const text = INSTRUCTIONS[kind];
  if (!text) throw new RangeError(`άγνωστο είδος περίληψης ${kind}`);
  return text;
}

/**
 * Η μεταγραφή ως κείμενο για το μοντέλο: κεφαλίδα με τίτλο, διάρκεια και
 * ομιλητές, και μία γραμμή «[hh:mm:ss] Όνομα: κείμενο» ανά τμήμα.
 *
 * @param {import('../domain/transcript.js').Transcript} transcript
 * @param {{ unknownSpeaker: string }} labels
 */
export function formatTranscriptForPrompt(transcript, { unknownSpeaker }) {
  const lines = ['<μεταγραφή>'];
  if (transcript.title) lines.push(`Τίτλος: ${transcript.title}`);
  lines.push(`Διάρκεια: ${formatClock(transcriptDuration(transcript))}`);
  if (transcript.speakers.length) lines.push(`Ομιλητές: ${transcript.speakers.map(s => s.label).join(', ')}`);
  lines.push('');
  for (const segment of transcript.segments) {
    const speaker = segment.speakerId ? findSpeaker(transcript, segment.speakerId) : null;
    lines.push(`[${formatClock(segment.start)}] ${speaker ? speaker.label : unknownSpeaker}: ${segment.text}`);
  }
  lines.push('</μεταγραφή>');
  return lines.join('\n');
}
