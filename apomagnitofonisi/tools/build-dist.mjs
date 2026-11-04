#!/usr/bin/env node
/**
 * Συναρμολόγηση του φακέλου dist/ για το Cloudflare Pages.
 *
 * Η Απομαγνητοφώνηση είναι στατική εφαρμογή χωρίς bundler (ES modules). Το
 * repository όμως περιέχει και tests, εργαλεία, το project Android και
 * τεκμηρίωση που ΔΕΝ δημοσιεύονται. Το εργαλείο αντιγράφει στο dist/ μόνο ό,τι
 * σερβίρεται (PUBLISHED), βάζει τα αρχεία του public/ (το _headers) στη ΡΙΖΑ
 * του dist/, και παράγει sitemap.xml και robots.txt για τη διεύθυνση όπου θα
 * σερβιριστεί, καθώς και το .well-known/assetlinks.json της εφαρμογής Android
 * από το android/apomagnitofonisi/twa-manifest.json (tools/android/asset-links.mjs).
 *
 * Πριν γράψει οτιδήποτε ελέγχει τα αρχεία που θα δημοσιευτούν
 * (tools/source-checks.mjs): κάθε εξωτερικό host του κώδικα επιτρέπεται από
 * την CSP του public/_headers, οι βιβλιοθήκες είναι καρφιτσωμένες, οι σελίδες
 * δεν έχουν inline script ή style, δεν υπάρχει άνω τελεία ούτε μυστικό. Έτσι
 * μια αλλαγή που ξεχνά την CSP (ή το αντίστροφο) δεν φτάνει ποτέ στο Cloudflare.
 *
 *   npm run build                       → dist/ για https://apomagnitofonisi.pages.dev
 *   PUBLIC_URL=https://apomagnitofonisi.texnikes.app npm run build
 *                                       → sitemap/robots με το custom domain
 *   node tools/build-dist.mjs --out /κάποιος/φάκελος
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './paths.mjs';
import { assetLinksJson } from './android/asset-links.mjs';
import { cspOf } from './headers.mjs';
import { inspectPublishedSources } from './source-checks.mjs';

export { ROOT };
export const DEFAULT_OUT = path.join(ROOT, 'dist');

/** Το Pages project και το τεχνικό του URL. Το custom domain έρχεται από το PUBLIC_URL. */
export const PAGES_PROJECT = 'apomagnitofonisi';
export const DEFAULT_SITE_URL = `https://${PAGES_PROJECT}.pages.dev`;
export const PRODUCTION_URL = 'https://apomagnitofonisi.texnikes.app';

/** Οι διευθύνσεις της ίδιας της εφαρμογής: ένα URL τους στον κώδικα είναι 'self' για την CSP. */
export const SELF_ORIGINS = Object.freeze([PRODUCTION_URL, DEFAULT_SITE_URL]);

/** Ό,τι δημοσιεύεται, σχετικά με τη ρίζα του repository. Τίποτα άλλο. */
export const PUBLISHED = Object.freeze([
  'index.html',
  'privacy.html',
  '404.html',
  'manifest.json',
  'sw.js',
  'assets',
  'src',
]);
export const PUBLIC_DIR = 'public';

/** Το Digital Asset Links της εφαρμογής Android: χωρίς αυτό ανοίγει με γραμμή διευθύνσεων. */
export const ASSET_LINKS = '.well-known/assetlinks.json';

/** Το κείμενο-σημάδι για το email επικοινωνίας της πολιτικής απορρήτου, μέχρι να το ορίσει ο χρήστης. */
export const CONTACT_PLACEHOLDER = '__CONTACT_EMAIL__';

/** Οι σελίδες του sitemap, ως καθαρές διαδρομές (το Pages κόβει το .html). */
export const SITEMAP_PAGES = Object.freeze([
  { path: '/', priority: '1.0' },
  { path: '/privacy', priority: '0.5' },
]);

/** Επεκτάσεις αρχείων κειμένου που ελέγχονται πριν δημοσιευτούν. */
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest']);

/** Το sitemap.xml για τη διεύθυνση siteUrl (χωρίς τελικό /). */
export function sitemapFor(siteUrl) {
  const base = siteUrl.replace(/\/+$/, '');
  const urls = SITEMAP_PAGES.map(p => `<url>\n<loc>${base}${p.path}</loc>\n<priority>${p.priority}</priority>\n</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Το robots.txt: όλη η εφαρμογή είναι δημόσια. */
export function robotsFor(siteUrl) {
  const base = siteUrl.replace(/\/+$/, '');
  return `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`;
}

/** Η διεύθυνση για την οποία χτίζεται το dist: PUBLIC_URL ή το τεχνικό URL του Pages. */
export function siteUrlFrom(env = process.env) {
  const raw = String(env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return DEFAULT_SITE_URL;
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(raw)) throw new Error(`μη έγκυρο PUBLIC_URL: ${raw} (περιμένω https://host χωρίς διαδρομή)`);
  return raw;
}

/** Όλα τα αρχεία κάτω από έναν φάκελο, σχετικά με τη βάση, ταξινομημένα, με / ως διαχωριστικό. */
export function walk(dir, base = dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, acc);
    else acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
}

/** Τα αρχεία των PUBLISHED, σχετικά με τη ρίζα. Λείπει κάποιο → σφάλμα με όνομα. */
export function publishedFiles(root = ROOT) {
  const files = [];
  const missing = [];
  for (const entry of PUBLISHED) {
    const full = path.join(root, entry);
    if (!fs.existsSync(full)) { missing.push(entry); continue; }
    if (fs.statSync(full).isDirectory()) files.push(...walk(full).map(f => `${entry}/${f}`));
    else files.push(entry);
  }
  if (missing.length) throw new Error(`λείπουν αρχεία που δημοσιεύονται: ${missing.join(', ')}`);
  return files;
}

/** Τα κείμενα των αρχείων που δημοσιεύονται, για τους ελέγχους του source-checks.mjs. */
export function publishedTextSources(root = ROOT) {
  return publishedFiles(root)
    .filter(file => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map(file => ({ path: file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
}

/** Προβλήματα που εμποδίζουν το build. Κενή λίστα = εντάξει. */
export function inspect({ root = ROOT } = {}) {
  const headersText = fs.readFileSync(path.join(root, PUBLIC_DIR, '_headers'), 'utf8');
  let csp;
  try { csp = cspOf(headersText); } catch (error) { return [error.message]; }
  return inspectPublishedSources({ files: publishedTextSources(root), csp, selfOrigins: SELF_ORIGINS });
}

function assertSafeOutput(root, out) {
  const rel = path.relative(path.resolve(out), path.resolve(root));
  // Το out δεν επιτρέπεται να είναι η ρίζα ή γονέας της: θα διαγραφόταν το repository.
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(`μη ασφαλής φάκελος εξόδου: ${out} περιέχει τη ρίζα του repository`);
  }
}

/** Χτίζει το dist και επιστρέφει { out, siteUrl, csp, files }. */
export function build({ root = ROOT, out = DEFAULT_OUT, siteUrl = siteUrlFrom() } = {}) {
  assertSafeOutput(root, out);
  const problems = inspect({ root });
  if (problems.length) {
    throw new Error(`τα αρχεία που δημοσιεύονται δεν περνούν τους ελέγχους, δεν χτίζεται:\n${problems.map(p => `  - ${p}`).join('\n')}`);
  }
  // Πριν γραφτεί οτιδήποτε: ένα άκυρο αποτύπωμα στο twa-manifest.json σταματά το build.
  const assetLinks = assetLinksJson(root);
  const headersText = fs.readFileSync(path.join(root, PUBLIC_DIR, '_headers'), 'utf8');

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const entry of PUBLISHED) {
    fs.cpSync(path.join(root, entry), path.join(out, entry), { recursive: true });
  }
  for (const name of fs.readdirSync(path.join(root, PUBLIC_DIR))) {
    fs.copyFileSync(path.join(root, PUBLIC_DIR, name), path.join(out, name));
  }
  fs.writeFileSync(path.join(out, 'sitemap.xml'), sitemapFor(siteUrl));
  fs.writeFileSync(path.join(out, 'robots.txt'), robotsFor(siteUrl));
  fs.mkdirSync(path.dirname(path.join(out, ASSET_LINKS)), { recursive: true });
  fs.writeFileSync(path.join(out, ASSET_LINKS), assetLinks);
  return { out, siteUrl, csp: cspOf(headersText), files: walk(out) };
}

/** Τα αρχεία του dist που έχουν ακόμη το σημάδι του email επικοινωνίας (για το deploy). */
export function filesWithContactPlaceholder(out = DEFAULT_OUT) {
  return walk(out).filter(file => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())
    && fs.readFileSync(path.join(out, file), 'utf8').includes(CONTACT_PLACEHOLDER));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else throw new Error(`άγνωστη παράμετρος: ${argv[i]}`);
  }
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { out, siteUrl, files } = build(parseArgs(process.argv.slice(2)));
    const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(out, f)).size, 0);
    console.log(`✓ ${path.relative(process.cwd(), out) || '.'} για ${siteUrl}, ${files.length} αρχεία, ${(bytes / 1024).toFixed(0)} KB`);
    const pending = filesWithContactPlaceholder(out);
    if (pending.length) console.log(`! το email επικοινωνίας δεν έχει οριστεί ακόμη (${CONTACT_PLACEHOLDER} στα ${pending.join(', ')}): το deploy θα αρνηθεί`);
    for (const file of files) console.log(`  ${file}`);
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exitCode = 1;
  }
}
