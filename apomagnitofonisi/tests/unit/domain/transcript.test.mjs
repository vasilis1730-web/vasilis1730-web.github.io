import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTranscript, speakersFromKeys, setTitle, renameSpeaker, addSpeaker, assignSpeaker, editSegmentText,
  addSummary, removeSummary, speakerTalkTime, transcriptDuration, segmentIndexAt, TranscriptRuleError,
  SPEAKER_COLOR_COUNT, TRANSCRIPT_RULES, MAX_TITLE_LENGTH, MAX_SPEAKER_LABEL_LENGTH, segmentSpeakerLabel,
} from '../../../src/domain/transcript.js';

const T0 = '2026-11-04T10:00:00.000Z';
const T1 = '2026-11-04T10:05:00.000Z';

function sample() {
  return createTranscript({
    id: 't1',
    title: '',
    createdAt: T0,
    source: { fileName: 'Σύσκεψη_Τεχνικής_Υπηρεσίας.m4a', mimeType: 'audio/mp4', sizeBytes: 1000, durationSec: 30 },
    languageCode: 'el',
    engine: { kind: 'elevenlabs', model: 'scribe_v2' },
    speakers: [{ id: 'S1', label: 'Ομιλητής 1', colorIndex: 0 }, { id: 'S2', label: 'Ομιλητής 2', colorIndex: 1 }],
    segments: [
      { id: 'seg-2', start: 10, end: 14, speakerId: 'S2', text: 'Συμφωνώ.' },
      { id: 'seg-1', start: 0, end: 9, speakerId: 'S1', text: 'Καλημέρα σε όλους.', words: [{ text: 'Καλημέρα', start: 0, end: 1 }] },
    ],
  });
}

test('η μεταγραφή ταξινομεί τα τμήματα και παίρνει τίτλο από το όνομα αρχείου χωρίς κάτω παύλες', () => {
  const t = sample();
  assert.deepEqual(t.segments.map(s => s.id), ['seg-1', 'seg-2']);
  assert.equal(t.title, 'Σύσκεψη Τεχνικής Υπηρεσίας');
  assert.equal(t.updatedAt, T0);
  assert.equal(t.schemaVersion, 1);
});

test('τμήμα με άγνωστο ομιλητή απορρίπτεται', () => {
  assert.throws(() => createTranscript({
    id: 'x', title: 'a', createdAt: T0, source: { fileName: 'a.mp3' }, engine: { kind: 'local', model: 'm' },
    segments: [{ id: 's', start: 0, end: 1, speakerId: 'S9', text: 'α' }],
  }), TranscriptRuleError);
});

test('οι αλλαγές επιστρέφουν νέο αντικείμενο και δεν αλλάζουν το αρχικό', () => {
  const t = sample();
  const snapshot = JSON.stringify(t);
  const renamed = renameSpeaker(t, 'S1', '  Πρόεδρος ', T1);
  assert.equal(renamed.speakers[0].label, 'Πρόεδρος');
  assert.equal(renamed.updatedAt, T1);
  const titled = setTitle(renamed, 'Δημοτικό Συμβούλιο', T1);
  assert.equal(titled.title, 'Δημοτικό Συμβούλιο');
  const reassigned = assignSpeaker(titled, 'seg-2', 'S1', T1);
  assert.equal(reassigned.segments[1].speakerId, 'S1');
  const edited = editSegmentText(reassigned, 'seg-1', 'Καλημέρα   σας.', T1);
  assert.equal(edited.segments[0].text, 'Καλημέρα σας.');
  assert.equal(edited.segments[0].words, undefined, 'οι χρόνοι ανά λέξη δεν ισχύουν πια');
  assert.equal(JSON.stringify(t), snapshot);
});

test('ίδιο κείμενο κρατά τους χρόνους ανά λέξη', () => {
  const t = sample();
  const same = editSegmentText(t, 'seg-1', 'Καλημέρα σε όλους.', T1);
  assert.equal(same.segments[0].words.length, 1);
});

test('κενό όνομα ομιλητή, άγνωστος ομιλητής ή τμήμα είναι λάθος', () => {
  const t = sample();
  assert.throws(() => renameSpeaker(t, 'S1', '   ', T1), TranscriptRuleError);
  assert.throws(() => assignSpeaker(t, 'seg-1', 'S7', T1), TranscriptRuleError);
  assert.throws(() => editSegmentText(t, 'nope', 'x', T1), TranscriptRuleError);
});

test('όρια μήκους: τίτλος και όνομα ομιλητή κόβονται στο όριο του μοντέλου', () => {
  const long = 'α'.repeat(500);
  assert.equal(setTitle(sample(), long, T1).title.length, MAX_TITLE_LENGTH);
  assert.equal(renameSpeaker(sample(), 'S1', long, T1).speakers[0].label.length, MAX_SPEAKER_LABEL_LENGTH);
  const { transcript, speakerId } = addSpeaker(sample(), `${'β'.repeat(MAX_SPEAKER_LABEL_LENGTH - 1)} γ`, T1);
  assert.equal(transcript.speakers.find(s => s.id === speakerId).label, 'β'.repeat(MAX_SPEAKER_LABEL_LENGTH - 1), 'χωρίς κενό στο τέλος μετά το κόψιμο');
});

test('νέος ομιλητής με μοναδικό αναγνωριστικό', () => {
  const { transcript, speakerId } = addSpeaker(sample(), 'Γραμματέας', T1);
  assert.equal(speakerId, 'S3');
  assert.equal(transcript.speakers.at(-1).label, 'Γραμματέας');
  assert.equal(assignSpeaker(transcript, 'seg-1', 'S3', T1).segments[0].speakerId, 'S3');
});

test('περιλήψεις: η πιο πρόσφατη πρώτη, χωρίς διπλότυπα, και αφαίρεση', () => {
  let t = sample();
  t = addSummary(t, { id: 'a', kind: 'brief', model: 'claude-opus-5-5', createdAt: T0, text: 'Α' }, T1);
  t = addSummary(t, { id: 'b', kind: 'minutes', model: 'claude-opus-5-5', createdAt: T1, text: 'Β', truncated: true }, T1);
  assert.deepEqual(t.summaries.map(s => s.id), ['b', 'a']);
  assert.equal(t.summaries[0].truncated, true);
  t = addSummary(t, { id: 'a', kind: 'brief', model: 'm', createdAt: T1, text: 'Α2' }, T1);
  assert.deepEqual(t.summaries.map(s => s.id), ['a', 'b']);
  assert.deepEqual(removeSummary(t, 'a', T1).summaries.map(s => s.id), ['b']);
  assert.throws(() => removeSummary(t, 'nope', T1), e => e instanceof TranscriptRuleError && e.rule === TRANSCRIPT_RULES.UNKNOWN_SUMMARY,
    'άγνωστη περίληψη: λάθος, όπως στα τμήματα και στους ομιλητές');
  assert.throws(() => addSummary(t, { id: 'c', kind: 'poem', model: 'm', createdAt: T1, text: '' }, T1), TranscriptRuleError);
});

test('χρόνος ομιλίας, διάρκεια, τμήμα σε χρόνο και κείμενο', () => {
  const t = sample();
  const talk = speakerTalkTime(t);
  assert.equal(talk.get('S1'), 9);
  assert.equal(talk.get('S2'), 4);
  assert.equal(transcriptDuration(t), 30);
  assert.equal(segmentIndexAt(t, -1), -1);
  assert.equal(segmentIndexAt(t, 0), 0);
  assert.equal(segmentIndexAt(t, 9.5), 0, 'στην παύση μένει το προηγούμενο');
  assert.equal(segmentIndexAt(t, 12), 1);
});

test('κανόνες με αιτία: κενό όνομα ομιλητή (του χρήστη) και άγνωστα αναγνωριστικά (του κώδικα)', () => {
  const t = sample();
  assert.throws(() => renameSpeaker(t, 'S1', '   ', T1), e => e.rule === TRANSCRIPT_RULES.EMPTY_SPEAKER_NAME);
  assert.throws(() => addSpeaker(t, '', T1), e => e.rule === TRANSCRIPT_RULES.EMPTY_SPEAKER_NAME);
  assert.throws(() => renameSpeaker(t, 'S9', 'x', T1), e => e.rule === TRANSCRIPT_RULES.UNKNOWN_SPEAKER);
  assert.throws(() => editSegmentText(t, 'nope', 'x', T1), e => e.rule === TRANSCRIPT_RULES.UNKNOWN_SEGMENT);
  const untitled = createTranscript({ id: 'u', title: ' ', createdAt: T0, source: { fileName: '' }, engine: { kind: 'local', model: 'm' } });
  assert.equal(untitled.title, '', 'χωρίς τίτλο και όνομα αρχείου ο τίτλος μένει κενός (τον δείχνει η διεπαφή)');
});

test('ομιλητές από κλειδιά μηχανής με τη σειρά που μιλούν', () => {
  const { speakers, speakerIdByKey } = speakersFromKeys(
    [{ speakerKey: 'speaker_1' }, { speakerKey: null }, { speakerKey: 'speaker_0' }, { speakerKey: 'speaker_1' }],
    n => `Ομιλητής ${n}`,
  );
  assert.deepEqual(speakers.map(s => [s.id, s.label, s.colorIndex]), [['S1', 'Ομιλητής 1', 0], ['S2', 'Ομιλητής 2', 1]]);
  assert.equal(speakerIdByKey.get('speaker_1'), 'S1');
  assert.equal(speakerIdByKey.get('speaker_0'), 'S2');
  const many = speakersFromKeys(Array.from({ length: 12 }, (_, i) => ({ speakerKey: `k${i}` })), n => `${n}`);
  assert.equal(many.speakers[SPEAKER_COLOR_COUNT].colorIndex, 0, 'τα χρώματα επαναλαμβάνονται κυκλικά');
});

test('segmentSpeakerLabel: ένας κανόνας για εξαγωγές και prompt (OO-020)', () => {
  const base = {
    id: 'x', title: 'Τ', createdAt: '2026-11-04T09:00:00.000Z',
    source: { fileName: 'a.mp3', mimeType: 'audio/mpeg', sizeBytes: 1, durationSec: 10 },
    languageCode: 'el', engine: { kind: 'local', model: 'm' },
  };
  const none = createTranscript({ ...base, speakers: [], segments: [{ id: 's1', start: 0, end: 1, speakerId: null, text: 'α' }] });
  assert.equal(segmentSpeakerLabel(none, none.segments[0], { unknown: '?' }), null, 'χωρίς ομιλητές: καμία ετικέτα');
  const some = createTranscript({
    ...base,
    speakers: [{ id: 'A', label: 'Πρόεδρος', colorIndex: 0 }],
    segments: [
      { id: 's1', start: 0, end: 1, speakerId: 'A', text: 'α' },
      { id: 's2', start: 1, end: 2, speakerId: null, text: 'β' },
    ],
  });
  assert.equal(segmentSpeakerLabel(some, some.segments[0], { unknown: '?' }), 'Πρόεδρος');
  assert.equal(segmentSpeakerLabel(some, some.segments[1], { unknown: '?' }), '?', 'τμήμα χωρίς ομιλητή σε μεταγραφή με ομιλητές');
});
