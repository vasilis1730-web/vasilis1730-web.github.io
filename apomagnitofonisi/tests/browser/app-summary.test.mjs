/**
 * Περίληψη και πρακτικά από άκρη σε άκρη, με ψεύτικο Anthropic API: εισαγωγή
 * μεταγραφής από .json, κλειδί και έλεγχος, σύνταξη πρακτικών με ροή κειμένου,
 * το αίτημα όπως πρέπει (μοντέλο, cache_control, εφεδρεία, κεφαλίδες browser),
 * αποθήκευση και εξαγωγή σε Word.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withSite } from './harness.mjs';
import { mockAnthropic, readStoredZip, dismissOnboarding } from './app-helpers.mjs';
import { createTranscript } from '../../src/domain/transcript.js';
import { serializeTranscript } from '../../src/domain/transcript-codec.js';

/** Το κλειδί όπως το στέλνει το SDK: X-Api-Key ή (από την έκδοση API 2026-10-21) Authorization: Bearer. */
function sentKey(headers) {
  if (headers['x-api-key']) return headers['x-api-key'];
  const match = /^Bearer (.+)$/.exec(headers.authorization || '');
  return match ? match[1] : null;
}

function transcriptFile() {
  const transcript = createTranscript({
    id: 'test-transcript', title: 'Συνεδρίαση επιτροπής', createdAt: '2026-11-04T09:00:00.000Z',
    source: { fileName: 'συνεδρίαση.m4a', mimeType: 'audio/mp4', sizeBytes: 1000, durationSec: 120 },
    languageCode: 'el', engine: { kind: 'elevenlabs', model: 'scribe_v2' },
    speakers: [{ id: 'S1', label: 'Πρόεδρος', colorIndex: 0 }, { id: 'S2', label: 'Μηχανικός', colorIndex: 1 }],
    segments: [
      { id: 'seg-1', start: 0, end: 5, speakerId: 'S1', text: 'Ξεκινάμε με την έγκριση της μελέτης για τα σχολεία.' },
      { id: 'seg-2', start: 6, end: 12, speakerId: 'S2', text: 'Η μελέτη είναι έτοιμη, θα την καταθέσω την Παρασκευή.' },
    ],
  });
  const text = serializeTranscript(transcript, { exportedAt: '2026-11-04T10:00:00.000Z', appVersion: '1.0.0' });
  return { name: 'Συνεδρίαση επιτροπής.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') };
}

test('Claude: πρακτικά με ροή κειμένου, αποθήκευση και Word', { timeout: 180_000 }, async () => {
  const json = transcriptFile();
  const result = await withSite(async ({ page, base }) => {
    const calls = await mockAnthropic(page, base, { chunks: ['## Αποφάσεις\n', '- Εγκρίνεται η μελέτη.\n\n', '## Εκκρεμότητες\n', '| Ποιος | Τι | Πότε |\n|---|---|---|\n| Μηχανικός | Κατάθεση μελέτης | Παρασκευή |\n'] });
    await page.goto(`${base}/#/settings`);
    await dismissOnboarding(page);
    await page.getByLabel('Κλειδί Anthropic (Claude)').fill('test-anthropic-key');
    await page.getByRole('button', { name: 'Αποθήκευση' }).nth(1).click();
    await page.getByText('Αποθηκευμένο κλειδί που τελειώνει σε …-key').nth(0).waitFor();
    await page.getByRole('button', { name: 'Έλεγχος κλειδιού' }).nth(1).click();
    await page.getByText('Το κλειδί είναι έγκυρο.').waitFor();
    assert.equal(calls[0].path, '/v1/models');
    assert.equal(sentKey(calls[0].headers), 'test-anthropic-key');

    await page.goto(`${base}/#/history`);
    await page.setInputFiles('#import-json', json);
    await page.getByRole('link', { name: 'Συνεδρίαση επιτροπής' }).first().click();
    await page.getByRole('link', { name: 'Περίληψη και πρακτικά' }).click();
    await page.getByLabel('Πρακτικά συνεδρίασης').check();
    await page.getByText(/Εκτιμώμενο κόστος: περίπου/).waitFor();
    await page.getByRole('button', { name: 'Σύνταξη' }).click();
    await page.locator('.summary-output h3', { hasText: 'Αποφάσεις' }).waitFor();
    await page.locator('.summary-output td', { hasText: 'Κατάθεση μελέτης' }).waitFor();

    const request = calls.find(c => c.path === '/v1/messages');
    assert.equal(sentKey(request.headers), 'test-anthropic-key');
    assert.equal(request.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.match(request.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(request.json.model, 'claude-opus-5-5');
    assert.equal(request.json.stream, true);
    assert.equal(request.json.fallbacks, 'default');
    assert.deepEqual(request.json.output_config, { effort: 'medium' });
    assert.deepEqual(request.json.messages[0].content[0].cache_control, { type: 'ephemeral' });
    assert.match(request.json.messages[0].content[0].text, /\[00:00:06\] Μηχανικός: Η μελέτη είναι έτοιμη/);
    assert.match(request.json.messages[0].content[1].text, /πρακτικά συνεδρίασης/);
    for (const field of ['thinking', 'temperature', 'top_p', 'top_k']) assert.equal(field in request.json, false, field);

    const saved = page.locator('.saved-summary').first();
    await saved.locator('summary').click();
    const [download] = await Promise.all([page.waitForEvent('download'), saved.getByRole('button', { name: 'Word (.docx)' }).click()]);
    assert.equal(download.suggestedFilename(), 'Συνεδρίαση επιτροπής Πρακτικά.docx');
    const document = readStoredZip(fs.readFileSync(await download.path())).get('word/document.xml');
    assert.match(document, /Πρακτικά συνεδρίασης: Συνεδρίαση επιτροπής/);
    assert.match(document, /<w:tbl>/);
  }, { serviceWorkers: 'block' });
  assert.deepEqual(result.violations, [], 'καμία παραβίαση CSP');
  assert.deepEqual(result.errors, [], 'κανένα σφάλμα στη σελίδα');
});
