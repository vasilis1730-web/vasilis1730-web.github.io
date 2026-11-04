import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withSite } from './harness.mjs';
import { ROOT } from '../../tools/paths.mjs';
import { PUBLIC_DIR } from '../../tools/build-dist.mjs';
import { cspOf, cspAllows } from '../../tools/headers.mjs';

/* Ο μόνος έλεγχος που αποδεικνύει ότι η CSP δουλεύει: πραγματικός Chromium
   πάνω στο πραγματικό dist/ με τα πραγματικά headers (CSP, COOP, COEP). Κάθε
   σελίδα πρέπει να φορτώνει χωρίς παραβίαση CSP και χωρίς σφάλμα, να είναι
   cross-origin isolated (πολυνηματικό WASM για το Whisper), και κάθε εξωτερικό
   host που ζητά να επιτρέπεται από την CSP. */

const APP_FILES = ['index.html', 'privacy.html', '404.html', 'manifest.json', 'sw.js'];
const PAGES = Object.freeze([
  { route: '/', status: 200 },
  { route: '/privacy', status: 200 },
  { route: '/404', status: 200 },
  { route: '/no-such-page', status: 404 },
]);

test('οι σελίδες φορτώνουν με την πραγματική CSP, χωρίς παραβιάσεις και σφάλματα, cross-origin isolated', async t => {
  if (!APP_FILES.some(file => fs.existsSync(path.join(ROOT, file)))) {
    t.skip(`η εφαρμογή δεν έχει γραφτεί ακόμη (λείπουν όλα τα ${APP_FILES.join(', ')})`);
    return;
  }
  const csp = cspOf(fs.readFileSync(path.join(ROOT, PUBLIC_DIR, '_headers'), 'utf8'));
  const visited = [];
  const result = await withSite(async ({ page, base, collect }) => {
    for (const { route, status } of PAGES) {
      const response = await page.goto(`${base}${route}`, { waitUntil: 'load' });
      await page.waitForLoadState('networkidle').catch(() => {});
      const isolated = await page.evaluate(() => self.crossOriginIsolated);
      visited.push({ route, status: response && response.status(), expected: status, isolated });
      await collect();
    }
    // Καθαρές διαδρομές όπως στο Cloudflare Pages: /privacy.html → /privacy.
    const redirected = await page.goto(`${base}/privacy.html`, { waitUntil: 'load' });
    visited.push({ route: '/privacy.html', status: redirected && redirected.status(), expected: 200, isolated: true, url: new URL(page.url()).pathname });
  });

  for (const v of visited) {
    assert.equal(v.status, v.expected, `${v.route}: HTTP ${v.status}`);
    assert.equal(v.isolated, true, `${v.route}: crossOriginIsolated (COOP same-origin και COEP credentialless)`);
  }
  assert.equal(visited.at(-1).url, '/privacy', 'το /privacy.html ανακατευθύνεται στην καθαρή διαδρομή');
  assert.deepEqual(result.violations, [], 'καμία παραβίαση CSP');
  // Το μόνο αναμενόμενο «σφάλμα»: η κονσόλα γράφει το 404 της σκόπιμα ανύπαρκτης σελίδας.
  const expected404 = e => e.includes('/no-such-page') && /status of 404/.test(e);
  assert.deepEqual(result.errors.filter(e => !expected404(e)), [], 'κανένα σφάλμα στη σελίδα ή στην κονσόλα');
  assert.deepEqual(result.failed, [], 'κανένα εξωτερικό αίτημα δεν απέτυχε');
  for (const host of result.hosts) {
    const url = `https://${host}/`;
    assert.ok(cspAllows(csp, 'connect-src', url) || cspAllows(csp, 'script-src', url) || cspAllows(csp, 'img-src', url),
      `το ${host} ζητήθηκε αλλά δεν είναι στη CSP`);
  }
});
