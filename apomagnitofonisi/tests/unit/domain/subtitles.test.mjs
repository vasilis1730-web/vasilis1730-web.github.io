import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubtitleCues, wrapLines } from '../../../src/domain/subtitles.js';

test('οι λέξεις μοιράζονται σε υπότιτλους με όρια χαρακτήρων και διάρκειας', () => {
  const words = [];
  for (let i = 0; i < 40; i++) words.push({ text: `λέξη${i}`, start: i * 0.5, end: i * 0.5 + 0.4 });
  const cues = buildSubtitleCues([{ id: 's', start: 0, end: 20, speakerId: 'S1', text: '', words }]);
  assert.ok(cues.length > 1);
  for (const cue of cues) {
    assert.ok(cue.lines.length <= 2);
    for (const line of cue.lines) assert.ok(line.length <= 42, line);
    assert.ok(cue.end - cue.start <= 7.0001);
    assert.equal(cue.speakerId, 'S1');
  }
  assert.deepEqual(cues.map(c => c.index), cues.map((_, i) => i + 1));
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end, 'χωρίς επικάλυψη');
});

test('χωρίς χρόνους ανά λέξη ο χρόνος μοιράζεται αναλογικά και οι υπότιτλοι δεν περνούν σε άλλον ομιλητή', () => {
  const cues = buildSubtitleCues([
    { id: 'a', start: 0, end: 4, speakerId: 'S1', text: 'Καλημέρα σε όλους. Ξεκινάμε τη συνεδρίαση με το πρώτο θέμα της ημερήσιας διάταξης.' },
    { id: 'b', start: 4.2, end: 5, speakerId: 'S2', text: 'Συμφωνώ.' },
  ]);
  assert.equal(cues[0].start, 0);
  const last = cues[cues.length - 1];
  assert.equal(last.speakerId, 'S2');
  assert.deepEqual(last.lines, ['Συμφωνώ.']);
  assert.ok(Math.abs(cues.filter(c => c.speakerId === 'S1').at(-1).end - 4) < 1e-9);
});

test('ελάχιστη διάρκεια χωρίς να καλύπτεται ο επόμενος', () => {
  const cues = buildSubtitleCues([
    { id: 'a', start: 0, end: 0.2, speakerId: null, text: 'Ναι.' },
    { id: 'b', start: 0.5, end: 2, speakerId: null, text: 'Όχι.' },
    { id: 'c', start: 10, end: 10.1, speakerId: null, text: 'Τέλος.' },
  ]);
  assert.equal(cues[0].end, 0.5);
  assert.equal(cues[2].end, 11);
});

test('τμήμα χωρίς κείμενο δεν βγάζει υπότιτλο', () => {
  assert.deepEqual(buildSubtitleCues([{ id: 'a', start: 0, end: 1, speakerId: null, text: '   ' }]), []);
});

test('ισορροπημένο σπάσιμο σε δύο γραμμές', () => {
  assert.deepEqual(wrapLines('ένα δύο τρία τέσσερα πέντε έξι επτά οκτώ εννέα δέκα έντεκα', { maxCharsPerLine: 42, maxLines: 2 }),
    ['ένα δύο τρία τέσσερα πέντε έξι', 'επτά οκτώ εννέα δέκα έντεκα']);
  assert.deepEqual(wrapLines('σύντομο', { maxCharsPerLine: 42, maxLines: 2 }), ['σύντομο']);
  assert.deepEqual(wrapLines('α β γ δ', { maxCharsPerLine: 3, maxLines: 3 }), ['α β', 'γ δ']);
});
