import test from 'node:test';
import assert from 'node:assert/strict';
import { groupTokensIntoSegments } from '../../../src/domain/words-to-segments.js';

const w = (text, start, end, speakerKey = 's0', kind = 'word') => ({ text, start, end, speakerKey, kind });

test('νέο τμήμα σε αλλαγή ομιλητή και σε παύση', () => {
  const segments = groupTokensIntoSegments([
    w('Καλημέρα', 0, 0.5), w('σας.', 0.6, 0.9),
    w('Καλημέρα.', 1.0, 1.4, 's1'),
    w('Ξεκινάμε', 4.0, 4.5, 's1'), w('τώρα.', 4.6, 5, 's1'),
  ]);
  assert.deepEqual(segments.map(s => [s.speakerKey, s.text]), [
    ['s0', 'Καλημέρα σας.'], ['s1', 'Καλημέρα.'], ['s1', 'Ξεκινάμε τώρα.'],
  ]);
  assert.equal(segments[0].words.length, 2);
  assert.equal(segments[2].start, 4);
  assert.equal(segments[2].end, 5);
});

test('μέγιστη διάρκεια και φυσικό όριο πρότασης', () => {
  const tokens = [];
  for (let i = 0; i < 80; i++) tokens.push(w(i === 39 ? 'τέλος.' : `λ${i}`, i * 0.5, i * 0.5 + 0.4));
  const segments = groupTokensIntoSegments(tokens);
  assert.ok(segments.length >= 2);
  for (const s of segments) assert.ok(s.end - s.start <= 30);
  assert.ok(segments[0].text.endsWith('τέλος.'), 'κόβει στο τέλος της πρότασης μετά τα 15 s');
});

test('ηχητικά συμβάντα μένουν στο τμήμα και κενά tokens αγνοούνται', () => {
  const segments = groupTokensIntoSegments([
    w('Ναι', 0, 0.3), w(' ', 0.3, 0.35), w('[γέλια]', 0.4, 1, null, 'event'), w('σωστά.', 1.1, 1.5),
  ]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, 'Ναι [γέλια] σωστά.');
  assert.equal(segments[0].speakerKey, 's0');
});

test('τμήμα που ξεκινά με συμβάν παίρνει τον ομιλητή της πρώτης λέξης', () => {
  const segments = groupTokensIntoSegments([w('[χειροκροτήματα]', 0, 1, null, 'event'), w('Ευχαριστώ.', 1.1, 1.6, 's3')]);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].speakerKey, 's3');
});
