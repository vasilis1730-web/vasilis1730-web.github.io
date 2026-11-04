import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeRecognizedText, normalizeWhitespace, collapseRepetitions, isLikelyHallucination, replaceAnoTeleia, hasVerb,
} from '../../../src/domain/text-normalize.js';

const ANO = String.fromCharCode(0x387);
const MID = String.fromCharCode(0xb7);

test('κενά και στίξη', () => {
  assert.equal(normalizeWhitespace('  Καλημέρα ,  τι   κάνετε ; '), 'Καλημέρα, τι κάνετε;');
  assert.equal(normalizeWhitespace('« Ναι »'), '«Ναι»');
});

test('βρόχοι επανάληψης του Whisper', () => {
  assert.equal(collapseRepetitions('και και και και και τότε'), 'και τότε');
  assert.equal(collapseRepetitions('Ευχαριστώ. Ευχαριστώ. Ευχαριστώ. Ευχαριστώ. Ευχαριστώ.'), 'Ευχαριστώ.');
  assert.equal(collapseRepetitions('ήταν πολύ πολύ καλό'), 'ήταν πολύ πολύ καλό');
  assert.equal(collapseRepetitions('το έργο θα το έργο θα το έργο θα το έργο θα τελειώσει'), 'το έργο θα τελειώσει');
});

test('γνωστές παραισθήσεις σε σιωπή', () => {
  assert.equal(isLikelyHallucination('Υπότιτλοι AUTHORWAVE'), true);
  assert.equal(isLikelyHallucination('Υπότιτλοι από την κοινότητα Amara.org'), true);
  assert.equal(isLikelyHallucination('Ευχαριστώ για την παρακολούθηση!'), true);
  assert.equal(isLikelyHallucination('♪ ♪'), true);
  assert.equal(isLikelyHallucination(''), true);
  assert.equal(isLikelyHallucination('Ευχαριστώ για την παρακολούθηση του έργου από την υπηρεσία.'), false);
  assert.equal(isLikelyHallucination('Καλημέρα σας.'), false);
});

test('άνω τελεία: τελεία ανάμεσα σε ανεξάρτητες προτάσεις, αλλιώς κόμμα', () => {
  assert.equal(replaceAnoTeleia(`Η σύμβαση υπογράφηκε${ANO} οι εργασίες ξεκινούν αύριο.`), 'Η σύμβαση υπογράφηκε. Οι εργασίες ξεκινούν αύριο.');
  assert.equal(replaceAnoTeleia(`Παρόντες${ANO} ο Πρόεδρος, η Γραμματέας`), 'Παρόντες, ο Πρόεδρος, η Γραμματέας');
  assert.equal(replaceAnoTeleia(`Τρία θέματα${MID} τέλος${ANO}`), 'Τρία θέματα, τέλος.');
  assert.equal(replaceAnoTeleia('Χωρίς τίποτα.'), 'Χωρίς τίποτα.');
});

test('ευρετικός έλεγχος ρήματος', () => {
  assert.equal(hasVerb('οι εργασίες ξεκινούν'), true);
  assert.equal(hasVerb('θα δούμε'), true);
  assert.equal(hasVerb('ο Πρόεδρος, η Γραμματέας'), false);
  assert.equal(hasVerb('μέσω της υπηρεσίας'), false);
});

test('πλήρης κανονικοποίηση', () => {
  assert.equal(normalizeRecognizedText(` ναι ναι ναι ναι εντάξει${ANO} προχωράμε `), `ναι εντάξει${ANO} προχωράμε`);
  assert.equal(normalizeRecognizedText(` ναι ναι ναι ναι εντάξει${ANO} προχωράμε `, { removeAnoTeleia: true }), 'ναι εντάξει, προχωράμε');
});
