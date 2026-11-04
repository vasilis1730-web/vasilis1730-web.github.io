/**
 * Αναζήτηση στο κείμενο της μεταγραφής χωρίς διάκριση πεζών-κεφαλαίων και
 * τόνων («συνεδριαση» βρίσκει «Συνεδρίαση»), με θέσεις στο ΑΡΧΙΚΟ κείμενο,
 * ώστε η διεπαφή να επισημαίνει ακριβώς τα σημεία που βρέθηκαν (CA-007).
 *
 * Καθαρός κώδικας χωρίς εξαρτήσεις.
 *
 * @typedef {Object} TextMatch
 * @property {number} start  θέση στο αρχικό κείμενο (UTF-16)
 * @property {number} end
 */
import { stripAccents } from './text-normalize.js';

/**
 * Μορφή σύγκρισης με ΙΔΙΟ μήκος με το αρχικό κείμενο: κάθε χαρακτήρας γίνεται
 * πεζός χωρίς τόνο, το τελικό «ς» γίνεται «σ», και ό,τι δεν γίνεται ένας
 * χαρακτήρας (π.χ. emoji) μένει όπως είναι. Έτσι οι θέσεις αντιστοιχούν ένα
 * προς ένα με το αρχικό.
 */
export function foldForSearch(text) {
  const source = String(text ?? '');
  let folded = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const code = ch.charCodeAt(0);
    if (code >= 0xd800 && code <= 0xdfff) { folded += ch; continue; }
    const simple = stripAccents(ch).toLocaleLowerCase('el');
    folded += simple.length === 1 ? (simple === 'ς' ? 'σ' : simple) : ch;
  }
  return folded;
}

/**
 * Όλες οι εμφανίσεις του `query` στο `text`, χωρίς επικαλύψεις.
 * @returns {TextMatch[]}
 */
export function findMatches(text, query) {
  const needle = foldForSearch(String(query ?? '').trim());
  if (!needle) return [];
  const haystack = foldForSearch(text);
  const matches = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    matches.push({ start: at, end: at + needle.length });
  }
  return matches;
}

/** Αληθές όταν το κείμενο περιέχει το ερώτημα (κενό ερώτημα: πάντα). */
export function matchesQuery(text, query) {
  const needle = foldForSearch(String(query ?? '').trim());
  return !needle || foldForSearch(text).includes(needle);
}
