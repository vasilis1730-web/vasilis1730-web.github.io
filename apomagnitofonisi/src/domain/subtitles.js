/**
 * Υπότιτλοι από τα τμήματα της μεταγραφής: κάθε υπότιτλος έχει έως
 * `maxLines` γραμμές των `maxCharsPerLine` χαρακτήρων και διαρκεί από
 * `minDurationSec` έως `maxDurationSec`. Οι υπότιτλοι δεν περνούν ποτέ από
 * ομιλητή σε ομιλητή (σέβονται τα όρια των τμημάτων) και προτιμούν να
 * κόβονται στο τέλος πρότασης. Όταν η μηχανή έδωσε χρόνους ανά λέξη
 * χρησιμοποιούνται αυτοί, αλλιώς ο χρόνος του τμήματος μοιράζεται αναλογικά με
 * το μήκος κάθε λέξης.
 *
 * @typedef {Object} SubtitleRules
 * @property {number} maxCharsPerLine
 * @property {number} maxLines
 * @property {number} maxDurationSec
 * @property {number} minDurationSec
 *
 * @typedef {Object} SubtitleCue
 * @property {number} index  από 1
 * @property {number} start
 * @property {number} end
 * @property {string[]} lines
 * @property {string|null} speakerId
 */

import { endsSentence } from './text-normalize.js';

export const DEFAULT_SUBTITLE_RULES = Object.freeze({
  maxCharsPerLine: 42,
  maxLines: 2,
  maxDurationSec: 7,
  minDurationSec: 1,
});


/**
 * @param {import('./transcript.js').Segment[]} segments  ταξινομημένα κατά χρόνο
 * @param {Partial<SubtitleRules>} [rules]
 * @returns {SubtitleCue[]}
 */
export function buildSubtitleCues(segments, rules = {}) {
  const r = { ...DEFAULT_SUBTITLE_RULES, ...rules };
  const capacity = r.maxCharsPerLine * r.maxLines;
  const groups = [];

  for (const segment of segments) {
    let current = [];
    const flush = () => {
      if (current.length) groups.push({ tokens: current, speakerId: segment.speakerId ?? null });
      current = [];
    };
    for (const token of timedTokens(segment)) {
      if (current.length && overflows(current, token, r, capacity)) flush();
      current.push(token);
      if (endsSentence(token.text) && joinedLength(current) >= capacity / 2) flush();
    }
    flush();
  }

  const cues = groups.map(g => ({
    start: g.tokens[0].start,
    end: g.tokens[g.tokens.length - 1].end,
    text: g.tokens.map(t => t.text).join(' '),
    speakerId: g.speakerId,
  }));
  fixTiming(cues, r);
  return cues.map((cue, i) => ({
    index: i + 1,
    start: cue.start,
    end: cue.end,
    lines: wrapLines(cue.text, { maxCharsPerLine: r.maxCharsPerLine, maxLines: r.maxLines }),
    speakerId: cue.speakerId,
  }));
}

/**
 * Σπάει κείμενο σε γραμμές έως `maxCharsPerLine` χαρακτήρων. Για δύο γραμμές
 * διαλέγει το κενό που τις κάνει όσο πιο ισομήκεις γίνεται (πιο ευανάγνωστοι
 * υπότιτλοι). Λέξη μεγαλύτερη από τη γραμμή μένει ολόκληρη.
 *
 * @param {string} text
 * @param {Pick<SubtitleRules, 'maxCharsPerLine'|'maxLines'>} rules  ίδια ονόματα με τους κανόνες υποτίτλων
 */
export function wrapLines(text, { maxCharsPerLine, maxLines }) {
  const maxPerLine = maxCharsPerLine;
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxPerLine || maxLines <= 1) return [clean];
  if (maxLines === 2) {
    let best = null;
    for (let i = clean.indexOf(' '); i !== -1; i = clean.indexOf(' ', i + 1)) {
      const longest = Math.max(i, clean.length - i - 1);
      if (!best || longest < best.longest) best = { index: i, longest };
    }
    if (best) return [clean.slice(0, best.index), clean.slice(best.index + 1)];
    return [clean];
  }
  const lines = [];
  let line = '';
  for (const word of clean.split(' ')) {
    if (line && (line.length + 1 + word.length) > maxPerLine) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function timedTokens(segment) {
  const words = Array.isArray(segment.words) ? segment.words.filter(w => String(w.text).trim()) : [];
  if (words.length) return words.map(w => ({ text: String(w.text).trim(), start: w.start, end: w.end }));
  const parts = String(segment.text || '').split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const span = Math.max(0, segment.end - segment.start);
  const weights = parts.map(p => p.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = segment.start;
  return parts.map((text, i) => {
    const start = cursor;
    cursor = i === parts.length - 1 ? segment.end : cursor + (span * weights[i]) / total;
    return { text, start, end: cursor };
  });
}

function joinedLength(tokens) {
  return tokens.reduce((n, t) => n + t.text.length, 0) + Math.max(0, tokens.length - 1);
}

function overflows(current, next, rules, capacity) {
  const length = joinedLength(current) + 1 + next.text.length;
  const duration = next.end - current[0].start;
  return length > capacity || duration > rules.maxDurationSec;
}

/** Ελάχιστη διάρκεια χωρίς επικαλύψεις: κανένας υπότιτλος δεν τρώει τον επόμενο. */
function fixTiming(cues, rules) {
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const nextStart = i + 1 < cues.length ? cues[i + 1].start : Infinity;
    if (cue.end - cue.start < rules.minDurationSec) cue.end = cue.start + rules.minDurationSec;
    if (cue.end > nextStart) cue.end = Math.max(cue.start, nextStart);
  }
}
