/**
 * Έλεγχοι πάνω στα αρχεία που δημοσιεύονται, χωρίς δίκτυο και χωρίς browser.
 *
 * Κάθε συνάρτηση παίρνει κείμενο (και την CSP όπου χρειάζεται) και επιστρέφει
 * λίστα προβλημάτων ή ευρημάτων, ώστε να τη χρησιμοποιούν το build
 * (tools/build-dist.mjs, που αρνείται να χτίσει) και τα tests (tests/infra).
 *
 *   - Κάθε εξωτερικό host που ζητά ο κώδικας επιτρέπεται από την CSP.
 *   - Οι βιβλιοθήκες τρίτων ζουν μόνο στο src/config/vendor.js, καρφιτσωμένες
 *     σε ακριβή έκδοση στο jsDelivr.
 *   - Οι σελίδες HTML δεν έχουν τίποτα που κόβει η CSP (inline script, on…=,
 *     style=, <style>, javascript:).
 *   - Κανένα κείμενο δεν έχει άνω τελεία (U+0387) ή μέση τελεία (U+00B7).
 *   - Κανένα αρχείο δεν έχει κάτι που μοιάζει με μυστικό κλειδί.
 */
import { cspAllows } from './headers.mjs';

/** Το μοναδικό αρχείο με URL βιβλιοθηκών τρίτων (δυναμικά import). */
export const VENDOR_MODULE = 'src/config/vendor.js';

/**
 * Hosts που εμφανίζονται στον κώδικα μόνο ως σύνδεσμοι που ανοίγει ο χρήστης
 * (π.χ. «Δημιουργία κλειδιού»). Η εφαρμογή δεν τους ζητά ποτέ με fetch ή
 * import, γι' αυτό δεν χρειάζονται θέση στην CSP. Νέος σύνδεσμος σε άλλο site
 * = προσθήκη εδώ, με ένα κοίταγμα ότι πράγματι είναι μόνο σύνδεσμος.
 */
export const NAVIGATION_HOSTS = Object.freeze([
  'elevenlabs.io',
  'www.elevenlabs.io',
  'console.anthropic.com',
  'platform.claude.com',
  'anthropic.com',
  'www.anthropic.com',
  'support.anthropic.com',
  'support.claude.com',
  'huggingface.co',
]);

/** Οι δύο χαρακτήρες με όψη άνω τελείας που δεν επιτρέπονται σε κανένα κείμενο. */
export const FORBIDDEN_CHARACTERS = Object.freeze([
  { char: '\u0387', name: 'άνω τελεία (U+0387)' },
  { char: '\u00B7', name: 'μέση τελεία (U+00B7)' },
]);

/** Μορφές πραγματικών κλειδιών. Τα ψεύτικα κλειδιά των tests είναι σκόπιμα κοντά και δεν ταιριάζουν. */
export const SECRET_PATTERNS = Object.freeze([
  { name: 'κλειδί Anthropic', pattern: /sk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{60,}/ },
  { name: 'κλειδί ElevenLabs', pattern: /\bsk_[0-9a-f]{40,}\b/ },
  { name: 'κλειδί Google', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'token GitHub', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'ιδιωτικό κλειδί', pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
]);

const JSDELIVR_PACKAGE_URL = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(?:@[^/@]+\/)?[^/@]+(?:@([^/]*))?(?:\/|$)/i;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/** Γραμμή και στήλη (από 1) μιας θέσης σε κείμενο. */
function positionOf(text, index) {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - before.lastIndexOf('\n') };
}

/** Οι θέσεις άνω ή μέσης τελείας σε ένα κείμενο: [{ line, column, name, excerpt }]. */
export function findForbiddenCharacters(text) {
  const found = [];
  for (const { char, name } of FORBIDDEN_CHARACTERS) {
    for (let i = text.indexOf(char); i !== -1; i = text.indexOf(char, i + 1)) {
      const { line, column } = positionOf(text, i);
      found.push({ line, column, name, excerpt: text.slice(Math.max(0, i - 30), i + 30).replace(/\n/g, ' ') });
    }
  }
  return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Τα πιθανά μυστικά ενός κειμένου: [{ line, name }]. Η τιμή δεν επιστρέφεται, για να μη γραφτεί σε log. */
export function findSecrets(text) {
  const found = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(global)) found.push({ line: positionOf(text, match.index).line, name });
  }
  return found;
}

/**
 * Τα https URL που ο κώδικας γράφει ως συμβολοσειρές (αρχίζουν αμέσως μετά από
 * εισαγωγικό): αυτά είναι τα πιθανά fetch, import και σύνδεσμοι. Τα URL μέσα σε
 * σχόλια δεν αρχίζουν με εισαγωγικό και αγνοούνται. Ένα template literal
 * κόβεται στο πρώτο ${, γιατί από εκεί και πέρα η τιμή δεν είναι γνωστή. Τα
 * http:// (π.χ. namespaces του SVG και του OOXML) δεν μετρούν: μια σελίδα HTTPS
 * δεν μπορεί να τα ζητήσει ούτως ή άλλως.
 */
export function urlLiteralsIn(text) {
  const urls = [];
  for (const match of text.matchAll(/(["'`])(https:\/\/[^\s"'`]*)/g)) {
    const raw = match[2].split('${')[0];
    let url;
    try { url = new URL(raw); } catch { continue; }
    if (!url.hostname) continue;
    urls.push({ raw, url, line: positionOf(text, match.index).line });
  }
  return urls;
}

/**
 * Κάθε εξωτερικό https URL του κώδικα πρέπει να επιτρέπεται από το connect-src
 * ή το script-src της CSP, ή να είναι σύνδεσμος πλοήγησης (NAVIGATION_HOSTS),
 * ή να είναι η ίδια η εφαρμογή (selfOrigins: οι διευθύνσεις όπου σερβίρεται,
 * που για την CSP είναι 'self').
 */
export function findScriptUrlProblems({ file, text, csp, navigationHosts = NAVIGATION_HOSTS, selfOrigins = [] }) {
  const problems = [];
  for (const { raw, url, line } of urlLiteralsIn(text)) {
    const allowed = selfOrigins.includes(url.origin) || cspAllows(csp, 'connect-src', url) || cspAllows(csp, 'script-src', url)
      || navigationHosts.includes(url.hostname);
    if (!allowed) problems.push(`${file}:${line}: το ${url.hostname} δεν επιτρέπεται από την CSP (connect-src/script-src) ούτε είναι σύνδεσμος πλοήγησης (${raw})`);
  }
  return problems;
}

/**
 * Το src/config/vendor.js: κάθε URL είναι πακέτο του jsDelivr με ακριβή
 * έκδοση, που το επιτρέπουν και το script-src (import) και το connect-src
 * (οι βιβλιοθήκες κατεβάζουν από εκεί και τα .wasm τους).
 */
export function findVendorModuleProblems({ file = VENDOR_MODULE, text, csp }) {
  const problems = [];
  const urls = urlLiteralsIn(text);
  if (!urls.length) problems.push(`${file}: δεν βρέθηκε κανένα URL βιβλιοθήκης`);
  for (const { raw, url, line } of urls) {
    const pinned = describeJsdelivrPin(raw);
    if (!pinned.ok) problems.push(`${file}:${line}: ${pinned.reason}: ${raw}`);
    if (!cspAllows(csp, 'script-src', url)) problems.push(`${file}:${line}: το script-src της CSP δεν επιτρέπει το ${url.hostname}`);
    if (!cspAllows(csp, 'connect-src', url)) problems.push(`${file}:${line}: το connect-src της CSP δεν επιτρέπει το ${url.hostname}`);
  }
  return problems;
}

/**
 * Περιγράφει πώς καρφιτσώνεται ένα URL του jsDelivr: αν ονομάζει πακέτο, με
 * ποια έκδοση, και αν η έκδοση είναι ακριβής (ok). URL χωρίς πακέτο (π.χ. το
 * πρόθεμα https://cdn.jsdelivr.net/npm/ του service worker) δεν αφορά.
 * @param {string} raw
 * @returns {{ ok: boolean, reason?: string, packageNamed?: boolean, version?: string }}
 */
export function describeJsdelivrPin(raw) {
  if (!/^https:\/\/cdn\.jsdelivr\.net\//i.test(raw)) return { ok: false, reason: 'βιβλιοθήκη εκτός jsDelivr' };
  const match = raw.match(JSDELIVR_PACKAGE_URL);
  if (!match) return { ok: true, packageNamed: false };
  if (match[1] === undefined) return { ok: false, reason: 'πακέτο χωρίς έκδοση', packageNamed: true };
  if (!EXACT_VERSION.test(match[1])) return { ok: false, reason: `η έκδοση «${match[1]}» δεν είναι ακριβής`, packageNamed: true };
  return { ok: true, packageNamed: true, version: match[1] };
}

/** Πακέτο του jsDelivr έξω από το src/config/vendor.js = δεύτερη πηγή εκδόσεων, δεν επιτρέπεται. */
export function findStrayVendorUrlProblems({ file, text }) {
  if (file === VENDOR_MODULE) return [];
  return urlLiteralsIn(text)
    .filter(({ raw }) => /^https:\/\/cdn\.jsdelivr\.net\//i.test(raw) && describeJsdelivrPin(raw).packageNamed)
    .map(({ raw, line }) => `${file}:${line}: URL βιβλιοθήκης έξω από το ${VENDOR_MODULE}: ${raw}`);
}

/** Τα στοιχεία HTML που φορτώνουν πόρο και η οδηγία της CSP που τα ελέγχει. */
const RESOURCE_TAGS = Object.freeze({
  script: { attribute: 'src', directive: 'script-src' },
  img: { attribute: 'src', directive: 'img-src' },
  audio: { attribute: 'src', directive: 'media-src' },
  video: { attribute: 'src', directive: 'media-src' },
  source: { attribute: 'src', directive: 'media-src' },
  iframe: { attribute: 'src', directive: 'frame-src' },
  embed: { attribute: 'src', directive: 'object-src' },
  object: { attribute: 'data', directive: 'object-src' },
});

/** Η οδηγία της CSP για ένα <link>, από το rel του. null = δεν φορτώνει πόρο (π.χ. canonical). */
function linkDirective(rel) {
  const rels = rel.toLowerCase().split(/\s+/);
  if (rels.includes('stylesheet')) return 'style-src';
  if (rels.includes('manifest')) return 'manifest-src';
  if (rels.some(r => r === 'icon' || r === 'apple-touch-icon' || r === 'mask-icon')) return 'img-src';
  if (rels.some(r => r === 'modulepreload' || r === 'preload')) return 'script-src';
  return null;
}

function attributeOf(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[2] ?? match[3] ?? match[4]) : null;
}

/**
 * Μια σελίδα HTML κάτω από αυστηρή CSP: κανένα inline script (ούτε import
 * map), κανένας χειριστής on…=, κανένα style= ή <style>, κανένα javascript:,
 * και κάθε εξωτερικός πόρος επιτρέπεται από την οδηγία του.
 */
export function findHtmlProblems({ file, text, csp }) {
  const problems = [];
  const at = index => `${file}:${positionOf(text, index).line}`;
  for (const match of text.matchAll(/<script\b[^>]*>/gi)) {
    if (!attributeOf(match[0], 'src')) problems.push(`${at(match.index)}: inline <script> (η CSP το κόβει, ο κώδικας μπαίνει σε αρχείο .js)`);
  }
  for (const match of text.matchAll(/<[a-z][^>]*?\son[a-z]+\s*=/gi)) problems.push(`${at(match.index)}: χειριστής συμβάντος on…= μέσα στο HTML`);
  for (const match of text.matchAll(/<[a-z][^>]*?\sstyle\s*=/gi)) problems.push(`${at(match.index)}: χαρακτηριστικό style= (η CSP το κόβει)`);
  for (const match of text.matchAll(/<style\b/gi)) problems.push(`${at(match.index)}: στοιχείο <style> (η CSP το κόβει)`);
  for (const match of text.matchAll(/\s(?:href|src|action)\s*=\s*["']?\s*javascript:/gi)) problems.push(`${at(match.index)}: URL javascript:`);

  for (const match of text.matchAll(/<([a-z]+)\b[^>]*>/gi)) {
    const tagName = match[1].toLowerCase();
    let directive = null;
    let value = null;
    if (tagName === 'link') {
      directive = linkDirective(attributeOf(match[0], 'rel') || '');
      value = attributeOf(match[0], 'href');
    } else if (RESOURCE_TAGS[tagName]) {
      directive = RESOURCE_TAGS[tagName].directive;
      value = attributeOf(match[0], RESOURCE_TAGS[tagName].attribute);
    }
    if (!directive || !value || !/^(https?:)?\/\//i.test(value)) continue;
    const url = new URL(value, 'https://invalid.local/');
    if (!cspAllows(csp, directive, url)) problems.push(`${at(match.index)}: το ${directive} της CSP δεν επιτρέπει το ${url.href}`);
  }
  return problems;
}

/**
 * Όλοι οι έλεγχοι για τα αρχεία που δημοσιεύονται: [{ path, text }] με path
 * σχετικό με τη ρίζα του repository, και selfOrigins οι διευθύνσεις της ίδιας
 * της εφαρμογής.
 * @returns {string[]} τα προβλήματα (κενή λίστα = εντάξει)
 */
export function findPublishedSourceProblems({ files, csp, navigationHosts = NAVIGATION_HOSTS, selfOrigins = [] }) {
  const problems = [];
  for (const { path: file, text } of files) {
    for (const hit of findForbiddenCharacters(text)) problems.push(`${file}:${hit.line}: ${hit.name} «${hit.excerpt}»`);
    for (const hit of findSecrets(text)) problems.push(`${file}:${hit.line}: κάτι που μοιάζει με ${hit.name}`);
    if (/\.html$/i.test(file)) problems.push(...findHtmlProblems({ file, text, csp }));
    if (/\.m?js$/i.test(file)) {
      problems.push(...findScriptUrlProblems({ file, text, csp, navigationHosts, selfOrigins }));
      problems.push(...findStrayVendorUrlProblems({ file, text }));
    }
    if (file === VENDOR_MODULE) problems.push(...findVendorModuleProblems({ file, text, csp }));
  }
  return problems;
}
