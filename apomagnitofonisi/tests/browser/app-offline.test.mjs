/**
 * Ο service worker: η εφαρμογή ανοίγει χωρίς δίκτυο μετά την πρώτη επίσκεψη,
 * και ένα αρχείο που μοιράζεται άλλη εφαρμογή (share target) φτάνει στη
 * «Νέα μεταγραφή».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withSite } from './harness.mjs';
import { dismissOnboarding } from './app-helpers.mjs';

test('εκτός σύνδεσης και κοινή χρήση αρχείου', { timeout: 120_000 }, async () => {
  const result = await withSite(async ({ page, context, base }) => {
    await page.goto(`${base}/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForFunction(async () => (await (await caches.open('apomagnitofonisi-shell-1.0.0')).keys()).length > 80);

    await context.setOffline(true);
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Νέα μεταγραφή' }).waitFor();
    await page.goto(`${base}/#/history`);
    await page.getByRole('heading', { level: 1, name: 'Ιστορικό' }).waitFor();
    await context.setOffline(false);

    // Ό,τι κάνει ο browser για ένα share target: POST multipart στο ./share-target.
    await page.goto(`${base}/`);
    await dismissOnboarding(page);
    await page.evaluate(async () => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.enctype = 'multipart/form-data';
      form.action = './share-target';
      const input = document.createElement('input');
      input.type = 'file';
      input.name = 'media';
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([82, 73, 70, 70])], 'Φωνητικό μήνυμα.ogg', { type: 'audio/ogg' }));
      input.files = transfer.files;
      form.append(input);
      document.body.append(form);
      form.submit();
    });
    await page.waitForURL(url => url.pathname === '/' && !url.search.includes('shared'));
    await page.getByText('Φωνητικό μήνυμα.ogg').waitFor();
    assert.equal(await page.evaluate(async () => (await (await caches.open('apomagnitofonisi-share-inbox')).keys()).length), 0, 'η θυρίδα αδειάζει');
  });
  assert.deepEqual(result.violations, [], 'καμία παραβίαση CSP');
});
