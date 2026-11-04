import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, PUBLISHED, PUBLIC_DIR, ASSET_LINKS, PAGES_PROJECT, DEFAULT_SITE_URL, PRODUCTION_URL, CONTACT_PLACEHOLDER,
  build, inspect, sitemapFor, robotsFor, siteUrlFrom, walk, filesWithContactPlaceholder,
} from '../../tools/build-dist.mjs';
import { ANDROID_DIR, ANDROID_APPS } from '../../tools/android/project.mjs';
import { assetLinksJson } from '../../tools/android/asset-links.mjs';
import { parseHeaderRules, headersFor, cspOf, directiveSources } from '../../tools/headers.mjs';
import { read, skipWhileAppPending, tempDir } from './helpers.mjs';

/* Το build (tools/build-dist.mjs): τι δημοσιεύεται, με ποια headers, και τι
   το σταματά πριν φτάσει στο Cloudflare. */

/** Η CSP της εφαρμογής, οδηγία προς οδηγία, όπως συμφωνήθηκε (docs/DEPLOYMENT.md). */
const EXPECTED_CSP = Object.freeze({
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'form-action': ["'self'"],
  'manifest-src': ["'self'"],
  'script-src': ["'self'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net', 'blob:'],
  'worker-src': ["'self'", 'blob:'],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'media-src': ["'self'", 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'", 'https://api.elevenlabs.io', 'https://api.anthropic.com', 'https://cdn.jsdelivr.net',
    'https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co'],
});

/** Ένα ελάχιστο repository σε προσωρινό φάκελο, για να δοκιμαστεί το build χωρίς την πραγματική εφαρμογή. */
function miniRepository(t) {
  const root = tempDir(t, 'apomagnitofonisi-build-');
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  write('index.html', '<!doctype html><title>x</title><script type="module" src="./src/main.js"></script>');
  write('privacy.html', `<!doctype html><title>x</title><p>${CONTACT_PLACEHOLDER}</p>`);
  write('404.html', '<!doctype html><title>404</title>');
  write('manifest.json', '{"name":"x"}');
  write('sw.js', "self.addEventListener('fetch', () => {});");
  write('assets/icons/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  write('src/main.js', "fetch('https://api.elevenlabs.io/v1/user');");
  write('src/config/vendor.js', "export const MEDIABUNNY = 'https://cdn.jsdelivr.net/npm/mediabunny@1.65.1/dist/bundles/mediabunny.min.mjs';");
  write('tests/secret.test.mjs', 'δεν δημοσιεύεται');
  fs.mkdirSync(path.join(root, PUBLIC_DIR), { recursive: true });
  fs.copyFileSync(path.join(ROOT, PUBLIC_DIR, '_headers'), path.join(root, PUBLIC_DIR, '_headers'));
  for (const app of ANDROID_APPS) {
    write(`${ANDROID_DIR}/${app}/twa-manifest.json`, read(`${ANDROID_DIR}/${app}/twa-manifest.json`));
  }
  return { root, write };
}

test('το dist περιέχει μόνο ό,τι σερβίρεται, αμετάβλητο, συν τα παραγόμενα sitemap, robots και assetlinks', t => {
  if (skipWhileAppPending(t)) return;
  const out = tempDir(t, 'apomagnitofonisi-dist-');
  const { files, siteUrl } = build({ out, siteUrl: DEFAULT_SITE_URL });
  assert.equal(siteUrl, DEFAULT_SITE_URL);
  const expected = [];
  for (const entry of PUBLISHED) {
    const full = path.join(ROOT, entry);
    if (fs.statSync(full).isDirectory()) expected.push(...walk(full).map(f => `${entry}/${f}`));
    else expected.push(entry);
  }
  expected.push(...fs.readdirSync(path.join(ROOT, PUBLIC_DIR)), 'sitemap.xml', 'robots.txt', ASSET_LINKS);
  assert.deepEqual([...files].sort(), [...expected].sort(), 'ούτε λιγότερα ούτε περισσότερα αρχεία');
  for (const file of expected.filter(f => !['sitemap.xml', 'robots.txt', ASSET_LINKS].includes(f))) {
    const source = PUBLISHED.some(p => file === p || file.startsWith(`${p}/`)) ? file : `${PUBLIC_DIR}/${file}`;
    assert.ok(fs.readFileSync(path.join(out, file)).equals(fs.readFileSync(path.join(ROOT, source))), `${file} αμετάβλητο`);
  }
  for (const leak of ['tests', 'tools', 'docs', 'android', 'node_modules', 'package.json', 'CLAUDE.md', 'README.md', 'public', 'store-assets']) {
    assert.ok(!fs.existsSync(path.join(out, leak)), `το ${leak} δεν δημοσιεύεται`);
  }
  assert.equal(fs.readFileSync(path.join(out, ASSET_LINKS), 'utf8'), assetLinksJson(), 'το assetlinks.json από το twa-manifest.json');
});

test('το build σε ελάχιστο repository: δημοσιεύει μόνο τα PUBLISHED και δείχνει τι εκκρεμεί για το deploy', t => {
  const { root } = miniRepository(t);
  const out = path.join(root, 'dist');
  const { files } = build({ root, out, siteUrl: PRODUCTION_URL });
  assert.ok(files.includes('src/main.js') && files.includes('_headers') && files.includes(ASSET_LINKS));
  assert.ok(!files.some(f => f.startsWith('tests/')), 'τα tests δεν δημοσιεύονται');
  assert.match(fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8'), new RegExp(`<loc>${PRODUCTION_URL}/privacy</loc>`));
  assert.deepEqual(filesWithContactPlaceholder(out), ['privacy.html'], 'το deploy θα αρνηθεί όσο λείπει το email επικοινωνίας');
});

test('το build αρνείται host εκτός CSP, βιβλιοθήκη χωρίς έκδοση, inline script ή άνω τελεία, χωρίς να αφήσει μισό dist', t => {
  const cases = [
    ['src/track.js', "fetch('https://tracker.example/collect');", /tracker\.example δεν επιτρέπεται/],
    ['src/config/vendor.js', "export const M = 'https://cdn.jsdelivr.net/npm/mediabunny/dist/bundles/mediabunny.min.mjs';", /πακέτο χωρίς έκδοση/],
    ['src/other.js', "import('https://cdn.jsdelivr.net/npm/x@1.0.0/x.mjs');", /έξω από το src\/config\/vendor\.js/],
    ['index.html', '<!doctype html><script>alert(1)</script>', /inline <script>/],
    ['src/text.js', `export const T = 'α${String.fromCharCode(0x387)} β';`, /άνω τελεία/],
  ];
  for (const [file, text, error] of cases) {
    const { root, write } = miniRepository(t);
    write(file, text);
    const out = path.join(root, 'dist');
    assert.throws(() => build({ root, out, siteUrl: DEFAULT_SITE_URL }), error, `${file}: ${text}`);
    assert.ok(!fs.existsSync(out), 'δεν γράφεται τίποτα όταν ο έλεγχος αποτυγχάνει');
  }
  const { root } = miniRepository(t);
  fs.rmSync(path.join(root, 'sw.js'));
  assert.throws(() => build({ root, out: path.join(root, 'dist'), siteUrl: DEFAULT_SITE_URL }), /λείπουν αρχεία που δημοσιεύονται: sw\.js/);
});

test('τα αρχεία της εφαρμογής περνούν τους ελέγχους του build', t => {
  if (skipWhileAppPending(t)) return;
  assert.deepEqual(inspect(), [], 'CSP ↔ hosts του κώδικα, εκδόσεις βιβλιοθηκών, HTML, άνω τελεία, μυστικά');
});

test('τα _headers στέλνουν headers ασφαλείας, cross-origin isolation και CSP μόνο για ό,τι χρησιμοποιεί η εφαρμογή', () => {
  const text = read(`${PUBLIC_DIR}/_headers`);
  const rules = parseHeaderRules(text);
  const page = headersFor(rules, '/');
  assert.equal(page['X-Content-Type-Options'], 'nosniff');
  assert.equal(page['X-Frame-Options'], 'DENY');
  assert.equal(page['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(page['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()');
  assert.equal(page['Cross-Origin-Opener-Policy'], 'same-origin', 'cross-origin isolation για πολυνηματικό WASM');
  assert.equal(page['Cross-Origin-Embedder-Policy'], 'credentialless');
  assert.ok(rules[0].unset.includes('access-control-allow-origin'), 'κανένα CORS για τα αρχεία της εφαρμογής');
  const csp = cspOf(text);
  const directives = csp.split(';').map(d => d.trim()).filter(Boolean).map(d => d.split(/\s+/)[0]);
  assert.deepEqual([...directives].sort(), Object.keys(EXPECTED_CSP).sort(), 'ούτε λιγότερες ούτε περισσότερες οδηγίες');
  for (const [name, sources] of Object.entries(EXPECTED_CSP)) {
    assert.deepEqual(directiveSources(csp, name), sources, `${name}`);
  }
  assert.doesNotMatch(csp, /'unsafe-(?:inline|eval|hashes)'/, 'ούτε inline script/style ούτε eval (μόνο wasm-unsafe-eval)');
  for (const file of ['/sw.js', '/manifest.json']) {
    assert.equal(headersFor(rules, file)['Cache-Control'], 'no-cache', `${file}: νέα έκδοση φτάνει αμέσως`);
  }
  assert.equal(headersFor(rules, '/src/main.js')['Cache-Control'], undefined);
});

test('sitemap.xml και robots.txt για τη διεύθυνση του build', () => {
  const sitemap = sitemapFor(`${PRODUCTION_URL}/`);
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, new RegExp(`<loc>${PRODUCTION_URL}/</loc>`));
  assert.match(sitemap, new RegExp(`<loc>${PRODUCTION_URL}/privacy</loc>`), 'καθαρή διαδρομή, χωρίς .html');
  assert.equal(robotsFor(PRODUCTION_URL), `User-agent: *\nAllow: /\nSitemap: ${PRODUCTION_URL}/sitemap.xml\n`);
  assert.equal(siteUrlFrom({}), DEFAULT_SITE_URL);
  assert.equal(siteUrlFrom({ PUBLIC_URL: `${PRODUCTION_URL}/` }), PRODUCTION_URL);
  for (const bad of ['http://apomagnitofonisi.texnikes.app', 'https://x.app/path', 'ftp://x']) {
    assert.throws(() => siteUrlFrom({ PUBLIC_URL: bad }), /μη έγκυρο PUBLIC_URL/, bad);
  }
});

test('ο φάκελος εξόδου δεν επιτρέπεται να περιέχει τη ρίζα του repository', () => {
  assert.throws(() => build({ out: ROOT }), /μη ασφαλής φάκελος εξόδου/);
  assert.throws(() => build({ out: path.dirname(ROOT) }), /μη ασφαλής φάκελος εξόδου/);
});

test('Pages project, wrangler.jsonc, workflows και package.json συμφωνούν', () => {
  const wrangler = JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(wrangler.name, PAGES_PROJECT);
  assert.equal(wrangler.pages_build_output_dir, './dist');
  assert.equal(DEFAULT_SITE_URL, `https://${PAGES_PROJECT}.pages.dev`);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, PAGES_PROJECT);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.build, 'node tools/build-dist.mjs');
  assert.match(pkg.scripts.test, /tests\/infra/);
  assert.match(pkg.scripts['test:browser'], /tests\/browser/);
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name}: ακριβής έκδοση, όχι εύρος`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'package-lock.json')), 'lockfile για npm ci');
});
