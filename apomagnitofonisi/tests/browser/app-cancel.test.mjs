/**
 * «Ακύρωση» όσο τρέχει μεταγραφή στο ElevenLabs, σε πραγματικό Chromium
 * (OO-001): η πρόοδος (ανάγνωση, αποστολή με ποσοστό και bytes) αλλάζει τη
 * σελίδα επί τόπου, άρα το κουμπί «Ακύρωση» μένει το ίδιο στοιχείο και το
 * κλικ πιάνει. Μετά την ακύρωση η σελίδα το λέει, το κουμπί γίνεται «Νέα
 * μεταγραφή» και δεν αποθηκεύεται τίποτα, ακόμη κι αν ο πάροχος απαντήσει αργότερα.
 *
 * Το ψεύτικο ElevenLabs κρατά την απάντηση μέχρι να πατηθεί η «Ακύρωση». Με το
 * page.route ο Chromium δεν δίνει πρόοδο αποστολής πριν από την απάντηση, άρα
 * η σελίδα μένει στο στάδιο «Αποστολή στο ElevenLabs».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withSite } from './harness.mjs';
import { mockElevenLabs, toneWavFile, dismissOnboarding } from './app-helpers.mjs';

const words = [{ text: 'Καλημέρα.', type: 'word', start: 0.1, end: 0.6, speaker_id: 'speaker_0' }];

test('ElevenLabs: «Ακύρωση» την ώρα της μεταγραφής, χωρίς αποθήκευση', { timeout: 120_000 }, async () => {
  let releaseReply;
  const replyHeld = new Promise(resolve => { releaseReply = resolve; });
  let requestArrived;
  const arrived = new Promise(resolve => { requestArrived = resolve; });
  try {
    const result = await withSite(async ({ page, base }) => {
      const calls = await mockElevenLabs(page, base, { words, beforeTranscribe: async () => { requestArrived(); await replyHeld; } });
      await page.goto(`${base}/#/settings`);
      await dismissOnboarding(page);
      await page.getByLabel('Κλειδί ElevenLabs').fill('test-elevenlabs-key');
      await page.getByRole('button', { name: 'Αποθήκευση' }).first().click();
      await page.getByText('Αποθηκευμένο κλειδί που τελειώνει σε …-key').waitFor();

      await page.goto(`${base}/#/`);
      // 30 δευτερόλεπτα (περίπου 1 MB), ώστε η αποστολή να δίνει πρόοδο.
      await page.setInputFiles('#media-file', toneWavFile('Ακύρωση δοκιμής.wav', 30));
      await page.getByText('Ακύρωση δοκιμής.wav').waitFor();
      await page.getByLabel(/ElevenLabs \(ακριβέστερο/).check();
      await page.getByRole('button', { name: 'Έναρξη' }).click();
      await page.waitForURL(/#\/progress$/);

      // Το κουμπί όπως ήταν στην αρχή, πριν από όλες τις ενημερώσεις προόδου.
      const cancel = await page.getByRole('button', { name: 'Ακύρωση' }).elementHandle();
      await arrived;
      await page.locator('.stages li.active .stage-name', { hasText: 'Αποστολή στο ElevenLabs' }).waitFor();
      await page.locator('.stages li.active .meta', { hasText: /^0% \(0 B \/ / }).waitFor();
      assert.equal(await page.locator('.stages li.done', { hasText: 'Ανάγνωση αρχείου' }).count(), 1, 'η ανάγνωση φάνηκε και τελείωσε');
      assert.equal(await cancel.evaluate(button => button.isConnected), true, 'το ίδιο κουμπί μετά από κάθε ενημέρωση');

      await cancel.click();
      await page.getByRole('heading', { level: 1, name: 'Η μεταγραφή ακυρώθηκε' }).waitFor();
      assert.equal(await cancel.evaluate(button => button.isConnected && button.textContent), 'Νέα μεταγραφή', 'το ίδιο κουμπί, με νέα ενέργεια');
      assert.equal(await page.getByRole('alert').count(), 0, 'η ακύρωση δεν είναι σφάλμα');
      assert.equal(calls.filter(c => c.path === '/v1/speech-to-text').length, 1);

      // Ο πάροχος «απαντά» μετά την ακύρωση: η σελίδα έχει ήδη εγκαταλείψει το αίτημα.
      releaseReply();
      await page.goto(`${base}/#/history`);
      await page.getByText('Δεν υπάρχουν αποθηκευμένες μεταγραφές.').waitFor();
    }, { serviceWorkers: 'block' });
    assert.deepEqual(result.violations, [], 'καμία παραβίαση CSP');
    assert.deepEqual(result.errors, [], 'κανένα σφάλμα στη σελίδα');
  } finally {
    releaseReply();
  }
});
