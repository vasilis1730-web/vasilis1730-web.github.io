import test from 'node:test';
import assert from 'node:assert/strict';
import { toSafeFileName } from '../../../src/domain/file-naming.js';

const options = { fallback: 'Μεταγραφή χωρίς τίτλο' };

test('ονόματα αρχείων με κενά, χωρίς κάτω παύλες ή απαγορευμένους χαρακτήρες', () => {
  assert.equal(toSafeFileName('Σύσκεψη 4-11-2026', 'docx', options), 'Σύσκεψη 4-11-2026.docx');
  assert.equal(toSafeFileName('Μελέτη_Προμήθειας_Κλιματιστικών 2026', '.DOCX', options), 'Μελέτη Προμήθειας Κλιματιστικών 2026.docx');
  assert.equal(toSafeFileName('Θέμα: «Έργα»/Ρόδος?', 'srt', options), 'Θέμα «Έργα» Ρόδος.srt');
  assert.equal(toSafeFileName('   ...  ', 'txt', options), 'Μεταγραφή χωρίς τίτλο.txt', 'κενός τίτλος: το όνομα του καλούντος');
  assert.throws(() => toSafeFileName('', 'txt', { fallback: ' _ ' }), TypeError, 'χωρίς κανένα όνομα: λάθος του κώδικα');
  assert.equal(toSafeFileName('CON', 'txt', options), 'CON 1.txt');
  assert.equal(Array.from(toSafeFileName('α'.repeat(300), 'vtt', options).replace(/\.vtt$/, '')).length, 120);
  assert.doesNotMatch(toSafeFileName('a_b__c', 'json', options), /_/);
});
