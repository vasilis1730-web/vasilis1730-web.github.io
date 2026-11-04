import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolvePagesPath, startPagesServer } from '../browser/harness.mjs';
import { parseHeaderRules } from '../../tools/headers.mjs';
import { launchOptions, shouldIgnoreHttpsErrors, candidatesFromBrowsersPath } from '../../tools/browser.mjs';
import { tempDir } from './helpers.mjs';

/* Ο τοπικός server των ελέγχων στον browser (tests/browser/harness.mjs) πρέπει
   να συμπεριφέρεται όπως το Cloudflare Pages: καθαρές διαδρομές, 404.html,
   headers από το _headers. Αλλιώς ένα πράσινο test στον browser δεν λέει τίποτα
   για την παραγωγή. */

function site(t) {
  const dir = tempDir(t, 'apomagnitofonisi-harness-');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  write('index.html', '<p>αρχική</p>');
  write('privacy.html', '<p>απόρρητο</p>');
  write('404.html', '<p>δεν βρέθηκε</p>');
  write('src/main.js', 'export {};');
  write('docs/index.html', '<p>docs</p>');
  return dir;
}

test('οι διαδρομές λύνονται όπως στο Cloudflare Pages', t => {
  const dir = site(t);
  assert.equal(resolvePagesPath(dir, '/').file, path.join(dir, 'index.html'));
  assert.equal(resolvePagesPath(dir, '/privacy').file, path.join(dir, 'privacy.html'), 'καθαρή διαδρομή χωρίς .html');
  assert.deepEqual(resolvePagesPath(dir, '/privacy.html', '?a=1'), { redirect: '/privacy?a=1' }, '/x.html → 308 → /x');
  assert.deepEqual(resolvePagesPath(dir, '/index.html'), { redirect: '/' });
  assert.equal(resolvePagesPath(dir, '/docs/').file, path.join(dir, 'docs', 'index.html'));
  assert.equal(resolvePagesPath(dir, '/src/main.js').file, path.join(dir, 'src', 'main.js'));
  assert.equal(resolvePagesPath(dir, '/nothing'), null);
  assert.equal(resolvePagesPath(dir, '/src'), null, 'φάκελος χωρίς index δεν σερβίρεται');
  assert.equal(resolvePagesPath(dir, '/../../etc/passwd'), null, 'τίποτα έξω από το dist');
});

test('ο server στέλνει τα headers του _headers, 404 με το 404.html και 405 σε POST', async t => {
  const dir = site(t);
  const rules = parseHeaderRules('/*\n  X-Frame-Options: DENY\n  Cross-Origin-Opener-Policy: same-origin\n/src/*\n  Cache-Control: no-cache\n');
  const server = await startPagesServer(dir, rules);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.equal(home.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.match(await home.text(), /αρχική/);

  const script = await fetch(`${base}/src/main.js`);
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(script.headers.get('cache-control'), 'no-cache');

  const redirect = await fetch(`${base}/privacy.html`, { redirect: 'manual' });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), '/privacy');

  const missing = await fetch(`${base}/nothing`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /δεν βρέθηκε/);

  const post = await fetch(`${base}/share-target`, { method: 'POST', body: 'x' });
  assert.equal(post.status, 405, 'χωρίς service worker, POST σε στατικό site απαντά 405');
});

test('ο Chromium βρίσκεται από ρητή διαδρομή, από γνωστές διαδρομές ή από το PLAYWRIGHT_BROWSERS_PATH', t => {
  const dir = tempDir(t, 'apomagnitofonisi-chromium-');
  const fake = path.join(dir, 'chrome');
  fs.writeFileSync(fake, '');
  assert.deepEqual(launchOptions({ APOMAGN_CHROMIUM: fake }), { executablePath: fake });
  fs.mkdirSync(path.join(dir, 'pw', 'chromium-1', 'chrome-linux'), { recursive: true });
  assert.deepEqual(candidatesFromBrowsersPath(path.join(dir, 'pw')).map(p => path.relative(dir, p)),
    ['pw/chromium-1/chrome-linux/chrome', 'pw/chromium-1/chrome-linux/headless_shell', 'pw/chromium-1/chrome-linux64/chrome']);
  assert.deepEqual(candidatesFromBrowsersPath(path.join(dir, 'missing')), []);
  assert.equal(shouldIgnoreHttpsErrors({ APOMAGN_BROWSER_IGNORE_TLS: '1' }), true);
  assert.equal(shouldIgnoreHttpsErrors({}), false, 'στο CI ποτέ');
});
