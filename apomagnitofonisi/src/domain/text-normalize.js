/**
 * Κανονικοποίηση του κειμένου που επιστρέφουν οι μηχανές αναγνώρισης.
 *
 * - κενά: ένα κενό ανάμεσα στις λέξεις, κανένα πριν από σημείο στίξης,
 * - βρόχοι επανάληψης του Whisper («και και και και …» ή η ίδια φράση ξανά και
 *   ξανά) συμπτύσσονται σε μία εμφάνιση,
 * - γνωστές «παραισθήσεις» του Whisper σε σιωπή (π.χ. τίτλοι υποτιτλιστών)
 *   αναγνωρίζονται, ώστε να πετιούνται όταν είναι όλο το τμήμα,
 * - προαιρετικά, χωρίς άνω τελεία: ο χαρακτήρας U+0387 (και ο ίδιας όψης
 *   U+00B7) γίνεται τελεία με κεφαλαίο όταν χωρίζει δύο ανεξάρτητες προτάσεις
 *   (με ρήμα και οι δύο), αλλιώς κόμμα. Οι ευρετικοί κανόνες ρημάτων είναι οι
 *   ίδιοι με του εργαλείου ελέγχου εγγράφων του δημιουργού της εφαρμογής.
 *
 * Καθαρός κώδικας χωρίς εξαρτήσεις.
 */

/** Η άνω τελεία (U+0387) και η μέση τελεία (U+00B7), χωρίς να γράφονται αυτούσιες στον κώδικα. */
const DOT_CHARACTERS = String.fromCharCode(0x387, 0xb7);
const ANO_TELEIA_PATTERN = new RegExp(`[ \t]*[${DOT_CHARACTERS}][ \t]*`, 'g');
const CLAUSE_END_OR_DOT = new RegExp(`[.!;?\n${DOT_CHARACTERS}]`);
const CLAUSE_BOUNDARY = /[.!;?\n]/;

/** Επανάληψη που θεωρείται βρόχος: η ίδια ομάδα λέξεων τόσες φορές στη σειρά. */
const MIN_LOOP_REPEATS = 4;
const MAX_LOOP_NGRAM = 8;

/**
 * Φράσεις που το Whisper «ακούει» σε σιωπή ή μουσική, γραμμένες στη μορφή του
 * `comparable()` (πεζά, χωρίς τόνους, χωρίς στίξη).
 */
const HALLUCINATION_PHRASES = new Set([
  'υποτιτλοι authorwave',
  'υποτιτλοι απο την κοινοτητα amaraorg',
  'υποτιτλισμος απο την κοινοτητα amaraorg',
  'ευχαριστω για την παρακολουθηση',
  'ευχαριστουμε για την παρακολουθηση',
  'ευχαριστω πολυ για την παρακολουθηση',
  'ευχαριστουμε πολυ για την παρακολουθηση',
  'subtitles by the amaraorg community',
  'thanks for watching',
  'thank you for watching',
]);

const HALLUCINATION_PATTERNS = [
  /^υποτιτλ\S* .*(authorwave|amaraorg)/,
  /^(subtitles|transcription|captions) by /,
];

/**
 * Η πλήρης κανονικοποίηση ενός τμήματος.
 * @param {string} text
 * @param {{ removeAnoTeleia?: boolean }} [options]
 */
export function normalizeRecognizedText(text, { removeAnoTeleia = false } = {}) {
  let result = normalizeWhitespace(text);
  result = collapseRepetitions(result);
  if (removeAnoTeleia) result = normalizeWhitespace(replaceAnoTeleia(result));
  return result;
}

/** Ένα κενό ανάμεσα στις λέξεις, κανένα πριν από σημείο στίξης ή κλείσιμο εισαγωγικών. */
export function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?»)\]…])/g, '$1')
    .replace(/([«([]) /g, '$1')
    .trim();
}

/**
 * Συμπτύσσει ομάδες έως MAX_LOOP_NGRAM λέξεων που επαναλαμβάνονται
 * MIN_LOOP_REPEATS ή περισσότερες φορές στη σειρά (σύγκριση χωρίς τόνους και
 * στίξη). Λιγότερες επαναλήψεις («πολύ πολύ») μένουν όπως είναι.
 */
export function collapseRepetitions(text) {
  let words = String(text ?? '').split(' ').filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (let n = 1; n <= MAX_LOOP_NGRAM && !changed; n++) {
      for (let i = 0; i + n * MIN_LOOP_REPEATS <= words.length; i++) {
        const key = words.slice(i, i + n).map(comparable).join(' ');
        if (!key) continue;
        let repeats = 1;
        while (i + (repeats + 1) * n <= words.length && words.slice(i + repeats * n, i + (repeats + 1) * n).map(comparable).join(' ') === key) repeats += 1;
        if (repeats >= MIN_LOOP_REPEATS) {
          words = [...words.slice(0, i + n), ...words.slice(i + repeats * n)];
          changed = true;
          break;
        }
      }
    }
  }
  return words.join(' ');
}

/** Αληθές όταν όλο το κείμενο είναι γνωστή παραίσθηση του Whisper ή μόνο σύμβολα. */
export function isLikelyHallucination(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return true;
  if (!/[\p{L}\p{N}]/u.test(raw)) return true;
  const key = comparable(raw);
  return HALLUCINATION_PHRASES.has(key) || HALLUCINATION_PATTERNS.some(p => p.test(key));
}

/**
 * Αντικαθιστά την άνω τελεία (U+0387, U+00B7): τελεία και κεφαλαίο όταν και
 * οι δύο πλευρές είναι προτάσεις με ρήμα, αλλιώς κόμμα, τελεία στο τέλος.
 */
export function replaceAnoTeleia(text) {
  const source = String(text ?? '');
  let result = '';
  let cursor = 0;
  let capitalizeNext = false;
  for (const match of source.matchAll(ANO_TELEIA_PATTERN)) {
    const piece = source.slice(cursor, match.index);
    result += capitalizeNext ? capitalizeFirstLetter(piece) : piece;
    const after = source.slice(match.index + match[0].length);
    if (!after.trim()) {
      result += '.';
      capitalizeNext = false;
    } else if (hasVerb(lastClause(result)) && hasVerb(firstClause(after))) {
      result += '. ';
      capitalizeNext = true;
    } else {
      result += ', ';
      capitalizeNext = false;
    }
    cursor = match.index + match[0].length;
  }
  const tail = source.slice(cursor);
  return result + (capitalizeNext ? capitalizeFirstLetter(tail) : tail);
}

/* ---------------------------------------------------------------- ρήματα */

const VERB_TOKENS = new Set(['να', 'θα', 'δεν', 'μην', 'μη', 'ειναι', 'ηταν', 'εχει', 'εχουν', 'ισχυει',
  'πρεπει', 'μπορει', 'αρκει', 'γινεται', 'is', 'are', 'was', 'must']);
const VERB_ENDINGS = ['ουνται', 'ονται', 'ειται', 'εται', 'αται', 'ται', 'ουμαι', 'ομαι', 'αμαι',
  'ουν', 'ουμε', 'ειτε', 'ετε', 'ηκαν', 'ηκε', 'ησαν', 'ησε', 'ασαν', 'ασε', 'ωσαν', 'ωσε', 'ινε', 'ει', 'ω'];
const NOT_VERBS = new Set(['βασει', 'δυναμει', 'λογω', 'μεσω', 'εξω', 'κατω', 'ανω', 'πανω', 'επανω', 'πισω',
  'εσω', 'κατωτερω', 'ανωτερω', 'παρακατω', 'παραπανω', 'ανευ', 'εκει', 'οπισω', 'μεταξυ', 'αμεσως',
  'εντος', 'εκτος', 'περιπου', 'ακομη', 'ακομα', 'ηδη']);

/** Ευρετικός έλεγχος: έχει η φράση ρήμα; */
export function hasVerb(clause) {
  for (const token of String(clause).match(/\p{L}+/gu) || []) {
    const word = stripAccents(token.toLowerCase());
    if (VERB_TOKENS.has(word)) return true;
    if (word.length < 4 || NOT_VERBS.has(word)) continue;
    if (word.endsWith('ω') && word.length < 5) continue;
    if (VERB_ENDINGS.some(ending => word.endsWith(ending))) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- βοηθητικά */

function lastClause(text) {
  for (let i = text.length - 1; i >= 0; i--) if (CLAUSE_BOUNDARY.test(text[i])) return text.slice(i + 1);
  return text;
}

function firstClause(text) {
  const boundary = text.search(CLAUSE_END_OR_DOT);
  return boundary === -1 ? text : text.slice(0, boundary);
}

function capitalizeFirstLetter(text) {
  const index = text.search(/\p{L}/u);
  if (index === -1) return text;
  return text.slice(0, index) + text[index].toLocaleUpperCase('el') + text.slice(index + 1);
}

function stripAccents(text) {
  return text.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/** Μορφή σύγκρισης: πεζά, χωρίς τόνους, χωρίς στίξη, ένα κενό ανάμεσα στις λέξεις. */
function comparable(text) {
  return stripAccents(String(text).toLocaleLowerCase('el'))
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
