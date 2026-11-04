import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline, runsToText } from '../../../src/domain/markdown.js';

test('επικεφαλίδες, παράγραφοι, λίστες, πίνακες και γραμμές', () => {
  const blocks = parseMarkdown([
    '# Πρακτικά συνεδρίασης',
    '',
    'Η συνεδρίαση ξεκίνησε',
    'στις **10:00**.',
    '',
    '## Αποφάσεις',
    '- Εγκρίνεται η μελέτη.',
    '- Ορίζεται *επιτροπή*',
    '  παραλαβής.',
    '1. Πρώτο',
    '2) Δεύτερο',
    '---',
    '| Ποιος | Τι | Πότε |',
    '|---|:---:|---|',
    '| Γραμματέας | Πρόσκληση | 10/11 |',
  ].join('\n'));
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'paragraph', 'heading', 'list', 'list', 'rule', 'table']);
  assert.equal(blocks[0].level, 1);
  assert.equal(runsToText(blocks[1].runs), 'Η συνεδρίαση ξεκίνησε στις 10:00.');
  assert.deepEqual(blocks[1].runs.find(r => r.bold), { text: '10:00', bold: true });
  assert.equal(blocks[3].ordered, false);
  assert.equal(runsToText(blocks[3].items[1]), 'Ορίζεται επιτροπή παραλαβής.');
  assert.equal(blocks[4].ordered, true);
  assert.equal(blocks[4].items.length, 2);
  assert.equal(runsToText(blocks[6].header[0]), 'Ποιος');
  assert.equal(runsToText(blocks[6].rows[0][2]), '10/11');
});

test('inline: έντονα, πλάγια, κώδικας, σύνδεσμοι και HTML ως απλό κείμενο', () => {
  assert.deepEqual(parseInline('α **β** *γ* `δ` [ε](https://x.gr) <b>ζ</b>'), [
    { text: 'α ' }, { text: 'β', bold: true }, { text: ' ' }, { text: 'γ', italic: true },
    { text: ' δ ε (https://x.gr) <b>ζ</b>' },
  ]);
  assert.deepEqual(parseInline('2 * 3 * 4'), [{ text: '2 * 3 * 4' }]);
  assert.deepEqual(parseMarkdown(''), []);
});
