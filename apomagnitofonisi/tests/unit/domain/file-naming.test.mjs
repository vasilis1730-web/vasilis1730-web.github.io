import test from 'node:test';
import assert from 'node:assert/strict';
import { toSafeFileName } from '../../../src/domain/file-naming.js';

test('ονόματα αρχείων με κενά, χωρίς κάτω παύλες ή απαγορευμένους χαρακτήρες', () => {
  assert.equal(toSafeFileName('Σύσκεψη 4-11-2026', 'docx'), 'Σύσκεψη 4-11-2026.docx');
  assert.equal(toSafeFileName('Μελέτη_Προμήθειας_Κλιματιστικών 2026', '.DOCX'), 'Μελέτη Προμήθειας Κλιματιστικών 2026.docx');
  assert.equal(toSafeFileName('Θέμα: «Έργα»/Ρόδος?', 'srt'), 'Θέμα «Έργα» Ρόδος.srt');
  assert.equal(toSafeFileName('   ...  ', 'txt'), 'Απομαγνητοφώνηση.txt');
  assert.equal(toSafeFileName('CON', 'txt'), 'CON 1.txt');
  assert.equal(Array.from(toSafeFileName('α'.repeat(300), 'vtt').replace(/\.vtt$/, '')).length, 120);
  assert.doesNotMatch(toSafeFileName('a_b__c', 'json'), /_/);
});
