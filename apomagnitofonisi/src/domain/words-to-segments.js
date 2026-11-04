/**
 * Ομαδοποίηση λέξεων σε τμήματα, για μηχανές που επιστρέφουν χρόνους ανά λέξη
 * (π.χ. ElevenLabs Scribe). Νέο τμήμα ξεκινά όταν:
 * - αλλάζει ομιλητής,
 * - μεσολαβεί παύση μεγαλύτερη από `maxPauseSec`,
 * - το τμήμα θα ξεπερνούσε τα `maxSegmentSec`,
 * - ή το τμήμα έχει ήδη `preferBreakAfterSec` και η προηγούμενη λέξη κλείνει
 *   πρόταση (προτιμάμε φυσικά όρια).
 * Τα ηχητικά συμβάντα (γέλια, χειροκροτήματα) μένουν στο τμήμα όπου ακούστηκαν
 * και δεν αλλάζουν ομιλητή.
 *
 * @typedef {Object} RecognizedToken
 * @property {string} text
 * @property {number} start
 * @property {number} end
 * @property {string|null} speakerKey  το αναγνωριστικό ομιλητή της μηχανής
 * @property {TokenKind} kind
 *
 * @typedef {typeof TOKEN_KINDS[keyof typeof TOKEN_KINDS]} TokenKind
 *
 * @typedef {Object} RecognizedSegment
 * @property {number} start
 * @property {number} end
 * @property {string} text
 * @property {string|null} speakerKey
 * @property {import('./transcript.js').Word[]} [words]
 */
import { endsSentence } from './text-normalize.js';

/** Τα είδη των λέξεων μιας μηχανής (API-004): λέξη ή ηχητικό συμβάν (γέλια, χειροκροτήματα). */
export const TOKEN_KINDS = Object.freeze({
  WORD: 'word',
  EVENT: 'event',
});

export const DEFAULT_GROUPING_RULES = Object.freeze({
  maxPauseSec: 1.2,
  maxSegmentSec: 30,
  preferBreakAfterSec: 15,
});

/**
 * @param {RecognizedToken[]} tokens
 * @param {Partial<typeof DEFAULT_GROUPING_RULES>} [rules]
 * @returns {RecognizedSegment[]}
 */
export function groupTokensIntoSegments(tokens, rules = {}) {
  const r = { ...DEFAULT_GROUPING_RULES, ...rules };
  const ordered = tokens
    .filter(t => String(t.text ?? '').trim())
    .map((t, index) => ({ t, index }))
    .sort((a, b) => a.t.start - b.t.start || a.index - b.index)
    .map(x => x.t);

  const segments = [];
  let current = null;
  for (const token of ordered) {
    if (current && startsNewSegment(current, token, r)) {
      segments.push(finish(current));
      current = null;
    }
    if (!current) {
      current = { start: token.start, end: token.end, speakerKey: token.kind === TOKEN_KINDS.EVENT ? null : token.speakerKey ?? null, words: [] };
    }
    if (current.speakerKey == null && token.kind !== TOKEN_KINDS.EVENT) current.speakerKey = token.speakerKey ?? null;
    current.words.push({ text: String(token.text).trim(), start: token.start, end: Math.max(token.start, token.end) });
    current.end = Math.max(current.end, token.end);
  }
  if (current) segments.push(finish(current));
  return segments;
}

function startsNewSegment(current, token, rules) {
  const isEvent = token.kind === TOKEN_KINDS.EVENT;
  const speakerChanged = !isEvent && current.speakerKey != null && (token.speakerKey ?? null) !== current.speakerKey;
  const pause = token.start - current.end;
  const tooLong = token.end - current.start > rules.maxSegmentSec;
  const lastWord = current.words[current.words.length - 1];
  const naturalBreak = current.end - current.start >= rules.preferBreakAfterSec && endsSentence(lastWord.text);
  return speakerChanged || pause > rules.maxPauseSec || tooLong || naturalBreak;
}

function finish(segment) {
  return {
    start: segment.start,
    end: segment.end,
    text: segment.words.map(w => w.text).join(' '),
    speakerKey: segment.speakerKey,
    words: segment.words,
  };
}
