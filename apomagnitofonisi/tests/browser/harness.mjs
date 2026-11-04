/**
 * Κοινό υπόβαθρο για τους ελέγχους σε πραγματικό Chromium.
 *
 * Χτίζει το ΠΡΑΓΜΑΤΙΚΟ dist/ σε προσωρινό φάκελο και το σερβίρει με τους
 * ΠΡΑΓΜΑΤΙΚΟΥΣ κανόνες του public/_headers (άρα και CSP, COOP και COEP: η
 * σελίδα είναι cross-origin isolated όπως στην παραγωγή) και με τη
 * συμπεριφορά διαδρομών του Cloudflare Pages (καθαρές διαδρομές: /x.html →
 * 308 → /x, /dir/ → dir/index.html, άγνωστη διαδρομή → 404 με το 404.html).
 * Μετρά τις παραβιάσεις CSP, τα σφάλματα της σελίδας και κάθε εξωτερικό host
 * που ζητήθηκε.
 *
 * Τα tests προσθέτουν τα δικά τους page.route() (π.χ. ψεύτικες απαντήσεις του
 * ElevenLabs ή του Anthropic) ΠΡΙΝ από το πρώτο page.goto().
 *
 *   const result = await withSite(async ({ page, context, base, collect }) => {
 *     await page.route('https://api.elevenlabs.io/**', route => route.fulfill({ … }));
 *     await page.goto(`${base}/`);
 *   });
 *   // result = { violations, errors, hosts, loaded, failed }
 *
 * Τοπικά το HTTPS περνά από proxy με δικό του CA: APOMAGN_BROWSER_IGNORE_TLS=1
 * (tools/browser.mjs). Στον runner του CI δεν χρειάζεται.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { ROOT } from '../../tools/paths.mjs';
import { build, DEFAULT_SITE_URL, PUBLIC_DIR } from '../../tools/build-dist.mjs';
import { launchOptions, shouldIgnoreHttpsErrors } from '../../tools/browser.mjs';
import { parseHeaderRules, headersFor } from '../../tools/headers.mjs';

/** Τύποι περιεχομένου όπως τους στέλνει το Cloudflare Pages για τα αρχεία της εφαρμογής. */
export const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
});

/**
 * Αναφορά παραβίασης CSP (POST application/csp-report): τη στέλνει ο ίδιος ο
 * browser για λογαριασμό της πολιτικής και δεν είναι «host που ζητά η σελίδα».
 */
export function isCspReport(req) {
  return req.method() === 'POST' && /^application\/csp-report/i.test(req.headers()['content-type'] || '');
}

/** Το αρχείο που σερβίρει το Pages για μια διαδρομή, ή { redirect } για καθαρή διαδρομή, ή null. */
export function resolvePagesPath(dir, pathname, search = '') {
  if (pathname.endsWith('.html')) {
    return { redirect: pathname.replace(/index\.html$/, '').replace(/\.html$/, '') + search };
  }
  let rel = pathname.replace(/^\/+/, '');
  if (pathname.endsWith('/')) rel += 'index.html';
  let file = path.join(dir, rel);
  if (!file.startsWith(dir)) return null;
  if ((!fs.existsSync(file) || fs.statSync(file).isDirectory()) && fs.existsSync(`${file}.html`)) file = `${file}.html`;
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return null;
  return { file };
}

/** Τοπικός server με τη συμπεριφορά του Cloudflare Pages πάνω σε έναν φάκελο dist. */
export function startPagesServer(dir, rules) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...headersFor(rules, pathname) }).end();
      return;
    }
    const resolved = resolvePagesPath(dir, pathname, url.search);
    if (resolved && resolved.redirect !== undefined) {
      res.writeHead(308, { Location: resolved.redirect }).end();
      return;
    }
    const status = resolved ? 200 : 404;
    const file = resolved ? resolved.file : path.join(dir, '404.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...headersFor(rules, pathname) }).end('Not Found');
      return;
    }
    const type = CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(status, { 'Content-Type': type, ...headersFor(rules, pathname) });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * Χτίζει το dist σε προσωρινό φάκελο, το σερβίρει, ανοίγει Chromium και
 * τρέχει το `run`. Επιστρέφει τις παραβιάσεις CSP, τα σφάλματα, τα εξωτερικά
 * hosts που ζητήθηκαν, όσα φόρτωσαν και όσα απέτυχαν.
 *
 * options.serviceWorkers  'allow' (προεπιλογή) ή 'block'
 * options.contextOptions  επιπλέον επιλογές του browser.newContext()
 */
export async function withSite(run, { serviceWorkers = 'allow', contextOptions = {} } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apomagnitofonisi-browser-'));
  build({ out, siteUrl: DEFAULT_SITE_URL });
  const rules = parseHeaderRules(fs.readFileSync(path.join(ROOT, PUBLIC_DIR, '_headers'), 'utf8'));
  const server = await startPagesServer(out, rules);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({
    locale: 'el-GR',
    ignoreHTTPSErrors: shouldIgnoreHttpsErrors(),
    serviceWorkers,
    acceptDownloads: true,
    ...contextOptions,
  });

  const violations = [];
  const errors = [];
  const hosts = new Set();
  const loaded = new Set();
  const failed = [];
  const external = url => {
    try {
      const u = new URL(url);
      return u.origin !== base && /^https?:$/.test(u.protocol) ? u : null;
    } catch { return null; }
  };

  await context.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations.push(`${e.violatedDirective} ← ${e.blockedURI || '(inline)'} @ ${e.sourceFile || e.documentURI}:${e.lineNumber || 0}`);
    });
  });
  context.on('page', page => {
    page.on('pageerror', err => errors.push(`${page.url()}: ${err}`));
    page.on('console', msg => {
      const text = msg.text();
      if (/^\[Report Only\]/.test(text)) return;
      if (/Content Security Policy|Refused to/i.test(text)) violations.push(`${page.url()}: ${text}`);
      else if (msg.type() === 'error') errors.push(`${page.url()}: ${text}`);
    });
  });
  // Σε επίπεδο context: πιάνει και τα αιτήματα των workers και του service worker.
  context.on('request', req => {
    const u = external(req.url());
    if (u && !isCspReport(req)) hosts.add(u.host);
  });
  context.on('response', res => {
    const u = external(res.url());
    if (u && res.ok()) loaded.add(u.host);
  });
  context.on('requestfailed', req => {
    const u = external(req.url());
    const reason = req.failure()?.errorText || '';
    // Η ακύρωση από πλοήγηση δεν είναι αποτυχία δικτύου.
    if (u && reason !== 'net::ERR_ABORTED' && !isCspReport(req)) failed.push(`${u.host}${u.pathname} (${reason})`);
  });
  const page = await context.newPage();

  /** Μαζεύει τις παραβιάσεις που κατέγραψε ο listener μέσα σε κάθε σελίδα. */
  const collect = async () => {
    for (const p of context.pages()) {
      const found = await p.evaluate(() => { const v = window.__cspViolations || []; window.__cspViolations = []; return v; }).catch(() => []);
      violations.push(...found.map(v => `${p.url()}: ${v}`));
    }
  };

  try {
    await run({ page, context, base, collect });
  } finally {
    await collect();
    await browser.close();
    server.close();
    fs.rmSync(out, { recursive: true, force: true });
  }
  return { violations, errors, hosts: [...hosts].sort(), loaded: [...loaded].sort(), failed };
}
