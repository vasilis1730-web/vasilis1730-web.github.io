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
 * Η διεύθυνση παραγωγής και το email επικοινωνίας έχουν μία πηγή, το
 * src/config/app-info.js (SITE_URL, CONTACT_EMAIL). Το build τα διαβάζει από
 * εκεί, και το privacy.html πρέπει να γράφει το ίδιο email (findContactProblems).
 *
 *   npm run build                       → dist/ για https://apomagnitofonisi.pages.dev
 *   PUBLIC_URL=https://apomagnitofonisi.texnikes.app npm run build
 *                                       → sitemap/robots με το custom domain
 *   node tools/build-dist.mjs --out /κάποιος/φάκελος
 *   node tools/build-dist.mjs --check-contact
 *                                       → μόνο ο έλεγχος του email επικοινωνίας
 *                                         (deploy.yml), έξοδος 1 όσο εκκρεμεί
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, assertSafeOutput } from './paths.mjs';
import { assetLinksJson } from './android/asset-links.mjs';
import { cspOf } from './headers.mjs';
import { findPublishedSourceProblems } from './source-checks.mjs';
import { SITE_URL, CONTACT_EMAIL } from '../src/config/app-info.js';

export const DEFAULT_OUT = path.join(ROOT, 'dist');

/** Το Pages project και το τεχνικό του URL. Το custom domain έρχεται από το PUBLIC_URL. */
export const PAGES_PROJECT = 'apomagnitofonisi';
export const DEFAULT_SITE_URL = `https://${PAGES_PROJECT}.pages.dev`;

/** Η διεύθυνση παραγωγής, από το SITE_URL του src/config/app-info.js, χωρίς τελικό /. */
export const PRODUCTION_URL = new URL(SITE_URL).origin;

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

/** Η πολιτική απορρήτου, που πρέπει να γράφει το email επικοινωνίας. */
export const PRIVACY_PAGE = 'privacy.html';

/** Οι σελίδες του sitemap, ως καθαρές διαδρομές (το Pages κόβει το .html). */
export const SITEMAP_PAGES = Object.freeze([
  { path: '/', priority: '1.0' },
  { path: '/privacy', priority: '0.5' },
]);

/** Επεκτάσεις αρχείων κειμένου που ελέγχονται πριν δημοσιευτούν. */
const TEXT_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.webmanifest']);

/** Σημάδι που περιμένει ακόμη τιμή, π.χ. το email επικοινωνίας πριν οριστεί. */
const UNRESOLVED_PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

/** Μια διεύθυνση email που μπορεί να δημοσιευτεί (όχι σημάδι, όχι κενό). */
const EMAIL_ADDRESS = /^[^\s@<>"'`]+@[^\s@<>"'`]+\.[A-Za-z]{2,}$/;

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

/** Όλα τα αρχεία κάτω από έναν φάκελο, σχετικά με αυτόν, ταξινομημένα, με / ως διαχωριστικό. */
export function listFiles(dir) {
  const files = [];
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else files.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  visit(dir);
  return files;
}

/** Τα αρχεία των PUBLISHED, σχετικά με τη ρίζα. Λείπει κάποιο → σφάλμα με όνομα. */
export function publishedFiles(root = ROOT) {
  const files = [];
  const missing = [];
  for (const entry of PUBLISHED) {
    const full = path.join(root, entry);
    if (!fs.existsSync(full)) { missing.push(entry); continue; }
    if (fs.statSync(full).isDirectory()) files.push(...listFiles(full).map(f => `${entry}/${f}`));
    else files.push(entry);
  }
  if (missing.length) throw new Error(`λείπουν αρχεία που δημοσιεύονται: ${missing.join(', ')}`);
  return files;
}

/** Τα κείμενα των αρχείων που δημοσιεύονται: [{ path, text }], για τους ελέγχους. */
export function publishedTextSources(root = ROOT) {
  return publishedFiles(root)
    .filter(file => TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .map(file => ({ path: file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
}

/**
 * Τα προβλήματα που εμποδίζουν το build (tools/source-checks.mjs).
 * @returns {string[]} κενή λίστα = εντάξει
 */
export function findBuildProblems({ root = ROOT } = {}) {
  const headersText = fs.readFileSync(path.join(root, PUBLIC_DIR, '_headers'), 'utf8');
  let csp;
  try { csp = cspOf(headersText); } catch (error) { return [error.message]; }
  return findPublishedSourceProblems({ files: publishedTextSources(root), csp, selfOrigins: SELF_ORIGINS });
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/**
 * Τι εκκρεμεί για να ανέβει η εφαρμογή στην παραγωγή, όσον αφορά την
 * επικοινωνία της πολιτικής απορρήτου: πραγματικό email στο CONTACT_EMAIL του
 * src/config/app-info.js, το ίδιο email στο privacy.html, και κανένα σημάδι
 * __ΚΑΤΙ__ (π.χ. ξεχασμένο __CONTACT_EMAIL__) σε ό,τι δημοσιεύεται.
 * @param {{ contactEmail?: string, files?: { path: string, text: string }[] }} [input]
 * @returns {string[]} κενή λίστα = μπορεί να ανέβει
 */
export function findContactProblems({ contactEmail = CONTACT_EMAIL, files = publishedTextSources() } = {}) {
  const problems = [];
  if (!EMAIL_ADDRESS.test(String(contactEmail ?? ''))) {
    problems.push(`το email επικοινωνίας δεν έχει οριστεί: CONTACT_EMAIL «${contactEmail}» στο src/config/app-info.js`);
  } else {
    const privacy = files.find(file => file.path === PRIVACY_PAGE);
    if (!privacy) problems.push(`λείπει το ${PRIVACY_PAGE}`);
    else if (!privacy.text.includes(contactEmail)) {
      problems.push(`το ${PRIVACY_PAGE} δεν γράφει το email επικοινωνίας ${contactEmail} του src/config/app-info.js`);
    }
  }
  for (const { path: file, text } of files) {
    for (const match of text.matchAll(UNRESOLVED_PLACEHOLDER)) {
      problems.push(`${file}:${lineOf(text, match.index)}: σημάδι χωρίς τιμή ${match[0]}`);
    }
  }
  return problems;
}

/** Χτίζει το dist και επιστρέφει { out, siteUrl, csp, files }. */
export function build({ root = ROOT, out = DEFAULT_OUT, siteUrl = siteUrlFrom() } = {}) {
  assertSafeOutput(root, out);
  const problems = findBuildProblems({ root });
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
  return { out, siteUrl, csp: cspOf(headersText), files: listFiles(out) };
}

/** Οι παράμετροι της γραμμής εντολών: [--out <φάκελος>] ή --check-contact. */
export function parseArgs(argv) {
  const args = { checkContact: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      if (i + 1 >= argv.length) throw new Error('λείπει η τιμή της --out');
      args.out = path.resolve(argv[++i]);
    } else if (argv[i] === '--check-contact') args.checkContact = true;
    else throw new Error(`άγνωστη παράμετρος: ${argv[i]} (δέχομαι --out <φάκελος> ή --check-contact)`);
  }
  if (args.checkContact && args.out) throw new Error('το --check-contact δεν χτίζει, δεν συνδυάζεται με το --out');
  return args;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.checkContact) {
      const problems = findContactProblems();
      if (problems.length) {
        throw new Error(`η πολιτική απορρήτου δεν έχει ακόμη email επικοινωνίας, δεν ανεβαίνει (docs/DEPLOYMENT.md §6):\n${problems.map(p => `  - ${p}`).join('\n')}`);
      }
      console.log(`✓ email επικοινωνίας: ${CONTACT_EMAIL}`);
    } else {
      const { out, siteUrl, files } = build({ out: args.out });
      const bytes = files.reduce((sum, f) => sum + fs.statSync(path.join(out, f)).size, 0);
      console.log(`✓ ${path.relative(process.cwd(), out) || '.'} για ${siteUrl}, ${files.length} αρχεία, ${(bytes / 1024).toFixed(0)} KB`);
      const pending = findContactProblems();
      if (pending.length) console.log(`! εκκρεμεί για την παραγωγή (το deploy θα αρνηθεί):\n${pending.map(p => `  - ${p}`).join('\n')}`);
      for (const file of files) console.log(`  ${file}`);
    }
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exitCode = 1;
  }
}
