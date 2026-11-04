/**
 * Πραγματική μεταγραφή στη συσκευή (Whisper base, WASM) πάνω σε ελληνική
 * ομιλία. Κατεβάζει ~77 MB μοντέλων και θέλει τα αρχεία του
 * tests/fixtures/generate.sh, γι' αυτό τρέχει μόνο με APOMAGN_REAL_MODELS=1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withSite } from './harness.mjs';
import { dismissOnboarding } from './app-helpers.mjs';

const SAMPLE = fileURLToPath(new URL('../fixtures/generated/greek.mp3', import.meta.url));
const enabled = process.env.APOMAGN_REAL_MODELS === '1' && fs.existsSync(SAMPLE);

test('Whisper στη συσκευή: ελληνικό κείμενο από πραγματική ομιλία', { skip: !enabled && 'APOMAGN_REAL_MODELS=1 και tests/fixtures/generate.sh', timeout: 900_000 }, async () => {
  const result = await withSite(async ({ page, base }) => {
    await page.goto(`${base}/`);
    await dismissOnboarding(page);
    await page.setInputFiles('#media-file', SAMPLE);
    await page.getByText('greek.mp3').waitFor();
    await page.getByRole('button', { name: 'Έναρξη' }).click();
    await page.waitForURL(/#\/t\//, { timeout: 840_000 });
    const text = (await page.locator('.segment .text').allInnerTexts()).join(' ');
    assert.match(text, /Καλημέρα/i);
    assert.match(text, /συνεδρίαση/i);
  }, { serviceWorkers: 'block' });
  assert.deepEqual(result.violations, []);
});
