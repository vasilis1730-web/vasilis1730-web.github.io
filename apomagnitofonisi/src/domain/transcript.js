/**
 * Το μοντέλο της μεταγραφής: μεταγραφή, τμήματα, ομιλητές, περιλήψεις.
 *
 * Καθαρός κώδικας: καμία εξάρτηση από DOM, δίκτυο ή βιβλιοθήκες. Κάθε
 * λειτουργία επιστρέφει ΝΕΟ αντικείμενο και δεν αλλάζει ποτέ αυτό που πήρε, ώστε
 * η διεπαφή να κρατά ιστορικό και η αποθήκευση να μη βλέπει μισές αλλαγές. Η
 * ώρα (`now`) και τα αναγνωριστικά έρχονται πάντα απ' έξω (Clock, IdGenerator
 * του application), ώστε όλα να ελέγχονται ντετερμινιστικά.
 *
 * @typedef {Object} Word
 * @property {string} text
 * @property {number} start  δευτερόλεπτα από την αρχή του αρχείου
 * @property {number} end
 *
 * @typedef {Object} Segment
 * @property {string} id
 * @property {number} start
 * @property {number} end
 * @property {string|null} speakerId
 * @property {string} text
 * @property {Word[]} [words]  χρόνοι ανά λέξη, όταν τους δίνει η μηχανή
 *
 * @typedef {Object} Speaker
 * @property {string} id
 * @property {string} label
 * @property {number} colorIndex  0 … SPEAKER_COLOR_COUNT-1
 *
 * @typedef {'brief'|'minutes'|'actions'|'custom'} SummaryKind
 *
 * @typedef {Object} Summary
 * @property {string} id
 * @property {SummaryKind} kind
 * @property {string} [instruction]  μόνο για kind 'custom'
 * @property {string} model  το αναγνωριστικό του μοντέλου που την έγραψε (π.χ. claude-opus-5-5)
 * @property {string} createdAt  ISO 8601
 * @property {string} text  Markdown
 * @property {boolean} [truncated]  το μοντέλο σταμάτησε στο όριο μήκους
 *
 * @typedef {Object} TranscriptSource
 * @property {string} fileName
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {number|null} durationSec
 *
 * @typedef {'local'|'elevenlabs'} EngineKind
 *
 * @typedef {Object} TranscriptEngineInfo
 * @property {EngineKind} kind
 * @property {string} model
 *
 * @typedef {Object} Transcript
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} title  από τον χρήστη ή το όνομα αρχείου, μπορεί να είναι κενός
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {TranscriptSource} source
 * @property {string|null} languageCode  ISO 639-1, ή null όταν δεν είναι γνωστή
 * @property {TranscriptEngineInfo} engine
 * @property {Speaker[]} speakers
 * @property {Segment[]} segments  ταξινομημένα κατά χρόνο έναρξης
 * @property {Summary[]} summaries  η πιο πρόσφατη πρώτη
 */

export const TRANSCRIPT_SCHEMA_VERSION = 1;

export const ENGINE_KINDS = Object.freeze({ LOCAL: 'local', ELEVENLABS: 'elevenlabs' });

export const SUMMARY_KINDS = Object.freeze({
  BRIEF: 'brief',
  MINUTES: 'minutes',
  ACTIONS: 'actions',
  CUSTOM: 'custom',
});

/** Πόσα διαφορετικά χρώματα ομιλητών έχει η παλέτα της διεπαφής. */
export const SPEAKER_COLOR_COUNT = 10;

const MAX_TITLE_LENGTH = 200;

/**
 * Οι κανόνες του μοντέλου που μπορεί να παραβιαστούν. Μόνο το EMPTY_SPEAKER_NAME
 * οφείλεται στον χρήστη, τα υπόλοιπα είναι λάθη του κώδικα που καλεί.
 */
export const TRANSCRIPT_RULES = Object.freeze({
  EMPTY_SPEAKER_NAME: 'empty-speaker-name',
  UNKNOWN_SPEAKER: 'unknown-speaker',
  UNKNOWN_SEGMENT: 'unknown-segment',
  UNKNOWN_SUMMARY: 'unknown-summary',
  INVALID_DATA: 'invalid-data',
});

/** Παραβίαση κανόνα του μοντέλου (π.χ. τμήμα που δείχνει σε άγνωστο ομιλητή). */
export class TranscriptRuleError extends Error {
  /**
   * @param {string} message
   * @param {typeof TRANSCRIPT_RULES[keyof typeof TRANSCRIPT_RULES]} [rule]
   */
  constructor(message, rule = TRANSCRIPT_RULES.INVALID_DATA) {
    super(message);
    this.name = 'TranscriptRuleError';
    this.rule = rule;
  }
}

/* ---------------------------------------------------------------- δημιουργία */

/**
 * Δημιουργεί μια έγκυρη μεταγραφή από τα δεδομένα της μηχανής.
 *
 * @param {Object} init
 * @param {string} init.id
 * @param {string} init.title
 * @param {string} init.createdAt
 * @param {TranscriptSource} init.source
 * @param {string|null} init.languageCode
 * @param {TranscriptEngineInfo} init.engine
 * @param {Speaker[]} [init.speakers]
 * @param {Segment[]} [init.segments]
 * @param {Summary[]} [init.summaries]
 * @param {string} [init.updatedAt]
 * @returns {Transcript}
 */
export function createTranscript(init) {
  const { id, title, createdAt, source, languageCode = null, engine } = init;
  requireText(id, 'id');
  requireText(createdAt, 'createdAt');
  if (!source || typeof source !== 'object') throw new TranscriptRuleError('λείπει το source');
  if (!engine || !Object.values(ENGINE_KINDS).includes(engine.kind)) throw new TranscriptRuleError(`άγνωστη μηχανή ${engine && engine.kind}`);

  const transcript = {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    id,
    title: normalizeTitle(title, source.fileName),
    createdAt,
    updatedAt: init.updatedAt || createdAt,
    source: {
      fileName: String(source.fileName || ''),
      mimeType: String(source.mimeType || ''),
      sizeBytes: nonNegativeNumber(source.sizeBytes, 0),
      durationSec: source.durationSec == null ? null : nonNegativeNumber(source.durationSec, 0),
    },
    languageCode: languageCode || null,
    engine: { kind: engine.kind, model: String(engine.model || '') },
    speakers: (init.speakers || []).map(copySpeaker),
    segments: sortByStart((init.segments || []).map(copySegment)),
    summaries: (init.summaries || []).map(copySummary),
  };
  assertConsistent(transcript);
  return transcript;
}

/**
 * Μετατρέπει τα «κλειδιά ομιλητή» της μηχανής (π.χ. speaker_0) σε ομιλητές με
 * σταθερά αναγνωριστικά S1, S2, … με τη σειρά που μιλούν πρώτη φορά.
 *
 * @param {{ speakerKey: string|null }[]} recognized  ταξινομημένα κατά χρόνο
 * @param {(ordinal: number) => string} speakerLabelFor  π.χ. n => `Ομιλητής ${n}`
 * @returns {{ speakers: Speaker[], speakerIdByKey: Map<string, string> }}
 */
export function speakersFromKeys(recognized, speakerLabelFor) {
  const speakerIdByKey = new Map();
  const speakers = [];
  for (const item of recognized) {
    const key = item.speakerKey;
    if (key == null || speakerIdByKey.has(key)) continue;
    const ordinal = speakers.length + 1;
    const id = `S${ordinal}`;
    speakerIdByKey.set(key, id);
    speakers.push({ id, label: speakerLabelFor(ordinal), colorIndex: (ordinal - 1) % SPEAKER_COLOR_COUNT });
  }
  return { speakers, speakerIdByKey };
}

/* ---------------------------------------------------------------- αλλαγές */

/** Νέος τίτλος. Κενός τίτλος → το όνομα του αρχείου (ή κενός, αν δεν υπάρχει). */
export function setTitle(transcript, title, now) {
  return touch({ ...transcript, title: normalizeTitle(title, transcript.source.fileName) }, now);
}

export function renameSpeaker(transcript, speakerId, label, now) {
  const clean = cleanLabel(label);
  requireSpeaker(transcript, speakerId);
  return touch({
    ...transcript,
    speakers: transcript.speakers.map(s => (s.id === speakerId ? { ...s, label: clean } : s)),
  }, now);
}

/**
 * Προσθέτει νέο ομιλητή (π.χ. όταν ο χρήστης διορθώνει τμήμα που η μηχανή
 * απέδωσε λάθος). Επιστρέφει και το αναγνωριστικό του.
 */
export function addSpeaker(transcript, label, now) {
  const clean = cleanLabel(label);
  const used = new Set(transcript.speakers.map(s => s.id));
  let ordinal = transcript.speakers.length + 1;
  while (used.has(`S${ordinal}`)) ordinal += 1;
  const speaker = { id: `S${ordinal}`, label: clean, colorIndex: transcript.speakers.length % SPEAKER_COLOR_COUNT };
  return { transcript: touch({ ...transcript, speakers: [...transcript.speakers, speaker] }, now), speakerId: speaker.id };
}

/** Αλλάζει τον ομιλητή ενός τμήματος (null = χωρίς ομιλητή). */
export function assignSpeaker(transcript, segmentId, speakerId, now) {
  if (speakerId !== null) requireSpeaker(transcript, speakerId);
  return touch({
    ...transcript,
    segments: replaceSegment(transcript, segmentId, seg => ({ ...seg, speakerId })),
  }, now);
}

/**
 * Νέο κείμενο τμήματος. Οι χρόνοι ανά λέξη δεν ισχύουν πια για το νέο κείμενο
 * και αφαιρούνται (οι υπότιτλοι μοιράζουν τότε τον χρόνο αναλογικά).
 */
export function editSegmentText(transcript, segmentId, text, now) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return touch({
    ...transcript,
    segments: replaceSegment(transcript, segmentId, seg => {
      if (seg.text === clean) return seg;
      const { words, ...rest } = seg;
      return { ...rest, text: clean };
    }),
  }, now);
}

/** Προσθέτει περίληψη στην αρχή της λίστας (η πιο πρόσφατη πρώτη). */
export function addSummary(transcript, summary, now) {
  const copy = copySummary(summary);
  return touch({ ...transcript, summaries: [copy, ...transcript.summaries.filter(s => s.id !== copy.id)] }, now);
}

/** Αφαιρεί περίληψη. Άγνωστο αναγνωριστικό είναι λάθος, όπως στα τμήματα και τους ομιλητές. */
export function removeSummary(transcript, summaryId, now) {
  if (!transcript.summaries.some(s => s.id === summaryId)) throw new TranscriptRuleError(`άγνωστη περίληψη ${summaryId}`, TRANSCRIPT_RULES.UNKNOWN_SUMMARY);
  return touch({ ...transcript, summaries: transcript.summaries.filter(s => s.id !== summaryId) }, now);
}

/* ---------------------------------------------------------------- ερωτήματα */

/** Συνολικός χρόνος ομιλίας ανά ομιλητή σε δευτερόλεπτα (Map speakerId → s). */
export function speakerTalkTime(transcript) {
  const totals = new Map(transcript.speakers.map(s => [s.id, 0]));
  for (const seg of transcript.segments) {
    if (seg.speakerId == null) continue;
    totals.set(seg.speakerId, (totals.get(seg.speakerId) || 0) + Math.max(0, seg.end - seg.start));
  }
  return totals;
}

/** Η διάρκεια: του αρχείου αν είναι γνωστή, αλλιώς το τέλος του τελευταίου τμήματος. */
export function transcriptDuration(transcript) {
  if (transcript.source.durationSec != null) return transcript.source.durationSec;
  return transcript.segments.reduce((max, seg) => Math.max(max, seg.end), 0);
}

export function findSpeaker(transcript, speakerId) {
  return transcript.speakers.find(s => s.id === speakerId) || null;
}

export function findSummary(transcript, summaryId) {
  return transcript.summaries.find(s => s.id === summaryId) || null;
}

/**
 * Η θέση του τμήματος που παίζει τη στιγμή `timeSec` (δυαδική αναζήτηση), ή -1.
 * Ανάμεσα σε δύο τμήματα επιστρέφεται το προηγούμενο, ώστε η επισήμανση να μη
 * σβήνει σε μικρές παύσεις.
 */
export function segmentIndexAt(transcript, timeSec) {
  const segments = transcript.segments;
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= timeSec) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/* ---------------------------------------------------------------- βοηθητικά */

function touch(transcript, now) {
  requireText(now, 'now');
  const next = { ...transcript, updatedAt: now };
  assertConsistent(next);
  return next;
}

function replaceSegment(transcript, segmentId, change) {
  let found = false;
  const segments = transcript.segments.map(seg => {
    if (seg.id !== segmentId) return seg;
    found = true;
    return change(seg);
  });
  if (!found) throw new TranscriptRuleError(`άγνωστο τμήμα ${segmentId}`, TRANSCRIPT_RULES.UNKNOWN_SEGMENT);
  return segments;
}

function requireSpeaker(transcript, speakerId) {
  if (!transcript.speakers.some(s => s.id === speakerId)) throw new TranscriptRuleError(`άγνωστος ομιλητής ${speakerId}`, TRANSCRIPT_RULES.UNKNOWN_SPEAKER);
}

/** Όνομα ομιλητή με ένα κενό ανάμεσα στις λέξεις. Κενό όνομα δεν επιτρέπεται. */
function cleanLabel(label) {
  const clean = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new TranscriptRuleError('το όνομα ομιλητή δεν μπορεί να είναι κενό', TRANSCRIPT_RULES.EMPTY_SPEAKER_NAME);
  return clean;
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TranscriptRuleError(`λείπει το ${name}`);
}

function nonNegativeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeTitle(title, fileName) {
  const clean = String(title ?? '').replace(/\s+/g, ' ').trim();
  if (clean) return clean.slice(0, MAX_TITLE_LENGTH);
  const fromFile = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Χωρίς τίτλο και όνομα αρχείου ο τίτλος μένει κενός: το πώς θα φανεί το
  // αποφασίζει η διεπαφή (CA-009), όχι το μοντέλο.
  return fromFile.slice(0, MAX_TITLE_LENGTH);
}

function copySpeaker(s) {
  requireText(s.id, 'speaker.id');
  const label = String(s.label ?? '').trim() || s.id;
  const colorIndex = Number.isInteger(s.colorIndex) ? ((s.colorIndex % SPEAKER_COLOR_COUNT) + SPEAKER_COLOR_COUNT) % SPEAKER_COLOR_COUNT : 0;
  return { id: s.id, label, colorIndex };
}

function copySegment(seg) {
  requireText(seg.id, 'segment.id');
  const start = nonNegativeNumber(seg.start, 0);
  const end = Math.max(start, nonNegativeNumber(seg.end, start));
  const copy = { id: seg.id, start, end, speakerId: seg.speakerId ?? null, text: String(seg.text ?? '') };
  if (Array.isArray(seg.words) && seg.words.length) {
    copy.words = seg.words.map(w => {
      const ws = nonNegativeNumber(w.start, start);
      return { text: String(w.text ?? ''), start: ws, end: Math.max(ws, nonNegativeNumber(w.end, ws)) };
    });
  }
  return copy;
}

function copySummary(s) {
  requireText(s.id, 'summary.id');
  if (!Object.values(SUMMARY_KINDS).includes(s.kind)) throw new TranscriptRuleError(`άγνωστο είδος περίληψης ${s.kind}`);
  const copy = { id: s.id, kind: s.kind, model: String(s.model || ''), createdAt: String(s.createdAt || ''), text: String(s.text ?? '') };
  if (s.instruction) copy.instruction = String(s.instruction);
  if (s.truncated) copy.truncated = true;
  return copy;
}

function sortByStart(segments) {
  return segments
    .map((seg, index) => ({ seg, index }))
    .sort((a, b) => a.seg.start - b.seg.start || a.index - b.index)
    .map(x => x.seg);
}

function assertConsistent(transcript) {
  const speakerIds = new Set();
  for (const s of transcript.speakers) {
    if (speakerIds.has(s.id)) throw new TranscriptRuleError(`διπλός ομιλητής ${s.id}`);
    speakerIds.add(s.id);
  }
  const segmentIds = new Set();
  for (const seg of transcript.segments) {
    if (segmentIds.has(seg.id)) throw new TranscriptRuleError(`διπλό τμήμα ${seg.id}`);
    segmentIds.add(seg.id);
    if (seg.speakerId != null && !speakerIds.has(seg.speakerId)) throw new TranscriptRuleError(`το τμήμα ${seg.id} δείχνει σε άγνωστο ομιλητή ${seg.speakerId}`);
  }
}
