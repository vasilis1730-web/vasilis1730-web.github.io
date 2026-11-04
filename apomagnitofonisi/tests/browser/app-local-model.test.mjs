/**
 * Πραγματική μεταγραφή στη συσκευή (Whisper base, WASM) πάνω σε ελληνική
 * ομιλία, χωρίς και με διαχωρισμό ομιλητών. Κατεβάζει ~77 MB μοντέλο
 * μεταγραφής και ~27 MB μοντέλο φωνής και θέλει τα αρχεία του
 * tests/fixtures/generate.sh, γι' αυτό τρέχει μόνο με APOMAGN_REAL_MODELS=1.
 *
 * Το Whisper base γράφει τα ελληνικά με λάθη (π.χ. «ενεδρίας» αντί για
 * «συνεδρίασης»), οπότε ο έλεγχος ζητά τουλάχιστον τρεις από πέντε λέξεις της
 * ηχογράφησης, χωρίς τόνους και πεζά-κεφαλαία, και όχι μία συγκεκριμένη.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSite } from './harness.mjs';
import { dismissOnboarding } from './app-helpers.mjs';

const fixture = name => fileURLToPath(new URL(`../fixtures/generated/${name}`, import.meta.url));
const SAMPLE = fixture('greek.mp3');
const TWO_VOICES = fixture('two-voices.wav');
const enabled = process.env.APOMAGN_REAL_MODELS === '1' && fs.existsSync(SAMPLE) && fs.existsSync(TWO_VOICES);

/** Λέξεις της ηχογράφησης (tests/fixtures/generate.sh), χωρίς τόνους. */
const SPOKEN_WORDS = ['καλημερα', 'τεχνικης', 'υπηρεσιας', 'συντηρηση', 'σχολικων'];
const MIN_RECOGNIZED = 3;

const fold = text => text.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
const recognizedWords = text => SPOKEN_WORDS.filter(word => fold(text).includes(word));

/** Αρχείο, επιλογές (που φαίνονται μόλις διαλεχτεί αρχείο), έναρξη, και το κείμενο της μεταγραφής. */
async function transcribe(page, file, { beforeStart } = {}) {
  await page.setInputFiles('#media-file', file);
  await page.getByText(path.basename(file)).waitFor();
  if (beforeStart) await beforeStart();
  await page.getByRole('button', { name: 'Έναρξη' }).click();
  await page.waitForURL(/#\/t\//, { timeout: 840_000 });
  await page.locator('.segment').first().waitFor();
  return (await page.locator('.segment .text').allInnerTexts()).join(' ');
}

test('Whisper στη συσκευή: ελληνικό κείμενο από πραγματική ομιλία, χωρίς και με διαχωρισμό ομιλητών', { skip: !enabled && 'APOMAGN_REAL_MODELS=1 και tests/fixtures/generate.sh', timeout: 900_000 }, async () => {
  const result = await withSite(async ({ page, base }) => {
    await page.goto(`${base}/`);
    await dismissOnboarding(page);

    const plain = await transcribe(page, SAMPLE);
    const found = recognizedWords(plain);
    assert.ok(found.length >= MIN_RECOGNIZED, `αναγνωρίστηκαν ${found.length}/${SPOKEN_WORDS.length} λέξεις (${found.join(', ')}) στο «${plain}»`);
    assert.equal(await page.locator('.segment .speaker-chip').count(), 0, 'χωρίς διαχωρισμό, κανένα τμήμα δεν έχει ομιλητή');

    await page.goto(`${base}/#/`);
    const separated = await transcribe(page, TWO_VOICES, {
      beforeStart: async () => {
        await page.getByLabel('Διαχωρισμός ομιλητών').click();
        await page.getByLabel('Αριθμός ομιλητών').waitFor();
        assert.equal(await page.getByLabel('Διαχωρισμός ομιλητών').isChecked(), true);
      },
    });
    assert.ok(recognizedWords(separated).length >= MIN_RECOGNIZED, `κείμενο με ομιλητές: «${separated}»`);
    const segments = await page.locator('.segment').count();
    assert.equal(await page.locator('.segment .speaker-chip').count(), segments, 'κάθε τμήμα έχει ομιλητή');
    const speakerNames = await page.locator('.segment .speaker-chip').allInnerTexts();
    assert.ok(speakerNames.every(name => /^Ομιλητής \d+$/.test(name)), speakerNames.join(', '));
    assert.ok(await page.getByLabel(/^Όνομα ομιλητή Ομιλητής \d+$/).count() >= 1, 'οι ομιλητές φαίνονται για μετονομασία');
  }, { serviceWorkers: 'block' });
  assert.deepEqual(result.violations, []);
});
