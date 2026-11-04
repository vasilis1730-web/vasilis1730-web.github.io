/**
 * Ανάγνωση του public/_headers του Cloudflare Pages και της CSP του.
 *
 * Το ίδιο αρχείο σερβίρεται στην παραγωγή (Cloudflare) και στους ελέγχους
 * με πραγματικό Chromium (tests/browser/harness.mjs). Εδώ ζουν οι κανόνες
 * που τα δύο χρειάζονται: ποια headers παίρνει κάθε διαδρομή, ποια είναι η
 * CSP και αν μια πηγή της επιτρέπει ένα URL.
 */

/**
 * Οι κανόνες του _headers ως λίστα { pattern, set: [[name, value]], unset: [name] }.
 * Γραμμές που ξεκινούν με # είναι σχόλια, κάθε μη εσοχή γραμμή ανοίγει νέο κανόνα.
 */
export function parseHeaderRules(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\S/.test(raw)) {
      current = { pattern: raw.trim(), set: [], unset: [] };
      rules.push(current);
    } else if (current) {
      const line = raw.trim();
      if (line.startsWith('!')) current.unset.push(line.slice(1).trim().toLowerCase());
      else {
        const i = line.indexOf(':');
        if (i <= 0) throw new Error(`_headers: γραμμή χωρίς «:» στον κανόνα ${current.pattern}: ${line}`);
        current.set.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
      }
    }
  }
  return rules;
}

/** Ταίριασμα διαδρομής με κανόνα του Cloudflare (/* = όλα, /dir/* = ό,τι ξεκινά με /dir/). */
export function ruleMatches(pattern, pathname) {
  if (pattern === '/*') return true;
  if (pattern.endsWith('/*')) return pathname.startsWith(pattern.slice(0, -1));
  return pattern === pathname;
}

/** Τα headers που παίρνει μια διαδρομή, με τη σειρά των κανόνων (οι επόμενοι υπερισχύουν). */
export function headersFor(rules, pathname) {
  const headers = {};
  for (const rule of rules) {
    if (!ruleMatches(rule.pattern, pathname)) continue;
    for (const [name, value] of rule.set) headers[name] = value;
    for (const name of rule.unset) {
      for (const key of Object.keys(headers)) if (key.toLowerCase() === name) delete headers[key];
    }
  }
  return headers;
}

/** Η τιμή της Content-Security-Policy όλου του site (κανόνας /*) από το κείμενο του _headers. */
export function cspOf(headersText) {
  const rule = parseHeaderRules(headersText).find(r => r.pattern === '/*');
  const entry = rule && rule.set.find(([name]) => name.toLowerCase() === 'content-security-policy');
  if (!entry) throw new Error('δεν βρέθηκε Content-Security-Policy στον κανόνα /* του public/_headers');
  return entry[1];
}

/** Οι πηγές μιας οδηγίας της CSP, π.χ. directiveSources(csp, 'connect-src'). null αν λείπει η οδηγία. */
export function directiveSources(csp, name) {
  const directive = csp.split(';').map(d => d.trim()).find(d => d.split(/\s+/)[0] === name);
  return directive ? directive.split(/\s+/).slice(1) : null;
}

/** Οι πηγές που ισχύουν για μια οδηγία: η ίδια ή, αν λείπει, το default-src. */
export function effectiveSources(csp, name) {
  return directiveSources(csp, name) || directiveSources(csp, 'default-src') || [];
}

/**
 * Αν μια πηγή της CSP επιτρέπει ένα εξωτερικό URL (όχι 'self'). Καλύπτει όσα
 * χρησιμοποιεί η εφαρμογή: σχήμα (https:, blob:, data:), host (https://host),
 * μπαλαντέρ υποτομέων (https://*.domain, σε οποιοδήποτε βάθος) και πρόθεμα διαδρομής.
 */
export function sourceAllowsUrl(source, url) {
  const target = url instanceof URL ? url : new URL(url);
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) return target.protocol === source.toLowerCase();
  const match = source.match(/^([a-z][a-z0-9+.-]*):\/\/([^/]+)(\/.*)?$/i);
  if (!match) return false;
  const [, scheme, hostPart, pathPart] = match;
  if (`${scheme.toLowerCase()}:` !== target.protocol) return false;
  const host = target.hostname.toLowerCase();
  const wanted = hostPart.toLowerCase();
  const hostOk = wanted.startsWith('*.') ? host.endsWith(wanted.slice(1)) : host === wanted;
  if (!hostOk) return false;
  if (!pathPart || pathPart === '/') return true;
  return pathPart.endsWith('/') ? target.pathname.startsWith(pathPart) : target.pathname === pathPart;
}

/** Αν μια οδηγία της CSP (ή το default-src της) επιτρέπει ένα εξωτερικό URL. */
export function cspAllows(csp, directive, url) {
  return effectiveSources(csp, directive).some(source => sourceAllowsUrl(source, url));
}
