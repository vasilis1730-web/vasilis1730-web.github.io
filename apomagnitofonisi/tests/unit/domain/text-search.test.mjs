import test from 'node:test';
import assert from 'node:assert/strict';
import { foldForSearch, findMatches, matchesQuery } from '../../../src/domain/text-search.js';
import { endsSentence, stripAccents } from '../../../src/domain/text-normalize.js';

test('αναζήτηση χωρίς τόνους και κεφαλαία, με θέσεις στο αρχικό κείμενο', () => {
  const text = 'Η Συνεδρίαση ξεκίνησε. Η συνεδριάση τελείωσε.';
  assert.equal(foldForSearch(text).length, text.length, 'ίδιο μήκος, ώστε οι θέσεις να ταιριάζουν');
  const matches = findMatches(text, 'ΣΥΝΕΔΡΙΑΣΗ');
  assert.deepEqual(matches.map(m => text.slice(m.start, m.end)), ['Συνεδρίαση', 'συνεδριάση']);
  assert.deepEqual(findMatches(text, '   '), []);
  assert.equal(matchesQuery(text, 'ξεκινησε'), true);
  assert.equal(matchesQuery(text, 'αναβολή'), false);
  assert.equal(matchesQuery(text, ''), true);
  assert.deepEqual(findMatches('έργος και έργοσ', 'εργος').length, 2, 'το τελικό ς ταιριάζει με σ');
  const emoji = 'α 👍 β';
  assert.deepEqual(findMatches(emoji, 'β').map(m => emoji.slice(m.start, m.end)), ['β']);
});

test('τέλος πρότασης και τόνοι', () => {
  assert.equal(endsSentence('τέλος.'), true);
  assert.equal(endsSentence('ναι;'), true);
  assert.equal(endsSentence('«τέλος.»'), true);
  assert.equal(endsSentence('συνεχίζει'), false);
  assert.equal(stripAccents('Ελλάδα, Ϊ'), 'Ελλαδα, Ι');
});
