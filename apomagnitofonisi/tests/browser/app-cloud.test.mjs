/**
 * Ροή cloud από άκρη σε άκρη σε πραγματικό Chromium, με ψεύτικο ElevenLabs:
 * κλειδί και έλεγχος στις Ρυθμίσεις, αρχείο, μεταγραφή με δύο ομιλητές,
 * μετονομασία ομιλητή, διόρθωση κειμένου που μένει μετά από ανανέωση,
 * εξαγωγή σε Word και υπότιτλους, ιστορικό και διαγραφή.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withSite } from './harness.mjs';
import { mockElevenLabs, toneWavFile, readStoredZip, dismissOnboarding, waitForStoredText } from './app-helpers.mjs';

const words = [
  { text: 'Καλημέρα', type: 'word', start: 0.1, end: 0.5, speaker_id: 'speaker_0' },
  { text: ' ', type: 'spacing', start: 0.5, end: 0.55, speaker_id: 'speaker_0' },
  { text: 'σε', type: 'word', start: 0.55, end: 0.7, speaker_id: 'speaker_0' },
  { text: 'όλους.', type: 'word', start: 0.7, end: 1.0, speaker_id: 'speaker_0' },
  { text: 'Συμφωνώ.', type: 'word', start: 1.2, end: 1.8, speaker_id: 'speaker_1' },
];

test('ElevenLabs: από το αρχείο στο Word, με ομιλητές και διορθώσεις', { timeout: 180_000 }, async () => {
  const media = toneWavFile('Σύσκεψη δοκιμής.wav');
  const result = await withSite(async ({ page, base }) => {
    const calls = await mockElevenLabs(page, base, { words });
    await page.goto(`${base}/#/settings`);
    await dismissOnboarding(page);
    await page.getByLabel('Κλειδί ElevenLabs').fill('test-elevenlabs-key');
    await page.getByRole('button', { name: 'Αποθήκευση' }).first().click();
    await page.getByText('Αποθηκευμένο κλειδί που τελειώνει σε …-key').waitFor();
    await page.getByRole('button', { name: 'Έλεγχος κλειδιού' }).first().click();
    await page.getByText('Το κλειδί είναι έγκυρο.').waitFor();
    assert.equal(calls[0].path, '/v1/user');
    assert.equal(calls[0].headers['xi-api-key'], 'test-elevenlabs-key');

    await page.goto(`${base}/#/`);
    await dismissOnboarding(page);
    await page.setInputFiles('#media-file', media);
    await page.getByText('Σύσκεψη δοκιμής.wav').waitFor();
    await page.getByLabel(/ElevenLabs \(ακριβέστερο/).check();
    await page.getByRole('button', { name: 'Έναρξη' }).click();
    await page.waitForURL(/#\/t\//, { timeout: 60_000 });

    const upload = calls.find(c => c.path === '/v1/speech-to-text');
    assert.equal(upload.method, 'POST');
    assert.equal(upload.headers['xi-api-key'], 'test-elevenlabs-key');
    const body = upload.body.toString('latin1');
    for (const [name, value] of [['model_id', 'scribe_v2'], ['language_code', 'el'], ['diarize', 'true'], ['timestamps_granularity', 'word'], ['tag_audio_events', 'true']]) {
      assert.match(body, new RegExp(`name="${name}"\\r\\n\\r\\n${value}\\r\\n`), name);
    }

    await page.getByRole('heading', { level: 1, name: 'Σύσκεψη δοκιμής' }).waitFor();
    const rows = await page.locator('.segment').allInnerTexts();
    assert.equal(rows.length, 2);
    assert.match(rows[0], /Ομιλητής 1[\s\S]*Καλημέρα σε όλους\./);
    assert.match(rows[1], /Ομιλητής 2[\s\S]*Συμφωνώ\./);

    const first = page.getByLabel('Όνομα ομιλητή Ομιλητής 1');
    await first.fill('Πρόεδρος');
    await first.press('Tab');
    await page.locator('.speaker-chip', { hasText: 'Πρόεδρος' }).waitFor();

    const text = page.locator('.segment .text').nth(1);
    await text.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Εγκρίνεται.');
    await page.keyboard.press('Enter');
    await waitForStoredText(page, 'Συμφωνώ. Εγκρίνεται.');
    await page.reload();
    await page.locator('.segment .text', { hasText: 'Συμφωνώ. Εγκρίνεται.' }).waitFor();

    await page.getByText('Εξαγωγή', { exact: true }).click();
    const [docx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word (.docx)' }).click()]);
    assert.equal(docx.suggestedFilename(), 'Σύσκεψη δοκιμής.docx');
    const parts = readStoredZip(fs.readFileSync(await docx.path()));
    assert.match(parts.get('word/document.xml'), /Πρόεδρος: /);
    assert.match(parts.get('word/document.xml'), /Συμφωνώ\. Εγκρίνεται\./);

    await page.getByText('Εξαγωγή', { exact: true }).click();
    const [srt] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Υπότιτλοι (.srt)' }).click()]);
    assert.equal(srt.suggestedFilename(), 'Σύσκεψη δοκιμής.srt');
    assert.match(fs.readFileSync(await srt.path(), 'utf8'), /^1\r\n00:00:00,100 --> /);

    await page.goto(`${base}/#/history`);
    await page.getByRole('link', { name: 'Σύσκεψη δοκιμής' }).first().waitFor();
    await page.getByRole('button', { name: 'Διαγραφή όλων' }).click();
    await page.locator('dialog').getByRole('button', { name: 'Διαγραφή όλων' }).click();
    await page.getByText('Δεν υπάρχουν αποθηκευμένες μεταγραφές.').waitFor();
  }, { serviceWorkers: 'block' });
  assert.deepEqual(result.violations, [], 'καμία παραβίαση CSP');
  assert.deepEqual(result.errors, [], 'κανένα σφάλμα στη σελίδα');
});
